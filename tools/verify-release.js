'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const {unzip, hash} = require('../lib/util'), {publicFiles} = require('./public-files');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist'), pkg = require('../package.json');
const expectedHash = 'd3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e';
const allowedSource = new Set(publicFiles(root)), sums = [];
for (const suffix of ['win-x64', 'source']) {
  const filename = `ihearit-v${pkg.version}-${suffix}.zip`, bytes = fs.readFileSync(path.join(dist, filename)), files = unzip(bytes, {maxBytes: 512 * 1024 * 1024});
  const prefix = 'ihearit/', get = name => { assert(files[prefix + name], 'Missing release file: ' + name); return files[prefix + name]; };
  for (const [name, data] of Object.entries(files)) {
    assert(name.startsWith(prefix), 'Unexpected archive root');
    const relative = name.slice(prefix.length);
    assert(!/(^|\/)(data|profiles|\.git|\.npm-cache|\.tmp|\.diagnostics|private)(\/|$)/i.test(relative), 'Non-public directory in archive: ' + name);
    assert(!/\.(pem|key|pfx|wav|mp3|kdenlive|log)$/i.test(relative), 'Non-public file type in archive: ' + name);
    if (suffix === 'source') assert(allowedSource.has(relative), 'Unexpected source file: ' + name);
    for (const localPath of [root, os.homedir()]) for (const needle of new Set([localPath, localPath.replaceAll('\\', '/')])) assert(!data.includes(Buffer.from(needle)), 'Local absolute path in archive: ' + name);
    if (suffix === 'source' && !relative.startsWith('licenses/') && !relative.startsWith('models/')) assert(!/[\w.+-]+@(?:qq\.com|163\.com|126\.com|outlook\.com|gmail\.com)/i.test(data.toString('utf8')), 'Personal email in application source: ' + name);
  }
  assert.equal(hash(get('models/yamnet.onnx')), expectedHash);
  assert(get('LICENSE').toString().includes('I Hear It contributors'));
  assert(get('licenses/ONNX-Runtime-LICENSE.txt').toString().includes('Microsoft'));
  assert(get('licenses/ONNX-Runtime-ThirdPartyNotices.txt').length > 10000);
  assert(get('models/UPSTREAM-MODEL-CARD.md').toString().includes('license: apache-2.0'));
  const packed = JSON.parse(get('package.json')); assert.equal(packed.version, pkg.version); assert.equal(packed.license, 'MIT');
  for (const name of suffix === 'source' ? ['start.cmd', '启动助手.cmd', 'setup-and-start.bat'] : ['start.cmd', '启动助手.cmd']) assert(!/(?<!\r)\n/.test(get(name).toString('utf8')), 'Windows script newline: ' + name);
  if (suffix === 'win-x64') {
    const manifest = JSON.parse(get('BUILD-MANIFEST.json')); assert.equal(manifest.variant, '通用完整版'); assert.equal(manifest.version, pkg.version + '-js');
    for (const [name, info] of Object.entries(manifest.files)) { assert.equal(get(name).length, info.bytes); assert.equal(hash(get(name)), info.sha256, name); }
    assert.deepEqual(manifest.runtimePackages, ['@xmldom/xmldom', 'onnxruntime-common', 'onnxruntime-node']);
    assert(get('node_modules/@xmldom/xmldom/LICENSE').length > 500);
    assert(get('ihearit.exe').length > 1000);
    assert.deepEqual(Object.keys(files).filter(name => /^ihearit\/[^/]+\.exe$/i.test(name)), ['ihearit/ihearit.exe']);
  } else assert.equal(Object.keys(files).length, allowedSource.size);
  sums.push(`${hash(bytes)}  ${filename}`); console.log('Verified public release: ' + filename);
}
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
