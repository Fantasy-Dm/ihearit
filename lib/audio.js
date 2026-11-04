'use strict';
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const {atomic, mediaKey, hash, frame} = require('./util');
const children = new Set(); let stopping = false;
function stopDecoders() { stopping = true; for (const child of children) child.kill(); }
function run(exe, args, {signal, timeout = 120000, maxBytes = 64 * 1024 * 1024} = {}) {
  if (stopping) return Promise.reject(Error('助手正在退出，已停止音频读取。'));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal});
    children.add(child);
    const output = [], errors = []; let bytes = 0, failure = null;
    const timer = setTimeout(() => { failure = Error('音频读取超时，请检查素材与解码器。'); child.kill(); }, timeout);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { failure = Error('解码输出过大。'); child.kill(); } else output.push(chunk); });
    child.stderr.on('data', chunk => { if (errors.length < 20) errors.push(chunk); });
    child.on('error', error => { children.delete(child); clearTimeout(timer); reject(error); });
    child.on('close', code => { children.delete(child); clearTimeout(timer); if (failure || code !== 0) reject(failure || Error(Buffer.concat(errors).toString('utf8').slice(-1500) || '音频解码失败。')); else resolve(Buffer.concat(output)); });
  });
}
function tools(config = {}) {
  const candidates = [config.ffmpeg, process.env.KDENLIVE_FFMPEG];
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:/', 'D:/', 'E:/', 'L:/']) if (base) for (const name of ['kdenlive', 'Kdenlive']) candidates.push(path.join(base, name, 'bin/ffmpeg.exe'));
  for (const file of candidates.filter(Boolean)) { const probe = path.join(path.dirname(file), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'); if (fs.existsSync(file) && fs.existsSync(probe)) return {ffmpeg: file, ffprobe: probe}; }
  return {ffmpeg: 'ffmpeg', ffprobe: 'ffprobe'};
}
class Audio {
  static async open(file, stream, root, config = {}) {
    const audio = new Audio(); audio.path = path.resolve(file); audio.root = root; audio.tools = tools(config); audio.pending = new Map(); audio.refresh = null;
    let data;
    try { data = JSON.parse((await run(audio.tools.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', audio.path], {timeout: 30000})).toString('utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw Error('未找到 FFmpeg。请点击“选择解码器”，选择 Kdenlive/bin/ffmpeg.exe。'); throw error; }
    const streams = data.streams.filter(s => s.codec_type === 'audio'), selected = stream === null || stream === undefined ? streams[0] : streams.find(s => s.index === stream);
    if (!selected) throw Error('素材不包含所选音频流。');
    audio.stream = selected.index; audio.duration = Math.max(...[selected.duration, data.format?.duration].map(Number).filter(n => Number.isFinite(n) && n > 0));
    if (!Number.isFinite(audio.duration)) throw Error('无法确定素材音频时长。');
    audio.key = mediaKey(audio.path, audio.stream); audio.folder = path.join(root, 'decoded', hash('js-f32-v1:' + audio.key).slice(0, 24)); return audio;
  }
  async block(index, signal) {
    const file = path.join(this.folder, `${index}.f32`);
    if (fs.existsSync(file) && (!this.refresh || this.refresh.has(index))) return fs.readFileSync(file);
    if (!this.pending.has(index)) this.pending.set(index, (async () => {
      const data = await run(this.tools.ffmpeg, ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(index * 60), '-i', this.path, '-t', '60', '-map', `0:${this.stream}`, '-vn', '-sn', '-dn', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], {signal});
      if (data.length % 4) throw Error('音频缓存格式异常。'); atomic(file, data); this.refresh?.add(index); return data;
    })().finally(() => this.pending.delete(index)));
    return this.pending.get(index);
  }
  async read(start, duration, signal) {
    if (!(duration >= 0 && duration <= 65)) throw Error('音频分块长度无效。');
    const out = new Float32Array(Math.round(duration * 16000)), first = Math.round(start * 16000), finish = first + out.length, blockSize = 960000;
    for (let index = Math.max(0, Math.floor(first / blockSize)); index <= Math.floor((finish - 1) / blockSize); index++) {
      if (signal?.aborted) throw Error('已停止。'); if (index * 60 >= this.duration) continue;
      const buffer = await this.block(index, signal), samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4), a = Math.max(0, first, index * blockSize), b = Math.min(finish, index * blockSize + samples.length);
      if (b > a) out.set(samples.subarray(a - index * blockSize, b - index * blockSize), a - first);
    }
    return out;
  }
  validate() { if (mediaKey(this.path, this.stream) !== this.key) throw Error('素材已修改，请重新读取音源。'); }
}
class TrackAudio {
  static async open(project, sequence, track, root, config) {
    const audio = new TrackAudio(); audio.project = project; audio.sequence = sequence; audio.track = track; audio.path = project.file; audio.assets = new Map(); audio.config = config; audio.root = root;
    audio.sync(project); if (!audio.clips.length) throw Error('音轨上没有可分析的素材。'); audio.originalKey = audio.fingerprint();
    for (const c of audio.clips) { const key = audio.assetId(c); if (!audio.assets.has(key)) audio.assets.set(key, await Audio.open(c.media_path, c.stream_index, root, config)); }
    return audio;
  }
  assetId(c) { return JSON.stringify([c.media_path, c.stream_index]); }
  sync(project) {
    this.project = project; const track = project.track(this.sequence, this.track); this.name = track.name; this.clips = track.clips;
    let previous = -1;
    for (const c of this.clips) { if (c.timeline_in < previous) throw Error('该音轨存在交叠/交叉混合，当前不模拟混音。'); previous = c.timeline_in + c.source_out - c.source_in + 1; }
    this.duration = Math.max(0, ...this.clips.map(c => c.timeline_in + c.source_out - c.source_in + 1)) / project.fps;
  }
  fingerprint() { return hash(JSON.stringify([this.sequence, this.track, this.project.fps, this.clips.map(c => [c.playlist, c.producer, c.timeline_in, c.source_in, c.source_out, mediaKey(c.media_path, c.stream_index)])])).slice(0, 24); }
  async read(start, duration, signal) {
    const result = new Float32Array(Math.round(duration * 16000)), fps = this.project.fps;
    for (const c of this.clips) {
      const first = c.timeline_in / fps, last = first + (c.source_out - c.source_in + 1) / fps, a = Math.max(start, first, 0), b = Math.min(start + duration, last);
      if (b <= a) continue; const offset = Math.round((a - start) * 16000), count = Math.min(result.length - offset, Math.round((b - a) * 16000));
      const samples = await this.assets.get(this.assetId(c)).read(c.source_in / fps + a - first, count / 16000, signal); result.set(samples.subarray(0, count), offset);
    }
    return result;
  }
  locate(time) {
    const at = frame(time, this.project.fps), c = this.clips.find(c => at >= c.timeline_in && at < c.timeline_in + c.source_out - c.source_in + 1);
    if (!c) throw Error('所选时间位于音轨空白处。');
    const asset = this.assets.get(this.assetId(c)); return {clip: c, sourceTime: time + (c.source_in - c.timeline_in) / this.project.fps, key: asset.key, path: asset.path, stream: asset.stream};
  }
  validate() {
    for (const asset of this.assets.values()) asset.validate();
    const {Project} = require('./project'), fresh = new Project(this.path);
    const records = clips => JSON.stringify(clips.map(c => [c.playlist, c.producer, c.timeline_in, c.source_in, c.source_out, c.media_path, c.stream_index]));
    if (fresh.fps !== this.project.fps || records(fresh.track(this.sequence, this.track).clips) !== records(this.clips)) throw Error('工程音轨已改变，请重新载入音源或扫描后再操作。');
  }
}
function wav(samples) {
  const out = Buffer.alloc(44 + samples.length * 2); out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
  let peak = 1e-8; for (const n of samples) peak = Math.max(peak, Math.abs(n)); const gain = Math.min(3, .8 / peak);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), 44 + i * 2); return out;
}
module.exports = {Audio, TrackAudio, wav, run, tools, stopDecoders};
