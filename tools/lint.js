'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
// Every page script is parsed, not a list kept by hand: a new file in web/ or
// web/training/ is covered the day it lands (ROT-C-14).
const scripts = dir => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js')).sort().map(f => dir + '/' + f);
const classic = [
  ...scripts('web'), ...scripts('web/training'),
  'tools/build-training.js', 'tools/training-catalog.js', 'tests/training-index.test.js',
  'tools/build-i18n.js', 'tools/check-i18n.js', 'tests/i18n.test.js'
];
for (const file of classic) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
const moduleSource = fs.readFileSync(path.join(root, 'web', 'skins', 'app.js'), 'utf8');
const moduleCheck = spawnSync(process.execPath, ['--input-type=module', '--check'], {
  input: moduleSource, encoding: 'utf8'
});
if (moduleCheck.status !== 0) {
  process.stderr.write(moduleCheck.stderr);
  process.exit(moduleCheck.status || 1);
}
console.log(`${classic.length} classic scripts and the Skin Viewer module parse successfully.`);
