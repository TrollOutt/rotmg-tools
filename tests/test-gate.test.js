'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

const deployCritical = [
  'app-data.test.js',
  'app-storage.test.js',
  'source-slice.test.js',
  'atlas-combat.test.js',
  'atlas-data.test.js',
  'build-handover.test.js',
  'engine.test.js',
  'enchant-optimization.test.js',
  'i18n.test.js',
  'index-extras.test.js',
  'fiches-data.test.js',
  'fiches-community.test.js',
  'fiches-forge.test.js',
  'home-navigation.test.js',
  'index-quality.test.js',
  'index-search.test.js',
  'index-filter.test.js',
  'index-facets.test.js',
  'index-grouping.test.js',
  'index-families.test.js',
  'index-sheet.test.js',
  'index-sheet-style.test.js',
  'progression.test.js',
  'progression-slider.test.js',
  'realm-events.test.js',
  'projections.test.js',
  'realm-brush-engine.test.js',
  'realm-contract.test.js',
  'router-contract.test.js',
  'module-links.test.js',
  'outline.test.js',
  'runtime-lifecycle.test.js',
  'skin-viewer-data.test.js',
  'skin-viewer-animation.test.js',
  'skins.test.js',
  'sprite-contract.test.js',
  'status-effects.test.js',
  'standalone-zone-assets.test.js',
  'storage-contract.test.js',
  'test-gate.test.js',
  'theory-optimization.test.js',
  'theory-sheet-style.test.js',
  'theory-oracle.test.js',
  'theory.test.js',
  'ui-cache.test.js',
  'visit-counter.test.js',
  'whats-new-sheet.test.js',
  'whats-new.test.js'
];

const buildCritical = [
  'standalone.test.js'
];

const special = {
  'realmeye-monitor.test.js': 'wiki-monitor:test'
};

const commandHas = (script, file) =>
  String(scripts[script] || '').includes(`node tests/${file}`);

for (const file of deployCritical) {
  assert(
    commandHas('test', file),
    `CI-GATE: ${file} must run in npm test before deployment`
  );
}

for (const file of buildCritical) {
  assert(
    commandHas('build', file),
    `CI-GATE: ${file} must run in npm run build`
  );
}

for (const [file, script] of Object.entries(special)) {
  assert(
    commandHas(script, file),
    `CI-GATE: ${file} must remain assigned to npm run ${script}`
  );
}

const discovered = fs.readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.test.js'))
  .sort();

const classified = [
  ...deployCritical,
  ...buildCritical,
  ...Object.keys(special)
].sort();

assert.deepEqual(
  discovered,
  classified,
  'CI-GATE: every *.test.js must be explicitly assigned to a test gate'
);

console.log(`test gate: ${discovered.length} test files explicitly classified`);
