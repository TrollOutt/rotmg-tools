'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const file = process.argv[2] || 'data/TheoryCraft/theorycraft.json';
const theory = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
assert.deepEqual(index.from, theory.from, 'Compare only files from the same client');
const projected = require('./index-model').project(index, true);
let compared = 0;
const off = [];
for (const group of Object.keys(projected)) {
  if (projected[group].length !== theory[group].length) off.push(`${group}: ${projected[group].length} versus ${theory[group].length} records`);
  for (let i = 0; i < projected[group].length; i++) {
    const ours = projected[group][i], theirs = theory[group][i];
    const a = { ...ours }, b = { ...theirs };
    try { assert.deepEqual(a, b); } catch { off.push(`${group}/${ours.id || ours.name}: ${JSON.stringify(a)} versus ${JSON.stringify(b)}`); }
    compared++;
  }
}
assert.equal(index.records.filter(r => r.kind === 'item' && r.bench).length, projected.items.length);
for (const r of index.records.filter(r => r.kind === 'item' && !r.bench)) {
  assert(r.hidden?.length || r.benchWhy, r.id + ': no explanation for bench exclusion');
}
assert.deepEqual(theory.sheet, index.theorySheet, 'Theory artwork must come from the index');
console.log(`${compared} index/theory records compared; ${off.length} disagreements`);
for (const line of off.slice(0, 8)) console.error(line);
process.exitCode = off.length ? 1 : 0;
