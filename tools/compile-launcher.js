'use strict';
const path = require('node:path'), fs = require('node:fs'), {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..'), compiler = ['Framework64', 'Framework'].map(f => path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET', f, 'v4.0.30319/csc.exe')).find(fs.existsSync);
if (!compiler) throw Error('构建启动器需要 Windows 自带的 .NET C# 编译器。');
const version = require('../package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('启动器版本需要三段数字。');
const base = path.join(root, 'tests/.tmp'); fs.mkdirSync(base, {recursive: true});
const temporary = fs.mkdtempSync(path.join(base, 'launcher-')), info = path.join(temporary, 'version.cs');
try {
  fs.writeFileSync(info, `using System.Reflection;\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n`);
  execFileSync(compiler, ['/nologo', '/target:winexe', '/optimize+', '/r:System.Windows.Forms.dll', '/out:' + path.join(root, 'ihearit.exe'), path.join(__dirname, 'launcher.cs'), info], {windowsHide: true, stdio: 'pipe'});
} finally { if (fs.existsSync(info)) fs.unlinkSync(info); fs.rmdirSync(temporary); }
console.log('I Hear It launcher compiled: ihearit.exe; no npm dependencies added.');
