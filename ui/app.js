'use strict';
const $ = id => document.getElementById(id), token = location.hash.slice(1);
const lifetime = new EventSource('/api/live?token=' + encodeURIComponent(token));
window.addEventListener('pagehide', () => { lifetime.close(); player.cancel(); });
let state = null, selected = null, busy = false, waveToken = 0, calReady = false;
const message = text => { $('status').textContent = text; $('status').title = text; };
let pendingConfirmation = null;
function confirmAction(text, acceptLabel = '确定') {
  if (pendingConfirmation) return Promise.resolve(false);
  player.cancel();
  $('confirmText').textContent = text; $('confirmAccept').textContent = acceptLabel;
  return new Promise(resolve => { pendingConfirmation = resolve; $('confirmDialog').showModal(); $('confirmCancel').focus(); });
}
function finishConfirmation(accepted) { const resolve = pendingConfirmation; pendingConfirmation = null; $('confirmDialog').close(); resolve?.(accepted); }
$('confirmAccept').onclick = () => finishConfirmation(true);
$('confirmCancel').onclick = () => finishConfirmation(false);
$('confirmDialog').addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
async function api(op, args = {}) {
  const response = await fetch('/api', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Noise-Token': token}, body: JSON.stringify({op, args})});
  const result = await response.json(); if (!response.ok || result.error) throw Error(result.error || '请求失败'); return result;
}
const player = new LatestPlayback(args => api('preview', args), (result,args,report) => {
  if(!Number.isFinite(result.start)||!Number.isFinite(result.end))throw Error('当前后台仍是旧版，请退出助手后重新启动新版。');
  const bytes = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0)), url = URL.createObjectURL(new Blob([bytes], {type: 'audio/wav'})), audio = new Audio(url);
  const start=result.start;let frame=null,last=0,stopped=false;
  const update=()=>report({time:start+audio.currentTime,playing:!audio.paused&&!audio.ended,ended:audio.ended,status:audio.ended?'ended':audio.paused?'paused':'playing'});
  const tick=now=>{frame=null;if(stopped||audio.paused||audio.ended)return;if(now-last>=30){last=now;update();}frame=requestAnimationFrame(tick);};
  const animate=()=>{update();if(frame===null&&!stopped)frame=requestAnimationFrame(tick);};
  audio.addEventListener('playing',animate);audio.addEventListener('timeupdate',update);audio.addEventListener('pause',update);
  audio.addEventListener('ended',()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;report({time:result.end,playing:false,ended:true,status:'ended'});});
  return {play: async()=>{await audio.play();animate();},seek:time=>{audio.currentTime=time;update();},stop:()=>{stopped=true;if(frame!==null)cancelAnimationFrame(frame);frame=null;audio.pause();audio.removeAttribute('src');URL.revokeObjectURL(url);}};
});
function drawPlayhead(ctx,width,height,span,snapshot){
  if(!snapshot||!Number.isFinite(snapshot.time))return;const raw=(snapshot.time-span[0])/(span[1]-span[0])*width,x=Math.max(1,Math.min(width-1,raw));
  ctx.save();ctx.strokeStyle=snapshot.status==='loading'?'#b48745':'#d04550';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,.5);ctx.lineTo(x,height);ctx.stroke();ctx.beginPath();ctx.moveTo(x-5,0);ctx.lineTo(x+5,0);ctx.lineTo(x,7);ctx.closePath();ctx.fill();
  const text=snapshot.time.toFixed(3)+' 秒';ctx.font='11px Segoe UI';ctx.textAlign=x>width-88?'right':'left';const tx=x>width-88?x-6:x+6,w=ctx.measureText(text).width;ctx.fillStyle='#ffffffdf';ctx.fillRect(ctx.textAlign==='right'?tx-w-3:tx-3,8,w+6,16);ctx.fillStyle='#b32f3e';ctx.fillText(text,tx,20);ctx.restore();
}
async function playMainAt(at){
  if(!selected||!mainWave.data||busy)return;const end=mainWave.data.span[1],start=Math.max(mainWave.data.span[0],Math.min(at,end-.02)),args={id:selected.id,start,end:Math.min(end,start+10)};
  try{await player.playFrom(args);}catch(error){message(error.message);}
}
async function act(op, args = {}, note = '') {
  if (busy) return null; busy = true; document.body.classList.add('busy'); player.cancel(); message(note || '正在处理…');
  if ($('nameDialog').open) $('wizardStatus').textContent = note || '正在处理…';
  if ($('libraryDialog').open) $('libraryStatus').textContent = note || '正在处理…';
  for (const control of document.querySelectorAll('button,input,select')) if (!['stop', 'quit', 'calClose', 'nameClose', 'wizardStop'].includes(control.id)) control.disabled = true;
  try { const result = await api(op, {...args, view: $('view').value}); if (result.cancelled) return null; if (result.state) applyState(result.state); else if (result.version) applyState(result); message(result.message || '已完成。'); return result; }
  catch (error) { message(error.message); if ($('calDialog').open) $('calStatus').textContent = error.message; if ($('nameDialog').open) $('wizardStatus').textContent = error.message; if ($('libraryDialog').open) $('libraryStatus').textContent = error.message; if ($('filesDialog').open) $('filesStatus').textContent = error.message; if ($('sampleDialog').open) $('sampleStatus').textContent=error.message; return null; }
  finally { busy = false; document.body.classList.remove('busy'); for (const control of document.querySelectorAll('button,input,select')) control.disabled = false; }
}
function options(select, values, current, key = 'id', label = 'name') {
  select.replaceChildren(); for (const value of values) { const option = document.createElement('option'); option.value = value[key]; option.textContent = value[label]; select.append(option); } if (current !== undefined && current !== null) select.value = String(current);
}
function tc(time) { const fps = state?.project?.fps || 60, rate = Math.ceil(fps), n = Math.floor(time * fps + .5); return [Math.floor(n / rate / 3600), Math.floor(n / rate / 60) % 60, Math.floor(n / rate) % 60, n % rate].map(n => String(n).padStart(2, '0')).join(':'); }
function seconds(value) { const fields = String(value).split(':').map(Number), fps = state?.project?.fps || 60; if (fields.some(n => !Number.isFinite(n))) return NaN; if (fields.length === 1) return fields[0]; if (fields.length === 3) return fields[0] * 3600 + fields[1] * 60 + fields[2]; if (fields.length === 4) return ((fields[0] * 3600 + fields[1] * 60 + fields[2]) * Math.ceil(fps) + fields[3]) / fps; return NaN; }
function applyState(value) {
  const previous = selected?.id; state = value;
  document.querySelector('.version').textContent='v'+value.version.replace(/-js$/,'').replace(/\.0$/,'');
  $('projectPath').textContent = value.project?.file || '尚未选择工程';
  $('projectPath').title = value.project?.file || '';
  options($('sequence'), value.project?.sequences || [], value.sequence);
  options($('track'), value.tracks.map(t => ({...t, name: `${t.name} · ${t.clips.length} 个片段`})), value.track);
  const category = $('category').value || '5'; options($('category'), (value.project?.categories || []).map(c => ({id: c.index, name: c.comment || `类别 ${Number(c.index) + 1}`})), category);
  if (!$('category').value && $('category').options.length) $('category').selectedIndex = 0;
  $('profileName').textContent = '当前库：' + value.profile.file.split(/[\\/]/).at(-1).replace(/\.json$/i, '');
  $('profileName').title = value.profile.file;
  $('profileCounts').textContent = Object.entries(value.profile.counts).map(([label, n]) => `${label} ${n} 组`).join('　') + (value.emptyProfile ? '　先添加自己的目标声和排除样例。' : '');
  $('profileCounts').title = $('profileCounts').textContent;
  renderGroups(value.profile.groups || []);
  if (value.emptyProfile && value.rows.length === 0 && value.ready && $('view').value === '推荐标记') { $('view').value = '全部'; api('state', {view: '全部'}).then(applyState).catch(e => message(e.message)); return; }
  $('count').textContent = `推荐 ${value.accepted} · 列表 ${value.total}`; $('pageInfo').textContent = value.total ? `${Math.floor(value.offset / 250) + 1} / ${Math.ceil(value.total / 250)}` : '0 / 0';
  $('pageInfo').title = value.total ? `第 ${value.offset + 1}～${Math.min(value.offset + 250, value.total)} 处，共 ${value.total} 处` : '暂无候选';
  const body = $('rows'); body.replaceChildren();
  for (const row of value.rows) {
    const tr = document.createElement('tr'); tr.dataset.id = row.id; if (row.confirmed) tr.classList.add('confirmed');
    for (const text of [tc(row.time), row.label, row.score.toFixed(3), row.confirmed ? '你已确认' : row.accepted ? '样例匹配候选' : '待校准']) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
    for (const [title, action] of [['▶ 试听', () => playRow(row)], ['标记', async () => { await selectRow(row); if (selected?.id === row.id && mainWave.data) await edit('mark'); }], ['裁切', async () => { if (selected?.id !== row.id) { await selectRow(row); if (selected?.id === row.id) message('已选中本段，请试听并调整选区，再点裁切。'); } else await edit('cut'); }], ['采样',async()=>{await selectRow(row);if(selected?.id===row.id&&mainWave.data)openTrackSample();}]]) {
      const td = document.createElement('td'), button = document.createElement('button'); button.textContent = title; button.addEventListener('click', event => { event.stopPropagation(); if (event.detail > 1 || busy) return; action(); }); td.append(button); tr.append(td);
    }
    tr.addEventListener('click', () => { if (!busy) selectRow(row); }); tr.addEventListener('dblclick', event => { if (!event.target.closest('button') && !busy) playRow(row); }); body.append(tr);
  }
  $('empty').hidden = value.rows.length > 0;
  if (!value.rows.length) { selected = null; waveToken++; player.cancel(); mainWave.data = null; mainWave.draw(); $('empty').textContent = value.ready ? '当前筛选没有结果。可切换“全部”或添加自己的校准样例。' : '选择音轨并校准声音后，开始扫描。'; }
  else { const row = value.rows.find(r => r.id === previous) || value.rows.find(r => !selected || r.time >= selected.time) || value.rows[0]; selectRow(row); }
}
async function selectRow(row) {
  if (selected?.id === row.id && mainWave.data) return;
  selected = row; player.cancel(); const current = ++waveToken; mainWave.data = null; mainWave.draw();
  for (const tr of $('rows').children) tr.classList.toggle('selected', tr.dataset.id === row.id);
  if (state.profile.groups.some(g => g.id === row.groupId && g.role === 'target')) $('actionLabel').value = row.groupId;
  try { const result = await api('wave', {id: row.id}); if (current !== waveToken || selected?.id !== row.id) return; mainWave.set(result); options($('occurrence'), result.occurrences.map((at, i) => ({id: i, name: tc(at)})), 0); }
  catch (error) { if (current === waveToken) message(error.message); }
}
async function playRow(row = selected) {
  if (!row || busy) return; if (selected?.id !== row.id) selectRow(row);
  try { message('正在准备本次试听…'); if (await player.play({id: row.id})) message('正在试听当前片段。'); } catch (error) { message(error.message); }
}
async function edit(op) { if (!selected) return message('请先选择一个片段。'); if (!mainWave.data) return message('本段波形仍在读取，请稍候。'); const at = selected.time; const result = await act(op, {id: selected.id, groupId: $('actionLabel').value, category: Number($('category').value), occurrence: Number($('occurrence').value), start: $('rangeStart').value, end: $('rangeEnd').value}); if (result?.state && op === 'cut') { const row = result.state.rows.find(r => r.time >= at); if (row) selectRow(row); } }
function renderGroups(groups) {
  const targets = groups.filter(g => g.role === 'target');
  for (const [id, values] of [['actionLabel', targets], ['calLabel', groups], ['reviewGroup', groups]]) { const current = $(id).value; options($(id), values, undefined); if (values.some(g => g.id === current)) $(id).value = current; }
  const quick = $('quickGroups'); quick.replaceChildren();
  for (const [i, g] of groups.slice(0, 3).entries()) { const b = document.createElement('button'); b.textContent = `${i + 1} ${g.name}`; b.title = g.role === 'target' ? '归入要处理的分组' : '归入排除分组'; b.classList.toggle('positive', g.role === 'target'); b.onclick = () => { if (selected) act('review', {id: selected.id, groupId: g.id}); }; quick.append(b); }
}
class Wave {
  constructor(id, startId, endId) {
    this.canvas = $(id); this.start = $(startId); this.end = $(endId); this.data = null; let anchor = null;
    this.canvas.addEventListener('pointerdown', event => { if (event.button!==0||busy || !this.data) return; anchor = {time:this.at(event),x:event.clientX,y:event.clientY,moved:false}; this.canvas.setPointerCapture(event.pointerId); });
    this.canvas.addEventListener('pointermove', event => { if (anchor === null || busy) return;if(!anchor.moved&&Math.hypot(event.clientX-anchor.x,event.clientY-anchor.y)<4)return;anchor.moved=true;const range = [anchor.time, this.at(event)].sort((a, b) => a - b); if (range[1] - range[0] < .02) return; player.cancel(); this.start.value = range[0].toFixed(3); this.end.value = range[1].toFixed(3); this.draw(); });
    this.canvas.addEventListener('pointerup', () => { const click=anchor&&!anchor.moved?anchor.time:null;anchor=null;if(click!==null)this.onSeek?.(click); });this.canvas.addEventListener('pointercancel',()=>anchor=null); this.start.addEventListener('change', () => { player.cancel(); this.draw(); }); this.end.addEventListener('change', () => { player.cancel(); this.draw(); }); new ResizeObserver(() => this.draw()).observe(this.canvas);
  }
  at(event) { const rect = this.canvas.getBoundingClientRect(), [a, b] = this.data.span; return a + Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * (b - a); }
  set(value) { this.data = value; this.start.value = value.range[0].toFixed(3); this.end.value = value.range[1].toFixed(3); this.draw(); }
  draw() {
    const canvas = this.canvas, rect = canvas.getBoundingClientRect(), width = Math.max(1, rect.width), height = Math.max(1, rect.height), ratio = window.devicePixelRatio || 1, ctx = canvas.getContext('2d'); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height); if (!this.data) return;
    const {samples, span: [a, b]} = this.data, start = seconds(this.start.value), end = seconds(this.end.value); ctx.fillStyle = '#d8eee4'; ctx.fillRect((start - a) / (b - a) * width, 0, (end - start) / (b - a) * width, height);
    let peak = .005; for (const [min, max] of samples) peak = Math.max(peak, Math.abs(min), Math.abs(max)); ctx.strokeStyle = '#3e7c91'; ctx.beginPath(); samples.forEach(([min, max], i) => { const x = i / samples.length * width; ctx.moveTo(x, height / 2 - max / peak * height * .44); ctx.lineTo(x, height / 2 - min / peak * height * .44); }); ctx.stroke();
    if(player.snapshot?.context==='track')drawPlayhead(ctx,width,height,[a,b],player.snapshot);
  }
}
const mainWave = new Wave('wave', 'rangeStart', 'rangeEnd');
mainWave.onSeek=playMainAt;player.subscribe(()=>mainWave.draw());
const pick = (kind, extra = {}) => filePicker.open(kind, extra);
$('project').onclick = () => pick('project'); $('decoder').onclick = () => pick('decoder');
$('sequence').onchange = () => act('sequence', {sequence: $('sequence').value}); $('track').onchange = () => act('setTrack', {sequence: $('sequence').value, track: $('track').value});
$('scan').onclick = () => act('scan', {force: false}, '读取工程与扫描缓存…'); $('force').onclick = () => act('scan', {force: true}, '强制重新采样…'); $('stop').onclick = () => api('cancel').then(() => message('正在停止…')).catch(e => message(e.message));
$('view').onchange = () => { if (!busy) api('state', {view: $('view').value}).then(applyState).catch(e => message(e.message)); }; $('rerank').onclick = () => act('rank', {mouth: Number($('mouth').value), long: Number($('long').value)});
$('newProfile').onclick = () => { if (!busy) openWizard(); }; $('loadProfile').onclick = () => pick('profile'); $('saveProfile').onclick = () => pick('saveProfile');
$('previous').onclick = () => api('state', {view: $('view').value, offset: Math.max(0, state.offset - 250)}).then(applyState).catch(e => message(e.message)); $('next').onclick = () => { if (state.offset + 250 < state.total) api('state', {view: $('view').value, offset: state.offset + 250}).then(applyState).catch(e => message(e.message)); };
$('mark').onclick = () => edit('mark'); $('cut').onclick = () => edit('cut'); $('undo').onclick = () => act('undo'); $('repair').onclick = () => act('repair');
$('contextPlay').onclick = event => { if (event.detail < 2) playRow(); };
$('rangePlay').onclick = async event => { if (!selected || busy || event.detail > 1) return; try { await player.play({id: selected.id, start: $('rangeStart').value, end: $('rangeEnd').value}); } catch (e) { message(e.message); } };
$('reviewAssign').onclick = () => { if (selected) act('review', {id: selected.id, groupId: $('reviewGroup').value}); };
document.addEventListener('keydown', event => { if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(event.target.tagName) || document.querySelector('dialog[open]') || busy || event.repeat) return; if (event.code === 'Space') { event.preventDefault(); playRow(); } const group = state?.profile.groups[Number(event.key) - 1]; if (selected && /^[1-3]$/.test(event.key) && group) act('review', {id: selected.id, groupId: group.id}); });
$('exportProject').onclick = () => pick('exportProject', {category: Number($('category').value), confirmedOnly: $('confirmedOnly').checked}); $('exportJson').onclick = () => pick('exportJson', {category: Number($('category').value), confirmedOnly: $('confirmedOnly').checked}); $('diagnostics').onclick = () => pick('diagnostics', {id: selected?.id});
$('quit').onclick = async () => { player.cancel(); lifetime.close(); await api('shutdown'); message('助手已退出，可以关闭此窗口。'); };
$('calibration').onclick = () => { player.cancel(); $('calDialog').showModal(); }; $('calClose').onclick = () => { if (!busy) { player.cancel();if(calNavigator.overviewLoading)api('cancelOverview').catch(()=>{}); $('calDialog').close(); } }; $('calDialog').addEventListener('cancel', event => { if (busy) event.preventDefault();else if(calNavigator.overviewLoading)api('cancelOverview').catch(()=>{}); player.cancel(); });
async function calSource(imported = false) { const result = imported ? await pick('sample') : await act('calSource'); if (!result) return; calReady = true; wizardNavigator.clear(); $('calSource').textContent = `${result.name} · ${result.duration.toFixed(3)} 秒`; await calNavigator.load(result,!imported&&selected?seconds($('rangeStart').value):result.start,!imported&&selected?seconds($('rangeEnd').value):result.end); }
async function calShow() { if(calReady)calNavigator.focusSelection(); }
$('calTrack').onclick = () => calSource(false); $('calImport').onclick = () => calSource(true); $('calWave').onclick = calShow;
$('calPlay').onclick = async event => { if (!calReady || busy || event.detail > 1) return; try { $('calStatus').textContent = '正在准备选区试听…'; await player.play({context: 'calibration', sourceId:calNavigator.source?.sourceId, start: $('calStart').value, end: $('calEnd').value}); } catch (e) { $('calStatus').textContent = e.message; } };
$('calSave').onclick = async () => { if(!calReady)return $('calStatus').textContent='请先导入声音样本。';const result = await act('calSave', {sourceId:calNavigator.source?.sourceId,start: $('calStart').value, end: $('calEnd').value, groupId: $('calLabel').value}); if (result) $('calStatus').textContent = result.message + ' 可继续拖选其他声音。'; };
document.addEventListener('click', event => { for (const menu of document.querySelectorAll('details.menu[open]')) if (!menu.contains(event.target) || event.target.closest('button')) menu.open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') for (const menu of document.querySelectorAll('details.menu[open]')) menu.open = false; });
setInterval(async () => { if (!busy) return; try { const response = await fetch('/api/status', {headers: {'X-Noise-Token': token}}), p = await response.json(), text = `${p.text}… ${Number(p.elapsed || 0).toFixed(1)} 秒`; message(text); if ($('nameDialog').open && p.op === 'wizardScan') $('wizardStatus').textContent = text; if (p.value !== null) $('progress').style.width = `${Math.max(0, Math.min(100, p.value * 100))}%`; } catch {} }, 600);
act('init').then(() => { if (state?.emptyProfile) message('欢迎使用。先新建个人库，在“声音校准 / 采样”中添加自己的声音。'); });
