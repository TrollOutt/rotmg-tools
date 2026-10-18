'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { sourceSlice } = require('./source-slice');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tools/atlas-viewer.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'web/atlas-spatial.js'), 'utf8');
const bindings = sourceSlice(source, 'tools/atlas-viewer.html')(
  '/* Atlas local search indices.', '/*\n * What a character is at a given level.');

// Count actual bucket reads, not wall time or rAF callbacks. Exercise the
// viewer's configured grid against the published 16-tile configuration.
function grids() {
  let reads = 0;
  class CountedMap extends Map { get(key) { reads++; return super.get(key); } }
  const c = { Map: CountedMap };
  vm.runInNewContext(moduleSource + '\n' + bindings
    + '\nthis.grids = { candidate: folkSpace, reference: AtlasSpatial.createGrid(16) };', c);
  return { ...c.grids, reads: () => reads };
}
let seed = 0x44c2026, queries = 0, candidateReads = 0, referenceReads = 0;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (const multiplier of [1, 2, 4]) {
  const { candidate, reference, reads } = grids();
  const folk = Array.from({ length: 120 * multiplier }, (_, id) => ({ id,
    x: (random() - 0.5) * 3000, y: (random() - 0.5) * 3000 }));
  // Cell edges, ties, and several characters sharing a wider bucket.
  folk.push({ id: -1, x: 16, y: -16 }, { id: -2, x: 64, y: -64 },
    { id: -3, x: 63.99, y: -64.01 }, { id: -4, x: 64.01, y: -63.99 });
  candidate.rebuild(folk); reference.rebuild(folk);
  const ids = list => Array.from(list, p => p.id);
  for (let i = 0; i < 1000; i++) {
    const anchor = folk[i % folk.length];
    const x = i % 2 ? anchor.x : (random() - 0.5) * 3000;
    const y = i % 2 ? anchor.y : (random() - 0.5) * 3000;
    const before = reads(), actual = candidate.query(x, y, 18), middle = reads();
    const expected = reference.query(x, y, 18), after = reads();
    candidateReads += middle - before; referenceReads += after - middle;
    const circular = p => (p.x - x) ** 2 + (p.y - y) ** 2 < 18 ** 2;
    assert.deepEqual(ids(actual.filter(circular)), ids(expected.filter(circular)),
      'Observed targeting retains all exact candidates in source order');
    queries++;
    for (const radius of [0.7, 3.2, 3.5]) {
      const square = p => Math.abs(p.x - x) <= radius && Math.abs(p.y - y) <= radius;
      assert.deepEqual(ids(candidate.query(x, y, radius).filter(square)),
        ids(reference.query(x, y, radius).filter(square)),
        'Projectile, dodge and separation broad phases retain exact candidates');
      queries++;
    }
  }
}
assert(candidateReads < referenceReads * 0.35,
  'Sparse observed-target searches must avoid most empty-bucket reads');
console.log(`Atlas smoothness: ${queries} ordered exact-candidate comparisons; bucket reads ${referenceReads} -> ${candidateReads}.`);
