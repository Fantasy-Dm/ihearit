'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {atomic, hash, unzip} = require('./util');
const TARGETS = ['啧嘴', '清嗓', '咳嗽'], EXCLUDES = ['笑声', '口水声', '吸鼻声', '普通说话', '其他排除'];
function npy(buffer) {
  if (buffer.subarray(1, 6).toString() !== 'NUMPY') throw Error('样例库数组格式不支持。');
  const v = buffer[6], length = v === 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8), start = v === 1 ? 10 : 12;
  const header = buffer.subarray(start, start + length).toString(), type = /['"]descr['"]\s*:\s*['"]([^'"]+)/.exec(header)?.[1], data = buffer.subarray(start + length);
  if (type === '<f4' || type === '=f4') { const result = []; for (let i = 0; i < data.length; i += 4) result.push(data.readFloatLE(i)); return result; }
  if (type?.startsWith('<U')) { let result = ''; for (let i = 0; i < data.length; i += 4) { const n = data.readUInt32LE(i); if (n) result += String.fromCodePoint(n); } return result; }
  throw Error('不支持的样例库数据类型：' + type);
}
class Profile {
  constructor(file = null) {
    this.file = file; this.id = crypto.randomUUID().replaceAll('-', ''); this.examples = []; this.groups = [];
    if (!file || !fs.existsSync(file)) return;
    const raw = fs.readFileSync(file); let metadata;
    if (path.extname(file).toLowerCase() === '.npz') {
      const entries = unzip(raw); metadata = JSON.parse(npy(entries['metadata.npy']));
      if (metadata.version !== 2) throw Error('不支持的旧版样例库。');
      metadata.examples = metadata.examples.map((e, i) => ({...e, vector: npy(entries[`vector_${i}.npy`])}));
    } else metadata = JSON.parse(raw.toString('utf8'));
    this.loadedVersion = metadata.version;
    this.id = metadata.profile_id || hash(raw).slice(0, 32);
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(this.id)) throw Error('样例库标识无效。');
    this.groups = metadata.groups || [...TARGETS, ...EXCLUDES].map(name => this.legacyGroup(name));
    this.validateGroups();
    this.examples = (metadata.examples || []).map(e => ({...e, id: e.id || hash(JSON.stringify([e.origin, e.mode, e.feature_time, e.label])).slice(0, 24), groupId: e.groupId || this.group(e.label)?.id}));
    for (const e of this.examples) {
      if (!this.group(e.groupId) || !['mouth', 'respiratory'].includes(e.mode) || e.vector?.length !== (e.mode === 'mouth' ? 1124 : 1024) || !e.vector.every(Number.isFinite)) throw Error('样例库特征无效。');
      e.label = this.group(e.groupId).name;
    }
  }
  legacyGroup(name) { return {id: hash(this.id + ':' + name).slice(0, 24), name, role: TARGETS.includes(name) ? 'target' : 'exclude', mode: ['啧嘴', '口水声'].includes(name) ? 'mouth' : TARGETS.includes(name) ? 'respiratory' : 'both'}; }
  group(value) { return this.groups.find(g => g.id === value || g.name === value); }
  validateGroups() {
    if (!Array.isArray(this.groups) || this.groups.length > 40) throw Error('每个库最多支持40个分组。');
    const ids = new Set(), names = new Set();
    for (const g of this.groups) {
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(g.id) || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 40 || !['target', 'exclude'].includes(g.role) || !['mouth', 'respiratory', 'both'].includes(g.mode) || ids.has(g.id) || names.has(g.name)) throw Error('分组名称或属性无效，名称不能重复。');
      ids.add(g.id); names.add(g.name);
    }
  }
  setGroups(groups) {
    const previous = this.groups; this.groups = groups.map(g => ({id: g.id || crypto.randomUUID(), name: String(g.name || '').trim(), role: g.role, mode: g.mode}));
    try { this.validateGroups(); } catch (error) { this.groups = previous; throw error; }
    this.examples = this.examples.filter(e => this.group(e.groupId)).map(e => ({...e, label: this.group(e.groupId).name}));
  }
  save(file = this.file) {
    if (!file) throw Error('请先新建或选择个人库。');
    if (path.extname(file).toLowerCase() === '.npz') file = file.slice(0, -4) + '.json';
    this.validateGroups();
    if (this.loadedVersion && this.loadedVersion < 4 && file === this.file && fs.existsSync(file) && !fs.existsSync(file + '.pre-v4.bak')) atomic(file + '.pre-v4.bak', fs.readFileSync(file));
    atomic(file, JSON.stringify({version: 4, profile_id: this.id, groups: this.groups, examples: this.examples})); this.file = file; this.loadedVersion = 4;
  }
  add(example) {
    let group = this.group(example.groupId || example.label);
    // Compatibility for callers importing the old named example format.
    if (!group && [...TARGETS, ...EXCLUDES].includes(example.label) && !example.groupId) { group = this.legacyGroup(example.label); this.groups.push(group); }
    if (!group) throw Error('请先在个人库中建立这个分组。');
    this.examples = this.examples.filter(e => !(e.mode === example.mode && e.origin === example.origin && Math.abs(e.feature_time - example.feature_time) < .02));
    const result = {...example, id: crypto.randomUUID(), groupId: group.id, label: group.name, vector: Array.from(example.vector)}; this.examples.push(result); return result;
  }
  info() { return {file: this.file, id: this.id, count: this.examples.length, groups: this.groups.map(g => ({...g, count: this.examples.filter(e => e.groupId === g.id).length})), counts: Object.fromEntries(this.groups.map(g => [g.name, this.examples.filter(e => e.groupId === g.id).length]))}; }
  detail() { return {...this.info(), examples: this.examples.map(({vector, ...e}) => e)}; }
}
module.exports = {Profile, TARGETS, EXCLUDES, npy};
