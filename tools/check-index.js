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
assert.deepEqual(theory.iconSheet, index.sheet, 'Item pictures must come from the index sheet');

/*
 * Every module draws an item from the index's sheet, so an item the index has
 * a picture of must arrive at every module with it. This is the check that was
 * missing: fifty items came back to the bench without their artwork following,
 * and nothing said so until somebody opened the page and saw an empty square.
 */
const art = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/item-art.json'), 'utf8'));
assert.deepEqual(art.from, index.from, 'Compare only files from the same client');
assert.deepEqual(art.sheet, index.sheet, 'Item pictures must come from the index sheet');
const noIcon = projected.items.filter(one => !one.icon);
assert.equal(noIcon.length, 0, noIcon.length + ' bench items have no picture: '
  + noIcon.slice(0, 5).map(one => one.name).join(', '));
const enchantable = fs.readFileSync(path.join(root, 'data/Items/client-items.txt'), 'utf8')
  .split(/\n/).filter(line => line.startsWith('item|')).map(line => line.split('|')[1]);
const unpictured = enchantable.filter(name => !art.art[name]);
assert.equal(unpictured.length, 0,
  unpictured.length + ' enchantable items have no picture: ' + unpictured.slice(0, 6).join(', '));
console.log(`${projected.items.length} bench items and all ${enchantable.length} `
  + 'enchantable items draw from the index sheet');
console.log(`${compared} index/theory records compared; ${off.length} disagreements`);
for (const line of off.slice(0, 8)) console.error(line);
process.exitCode = off.length ? 1 : 0;
