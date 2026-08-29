/*
 * Reproducible checks for web/engine.js. Run with:  node tests/engine.test.js
 *
 * Nothing here touches the DOM. The dataset is read straight from the original
 * Qt data files, so a change in the data or in a rule shows up as a failure.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataRoot = path.join(root, 'data');
const engine = require(path.join(root, 'web', 'engine.js'));

const NEWLINE = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');
const read = (...parts) => fs.readFileSync(path.join(dataRoot, ...parts), 'utf8');

const data = engine.buildDataset({
  clientModText: read('Enchantment documents', 'client-enchantments.txt'),
  clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt'),
  awokenExtraText: read('Awakened Items', 'awoken-items.txt')
});

/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function near(name, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  check(name, ok, `got ${actual}, expected ${expected} ±${tolerance}`);
}
function section(title) { console.log(`\n${title}`); }

const artifact = name => data.byArtifact.get(name);
const baseCfg = extra => Object.assign({
  slots: 4, type: 'RING', dust: 'Red', item: '', subtypes: new Set(), tiers: new Set([1, 2, 3, 4]),
  locks: [], desired: '', goals: []
}, extra);

/* ------------------------------------------------------------------ *
 * 1. Data loading                                                     *
 * ------------------------------------------------------------------ */
section('1. Data loading');
// Everything the client defines is kept; which of it can be drawn is the
// pool's business. 291 rollable, and 34 that are not — the seasonal
// enchantments an engraving guarantees, the legacy ones, Crown, and Damage
// Resistance. None of them can be drawn without an artifact that asks for it.
check('325 enchantments', data.enchants.length === 325, `got ${data.enchants.length}`);
check('291 of them are rollable', (() => {
  return data.enchants.filter(mod => mod.tags.has('ROLLABLE')).length === 291;
})(), String(data.enchants.filter(mod => mod.tags.has('ROLLABLE')).length));

check('and no pool a player can reach lets it in', (() => {
  // Every pool the client defines requires ROLLABLE, including the default one
  // rolled into without an artifact. Nothing filters it out globally; nothing
  // needs to.
  const cfg = baseCfg({ type: 'ARMOR', item: '', desired: 'Candy-Coated' });
  return data.artifacts.every(art =>
    !engine.eligiblePool(data, cfg, art).some(mod => mod.name === 'Damage Resistance'));
})(), data.artifacts.filter(art => engine.eligiblePool(data,
  baseCfg({ type: 'ARMOR', item: '', desired: 'Candy-Coated' }), art)
  .some(mod => mod.name === 'Damage Resistance')).map(a => a.name).join(', '));
// 50 the client labels ARTIFACT, plus the "No Artifact" row it has no record
// for, because in the game that is simply not using the enchanter's slot.
check('51 artifacts, none held back', data.artifacts.length === 51 && data.heldArtifacts.length === 0,
  `${data.artifacts.length} ranked, held: ${data.heldArtifacts.map(a => a.name).join(', ')}`);

check('the four the client does not label ARTIFACT are not ranked', (() => {
  // Three developer test items and Night Prince Engraving, whose description
  // says it can be used as an artifact but which the game does not label as
  // one. All four cost nothing and are never consumed, and Night Prince also
  // carries a x999 on UNIQUE and a x9999 on AWAKENED, which made it the
  // answer to every question a player could ask.
  const names = new Set(data.artifacts.map(a => a.name));
  return !names.has('Night Prince Engraving') && !names.has('Unique Test Artifact')
    && !names.has('Tier 4 Test Artifact') && !names.has('Awakened Test Artifact');
})());
check('where the client keeps two records under one name, the rollable one wins', (() => {
  // The twins are not the same enchantment with a flag: Alien OnShoot Attack
  // Boost is 15000 and requires Alien gear as the rollable record, 10000 and
  // requires nothing as the other. Reading whichever came last in the file is
  // what once had me report weights that were a third too low across the
  // whole alien set.
  const rows = read('Enchantment documents', 'client-enchantments.txt')
    .split(NEWLINE).filter(line => line.startsWith('ench|')).map(line => line.split('|'));
  for (const row of rows) {
    if (!row[4].split(',').includes('ROLLABLE')) continue;
    const mod = data.byName.get(row[1]);
    if (!mod || mod.weight !== Number(row[2])) return false;
    if ([...mod.special].join(',') !== row[7]) return false;
  }
  return true;
})());
check('no rollable record was lost to the de-duplication', (() => {
  // The client keeps a non-rollable twin of many enchantments under the same
  // display name; they collapse to one record here and the rollable one wins.
  // Keeping whichever came last is what once made 105 enchantments look as if
  // they had gone from the game.
  const rows = read('Enchantment documents', 'client-enchantments.txt')
    .split(NEWLINE).filter(line => line.startsWith('ench|'));
  const rollable = new Set(rows.filter(line => line.split('|')[4].split(',').includes('ROLLABLE'))
    .map(line => line.split('|')[1]));
  const kept = new Set(data.enchants.filter(mod => mod.tags.has('ROLLABLE')).map(mod => mod.name));
  return rollable.size === kept.size && [...rollable].every(name => kept.has(name));
})());
check('Death Tarot Card cost parses despite the stray space', artifact('Death Tarot Card').cost.value === 25 && artifact('Death Tarot Card').cost.dust === 'Green');
check('The Moon Tarot Card is billed in Green dust, not Red', artifact('The Moon Tarot Card').cost.dust === 'Green');
check('every artifact names a pool the client defines',
  data.artifacts.every(a => a.name === 'No Artifact' || a.pool),
  data.artifacts.filter(a => a.name !== 'No Artifact' && !a.pool).map(a => a.name).join(', '));

check('not every pool is simply everything rollable', (() => {
  // Assuming they were is what made the Valentine engravings, which draw from
  // ROLLABLE,VALENTINES, impossible to describe.
  const odd = data.artifacts.filter(a => a.entry.include
    && !(a.entry.include.size === 1 && a.entry.include.has('ROLLABLE')));
  return odd.length > 0;
})());

check('no ranked artifact names an enchantment we do not carry', (() => {
  const known = new Set(data.enchants.map(mod => mod.name));
  return data.artifacts.every(a => [...a.entry.names].every(name => known.has(name)));
})());

check('the client states a consumption chance per artifact, and it is not always half', (() => {
  const values = new Set(data.artifacts.filter(a => a.name !== 'No Artifact').map(a => a.consumeProb));
  return values.size > 1 && values.has(0.5) && values.has(1);
})(), [...new Set(data.artifacts.map(a => a.consumeProb))].join(', '));

/* ------------------------------------------------------------------ *
 * 1b. Alien and Neo Alien are equipment families                      *
 * ------------------------------------------------------------------ *
 * An enchantment of a family only goes on equipment of that same
 * family. Unlike the Qt source, an artifact declaring the pool does
 * not stand in for the item: see NOTES.alienBase.
 */
section('1b. Alien and Neo Alien bases');

const ALIEN_MODS = data.enchants.filter(m => m.special.has('ALIEN'));
const NEO_MODS = data.enchants.filter(m => m.special.has('NEO_ALIEN'));
// WEAPON, because the Heal and Magic variants are weapon/ring only: on ARMOR
// their absence would prove nothing about the family rule.
const inPool = (mod, subtypes, artifactName) =>
  engine.eligiblePool(data, baseCfg({ type: 'WEAPON', subtypes: new Set(subtypes) }), artifact(artifactName))
    .some(m => m.name === mod.name);

check('7 enchantments require an Alien base', ALIEN_MODS.length === 7, `got ${ALIEN_MODS.length}`);
check('all 14 are rollable on a weapon, so the checks below are meaningful',
  [...ALIEN_MODS, ...NEO_MODS].every(m => m.itemTags.has('WEAPON')));
check('7 enchantments require a Neo Alien base', NEO_MODS.length === 7, `got ${NEO_MODS.length}`);
check('no enchantment requires both families at once',
  data.enchants.every(m => !(m.special.has('ALIEN') && m.special.has('NEO_ALIEN'))));

check('ordinary gear cannot take an Alien enchantment',
  ALIEN_MODS.every(m => !inPool(m, [], 'No Artifact')));
check('ordinary gear cannot take a Neo Alien enchantment',
  NEO_MODS.every(m => !inPool(m, [], 'No Artifact')));

