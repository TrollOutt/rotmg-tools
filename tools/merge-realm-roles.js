'use strict';
/*
 * Give every zone the encounters and the Heroes of Oryx that belong to it.
 *
 *   node tools/merge-realm-roles.js
 *
 * The walked capture recorded what was standing about when it was walked,
 * which is the ordinary wildlife and nothing else: not one encounter and
 * barely a hero is in it. No Cube God, no Lord of the Lost Lands, no Skull
 * Shrine - the things a realm is actually visited for are exactly the things
 * a stroll through it does not meet.
 *
 * Those come from the imported reference data instead, which sorts a biome's
 * creatures into four groups - regular, Heroes of Oryx, encounters, beacon
 * guardians - and gives the biome a rank besides. Twenty of its twenty-four
 * biomes have a zone on this map to attach to; the four that do not are
 * reported rather than dropped quietly, because two of them are missing for
 * an interesting reason.
 *
 * The pictures have to travel with the atlas. Everything else the interface
 * shows is inlined into the standalone page, but the atlas is a folder of
 * files opened in a frame of its own and docs/assets holds nothing but that
 * folder - so what is wanted is copied into it, next to the creature sprites,
 * rather than reached for across a directory that is never published.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
/*
 * Which atlas to work on. The published one by default; --atlas=DIR points it
 * at a copy, which is how a change is looked at before it goes out.
 */
const asked = process.argv.find(one => one.startsWith('--atlas='));
const ATLAS = asked
  ? path.resolve(root, asked.slice('--atlas='.length))
  : path.join(root, 'web', 'assets', 'atlas');
const BOSS = path.join(ATLAS, 'boss');
const CATALOG = path.join(root, 'web', 'assets', 'realm-catalog');
const MONSTERS = path.join(root, 'web', 'assets', 'realm-monsters');

/*
 * Which zone name answers to which imported biome.
 *
 * The imported ids and the atlas's own zone names were arrived at separately
 * and do not always agree on a word - the city is Abandoned on one side and
 * Ancient on the other, the reefs are plural on one and singular on the
 * other - so the join is written out rather than guessed by string.
 */
/*
 * Which of RealmEye's biomes is which of ours.
 *
 * This used to be keyed on the name of a zone, which was the wrong hinge: the
 * names are ours, several places share one, and two of the lines were plainly
 * wrong for years - low-plains pointed at "Mid Plains" and mid-plains at "Mid
 * Desert". Places now carry the ground the client says they are, worked out
 * from what the creatures standing on them declare, and that is what this
 * turns on. It is one word per biome, it comes out of the game rather than
 * out of anybody's head, and every zone sharing a ground gets the same roster
 * without having to be listed.
 *
 * The two seasonal biomes are simply not in this realm.
 */
const GROUND_BIOMES = {
  Abandoned: 'abandoned-city',
  Beach: 'shore-plains',
  Carboniferous: 'carboniferous',
  CoralReefs: 'coral-reefs',
  DeadChurch: 'dead-church',
  DeepSea: 'deep-sea-abyss',
  FloralEscape: 'floral-escape',
  Forest: 'low-forest',
  HauntedHallows: 'haunted-hallows',
  HighDesert: 'high-desert',
  HigherForest: 'high-forest',
  HigherPlains: 'high-plains',
  MidDesert: 'low-desert',
  Nature: 'mid-forest',
  Plains: 'low-plains',
  RisenHell: 'risen-hell',
  RunicTundra: 'runic-tundra',
  SanguineForest: 'sanguine-forest',
  ShipWreck: 'shipwreck-cove',
  SpriteForest: 'sprite-forest',
  UndeadForest: 'shore-sand'
};

/*
 * What a thing drops, and what tier of gear that is.
 *
 * RealmEye writes a drop table as a list of names, and most of the entries in
 * it are not items but tiers - "Tier 8 Weapons", "Tier 11 Armor", "Tier 4
 * Abilities", "Tier 9 Alternate Weapons". Fifty-three of those lines exist and
 * they are the useful half: what a place is worth to somebody is which tiers
 * of each kind of gear can fall in it. The rest are named things, potions and
 * eggs, and they are kept as they are.
 */
const TIER = /^Tier (\d+) (.+)$/;

function sortTiers(loot) {
  const tiers = {}, items = new Map();
  for (const [name, times] of loot) {
    const m = TIER.exec(name);
    if (m) {
      // RealmEye is not consistent about its plurals: Armor and Armors, Ring
      // and Rings. Left plural because that is how a tier line reads.
      const kind = m[2] === 'Armors' ? 'Armor' : m[2] === 'Ring' ? 'Rings' : m[2];
      (tiers[kind] || (tiers[kind] = [])).push(Number(m[1]));
    } else {
      items.set(name, (items.get(name) || 0) + times);
    }
  }
  for (const kind of Object.keys(tiers)) {
    tiers[kind] = [...new Set(tiers[kind])].sort((a, b) => a - b);
  }
  return {
    tiers,
    items: [...items].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  };
}


