'use strict';
const fs = require('node:fs'), path = require('node:path');
const {zip, unzip} = require('../lib/util');
const {readForPackage} = require('./windows-script');
const version = require('../package.json').version;
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist'), entries = {};
for (const relative of require('./public-files').publicFiles(root)) entries['ihearit/' + relative] = readForPackage(path.join(root, relative));
const bytes = zip(entries); unzip(bytes); fs.mkdirSync(dist, {recursive: true}); const file = path.join(dist, `ihearit-v${version}-source.zip`); fs.writeFileSync(file, bytes); console.log(file, bytes.length, 'bytes', Object.keys(entries).length, 'files; public source only');