// The regression this suite missed: the four Technology artifacts declare
// pools=[ALIEN], and the Qt source lets that satisfy the requirement.
check('a Technology artifact does not put an Alien enchantment on ordinary gear',
  ['Malogia Technology', 'Untaris Technology', 'Katalund Technology', 'Forax Technology']
    .every(name => ALIEN_MODS.every(m => !inPool(m, [], name))));

check('an Alien base takes its own enchantments with no artifact at all',
  ALIEN_MODS.every(m => inPool(m, ['ALIEN'], 'No Artifact')));
check('a Neo Alien base takes its own enchantments with no artifact at all',
  NEO_MODS.every(m => inPool(m, ['NEO_ALIEN'], 'No Artifact')));

check('an Alien base refuses Neo Alien enchantments',
  NEO_MODS.every(m => !inPool(m, ['ALIEN'], 'No Artifact')));
check('a Neo Alien base refuses Alien enchantments',
  ALIEN_MODS.every(m => !inPool(m, ['NEO_ALIEN'], 'No Artifact')));

check('the divergence from the Qt source is written down',
  /NEO_ALIEN/.test(engine.NOTES.alienBase) && /DIVERGENCE/.test(engine.NOTES.alienBase));

/* ------------------------------------------------------------------ *
 * 2. Awoken rules                                                     *
 * ------------------------------------------------------------------ */
section('2. Awoken enchantments are item-specific');
const nightsSoul = data.byName.get("Night's Soul");
check("Night's Soul carries the AWAKENED incompatibility", nightsSoul.excludes.has('AWAKENED'));
check("Night's Soul is available on Nightmatter Circlet",
  engine.eligiblePool(data, baseCfg({ item: 'Nightmatter Circlet' }), artifact('No Artifact')).some(m => m.name === "Night's Soul"));
check("Night's Soul is available on AoO Rings (source data)",
  engine.eligiblePool(data, baseCfg({ item: 'AoO Rings' }), artifact('No Artifact')).some(m => m.name === "Night's Soul"));
check("Night's Soul is refused on Corsair Ring",
  !engine.eligiblePool(data, baseCfg({ item: 'Corsair Ring' }), artifact('No Artifact')).some(m => m.name === "Night's Soul"));
check("Night's Soul is refused when no item is chosen",
  !engine.eligiblePool(data, baseCfg({ item: '' }), artifact('No Artifact')).some(m => m.name === "Night's Soul"));
check('no awakened enchantment leaks into a plain ring pool',
  engine.eligiblePool(data, baseCfg({ item: '' }), artifact('No Artifact')).every(m => !m.excludes.has('AWAKENED')));
check('choosing an item adds exactly its own awakened enchantments', (() => {
  const withItem = engine.eligiblePool(data, baseCfg({ item: 'Nightmatter Circlet' }), artifact('No Artifact')).map(m => m.name);
  const without = new Set(engine.eligiblePool(data, baseCfg({ item: '' }), artifact('No Artifact')).map(m => m.name));
  const added = withItem.filter(name => !without.has(name));
  return added.length === 1 && added[0] === "Night's Soul";
})());

/* ------------------------------------------------------------------ *
 * 2b. Every awakenable item, not just the ones named individually     *
 * ------------------------------------------------------------------ *
 * The Qt file names ten of its entries after a group — "AoO Rings",
 * "Matrix Armors" — and the interface looks items up by their own
 * name, so 39 of the catalogue's items were served and the rest of
 * the Agents of Oryx and Protective Matrix gear got nothing.
 */
section('2b. The wiki mapping reaches the items behind the group names');

const awokenPairs = read('Awakened Items', 'awoken-items.txt')
  .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('##'));
const catalogue2b = require(path.join(root, 'web', 'items.js'));
catalogue2b.load(JSON.parse(fs.readFileSync(path.join(root, 'web', 'item-catalog.json'), 'utf8')));

check('the mapping file is well formed and free of duplicates', (() => {
  const seen = new Set();
  for (const line of awokenPairs) {
    if (!/^[^|]+\|[^|]+$/.test(line)) return false;
    if (seen.has(line)) return false;
    seen.add(line);
  }
  return awokenPairs.length > 140;
})(), `${awokenPairs.length} pairs`);

check('every item it names is in the catalogue', (() => {
  for (const line of awokenPairs) {
    const item = line.slice(0, line.indexOf('|'));
    if (!catalogue2b.lookup(item)) return false;
  }
  return true;
})());

check('every enchantment it names exists in the mod files', (() => {
  for (const line of awokenPairs) {
    const mod = line.slice(line.indexOf('|') + 1);
    if (!data.byName.has(mod)) return false;
  }
  return true;
})());

check('every enchantment it names is an awakened one', (() => {
  for (const line of awokenPairs) {
    const mod = data.byName.get(line.slice(line.indexOf('|') + 1));
    if (!mod || !mod.excludes.has('AWAKENED')) return false;
  }
  return true;
})());

// The point of the whole exercise: a real item behind a group name.
check('a Protective Matrix armor is offered its four Matrix enhancements', (() => {
  const mods = data.awakenings.get('Fitted Protective Matrix') || [];
  return ['Malogian', 'Untarian', 'Katalonian', 'Foraxian']
    .every(planet => mods.some(name => name.startsWith(planet)));
})(), (data.awakenings.get('Fitted Protective Matrix') || []).join(', '));

check('an Agents of Oryx weapon is offered its awakened enchantment',
  (data.awakenings.get('Legion Elite Bow') || []).includes("Night's Strength"));

check('a Tomb ring is offered its awakened enchantment',
  (data.awakenings.get('Ring of the Nile') || []).includes("Ancient's Blessing"));

check('the Neo variant keeps its own enchantment, not the ordinary one', (() => {
  const neo = data.awakenings.get('Neo Acidic Slasher') || [];
  return neo.includes('Acid Guardian (Neo)') && !neo.includes('Acid Guardian');
})(), (data.awakenings.get('Neo Acidic Slasher') || []).join(', '));

check('130 catalogue items are offered their awakened enchantment', (() => {
  const none = artifact('No Artifact');
  let served = 0;
  for (const [item, mods] of data.awakenings) {
    const entry = catalogue2b.lookup(item);
    if (!entry) continue;                       // a group name, unreachable by design
    const cfg = baseCfg({ type: entry.type, item, subtypes: new Set(entry.base ? [entry.base] : []) });
    const pool = engine.eligiblePool(data, cfg, none).map(mod => mod.name);
    if (mods.every(mod => pool.includes(mod))) served++;
  }
  return served >= 130;
})(), (() => {
  let served = 0;
  const none = artifact('No Artifact');
  for (const [item, mods] of data.awakenings) {
    const entry = catalogue2b.lookup(item);
    if (!entry) continue;
    const cfg = baseCfg({ type: entry.type, item, subtypes: new Set(entry.base ? [entry.base] : []) });
    const pool = engine.eligiblePool(data, cfg, none).map(mod => mod.name);
    if (mods.every(mod => pool.includes(mod))) served++;
  }
  return `${served} served`;
})());

// Group artwork exists only for the Qt names; asking for it for the rest would
// be a request for a picture that was never shipped.
check('group artwork is claimed only for the names the Qt file lists', (() => {
  const qt = engine.parseAwakenings(read('Awakened Items', 'awakenedItems.txt'));
  return data.awokenArt.size === qt.size
    && [...data.awokenArt].every(name => qt.has(name))
    && data.awokenArt.size < data.awakenings.size;
})(), `${data.awokenArt.size} with artwork, ${data.awakenings.size} in total`);

/* ------------------------------------------------------------------ *
 * 2c. Checked against DECA's own published list                       *
 * ------------------------------------------------------------------ *
 * The weights come from a snapshot of the Qt program, and a snapshot
 * goes stale the moment DECA changes anything. DECA publishes the
 * "Equipment Rarity Public List"; tools/fetch-deca.js reads it and
 * freezes the comparison into tools/deca-weights.txt so this can run
 * with no network. It found three real faults on its first run.
 */
section("2c. Agreement with DECA's Equipment Rarity Public List");

const decaRows = fs.readFileSync(path.join(root, 'tools', 'deca-weights.txt'), 'utf8')
  .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('##'))
  .map(line => {
    const [name, weight, split, labels, incompatible] = line.split('|');
    return {
      name,
      weight: Number(weight),
      split: split ? split.split(' ').map(Number) : null,
      labels: labels ? labels.split(',') : [],
      incompatible: incompatible ? incompatible.split(',') : []
    };
  });

