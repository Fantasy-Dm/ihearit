'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process');
const {atomic,json,hash}=require('./util');
const definitions={
  project:{title:'选择 Kdenlive 工程',filter:'Kdenlive 工程|*.kdenlive'},
  profile:{title:'读取个人库',filter:'个人库|*.json;*.npz'},
  sample:{title:'导入声音样本',filter:'声音样本|*.wav;*.flac;*.ogg;*.mp3;*.m4a;*.mp4;*.mkv|所有文件|*.*'},
  decoder:{title:'选择 FFmpeg 解码器',filter:'FFmpeg 解码器|ffmpeg.exe'},
  saveProfile:{title:'另存个人库',filter:'个人库|*.json',save:true,extension:'.json',name:'个人库副本.json'},
  exportProject:{title:'保存工程副本',filter:'Kdenlive 工程|*.kdenlive',save:true,extension:'.kdenlive',name:'工程副本.kdenlive'},
  exportJson:{title:'导出时间线标记',filter:'时间线标记|*.json',save:true,extension:'.json',name:'ihearit-markers.json'},
  diagnostics:{title:'导出诊断日志',filter:'诊断日志|*.zip',save:true,extension:'.zip',name:'ihearit-diagnostics.zip'}
};
function config(kind){const d=definitions[kind];if(!d)throw Error('未知文件类型。');const parts=d.filter.split('|'),filters=[];for(let i=0;i<parts.length;i+=2)filters.push({label:`${parts[i]}（${parts[i+1]}）`,patterns:parts[i+1].split(';')});return {...d,kind,filters};}
function matches(name,patterns){return patterns.some(p=>p==='*.*'||p==='*'||p.startsWith('*.')&&name.toLowerCase().endsWith(p.slice(1).toLowerCase())||p.toLowerCase()===name.toLowerCase());}
function fileError(error){if(error?.code==='ENOENT')return Error('这个位置不存在，可能已被移动或删除。');if(['EACCES','EPERM'].includes(error?.code))return Error('没有权限访问这个位置，请选择其他文件夹。');if(error?.code==='ENOTDIR')return Error('这里不是文件夹，请检查位置栏。');if(error?.code==='EEXIST')return Error('同名文件或文件夹已经存在。');return error?.code?Error('无法读取这个位置，请确认路径有效且可访问。'):error;}
function clean(value){return String(value||'').trim().replace(/^"(.*)"$/,'$1');}
class FileBrowser {
  constructor(data,{signal,locations}={}){this.data=data;this.signal=signal;this.locationOverride=locations;this.preferences=json(path.join(data,'file-browser.json'),{});this.collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});}
  async locations(){
    if(this.locationOverride)return this.locationOverride;
    this.locationsPromise ||= (async()=>{
      const home=os.homedir(),result=[{name:'主目录',directory:home}],labels=[['desktop','桌面','Desktop'],['downloads','下载','Downloads'],['documents','文档','Documents'],['pictures','图片','Pictures'],['music','音乐','Music'],['videos','视频','Videos']];let known={};
      if(process.platform==='win32'){
        const script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$shell=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';@{desktop=[Environment]::GetFolderPath('DesktopDirectory');downloads=[Environment]::ExpandEnvironmentVariables($shell.'{374DE290-123F-4565-9164-39C4925E467B}');documents=[Environment]::GetFolderPath('MyDocuments');pictures=[Environment]::GetFolderPath('MyPictures');music=[Environment]::GetFolderPath('MyMusic');videos=[Environment]::GetFolderPath('MyVideos');drives=@([IO.DriveInfo]::GetDrives()|ForEach-Object {$_.Name})}|ConvertTo-Json -Compress";
        try{known=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:8000,signal:this.signal},(error,out)=>{if(error)return reject(error);try{resolve(JSON.parse(out.replace(/^\uFEFF/,'')));}catch(e){reject(e);}}));}catch{}
      }
      for(const [key,name,folder]of labels){const directory=known[key]||path.join(home,folder);if(directory&&await fs.promises.stat(directory).then(s=>s.isDirectory(),()=>false))result.push({name,directory});}
      for(const directory of known.drives||[path.parse(home).root])result.push({name:process.platform==='win32'?`磁盘（${directory.slice(0,2)}）`:'文件系统',directory});
      return result;
    })();return this.locationsPromise;
  }
  async initial(kind){const d=config(kind),settings=json(path.join(this.data,'settings.json'),{}),locations=await this.locations();let directory=this.preferences[kind]||'',name=d.name||'';
    if(d.save&&kind==='exportProject'&&settings.project){directory=path.dirname(settings.project);name=path.basename(settings.project,path.extname(settings.project))+'-ihearit-marked.kdenlive';}
    else if(d.save&&kind==='saveProfile'&&settings.profile){directory=path.dirname(settings.profile);name=path.basename(settings.profile,path.extname(settings.profile))+'-副本.json';}
    if(!directory&&settings.project)directory=path.dirname(settings.project);
    if(!directory||!await fs.promises.stat(directory).then(s=>s.isDirectory(),()=>false))directory=locations.find(p=>p.name==='桌面')?.directory||os.homedir();
    return {directory,name};
  }
  async list(kind,args={}){
    try{
      const d=config(kind),initial=await this.initial(kind),directoryInput=clean(args.directory)||initial.directory;let directory=path.resolve(directoryInput),name=initial.name;
      const stat=await fs.promises.stat(directory);if(stat.isFile()){name=path.basename(directory);directory=path.dirname(directory);}else if(!stat.isDirectory())throw Error('请选择普通文件夹。');
      const locations=await this.locations(),filter=Number.isInteger(args.filter)&&d.filters[args.filter]?args.filter:0,query=String(args.query||'').trim().toLocaleLowerCase(),offset=Math.max(0,Math.floor(Number(args.offset)||0));
      let entries=(await fs.promises.readdir(directory,{withFileTypes:true})).filter(e=>(args.hidden||!e.name.startsWith('.'))&&(!query||e.name.toLocaleLowerCase().includes(query))&&(e.isDirectory()||e.isSymbolicLink()||matches(e.name,d.filters[filter].patterns)));
      entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||this.collator.compare(a.name,b.name));const total=entries.length;
      const page=await Promise.all(entries.slice(offset,offset+200).map(async e=>{const file=path.join(directory,e.name);try{const s=await fs.promises.stat(file);return {name:e.name,directory:s.isDirectory(),bytes:s.isFile()?s.size:0,modified:s.mtimeMs};}catch{return null;}}));
      const root=path.parse(directory).root,parts=path.relative(root,directory).split(path.sep).filter(Boolean),breadcrumbs=[];let at=root;
      const label=value=>locations.find(p=>path.resolve(p.directory).toLowerCase()===path.resolve(value).toLowerCase())?.name||path.basename(value)||value;
      breadcrumbs.push({name:label(root),directory:root});for(const part of parts){at=path.join(at,part);breadcrumbs.push({name:label(at),directory:at});}
      return {title:d.title,kind,save:Boolean(d.save),filters:d.filters,filter,directory,parent:path.dirname(directory)===directory?null:path.dirname(directory),locations,breadcrumbs,name,selectedFile:stat.isFile(),offset,total,entries:page.filter(Boolean)};
    }catch(error){throw fileError(error);}
  }
  async select(kind,args={}){
    try{
      const d=config(kind),name=clean(args.name||args.file);if(!name)throw Error('请先选择文件或输入文件名。');
      let file=path.resolve(clean(args.directory)||'.',name),stat=await fs.promises.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(stat?.isDirectory())return {navigate:file};
      if(d.save&&!path.extname(file))file+=d.extension;
      if(d.save&&(/[<>:"|?*\x00-\x1f]/.test(path.basename(file))||/[. ]$/.test(path.basename(file))||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(path.basename(file))))throw Error('文件名无效，请去掉特殊符号或使用其他名称。');
      if(!matches(path.basename(file),d.filters[Number(args.filter)||0]?.patterns||d.filters[0].patterns))throw Error('文件类型不符，请选择下方所列的文件类型。');
      stat=await fs.promises.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(!d.save){if(!stat?.isFile())throw Error('这个文件不存在，请重新选择。');}
      else{
        if(!(await fs.promises.stat(path.dirname(file))).isDirectory())throw Error('保存位置不是文件夹。');
        if(stat&&!stat.isFile())throw Error('这个位置不能保存为文件。');
        if(stat){const stamp=hash(JSON.stringify([file,stat.size,stat.mtimeMs,stat.ino]));if(!args.overwrite)return {overwrite:true,file,stamp};if(stamp!==args.stamp)throw Error('确认期间文件发生变化，请重新选择并确认覆盖。');}
      }
      return {file};
    }catch(error){throw fileError(error);}
  }
  remember(kind,file){this.preferences[kind]=path.dirname(file);try{atomic(path.join(this.data,'file-browser.json'),JSON.stringify(this.preferences));}catch{}}
  async mkdir(directory,name){
    name=clean(name);if(!name||name.length>120||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||['.','..'].includes(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('请输入有效的文件夹名称，不能包含斜杠或特殊符号。');
    try{const parent=path.resolve(directory),created=path.join(parent,name);await fs.promises.mkdir(created);return {directory:created};}catch(error){throw fileError(error);}
  }
}
module.exports={FileBrowser,definitions,config,matches};
