'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, data); fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function json(file, fallback) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
const frame = (seconds, fps) => Math.floor(Number(seconds) * fps + .5);
function parseTime(value, fps = 60) {
  const fields = String(value).trim().split(':').map(Number);
  if (fields.some(n => !Number.isFinite(n) || n < 0)) throw Error('无效时间。');
  if (fields.length === 1) return fields[0];
  if (fields.length === 3 && fields[1] < 60 && fields[2] < 60) return fields[0] * 3600 + fields[1] * 60 + fields[2];
  if (fields.length === 4 && fields.every(Number.isInteger) && fields[1] < 60 && fields[2] < 60 && fields[3] < Math.ceil(fps)) return ((fields[0] * 3600 + fields[1] * 60 + fields[2]) * Math.ceil(fps) + fields[3]) / fps;
  throw Error('时间格式为秒数、时:分:秒.毫秒或时:分:秒:帧。');
}
function timecode(seconds, fps = 60) {
  const n = frame(seconds, fps), rate = Math.ceil(fps), pad = n => String(n).padStart(2, '0');
  return [Math.floor(n / (rate * 3600)), Math.floor(n / (rate * 60)) % 60, Math.floor(n / rate) % 60, n % rate].map(pad).join(':');
}
function mediaKey(file, stream = null) {
  const stat = fs.statSync(file, {bigint: true});
  const digest = crypto.createHash('sha256').update(`${stat.size}:${stat.mtimeNs}`);
  const fd = fs.openSync(file, 'r'), size = Number(stat.size);
  try {
    for (const at of [0, Math.max(0, Math.floor(size / 2) - 32768), Math.max(0, size - 65536)]) {
      const bytes = Buffer.alloc(65536), count = fs.readSync(fd, bytes, 0, bytes.length, at); digest.update(bytes.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  const key = digest.digest('hex').slice(0, 24);
  return stream === null || (stream === 0 && ['.wav', '.flac', '.ogg', '.aif', '.aiff', '.mp3'].includes(path.extname(file).toLowerCase())) ? key : hash(`${key}:${stream}`).slice(0, 24);
}
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
function zip(entries) {
  const parts = [], directory = []; let offset = 0;
  for (const [name, input] of Object.entries(entries)) {
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input), filename = Buffer.from(name), encoded = zlib.deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(encoded.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(encoded.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    parts.push(local, filename, encoded); directory.push(central, filename); offset += local.length + filename.length + encoded.length;
  }
  const end = Buffer.alloc(22), central = Buffer.concat(directory); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
function unzip(buffer, {maxBytes = 128 * 1024 * 1024} = {}) {
  const files = {}; let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('不是有效的 NPZ / ZIP 文件。');
  const count = buffer.readUInt16LE(end + 10); let at = buffer.readUInt32LE(end + 16), total = 0;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw Error('ZIP 目录损坏。');
    const method = buffer.readUInt16LE(at + 10), length = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24), nameLength = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32), local = buffer.readUInt32LE(at + 42);
    total += size; if (total > maxBytes || count > 10000) throw Error('样例库过大。');
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8'), begin = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), payload = buffer.subarray(begin, begin + length);
    if (method !== 0 && method !== 8) throw Error('不支持的 ZIP 压缩格式。');
    const data = method === 8 ? zlib.inflateRawSync(payload, {maxOutputLength: Math.max(1, size)}) : payload;
    if (data.length !== size || crc32(data) !== buffer.readUInt32LE(at + 16)) throw Error('样例库校验失败。');
    files[name] = data; at += 46 + nameLength + extra + comment;
  }
  return files;
}
module.exports = {atomic, json, hash, frame, parseTime, timecode, mediaKey, zip, unzip};