// DECA's sheet lists what the game defines, including what it never rolls.
// We ship only the rollable ones, so a row for a non-rollable enchantment has
// nothing here to compare against — and saying which ones those are, by name,
// is the point: if the list ever grows, these checks say so.
const NOT_ROLLABLE = new Set(['Damage Resistance']);
const decaComparable = decaRows;

check('every row it lists exists here, non-rollable ones included', (() => {
  // The sheet lists what the game defines. So do we now, so nothing is skipped.
  return decaRows.every(row => data.byName.has(row.name));
})(), decaRows.filter(row => !data.byName.has(row.name)).map(row => row.name).join(', '));

// A tiered enchantment is four rows there and one record here, each carrying
// its own tier label. That is a difference of description, not of substance.
const withoutTiers = list => list.filter(label => !/^TIER([1-4]|ED)$/.test(label)).sort().join(',');

check('the frozen DECA comparison covers most of the enchantments',
  decaRows.length >= 240, `${decaRows.length} of ${data.enchants.length}`);

check('every enchantment it names still exists here',
  decaComparable.every(row => data.byName.has(row.name)));

check('every weight matches what DECA publishes', (() => {
  const off = decaComparable.filter(row => data.byName.get(row.name).weight !== row.weight);
  return off.length === 0;
})(), (() => {
  const off = decaComparable.filter(row => data.byName.get(row.name) && data.byName.get(row.name).weight !== row.weight);
  return off.slice(0, 3).map(row => `${row.name}: ${data.byName.get(row.name).weight} vs ${row.weight}`).join(' ; ');
})());

check('every tier split matches, to five decimals', (() => {
  for (const row of decaComparable) {
    if (!row.split) continue;
    const ours = data.byName.get(row.name).distribution;
    if (row.split.some((share, index) => Math.abs(share - (ours[index] || 0)) > 0.0005)) return false;
  }
  return true;
})());

/*
 * One documented exception. The installed client gives Draconic Gaze
 * IncompatibleWithEnchantmentLabels = AWAKENED,DAMAGING,SINGLESTAT; the
 * spreadsheet says DUALSTAT. The client is the game that is running, and
 * Draconic Gaze carries SINGLESTAT itself, which is the shape every other
 * record follows — an enchantment excludes its own kind. The sheet is behind
 * here, so the divergence is named rather than re-frozen away.
 */
const DECA_BEHIND = new Set(['Draconic Gaze']);

check('every set of Labels matches, bar the one the client settles', (() => {
  for (const row of decaComparable) {
    if (!row.labels.length || DECA_BEHIND.has(row.name)) continue;
    if (withoutTiers([...data.byName.get(row.name).tags]) !== withoutTiers(row.labels)) return false;
  }
  return true;
})());


check('every set of Incompatible Labels matches, bar the one the client settles', (() => {
  for (const row of decaComparable) {
    if (!row.incompatible.length || DECA_BEHIND.has(row.name)) continue;
    const ours = [...data.byName.get(row.name).excludes].sort().join(',');
    if (ours !== row.incompatible.sort().join(',')) return false;
  }
  return true;
})());

check('and that exception is still the only one', (() => {
  const off = decaComparable.filter(row => row.incompatible.length
    && [...data.byName.get(row.name).excludes].sort().join(',') !== row.incompatible.slice().sort().join(','));
  return off.length === DECA_BEHIND.size && off.every(row => DECA_BEHIND.has(row.name));
})(), decaComparable.filter(row => row.incompatible.length
  && [...data.byName.get(row.name).excludes].sort().join(',') !== row.incompatible.slice().sort().join(',')).map(r => r.name).join(', '));

// The three faults this comparison found, kept as named regressions.
check("DECA confirms Jester's Trick clashes with DUALSTAT, not SINGLESTAT", (() => {
  const row = decaRows.find(entry => entry.name === "Jester's Trick");
  return row && row.incompatible.includes('DUALSTAT') && !row.incompatible.includes('SINGLESTAT');
})());

check('the Relative bonuses weigh 52,000 on their own tier split', (() => {
  const row = decaRows.find(entry => entry.name === 'Relative Attack Bonus');
  return row && row.weight === 52000 && Math.abs(row.split[0] - 0.33654) < 0.0001;
})());

// It was missing its item-types line, so it parsed one field short and was
// rollable on nothing at all.
check('Vitality to Attack Bonus is rollable again, on all four item types', (() => {
  const mod = data.byName.get('Vitality to Attack Bonus');
  return mod && ['WEAPON', 'ABILITY', 'ARMOR', 'RING'].every(type => mod.itemTags.has(type));
})());

check('no enchantment is left rollable on no item type at all', (() => {
  const orphans = data.enchants.filter(mod => mod.itemTags.size === 0);
  return orphans.length === 0;
})(), data.enchants.filter(mod => mod.itemTags.size === 0).map(mod => mod.name).join(', '));

/* ------------------------------------------------------------------ *
 * 3. Incompatibility direction                                        *
 * ------------------------------------------------------------------ */
section('3. Incompatibility is directional: Labels(prior) ∩ Incompatible(candidate)');
const jester = data.byName.get("Jester's Trick");
const attackBonus = data.byName.get('Attack Bonus');
// Corrected in globalMods.txt on 2026-08-29 by the author of the original
// program: the incompatibility read SINGLESTAT and should read DUALSTAT.
// Jester's Trick raises every stat, so it clashes with the multi-stat bonuses.
check("Jester's Trick carries DUALSTAT and is incompatible with DUALSTAT",
  jester.tags.has('DUALSTAT') && jester.excludes.has('DUALSTAT') && !jester.excludes.has('SINGLESTAT'));
check("locking Attack Bonus (SINGLESTAT only) leaves Jester's Trick in the pool",
  engine.eligiblePool(data, baseCfg({ locks: ['Attack Bonus'] }), artifact('No Artifact')).some(m => m.name === "Jester's Trick"));
check("locking a DUALSTAT bonus removes Jester's Trick",
  !engine.eligiblePool(data, baseCfg({ locks: ['Attack and Defense Bonus'] }), artifact('No Artifact')).some(m => m.name === "Jester's Trick"));
check("locking Jester's Trick does NOT remove Attack Bonus (the relation is not symmetric here)",
  engine.eligiblePool(data, baseCfg({ locks: ["Jester's Trick"] }), artifact('No Artifact')).some(m => m.name === 'Attack Bonus'));
check("locking Jester's Trick removes the other DUALSTAT bonuses",
  !engine.eligiblePool(data, baseCfg({ locks: ["Jester's Trick"] }), artifact('No Artifact')).some(m => m.name === 'Attack and Defense Bonus'));
check('a self-excluding mod removes its own label family', (() => {
  const pool = engine.eligiblePool(data, baseCfg({ locks: ['Attack Bonus'] }), artifact('No Artifact'));
  return !pool.some(m => m.excludes.has('SINGLESTAT'));
})());
check('a locked enchantment is never offered again', (() => {
  const pool = engine.eligiblePool(data, baseCfg({ locks: ['Percentage Mana Regeneration'] }), artifact('No Artifact'));
  return !pool.some(m => m.name === 'Percentage Mana Regeneration');
})());

/* ------------------------------------------------------------------ *
 * 4. Slots and the lock cost multiplier                               *
 * ------------------------------------------------------------------ */
section('4. Slots and the lock dust multiplier');
const twoLocks = baseCfg({ item: 'Nightmatter Circlet', locks: ['Percentage Mana Regeneration', "Night's Soul"], desired: 'Mermaid Magic' });
check('4 slots − 2 locks leaves 2 random rolls', engine.rollsRemaining(twoLocks) === 2);
check('base reroll cost for a 4-slot item is 100 dust', engine.rerollCost(baseCfg({ locks: [] })) === 100);
check('each lock doubles the reroll cost: 2 locks → 400', engine.rerollCost(twoLocks) === 400);
check('3 locks → 800', engine.rerollCost(baseCfg({ locks: ['a', 'b', 'c'] })) === 800);
check('rarity base costs match the Qt table {50,65,80,100}',
  [1, 2, 3, 4].every(slots => engine.rerollCost(baseCfg({ slots, locks: [] })) === [0, 50, 65, 80, 100][slots]));
