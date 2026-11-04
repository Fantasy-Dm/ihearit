'use strict';
const fs = require('node:fs'), path = require('node:path');
const rootFiles = ['server.js', 'worker.js', 'package.json', 'package-lock.json', '.npmrc', '.gitignore', '.gitattributes', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'RELEASE_NOTES.md', 'start.cmd', 'start.vbs', '启动助手.cmd', '启动助手.vbs', 'setup-and-start.bat'];
const fixed = {'models': ['yamnet.onnx', 'LICENSE', 'NOTICE.md', 'UPSTREAM-MODEL-CARD.md'], 'licenses': ['Node-LICENSE.txt', 'ONNX-Runtime-LICENSE.txt', 'ONNX-Runtime-ThirdPartyNotices.txt'], 'tests/fixtures': ['README.md', 'reference-audio.f32', 'reference-features.json', 'legacy-profile.npz']};
function publicFiles(root) {
  const result = [...rootFiles];
  for (const [directory, names] of Object.entries(fixed)) for (const name of names) result.push(directory + '/' + name);
  for (const directory of ['lib', 'ui', 'tools', 'tests', '.github/workflows']) {
    for (const name of fs.readdirSync(path.join(root, directory))) {
      if (['update-local-install.js', 'patch.js'].includes(name)) continue;
      if (directory === 'tests' ? name.endsWith('.test.js') : /\.(js|html|css|cs|ps1|json|yml)$/.test(name)) result.push(directory + '/' + name);
    }
  }
  for (const name of result) { const stat = fs.lstatSync(path.join(root, name)); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Public source must contain regular files: ' + name); }
  return [...new Set(result)].sort();
}
module.exports = {publicFiles};
