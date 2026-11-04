'use strict';
// Exercise the shipped CMD -> GUI EXE -> hidden Node chain with a harmless
// file-writing server stub. No browser, desktop interaction, or audio output.
const fs = require('node:fs'), path = require('node:path'), {execFile} = require('node:child_process');
const root = path.resolve(__dirname, '..'), base = path.join(root, 'tests/.tmp'); fs.mkdirSync(base, {recursive:true});
const archive = process.argv.find(arg=>arg.startsWith('--zip='))?.slice(6);
const entries = archive ? require('../lib/util').unzip(fs.readFileSync(path.resolve(archive)),{maxBytes:512*1024*1024}) : null;
const folder = fs.mkdtempSync(path.join(base, '启动检查 有空格-')), ready = path.join(folder,'ready.json');
async function main() {
  fs.mkdirSync(path.join(folder,'runtime'));
  for (const file of [process.argv.includes('--legacy-cmd')?'启动助手.cmd':'start.cmd','ihearit.exe']) {
    const bytes = entries ? entries[file] || entries['ihearit/'+file] || entries['听个响/'+file] || entries['Kdenlive噪音助手JS/'+file] : fs.readFileSync(path.join(root,file));
    if(!bytes)throw Error('Missing packaged launcher: '+file);
    if(file.endsWith('.cmd')&&/(?<!\r)\n/.test(bytes.toString('utf8')))throw Error('Packaged CMD has invalid LF newlines');
    fs.writeFileSync(path.join(folder,file),bytes);
  }
  fs.copyFileSync(process.execPath,path.join(folder,'runtime/node.exe'));
  fs.writeFileSync(path.join(folder,'server.js'), `require('node:fs').writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid:process.pid,args:process.argv}));`);
  const output=await new Promise(resolve=>execFile('cmd.exe',['/d','/c',`call "${path.join(folder,process.argv.includes('--legacy-cmd')?'启动助手.cmd':'start.cmd')}"`],{cwd:folder,windowsHide:true,windowsVerbatimArguments:true,encoding:'utf8',timeout:8000},(error,stdout,stderr)=>resolve({error:error?.message,stdout,stderr})));
  for(let i=0;i<60&&!fs.existsSync(ready);i++) await new Promise(done=>setTimeout(done,50));
  const result={...output,launched:fs.existsSync(ready),folder};console.log(JSON.stringify(result,null,2));
  if(!result.launched)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