near('expected dust = per-reroll cost ÷ probability', engine.costFor(twoLocks, 1, artifact('No Artifact'), 'Red').dust, 400 * 100, 1e-9);
check('a Green-dust artifact does not inflate a Red-dust total', (() => {
  const cost = engine.costFor(twoLocks, 1, artifact('The Moon Tarot Card'), 'Red');
  return cost.dust === 400 * 100 && Math.abs(cost.artifactDust - 25 * 4 * 100) < 1e-9 && cost.artifactDustType === 'Green';
})());
check('a matching-dust artifact is folded into the total', (() => {
  const cost = engine.costFor(twoLocks, 1, artifact('Nightmatter Core'), 'Red');
  return Math.abs(cost.dust - (400 + 25 * 4) * 100) < 1e-9 && cost.artifactDust === 0;
})());
check('No Artifact consumes zero artifacts', engine.costFor(twoLocks, 1, artifact('No Artifact'), 'Red').artifactsUsed === 0);
// A reroll consumes the artifact half the time, so 2 % odds means 50 expected
// rerolls and 25 artifacts, not 50. This agrees with the Qt table's ceil(0.5/p).
const moonCost = engine.costFor(twoLocks, 2, artifact('The Moon Tarot Card'), 'Red');
near('artifacts used is half the mean reroll count', moonCost.artifactsUsed, 25, 1e-9);
near('the mean reroll count itself is unchanged', moonCost.rerolls, 50, 1e-9);
check('an impossible target still consumes an unbounded number',
  engine.costFor(twoLocks, 0, artifact('The Moon Tarot Card'), 'Red').artifactsUsed === Infinity);

/* ------------------------------------------------------------------ *
 * 5. Reference scenario from the handoff document                     *
 * ------------------------------------------------------------------ */
section('5. Nightmatter Circlet reference scenario');
const moon = artifact('The Moon Tarot Card');
const scenarioPool = engine.weightedPool(data, twoLocks, moon);
const mermaid = data.byName.get('Mermaid Magic');
// Two data corrections move this scenario away from the Qt program's own
// output, in opposite directions. The corrected Jester's Trick is culled by
// Night's Soul (DUALSTAT), taking 2,000 out; and Vitality to Attack Bonus,
// whose record was missing its item-types line and so was rollable nowhere,
// comes back in with 12,000. See the ## notes in globalMods.txt.
check('112 candidates in the pool', scenarioPool.mods.length === 112, `got ${scenarioPool.mods.length}`);
check('total weighted pool is 5,608,000', scenarioPool.total === 5608000, `got ${scenarioPool.total}`);
check("the missing candidate is Jester's Trick, culled by Night's Soul",
  !scenarioPool.mods.some(m => m.name === "Jester's Trick")
  && data.byName.get("Night's Soul").tags.has('DUALSTAT'));
check('Mermaid Magic weighs 30,000 under the Moon card', scenarioPool.weights.get(mermaid.id) === 30000, `got ${scenarioPool.weights.get(mermaid.id)}`);
near('chance on the next slot is 0.5350 %', scenarioPool.weights.get(mermaid.id) / scenarioPool.total * 100, 0.5350, 0.0001);
const scenarioOdds = engine.oddsAny(data, twoLocks, moon, ['Mermaid Magic']);
near('exact chance over the 2 remaining slots is 0.8322 %', scenarioOdds.odds, 0.8322, 0.0001);
check('the 2-slot result is exact, not sampled', scenarioOdds.exact === true);
const scenarioRow = engine.evaluate(data, twoLocks, moon);
near('expected Red dust is 48,064', scenarioRow.dust, 48064, 5);
check('two slots beat one slot for the same target', (() => {
  const oneSlot = engine.oddsAny(data, Object.assign({}, twoLocks, { locks: [...twoLocks.locks, 'Attack Bonus'] }), moon, ['Mermaid Magic']);
  return oneSlot.odds < scenarioOdds.odds;
})());

section('5b. The documented "OnAbility Attack Boost" lock trade-off');
const lockedCfg = Object.assign({}, twoLocks, { locks: [...twoLocks.locks, 'OnAbility Attack Boost'] });
const lockedPool = engine.weightedPool(data, lockedCfg, moon);
check('OnAbility Attack Boost carries ONABILITYSTAT and PROCATTACK',
  data.byName.get('OnAbility Attack Boost').tags.has('ONABILITYSTAT') && data.byName.get('OnAbility Attack Boost').tags.has('PROCATTACK'));
check('pool 112 → 105', lockedPool.mods.length === 105, `got ${lockedPool.mods.length}`);
check('total weight 5,608,000 → 4,958,000', lockedPool.total === 4958000, `got ${lockedPool.total}`);
check('Mermaid Magic weight is unchanged', lockedPool.weights.get(mermaid.id) === 30000);
near('per-slot chance rises to 0.6051 %', lockedPool.weights.get(mermaid.id) / lockedPool.total * 100, 0.6051, 0.0001);
const lockedOdds = engine.oddsAny(data, lockedCfg, moon, ['Mermaid Magic']);
near('but the single remaining slot only gives 0.6051 %', lockedOdds.odds, 0.6051, 0.0001);
check('so the extra lock lowers the total chance', lockedOdds.odds < scenarioOdds.odds);
check('and it raises the expected dust', engine.evaluate(data, lockedCfg, moon).dust > scenarioRow.dust);

/* ------------------------------------------------------------------ *
 * 6. The fast walk agrees with a naive reference walk                 *
 * ------------------------------------------------------------------ */
section('6. Class-collapsed walk vs. naive per-candidate walk');

// Deliberately slow, obviously-correct enumeration over individual mods.
function naiveOdds(cfg, art, goalNames) {
  const pool = engine.eligiblePool(data, cfg, art);
  const goals = new Set(goalNames.map(name => data.byName.get(name).id));
  if (!pool.some(m => goals.has(m.id))) return 0;
  const weights = new Map(pool.map(m => [m.id, engine.weightFor(m, art)]));
  const walk = (left, available, active) => {
    if (!left) return 0;
    let total = 0;
    for (const mod of available) total += weights.get(mod.id);
    if (!total) return 0;
    let odds = 0;
    for (const mod of available) {
      const chance = weights.get(mod.id) / total;
      if (goals.has(mod.id)) { odds += chance; continue; }
      const nextActive = new Set([...active, ...mod.tags]);
      const next = available.filter(other => other.id !== mod.id && ![...other.excludes].some(label => nextActive.has(label)));
      if (!next.some(other => goals.has(other.id))) continue;
      odds += chance * walk(left - 1, next, nextActive);
    }
    return odds;
  };
  return walk(engine.rollsRemaining(cfg), pool, new Set()) * 100;
}

const crossChecks = [
  ['ring / 2 rolls / Moon / Mermaid Magic', twoLocks, moon, ['Mermaid Magic']],
  ['ring / 2 rolls / No Artifact / Mermaid Magic', twoLocks, artifact('No Artifact'), ['Mermaid Magic']],
  ['ring / 3 rolls / Moon / Mermaid Magic', baseCfg({ locks: ['Percentage Mana Regeneration'], desired: 'Mermaid Magic' }), moon, ['Mermaid Magic']],
  ['ring / 3 rolls / Devil / Attack Bonus', baseCfg({ locks: ['Flat Life Regeneration'], desired: 'Attack Bonus' }), artifact('The Devil Tarot Card'), ['Attack Bonus']],
  ['weapon / 2 rolls / Adamantine / Damage Bonus', baseCfg({ type: 'WEAPON', slots: 4, locks: ['Attack Bonus', 'Defense Bonus'], desired: 'Damage Bonus' }), artifact('Adamantine Ingot'), ['Damage Bonus']],
  ['armor / 3 rolls / No Artifact / two-goal group', baseCfg({ type: 'ARMOR', locks: ['Attack Bonus'], desired: 'Percentage Life Regeneration' }), artifact('No Artifact'), ['Percentage Life Regeneration', 'Flat Life Regeneration']],
  ['ability / 2 rolls / Precision Cog / MP Cost Reduction', baseCfg({ type: 'ABILITY', locks: ['Attack Bonus', 'Mana Bonus'], desired: 'MP Cost Reduction' }), artifact('Precision Cog'), ['MP Cost Reduction']]
];
for (const [name, cfg, art, goals] of crossChecks) {
  const fast = engine.oddsAny(data, cfg, art, goals);
  const slow = naiveOdds(cfg, art, goals);
  near(`${name} (fast ${fast.odds.toPrecision(6)}% vs naive)`, fast.odds, slow, Math.max(1e-9, slow * 1e-9));
}

