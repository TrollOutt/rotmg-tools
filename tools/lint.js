'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const classic = [
  'tools/build-training.js', 'web/training/engine.js', 'web/training/renderer.js',
  'tools/training-catalog.js', 'web/training/index-combat.js', 'tests/training-index.test.js',
  'web/training/ui_code.js', 'web/training/ui_game.js', 'web/training/ui_gear.js',
  'web/training/ui_bg.js', 'web/training/loop.js',
  'web/atlas-data.js',
  'web/atlas-geometry.js',
  'web/atlas-spatial.js',
  'web/skin-viewer-data.js',
  'web/skin-viewer-animation.js',
  'web/fiches-data.js', 'web/fiches-c.js', 'web/i18n.js', 'web/outline.js', 'web/app.js', 'web/app-data.js', 'web/fame-page.js', 'web/index-page.js', 'web/index-search.js', 'web/index-filter.js', 'web/index-grouping.js', 'web/index-families.js', 'web/index-browse.js',
  'web/theory-engine.js', 'web/theorycraft.js', 'tools/build-i18n.js', 'tools/check-i18n.js', 'tests/i18n.test.js'
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
