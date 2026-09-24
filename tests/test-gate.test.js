'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

const deployCritical = [
  'atlas-combat.test.js',
  'engine.test.js',
  'enchant-optimization.test.js',
  'i18n.test.js',
  'index-quality.test.js',
  'progression.test.js',
  'projections.test.js',
  'realm-brush-engine.test.js',
  'realm-codec.test.js',
  'realm-contract.test.js',
  'router-contract.test.js',
  'module-links.test.js',
  'runtime-lifecycle.test.js',
  'skins.test.js',
  'sprite-contract.test.js',
  'storage-contract.test.js',
  'test-gate.test.js',
  'theory-optimization.test.js',
  'theory.test.js',
  'ui-cache.test.js'
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
