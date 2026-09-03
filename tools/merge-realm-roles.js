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
const BIOME_ZONES = {
  'shore-plains': 'Beach',
  'shore-sand': 'Undead Forest',
  'low-forest': 'Low Forest',
  'low-desert': 'Low Desert',
  'low-plains': 'Mid Plains',
  'mid-forest': 'Nature Ruins',
  'mid-plains': 'Mid Desert',
  'high-forest': 'High Forest',
  'high-desert': 'High Desert',
  'coral-reefs': 'Coral Reef',
  'sprite-forest': 'Sprite Forest',
  'haunted-hallows': 'Haunted Hallows',
  'shipwreck-cove': 'Shipwreck Cove',
  'dead-church': 'Dead Church',
  'risen-hell': 'Risen Hell',
  'abandoned-city': 'Ancient City',
  'deep-sea-abyss': 'Deep Sea Abyss',
  'carboniferous': 'Carboniferous',
  'sanguine-forest': 'Sanguine Forest',
  'runic-tundra': 'Runic Tundra',
  /*
   * And four with nothing to attach to.
   *
   * The two seasonal ones are simply not in this realm. The other two are
   * missing because the map lost them: it has no High Plains and no Floral
   * Escape zone at all, although the capture is full of Floral Escape
   * creatures and a Floral Escape beacon guardian. Their ground was absorbed
   * into whatever the segmentation decided was next door.
   */
  'high-plains': 'High Plains',
  'floral-escape': 'Floral Escape',
  'eternal-frost': null,
  'spring-of-meaning': null
};

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
 * Patient writing.
 *
 * This runs straight after the atlas has been built, and on Windows the virus
 * scanner is still holding some of what was just written. It comes back as
 * UNKNOWN rather than as a sharing violation, it lands on a different file
 * each time, and it is over in a moment - so it is waited out. Failing here
 * is worse than slow: the chain carries on to the next tool, which then works
 * on an atlas that was never merged. refine-outline.js does the same thing
 * for the same reason.
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

let touched = 0, noArt = new Set(), unattached = [];
for (const [id, zoneName] of Object.entries(BIOME_ZONES)) {
  const biome = realmEye.biomes[id];
  if (!biome) continue;
  const encounters = listOf(biome, 'encounters');
  const heroes = listOf(biome, 'heroes');
  const guardians = listOf(biome, 'beaconGuardians');
  for (const one of [...encounters, ...heroes, ...guardians]) if (!one.art) noArt.add(one.name);
  if (!zoneName) {
    unattached.push({ id, rank: biome.rank, encounters: encounters.length, heroes: heroes.length });
    continue;
  }
  const zones = atlas.zones.filter(zone => zone.name === zoneName);
  if (!zones.length) { unattached.push({ id, rank: biome.rank, missing: zoneName }); continue; }
  for (const zone of zones) {
    zone.rank = biome.rank;
    if (encounters.length) zone.encounters = encounters;
    if (heroes.length) zone.heroes = heroes;
    if (guardians.length) zone.guardians = guardians;
    touched++;
  }
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
