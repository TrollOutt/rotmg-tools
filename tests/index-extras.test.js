'use strict';

/*
 * The Index card extras (tools/build-index-extras.js) are regenerated with the
 * Index by `npm run scrape`. These checks fail when the two drift apart - an
 * Index rebuilt for a new client while the extras were left behind, or extras
 * that still describe items the client no longer has.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { readPng } = require('../tools/png');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'web', 'assets', 'index');
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const png = name => readPng(fs.readFileSync(path.join(dir, name)));

const index = json('index.json');
const forge = json('client-forge.json');
const shots = json('projectiles.json');
const families = json('collection-icons.json');

const items = index.records.filter(r => r.kind === 'item');
const keyOf = r => r.clientId || r.name;
const itemKeys = new Set(items.map(keyOf));
const setIds = new Set(index.records.filter(r => r.kind === 'set').map(r => r.id));

const unshot = items.filter(r => r.fires && r.fires.length && !shots.items[keyOf(r)]).map(keyOf);
assert.deepEqual(unshot, [], 'EXTRAS-001 every Index item that fires has its projectile (run npm run scrape)');

const staleShots = Object.keys(shots.items).filter(k => !itemKeys.has(k));
assert.deepEqual(staleShots, [], 'EXTRAS-002 every projectile entry is an Index item');

const staleSets = Object.keys(shots.sets).filter(k => !setIds.has(k));
assert.deepEqual(staleSets, [], 'EXTRAS-003 every set skin is an Index set');

const sheet = png('projectiles.png');
assert.equal(sheet.width, shots.wide, 'EXTRAS-004 projectile sheet width matches its description');
assert.equal(sheet.height, shots.tall, 'EXTRAS-004 projectile sheet height matches its description');
for (const [key, pic] of Object.entries(shots.pics)) {
  assert(pic.x + pic.w * pic.frames <= shots.wide && pic.y + pic.h <= shots.tall, `EXTRAS-005 ${key} lies on the sheet`);
}
for (const [id, item] of Object.entries(shots.items)) {
  for (const shot of item.shots) assert(!shot.pic || shots.pics[shot.pic], `EXTRAS-006 ${id} fires a projectile that has a picture`);
}
for (const [id, set] of Object.entries(shots.sets)) {
  assert(!set.bullet || shots.pics[set.bullet], `EXTRAS-006 ${id} changes to a projectile that has a picture`);
  assert(!set.weapon || shots.items[set.weapon], `EXTRAS-007 ${id} names a weapon that fires`);
}

/*
 * A skin a set gives fires in the Skin Viewer: the projectile the set changes
 * to, or else its set's weapon's own - never the class's default.
 */
const givenSkins = JSON.parse(fs.readFileSync(path.join(root, 'web', 'assets', 'skins', 'generated', 'skins.json'), 'utf8'))
  .skins.filter(one => one.sets && one.sets.length);
const unarmed = givenSkins.filter(one => !shots.skins[String(one.type).toLowerCase()]).map(one => one.name);
assert.deepEqual(unarmed, [], 'EXTRAS-013 every skin a set gives has its set\'s attack');
for (const [type, one] of Object.entries(shots.skins)) {
  /* The Paths transform with one piece that is no weapon and declare no projectile: the class keeps its own. */
  if (!one.weapon && !one.bullet) continue;
  const weapon = shots.items[one.weapon];
  assert(weapon, `EXTRAS-014 set skin ${type} fires its set's weapon`);
  assert(shots.pics[one.bullet || weapon.shots[0].pic], `EXTRAS-014 set skin ${type} has a projectile picture`);
}

const icons = png('collection-icons.png');
assert.equal(icons.width, families.wide, 'EXTRAS-008 family sheet width matches its description');
assert.equal(icons.height, families.tall, 'EXTRAS-008 family sheet height matches its description');
const have = new Set(families.have);
const noIcon = [...new Set(Object.values(forge).map(x => x.family).filter(x => x !== undefined && !have.has(x)))];
assert.deepEqual(noIcon, [], 'EXTRAS-009 every family an item belongs to has its icon');

const bags = png('loot-bags.png');
assert.equal(bags.width, 80, 'EXTRAS-010 ten loot bags of eight pixels');
const badBags = Object.entries(forge).filter(([, x]) => x.bag !== undefined && !(x.bag >= 0 && x.bag <= 9)).map(([k]) => k);
assert.deepEqual(badBags, [], 'EXTRAS-010 every loot bag is one of the ten drawn');

assert.equal(png('forge-ui.png').width, 128, 'EXTRAS-011 eight forge icons of sixteen pixels');

const withExtras = items.filter(r => forge[keyOf(r)]).length;
assert(withExtras > items.length * 0.9, `EXTRAS-012 forge data covers the Index items (${withExtras} of ${items.length})`);

console.log(`Index card extras: ${Object.keys(shots.items).length} firing items, ${Object.keys(shots.pics).length} projectile pictures, `
  + `${Object.keys(shots.sets).length} set skins, ${withExtras} items with forge data, all in step with the Index.`);
