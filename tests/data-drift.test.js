'use strict';
// ROT-B-06: an update that drops records, enrichment or file weight beyond the
// limits is caught before publication. Offline, on made-up files.
const assert = require('assert');
const { compareData, markdown } = require('../tools/check-data-drift.js');

function index(counts) {
  const records = [];
  for (const [kind, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) records.push({ id: `${kind}:Made-up ${i}`, kind, name: `Made-up ${i}`, about: 'x'.repeat(200) });
  }
  return JSON.stringify({ records });
}
const enrichment = counts => JSON.stringify({ counts, records: {}, pad: 'y'.repeat(20000) });
const files = (idx, enr) => ({ 'data/Index/index.json': idx, 'data/Index/realmeye-enrichment.json': enr });

const counts = { linkedIndexRecords: 6751, archivePages: 5673, recordsWithDescription: 7221 };
const before = files(index({ item: 200, enemy: 100, portal: 10 }), enrichment(counts));

// Normal update: a few records added and changed.
const normalIndex = JSON.parse(index({ item: 203, enemy: 100, portal: 10 }));
normalIndex.records[0].about = 'changed';
const normal = compareData(before, files(JSON.stringify(normalIndex), enrichment({ ...counts, archivePages: 5680 })));
assert.deepStrictEqual(normal.problems, []);
const item = normal.kinds.find(one => one.kind === 'item');
assert.deepStrictEqual([item.added, item.removed, item.changed], [3, 0, 1]);

// 40 % of the items gone: the kind and the file size are flagged.
const lost = compareData(before, files(index({ item: 120, enemy: 100, portal: 10 }), enrichment(counts)));
assert.ok(lost.problems.some(p => p.startsWith('item: 200 -> 120')), lost.problems.join('\n'));
assert.ok(lost.problems.some(p => p.startsWith('Index: 310 -> 230')));
assert.ok(lost.problems.some(p => p.startsWith('data/Index/index.json:')));

// A small kind under 50 records may move freely; the total still counts.
assert.deepStrictEqual(compareData(before, files(index({ item: 200, enemy: 100, portal: 4 }), enrichment(counts))).problems, []);

// The enrichment loses its links (the archive purge of ROT-B-01, seen downstream).
const purged = compareData(before, files(before['data/Index/index.json'], enrichment({ ...counts, linkedIndexRecords: 120, archivePages: 2 })));
assert.ok(purged.problems.some(p => p.startsWith('enrichment linkedIndexRecords: 6751 -> 120')));
assert.ok(purged.problems.some(p => p.startsWith('enrichment archivePages')));

// The report for a pull request lists what moved and the problems.
const text = markdown(lost);
assert.match(text, /\| item \| 200 \| 120 \| 0 \| 80 \| 0 \|/);
assert.match(text, /Écarts au-delà des seuils/);

console.log('data drift: ok');
