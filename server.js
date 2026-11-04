'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), {Worker} = require('node:worker_threads'), {spawn} = require('node:child_process');
const ROOT = __dirname;
const {FileBrowser} = require('./lib/file-browser');
function openBrowser(url) {
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = edge ? spawn(edge, [`--app=${url}`, '--no-first-run'], {stdio: 'ignore'}) : spawn('explorer.exe', [url], {stdio: 'ignore'}); browser.on('error', () => {}); browser.unref();
}
function start({port = 0, data = process.env.NOISE_DATA || path.join(ROOT, 'data'), open = true, graceMs = 1500} = {}) {
  const token = crypto.randomBytes(32).toString('hex'), worker = new Worker(path.join(ROOT, 'worker.js'), {workerData: {root: ROOT, data}}), requests = new Map();
  let nextId = 0, progress = {text: '就绪', value: 0}, origin = '', exiting = false;
  const clients = new Set(), lifetime = new AbortController(); let closeTimer, bootTimer, shutdown, workerAlive = true;
  const files = new FileBrowser(data, {signal: lifetime.signal});
  const call = (op, args) => new Promise((resolve, reject) => { if (!workerAlive) return reject(Error('后台已退出。')); const id = ++nextId; requests.set(id, {resolve, reject}); worker.postMessage({id, op, args}); });
  worker.on('message', message => { if (message.progress) { progress = message.progress; return; } const pending = requests.get(message.id); if (!pending) return; requests.delete(message.id); message.error ? pending.reject(Error(message.error)) : pending.resolve(message.result); });
  worker.on('error', error => { for (const pending of requests.values()) pending.reject(error); requests.clear(); progress = {text: '后台任务异常：' + error.message, value: 0}; });
  worker.on('exit', () => { workerAlive = false; for (const pending of requests.values()) pending.reject(Error('后台已退出。')); requests.clear(); });
  const stop = () => shutdown ||= (async () => {
    exiting = true; lifetime.abort(); clearTimeout(closeTimer); clearTimeout(bootTimer);
    for (const res of clients) res.end(); clients.clear();
    // Let any atomic project write and its undo record finish before terminating.
    try { if (workerAlive) await call('shutdown'); } catch {} finally { await worker.terminate(); }
    await new Promise(done => { server.close(done); server.closeAllConnections(); });
  })();
  const staticFiles = {'/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'application/javascript; charset=utf-8'], '/library.js': ['library.js', 'application/javascript; charset=utf-8'], '/files.js': ['files.js', 'application/javascript; charset=utf-8'], '/sampling.js': ['sampling.js', 'application/javascript; charset=utf-8'], '/player.js': ['player.js', 'application/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/files.css': ['files.css', 'text/css; charset=utf-8'], '/sampling.css': ['sampling.css', 'text/css; charset=utf-8'], '/library.css': ['library.css', 'text/css; charset=utf-8']};
  const server = http.createServer(async (req, res) => {
    const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src blob:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"};
    const reply = (status, value, contentType = 'application/json; charset=utf-8') => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, {...headers, 'Content-Type': contentType}); res.end(Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
    try {
      if (req.headers.host !== origin.replace('http://', '') || req.headers.origin && req.headers.origin !== origin) return reply(403, {error: '请求来源无效。'});
      const url = new URL(req.url, origin), route = url.pathname;
      if (exiting) return reply(503, {error: '助手正在退出。'});
      // A persistent connection follows the window lifetime, including while minimized.
      // EventSource reconnects on reload; a short grace period avoids treating that as exit.
      if (req.method === 'GET' && route === '/api/live') {
        if (url.searchParams.get('token') !== token) return reply(403, {error: '会话无效。'});
        clearTimeout(closeTimer); clearTimeout(bootTimer); clients.add(res);
        res.writeHead(200, {...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive'}); res.write('data: ready\n\n');
        const heartbeat = setInterval(() => res.write(': alive\n\n'), 3000);
        res.on('close', () => { clearInterval(heartbeat); clients.delete(res); if (!clients.size && !exiting) closeTimer = setTimeout(() => stop().catch(() => {}), graceMs); }); return;
      }
      if (req.method === 'GET' && staticFiles[route]) { const [file, mime] = staticFiles[route]; return reply(200, fs.readFileSync(path.join(ROOT, 'ui', file)), mime); }
      if (req.headers['x-noise-token'] !== token) return reply(403, {error: '会话无效，请从启动地址重新打开。'});
      if (req.method === 'GET' && route === '/api/status') return reply(200, progress);
      if (req.method !== 'POST' || route !== '/api') return reply(404, {error: '未找到。'});
      let bytes = 0, body = ''; for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024 * 1024) throw Error('请求过大。'); body += chunk.toString('utf8'); }
      const request = JSON.parse(body), args = request.args || {}; let op = request.op;
      if (op === 'files:list') return reply(200, await files.list(args.kind, args));
      if (op === 'files:select') return reply(200, await files.select(args.kind, args));
      if (op === 'files:mkdir') return reply(200, await files.mkdir(args.directory, args.name));
      if (op === 'pick') {
        const selection = await files.select(args.kind, args); if (!selection.file || selection.overwrite) return reply(200, selection); const file = selection.file;
        files.remember(args.kind, file);
        const mapping = {project: 'openProject', profile: 'loadProfile', sample: 'calSource', decoder: 'decoder', saveProfile: 'saveProfile', exportProject: 'export', exportJson: 'export', diagnostics: 'diagnostics'};
        op = mapping[args.kind]; args.file = file; if (args.kind === 'exportProject') args.format = 'project'; if (args.kind === 'exportJson') args.format = 'json';
      }
      if (op === 'shutdown') { reply(200, {message: '已退出。'}); await stop(); return; }
      reply(200, await call(op, args));
    } catch (error) { reply(400, {error: error.message}); }
  });
  server.on('close', () => { if (!exiting) worker.terminate(); });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${server.address().port}`; const url = origin + '/#' + token;
    if (open) { openBrowser(url); bootTimer = setTimeout(() => { if (!clients.size) stop().catch(() => {}); }, 45000); }
    resolve({server, worker, url, token, origin, close: stop});
  }));
}
if (require.main === module) (async () => {
  const data = process.env.NOISE_DATA || path.join(ROOT, 'data'), sessionFile = path.join(data, 'session.json'), shouldOpen = !process.argv.includes('--no-open');
  try { const previous = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); if (/^http:\/\/127\.0\.0\.1:\d+$/.test(previous.origin)) { const response = await fetch(previous.origin + '/api/status', {headers: {'X-Noise-Token': previous.token}, signal: AbortSignal.timeout(1500)}); if (response.ok) { if (shouldOpen) openBrowser(previous.origin + '/#' + previous.token); console.log('助手已在运行。'); return; } } } catch {}
  const running = await start({data, open: shouldOpen, port: Number(process.argv.find(a => a.startsWith('--port='))?.slice(7)) || 0});
  require('./lib/util').atomic(sessionFile, JSON.stringify({pid: process.pid, origin: running.origin, token: running.token}));
  process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(sessionFile, 'utf8')).pid === process.pid) fs.unlinkSync(sessionFile); } catch {} });
  console.log('听个响 · I Hear It 已启动；关闭界面会自动停止后台。\n' + running.url);
})().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {start};
