'use strict';
const fs = require('node:fs'), path = require('node:path'), {execFileSync} = require('node:child_process');
const {zip, unzip, hash} = require('../lib/util');
const {Profile} = require('../lib/profile');
const {readForPackage} = require('./windows-script');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist'), version = require('../package.json').version;
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('当前打包脚本用于 Windows x64。');
fs.mkdirSync(dist, {recursive: true});
execFileSync(process.execPath, [path.join(__dirname, 'compile-launcher.js')], {cwd: root, windowsHide: true, stdio: 'pipe'});
const stage = fs.mkdtempSync(path.join(dist, '.build-')), app = path.join(stage, 'ihearit'), profile = process.argv.find(a => a.startsWith('--profile='))?.slice(10), label = profile ? '个人完整版' : '通用完整版';
function copy(source, destination, filter = () => true) {
  if (!filter(source)) return;
  if (fs.statSync(source).isDirectory()) { fs.mkdirSync(destination, {recursive: true}); for (const file of fs.readdirSync(source)) copy(path.join(source, file), path.join(destination, file), filter); }
  else { fs.mkdirSync(path.dirname(destination), {recursive: true}); fs.writeFileSync(destination, readForPackage(source)); }
}
function walk(dir, prefix = '') { return fs.readdirSync(dir).flatMap(name => { const file = path.join(dir, name), relative = prefix + name; return fs.statSync(file).isDirectory() ? walk(file, relative + '/') : [[relative, file]]; }); }
try {
  for (const file of ['server.js', 'worker.js', 'package.json', 'package-lock.json', '.npmrc', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'ihearit.exe', 'start.cmd', 'start.vbs', '启动助手.cmd', '启动助手.vbs', 'lib', 'ui', 'models', 'licenses']) copy(path.join(root, file), path.join(app, file));
  if (profile) new Profile(path.resolve(profile)).save(path.join(app, 'profiles', '已校准样例库.json'));
  copy(process.execPath, path.join(app, 'runtime/node.exe'));
  for (const name of ['@xmldom/xmldom', 'onnxruntime-common', 'onnxruntime-node']) {
    const source = path.join(root, 'node_modules', name), destination = path.join(app, 'node_modules', name);
    for (const file of fs.readdirSync(source)) if (['package.json', 'LICENSE', 'LICENSE.txt', 'LICENSE.md', 'ThirdPartyNotices.txt', 'README.md'].includes(file)) copy(path.join(source, file), path.join(destination, file));
    if (name === '@xmldom/xmldom') copy(path.join(source, 'lib'), path.join(destination, 'lib'));
    else {
      if (name === 'onnxruntime-common') copy(path.join(source, 'dist/cjs'), path.join(destination, 'dist/cjs'), file => fs.statSync(file).isDirectory() || file.endsWith('.js') || path.basename(file) === 'package.json');
      else {
        copy(path.join(source, 'dist'), path.join(destination, 'dist'), file => fs.statSync(file).isDirectory() || file.endsWith('.js'));
        copy(path.join(source, 'bin/napi-v6/win32/x64'), path.join(destination, 'bin/napi-v6/win32/x64'), file => fs.statSync(file).isDirectory() || ['onnxruntime.dll', 'onnxruntime_binding.node'].includes(path.basename(file)));
      }
    }
  }
  // Test the actually shipped subset, not the larger developer node_modules.
  const probe = `process.env.ORT_DISABLE_TELEMETRY='1';require('./lib/engine').Features.open('models/yamnet.onnx').then(async f=>{const o=await f.infer(new Float32Array(16000));if(o.embeddings.length!==2048)throw Error('Model output mismatch');console.log('Portable runtime model probe OK')}).catch(e=>{console.error(e);process.exitCode=1});`;
  let verification;
  try { verification = execFileSync(path.join(app, 'runtime/node.exe'), ['-e', probe], {cwd: app, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}); }
  catch {
    // Some official native builds link DirectML at load time even on CPU.
    // Keep those DLLs only if an actual inference proves they are required.
    for (const file of ['DirectML.dll', 'dxcompiler.dll']) copy(path.join(root, 'node_modules/onnxruntime-node/bin/napi-v6/win32/x64', file), path.join(app, 'node_modules/onnxruntime-node/bin/napi-v6/win32/x64', file));
    verification = execFileSync(path.join(app, 'runtime/node.exe'), ['-e', probe], {cwd: app, encoding: 'utf8', windowsHide: true});
  }
  console.log(verification.trim());
  const manifest = {id: 'ihearit', name: '听个响', englishName: 'I Hear It', subtitle: '你继续，俺在听', version: version + '-js', node: process.version, platform: 'win32-x64', variant: label, directDependencies: require('../package.json').dependencies, runtimePackages: ['@xmldom/xmldom', 'onnxruntime-common', 'onnxruntime-node'], installScripts: false, files: Object.fromEntries(walk(app).map(([relative, file]) => [relative, {bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file))}]))};
  fs.writeFileSync(path.join(app, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2));
  const entries = Object.fromEntries(walk(app).map(([relative, file]) => ['ihearit/' + relative, fs.readFileSync(file)]));
  const bytes = zip(entries), output = path.join(dist, ...(profile ? ['private'] : []), `ihearit-v${version}-win-x64${profile ? '-personal' : ''}.zip`);
  fs.mkdirSync(path.dirname(output), {recursive: true});
  const checked = unzip(bytes, {maxBytes: 512 * 1024 * 1024}); if (!checked['ihearit/runtime/node.exe'] || Object.keys(checked).length !== Object.keys(entries).length) throw Error('压缩包校验失败。'); fs.writeFileSync(output, bytes);
  console.log(JSON.stringify({file: output, bytes: bytes.length, files: Object.keys(entries).length, runtimePackages: manifest.runtimePackages, profileExamples: profile ? new Profile(path.resolve(profile)).examples.length : 0}, null, 2));
} finally {
  const resolved = path.resolve(stage); if (!resolved.startsWith(path.resolve(dist) + path.sep) || !path.basename(resolved).startsWith('.build-')) throw Error('构建临时目录范围无效。');
  fs.rmSync(resolved, {recursive: true, force: true});
}
