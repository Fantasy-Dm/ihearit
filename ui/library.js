'use strict';
let wizardGroups = [], wizard = null, wizardAudioReady = false, wizardStep = 1, library = null, editGroups = [], sampleOffset = 0;
const groupModes = [{id: 'mouth', name: '短促声音'}, {id: 'respiratory', name: '较长声音'}, {id: 'both', name: '两类声音'}];
const groupRoles = [{id: 'target', name: '要处理'}, {id: 'exclude', name: '用于排除'}];
function freshGroup(groups) { let n = groups.length + 1; while (groups.some(g => g.name === '新分组' + n)) n++; return {id: crypto.randomUUID(), name: '新分组' + n, role: 'target', mode: 'mouth'}; }
function groupForm(container, groups) {
  container.replaceChildren();
  for (const g of groups) {
    const row = document.createElement('div'); row.className = 'group-form';
    const name = document.createElement('input'); name.value = g.name; name.maxLength = 40; name.placeholder = '分组名称'; name.setAttribute('aria-label', '分组名称'); name.oninput = () => g.name = name.value;
    const role = document.createElement('select'); options(role, groupRoles, g.role); role.setAttribute('aria-label', '分组用途'); role.onchange = () => g.role = role.value;
    const mode = document.createElement('select'); options(mode, groupModes, g.mode); mode.setAttribute('aria-label', '声音长度'); mode.onchange = () => g.mode = mode.value;
    const count = document.createElement('span'); count.className = 'small'; count.textContent = `${g.count || 0} 样本`;
    const remove = document.createElement('button'); remove.textContent = '删除组'; remove.className = 'quiet'; remove.onclick = () => { groups.splice(groups.indexOf(g), 1); groupForm(container, groups); };
    row.append(name, role, mode, count, remove); container.append(row);
  }
  if (!groups.length) { const p = document.createElement('p'); p.textContent = '还没有分组，请添加自己的分组。'; container.append(p); }
}
function showWizardStep(step) {
  wizardStep = step;
  for (const [i, id] of ['wizardSetup', 'wizardSourceStep', 'wizardReviewStep'].entries()) { $(id).hidden = i + 1 !== step; $('step' + (i + 1)).classList.toggle('active', i + 1 === step); }
  $('wizardHeading').textContent = ['1. 命名并设置分组', '2. 选择音源并初步筛查', '3. 试听归类，生成个人库'][step - 1];
}
function openWizard() {
  player.cancel(); wizard = null; wizardAudioReady = false; wizardNavigator.clear();
  wizardGroups = [{id: crypto.randomUUID(), name: '目标声音', role: 'target', mode: 'mouth'}, {id: crypto.randomUUID(), name: '易混淆声音', role: 'exclude', mode: 'both'}];
  $('profileInput').value = ''; $('wizardSource').textContent = '请选择音源'; $('wizardStatus').textContent = '先按自己的需求命名分组，可随时增删。';
  groupForm($('wizardGroups'), wizardGroups); showWizardStep(1); $('nameDialog').showModal();
}
async function cancelWizard() {
  if (busy) { await api('cancel'); $('wizardStatus').textContent = '正在停止筛查，完成后可以取消引导。'; return; }
  if (wizard?.assigned && !await confirmAction('取消后，本次尚未生成的采样结果将丢弃。确定取消？', '取消引导')) return;
  player.cancel(); await act('wizardCancel'); wizard = null; $('nameDialog').close();
}
$('nameClose').onclick = cancelWizard;
$('nameDialog').addEventListener('cancel', event => { event.preventDefault(); cancelWizard(); });
$('wizardAddGroup').onclick = () => { wizardGroups.push(freshGroup(wizardGroups)); groupForm($('wizardGroups'), wizardGroups); };
$('wizardPreset').onclick = async () => {
  if (wizardGroups.length && !await confirmAction('用常见口腔声分组替换当前草稿分组？', '替换分组')) return;
  wizardGroups = [['啧嘴', 'target', 'mouth'], ['清嗓', 'target', 'respiratory'], ['咳嗽', 'target', 'respiratory'], ['笑声', 'exclude', 'both'], ['口水声', 'exclude', 'mouth'], ['吸鼻声', 'exclude', 'both'], ['普通说话', 'exclude', 'both']].map(([name, role, mode]) => ({id: crypto.randomUUID(), name, role, mode}));
  groupForm($('wizardGroups'), wizardGroups);
};
$('wizardNext').onclick = () => {
  if (!$('profileInput').value.trim()) return $('wizardStatus').textContent = '请先输入个人库名称。';
  if (!wizardGroups.some(g => g.role === 'target')) return $('wizardStatus').textContent = '请至少添加一个“要处理”的分组。';
  showWizardStep(2); $('wizardStatus').textContent = '建议先筛查30～120秒，收集少量可靠样本后，可继续补充。';
};
$('nameSave').onclick = async () => { const result = await act('newProfile', {name: $('profileInput').value, groups: wizardGroups}); if (result) $('nameDialog').close(); };
$('wizardBack').onclick = () => showWizardStep(1);
async function wizardSource(imported) {
  const result = imported ? await pick('sample') : await act('calSource'); if (!result) return;
  wizardAudioReady = true; calReady = false; $('wizardSource').textContent = `${result.name} · ${result.duration.toFixed(2)} 秒`;
  calNavigator.clear();await wizardNavigator.load(result,result.start,Math.min(result.duration,result.start+60));$('wizardStatus').textContent = '点击概览换一段，或在局部波形拖选筛查区域，然后开始。';
}
$('wizardTrack').onclick = () => wizardSource(false); $('wizardImport').onclick = () => wizardSource(true);
$('wizardStop').onclick = () => api('cancel').catch(e => $('wizardStatus').textContent = e.message);
$('wizardScan').onclick = async () => {
  if (!wizardAudioReady) return $('wizardStatus').textContent = '请先从音轨取样或导入录音。';
  const result = await act('wizardScan', {sourceId:wizardNavigator.source?.sourceId,name: $('profileInput').value, groups: wizardGroups, start: $('wizardStart').value, end: $('wizardEnd').value}, '正在初步筛查…');
  if (result) { showWizardStep(3); renderWizard(result); }
};
function renderWizard(value) {
  wizard = value; $('wizardCount').textContent = `已归组 ${value.assigned} · 候选 ${value.total} · 第 ${Math.floor(value.offset / 80) + 1} 页`;
  $('wizardStatus').textContent = value.total ? '先试听，再归组；不确定的可以直接跳过。' : '这一段没有找到候选，可以换一段录音，或创建空白库后手动采样。';
  const body = $('wizardRows'); body.replaceChildren();
  for (const row of value.rows) {
    const tr = document.createElement('tr'); if (row.assigned) tr.className = 'confirmed';
    const time = document.createElement('td'); time.textContent = tc(row.time);
    const mode = document.createElement('td'); mode.textContent = row.mode === 'mouth' ? '短促声音' : '较长声音';
    const playCell = document.createElement('td'), play = document.createElement('button'); play.textContent = '▶ 试听';
    play.onclick = async event => { if (busy || event.detail > 1) return; try { $('wizardStatus').textContent = '准备试听…'; if (await player.play({context: 'wizard', id: row.id})) $('wizardStatus').textContent = '正在试听 ' + tc(row.time); } catch (e) { $('wizardStatus').textContent = e.message; } }; playCell.append(play);
    const selectCell = document.createElement('td'), select = document.createElement('select'); options(select, [{id: '', name: '选择分组…'}, ...value.groups.map(g => ({...g, name: `${g.name}（${g.role === 'target' ? '处理' : '排除'}）`}))], row.assigned); selectCell.append(select);
    const actions = document.createElement('td'), assign = document.createElement('button'), skip = document.createElement('button'); assign.textContent = row.assigned ? '更新' : '归入'; skip.textContent = row.assigned ? '撤回' : '跳过';
    assign.onclick = async () => { if (!select.value) return $('wizardStatus').textContent = '请先选择分组。'; const r = await act('wizardAssign', {id: row.id, groupId: select.value, offset: wizard.offset}); if (r) renderWizard(r); };
    skip.onclick = async () => { if (row.assigned) { const r = await act('wizardAssign', {id: row.id, offset: wizard.offset}); if (r) renderWizard(r); } else { tr.classList.add('skipped'); $('wizardStatus').textContent = '已跳过，可继续下一条；仍可返回归组。'; } };
    actions.append(assign, skip); tr.append(time, mode, playCell, selectCell, actions); body.append(tr);
  }
}
$('wizardPrev').onclick = async () => { const r = await act('wizardState', {offset: Math.max(0, wizard.offset - 80)}); if (r) renderWizard(r); };
$('wizardMore').onclick = async () => { if (wizard.offset + 80 >= wizard.total) return; const r = await act('wizardState', {offset: wizard.offset + 80}); if (r) renderWizard(r); };
$('wizardRescan').onclick = async () => { if (wizard.assigned && !await confirmAction('重新筛查会丢弃本轮归组草稿。确定继续？', '重新筛查')) return; showWizardStep(2); };
$('wizardFinish').onclick = async () => { const r = await act('wizardFinish'); if (r) { wizard = null; $('nameDialog').close(); } };
async function openLibrary() { const r = await act('profileDetail'); if (!r) return; renderLibrary(r); $('libraryDialog').showModal(); }
function groupsDirty() { return JSON.stringify(editGroups.map(({count,...g}) => g)) !== JSON.stringify(library.groups.map(({count,...g}) => g)); }
function requireSavedGroups() { if (!groupsDirty()) return true; $('libraryStatus').textContent = '请先保存分组修改，再调整样本。'; return false; }
function renderLibrary(value) {
  library = value; editGroups = value.groups.map(g => ({...g})); groupForm($('libraryGroups'), editGroups);
  const current = $('libraryFilter').value; options($('libraryFilter'), [{id: '', name: '全部分组'}, ...value.groups], current); sampleOffset = 0; renderSamples();
}
function renderSamples() {
  const rows = library.examples.filter(e => !$('libraryFilter').value || e.groupId === $('libraryFilter').value), body = $('librarySamples'); body.replaceChildren();
  $('libraryCount').textContent = `${rows.length} 个样本 · ${rows.length ? sampleOffset + 1 : 0}～${Math.min(sampleOffset + 100, rows.length)}`;
  for (const e of rows.slice(sampleOffset, sampleOffset + 100)) {
    const tr = document.createElement('tr'), name = document.createElement('td'), source = document.createElement('td'), mode = document.createElement('td'), moveCell = document.createElement('td'), removeCell = document.createElement('td');
    name.textContent = library.groups.find(g => g.id === e.groupId)?.name || '未归组'; source.textContent = `${e.source_name || '旧版样本'} · ${Number(e.marker_time || 0).toFixed(3)} 秒`; source.title = e.origin; mode.textContent = e.mode === 'mouth' ? '短促' : '较长';
    const move = document.createElement('select'); options(move, library.groups.filter(g => g.mode === 'both' || g.mode === e.mode || g.id === e.groupId), e.groupId); move.onchange = async () => { if (!requireSavedGroups()) { move.value = e.groupId; return; } const r = await act('profileEdit', {sampleId: e.id, groupId: move.value}); if (r) renderLibrary(r.detail); else move.value = e.groupId; }; moveCell.append(move);
    const remove = document.createElement('button'); remove.textContent = '删除样本'; remove.onclick = async () => { if (!requireSavedGroups() || !await confirmAction('从个人库删除这个样本？原录音不会被修改。', '删除样本')) return; const r = await act('profileEdit', {deleteSample: e.id}); if (r) renderLibrary(r.detail); }; removeCell.append(remove);
    tr.append(name, source, mode, moveCell, removeCell); body.append(tr);
  }
}
$('manageProfile').onclick = openLibrary; $('calManage').onclick = openLibrary;
async function closeLibrary() { if (busy || groupsDirty() && !await confirmAction('分组修改尚未保存，确定放弃修改？', '放弃修改')) return false; $('libraryDialog').close(); return true; }
$('libraryClose').onclick = closeLibrary;
$('libraryDialog').addEventListener('cancel', event => { event.preventDefault(); closeLibrary(); });
$('libraryAddGroup').onclick = () => { editGroups.push(freshGroup(editGroups)); groupForm($('libraryGroups'), editGroups); };
$('librarySaveGroups').onclick = async () => {
  const n = library.examples.filter(e => !editGroups.some(g => g.id === e.groupId)).length;
  if (n && !await confirmAction(`将删除分组及其 ${n} 个样本，确定保存？`, '删除并保存')) return;
  const r = await act('profileEdit', {groups: editGroups, deleteSamples: Boolean(n)}); if (r) { renderLibrary(r.detail); $('libraryStatus').textContent = r.message; }
};
$('libraryFilter').onchange = () => { sampleOffset = 0; renderSamples(); };
$('libraryPrevSamples').onclick = () => { sampleOffset = Math.max(0, sampleOffset - 100); renderSamples(); };
$('libraryMoreSamples').onclick = () => { const n = library.examples.filter(e => !$('libraryFilter').value || e.groupId === $('libraryFilter').value).length; if (sampleOffset + 100 < n) sampleOffset += 100; renderSamples(); };
$('libraryAddSample').onclick = () => { if (!requireSavedGroups()) return; $('libraryDialog').close(); if (!$('calDialog').open) $('calDialog').showModal(); };
