'use strict';
const fs = require('node:fs');
function readForPackage(file) {
  const bytes = fs.readFileSync(file);
  return /\.(cmd|bat)$/i.test(file) ? Buffer.from(bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r?\n/g, '\r\n'), 'utf8') : bytes;
}
module.exports = {readForPackage};
