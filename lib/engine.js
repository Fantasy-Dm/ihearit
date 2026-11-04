'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), v8 = require('node:v8');
const {hash, atomic, frame, json} = require('./util');
const {TARGETS} = require('./profile');
const {normalized, energy, spectrum, mouthCandidates, similarity, lowerBound} = require('./dsp');
class Features {
  static async open(file) {
    process.env.ORT_DISABLE_TELEMETRY = '1';
    if (hash(fs.readFileSync(file)) !== 'd3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e') throw Error('YAMNet 模型校验失败。');
    const ort = require('onnxruntime-node'), result = new Features(); result.ort = ort;
    result.session = await ort.InferenceSession.create(file, {executionProviders: ['cpu'], intraOpNumThreads: 4, interOpNumThreads: 1}); return result;
  }
  async infer(samples) {
    const s = this.session, result = await s.run({[s.inputNames[0]]: new this.ort.Tensor('float32', samples, [samples.length])});
    return {scores: result[s.outputNames[0]].data, embeddings: result[s.outputNames[1]].data, count: result[s.outputNames[0]].dims[0]};
  }
  async mouth(audio, at, signal) {
    let x = await audio.read(at - .15, .3, signal); const envelope = energy(x); let peak = 0;
    for (let i = 1; i < envelope.length; i++) if (envelope[i] > envelope[peak]) peak = i;
    const center = peak * 80 + 40, aligned = new Float32Array(4800);
    for (let i = 0; i < aligned.length; i++) { const index = i + center - 2400; if (index >= 0 && index < x.length) aligned[i] = x[index]; }
    x = aligned; const env = normalized(energy(x)), window = Float64Array.from(x.subarray(1920, 2880), (n, i) => n * (.5 - .5 * Math.cos(2 * Math.PI * i / 959))), power = spectrum(window), bands = new Float64Array(40);
    for (let band = 0; band < 40; band++) { const a = 80 * (7900 / 80) ** (band / 40), b = 80 * (7900 / 80) ** ((band + 1) / 40); let sum = 0; for (let i = 0; i < power.length; i++) if (i * 16000 / 2048 >= a && i * 16000 / 2048 < b) sum += power[i]; bands[band] = Math.sqrt(sum); }
    const isolated = new Float32Array(16000); isolated.set(x.subarray(800, 4000), 6400); const embedding = normalized((await this.infer(isolated)).embeddings.subarray(0, 1024));
    const result = new Float32Array(1124); result.set(env); result.set(normalized(bands), 60); result.set(embedding, 100); return result;
  }
  async respiratory(audio, start, signal) { return normalized((await this.infer(await audio.read(start, .975, signal))).embeddings.subarray(0, 1024)); }
}
function saveCache(file, data) { atomic(file, zlib.gzipSync(v8.serialize(data), {level: 1})); }
function loadCache(file) { try { return v8.deserialize(zlib.gunzipSync(fs.readFileSync(file))); } catch { return null; } }
async function scanAsset(audio, intervals, features, root, force, signal, progress) {
  const key = hash(JSON.stringify([audio.key, intervals])).slice(0, 24), file = path.join(root, 'analysis', key + '.bin');
  const cache = !force && loadCache(file); if (cache?.version === 1) return cache.rows;
  if (force) audio.refresh = new Set();
  const needed = (a, b) => intervals.some(([x, y]) => a < y && b > x), check = () => { if (signal?.aborted) throw Error('已停止扫描。'); }, rows = [], total = audio.duration;
  for (let t = 0; t < total; t += 30.72) {
    check(); if (!needed(t, t + 31.2)) continue;
    const output = await features.infer(await audio.read(t, 31.2, signal));
    for (let j = 0; j < Math.min(64, output.count); j++) {
      const at = t + j * .48; if (at >= total || !needed(at, at + .975)) continue;
      const score = index => output.scores[j * 521 + index];
      if (Math.max(...[13, 36, 42, 43, 44, 45].map(score)) >= .04) rows.push({id: `r:${at.toFixed(4)}`, time: at, mode: 'respiratory', proposal: Math.max(score(42), score(43)), vector: normalized(output.embeddings.subarray(j * 1024, (j + 1) * 1024))});
    }
    progress(.4 * Math.min(1, (t + 30.72) / total), `检查较长声音 ${Math.floor(t / 60)} 分钟`);
  }
  for (let start = 0; start < total; start += 60) {
    check(); const origin = Math.max(0, start - .5); if (!needed(origin, origin + 61)) continue;
    const samples = await audio.read(origin, Math.min(61, total - origin), signal), e = energy(samples);
    for (const k of mouthCandidates(e)) {
      check(); const at = origin + (k + .5) * .005; if (at < start || at >= Math.min(start + 60, total) || !needed(at, at + .005)) continue;
      rows.push({id: `m:${at.toFixed(4)}`, time: at, mode: 'mouth', proposal: e[k], vector: await features.mouth(audio, at, signal)});
    }
    progress(.4 + .6 * Math.min(1, (start + 60) / total), `查找短促口腔声 ${Math.floor(start / 60)} 分钟`);
  }
  audio.validate(); rows.sort((a, b) => a.time - b.time); saveCache(file, {version: 1, rows}); return rows;
}
function rowClips(row, audio, project = audio.project) {
  const source = frame(row.media_time, project.fps), timeline = frame(row.time, project.fps);
  return project.track(audio.sequence, audio.track).clips.filter(c => c.media_path === row.media_path && (c.stream_index === null || c.stream_index === row.stream_index) && source >= c.source_in && source <= c.source_out && c.timeline_in + source - c.source_in === timeline);
}
async function scanTrack(audio, features, root, force, signal, progress, range = [0, audio.duration]) {
  const rows = [], fps = audio.project.fps, assets = [...audio.assets];
  for (let index = 0; index < assets.length; index++) {
    const [id, source] = assets[index], clips = audio.clips.filter(c => audio.assetId(c) === id && c.timeline_in / fps < range[1] && (c.timeline_in + c.source_out - c.source_in + 1) / fps > range[0]), intervals = [];
    if (!clips.length) continue;
    for (const [a, b] of clips.map(c => [Math.max(0, (c.source_in + Math.max(0, range[0] * fps - c.timeline_in)) / fps - .5), Math.min(source.duration, (c.source_in + Math.min(c.source_out - c.source_in + 1, range[1] * fps - c.timeline_in)) / fps + .5)]).sort((a, b) => a[0] - b[0])) {
      if (intervals.length && a <= intervals.at(-1)[1]) intervals.at(-1)[1] = Math.max(intervals.at(-1)[1], b); else intervals.push([a, b]);
    }
    const sourceRows = await scanAsset(source, intervals, features, root, force, signal, (p, label) => progress((index + p) / assets.length, label));
    for (const c of clips) for (const row of sourceRows) if (frame(row.time, fps) >= c.source_in && frame(row.time, fps) <= c.source_out) rows.push({...row, id: `${c.playlist}:${c.timeline_in}:${row.id}`, time: row.time + (c.timeline_in - c.source_in) / fps, media_time: row.time, media_path: source.path, stream_index: source.stream, origin: source.key});
  }
  audio.validate(); const {Project} = require('./project'), fresh = new Project(audio.path);
  const snapshot = audio.fingerprint(); audio.sync(fresh); if (audio.fingerprint() !== snapshot) throw Error('扫描期间工程或素材发生变化，请重新扫描。');
  return rows.filter(r => r.time >= range[0] && r.time < range[1]).sort((a, b) => a.time - b.time);
}
function rank(rows, profile, reviews = {}, mouthThreshold = .81, longThreshold = .88) {
  const examples = Object.fromEntries(['mouth', 'respiratory'].map(mode => [mode, {positive: profile.examples.filter(e => e.mode === mode && profile.group(e.groupId)?.role === 'target'), negative: profile.examples.filter(e => e.mode === mode && profile.group(e.groupId)?.role === 'exclude')}]));
  const result = [];
  for (const row of rows) {
    const r = {...row, score: 0, margin: 0, label: '待校准', accepted: false, confirmed: false}, {positive, negative} = examples[r.mode];
    let best = null, score = -Infinity, neg = 0;
    for (const e of positive) { const value = similarity(row.vector, e.vector, row.mode); if (value > score) { score = value; best = e; } }
    for (const e of negative) neg = Math.max(neg, similarity(row.vector, e.vector, row.mode));
    if (best) Object.assign(r, {label: profile.group(best.groupId).name, groupId: best.groupId, score, margin: score - neg, accepted: score >= (r.mode === 'mouth' ? mouthThreshold : longThreshold) && score - neg >= (r.mode === 'mouth' ? .035 : .06)});
    for (const e of profile.examples) if (e.mode === row.mode && e.origin === row.origin && Math.abs(row.media_time - e.feature_time) < .025) Object.assign(r, {label: profile.group(e.groupId).name, groupId: e.groupId, time: row.time + e.marker_time - e.feature_time, media_time: e.marker_time, accepted: profile.group(e.groupId).role === 'target', confirmed: true});
    const review = reviews[row.id], group = profile.group(typeof review === 'string' ? review : review?.groupId);
    if (group && (!review.sampleId || profile.examples.some(e => e.id === review.sampleId))) Object.assign(r, {label: group.name, groupId: group.id, accepted: group.role === 'target', confirmed: true}); result.push(r);
  }
  const selected = [], times = {mouth: [], respiratory: []};
  result.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.score - a.score);
  for (const row of result) {
    if (row.accepted) { const list = times[row.mode], index = lowerBound(list, row.time), gap = row.mode === 'mouth' ? .035 : 1.2; if (list.slice(Math.max(0, index - 1), index + 1).some(t => Math.abs(t - row.time) < gap)) continue; list.splice(index, 0, row.time); }
    selected.push(row);
  }
  return selected.sort((a, b) => a.time - b.time);
}
async function sample(audio, start, end, label, features, scope = '自动') {
  const group = typeof label === 'object' ? label : null; if (group) label = group.name;
  if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= audio.duration + 1e-7 && end - start >= .02 && end - start <= 10)) throw Error('样本需为音源内部 0.02～10 秒。');
  if (audio.locate) { const a = audio.locate(start), b = audio.locate(Math.max(start, end - 1 / audio.project.fps)); if (a.clip.playlist !== b.clip.playlist || a.clip.entry_index !== b.clip.entry_index || end > (a.clip.timeline_in + a.clip.source_out - a.clip.source_in + 1) / audio.project.fps + 1e-7) throw Error('样本跨越剪辑或空白，请缩小选区。'); }
  audio.validate(); const e = energy(await audio.read(start, end - start)); let k = 0; for (let i = 1; i < e.length; i++) if (e[i] > e[k]) k = i; if (!e.length || e[k] < .0002) throw Error('样本几乎无声，请重新选择。');
  const peak = start + (k + .5) * .005, window = {read: async (at, duration) => { const data = await audio.read(at, duration), a = Math.max(0, Math.min(data.length, Math.round((start - at) * 16000))), b = Math.max(0, Math.min(data.length, Math.round((end - at) * 16000))); data.fill(0, 0, a); data.fill(0, b); return data; }};
  const modes = group ? group.mode === 'both' ? ['mouth', 'respiratory'] : [group.mode] : TARGETS.includes(label) ? [label === '啧嘴' ? 'mouth' : 'respiratory'] : scope === '啧嘴筛选' || scope === '自动' && label === '口水声' ? ['mouth'] : scope === '清嗓 / 咳嗽筛选' ? ['respiratory'] : ['mouth', 'respiratory'];
  const result = [];
  for (const mode of modes) { const at = mode === 'mouth' ? peak : Math.min(Math.max(start, peak - .2), Math.max(start, end - .975)), position = time => audio.locate ? audio.locate(time) : {key: audio.key, sourceTime: time}; const location = position(at); result.push({mode, label, ...(group ? {groupId: group.id} : {}), vector: await features[mode](window, at), origin: location.key, feature_time: location.sourceTime, marker_time: position(peak).sourceTime, source_name: path.basename(audio.path), sample_start: start, sample_end: end}); }
  audio.validate(); return result;
}
async function suggest(audio, row, fps) {
  const origin = Math.max(0, row.time - .2), e = energy(await audio.read(origin, Math.min(1.2, audio.duration - origin))); if (!e.length) return [0, 1 / fps];
  const before = row.mode === 'mouth' ? .04 : .05, after = row.mode === 'mouth' ? .04 : .7, left = Math.max(0, Math.floor((row.time - before - origin) / .005)), right = Math.min(e.length, Math.max(left + 1, Math.floor((row.time + after - origin) / .005) + 1)); let peak = left;
  for (let i = left + 1; i < right; i++) if (e[i] > e[peak]) peak = i; const threshold = Math.max(e[peak] * .12, .0002); let a = peak, b = peak + 1;
  while (a > 0 && e[a - 1] > threshold) a--; while (b < e.length && e[b] > threshold) b++;
  const start = Math.floor(Math.max(0, origin + a * .005 - .01) * fps), end = Math.min(Math.floor(audio.duration * fps), Math.max(start + 1, Math.ceil((origin + b * .005 + .015) * fps))); return [start / fps, end / fps];
}
module.exports = {Features, scanTrack, scanAsset, rank, sample, suggest, rowClips, saveCache, loadCache};