section('6b. Four free slots are still solved exactly');
const wide = baseCfg({ desired: 'Mermaid Magic' });
const wideStart = Date.now();
const wideOdds = engine.oddsAny(data, wide, moon, ['Mermaid Magic']);
const wideMs = Date.now() - wideStart;
check('a 4-roll, 203-candidate tree is exact', wideOdds.exact === true, `nodes ${wideOdds.nodes}`);
check(`and it finishes quickly (${wideMs} ms, ${wideOdds.nodes} nodes)`, wideMs < 5000);
check('with the same pool, more free slots strictly raise the chance', (() => {
  // Vary only the rarity, so the candidate pool is identical in all three runs.
  const at = slots => engine.oddsAny(data, baseCfg({ slots, desired: 'Mermaid Magic' }), moon, ['Mermaid Magic']).odds;
  return at(4) > at(3) && at(3) > at(2) && at(2) > at(1);
})());
check('a single free slot equals the plain weight ratio', (() => {
  const one = engine.oddsAny(data, baseCfg({ slots: 1, desired: 'Mermaid Magic' }), moon, ['Mermaid Magic']).odds;
  const pool = engine.weightedPool(data, baseCfg({ slots: 1 }), moon);
  return Math.abs(one - pool.weights.get(mermaid.id) / pool.total * 100) < 1e-12;
})());

/* ------------------------------------------------------------------ *
 * 7. Distribution sanity                                              *
 * ------------------------------------------------------------------ */
section('7. Goal-subset distribution');
const pairCfg = baseCfg({ locks: ['Attack Bonus'], desired: 'Mermaid Magic', goals: ['Crystalline Vigor'] });
const pair = engine.distributionFor(data, pairCfg, moon, ['Mermaid Magic', 'Crystalline Vigor']);
near('the distribution sums to 1', pair.distribution.reduce((a, b) => a + b, 0), 1, 1e-9);
check('P(both) ≤ P(either individually)', pair.distribution[3] <= pair.distribution[1] + pair.distribution[3] && pair.distribution[3] <= pair.distribution[2] + pair.distribution[3]);
near('P(at least one) matches oddsAny', engine.oddsAny(data, pairCfg, moon, ['Mermaid Magic', 'Crystalline Vigor']).odds,
  (pair.distribution[1] + pair.distribution[2] + pair.distribution[3]) * 100, 1e-9);
near('P(all) matches oddsAll', engine.oddsAll(data, pairCfg, moon, ['Mermaid Magic', 'Crystalline Vigor']).odds, pair.distribution[3] * 100, 1e-9);
check('a goal outside the pool yields probability 0', (() => {
  const impossible = engine.oddsAny(data, baseCfg({ type: 'RING', desired: 'Damage Bonus' }), moon, ['Damage Bonus']);
  return impossible.odds === 0;
})());
check('two mutually exclusive goals can never land together', (() => {
  // Attack Bonus and Defense Bonus are both SINGLESTAT and both refuse SINGLESTAT.
  const both = engine.oddsAll(data, baseCfg({ desired: 'Attack Bonus' }), artifact('No Artifact'), ['Attack Bonus', 'Defense Bonus']);
  return both.odds === 0;
})());

/* ------------------------------------------------------------------ *
 * 8. Tier multiplier                                                  *
 * ------------------------------------------------------------------ */
section('8. Tier distribution');
const tiered = data.byName.get('Attack Bonus');
check('Attack Bonus is TIERED with distribution 0.35/0.30/0.20/0.15',
  tiered.tags.has('TIERED') && JSON.stringify(tiered.distribution) === JSON.stringify([0.35, 0.3, 0.2, 0.15]));
near('all four tiers selected → multiplier 1', engine.tierMultiplier(tiered, artifact('No Artifact'), new Set([1, 2, 3, 4])), 1, 1e-12);
near('only tier IV → 0.15', engine.tierMultiplier(tiered, artifact('No Artifact'), new Set([4])), 0.15, 1e-12);
near('a non-tiered mod is unaffected', engine.tierMultiplier(mermaid, moon, new Set([4])), 1, 1e-12);
check('a TIER-boosting artifact exists to exercise the branch',
  data.artifacts.some(a => a.rules.some(r => [...r.keys].some(k => /^TIER[123]$/.test(k)))));

/* ------------------------------------------------------------------ *
 * 8b. A barred tier costs weight in the pool, not just on the target  *
 * ------------------------------------------------------------------ *
 * Read off the installed client: an artifact states a multiplier per
 * tier, and Premium Diamond bars three of the four while restoring
 * nothing. So in the game a tiered enchantment carries fifteen per
 * cent of its weight into that draw — which is the whole reason the
 * card is the one you use to hunt a unique.
 */
section('8b. Tier multipliers belong to the pool');

const diamond = artifact('Premium Diamond Card');
const gold = artifact('Premium Gold Card');
const cog = artifact('Precision Cog');
const plainCard = artifact('The Moon Tarot Card');
const standardTier = data.byName.get('Attack Bonus');
const relativeTier = data.byName.get('Relative Attack Bonus');

check('an artifact with no tier rule leaves the whole of it, exactly', (() => {
  // 0.35 + 0.30 + 0.20 + 0.15 is 0.9999999999999999 in binary floating point;
  // the pool truncates, so "about one" would shave a unit off every tiered
  // enchantment and move the reference totals.
  return engine.tierMass(standardTier, plainCard) === 1
    && engine.weightFor(standardTier, plainCard) === standardTier.weight;
})());

check('Premium Diamond leaves a standard tiered enchantment 15 % of its weight',
  Math.abs(engine.tierMass(standardTier, diamond) - 0.15) < 1e-9,
  String(engine.tierMass(standardTier, diamond)));

check('Premium Gold restores it to the whole on the standard split', (() => {
  // TIER1,TIER2 x0 and TIER3 x4.25, and 4.25 is (0.35+0.30+0.20)/0.20.
  return Math.abs(engine.tierMass(standardTier, gold) - 1) < 1e-9;
})(), String(engine.tierMass(standardTier, gold)));

check('but not on the families that are not on that split', (() => {
  // The Relative bonuses run 0.33654/0.32692/0.19231/0.14423, so the same
  // 4.25 leaves 0.96155 rather than 1. The old bespoke redistribution could
  // not express that at all.
  return Math.abs(engine.tierMass(relativeTier, gold) - 0.96155) < 0.0005;
})(), String(engine.tierMass(relativeTier, gold)));

check('Precision Cog bars tier 1 and lifts tier 2 to cover it',
  Math.abs(engine.tierMass(standardTier, cog) - 1) < 0.002,
  String(engine.tierMass(standardTier, cog)));

check('a barred tier really shrinks the pool it competes in', (() => {
  const cfg = baseCfg({ type: 'ARMOR', item: '', desired: 'Candy-Coated' });
  const plain = engine.weightedPool(data, cfg, artifact('No Artifact')).total;
  const barred = engine.weightedPool(data, cfg, diamond).total;
  return barred < plain / 4;
})());

check('and that is what makes Premium Diamond the card for a unique', (() => {
  const cfg = baseCfg({ type: 'ARMOR', dust: 'Green', item: 'Candy-Coated Armor', desired: 'Candy-Coated' });
  const withCard = engine.evaluate(data, cfg, diamond).odds;
  const without = engine.evaluate(data, cfg, artifact('No Artifact')).odds;
  return withCard > without * 10;
})(), (() => {
  const cfg = baseCfg({ type: 'ARMOR', dust: 'Green', item: 'Candy-Coated Armor', desired: 'Candy-Coated' });
  return `${engine.evaluate(data, cfg, diamond).odds.toFixed(4)}% against ${engine.evaluate(data, cfg, artifact('No Artifact')).odds.toFixed(4)}%`;
})());

check('the accepted-tier figure is a share of what survives, never more than all', (() => {
  for (const mod of data.enchants) {
    if (!mod.tags.has('TIERED') || !mod.distribution.length) continue;
    for (const card of [diamond, gold, cog, plainCard]) {
      const whole = engine.tierMultiplier(mod, card, new Set([1, 2, 3, 4]));
      if (whole > 1.000001 || whole < 0) return false;
      const some = engine.tierMultiplier(mod, card, new Set([4]));
      if (some > whole + 1e-9) return false;
    }
  }
  return true;
})());

check('a multiplier of zero survives parsing as zero', (() => {
  // Number(x) || 1 turned "x0" into "x1", which is how a barred tier came back
  // to life. Every artifact that bars a tier writes it as 0.
  const rule = diamond.rules.find(r => [...r.keys].some(k => /^TIER[1-3]$/.test(k)));
  return rule && rule.multiplier === 0;
})());

