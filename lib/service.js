'use strict';
const fs = require('node:fs'), path = require('node:path');
const {Project, undo} = require('./project');
const {Profile} = require('./profile');
const {Audio, TrackAudio, wav} = require('./audio');
const {Features, scanTrack, scanAsset, rank, sample, suggest, rowClips} = require('./engine');
const {viewWave, overview} = require('./waveform');
const {atomic, json, hash, parseTime, frame, zip} = require('./util');
const VERSION = require('../package.json').version + '-js';
class Service {
  constructor(root, data, progress = () => {}) {
    this.root = root; this.data = data; this.cache = path.join(data, 'cache'); this.progress = progress; this.settings = json(path.join(data, 'settings.json'), {}); this.rows = []; this.ranked = []; this.project = null; this.audio = null; this.calAudio = null; this.busy = false;
    const defaultFile = path.join(data, 'profiles', '我的声音样例库.json'), bundled = path.join(root, 'profiles', '已校准样例库.json');
    if (!fs.existsSync(defaultFile)) { if (fs.existsSync(bundled)) atomic(defaultFile, fs.readFileSync(bundled)); else new Profile().save(defaultFile); }
    this.profile = new Profile(fs.existsSync(this.settings.profile || '') ? this.settings.profile : defaultFile);
  }
  saveSettings() { this.settings.profile = this.profile.file; atomic(path.join(this.data, 'settings.json'), JSON.stringify(this.settings)); }
  reviewFile() { return path.join(this.data, 'reviews', hash(JSON.stringify([this.project?.file, this.sequence, this.track, this.profile.id])) + '.json'); }
  reviews() { return json(this.reviewFile(), {}); }
  model() { this.modelPromise ||= Features.open(path.join(this.root, 'models', 'yamnet.onnx')); return this.modelPromise; }
  requireAudio() { if (!this.audio) throw Error('请先选择工程、序列和音轨。'); return this.audio; }
  rerank() { this.ranked = this.audio ? rank(this.rows, this.profile, this.reviews(), this.mouthThreshold || .81, this.longThreshold || .88).filter(r => rowClips(r, this.audio).length) : []; }
  row(id) { const row = this.ranked.find(r => r.id === id); if (!row) throw Error('该候选已改变或被移除，请重新选择。'); return row; }
  state(view = '推荐标记', offset = 0) {
    let rows = this.ranked;
    if (view === '推荐标记') rows = rows.filter(r => r.accepted);
    if (view === '已排除') rows = rows.filter(r => r.confirmed && !r.accepted);
    if (view === '待校准：短促声音') rows = rows.filter(r => r.mode === 'mouth' && !r.confirmed);
    if (view === '待校准：较长声音') rows = rows.filter(r => r.mode === 'respiratory' && !r.confirmed);
    const summary = r => { const {vector, ...rest} = r; return rest; };
    return {version: VERSION, profile: this.profile.info(), project: this.project?.info(), sequence: this.sequence, track: this.track, tracks: this.project && this.sequence ? this.project.tracks(this.sequence) : [], duration: this.audio?.duration || 0, scanned: this.rows.length > 0, ready: this.scanned || false, rows: rows.slice(offset, offset + 250).map(summary), total: rows.length, accepted: this.ranked.filter(r => r.accepted).length, view, offset, emptyProfile: !this.profile.examples.some(e => this.profile.group(e.groupId)?.role === 'target')};
  }
  async openProject(file) {
    this.project = new Project(file); this.sequence = this.project.sequences[0].id; const tracks = this.project.tracks(this.sequence); this.track = tracks.find(t => t.clips.length)?.id; this.rows = []; this.ranked = []; this.audio = null; this.scanned = false; this.settings.project = file; this.saveSettings();
    if (this.track) await this.setTrack(this.sequence, this.track); return this.state();
  }
  async setTrack(sequence, track) { this.requireProject(); const audio = await TrackAudio.open(new Project(this.project.file), sequence, track, this.cache, this.settings); this.project = audio.project; this.audio = audio; this.sequence = sequence; this.track = track; this.rows = []; this.ranked = []; this.scanned = false; this.calAudio = null; return this.state(); }
  requireProject() { if (!this.project) throw Error('请先选择 Kdenlive 工程。'); }
  async listSequence(sequence) { this.requireProject(); const tracks = this.project.tracks(sequence), track = tracks.find(t => t.clips.length); if (!track) { this.sequence = sequence; this.track = null; this.audio = null; this.rows = []; this.ranked = []; return this.state(); } return this.setTrack(sequence, track.id); }
  group(value, profile = this.profile) { const group = profile.group(value); if (!group) throw Error('请先在个人库中添加或选择分组。'); return group; }
  calibration(sourceId){if(!this.calAudio)throw Error('请先载入校准音源。');if(sourceId&&sourceId!==this.calId)throw Error('采样音源已切换，请重新载入后再操作。');return this.calAudio;}
  profileFile(name) { name = String(name || '').trim(); if (!name || name.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || ['.', '..'].includes(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw Error('请输入有效的个人库名称。'); const file = path.join(this.data, 'profiles', name + '.json'); if (fs.existsSync(file)) throw Error('同名个人库已存在，请使用其他名称或读取原库。'); return file; }
  wizardState(offset = 0) { const w = this.wizard; if (!w) throw Error('请先进行初步筛查。'); return {wizard: true, offset, total: w.rows.length, assigned: Object.keys(w.assignments).length, rows: w.rows.slice(offset, offset + 80).map(({vector, ...r}) => ({...r, assigned: w.assignments[r.id]?.groupId || ''})), groups: w.profile.groups}; }
  async confirm(row, value) {
    const group = this.group(value); let added;
    const before = this.profile.examples; this.profile.examples = [...before];
    try {
      if (group.mode === 'both' || group.mode === row.mode) added = this.profile.add({mode: row.mode, groupId: group.id, vector: row.vector, origin: row.origin, feature_time: this.rows.find(r => r.id === row.id).media_time, marker_time: row.media_time, source_name: path.basename(row.media_path)});
      else for (const e of await sample(this.audio, Math.max(0, row.time - .1), Math.min(this.audio.duration, row.time + .6), group, await this.model())) added = this.profile.add(e);
      this.profile.save();
    } catch (error) { this.profile.examples = before; throw error; }
    const reviews = this.reviews(); reviews[row.id] = {groupId: group.id, sampleId: added.id}; atomic(this.reviewFile(), JSON.stringify(reviews)); this.saveSettings(); Object.assign(row, {label: group.name, groupId: group.id, confirmed: true, accepted: group.role === 'target'});
  }
  async handle(op, args = {}) {
    if (this.closing) throw Error('助手正在退出。');
    if (op === 'state') return this.state(args.view, args.offset || 0);
    if (op === 'cancel') { this.controller?.abort(); this.overviewController?.abort(); return true; }
    if (op === 'cancelOverview') { this.overviewController?.abort(); return true; }
    if (this.busy && !['wave', 'preview', 'viewWave', 'overview'].includes(op)) throw Error('上一项操作尚未完成，请稍候。');
    const exclusive = !['wave', 'preview', 'viewWave', 'overview'].includes(op); if (exclusive) this.busy = true;
    const started = Date.now(), record = {version: VERSION, operation: op, started: new Date().toISOString(), status: 'running', stages: []}, logFile = path.join(this.data, '.diagnostics', `operation_${Date.now()}_${Math.random().toString(16).slice(2)}.json`);
    this.operationCount = (this.operationCount || 0) + 1;
    if (this.operationCount % 20 === 1 && fs.existsSync(path.dirname(logFile))) for (const name of fs.readdirSync(path.dirname(logFile)).filter(n => /^operation_.*\.json$/.test(n)).sort().slice(0, -120)) fs.unlinkSync(path.join(path.dirname(logFile), name));
    const stage = (value, text) => { record.stage = text; record.stages.push({elapsed: (Date.now() - started) / 1000, text}); atomic(logFile, JSON.stringify(record)); this.progress({op, value, text, elapsed: (Date.now() - started) / 1000}); };
    stage(0, op); const monitor = setInterval(() => { record.elapsed = (Date.now() - started) / 1000; atomic(logFile, JSON.stringify(record)); this.progress({op, value: null, text: record.stage, elapsed: record.elapsed}); }, 5000);
    try {
      let result;
      switch (op) {
        case 'viewWave': {const audio=this.calibration(args.sourceId),id=this.calId,data=await viewWave(audio,Number(args.start),Number(args.end));if(this.calAudio!==audio||this.calId!==id)throw Error('采样音源已切换。');result={...data,sourceId:id};break;}
        case 'overview': {const audio=this.calibration(args.sourceId),id=this.calId;this.overviewController?.abort();this.overviewController=new AbortController();result={...await overview(audio,this.cache,this.overviewController.signal,stage),sourceId:id};if(this.calAudio!==audio||this.calId!==id)throw Error('采样音源已切换。');break;}
        case 'init': result = fs.existsSync(this.settings.project || '') ? await this.openProject(this.settings.project) : this.state(); break;
        case 'openProject': result = await this.openProject(args.file); break;
        case 'setTrack': result = await this.setTrack(args.sequence, args.track); break;
        case 'sequence': result = await this.listSequence(args.sequence); break;
        case 'decoder': this.settings.ffmpeg = args.file; this.saveSettings(); this.audio = null; this.calAudio = null; result = {message: '解码器已设置，请重新选择音轨。'}; break;
        case 'loadProfile': this.profile = new Profile(args.file); if (path.extname(args.file).toLowerCase() === '.npz') this.profile.save(path.join(this.data, 'profiles', path.basename(args.file, '.npz') + '.json')); this.rerank(); this.saveSettings(); result = this.state(); break;
        case 'newProfile': { const file = this.profileFile(args.name), profile = new Profile(); profile.setGroups(args.groups || []); profile.save(file); this.profile = profile; this.saveSettings(); this.rerank(); result = this.state(); break; }
        case 'saveProfile': this.profile.save(args.file); this.saveSettings(); result = this.state(); break;
        case 'profileDetail': result = this.profile.detail(); break;
        case 'profileEdit': {
          const edited = new Profile(this.profile.file);
          if (args.groups) { const removed = edited.examples.filter(e => !args.groups.some(g => g.id === e.groupId)).length; if (removed && !args.deleteSamples) throw Error(`删除分组会同时删除其中 ${removed} 个样本，请确认后重试。`); edited.setGroups(args.groups); }
          if (args.deleteSample) edited.examples = edited.examples.filter(e => e.id !== args.deleteSample);
          if (args.sampleId && args.groupId) { const e = edited.examples.find(e => e.id === args.sampleId), g = this.group(args.groupId, edited); if (!e) throw Error('样本不存在。'); if (g.mode !== 'both' && g.mode !== e.mode) throw Error('该样本的声音长度类型与分组不一致，请选择相同类型或“两类声音”的分组。'); e.groupId = g.id; e.label = g.name; }
          edited.save(); this.profile = edited; this.rerank(); result = {state: this.state(args.view), detail: edited.detail(), message: '个人库已更新。'}; break;
        }
        case 'wizardScan': {
          this.calibration(args.sourceId); this.profileFile(args.name);
          const draft = new Profile(); draft.setGroups(args.groups || []); if (!draft.groups.some(g => g.role === 'target')) throw Error('请至少添加一个“要处理”的分组。');
          const audio = this.calAudio, start = parseTime(args.start, this.project?.fps || 60), end = parseTime(args.end, this.project?.fps || 60); if (!(start >= 0 && end > start && end <= audio.duration + 1e-7)) throw Error('筛查范围超出音源，请调整起止点。');
          this.controller = new AbortController(); const signal = this.controller.signal; this.wizard = null; stage(0, '初步筛查：寻找可供试听归类的候选');
          const rows = audio.assets ? await scanTrack(audio, await this.model(), this.cache, false, signal, stage, [start, end]) : (await scanAsset(audio, [[start, end]], await this.model(), this.cache, false, signal, stage)).filter(r => r.time >= start && r.time < end).map(r => ({...r, media_time: r.time, media_path: audio.path, stream_index: audio.stream, origin: audio.key}));
          this.wizard = {name: args.name, profile: draft, audio, sourceId:this.calId, rows, assignments: {}}; result = this.wizardState(); break;
        }
        case 'wizardState': result = this.wizardState(Number(args.offset) || 0); break;
        case 'wizardAssign': {
          const w = this.wizard, row = w?.rows.find(r => r.id === args.id); if (!row) throw Error('引导候选已改变，请重新筛查。');
          if (!args.groupId) delete w.assignments[row.id];
          else { const g = this.group(args.groupId, w.profile); let examples;
            if (g.mode === 'both' || g.mode === row.mode) examples = [{mode: row.mode, groupId: g.id, vector: row.vector, origin: row.origin, feature_time: row.media_time, marker_time: row.media_time, source_name: path.basename(row.media_path)}];
            else examples = await sample(w.audio, Math.max(0, row.time - .1), Math.min(w.audio.duration, row.time + .8), g, await this.model());
            w.assignments[row.id] = {groupId: g.id, examples};
          } result = this.wizardState(Number(args.offset) || 0); break;
        }
        case 'wizardFinish': { const w = this.wizard; if (!w || !Object.values(w.assignments).some(a => w.profile.group(a.groupId)?.role === 'target')) throw Error('请先将至少一个候选归入“要处理”的分组。'); for (const a of Object.values(w.assignments)) for (const e of a.examples) w.profile.add(e); w.profile.save(this.profileFile(w.name)); this.profile = w.profile; this.wizard = null; this.saveSettings(); this.rerank(); result = {state: this.state(args.view), message: '个人库已生成，可开始扫描其他片段。'}; break; }
        case 'wizardCancel': this.overviewController?.abort(); this.wizard = null; result = true; break;
        case 'scan': {
          this.requireAudio(); this.controller = new AbortController(); const signal = this.controller.signal;
          stage(0, args.force ? '强制读取工程及素材' : '读取工程和分析缓存'); this.audio = await TrackAudio.open(new Project(this.project.file), this.sequence, this.track, this.cache, this.settings); this.project = this.audio.project;
          this.rows = await scanTrack(this.audio, await this.model(), this.cache, Boolean(args.force), signal, stage); this.scanned = true; this.rerank(); result = this.state(args.view); break;
        }
        case 'rank': this.mouthThreshold = Number(args.mouth); this.longThreshold = Number(args.long); if (![this.mouthThreshold, this.longThreshold].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw Error('相似度需在 0～1 之间。'); this.rerank(); result = this.state(args.view); break;
        case 'review': await this.confirm(this.row(args.id), args.groupId || args.label); this.rerank(); result = this.state(args.view); break;
        case 'mark': {
          const group = this.group(args.groupId || args.label); if (group.role !== 'target') throw Error('请选择“要处理”的分组。');
          const row = this.row(args.id), project = new Project(this.project.file); this.audio.validate(); const clips = rowClips(row, this.audio, project), clip = clips[Number(args.occurrence) || 0]; if (!clip) throw Error('声音已不在所选音轨，请重新扫描。');
          stage(.3, '备份并写入标记'); result = project.mark(this.sequence, args.category, clip, row.media_time, group.name); this.project = new Project(project.file); this.audio.sync(this.project); await this.confirm(row, group.id); result = {state: this.state(args.view), message: result.changed ? '已标记到工程；Kdenlive 请重新加载。' : '该帧已有同类标记。'}; break;
        }
        case 'cut': {
          const row = this.row(args.id), project = new Project(this.project.file), start = parseTime(args.start, project.fps), end = parseTime(args.end, project.fps); this.audio.validate(); const clip = rowClips(row, this.audio, project)[Number(args.occurrence) || 0]; if (!clip) throw Error('该声音已经不在音轨中。');
          stage(.3, '备份并裁切工程'); const offset = (clip.source_in - clip.timeline_in) / project.fps, report = project.cut(this.sequence, clip, start + offset, end + offset); this.project = new Project(project.file); this.audio.sync(this.project); this.ranked = this.ranked.filter(r => rowClips(r, this.audio).length); result = {state: this.state(args.view), message: `已裁切 ${report.frames} 帧并留空，后续片段未移动。Kdenlive 请重新加载。`}; break;
        }
        case 'undo': this.requireProject(); result = undo(this.project.file); this.project = new Project(this.project.file); if (this.audio) { this.audio.sync(this.project); this.rerank(); } result = {state: this.state(args.view), message: '已撤销：' + result + '。Kdenlive 请重新加载。'}; break;
        case 'repair': this.requireProject(); this.project = new Project(this.project.file); result = this.project.repair(); this.project = new Project(this.project.file); if (this.audio) this.audio.sync(this.project); result = {state: this.state(args.view), message: result.changed ? `已移除 ${result.removed} 字节重复空白，已备份，可撤销。` : '没有需要修复的异常空白。'}; break;
        case 'wave': {
          const audio = args.context === 'wizard' ? this.wizard?.audio : args.context === 'calibration' ? this.calAudio : this.requireAudio(); if (!audio) throw Error('请先载入校准音源。'); const fps = this.project?.fps || 60, row = args.context === 'wizard' ? this.wizard?.rows.find(r => r.id === args.id) : args.context === 'calibration' ? null : this.row(args.id), bounds = row ? await suggest(audio, row, fps) : [parseTime(args.start, fps), parseTime(args.end, fps)];
          const a = Math.max(0, bounds[0] - .5), b = Math.min(audio.duration, bounds[1] + .5); if (!(a < b && b - a <= 12)) throw Error('请选择有效且不超过10秒的选区。'); const data = await audio.read(a, b - a), points = [], columns = Math.min(1000, data.length);
          for (let i = 0; i < columns; i++) { let min = 0, max = 0; for (let j = Math.floor(i * data.length / columns); j < Math.floor((i + 1) * data.length / columns); j++) { min = Math.min(min, data[j]); max = Math.max(max, data[j]); } points.push([min, max]); }
          result = {span: [a, b], samples: points, range: bounds, occurrences: row && args.context !== 'wizard' ? rowClips(row, audio).map(c => (c.timeline_in + frame(row.media_time, fps) - c.source_in) / fps) : []}; break;
        }
        case 'preview': {
          const audio = args.context === 'wizard' ? this.wizard?.audio : args.context === 'calibration' ? this.calibration(args.sourceId) : this.requireAudio(); if (!audio) throw Error('请先载入音源。'); let start, end;
          if (args.start !== undefined) { start = parseTime(args.start, this.project?.fps || 60); end = parseTime(args.end, this.project?.fps || 60); }
          else { const row = args.context === 'wizard' ? this.wizard?.rows.find(r => r.id === args.id) : this.row(args.id); if (!row) throw Error('请选择有效候选。'); start = row.time - (row.mode === 'mouth' ? .45 : .2); end = start + (row.mode === 'mouth' ? 1.1 : 1.5); }
          if (!(Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 10)) throw Error('试听选区无效。');
          start=Math.max(0,start);end=Math.min(audio.duration,end);if(end<=start)throw Error('试听位置超出音源。');
          const context=args.context||'track',sourceId=context==='calibration'?this.calId:context==='wizard'?this.wizard?.sourceId:null;audio.validate();
          const samples = await audio.read(start, end - start);audio.validate();
          if(context==='calibration'&&this.calAudio!==audio||context==='wizard'&&this.wizard?.audio!==audio||context==='track'&&this.audio!==audio)throw Error('试听音源已切换。');
          result = {audio: wav(samples).toString('base64'),start,end,context,sourceId}; break;
        }
        case 'calSource': {
          this.overviewController?.abort();
          if (args.file) this.calAudio = await Audio.open(args.file, null, this.cache, this.settings); else { this.requireProject(); this.calAudio = await TrackAudio.open(new Project(this.project.file), this.sequence, this.track, this.cache, this.settings); }
          this.calId=require('node:crypto').randomUUID();const first = this.calAudio.clips?.[0], start = first ? first.timeline_in / this.calAudio.project.fps : 0; result = {sourceId:this.calId,name: path.basename(this.calAudio.path), duration: this.calAudio.duration, start, end: Math.min(this.calAudio.duration, start + 1.5)}; break;
        }
        case 'trackSample':
        case 'calSave': {
          if(args.profileId&&args.profileId!==this.profile.id)throw Error('当前个人库已切换，请重新选择分组。');
          const audio=op==='trackSample'?this.requireAudio():this.calibration(args.sourceId),group = this.group(args.groupId || args.label), fps = this.project?.fps || 60, examples = await sample(audio, parseTime(args.start, fps), parseTime(args.end, fps), group, await this.model());
          const before = this.profile.examples; this.profile.examples = [...before]; try { for (const e of examples) this.profile.add(e); this.profile.save(); } catch (error) { this.profile.examples = before; throw error; } this.saveSettings(); this.rerank(); result = {state: this.state(args.view), message: `已保存 ${examples.length} 组“${group.name}”特征。`}; break;
        }
        case 'export': {
          this.requireProject(); this.requireAudio(); if (!this.ranked.some(r => r.accepted && (!args.confirmedOnly || r.confirmed))) throw Error('没有可导出的目标声音，请先校准并扫描。'); const project = new Project(this.project.file); if (!project.categories().some(c => Number(c.index) === Number(args.category))) throw Error('标记类别不存在。'); const markers = project.markers(this.sequence), occupied = new Set(markers.map(m => m.pos));
          for (const row of this.ranked.filter(r => r.accepted && (!args.confirmedOnly || r.confirmed))) if (rowClips(row, this.audio, project).length) { const pos = frame(row.time, project.fps); if (!occupied.has(pos)) { markers.push({pos, type: Number(args.category), duration: 0, comment: row.label + '｜听个响'}); occupied.add(pos); } }
          if (args.format === 'json') atomic(args.file, JSON.stringify(markers.sort((a, b) => a.pos - b.pos), null, 2));
          else { if (path.resolve(args.file) === project.file || path.dirname(path.resolve(args.file)) !== path.dirname(project.file)) throw Error('工程副本须使用同目录内的新文件名。'); project.setMarkers(this.sequence, markers.sort((a, b) => a.pos - b.pos)); atomic(args.file, project.serialize()); }
          result = {message: '已导出：' + args.file}; break;
        }
        case 'diagnostics': {
          const folder = path.join(this.data, '.diagnostics'), entries = {'runtime.json': JSON.stringify({version: VERSION, node: process.version, platform: process.platform, architecture: process.arch, project: this.project?.info(), profile: {count: this.profile.examples.length}, selected: args.id || null}, null, 2)};
          if (fs.existsSync(folder)) for (const file of fs.readdirSync(folder).filter(n => n.endsWith('.json')).sort().slice(-30)) entries['performance/' + file] = fs.readFileSync(path.join(folder, file));
          atomic(args.file, zip(entries)); result = {message: '诊断日志已导出，不包含原始音视频或样例特征。'}; break;
        }
        default: throw Error('未知操作。');
      }
      record.status = 'done'; return result;
    } catch (error) { record.status = 'error'; record.error = error.message; record.stack = error.stack; throw error; }
    finally { clearInterval(monitor); if (exclusive) this.busy = false; record.elapsed = (Date.now() - started) / 1000; atomic(logFile, JSON.stringify(record)); }
  }
}
module.exports = {Service, VERSION};
