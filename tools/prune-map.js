'use strict';
/*
 * Take off the map the things that are not scenery and not wildlife.
 *
 *   node tools/prune-map.js
 *
 * A walked capture records whatever was standing on the ground at the moment
 * it was walked, and some of what was standing there does not belong on a map
 * of a place. Loot lay where it had dropped. A monster's attack was in the
 * air. The satellites that orbit a monster were logged as creatures in their
 * own right, so the atlas gave them zones to wander and set them walking.
 *
 * None of it is guessable from the file: things.bin names nothing, only
 * rectangles into things.png, so every one of these was found by looking at
 * the sheet - grouping it by silhouette to find one shape in several colours,
 * which is what a set of loot bags looks like, and reading the creature list
 * for the names the client gives its own effects.
 *
 * What is taken is listed below, with what it was recognised as. What is
 * deliberately left is listed too, because "why is this still here" is the
 * question this file exists to answer.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ATLAS = path.join(root, 'web', 'assets', 'atlas');

/*
 * Loot, and one attack, standing in things.bin.
 *
 * The bags are one silhouette in four colours - brown, magenta, purple, blue
 * - which is how they were found. The nine reds are a second silhouette, all
 * of them the same red. The last six are one dark-eyed orb in six variants,
 * an attack rather than a thing.
 */
const DROP_THINGS = [
  942, 947, 1000, 1037,                                  // loot bags
  918, 919, 920, 954, 1711, 1712, 1871, 1916, 1921,      // red loot, nine of them
  117, 178, 328, 283, 390, 831,                          // the dark-eyed orb
  460, 598, 599                                          // the pale wisps, each with its bubble
];

/*
 * Named in the creature list, but not creatures.
 *
 * A satellite is a projectile held in orbit round its owner. A laser, a trap,
 * a whirlpool and a shield are attacks. All were given zones to walk in.
 */
const DROP_LIVES = [
  'New Gray Satellite 1', 'New Gray Satellite 2', 'New Gray Satellite 3',
  'New Green Satellite', 'New Red Satellite', 'Flesh Satellite',
  'Daughter of Limon Laser', 'New Left Horizontal Trap', 'New Top Vertical Trap',
  'Shipwreck Hag Whirlpool', 'New Shield Orc Shield'
];

/*
 * Left where they are, and marked instead.
 *
 * These stand still and make other creatures, which is worth seeing rather
 * than hiding - so they keep their place and carry a flag saying what they
 * are, for whatever wants to list them apart from the wildlife.
 */
const SPAWNERS = [
  'New KageSpawner', 'Hornet’s Nest', 'Giant Critter Egg', 'New Dragon Egg'
];

/*
 * Also left alone, on purpose: Daughter of Limon Portal, the Floral Escape
 * teleport point, New Train Cart 1, Tombstone and Barnacle Rock. They are
 * props rather than creatures and the lists would read better without them,
 * but nothing about them is wrong on the map itself.
 */

/* ---------------- the things ---------------- */
const things = JSON.parse(fs.readFileSync(path.join(ATLAS, 'things.json'), 'utf8'));
const raw = fs.readFileSync(path.join(ATLAS, 'things.bin'));
const at = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const drop = new Set(DROP_THINGS);

/*
 * The file is one flat run of (pic, x, y) triples and the chunk table says
 * where each chunk's run starts and how long it is. Dropping entries means
 * writing a new run and a new table together; the chunks are walked in the
 * order the table gives so that a chunk stays contiguous.
 */
const kept = [];
const table = {};
let removed = 0;
for (const [key, span] of Object.entries(things.chunks)) {
  const from = kept.length / 3;
  for (let i = 0; i < span[1]; i++) {
    const t = (span[0] + i) * 3;
    if (drop.has(at[t])) { removed++; continue; }
    kept.push(at[t], at[t + 1], at[t + 2]);
  }
  const count = kept.length / 3 - from;
  if (count) table[key] = [from, count];
}
const out = Buffer.alloc(kept.length * 2);
for (let i = 0; i < kept.length; i++) out.writeUInt16LE(kept[i], i * 2);
fs.writeFileSync(path.join(ATLAS, 'things.bin'), out);