/* ------------------------------------------------------------------ *
 * 10. Multi-goal planner                                              *
 * ------------------------------------------------------------------ */
section('10. Multi-goal planner');
// Mermaid Magic (SINGLESTAT/UNIQUE) and Dust Bonus (REWARDBONUS) can coexist.
const planCfg = baseCfg({ item: 'Nightmatter Circlet', locks: ["Night's Soul"], desired: 'Mermaid Magic', goals: ['Dust Bonus'] });
const plan = engine.planGoals(data, planCfg, ['Mermaid Magic', 'Dust Bonus']);
check('a two-goal plan is feasible here', plan && plan.feasible === true);
check('the plan reports a finite expected dust cost', Number.isFinite(plan.dust) && plan.dust > 0);
check('the plan reports a finite expected reroll count', Number.isFinite(plan.rerolls) && plan.rerolls > 1);
check('lock-as-you-go is never worse than demanding both in one reroll', (() => {
  const together = engine.planSimultaneous(data, planCfg, ['Mermaid Magic', 'Dust Bonus']);
  return together && plan.dust <= together.dust + 1e-6;
})());
check('the plan is at least as expensive as the single cheapest goal alone', (() => {
  const single = engine.evaluateAll(data, Object.assign({}, planCfg, { desired: 'Mermaid Magic' })).filter(r => r.odds > 0);
  const cheapest = Math.min(...single.map(r => r.dust));
  return plan.dust >= cheapest - 1e-6;
})());
check('a plan needing more slots than the item has is rejected', (() => {
  const tooMany = engine.planGoals(data, baseCfg({ slots: 1, desired: 'Attack Bonus', goals: ['Mana Bonus'] }), ['Attack Bonus', 'Mana Bonus']);
  return tooMany && tooMany.feasible === false && tooMany.reason === 'slots';
})());
check('two mutually exclusive goals are reported as impossible', (() => {
  const clash = engine.planGoals(data, baseCfg({ desired: 'Attack Bonus', goals: ['Defense Bonus'] }), ['Attack Bonus', 'Defense Bonus']);
  return clash && clash.feasible === false;
})());
check('Mermaid Magic and Crystalline Vigor are correctly rejected as a pair', (() => {
  // Both are SINGLESTAT + UNIQUE and both refuse SINGLESTAT and UNIQUE.
  const clash = engine.planGoals(data, planCfg, ['Mermaid Magic', 'Crystalline Vigor']);
  return clash && clash.feasible === false && clash.reason === 'impossible';
})());
check('the displayed path starts with no goal locked and progresses', plan.path.length >= 1 && plan.path[0].locked.length === 0);
check('expected dust decreases along the displayed path',
  plan.path.every((step, index) => index === 0 || step.expectedDustFromHere <= plan.path[index - 1].expectedDustFromHere + 1e-6));
check('the plan may change artifact between phases', new Set(plan.path.map(step => step.artifact.name)).size >= 1);
check('the plan hunts the rare goal first and does not lock the cheap one early', (() => {
  // Mermaid Magic is ~0.85 % per reroll, Dust Bonus ~26 %. Locking Dust Bonus
  // first would double the cost of the long hunt for no benefit.
  return plan.path[0].likelyGain.join() === 'Mermaid Magic';
})(), JSON.stringify(plan.path.map(s => [s.locked, s.likelyGain, Math.round(s.expectedDustFromHere)])));
check('optimal locking beats the naive always-lock-what-you-get policy', (() => {
  // Reference value for the "lock every wanted enchantment on sight" policy.
  const naive = (() => {
    const goals = ['Mermaid Magic', 'Dust Bonus'];
    const value = [Infinity, Infinity, Infinity, 0];
    for (let done = 1; done >= 0; done--) {
      for (let mask = 0; mask < 3; mask++) {
        if ((mask === 0 ? 0 : mask === 3 ? 2 : 1) !== done) continue;
        const locked = goals.filter((_, i) => mask & (1 << i));
        const pendingIndex = [0, 1].filter(i => !(mask & (1 << i)));
        const stateCfg = Object.assign({}, planCfg, { locks: [...planCfg.locks, ...locked] });
        let best = Infinity;
        for (const art of data.artifacts) {
          const dist = engine.distributionFor(data, stateCfg, art, pendingIndex.map(i => goals[i])).distribution;
          if (dist[0] >= 1 - 1e-12) continue;
          const cost = engine.rerollCost(stateCfg) + (art.cost.dust === planCfg.dust ? art.cost.value * Math.pow(2, engine.lockCount(stateCfg)) : 0);
          let total = cost, ok = true;
          for (let sub = 1; sub < dist.length; sub++) {
            if (!dist[sub]) continue;
            let next = mask;
            for (let bit = 0; bit < pendingIndex.length; bit++) if (sub & (1 << bit)) next |= 1 << pendingIndex[bit];
            if (!Number.isFinite(value[next])) { ok = false; break; }
            total += dist[sub] * value[next];
          }
          if (ok) best = Math.min(best, total / (1 - dist[0]));
        }
        value[mask] = best;
      }
    }
    return value[0];
  })();
  // Optimality is the invariant; the size of the margin is not. It was 1.2x
  // when the artifact list was the inherited 24, and it moves when the list
  // changes — reading all 51 out of the client brought in engravings that cost
  // no dust at all, which the naive policy benefits from too.
  return plan.dust <= naive + 1e-6 && naive >= plan.dust;
})(), (() => 'margin recorded below')());
check('a three-goal plan still solves', (() => {
  const three = engine.planGoals(data, baseCfg({ item: 'Nightmatter Circlet', desired: 'Mermaid Magic', goals: ['Dust Bonus', 'OnAbility Wisdom Boost'] }),
    ['Mermaid Magic', 'Dust Bonus', 'OnAbility Wisdom Boost']);
  return three && three.feasible === true && Number.isFinite(three.dust);
})());

/* ------------------------------------------------------------------ *
 * 11. Monotonicity guards                                             *
 * ------------------------------------------------------------------ */
section('11. Monotonicity guards');
check('a target-boosting artifact beats No Artifact for that target', (() => {
  const withMoon = engine.oddsAny(data, twoLocks, moon, ['Mermaid Magic']).odds;
  const without = engine.oddsAny(data, twoLocks, artifact('No Artifact'), ['Mermaid Magic']).odds;
  return withMoon > without;
})());
check('adding a lock never changes the target weight itself', (() => {
  const before = engine.weightedPool(data, twoLocks, moon).weights.get(mermaid.id);
  const after = engine.weightedPool(data, lockedCfg, moon).weights.get(mermaid.id);
  return before === after;
})());
check('probabilities stay within [0, 100]', data.artifacts.every(art => {
  const odds = engine.oddsAny(data, twoLocks, art, ['Mermaid Magic']).odds;
  return odds >= 0 && odds <= 100;
}));
check('a zero-odds row costs infinite dust', (() => {
  const cost = engine.costFor(twoLocks, 0, artifact('No Artifact'), 'Red');
  return cost.dust === Infinity && cost.rerolls === Infinity;
})());

/* ------------------------------------------------------------------ *
 * 12. Item catalogue (slot and dust deduced from the item)            *
 * ------------------------------------------------------------------ */
section('12. Item catalogue');
const catalogue = require(path.join(root, 'web', 'items.js'));
const catalogFile = path.join(root, 'web', 'item-catalog.json');
const rawCatalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
catalogue.load(rawCatalog);

check('the catalogue is populated', catalogue.size > 1500, `got ${catalogue.size}`);
check('every entry names a real slot', [...catalogue.index.values()].every(entry => ['WEAPON', 'ABILITY', 'ARMOR', 'RING'].includes(entry.type)));
check('a dust, when present, is one of the three', [...catalogue.index.values()].every(entry => !entry.dust || ['Green', 'Red', 'Purple'].includes(entry.dust)));
check('tier bands cover each slot without a gap or an overlap', (() => {
  for (const bands of Object.values(catalogue.TIER_BANDS)) {
    const ranges = Object.values(bands).sort((a, b) => a[0] - b[0]);
    if (ranges[0][0] !== 1) return false;
    for (let i = 1; i < ranges.length; i++) if (ranges[i][0] !== ranges[i - 1][1] + 1) return false;
  }
  return true;
})());
check('the published reroll bands hold', (() => {
  const d = catalogue.dustForTier;
  return d('WEAPON', 9) === 'Green' && d('WEAPON', 10) === 'Red' && d('WEAPON', 12) === 'Red' && d('WEAPON', 13) === 'Purple'
    && d('ABILITY', 4) === 'Green' && d('ABILITY', 5) === 'Red' && d('ABILITY', 7) === 'Purple'
    && d('ARMOR', 9) === 'Green' && d('ARMOR', 10) === 'Red' && d('ARMOR', 13) === 'Purple'
    && d('RING', 4) === 'Green' && d('RING', 5) === 'Red' && d('RING', 7) === 'Purple';
})());
check('the generator and the reader agree on the bands',
  JSON.stringify(rawCatalog._bands) === JSON.stringify(catalogue.TIER_BANDS));
