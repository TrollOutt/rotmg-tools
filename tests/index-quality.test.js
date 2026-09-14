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
const realmBiomeDir = path.join(root, 'web', 'assets', 'realm-biomes');
const realmBiomeManifest = JSON.parse(
  fs.readFileSync(path.join(realmBiomeDir, 'index.json'), 'utf8')
);

function realmBiomeIcon(name) {
  const entry = realmBiomeManifest.beacons[name];
  assert(entry, name + ' must exist in the RealmEye biome manifest');

  const file = path.join(realmBiomeDir, entry.file);
  assert(fs.existsSync(file), name + ' RealmEye beacon file must exist');

  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : 'image/png';

  return 'data:' + mime + ';base64,'
    + fs.readFileSync(file).toString('base64');
}

for (const name of ['Carboniferous', 'Runic Tundra']) {
  const place = records.get('place:' + name);

  assert(place, name + ' place record must exist');
  assert.equal(
    place.icon,
    realmBiomeIcon(name),
    name + ' must display the locally imported RealmEye beacon'
  );
  assert(
    !place.art,
    name + ' must not fall back to Atlas sprite coordinates'
  );
}
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
assert(/const anchorName = asked\[0\][\s\S]{0,700}aIsAnchor[\s\S]{0,700}bIsAnchor/.test(pageSource),
  'the record named by the first category must be pinned ahead of ordinary sub-category results');

/*
 * What a character looks like.
 *
 * The index once held the 1,367 consumables that hand a skin over and none of
 * the appearances themselves, because the pass that fills it asks for <Item />
 * and a skin carries <Skin />. The Skin Viewer therefore kept a catalogue of
 * its own and a name-matched bridge back to here.
 *
 * The three joins the client states outright are checked here, so a build that
 * silently stops making one cannot pass. None of them is a name match: the
 * unlocker and the set each name their skin by type, and the skin names its
 * class by type.
 */
const skins = [...records.values()].filter(one => one.kind === 'skin');
assert(skins.length > 1400, 'every appearance the client declares belongs in the index');

const linked = (one, how, direction) =>
  ((direction === 'in' ? one.in : one.out) || []).some(([said]) => said === how);

assert(skins.filter(one => one.art).length > skins.length * 0.95,
  'a skin is a picture before it is anything else; almost all must carry one');
assert(skins.filter(one => linked(one, 'worn by', 'out')).length > 1400,
  'a skin names the class that wears it, by type');
assert(skins.filter(one => linked(one, 'unlocks', 'in')).length > 1300,
  'the consumable that hands a skin over names it by type');
assert(skins.filter(one => linked(one, 'dresses you as', 'in')).length > 80,
  'an equipment set names the skin it dresses you as, by type');

/* Both halves point at each other, and are told apart rather than merged. */
const djinja = records.get('skin:Baby Djinja');
assert(djinja, 'a known skin must be in the index under its own kind');
assert.deepEqual(djinja.out.find(([how]) => how === 'worn by'), ['worn by', 'class:Ninja']);
const unlocker = records.get('item:Baby Djinja Skin');
assert(unlocker && unlocker.family === 'skin unlocker',
  'the thing in the bag is a skin unlocker, not a skin: one word for two things hid both');
assert.deepEqual(unlocker.out.find(([how]) => how === 'unlocks'),
  ['unlocks', 'skin:Baby Djinja']);

/* Nothing is attached to the nearest similar name. */
for (const one of skins) {
  for (const [how, to] of one.in || []) {
    if (how !== 'unlocks' && how !== 'dresses you as') continue;
    assert(records.has(to), 'a skin may only be joined to something the client declares');
  }
}

