'use strict';
// Isolated headless rendering only. No desktop window, user profile, mouse,
// keyboard or audio device is touched. Uses Node built-ins and installed Edge.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..'), tempBase = path.join(root, 'tests/.tmp'); fs.mkdirSync(tempBase, {recursive: true});
const temp = fs.mkdtempSync(path.join(tempBase, 'layout-'));
const fixture = {version:'3.1.0-js',profile:{file:'D:/录音工具/data/profiles/我的麦克风和录音环境样例库.json',count:27,counts:{啧嘴:8,清嗓:1,咳嗽:0,笑声:12,口水声:1,吸鼻声:5}},project:{file:'D:/录音工程/播客录制/很长的工程目录与文件名/第四十五期节目剪辑.kdenlive',fps:60,sequences:[{id:'seq',name:'序列 1'}],categories:[{index:5,comment:'类别 6'}]},sequence:'seq',track:'a3',tracks:[{id:'a3',name:'A3 · 主讲声音轨',clips:Array(42).fill({})}],duration:9000,scanned:true,ready:true,total:4917,accepted:1526,offset:0,view:'推荐标记',emptyProfile:false,rows:Array.from({length:250},(_,i)=>({id:'m'+i,time:1.2+i*2,label:i%4?'啧嘴':'清嗓',mode:i%4?'mouth':'respiratory',score:.92,confirmed:i%7===0,accepted:true}))};
fixture.version = require('../package.json').version + '-js';
fixture.profile.groups = Object.entries(fixture.profile.counts).map(([name,count],i)=>({id:'g'+i,name,count,role:i<3?'target':'exclude',mode:i===0?'mouth':'both'}));
fixture.rows.forEach(r=>r.groupId=r.mode==='mouth'?'g0':'g1');
const files = {'/':'index.html','/app.js':'app.js','/library.js':'library.js','/files.js':'files.js','/sampling.js':'sampling.js','/style.css':'style.css','/library.css':'library.css','/files.css':'files.css','/sampling.css':'sampling.css','/player.js':'player.js'};
let previewRequests=0;
let lastPreviewArgs=null;
let draft=null, examples=[];
let saveRequests=0;
let trackSampleArgs=null,calSampleArgs=null;
const detail=()=>({...fixture.profile,examples});
const server = http.createServer(async(req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  if(route==='/api/live'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: ready\n\n');return;}
  if(req.method==='GET'&&files[route]){res.setHeader('Content-Type',route.endsWith('.css')?'text/css':route.endsWith('.js')?'application/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'ui',files[route])));return;}
  let text='';for await(const part of req)text+=part;const request=JSON.parse(text||'{}');if(request.op==='preview')previewRequests++;res.setHeader('Content-Type','application/json');
  let result=fixture;
  if(request.op==='preview'){lastPreviewArgs=request.args;const a=request.args,start=a.start===undefined?Math.max(0,(fixture.rows.find(r=>r.id===a.id)?.time||1)-.45):Number(a.start),end=a.end===undefined?start+1.1:Number(a.end);result={audio:'UklGRg==',start,end,context:a.context||'track',sourceId:a.context?'cal-test':null};}
  if(request.op==='files:list'){
    const c=require('../lib/file-browser').config(request.args.kind),directory=request.args.directory||'D:/界面测试';
    result={...c,save:Boolean(c.save),directory,parent:'D:/',filter:0,offset:0,total:3,name:c.name||'',locations:[{name:'桌面',directory:'D:/界面测试'},{name:'下载',directory:'D:/下载'},{name:'文档',directory:'D:/文档'},{name:'音乐',directory:'D:/音乐'},{name:'视频',directory:'D:/视频'},{name:'磁盘（D:）',directory:'D:/'}],breadcrumbs:[{name:'磁盘（D:）',directory:'D:/'},{name:'桌面',directory}],entries:[{name:'子目录',directory:true,bytes:0,modified:1700000000000},{name:c.save?'已存在.json':'录音工程.kdenlive',directory:false,bytes:2048,modified:1700000000000},{name:c.save?'另一个标记.json':'第二期工程.kdenlive',directory:false,bytes:4096,modified:1700000000000}]};
  }
  if(request.op==='files:select'){const c=require('../lib/file-browser').config(request.args.kind),name=request.args.name||'',file=request.args.directory+'/'+name+(c.save&&!name.includes('.')?c.extension:'');result=name==='子目录'?{navigate:file}:c.save&&name==='已存在.json'&&!request.args.overwrite?{overwrite:true,stamp:'test-stamp',file}:{file};}
  if(request.op==='pick'){if(request.args.kind==='exportJson'){saveRequests++;result={message:'已导出测试文件'};}else if(request.args.kind==='sample')result={sourceId:'cal-test',name:'测试录音.wav',duration:60,start:0,end:1.5};}
  if(request.op==='viewWave'||request.op==='overview')result={sourceId:'cal-test',span:request.op==='overview'?[0,60]:[request.args.start,request.args.end],samples:Array.from({length:700},(_,i)=>[-Math.abs(Math.sin(i*.15))*.3,Math.abs(Math.sin(i*.15))*.3])};
  if(request.op==='trackSample'){trackSampleArgs=request.args;result={state:fixture,message:'已保存选区样本'};}
  if(request.op==='calSave'){calSampleArgs=request.args;result={state:fixture,message:'已保存选区样本'};}
  if(request.op==='wave')result={range:[1.15,1.35],span:[.65,1.85],samples:Array.from({length:500},(_,i)=>[-Math.abs(Math.sin(i*.15))*.3,Math.abs(Math.sin(i*.15))*.3]),occurrences:[1.2]};
  if(request.op==='calSource')result={sourceId:'cal-test',name:'界面测试用录音.wav',duration:60,start:0,end:1.5};
  if(request.op==='wizardScan'){draft={wizard:true,offset:0,total:3,assigned:0,groups:request.args.groups,rows:[{id:'w1',time:1.2,mode:'mouth',assigned:''},{id:'w2',time:2.4,mode:'respiratory',assigned:''},{id:'w3',time:3.6,mode:'mouth',assigned:''}]};result=draft;}
  if(request.op==='wizardAssign'){draft.rows.find(r=>r.id===request.args.id).assigned=request.args.groupId||'';draft.assigned=draft.rows.filter(r=>r.assigned).length;result=draft;}
  if(request.op==='wizardFinish'){fixture.profile.groups=draft.groups.map(g=>({...g,count:draft.rows.filter(r=>r.assigned===g.id).length}));fixture.profile.counts=Object.fromEntries(fixture.profile.groups.map(g=>[g.name,g.count]));fixture.rows.forEach(r=>{r.groupId=fixture.profile.groups[0].id;r.label=fixture.profile.groups[0].name;});examples=[{id:'e1',groupId:fixture.profile.groups[0].id,source_name:'界面测试用录音.wav',marker_time:1.2,mode:'mouth'}];result={state:fixture};}
  if(request.op==='profileDetail')result=detail();
  if(request.op==='profileEdit'){if(request.args.groups)fixture.profile.groups=request.args.groups;fixture.profile.counts=Object.fromEntries(fixture.profile.groups.map(g=>[g.name,g.count||0]));fixture.rows.forEach(r=>r.label=fixture.profile.groups.find(g=>g.id===r.groupId)?.name||'待校准');result={state:fixture,detail:detail()};}
  res.end(JSON.stringify(result));
});
function wait(ms){return new Promise(done=>setTimeout(done,ms));}
async function main(){
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${server.address().port}/#layout-test`;
  const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);if(!edge)throw Error('Headless layout test requires installed Edge.');
  const child=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${temp}`,'about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let socket,send;const pending=new Map();let id=0;const exceptions=[];
  try{
    const endpoint=await new Promise((resolve,reject)=>{let text='';let polling;const done=value=>{clearTimeout(timer);clearInterval(polling);resolve(value);};const timer=setTimeout(()=>{clearInterval(polling);reject(Error('Headless Edge startup timeout'));},15000);const read=part=>{text+=part;const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)done(match[1]);};child.stderr.on('data',read);child.stdout.on('data',read);child.on('error',reject);polling=setInterval(()=>{try{const [port,route]=fs.readFileSync(path.join(temp,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);if(/^\d+$/.test(port)&&route.startsWith('/devtools/browser/'))done('ws://127.0.0.1:'+port+route);}catch{}},50);});
    socket=new WebSocket(endpoint);await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);});
    send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
    const target=await send('Target.createTarget',{url:'about:blank'}),session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
    await send('Runtime.enable',{},session);await send('Page.enable',{},session);
    // Test playback UI without creating a media element or using any audio device.
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`class SilentAudio extends EventTarget {constructor(url){super();this.src=url;this.paused=true;this.ended=false;this._time=0;this._since=performance.now();window.__silentAudio=this;}get currentTime(){return this._time+(this.paused?0:(performance.now()-this._since)/1000);}set currentTime(time){this._time=time;this._since=performance.now();this.ended=false;this.dispatchEvent(new Event('timeupdate'));}play(){this._time=this.currentTime;this._since=performance.now();this.paused=false;this.ended=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}pause(){this._time=this.currentTime;this.paused=true;this.dispatchEvent(new Event('pause'));}removeAttribute(name){if(name==='src')this.src='';}finish(){this.paused=true;this.ended=true;this.dispatchEvent(new Event('ended'));}}window.Audio=SilentAudio;`},session);
    const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
    const results=[];
    for(const [width,height]of[[1920,1080],[1366,768],[1280,720],[1120,700],[1024,640],[980,600],[900,540]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);await send('Page.navigate',{url},session);
      let ready=false;for(let tries=0;tries<100;tries++){await wait(40);ready=await evaluate(`document.readyState==='complete'&&document.getElementById('rows')?.children.length===250&&!document.body.classList.contains('busy')`);if(ready)break;}if(!ready)throw Error('UI startup failed '+width+'x'+height);
      await wait(100);
      const data=await evaluate(`(()=>{const ids=['project','scan','force','stop','newProfile','loadProfile','saveProfile','manageProfile','calibration','rerank','previous','next','actionLabel','rangeStart','rangeEnd','occurrence','contextPlay','reviewGroup','reviewAssign','rangePlay','mark','cut','undo','confirmedOnly','exportProject','exportJson'];ids.push("saveSample");const controls=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}});const t=document.querySelector('.table-wrap');return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,listHeight:t.clientHeight,listScrollHeight:t.scrollHeight,controls,clippedActions:[...document.querySelectorAll('#rows button')].filter(b=>{const r=b.getBoundingClientRect(),p=b.parentElement.getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1}).length,bodyOverflow:getComputedStyle(document.body).overflow}})()`);
      const bad=data.controls.filter(r=>r.left<-.5||r.top<-.5||r.right>width+.5||r.bottom>height+.5||r.width<12||r.height<(r.id==='confirmedOnly'?10:20));
      if(data.scrollHeight>height+1||data.scrollWidth>width+1||bad.length||data.clippedActions||data.listHeight<55||data.listScrollHeight<=data.listHeight)throw Error('Layout overflow '+JSON.stringify({...data,bad}));
      results.push({viewport:width+'x'+height,pageScroll:false,listHeight:data.listHeight,visibleControls:data.controls.length});
      if(width===1120){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);const output=path.join(root,'dist','UI-v4.0-1120x700.png');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,Buffer.from(shot.data,'base64'));}
    }
    await evaluate(`document.querySelector('.tools-menu').open=true`);const menu=await evaluate(`(()=>{const r=document.querySelector('.tools-menu .menu-panel').getBoundingClientRect();return{right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight}})()`);if(menu.right>menu.w||menu.bottom>menu.h)throw Error('Tool menu overflows');
    await evaluate(`document.querySelector('.tools-menu summary').focus();document.querySelector('.tools-menu summary').dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}))`);await wait(100);if(previewRequests)throw Error('Space on menu triggered audio preview');
    await send('Emulation.setDeviceMetricsOverride',{width:1120,height:700,deviceScaleFactor:1,mobile:false},session);
    await evaluate(`{document.querySelector('.tools-menu').open=false;$('newProfile').click();$('profileInput').value='界面验证库';const input=$('wizardGroups').querySelector('input');input.value='我的轻咔哒';input.dispatchEvent(new Event('input'));$('wizardNext').click();$('wizardTrack').click()}`);await wait(120);
    await evaluate(`$('wizardScan').click()`);await wait(120);
    if(!await evaluate(`!$('wizardReviewStep').hidden&&$('wizardRows').children.length===3`))throw Error('Wizard screening UI did not advance');
    let shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);fs.writeFileSync(path.join(root,'dist/UI-v4.0-引导采样.png'),Buffer.from(shot.data,'base64'));
    await evaluate(`const select=$('wizardRows').querySelector('select');select.selectedIndex=1;$('wizardRows').querySelector('td:last-child button').click()`);await wait(100);
    if(!await evaluate(`$('wizardCount').textContent.includes('已归组 1')`))throw Error('Wizard assignment UI not updated');
    await evaluate(`$('wizardFinish').click()`);await wait(100);
    if(!await evaluate(`!$('nameDialog').open&&$('reviewGroup').options[0].textContent==='我的轻咔哒'&&$('actionLabel').options.length===1`))throw Error('Library groups did not replace fixed UI labels');
    await evaluate(`$('manageProfile').click()`);await wait(100);
    if(!await evaluate(`$('libraryDialog').open&&$('librarySamples').children.length===1`))throw Error('Library editor did not load');
    await evaluate(`{const input=$('libraryGroups').querySelector('input');input.value='改名后的咔哒';input.dispatchEvent(new Event('input'));$('librarySaveGroups').click()}`);await wait(100);
    if(!await evaluate(`$('reviewGroup').options[0].textContent==='改名后的咔哒'&&$('librarySamples').querySelector('td').textContent==='改名后的咔哒'`))throw Error('Group rename not reflected in UI');
    shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);fs.writeFileSync(path.join(root,'dist/UI-v4.0-编辑库.png'),Buffer.from(shot.data,'base64'));
    await evaluate(`$('libraryClose').click()`);
    await evaluate(`window.confirmResult=null;void confirmAction('从个人库删除这个样本？原录音不会被修改。','删除样本').then(value=>window.confirmResult=value)`);
    if(!await evaluate(`$('confirmDialog').open&&$('confirmCancel').textContent==='取消'&&$('confirmAccept').textContent==='删除样本'&&document.activeElement.id==='confirmCancel'`))throw Error('Chinese confirmation labels or safe default focus incorrect');
    shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);fs.writeFileSync(path.join(root,'dist/UI-v4.0.3-中文确认.png'),Buffer.from(shot.data,'base64'));
    await evaluate(`$('confirmCancel').click()`);
    if(!await evaluate(`window.confirmResult===false&&!$('confirmDialog').open`))throw Error('Cancel confirmation must resolve false');
    await evaluate(`window.confirmResult=null;confirmAction('是否确认本次操作？').then(value=>window.confirmResult=value);$('confirmAccept').click()`);
    if(!await evaluate(`window.confirmResult===true&&!$('confirmDialog').open`))throw Error('Accept confirmation must resolve true');
    await evaluate(`window.confirmResult=null;confirmAction('按 Esc 应取消。').then(value=>window.confirmResult=value);$('confirmDialog').dispatchEvent(new Event('cancel',{cancelable:true}))`);
    if(!await evaluate(`window.confirmResult===false&&!$('confirmDialog').open`))throw Error('Escape confirmation must resolve false');
    await evaluate(`$('project').click()`);await wait(140);
    if(!await evaluate(`$('filesDialog').open&&$('filesRows').children.length===3&&$('filesAccept').textContent==='打开'&&$('filesCancel').textContent==='取消'&&$('filesLocations').textContent.includes('视频')`))throw Error('Chinese file picker did not load');
    for(const [width,height]of[[1120,700],[900,540]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);await wait(50);
      const fits=await evaluate(`(()=>{const ids=['filesClose','filesPath','filesGo','filesUp','filesAccept','filesCancel','filesName','filesType','filesNewFolder'];return ids.every(id=>{const r=$(id).getBoundingClientRect();return r.width>20&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})&&document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1})()`);if(!fits)throw Error('File dialog controls overflow '+width+'x'+height);
      if(width===1120){shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);fs.writeFileSync(path.join(root,'dist/UI-v4.1-中文文件窗口.png'),Buffer.from(shot.data,'base64'));}
    }
    await evaluate(`$('filesRows').querySelector('tr').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);await wait(100);
    if(!await evaluate(`$('filesPath').value.endsWith('子目录')`))throw Error('Folder double click did not navigate');
    await evaluate(`$('filesName').value='录音工程.kdenlive';$('filesAccept').click()`);await wait(150);
    if(!await evaluate(`!$('filesDialog').open`))throw Error('Choosing a project did not close picker');
    await evaluate(`$('exportJson').click()`);await wait(100);
    if(!await evaluate(`$('filesAccept').textContent==='保存'&&$('filesDialog').open`))throw Error('Save picker did not use Chinese save action');
    await evaluate(`$('filesName').value='自定义标记.json';$('filesName').dispatchEvent(new Event('input'));$('filesRows').querySelector('tr').click();$('filesAccept').click()`);await wait(100);
    if(!await evaluate(`$('filesPath').value.endsWith('子目录')&&$('filesName').value==='自定义标记.json'`))throw Error('Entering a save folder must preserve typed filename');
    await evaluate(`$('filesName').value='已存在.json';$('filesAccept').click()`);await wait(100);
    if(!await evaluate(`$('confirmDialog').open&&$('confirmAccept').textContent==='覆盖文件'`))throw Error('Overwrite approval not shown');
    await evaluate(`$('confirmCancel').click()`);await wait(50);if(saveRequests)throw Error('Cancel overwrite must never export');
    if(!await evaluate(`$('filesDialog').open&&!$('confirmDialog').open`))throw Error('Cancel overwrite must keep file picker');
    await evaluate(`$('filesAccept').click()`);await wait(100);await evaluate(`$('confirmAccept').click()`);await wait(120);
    if(saveRequests!==1||!await evaluate(`!$('filesDialog').open`))throw Error('Confirmed save did not export exactly once');
    await evaluate(`$('saveSample').click()`);
    if(!await evaluate(`$('sampleDialog').open&&$('sampleGroup').options.length===state.profile.groups.length`))throw Error('Main save sample dialog did not use current library groups');
    const originalRange=await evaluate(`[$('rangeStart').value,$('rangeEnd').value]`);
    await evaluate(`$('sampleGroup').selectedIndex=1;$('sampleSave').click()`);await wait(100);
    if(!trackSampleArgs||trackSampleArgs.groupId!==fixture.profile.groups[1].id||trackSampleArgs.start!==originalRange[0]||trackSampleArgs.end!==originalRange[1]||!await evaluate(`!$('sampleDialog').open`))throw Error('Main sample button did not save exact range to selected group');
    await send('Emulation.setDeviceMetricsOverride',{width:1120,height:700,deviceScaleFactor:1,mobile:false},session);
    await evaluate(`$('calibration').click();$('calTrack').click()`);await wait(150);
    if(!await evaluate(`!!calNavigator.data&&!!calNavigator.overviewData&&!$('calStart').closest('details').open`))throw Error('Dual waveform sampler did not load, or numeric editor is not collapsed');
    for(const [width,height]of[[1120,700],[900,540]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);await wait(60);
      const fits=await evaluate(`['calClose','calImport','calOverview','calCanvas','calZoomIn','calZoomOut','calPosition','calSave','calPlay'].every(id=>{const r=$(id).getBoundingClientRect();return r.width>20&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})`);if(!fits)throw Error('Sampler controls overflow '+width+'x'+height);
    }
    const rect=async id=>evaluate(`(()=>{const r=$('${id}').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const drag=async(from,to,modifiers=0)=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',clickCount:1,modifiers},session);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:to.x,y:to.y,buttons:1,modifiers},session);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',clickCount:1,modifiers},session);};
    const click=point=>drag(point,point);
    const overviewSelection=await evaluate(`[$('calStart').value,$('calEnd').value]`);let r=await rect('calOverview');await drag({x:r.x+r.width*.75,y:r.y+r.height/2},{x:r.x+r.width*.75,y:r.y+r.height/2});await wait(130);
    if(!await evaluate(`calNavigator.view[0]>30`))throw Error('Overview click did not navigate to another region');
    if(JSON.stringify(overviewSelection)!==JSON.stringify(await evaluate(`[$('calStart').value,$('calEnd').value]`)))throw Error('Overview single click changed sample range');
    const previewsBeforeDrag=previewRequests;
    r=await rect('calCanvas');await drag({x:r.x+r.width*.25,y:r.y+r.height/2},{x:r.x+r.width*.35,y:r.y+r.height/2});
    if(!await evaluate(`Number($('calStart').value)>35&&Number($('calEnd').value)>Number($('calStart').value)`))throw Error('Dragging detail waveform did not select new audio region');
    if(previewRequests!==previewsBeforeDrag)throw Error('Dragging a selection must not trigger click playback');
    const beforeZoom=await evaluate(`calNavigator.view[1]-calNavigator.view[0]`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:r.x+r.width*.5,y:r.y+r.height/2,deltaX:0,deltaY:-120},session);await wait(130);
    if(!await evaluate(`calNavigator.view[1]-calNavigator.view[0]<${beforeZoom}`))throw Error('Mouse wheel did not zoom sampler');
    const beforePan=await evaluate(`calNavigator.view[0]`);await drag({x:r.x+r.width*.7,y:r.y+r.height/2},{x:r.x+r.width*.5,y:r.y+r.height/2},8);await wait(130);
    if(!await evaluate(`calNavigator.view[0]>${beforePan}`))throw Error('Shift drag did not pan sampler');
    await evaluate(`$('calFocus').click()`);await wait(120);
    await send('Emulation.setDeviceMetricsOverride',{width:1120,height:700,deviceScaleFactor:1,mobile:false},session);await wait(60);
    const unchanged=await evaluate(`[$('calStart').value,$('calEnd').value]`);r=await rect('calCanvas');
    await click({x:r.x+r.width*.5,y:r.y+r.height*.6});await wait(180);
    if(!await evaluate(`player.snapshot?.context==='calibration'&&player.snapshot.playing&&player.snapshot.time>player.snapshot.start+.07`))throw Error('Click playback did not advance cursor using player clock');
    const afterClick=await evaluate(`[$('calStart').value,$('calEnd').value]`);if(JSON.stringify(afterClick)!==JSON.stringify(unchanged))throw Error('Single click changed sample selection');
    const buffered=previewRequests;await click({x:r.x+r.width*.55,y:r.y+r.height*.6});await wait(90);if(previewRequests!==buffered)throw Error('Click within loaded preview should seek without another decoding request');
    if(!await evaluate(`(()=>{const s=player.snapshot,c=calNavigator.detail,x=Math.round((s.time-calNavigator.view[0])/(calNavigator.view[1]-calNavigator.view[0])*c.width),g=c.getContext('2d');for(let d=-2;d<=2;d++){const p=g.getImageData(Math.max(0,Math.min(c.width-1,x+d)),35,1,1).data;if(p[0]>150&&p[0]>p[1]*1.4&&p[0]>p[2]*1.2)return true;}return false})()`))throw Error('Playback cursor was not drawn on detail waveform');
    shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);fs.writeFileSync(path.join(root,'dist/UI-ihearit.png'),Buffer.from(shot.data,'base64'));
    await evaluate(`window.__silentAudio.finish()`);if(!await evaluate(`player.snapshot.ended&&player.snapshot.time===player.snapshot.end`))throw Error('End of playback did not retain final cursor position');
    await evaluate(`player.cancel();calNavigator.setView(calNavigator.selection[0],calNavigator.selection[0]+.12,false,false)`);
    r=await rect('calCanvas');await click({x:r.x+r.width*.1,y:r.y+r.height*.6});await wait(250);
    if(!await evaluate(`calNavigator.view[0]>calNavigator.selection[0]`))throw Error('Narrow waveform viewport did not follow playback cursor');
    await evaluate(`player.cancel();$('calFocus').click()`);await wait(120);
    shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);fs.writeFileSync(path.join(root,'dist/UI-v4.2-双层采样.png'),Buffer.from(shot.data,'base64'));
    const selection=await evaluate(`[$('calStart').value,$('calEnd').value]`);await evaluate(`$('calSave').click()`);await wait(100);
    if(!calSampleArgs||calSampleArgs.start!==selection[0]||calSampleArgs.end!==selection[1]||calSampleArgs.sourceId!=='cal-test')throw Error('Sampler save did not use dragged selection and source identity');
    await evaluate(`$('calClose').click()`);
    r=await rect('wave');const mainRange=await evaluate(`[$('rangeStart').value,$('rangeEnd').value]`);await click({x:r.x+r.width*.5,y:r.y+r.height*.5});await wait(130);
    if(!await evaluate(`player.snapshot?.context==='track'&&player.snapshot.time>player.snapshot.start`))throw Error('Main waveform did not support click playback');
    if(JSON.stringify(mainRange)!==JSON.stringify(await evaluate(`[$('rangeStart').value,$('rangeEnd').value]`)))throw Error('Clicking main waveform changed cut selection');
    await evaluate(`player.cancel()`);
    if(exceptions.length)throw Error('Browser runtime error '+JSON.stringify(exceptions));
    console.log(JSON.stringify({headless:true,results,errors:exceptions.length},null,2));
    fs.writeFileSync(path.join(root,'dist/layout-v4.0.json'),JSON.stringify(results,null,2));await send('Browser.close');
  }finally{if(send&&socket?.readyState===WebSocket.OPEN)await Promise.race([send('Browser.close').catch(()=>{}),wait(500)]);socket?.close();if(child.exitCode===null)child.kill();await new Promise(done=>server.close(done));await wait(500);const resolved=path.resolve(temp);if(!resolved.startsWith(path.resolve(tempBase)+path.sep)||!path.basename(resolved).startsWith('layout-'))throw Error('Invalid test cleanup path');try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{}}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
