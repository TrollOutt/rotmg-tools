'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data', 'Index', 'index.json')));
const wiki = JSON.parse(fs.readFileSync(path.join(root, 'data', 'Index', 'wiki.json')));
const atlas = JSON.parse(fs.readFileSync(path.join(root, 'web', 'assets', 'atlas', 'atlas.json')));
const records = new Map(index.records.map(one => [one.id, one]));
const active = name => index.records.filter(one => one.name === name && !one.folded);

assert(index.folding && index.folding.groups > 1000, 'the build must report its common entries');
assert.equal(active('Adult Basilisk').length, 1, 'six identical Basilisks should browse as one');
assert.equal(active('Adult Basilisk')[0].folds.length, 6);
assert.equal(active('Avatar of the Forgotten King').length, 1, 'old/new Avatar variants should browse as one');
assert.equal(active('Permafrost Snowflake').length, 1, 'stack quantity hidden in client id must still fold');
assert.equal(active('Permafrost Snowflake')[0].folds.length, 10);
assert.equal(active('Ivory Heart').length, 1);
assert.equal(active('Ivory Heart')[0].folds.length, 10);
assert.equal(active('Lich').length, 1, 'same DisplayId variants should browse as one');
assert(active('Lich')[0].folds.some(one => /life: 1,100/.test(one.diff || '')),
  'the common card must retain a differing historical life value');

const placeholderZones = ['Zone 12', 'Zone 30', 'Zone 36', 'Zone 37'];
for (const name of placeholderZones) {
  assert.equal(active(name).length, 0, name + ' is an atlas construction label, not a place');
  assert(!atlas.biomes.some(one => one.name === name), name + ' must not be published as a biome');
}

const broken = index.records.find(one => !one.folded && one.said === 'Broken Heart');
assert(broken && broken.folds.length === 8, 'numbered identical enemies should form one family');
const grave = index.records.find(one => !one.folded && one.said === 'Voodoo Grave Unlocker');
assert(grave && grave.folds.length === 11, 'gravestone progression should form one family');
const archerEffect = index.records.find(one => !one.folded && one.said === '2ArcherST1');
assert(archerEffect && archerEffect.folds.length === 5,
  'lettered technical effect pieces should form one family');
const moonlightLoot = index.records.find(one => !one.folded && one.said === 'MV Regular Loot');
assert(moonlightLoot && moonlightLoot.folds.length === 5,
  'numbered dungeon controllers should form one family while retaining their differences');

const shownNames = new Set();
for (const one of index.records.filter(one => !one.folded)) {
  const key = one.kind + '|' + (one.said || one.name);
  assert(!shownNames.has(key), 'ordinary browsing must not repeat the same shown name: ' + key);
  shownNames.add(key);
}

for (const one of index.records) {
  if (!one.folded) continue;
  assert(records.has(one.folded), one.id + ': folded target is missing');
  assert(!records.get(one.folded).folded, one.id + ': folded target must be a final common entry');
}

const recordPage = new Map((wiki.page || []).map(([idAt, pageAt]) => [wiki.ids[idAt], pageAt]));
const pageKinds = new Map();
for (const [id, pageAt] of recordPage) {
  if (!records.has(id)) continue;
  if (!pageKinds.has(pageAt)) pageKinds.set(pageAt, new Set());
  pageKinds.get(pageAt).add(records.get(id).kind);
}
assert((wiki.dungeon || []).length > 1000, 'the local community snapshot should link dungeon populations');
for (const [dungeon, enemy] of wiki.dungeon || []) {
  assert(pageKinds.get(dungeon)?.has('portal'), 'dungeon edge must begin on a client portal page');
  assert(pageKinds.get(enemy)?.has('enemy'), 'dungeon edge must end on a client enemy page');
}
const dungeonPairs = new Set(wiki.dungeon.map(one => one.join(',')));
assert(dungeonPairs.has(recordPage.get('portal:The Shatters') + ','
  + recordPage.get('enemy:The Forgotten King')), 'The Forgotten King belongs to The Shatters');
assert(dungeonPairs.has(recordPage.get('portal:Snake Pit') + ','
  + recordPage.get('enemy:Stheno the Snake Queen')), 'Stheno belongs to the Snake Pit');

const pageSource = fs.readFileSync(path.join(root, 'web', 'index-page.js'), 'utf8');
assert(!/chip\(marks, 'boss'/.test(pageSource), 'Boss is an enemy category, not a generic mark');
assert(!/chip\(marks, 'god'/.test(pageSource), 'God is an enemy category, not a generic mark');

console.log('Index common-entry, taxonomy, dungeon-link, and atlas-place checks passed.');
