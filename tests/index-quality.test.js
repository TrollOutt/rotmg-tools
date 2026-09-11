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
for (const place of index.records.filter(one => one.kind === 'place')) {
  assert(place.art || place.icon, place.name + ' must use its Realm beacon sprite');
  assert(place.beacon && records.has(place.beacon), place.name + ' must identify its beacon record');
  if (place.icon) continue;
  const visible = records.get(place.beaconArt || place.beacon);
  assert(visible, place.name + ' must identify a visible beacon or guardian record');
  assert.deepEqual(place.art, visible.art, place.name + ' must reuse its visible beacon artwork');
}
assert(records.get('place:Carboniferous').icon?.startsWith('data:image/png;base64,'),
  'Carboniferous must use the green beacon actually drawn in the Atlas');
assert.equal(records.get('place:Runic Tundra').beaconArt,
  'enemy:Legion Principal Portal#Beacon Guardian Runic Tundra Big Portal',
  'Runic Tundra must use its beacon portal rather than its guardian');
const documentedBiomes = index.records.filter(one => one.kind === 'place' && one.loot);
assert.equal(documentedBiomes.length, 14, 'all reference-backed realm biomes must publish their loot');
for (const place of documentedBiomes) {
  assert(['Rookie', 'Adept', 'Veteran'].includes(place.rank), place.name + ' must publish its realm rank');
  assert(Object.keys(place.loot.tiers || {}).length, place.name + ' must publish its tiered loot');
  const atlasCopies = [...atlas.biomes, ...atlas.zones].filter(one => one.name === place.name);
  assert(atlasCopies.length, place.name + ' must remain connected to the Atlas');
  for (const copy of atlasCopies) assert.deepEqual(copy.loot, place.loot,
    place.name + ' Atlas loot must be read from the Index contract');
}

const ancientCity = records.get('place:Ancient City');
assert(ancientCity.untiered.includes('item:Cavalry Lance'),
  'a biome must resolve its named UT drops onto Index item records');
assert(ancientCity.dungeons.includes('portal:Snake Pit'),
  'a biome must resolve its dungeon entrances onto Index portal records');

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

assert.equal((wiki.tierDropLists || []).length, 46, 'every RealmEye tier drop list must be collected');
assert((wiki.tierDrop || []).length > 950, 'the Index must retain enemy-to-tier relations');
for (const [enemy, hand, tier, alternate, list] of wiki.tierDrop || []) {
  assert(pageKinds.get(enemy)?.has('enemy'), 'tier drop relation must begin on a client enemy page');
  assert(wiki.tierDropHands[hand], 'tier drop relation must name an equipment slot');
  assert(Number.isInteger(tier) && tier >= 0 && tier <= 14, 'tier drop relation must carry a real tier');
  assert(alternate === 0 || alternate === 1, 'alternate weapon marker must be binary');
  assert(wiki.tierDropLists[list], 'tier drop relation must retain its RealmEye evidence page');
}

const pageSource = fs.readFileSync(path.join(root, 'web', 'index-page.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'web', 'style.css'), 'utf8');
assert(!/chip\(marks, 'boss'/.test(pageSource), 'Boss is an enemy category, not a generic mark');
assert(!/chip\(marks, 'god'/.test(pageSource), 'God is an enemy category, not a generic mark');
assert(/propertyName === 'grid-template-columns'[\s\S]{0,160}fitList\(list\)/.test(pageSource),
  'closing a record card must refit the result list after the column transition');
assert(/\.ix-layout:not\(\.has-list\) \.ix-facets\s*\{[^}]*overflow-y:\s*auto/.test(styleSource),
  'the full category rail must scroll so its lowest dungeon choices remain reachable');
assert(/\.ix-layout:not\(\.has-list\) \.ix-ways\s*\{[^}]*max-height:\s*100%/.test(styleSource),
  'the full category card must stay within the viewport for its rail to scroll');
assert(/chip\(where, one\.name, one\.name, ids, one\.id\)/.test(pageSource),
  'biome category choices must reuse the artwork of their place record');
assert(/drawBiomeLoot\(one\)/.test(pageSource),
  'biome cards must display their normalised loot');

console.log('Index common-entry, taxonomy, dungeon-link, and atlas-place checks passed.');
