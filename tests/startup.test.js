'use strict';
const {test,after} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const {readForPackage} = require('../tools/windows-script');
const root=path.resolve(__dirname,'..'),base=path.join(__dirname,'.tmp');fs.mkdirSync(base,{recursive:true});const folder=fs.mkdtempSync(path.join(base,'startup-'));
after(()=>{assert(path.resolve(folder).startsWith(path.resolve(base)+path.sep));fs.rmSync(folder,{recursive:true,force:true});});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
test('Windows CMD uses CRLF locally and package normalizer repairs LF',()=>{for(const name of ['start.cmd','启动助手.cmd']){const bytes=fs.readFileSync(path.join(root,name),'utf8');assert(!/(?<!\r)\n/.test(bytes));assert(bytes.includes('ihearit.exe'));}const file=path.join(folder,'test.cmd');fs.writeFileSync(file,'@echo off\nsetlocal\n');assert.equal(readForPackage(file).toString(),'@echo off\r\nsetlocal\r\n');});
test('GUI launcher starts real backend without console, logs readiness, and exits with backend',async()=>{
  const data=path.join(folder,'启动检查 有空格'),exe=path.join(root,'ihearit.exe'),child=spawn(exe,['--no-open','--silent-errors'],{cwd:root,env:{...process.env,NOISE_DATA:data},windowsHide:true,stdio:'ignore'});let error=null;child.on('error',e=>error=e);
  try { const session=path.join(data,'session.json');for(let n=0;n<160&&!fs.existsSync(session)&&child.exitCode===null&&!error;n++)await wait(50);if(error)throw error;assert(fs.existsSync(session),'actual GUI launcher must start real server');const s=JSON.parse(fs.readFileSync(session,'utf8'));assert.equal((await fetch(s.origin+'/api/status',{headers:{'X-Noise-Token':s.token}})).status,200);
    await fetch(s.origin+'/api',{method:'POST',headers:{'Content-Type':'application/json','X-Noise-Token':s.token},body:JSON.stringify({op:'shutdown'})});for(let n=0;n<100&&child.exitCode===null;n++)await wait(30);assert.equal(child.exitCode,0);const log=fs.readFileSync(path.join(data,'startup.log'),'utf8');assert(log.includes('Starting I Hear It'));assert(log.includes('Backend exit code: 0'));assert(!log.includes(s.token));
  }finally{if(child.exitCode===null)child.kill();}
});
test('GUI launcher captures backend failure and propagates exit status without test popups',async()=>{
  const dir=path.join(folder,'失败检查');fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'runtime'));fs.copyFileSync(path.join(root,'ihearit.exe'),path.join(dir,'ihearit.exe'));fs.copyFileSync(process.execPath,path.join(dir,'runtime/node.exe'));fs.writeFileSync(path.join(dir,'server.js'),'console.error("intentional startup failure");process.exitCode=7;');
  const child=spawn(path.join(dir,'ihearit.exe'),['--silent-errors'],{cwd:dir,windowsHide:true,stdio:'ignore'});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,7);assert(fs.readFileSync(path.join(dir,'data/startup.log'),'utf8').includes('intentional startup failure'));
});