// And the pictures themselves, so nothing can draw them again. The art stays
// in the sheet where it is - repacking it would move every other rectangle -
// but no rectangle points at it any more.
let blanked = 0;
for (const id of DROP_THINGS) if (things.pics[id]) { things.pics[id] = null; blanked++; }
things.chunks = table;
fs.writeFileSync(path.join(ATLAS, 'things.json'), JSON.stringify(things));

const was = raw.length / 6;
console.log('things.bin  ' + was.toLocaleString() + ' placements -> '
  + (kept.length / 3).toLocaleString() + ', ' + removed.toLocaleString() + ' taken off ('
  + (100 * removed / was).toFixed(2) + '%), ' + blanked + ' pictures unhooked');
console.log('            chunks ' + Object.keys(things.chunks).length + ' of '
  + (Object.keys(table).length + 0) + ' still hold something');

/* ---------------- the creature lists ---------------- */
const atlasFile = path.join(ATLAS, 'atlas.json');
const atlas = JSON.parse(fs.readFileSync(atlasFile, 'utf8'));
const gone = new Set(DROP_LIVES);
const spawner = new Set(SPAWNERS);
const stillNamed = new Set();
let dropped = 0, flagged = 0;

function prune(list) {
  if (!list) return list;
  const keep = [];
  for (const one of list) {
    if (gone.has(one.name)) { dropped++; continue; }
    if (spawner.has(one.name)) { one.spawner = true; flagged++; }
    stillNamed.add(one.name);
    keep.push(one);
  }
  return keep;
}
for (const zone of atlas.zones) zone.lives = prune(zone.lives);
for (const biome of atlas.biomes) biome.lives = prune(biome.lives);
for (const beacon of atlas.beacons) beacon.guards = prune(beacon.guards);

fs.writeFileSync(atlasFile, JSON.stringify(atlas, null, 1).replace(/\n/g, '\r\n') + '\r\n');
console.log('atlas.json  ' + dropped + ' listings dropped across zones, biomes and beacons; '
  + flagged + ' marked as spawners');

/* The page keeps its own copy of that on one line. */
const pageFile = path.join(ATLAS, 'index.html');
const page = fs.readFileSync(pageFile, 'utf8');
const inlined = /^const A = (\{.*\});$/m;
if (!inlined.test(page)) {
  console.error('index.html no longer carries "const A = {...};" on a line of its own. '
    + 'It is now out of step with atlas.json.');
  process.exit(1);
}
fs.writeFileSync(pageFile, page.replace(inlined, () => 'const A = ' + JSON.stringify(atlas) + ';'));
console.log('index.html  the inlined copy replaced');

/* ---------------- sprites nothing asks for any more ---------------- */
const lifeDir = path.join(ATLAS, 'life');
const wanted = new Set();
for (const owner of [...atlas.zones, ...atlas.biomes]) for (const one of owner.lives || []) wanted.add(one.sprite.file);
for (const beacon of atlas.beacons) for (const guard of beacon.guards || []) wanted.add(guard.sprite.file);
let deleted = 0, freed = 0;
const stuck = [];
for (const name of fs.readdirSync(lifeDir)) {
  if (!name.endsWith('.png') || wanted.has(name)) continue;
  // A dev server that has served the file keeps a handle on it under Windows
  // and the delete comes back EPERM. An orphan left on disk is harmless -
  // nothing points at it - so say so and carry on rather than stopping with
  // the atlas already rewritten.
  try {
    const size = fs.statSync(path.join(lifeDir, name)).size;
    fs.unlinkSync(path.join(lifeDir, name));
    freed += size; deleted++;
  } catch (error) { stuck.push(name + ' (' + error.code + ')'); }
}
console.log('life/       ' + deleted + ' sprites nothing points at any more, '
  + Math.round(freed / 1024) + 'K'
  + (stuck.length ? '; could not remove ' + stuck.join(', ') : ''));
console.log('');
console.log(stillNamed.size + ' creatures still named on the map');