check('every tiered entry carries the dust its band prescribes',
  [...catalogue.index.values()].every(entry => {
    if (!entry.tiered || entry.tier === null) return true;
    const expected = catalogue.dustForTier(entry.type, entry.tier);
    // An explicit reroll-table entry or an override may legitimately differ.
    return !expected || !entry.dust || entry.dust === expected || Boolean(catalogue.OVERRIDES[entry.name]);
  }));
check('rings stop at tier 7, so there is no Tier 12 Ring', !catalogue.index.has('Tier 12 Ring') && catalogue.index.has('Tier 7 Ring'));
check('the reference items resolve as the wiki states', (() => {
  const expect = {
    'Corsair Ring': ['RING', 'Green'],
    'Bone Dagger': ['WEAPON', 'Green'],
    'Shield of Ogmur': ['ABILITY', 'Purple'],
    'Nightmatter Circlet': ['RING', 'Red'],
    'Ring of Health': ['RING', 'Green']
  };
  return Object.entries(expect).every(([name, [type, dust]]) => {
    const entry = catalogue.lookup(name);
    return entry && entry.type === type && entry.dust === dust;
  });
})());
check("the Nightmatter Circlet's own page settles its dust as Red", (() => {
  const entry = catalogue.lookup('Nightmatter Circlet');
  return entry && entry.dust === 'Red';
})());
check('the per-item dust file is well formed and free of duplicates', (() => {
  const lines = fs.readFileSync(path.join(root, 'tools', 'item-dust.txt'), 'utf8')
    .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const seen = new Set();
  for (const line of lines) {
    if (!/^.+\|[GRP]$/.test(line)) return false;
    const name = line.slice(0, line.lastIndexOf('|'));
    if (seen.has(name)) return false;
    seen.add(name);
  }
  return lines.length > 1500;
})());
check('every dust in the file reaches the catalogue unchanged', (() => {
  const LETTER = { G: 'Green', R: 'Red', P: 'Purple' };
  const lines = fs.readFileSync(path.join(root, 'tools', 'item-dust.txt'), 'utf8')
    .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  let checked = 0;
  for (const line of lines) {
    const cut = line.lastIndexOf('|');
    const name = line.slice(0, cut);
    const entry = catalogue.lookup(name);
    if (!entry) continue;                       // filtered out as a non-item
    if (entry.dust !== LETTER[line.slice(cut + 1)]) return false;
    checked++;
  }
  return checked > 1400;
})());
check('nearly every item now has a dust', (() => {
  const withDust = [...catalogue.index.values()].filter(entry => entry.dust).length;
  return withDust / catalogue.size > 0.94;
})(), `${[...catalogue.index.values()].filter(e => e.dust).length}/${catalogue.size}`);
check('the items still without a dust are starter gear, which cannot be enchanted', (() => {
  const without = [...catalogue.index.values()].filter(entry => !entry.dust);
  // T0 gear is the only legitimate reason to have none.
  return without.length < 90;
})());
check('lookup tolerates case, spacing and the known spelling variants',
  Boolean(catalogue.lookup('corsair ring') && catalogue.lookup('  Corsair   Ring ')
    && catalogue.lookup("Pirate King's Cutlass") && catalogue.lookup('Doku no Ken')));
check('an unknown name resolves to nothing rather than a guess', !catalogue.lookup('Definitely Not An Item'));
check('every alias points at an entry that exists', Object.values(catalogue.ALIASES).every(target => catalogue.index.has(target)));
check('class names did not leak in as items',
  ['Rogue', 'Archer', 'Wizard', 'Priest', 'Warrior', 'Knight', 'Huntress', 'Trickster', 'Druid'].every(name => !catalogue.index.has(name)));
check('group headings did not leak in as items',
  ['Health Rings', 'Attack Rings', 'Limited Rings'].every(name => !catalogue.index.has(name)));
check('awakenable items resolve through the catalogue or their enchantment', (() => {
  return [...data.awakenings.keys()].every(item => {
    if (catalogue.lookup(item)) return true;
    const mod = data.byName.get(data.awakenings.get(item)[0]);
    return Boolean(mod && mod.itemTags.size);
  });
})());
check('most items carry artwork', (() => {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'web', 'assets', 'items', 'index.json'), 'utf8'));
  const named = [...catalogue.index.values()].filter(entry => !entry.tiered || entry.sprite);
  const withArt = named.filter(entry => index[entry.name]).length;
  return withArt / named.length > 0.95;
})());
check('every sprite the index names is on disk', (() => {
  const dir = path.join(root, 'web', 'assets', 'items');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  return Object.values(index).every(file => fs.existsSync(path.join(dir, file)));
})());

/* ------------------------------------------------------------------ *
 * 13. The catalogue knows which items are Alien or Neo Alien          *
 * ------------------------------------------------------------------ */
section('13. Alien and Neo Alien bases reach the catalogue');

const basesFile = fs.readFileSync(path.join(root, 'tools', 'item-bases.txt'), 'utf8')
  .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));

check('the base file is well formed and free of duplicates', (() => {
  const seen = new Set();
  for (const line of basesFile) {
    if (!/^[^|]+\|(ALIEN|NEO_ALIEN)\|(WEAPON|ABILITY|ARMOR|RING)\|[A-Za-z0-9]+\.png$/.test(line)) return false;
    const name = line.split('|')[0];
    if (seen.has(name)) return false;
    seen.add(name);
  }
  return seen.size === basesFile.length;
})());

check('every item in the base file is in the catalogue with that family', (() => {
  for (const line of basesFile) {
    const [name, family] = line.split('|');
    const entry = catalogue.lookup(name);
    if (!entry || entry.base !== family) return false;
  }
  return true;
})());

check('23 Alien and 23 Neo Alien items', (() => {
  const all = [...catalogue.index.values()].filter(entry => entry.base);
  const alien = all.filter(entry => entry.base === 'ALIEN').length;
  const neo = all.filter(entry => entry.base === 'NEO_ALIEN').length;
  return alien === 23 && neo === 23;
})(), `${[...catalogue.index.values()].filter(e => e.base).length} in total`);

check('no other item claims a base family', (() => {
  const named = new Set(basesFile.map(line => line.split('|')[0]));
  return [...catalogue.index.values()].every(entry => !entry.base || named.has(entry.name));
})());

check('every alien item carries a dust and a sprite, or it is unusable', (() => {
  const all = [...catalogue.index.values()].filter(entry => entry.base);
  return all.every(entry => entry.dust && entry.sprite);
})());

// The 23 Neo items appear on no index the generator reads; without
// tools/item-bases.txt they would be missing and their seven enchantments
// unreachable by anyone.
check('the Neo items the base file injects really are in the catalogue',
  ['Neo Sun\'s Judgement', 'Neo Laser Rifle', 'Neo Heavy Protective Matrix', 'Neo Alien Core: Warp', 'Neo Reality Reactor']
    .every(name => { const e = catalogue.lookup(name); return e && e.type && e.dust === 'Purple'; }));

check('Laser Rifle is Alien yet Purple, unlike the rest of its family', (() => {
  const rifle = catalogue.lookup('Laser Rifle');
  const others = [...catalogue.index.values()].filter(e => e.base === 'ALIEN' && e.name !== 'Laser Rifle');
  return rifle && rifle.base === 'ALIEN' && rifle.dust === 'Purple' && others.every(e => e.dust === 'Red');
})());

check('a real Alien item can reach its own enchantments, with no artifact', (() => {
  const armor = catalogue.lookup('Heavy Protective Matrix');
  if (!armor || armor.base !== 'ALIEN') return false;
  const pool = engine.eligiblePool(
    data, baseCfg({ type: armor.type, subtypes: new Set([armor.base]) }), artifact('No Artifact'));
  return data.enchants.filter(m => m.special.has('ALIEN') && m.itemTags.has(armor.type))
    .every(m => pool.some(p => p.name === m.name));
})());

