'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const classic = [
  'web/i18n.js', 'web/app.js', 'web/fame-page.js', 'web/index-page.js',
  'web/theorycraft.js', 'tools/build-i18n.js', 'tools/check-i18n.js', 'tests/i18n.test.js'
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
