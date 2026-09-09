'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/TheoryCraft/theorycraft.json'), 'utf8'));
const harness = require('./theory-harness');
const t = harness({}, raw, false);
for (const klass of raw.classes) {
  t.use(t.fresh(klass.name));
  const names = new Set(t.itemsFor('ring', klass.name).map(r => r.name));
  for (const suffix of ['Nile', 'Pyramid', 'Sphinx']) assert(names.has('Venerable Ring of the ' + suffix), klass.name + ' picker is missing ' + suffix);
}
assert.throws(() => t.enchantsFor(raw.items[0].name, [], 0), /Enchanting rules are unavailable/);
console.log('All class pickers include the three Venerable rings; missing rules fail explicitly.');