check('a real Neo Alien item reaches the Neo set and not the Alien one', (() => {
  const item = catalogue.lookup('Neo Heavy Protective Matrix');
  if (!item || item.base !== 'NEO_ALIEN') return false;
  const pool = engine.eligiblePool(
    data, baseCfg({ type: item.type, subtypes: new Set([item.base]) }), artifact('No Artifact'));
  const has = name => pool.some(p => p.name === name);
  return data.enchants.filter(m => m.special.has('NEO_ALIEN') && m.itemTags.has(item.type)).every(m => has(m.name))
    && data.enchants.filter(m => m.special.has('ALIEN') && m.itemTags.has(item.type)).every(m => !has(m.name));
})());

/* ------------------------------------------------------------------ *
 * 14. The recorded client snapshot                                    *
 * ------------------------------------------------------------------ *
 * data/client-snapshot.txt is what an installed game client said about
 * enchanting on the day it was read. Its whole job is to be compared
 * against the next read, so the property that matters is that no two
 * facts share a key. A collision does not fail loudly — it silently
 * drops one fact from every future comparison. Not hypothetical: the
 * client gives two different enchantments the name "Acid Guardian",
 * and a pool carries several rules apiece.
 */
section('14. The recorded client snapshot');

const snapshot = fs.readFileSync(path.join(dataRoot, 'client-snapshot.txt'), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('##'));
const snapEnch = new Set(snapshot.filter(line => line.startsWith('ench|')).map(line => line.split('|')[2]));
const collisions = (() => {
  const seen = new Set(), clash = [];
  for (const line of snapshot) {
    const parts = line.split('|');
    const key = `${parts[0]}|${parts[1]}`;
    if (seen.has(key)) clash.push(key); else seen.add(key);
  }
  return clash;
})();

check('it names the build it was read from',
  snapshot.filter(line => line.startsWith('build|')).length === 1);

check('every line is kind|name|fields',
  snapshot.every(line => line.split('|').length >= 2 && line.split('|')[1] !== ''));

check('no two facts share a key', collisions.length === 0, collisions.slice(0, 3).join(', '));

/*
 * The client's own display names, verbatim. Four are its typos — a missing
 * space, a missing apostrophe, a dropped letter, a lowercase initialism. The
 * last two are ours: the client gives the Alien and Neo Alien versions of
 * Acid Guardian and Solar Mastery the same name apiece, and we separate them
 * so a player can tell which one they are aiming at.
 */
const CLIENT_SPELLING = {
  'Mana -Attack Tradeoff': 'Mana -AttackTradeoff',
  "Pirate's Expertise": 'Pirates Expertise',
  'Vampiric Lifeforce': 'Vampric Lifeforce',
  'MP Cost Reduction': 'Mp Cost Reduction',
  'Acid Guardian (Neo)': 'Acid Guardian',
  'Solar Mastery (Neo)': 'Solar Mastery'
};

check('the enchantments it records cover the rollable ones we ship',
  data.enchants.filter(mod => mod.tags.has('ROLLABLE'))
    .every(mod => snapEnch.has(CLIENT_SPELLING[mod.name] || mod.name)),
  data.enchants.filter(mod => mod.tags.has('ROLLABLE') && !snapEnch.has(CLIENT_SPELLING[mod.name] || mod.name))
    .map(mod => mod.name).slice(0, 5).join(', '));

check('and we ship one for each of them', (() => {
  // The snapshot is one line per client record, ours one per enchantment: the
  // client keeps a non-rollable twin of many under the same display name, and
  // those collapse here. Compare distinct names, which is what a player sees.
  const shown = new Set(snapshot.filter(line => line.startsWith('ench|'))
    .map(line => line.split('|')[2]));
  const ours = new Set(data.enchants.map(mod => CLIENT_SPELLING[mod.name] || mod.name));
  return shown.size === ours.size;
})(), `client ${new Set(snapshot.filter(l => l.startsWith('ench|')).map(l => l.split('|')[2])).size}, nous ${new Set(data.enchants.map(m => CLIENT_SPELLING[m.name] || m.name)).size}`);

check('and it records the artifacts, the pools and the items too',
  snapshot.some(line => line.startsWith('artifact|'))
  && snapshot.some(line => line.startsWith('pool|'))
  && snapshot.filter(line => line.startsWith('item|')).length > 1000);

/* ------------------------------------------------------------------ *
 * 15. An artifact's rules compound                                    *
 * ------------------------------------------------------------------ *
 * Read off the installed client: a pool is a list of weight rules that
 * each multiply what the previous one left. This used to take the
 * largest matching rule instead, which is the same answer whenever only
 * one rule matches and wrong whenever two do.
 */
section('15. An artifact rules compound');

const ankh = artifact('Ascension Ankh');
const fool = artifact('The Fool Tarot Card');

check('two matching rules multiply rather than compete', (() => {
  // Tomb Pool is LIFE,DEXTERITY,DEFENSE x7 and DUALSTAT x3; Attack and Defense
  // Bonus is both, so the game gives it x21.
  const mod = data.byName.get('Attack and Defense Bonus');
  return engine.weightFor(mod, ankh) === Math.trunc(mod.weight * 21 * engine.tierMass(mod, ankh));
})(), (() => {
  const mod = data.byName.get('Attack and Defense Bonus');
  return `${engine.weightFor(mod, ankh)} for weight ${mod.weight}`;
})());

check('one matching rule is unchanged by that', (() => {
  // Life Bonus is LIFE and not DUALSTAT: x7, exactly as before.
  const mod = data.byName.get('Flat Life Bonus') || data.byName.get('Life Bonus');
  return !mod || engine.weightFor(mod, ankh) === Math.trunc(mod.weight * 7 * engine.tierMass(mod, ankh));
})());

check('an enchantment no rule names keeps its weight', (() => {
  const mod = data.enchants.find(m => !m.tags.has('LIFE') && !m.tags.has('DEXTERITY')
    && !m.tags.has('DEFENSE') && !m.tags.has('DUALSTAT') && !m.tags.has('TIERED')
    && m.name !== "Ancient's Blessing" && m.name !== 'Ancient Artifacts');
  return mod && engine.weightFor(mod, ankh) === mod.weight;
})());

check('The Fool reduces the proc stat boosts, which STAT never reached', (() => {
  // The client names the eight stat labels; OnShoot Attack Boost carries
  // ATTACK but not STAT, so writing the rule as STAT missed all 25 of them.
  const mod = data.byName.get('OnShoot Attack Boost');
  return mod && mod.tags.has('ATTACK') && !mod.tags.has('STAT')
    && engine.weightFor(mod, fool) === Math.trunc(mod.weight * 0.2 * engine.tierMass(mod, fool));
})());

check('and leaves alone what carries STAT but none of the eight', (() => {
  const mod = data.byName.get('Summon Power -StatMod Mult Tradeoff');
  return mod && mod.tags.has('STAT')
    && engine.weightFor(mod, fool) === Math.trunc(mod.weight * engine.tierMass(mod, fool));
})());

check('a UNIQUE stat enchantment is exempt, as the rule says', (() => {
  // Jester's Trick is STAT and UNIQUE: excluded from the x0.2, then named
  // outright at x15. It must come out at x15, not x3.
  const mod = data.byName.get("Jester's Trick");
  return engine.weightFor(mod, fool) === Math.trunc(mod.weight * 15 * engine.tierMass(mod, fool));
})(), (() => {
  const mod = data.byName.get("Jester's Trick");
  return `${engine.weightFor(mod, fool)} for weight ${mod.weight}`;
})());

check('Premium Silver lifts tier 2 to cover the tier it bars', (() => {
  // The client's Premium Silver Pool is TIER1 x0 and TIER2 x2.166; the second
  // line was missing here, leaving every tiered enchantment at 65 % of its
  // weight under that card.
  const silver = artifact('Premium Silver Card');
  return Math.abs(engine.tierMass(data.byName.get('Attack Bonus'), silver) - 1) < 0.001;
})(), String(engine.tierMass(data.byName.get('Attack Bonus'), artifact('Premium Silver Card'))));

/* ------------------------------------------------------------------ */
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) { for (const name of failures) console.log(`  - ${name}`); process.exit(1); }
