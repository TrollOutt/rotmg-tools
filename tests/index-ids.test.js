'use strict';
// ROT-B-02: an Index id that names another object in the next build is caught.
// Offline, on made-up records: no client data, no network.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { identity, compareIds } = require('../tools/check-index-ids.js');

/*
 * The way build-index.js names twins today: the first declaration met takes
 * the bare id, the others "name#clientId". Fed the same objects in another
 * file order, it hands the bare id to the other object.
 */
function build(declarations) {
  const records = [];
  const taken = new Set();
  for (const one of declarations) {
    let id = one.kind + ':' + one.name;
    if (taken.has(id)) id += '#' + one.clientId;
    taken.add(id);
    records.push({ id, kind: one.kind, name: one.name, alias: one.clientId !== one.name ? one.clientId : undefined, from: [one.file, one.type] });
  }
  return records;
}

const normal = { kind: 'item', name: 'Made-up Star', clientId: 'Made-up Star', type: '0x3745', file: 26 };
const shiny = { kind: 'item', name: 'Made-up Star', clientId: 'Made-up Star Shiny', type: '0x460d', file: 27 };
const other = { kind: 'item', name: 'Lone Thing', clientId: 'Lone Thing', type: '0x0101', file: 26 };
const set = { kind: 'set', name: 'Made-up Set', clientId: 'MADE_UP_SET', type: '0x0', file: 5 };

// Same order twice: nothing moves.
const first = build([normal, shiny, other, set]);
assert.deepStrictEqual(compareIds(first, build([normal, shiny, other, set])), { reassigned: [], duplicates: [], renamed: 0 });

// The files renumbered (Objects.026 and .027 swapped): the bare id changes object.
const swapped = build([{ ...shiny, file: 26 }, { ...normal, file: 27 }, other, set]);
const moved = compareIds(first, swapped);
assert.deepStrictEqual(moved.reassigned.map(one => one.id), ['item:Made-up Star']);
assert.strictEqual(moved.reassigned[0].before, 'item|0x3745');
assert.strictEqual(moved.reassigned[0].after, 'item|0x460d');
assert.strictEqual(moved.renamed, 2);

// The file number alone is not an identity: a renumbered file with no twin is fine.
assert.deepStrictEqual(compareIds(first, build([normal, shiny, { ...other, file: 31 }, set])).reassigned, []);
// Objects without a type number are told apart by their client id.
assert.strictEqual(identity(first[3]), 'set|MADE_UP_SET');
// One id used twice in a build is reported.
assert.deepStrictEqual(compareIds(first, [...first, first[2]]).duplicates, ['item:Lone Thing']);

// The command: exit 1 on a moved id, 0 when nothing moved or when accepted.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-ids-'));
const write = (name, records) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify({ records })); return file; };
const oldFile = write('old.json', first);
const tool = path.join(__dirname, '..', 'tools', 'check-index-ids.js');
const run = (env, ...files) => spawnSync(process.execPath, [tool, ...files], { encoding: 'utf8', env: { ...process.env, ...env } });
const bad = run({}, oldFile, write('swapped.json', swapped));
assert.strictEqual(bad.status, 1, bad.stderr);
assert.match(bad.stderr, /item:Made-up Star: was item\|0x3745, now item\|0x460d/);
assert.strictEqual(run({}, oldFile, write('same.json', first)).status, 0);
assert.strictEqual(run({ ROTMG_ACCEPT_ID_CHANGES: '1' }, oldFile, path.join(dir, 'swapped.json')).status, 0);

console.log('index ids: ok');
