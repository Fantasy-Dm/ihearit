'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');
const {atomic, hash, json, frame, parseTime} = require('./util');
const elements = node => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
const children = (node, tag) => elements(node).filter(n => n.tagName === tag);
const props = node => Object.fromEntries(children(node, 'property').map(n => [n.getAttribute('name'), n.textContent]));
function parse(text) { return new DOMParser({onError: (level, message) => { throw Error('工程 XML 无效：' + message); }}).parseFromString(text, 'application/xml'); }
function property(doc, node, name, value) {
  let item = children(node, 'property').find(n => n.getAttribute('name') === name);
  if (!item) { item = doc.createElement('property'); item.setAttribute('name', name); node.insertBefore(item, node.firstChild); }
  item.textContent = String(value);
}
function historyFolder(file) { return path.join(path.dirname(file), '.noise-assistant-history-js', path.basename(file) + '_' + hash(path.resolve(file)).slice(0, 12)); }
function commit(project, text, action) {
  parse(text); const data = Buffer.from(text), before = project.raw;
  if (!fs.readFileSync(project.file).equals(before)) throw Error('工程已被其他程序修改，请重新读取后操作。');
  const folder = historyFolder(project.file), history = json(path.join(folder, 'history.json'), []), backup = crypto.randomUUID() + '.kdenlive';
  atomic(path.join(folder, backup), before);
  if (!fs.readFileSync(project.file).equals(before)) throw Error('备份期间工程发生变化，本次未写入。');
  atomic(project.file, data);
  try { atomic(path.join(folder, 'history.json'), JSON.stringify([...history, {backup, before: hash(before), after: hash(data), action}])); }
  catch (error) { if (fs.readFileSync(project.file).equals(data)) atomic(project.file, before); throw error; }
}
function undo(file) {
  file = path.resolve(file); const folder = historyFolder(file), manifest = path.join(folder, 'history.json'), history = json(manifest, []), item = history.at(-1);
  if (!item) throw Error('当前工程没有 JS 助手操作可撤销。');
  const current = fs.readFileSync(file); if (hash(current) !== item.after) throw Error('工程已被其他程序修改，未撤销。');
  const backup = path.resolve(folder, item.backup); if (path.dirname(backup) !== path.resolve(folder)) throw Error('备份路径无效。');
  const previous = fs.readFileSync(backup); if (hash(previous) !== item.before) throw Error('备份校验失败。');
  parse(previous.toString('utf8')); if (!fs.readFileSync(file).equals(current)) throw Error('工程刚被修改，未撤销。');
  atomic(file, previous);
  try { atomic(manifest, JSON.stringify(history.slice(0, -1))); } catch (error) { atomic(file, current); throw error; }
  return item.action;
}
class Project {
  constructor(file) {
    this.file = path.resolve(file); this.raw = fs.readFileSync(this.file); this.doc = parse(this.raw.toString('utf8').replace(/^\uFEFF/, '')); this.root = this.doc.documentElement;
    if (this.root.tagName !== 'mlt') throw Error('不是 MLT / Kdenlive 工程。');
    this.nodes = new Map(elements(this.root).filter(n => n.hasAttribute('id')).map(n => [n.getAttribute('id'), n]));
    const profile = children(this.root, 'profile')[0]; this.fps = Number(profile?.getAttribute('frame_rate_num')) / Number(profile?.getAttribute('frame_rate_den'));
    if (!Number.isFinite(this.fps) || this.fps <= 0) throw Error('工程帧率无效。');
    this.sequences = [];
    for (const node of children(this.root, 'tractor')) { const p = props(node); if (p['kdenlive:sequenceproperties.documentuuid'] || p['kdenlive:uuid'] && p['kdenlive:producer_type'] === '17') this.sequences.push({id: node.getAttribute('id'), name: p['kdenlive:clipname'] || p['kdenlive:name'] || node.getAttribute('id')}); }
    if (!this.sequences.length) throw Error('未找到 Kdenlive 序列，请先用 Kdenlive 保存工程。');
    this.compactedBytes = 0;
    for (const node of Array.from(this.root.childNodes)) if (node.nodeType === 3 && node.data.length > 1024 && /^[ \r\n\t]+$/.test(node.data)) { this.compactedBytes += node.data.length - 2; node.data = '\n '; }
    this.trackCache = new Map();
  }
  serialize() { return new XMLSerializer().serializeToString(this.doc); }
  mlt(value) { if (value === null || value === '') throw Error('剪辑缺少时间信息。'); return String(value).includes(':') ? frame(parseTime(value, this.fps), this.fps) : Number(value); }
  resource(node) {
    const p = props(node), value = p['kdenlive:originalurl'] || p.warp_resource || p.resource;
    if (!value || /^(https?:|color:)/i.test(value)) return null;
    if (path.isAbsolute(value)) return path.normalize(value);
    const local = path.resolve(path.dirname(this.file), value); return fs.existsSync(local) ? local : path.resolve(this.root.getAttribute('root') || path.dirname(this.file), value);
  }
  categories() { for (const n of Array.from(this.root.getElementsByTagName('property'))) if (n.getAttribute('name') === 'kdenlive:docproperties.guidesCategories') return JSON.parse(n.textContent); return []; }
  walk(id, seen = new Set()) {
    if (seen.has(id)) throw Error('工程包含循环引用。');
    const node = this.nodes.get(id); if (!node) return [];
    seen = new Set([...seen, id]);
    if (node.tagName === 'tractor') return children(node, 'track').flatMap(n => this.walk(n.getAttribute('producer'), seen));
    if (node.tagName !== 'playlist') return [];
    let cursor = 0; const clips = [];
    elements(node).forEach((entry, index) => {
      if (entry.tagName === 'blank') cursor += this.mlt(entry.getAttribute('length'));
      if (entry.tagName !== 'entry') return;
      const first = this.mlt(entry.getAttribute('in') || '0'), last = this.mlt(entry.getAttribute('out')), producer = this.nodes.get(entry.getAttribute('producer'));
      if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) throw Error('剪辑入点/出点无效。');
      if (producer) {
        if (!['chain', 'producer'].includes(producer.tagName)) throw Error('当前不支持嵌套序列。');
        const p = props(producer), media = this.resource(producer);
        if (p.mlt_service === 'timewarp' || ![undefined, '1', '1.0'].includes(p.warp_speed)) throw Error('当前不支持变速/倒放素材。');
        if (media && p.audio_index !== '-1' && p['set.test_audio'] !== '1') clips.push({playlist: id, entry_index: index, producer: entry.getAttribute('producer'), timeline_in: cursor, source_in: first, source_out: last, media_path: media, stream_index: /^\d+$/.test(p.audio_index || '') ? Number(p.audio_index) : null});
      }
      cursor += last - first + 1;
    });
    return clips;
  }
  tracks(sequence) {
    if (this.trackCache.has(sequence)) return this.trackCache.get(sequence);
    if (!this.sequences.some(s => s.id === sequence)) throw Error('请选择有效序列。');
    const nodes = children(this.nodes.get(sequence), 'track').map(t => this.nodes.get(t.getAttribute('producer'))).filter(n => props(n)['kdenlive:audio_track'] === '1').reverse();
    const tracks = nodes.map((node, i) => ({id: node.getAttribute('id'), name: `A${i + 1}` + ((props(node)['kdenlive:track_name'] || props(node)['kdenlive:trackname']) ? ' · ' + (props(node)['kdenlive:track_name'] || props(node)['kdenlive:trackname']) : ''), clips: this.walk(node.getAttribute('id')).sort((a, b) => a.timeline_in - b.timeline_in)}));
    this.trackCache.set(sequence, tracks); return tracks;
  }
  track(sequence, id) { const track = this.tracks(sequence).find(t => t.id === id); if (!track) throw Error('所选音轨不存在。'); return track; }
  resolve(selection) {
    const playlist = this.nodes.get(selection.playlist), entry = elements(playlist)[selection.entry_index];
    if (!entry || entry.tagName !== 'entry' || entry.getAttribute('producer') !== selection.producer) throw Error('剪辑已改变，请重新选择片段。');
    const fresh = this.walk(selection.playlist).find(c => ['playlist', 'producer', 'timeline_in', 'source_in', 'source_out'].every(k => c[k] === selection[k]));
    if (!fresh) throw Error('剪辑位置已改变，请重新选择片段。');
    return {playlist, entry};
  }
  markers(sequence) { return JSON.parse(props(this.nodes.get(sequence))['kdenlive:sequenceproperties.guides'] || '[]'); }
  mark(sequence, category, clip, sourceTime, label) {
    this.resolve(clip);
    if (!this.categories().some(c => Number(c.index) === Number(category))) throw Error('标记类别不存在。');
    const at = frame(sourceTime, this.fps); if (at < clip.source_in || at > clip.source_out) throw Error('声音已不在该片段内。');
    const pos = clip.timeline_in + at - clip.source_in, markers = this.markers(sequence), existing = markers.find(m => m.pos === pos);
    if (existing) { if (Number(existing.type) === Number(category) && existing.comment?.startsWith(label)) return {changed: false, position: pos}; throw Error('该帧已有其他标记，已保留。'); }
    markers.push({pos, type: Number(category), duration: 0, comment: label + '｜已确认｜听个响'}); markers.sort((a, b) => a.pos - b.pos); this.setMarkers(sequence, markers);
    commit(this, this.serialize(), '标记 ' + label); return {changed: true, position: pos};
  }
  setMarkers(sequence, markers) { const node = this.nodes.get(sequence); property(this.doc, node, 'kdenlive:sequenceproperties.guides', JSON.stringify(markers)); if ('kdenlive:markers' in props(node)) property(this.doc, node, 'kdenlive:markers', JSON.stringify(markers)); }
  descendants(id, set = new Set()) { if (set.has(id)) return set; set.add(id); for (const child of elements(this.nodes.get(id))) if (child.hasAttribute('producer')) this.descendants(child.getAttribute('producer'), set); return set; }
  detach(sequence, clip) {
    const node = this.nodes.get(sequence), groups = JSON.parse(props(node)['kdenlive:sequenceproperties.groups'] || '[]'); if (!Array.isArray(groups)) throw Error('组合数据格式无法识别。'); if (!groups.length) return false;
    let position = 0; const found = [];
    for (const track of children(node, 'track')) {
      const producer = this.nodes.get(track.getAttribute('producer')), p = props(producer);
      if (p['kdenlive:playlistid'] === 'black_track' || p.resource === 'black' && p.mlt_service === 'color') continue;
      if (this.descendants(track.getAttribute('producer')).has(clip.playlist)) found.push(position); position++;
    }
    if (found.length !== 1) throw Error('无法唯一确定组合轨道。');
    let removed = 0;
    function prune(group) {
      if (!group || typeof group !== 'object') throw Error('组合节点无效。');
      if (String(group.type).toLowerCase() === 'leaf') {
        const fields = String(group.data).split(':'); if (![2, 3].includes(fields.length) || !fields.every(s => /^-?\d+$/.test(s)) || !['clip', 'composition', 'subtitle'].includes(group.leaf || 'clip')) throw Error('组合叶节点无法识别。');
        if ((group.leaf || 'clip') === 'clip' && Number(fields[0]) === found[0] && Number(fields[1]) === clip.timeline_in) { removed++; return null; } return group;
      }
      if (!['normal', 'avsplit'].includes(String(group.type).toLowerCase()) || !Array.isArray(group.children)) throw Error('组合类型暂不支持。');
      const before = removed, kids = group.children.map(prune).filter(Boolean); if (before === removed) return group;
      if (!kids.length) return null; if (kids.length === 1) return kids[0]; return {...group, children: kids};
    }
    const result = [];
    for (const group of groups) { const before = removed, kept = prune(group); if (kept && !(removed > before && String(kept.type).toLowerCase() === 'leaf')) result.push(kept); }
    if (removed) property(this.doc, node, 'kdenlive:sequenceproperties.groups', JSON.stringify(result)); return removed > 0;
  }
  cut(sequence, clip, startTime, endTime) {
    const {playlist, entry} = this.resolve(clip), start = frame(startTime, this.fps), end = frame(endTime, this.fps);
    if (end <= start || start < clip.source_in || end > clip.source_out + 1) throw Error('裁切范围无效或跨越剪辑边界。');
    if (this.sequences.some(s => s.id !== sequence && this.descendants(s.id).has(clip.playlist))) throw Error('该轨道由多个序列共用，未裁切。');
    if (elements(entry).some(n => !['filter', 'property'].includes(n.tagName)) || children(entry, 'property').some(p => /mix/i.test(p.getAttribute('name')))) throw Error('该片段带有尚未支持的混合/效果。');
    for (const effect of children(entry, 'filter')) {
      const p = props(effect);
      if (p.mlt_service !== 'avfilter.alimiter' || effect.hasAttribute('in') || effect.hasAttribute('out') || ![undefined, '', '0'].includes(p['kdenlive:sync_in_out']) || elements(effect).some(n => n.tagName !== 'property') || Object.entries(p).some(([k, v]) => k.startsWith('av.') && (v.trim() === '' || !Number.isFinite(Number(v))))) throw Error('目前仅支持不带动画和时间范围的静态限幅器。');
    }
    const detached = this.detach(sequence, clip), pieces = [];
    if (start > clip.source_in) { const left = entry.cloneNode(true); left.setAttribute('out', start - 1); pieces.push(left); }
    const blank = this.doc.createElement('blank'); blank.setAttribute('length', end - start); pieces.push(blank);
    if (end <= clip.source_out) { const right = entry.cloneNode(true); right.setAttribute('in', end); pieces.push(right); }
    if (pieces.filter(n => n.tagName === 'entry').length > 1) {
      const used = new Set(Array.from(this.root.getElementsByTagName('*')).map(n => n.getAttribute('id')).filter(Boolean)); let next = Math.max(-1, ...[...used].filter(s => /^filter\d+$/.test(s)).map(s => Number(s.slice(6)))) + 1;
      for (const f of Array.from(pieces.at(-1).getElementsByTagName('filter'))) { while (used.has(`filter${next}`)) next++; f.setAttribute('id', `filter${next}`); used.add(`filter${next++}`); }
    }
    for (const piece of pieces) playlist.insertBefore(piece, entry); playlist.removeChild(entry);
    let previous = null;
    for (const item of elements(playlist)) { if (item.tagName === 'blank' && previous?.tagName === 'blank') { previous.setAttribute('length', this.mlt(previous.getAttribute('length')) + this.mlt(item.getAttribute('length'))); playlist.removeChild(item); } else previous = item; }
    commit(this, this.serialize(), `裁切并留空 ${startTime}–${endTime}`);
    return {frames: end - start, detached, preserved_filters: children(entry, 'filter').length};
  }
  repair() { if (!this.compactedBytes) return {changed: false, removed: 0}; commit(this, this.serialize(), '修复工程重复空白'); return {changed: true, removed: this.compactedBytes}; }
  info() { return {file: this.file, fps: this.fps, sequences: this.sequences, categories: this.categories(), bytes: this.raw.length, compacted: this.compactedBytes}; }
}
module.exports = {Project, undo, commit, parse, elements, children, props, property, historyFolder};
