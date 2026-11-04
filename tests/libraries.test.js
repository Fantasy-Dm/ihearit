'use strict';
const {test, after} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {Profile} = require('../lib/profile'), {Service} = require('../lib/service'), {rank} = require('../lib/engine'), {wav} = require('../lib/audio'), {start} = require('../server');
const root = path.resolve(__dirname, '..'), base = path.join(__dirname, '.tmp'); fs.mkdirSync(base, {recursive:true}); const folder = fs.mkdtempSync(path.join(base, 'libraries-'));
after(()=>{assert(path.resolve(folder).startsWith(path.resolve(base)+path.sep));fs.rmSync(folder,{recursive:true,force:true});});
const groups = [{id:'tick',name:'我的咔哒',role:'target',mode:'mouth'},{id:'wet',name:'保留的湿声',role:'exclude',mode:'both'}];
const vector = new Float32Array(1124); vector[0]=vector[60]=vector[100]=1;
function example(origin='a',time=1) { return {mode:'mouth',vector,origin,feature_time:time,marker_time:time}; }
test('custom groups persist, rename and role changes affect ranking without fixed labels',()=>{
  const p=new Profile();p.setGroups(groups);p.add({...example(),groupId:'tick'});const file=path.join(folder,'custom.json');p.save(file);const q=new Profile(file),row={id:'x',...example('other'),time:1,media_time:1};assert(rank([row],q)[0].accepted);q.setGroups(q.groups.map(g=>({...g,name:g.id==='tick'?'重命名后的目标':g.name})));assert.equal(rank([row],q)[0].label,'重命名后的目标');assert.equal(q.examples[0].label,'重命名后的目标');q.setGroups(q.groups.map(g=>({...g,role:'exclude'})));assert(!rank([row],q)[0].accepted);assert.throws(()=>q.setGroups([{...groups[0]},{...groups[0],id:'other'}]),/重复/);
});
test('deleting a sample removes its review override; removing a group removes its samples',()=>{
  const p=new Profile();p.setGroups(groups);const e=p.add({...example(),groupId:'tick'}),row={id:'row',...example('other'),media_time:1,time:1};const reviews={row:{groupId:'tick',sampleId:e.id}};assert(rank([row],p,reviews)[0].confirmed);p.examples=[];assert(!rank([row],p,reviews)[0].confirmed);p.add({...example(),groupId:'wet'});p.setGroups([groups[0]]);assert.equal(p.examples.length,0);assert.equal(p.groups.length,1);
});
test('old JSON is migrated with stable groups, exact vectors and an untouched backup',()=>{
  const file=path.join(folder,'old.json'),data=JSON.stringify({version:3,profile_id:'old-id',examples:[{...example(),vector:Array.from(vector),label:'啧嘴'}]});fs.writeFileSync(file,data);const p=new Profile(file),id=p.examples[0].groupId;p.save();assert.equal(fs.readFileSync(file+'.pre-v4.bak','utf8'),data);const q=new Profile(file);assert.equal(q.examples[0].groupId,id);assert.deepEqual(q.examples[0].vector,Array.from(vector));assert.equal(q.examples[0].id,p.examples[0].id);assert.equal(q.groups.length,8);
});
test('profile editor safeguards group deletion and moves samples between compatible groups',async()=>{
  const service=new Service(root,path.join(folder,'editor-data'));await service.handle('newProfile',{name:'编辑库',groups});service.profile.add({...example(),groupId:'tick'});service.profile.save();let detail=await service.handle('profileDetail');assert(!('vector' in detail.examples[0]));await assert.rejects(()=>service.handle('profileEdit',{groups:[groups[1]]}),/确认/);assert.equal(service.profile.examples.length,1);let r=await service.handle('profileEdit',{sampleId:detail.examples[0].id,groupId:'wet'});assert.equal(r.detail.examples[0].groupId,'wet');r=await service.handle('profileEdit',{groups:[groups[0]],deleteSamples:true});assert.equal(r.detail.count,0);assert.equal(r.detail.groups.length,1);
});
test('guided screening builds a custom personal library only on finish and keeps the source intact',async()=>{
  const service=new Service(root,path.join(folder,'wizard-data')),audio=path.join(folder,'wizard-voice.wav'),raw=fs.readFileSync(path.join(__dirname,'fixtures/reference-audio.f32'));fs.writeFileSync(audio,wav(new Float32Array(raw.buffer,raw.byteOffset,raw.length/4)));const original=fs.readFileSync(audio),oldId=service.profile.id;
  await service.handle('calSource',{file:audio});const draft=await service.handle('wizardScan',{name:'我的引导库',groups,start:0,end:2});assert(draft.total>0);assert.equal(service.profile.id,oldId);assert(!fs.existsSync(path.join(folder,'wizard-data/profiles/我的引导库.json')));assert(draft.rows.every(r=>!('vector' in r)));const row=draft.rows.find(r=>r.mode==='mouth');assert(row);
  let r=await service.handle('wizardAssign',{id:row.id,groupId:'tick'});assert.equal(r.assigned,1);r=await service.handle('wizardAssign',{id:row.id});assert.equal(r.assigned,0);await assert.rejects(()=>service.handle('wizardFinish'),/至少/);await service.handle('wizardAssign',{id:row.id,groupId:'tick'});r=await service.handle('wizardFinish');assert.notEqual(r.state.profile.id,oldId);assert.equal(r.state.profile.groups[0].name,'我的咔哒');assert.equal(service.profile.examples.length,1);assert(fs.readFileSync(audio).equals(original));
});
function live(app) { return new Promise((resolve,reject)=>{const request=http.get(app.origin+'/api/live?token='+app.token,res=>{res.once('data',()=>resolve({request,res}));res.on('error',()=>{});});request.on('error',reject);}); }
const wait=ms=>new Promise(done=>setTimeout(done,ms));
test('window connection survives reload and multiple windows; closing the last window exits worker',async()=>{
  const app=await start({open:false,data:path.join(folder,'lifetime-data'),graceMs:120});let stopped=false;app.worker.once('exit',()=>stopped=true);
  try { const a=await live(app),b=await live(app);a.request.destroy();await wait(180);assert(app.server.listening);b.request.destroy();await wait(40);const reloaded=await live(app);await wait(180);assert(app.server.listening);reloaded.request.destroy();for(let n=0;n<100&&!stopped;n++)await wait(20);assert(stopped,'background worker must stop after last window closes');for(let n=0;n<30&&app.server.listening;n++)await wait(20);assert(!app.server.listening); }finally{await app.close();}
});
test('window close cancels a running scan and shuts down without touching the project',async()=>{
  const app=await start({open:false,data:path.join(folder,'cancel-data'),graceMs:30});const window=await live(app);
  const rpc=async(op,args={})=>{const r=await fetch(app.origin+'/api',{method:'POST',headers:{'Content-Type':'application/json','X-Noise-Token':app.token},body:JSON.stringify({op,args})});return r.json();};
  try { const audio=path.join(folder,'long.wav');fs.writeFileSync(audio,wav(new Float32Array(16000*90)));await rpc('calSource',{file:audio});
    const scanning=rpc('wizardScan',{name:'待取消的库',groups,start:0,end:90}).catch(()=>null);let exited=false;app.worker.once('exit',()=>exited=true);window.request.destroy();for(let n=0;n<250&&!exited;n++)await wait(20);assert(exited,'in-flight scan should stop within five seconds');await scanning;assert(!fs.existsSync(path.join(folder,'cancel-data/profiles/待取消的库.json')));
  }finally{await app.close();}
});