assert(/group\('Skins', 'client'/.test(pageSource),
  'the rail must offer skins, or fifteen hundred records have no way in but a name');
assert(/x\.kind === 'skin'[\s\S]{0,120}how === 'worn by'/.test(pageSource),
  'a class category must gather the appearances that class wears');

/*
 * The costume, which is the one thing about a skin the client does not say.
 *
 * It is read off the name, so it is `look` and never `family`: a reader must
 * be able to tell a declaration from a deduction at a glance, and the card
 * says where it came from. The rule only keeps a stem two or more skins
 * arrive at, so a one-off like "Bandit Rogue" stays a one-off rather than
 * being filed under an invented "Bandit".
 */
const costumed = skins.filter(one => one.look);
assert(costumed.length > 380 && costumed.length < skins.length * 0.4,
  'a name-derived costume describes about a third of the skins, and claiming more is a guess');
const perCostume = new Map();
for (const one of costumed) perCostume.set(one.look, (perCostume.get(one.look) || 0) + 1);
for (const [said, many] of perCostume) {
  assert(many >= 2, 'a costume of one is not a costume: ' + said);
}
assert.equal(records.get('skin:Cozy Archer').look, 'Cozy');
assert.equal(records.get('skin:Bandit Rogue').look, undefined,
  'a skin no other skin shares a stem with keeps no costume');
for (const one of skins) {
  assert(one.family === undefined,
    'a skin carries `look`, never `family`: one is deduced and the other declared');
}
assert(/costume[\s\S]{0,80}read off the name/.test(pageSource),
  'the card must say the costume was read off the name rather than declared');

/*
 * There is more than one sub category now.
 *
 * drawTypes() asked for `groups.find(one => one.inSub)` - the first one - so
 * adding Costume beside Kind of gear built, counted and narrowed it correctly
 * and never drew it.
 */
assert(!/groups\.find\(one => one\.inSub\)/.test(pageSource),
  'the middle column must draw every sub category, not only the first');
assert(/groups\.filter\(one => one\.inSub\)/.test(pageSource),
  'the middle column must draw every sub category, not only the first');


/*
 * The portals that turn over.
 *
 * A portal shimmers in the game and the client says how - an <Animation> on
 * the object with a <Frame time="..."> for each picture in turn. Nothing here
 * read that block until now; the index cuts those frames onto its sheet as
 * one strip so anything drawing a dungeon can play it.
 *
 * The times are not even - the Snake Pit rests for a second and a fifth and
 * then flickers six times - so the durations are carried beside the strip and
 * must stay in step with it.
 */
const turning = [...records.values()].filter(one => one.film);
assert(turning.length > 40, 'the client animates fifty portals; the index must hold them');
for (const one of turning) {
  assert.equal(one.kind, 'portal',
    one.id + ': only portals are cut as strips, or the sheet grows for pictures nothing plays');
  const [x, y, w, h, count] = one.film;
  assert(count > 1, one.id + ': a strip of one frame is a still picture');
  assert.equal(one.filmFor.length, count,
    one.id + ': ' + count + ' frames but ' + one.filmFor.length + ' durations');
  for (const ms of one.filmFor) {
    assert(Number.isInteger(ms) && ms >= 20, one.id + ': a frame lasts a readable number of milliseconds');
  }
  /* The whole strip has to be on the sheet, or it plays off the edge of it. */
  assert(x >= 0 && y >= 0 && x + w * count <= index.sheet.wide && y + h <= index.sheet.tall,
    one.id + ': its strip runs off the sheet');
}
/*
 * And a portal whose still picture belongs to something else as well.
 *
 * The sheet carries one copy of a rectangle, so a record whose still picture
 * was already cut for a neighbour took that copy and moved on - taking its
 * animation with it. These five share their still picture with something
 * (the Alien wormholes with their own realms, the Halloween cemetery with
 * the ordinary one) and stopped turning over while the dungeons beside them
 * kept going.
 */
for (const name of ['Forax', 'Katalund', 'Malogia', 'Untaris', 'Halloween Haunted Cemetery']) {
  const one = records.get('portal:' + name);
  assert(one, name + ' must be a portal in the index');
  assert(one.film, name + ' shares its still picture with something else and must still turn over');
}

const snakePit = records.get('portal:Snake Pit');
assert(snakePit && snakePit.film, 'the Snake Pit is one of the animated ones');
assert(new Set(snakePit.filmFor).size > 1,
  'its frames are not evenly spaced, which is why the durations are kept');


/*
 * Every family the index can file something under has a colour.
 *
 * The badge on a row is coloured by the family it belongs to, and eight of
 * the twenty-eight labels had a rule while the other twenty fell through to
 * grey - so a list read as three deliberate colours among a crowd of
 * mistakes. Nobody chose that; it happened because a family was added to the
 * data and nothing said the stylesheet had to hear about it. This is what
 * says so.
 */
{
  const filedAs = one => one.family || (one.use ? 'use' : one.kind);
  const families = new Set();
  for (const one of index.records) {
    if (one.folded) continue;
    families.add(String(filedAs(one)).replace(/ /g, '-'));
  }
  assert(families.size > 20, 'the index files things under a good many families');
  const coloured = new Set();
  for (const rule of styleSource.matchAll(/\.ix-kind[^{]*\{[^}]*\}/g)) {
    for (const one of rule[0].matchAll(/\.is-([a-z0-9-]+)/g)) coloured.add(one[1]);
  }
  const grey = [...families].filter(one => one !== 'other' && !coloured.has(one));
  assert.equal(grey.length, 0, grey.length
    + ' famil(y/ies) would show a grey badge because the stylesheet has no colour for them: '
    + grey.join(', '));
}

/*
 * And the rail's colours are the site's, not new ones invented for it.
 *
 * Eight of the ten group hues used to be literals that appear nowhere else -
 * a teal, a periwinkle, a pink, a muted red. They are named now and drawn
 * from the palette at the top of the stylesheet.
 */
{
  const hues = [...styleSource.matchAll(/\[data-key="[a-z-]+"\]\s*\{\s*--ix-hue:\s*([^;]+);/g)]
    .map(one => one[1].trim());
  assert(hues.length >= 8, 'every group in the rail must name its colour');
  for (const hue of hues) {
    assert(/^var\(--[a-z-]+\)$/.test(hue),
      'a group colour must be one the site already declares, not a literal: ' + hue);
  }
}

console.log('Index common-entry, taxonomy, dungeon-link, and atlas-place checks passed.');
console.log(skins.length + ' skins, joined to class, unlocker and set by the client’s own types.');
console.log(turning.length + ' portals carry the frames they turn over, with the client’s own timings.');