const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/*
 * A picture for a name, if there is one anywhere.
 *
 * The client's own sprites are preferred - they are the art the game draws -
 * but hardly any encounter has one, because the client never named these the
 * way the wiki does. The imported catalogue covers most of the rest.
 */
function artFor(name) {
  const key = slug(name);
  for (const [dir, file] of [
    [MONSTERS, key + '.png'],
    [CATALOG, key + '.png'], [CATALOG, key + '.gif'], [CATALOG, key + '.webp']
  ]) {
    if (fs.existsSync(path.join(dir, file))) return { from: path.join(dir, file), file };
  }
  return null;
}

/*
 * Patient reading and writing.
 *
 * This runs straight after the atlas has been built, and on Windows the virus
 * scanner is still holding some of what was just written. It comes back as
 * UNKNOWN rather than as a sharing violation, it lands on a different file
 * each time, and it is over in a moment - so it is waited out. Failing here
 * is worse than slow: the chain carries on to the next tool, which then works
 * on an atlas that was never merged.
 */
function patiently(what) {
  let waited = 0;
  for (;;) {
    try { return what(); } catch (bad) {
      if (waited >= 8000 || !['UNKNOWN', 'EBUSY', 'EPERM'].includes(bad.code)) throw bad;
      const wait = waited < 500 ? 50 : 250;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
      waited += wait;
    }
  }
}
const writeFile = (file, body) => patiently(() => fs.writeFileSync(file, body));
const readFile = (file, how) => patiently(() => fs.readFileSync(file, how));

const realmEye = JSON.parse(readFile(path.join(root, 'web', 'realmeye-data.json'), 'utf8'));
const atlasFile = path.join(ATLAS, 'atlas.json');
const atlas = JSON.parse(readFile(atlasFile, 'utf8'));

fs.mkdirSync(BOSS, { recursive: true });
const carried = new Map();                       // file -> bytes, copied once
function bring(name) {
  const art = artFor(name);
  if (!art) return null;
  if (!carried.has(art.file)) {
    fs.copyFileSync(art.from, path.join(BOSS, art.file));
    carried.set(art.file, fs.statSync(art.from).size);
  }
  return art.file;
}

const listOf = (biome, role) => ((biome.groups || {})[role] || []).map(entry => {
  const art = bring(entry.name);
  return art ? { name: entry.name, art } : { name: entry.name };
});

/*
 * Everything RealmEye knows about a creature, by its own name for it, so a
 * roster entry can carry what it is worth killing as well as what it is
 * called.
 */
const factsOf = new Map();
for (const one of Object.values(realmEye.creatures || {})) {
  if (!one || !one.name) continue;
  const d = one.detail || {};
  factsOf.set(one.name, {
    hp: d.hp, def: d.defense, exp: d.exp,
    drops: (d.drops || []).map(x => x.name).filter(Boolean)
  });
}

const dress = list => list.map(one => {
  const facts = factsOf.get(one.name);
  if (!facts) return one;
  const out = { ...one };
  if (facts.hp !== undefined) out.hp = facts.hp;
  if (facts.def !== undefined) out.def = facts.def;
  if (facts.exp !== undefined) out.exp = facts.exp;
  if (facts.drops.length) out.drops = facts.drops;
  return out;
});

let touched = 0, noArt = new Set(), unattached = [];
const seenGround = new Set();
for (const zone of atlas.zones) {
  const id = GROUND_BIOMES[zone.ground || ''];
  const biome = id && realmEye.biomes[id];
  if (!biome) continue;
  seenGround.add(id);
  const regular = dress(listOf(biome, 'regular'));
  const encounters = dress(listOf(biome, 'encounters'));
  const heroes = dress(listOf(biome, 'heroes'));
  const guardians = dress(listOf(biome, 'beaconGuardians'));
  for (const one of [...encounters, ...heroes, ...guardians]) if (!one.art) noArt.add(one.name);
  zone.rank = biome.rank;
  // Not zone.from: that already says how the place got its name.
  zone.wiki = id;
  if (regular.length) zone.regular = regular;
  if (encounters.length) zone.encounters = encounters;
  if (heroes.length) zone.heroes = heroes;
  if (guardians.length) zone.guardians = guardians;

  /*
   * And what can fall here: every drop of everything on the roster, counted,
   * then sorted into tiers of gear and a list of named things.
   */
  const loot = new Map();
  for (const one of [...regular, ...encounters, ...heroes, ...guardians]) {
    for (const drop of one.drops || []) loot.set(drop, (loot.get(drop) || 0) + 1);
  }
  if (loot.size) zone.loot = sortTiers(loot);
  touched++;
}
for (const [id, biome] of Object.entries(realmEye.biomes)) {
  if (!seenGround.has(id)) unattached.push({ id, rank: biome.rank });
}

