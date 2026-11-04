'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {zip,unzip,hash}=require('../lib/util'),{readForPackage}=require('./windows-script');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist'),version=require('../package.json').version;
execFileSync(process.execPath,[path.join(__dirname,'compile-launcher.js')],{cwd:root,windowsHide:true,stdio:'pipe'});
const files=['server.js','worker.js','start.cmd','start.vbs','启动助手.cmd','启动助手.vbs','ihearit.exe','ui/index.html','ui/style.css','ui/library.css','ui/files.css','ui/sampling.css','ui/app.js','ui/player.js','ui/library.js','ui/files.js','ui/sampling.js','lib/profile.js','lib/project.js','lib/service.js','lib/engine.js','lib/audio.js','lib/file-browser.js','lib/waveform.js','package.json','package-lock.json','README.md','CHANGELOG.md','LICENSE','THIRD_PARTY_NOTICES.md','licenses/ONNX-Runtime-LICENSE.txt','licenses/ONNX-Runtime-ThirdPartyNotices.txt','models/NOTICE.md','models/LICENSE','models/UPSTREAM-MODEL-CARD.md','models/yamnet.onnx'];
const entries=Object.fromEntries(files.map(name=>[name,readForPackage(path.join(root,name))]));
entries['UPGRADE.txt']=Buffer.from(`听个响 · I Hear It v${version} 升级补丁（原 Kdenlive 噪音助手 JS，适用于 JS v3.0～v4.3.1）

中文名「听个响」，正式英文名「I Hear It」，副标题「你继续，俺在听」。
开发标识统一为 ihearit；主启动器 ihearit.exe，英文启动脚本 start.cmd。
统一主界面、窗口标题、启动器、后续新增标记署名、默认导出文件名与发布包名称。
README 开头采用确认过的新版介绍，首先说明当前需要配合 Kdenlive 工程使用。
保留播放进度线、波形点播、自定义分组、引导式采样、库编辑和留空裁切等已有功能。

1. 先在正在使用的旧助手内点击“工具与设置 → 退出助手”（新版为“退出听个响”）。
2. 将补丁内容覆盖到实际启动的程序目录，即 server.js 所在文件夹，保留 lib 和 ui 结构。
3. 保留 data、profiles、runtime、模型和原有缓存。双击“ihearit.exe”或“start.cmd”；“启动助手.cmd”仍可使用。
4. 确认界面显示「听个响」、副标题「你继续，俺在听」及 v${version}。

外层文件夹不必改名。统一使用 ihearit.exe；如已有旧名称的 EXE，可移出目录并更新快捷方式。
没有新增 npm 依赖，无需重新采样；不覆盖个人库、缓存、原始录音或工程文件。
已有工程标记不会因为改名而重写。更新记录与使用方法见 README.md 和 CHANGELOG.md。
`.replace(/\r?\n/g,'\r\n'));
entries['PATCH-MANIFEST.json']=Buffer.from(JSON.stringify({id:'ihearit',name:'听个响',englishName:'I Hear It',subtitle:'你继续，俺在听',version:version+'-js',base:['3.0.0-js','3.1.0-js','4.0.0-js','4.0.1-js','4.0.2-js','4.0.3-js','4.1.0-js','4.2.0-js','4.3.0-js','4.3.1-js'],files:Object.fromEntries(files.map(name=>[name,hash(entries[name])]))},null,2));
const bytes=zip(entries);unzip(bytes);fs.mkdirSync(dist,{recursive:true});const file=path.join(dist,`ihearit-v${version}-patch.zip`);fs.writeFileSync(file,bytes);console.log(file,bytes.length,'bytes',Object.keys(entries).length,'files');