/* The same for the grounds themselves, so a biome can be read on its own. */
for (const biome of atlas.biomes || []) {
  const id = GROUND_BIOMES[biome.ground || ''];
  const said = id && realmEye.biomes[id];
  if (!said) continue;
  biome.rank = said.rank;
  biome.wiki = id;
  const regular = dress(listOf(said, 'regular'));
  const encounters = dress(listOf(said, 'encounters'));
  const heroes = dress(listOf(said, 'heroes'));
  if (regular.length) biome.regular = regular;
  if (encounters.length) biome.encounters = encounters;
  if (heroes.length) biome.heroes = heroes;
}

/* A beacon takes the guardian of the zone it stands in. */
const zoneById = new Map(atlas.zones.map(zone => [zone.id, zone]));
let guarded = 0;
for (const beacon of atlas.beacons) {
  const zone = zoneById.get(beacon.zone);
  if (!zone || !zone.guardians || !zone.guardians.length) continue;
  beacon.guardian = zone.guardians[0];
  guarded++;
}

/*
 * A few of them are already here.
 *
 * Five heroes were met during the walk and stand on the map as ordinary
 * wildlife - Maiden of the Sea, Alpha Werewolf, Infernal Ironsmith, the
 * Insurgent Rebel Commander, the Organ Harvester. They are marked with the
 * part they play rather than stood up a second time beside themselves, and
 * their own listing says it is already on the map so that nothing places it.
 *
 * That mark is what a zoom level has to read: the map can show the rare
 * things first and the common ones last only if each one says which it is.
 */
const roleOf = new Map();
for (const zone of atlas.zones) {
  for (const one of zone.encounters || []) roleOf.set(one.name, 'encounter');
  for (const one of zone.heroes || []) if (!roleOf.has(one.name)) roleOf.set(one.name, 'hero');
}
let tagged = 0;
function mark(list) {
  for (const one of list || []) {
    const role = roleOf.get(one.name);
    if (role) { one.role = role; tagged++; }
  }
}
for (const zone of atlas.zones) mark(zone.lives);
for (const biome of atlas.biomes) mark(biome.lives);
for (const beacon of atlas.beacons) mark(beacon.guards);

const onMap = new Set();
for (const owner of [...atlas.zones, ...atlas.biomes]) for (const one of owner.lives || []) onMap.add(one.name);
for (const beacon of atlas.beacons) for (const one of beacon.guards || []) onMap.add(one.name);
let already = 0;
for (const zone of atlas.zones) {
  for (const one of [...(zone.encounters || []), ...(zone.heroes || [])]) {
    if (onMap.has(one.name)) { one.onMap = true; already++; }
  }
}

writeFile(atlasFile, JSON.stringify(atlas, null, 1).replace(/\n/g, '\r\n') + '\r\n');

const pageFile = path.join(ATLAS, 'index.html');
const page = readFile(pageFile, 'utf8');
const inlined = /^const A = (\{.*\});$/m;
if (!inlined.test(page)) {
  console.error('index.html no longer carries "const A = {...};" on a line of its own.');
  process.exit(1);
}
writeFile(pageFile, page.replace(inlined, () => 'const A = ' + JSON.stringify(atlas) + ';'));

/* ---------------- what happened ---------------- */
const count = (key) => atlas.zones.reduce((n, z) => n + ((z[key] || []).length), 0);
console.log('zones given a rank and a cast: ' + touched + ' of ' + atlas.zones.length);
console.log('  encounters listed  ' + count('encounters'));
console.log('  heroes listed      ' + count('heroes'));
console.log('  beacons guarded    ' + guarded + ' of ' + atlas.beacons.length);
console.log('  creatures already on the map marked with their part: ' + tagged
  + ' listings, ' + already + ' of the cast entries flagged as standing there already');
console.log('');
let bytes = 0; for (const size of carried.values()) bytes += size;
console.log('boss/  ' + carried.size + ' pictures carried into the atlas, '
  + Math.round(bytes / 1024) + 'K');
console.log('');
console.log('no picture anywhere for ' + noArt.size + ' of them:');
console.log('  ' + [...noArt].sort().join(', '));
console.log('');
console.log('imported biomes with no zone to attach to:');
for (const one of unattached) {
  console.log('  ' + one.id.padEnd(19) + ' rank ' + String(one.rank).padEnd(9)
    + (one.missing ? 'no zone named "' + one.missing + '"'
      : one.encounters + ' encounters and ' + one.heroes + ' heroes go unshown'));
}
