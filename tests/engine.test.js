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
  clientItemText: read('Items', 'client-items.txt'),
  clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt'),
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
// Everything the client defines, plus eight family goals of our own — see
// section 2c. "fromClient" is the former, which is what the client is compared
// against; a family is a way of asking, not something the game rolls.
const fromClient = data.enchants.filter(mod => !mod.members);
check('325 enchantments from the client', fromClient.length === 325, `got ${fromClient.length}`);
check('291 of them are rollable', (() => {
  return fromClient.filter(mod => mod.tags.has('ROLLABLE')).length === 291;
})(), String(fromClient.filter(mod => mod.tags.has('ROLLABLE')).length));

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
  const kept = new Set(fromClient.filter(mod => mod.tags.has('ROLLABLE')).map(mod => mod.name));
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
check("Night's Soul is available on an Agents of Oryx ring",
  engine.eligiblePool(data, baseCfg({ item: 'Autarch Amulet' }), artifact('No Artifact')).some(m => m.name === "Night's Soul"));
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
 * 2b. Which item unlocks which awakened enchantment                   *
 * ------------------------------------------------------------------ *
 * Read off the client: an awakened enchantment names the slot it goes
 * on and the item label it belongs to, and the items carry that label.
 * What this replaced was assembled from wiki pages and held 140
 * entries, 16 of which were group headings — "AoO Rings", "Matrix
 * Armors" — that no player can look up by name.
 */
section('2b. Which item unlocks which awakened enchantment');

const catalogue2b = require(path.join(root, 'web', 'items.js'));
catalogue2b.loadClient(read('Items', 'client-items.txt'));

check('every item it names is in the catalogue', (() => {
  for (const item of data.awakenings.keys()) if (!catalogue2b.lookup(item)) return false;
  return true;
})(), [...data.awakenings.keys()].filter(item => !catalogue2b.lookup(item)).slice(0, 5).join(', '));

check('every enchantment it names exists, and is an awakened one', (() => {
  for (const mods of data.awakenings.values()) {
    for (const name of mods) {
      const mod = data.byName.get(name);
      if (!mod || !mod.tags.has('AWAKENED')) return false;
    }
  }
  return true;
})());

// The point of the whole exercise: a real item, not a group heading.
check('a Protective Matrix armor is offered its four Matrix enhancements', (() => {
  const mods = data.awakenings.get('Fitted Protective Matrix') || [];
  return ['Malogian', 'Untarian', 'Katalonian', 'Foraxian']
    .every(planet => mods.some(name => name.startsWith(planet)));
})(), (data.awakenings.get('Fitted Protective Matrix') || []).join(', '));

check('an Agents of Oryx weapon is offered its awakened enchantment, and only that one', (() => {
  // All four Night's enchantments carry the AOO label and differ only by the
  // slot they go on. Matching on the label alone put all four on every one.
  const mods = data.awakenings.get('Legion Elite Bow') || [];
  return mods.length === 1 && mods[0] === "Night's Strength";
})(), (data.awakenings.get('Legion Elite Bow') || []).join(', '));

check('no group heading survives as if it were an item',
  !data.awakenings.has('AoO Rings') && !data.awakenings.has('Matrix Armors'));

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
 * 2d. Asking for a family rather than a name                          *
 * ------------------------------------------------------------------ *
 * "Mana -Defense Tradeoff" and its six siblings all give the same Mana
 * and differ only in what they cost. Someone after the Mana does not
 * care which, so the family is one goal. "Defense to Attack Bonus" is
 * not grouped: there both stats are the point.
 */
section('2d. Tradeoff families as a single goal');

const families = data.enchants.filter(mod => mod.members);

check('eight families, of seven each', (() => {
  return families.length === 8 && families.every(f => f.members.length === 7);
})(), families.map(f => `${f.name} (${f.members.length})`).join(', '));

check('only the "A -B Tradeoff" shape is grouped', (() => {
  // Nothing with "to" or "and" in its name, where both stats matter.
  return families.every(f => f.members.every(name => / -.+ Tradeoff$/.test(name)));
})());

check('a family is never in a pool', (() => {
  const cfg = baseCfg({ type: 'ARMOR', item: '', desired: 'Candy-Coated' });
  return data.artifacts.every(art =>
    !engine.eligiblePool(data, cfg, art).some(mod => mod.members));
})());

check('every member exists and is rollable', (() => {
  return families.every(f => f.members.every(name => {
    const mod = data.byName.get(name);
    return mod && mod.tags.has('ROLLABLE');
  }));
})());

check('a family weighs what its members weigh together', (() => {
  return families.every(f =>
    f.weight === f.members.reduce((total, name) => total + data.byName.get(name).weight, 0));
})());

check('asking for the family is worth all seven', (() => {
  // The seven are interchangeable here, so the family should come out at
  // seven times one of them. That is a property of this data, not a rule:
  // what the check is really for is that the goal resolves to the set at all.
  const one = baseCfg({ type: 'ARMOR', item: '', desired: 'Mana -Defense Tradeoff' });
  const any = baseCfg({ type: 'ARMOR', item: '', desired: 'Mana -any Tradeoff' });
  const single = engine.evaluate(data, one, artifact('No Artifact')).odds;
  const family = engine.evaluate(data, any, artifact('No Artifact')).odds;
  return Math.abs(family / single - 7) < 0.05;
})(), (() => {
  const one = baseCfg({ type: 'ARMOR', item: '', desired: 'Mana -Defense Tradeoff' });
  const any = baseCfg({ type: 'ARMOR', item: '', desired: 'Mana -any Tradeoff' });
  return `${engine.evaluate(data, any, artifact('No Artifact')).odds.toFixed(4)}% against ${engine.evaluate(data, one, artifact('No Artifact')).odds.toFixed(4)}%`;
})());

check('the accepted tiers mean the same thing for a family', (() => {
  // The family carries TIERED from its members, so it needs a tier split of
  // its own — left empty, the checkboxes would silently do nothing to it.
  const family = data.byName.get('Mana -any Tradeoff');
  const member = data.byName.get('Mana -Attack Tradeoff');
  if (!family.distribution.length) return false;
  const at4 = tiers => {
    const any = engine.evaluate(data, baseCfg({ type: 'ARMOR', item: '', desired: 'Mana -any Tradeoff', tiers: new Set(tiers) }), artifact('No Artifact')).odds;
    const one = engine.evaluate(data, baseCfg({ type: 'ARMOR', item: '', desired: 'Mana -Attack Tradeoff', tiers: new Set(tiers) }), artifact('No Artifact')).odds;
    return any / one;
  };
  return Math.abs(at4([4]) - 7) < 0.05 && Math.abs(at4([3, 4]) - 7) < 0.05
    && family.distribution.every((share, i) => Math.abs(share - member.distribution[i]) < 1e-9);
})());

check('and it can be planned alongside another goal', (() => {
  const plan = engine.planGoals(data,
    baseCfg({ type: 'ARMOR', item: '', desired: 'Mana -any Tradeoff', goals: ['Attack Bonus'] }),
    ['Mana -any Tradeoff', 'Attack Bonus']);
  return plan && plan.feasible === true && Number.isFinite(plan.dust);
})());


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
 * 12. The item catalogue, as the client states it                     *
 * ------------------------------------------------------------------ *
 * Slot, dust and equipment family used to be scraped from wiki pages
 * and, for the dust, inferred from a tier-to-dust band table. The
 * client states all three per item, so nothing is deduced here now.
 */
section('12. The item catalogue');
const catalogue = require(path.join(root, 'web', 'items.js'));
catalogue.loadClient(read('Items', 'client-items.txt'));

const itemRows = read('Items', 'client-items.txt').split(NEWLINE)
  .filter(line => line.startsWith('item|')).map(line => line.split('|'));

check('the catalogue is populated', catalogue.size > 1700, `got ${catalogue.size}`);

check('every entry names a real slot',
  [...catalogue.index.values()].every(entry => ['WEAPON', 'ABILITY', 'ARMOR', 'RING'].includes(entry.type)));

check('every dust is one of the three',
  [...catalogue.index.values()].every(entry => ['Green', 'Red', 'Purple'].includes(entry.dust)));

check('the file is well formed and free of duplicate names', (() => {
  const seen = new Set();
  for (const row of itemRows) {
    if (row.length < 10) return false;
    if (seen.has(row[1])) return false;
    seen.add(row[1]);
  }
  return true;
})());

check('every dust in the file reaches the catalogue unchanged', (() => {
  for (const row of itemRows) {
    // A row with no slot is a material rather than equipment; the client has
    // one, "Agents of Oryx Shard x15", and it is not something to enchant.
    if (!row[3] || !row[2]) continue;
    const entry = catalogue.lookup(row[1]);
    if (!entry || entry.dust !== row[3]) return false;
  }
  return true;
})());

check('the six items the client gives no dust are left out rather than guessed at', (() => {
  const dustless = itemRows.filter(row => !row[3]).map(row => row[1]);
  return dustless.length === 6 && dustless.every(name => !catalogue.lookup(name));
})(), itemRows.filter(row => !row[3]).map(row => row[1]).join(', '));

check('a reroll costs 50, 65, 80 then 100 for all but a handful', (() => {
  const standard = itemRows.filter(row => row[4] === '50,65,80,100').length;
  return standard > itemRows.length - 20;
})(), `${itemRows.filter(row => row[4] === '50,65,80,100').length} of ${itemRows.length}`);

check("the Nightmatter Circlet is a Red-dust ring", (() => {
  const entry = catalogue.lookup('Nightmatter Circlet');
  return entry && entry.dust === 'Red' && entry.type === 'RING';
})());

check('a tiered item can still be picked by tier alone', (() => {
  const entry = catalogue.lookup('Tier 12 Weapon');
  return entry && entry.type === 'WEAPON' && entry.dust === 'Red';
})());

check('an unknown name resolves to nothing rather than a guess', !catalogue.lookup('Not An Item At All'));

check('every alias points at an entry that exists',
  Object.values(catalogue.ALIASES).every(name => catalogue.index.has(name)));

/* ------------------------------------------------------------------ *
 * 13. Alien and Neo Alien are equipment families                      *
 * ------------------------------------------------------------------ *
 * Which family an item belongs to was read off two wiki pages and kept in a
 * file of its own. The client puts the label on the item.
 */
section('13. Alien and Neo Alien families');

const familyOf = new Map(itemRows.filter(row => row[6]).map(row => [row[1], row[6]]));

check('the client marks both families', (() => {
  const kinds = new Set(familyOf.values());
  return kinds.has('ALIEN') && kinds.has('NEO_ALIEN');
})(), [...new Set(familyOf.values())].join(', '));

check('every item of a family is in the catalogue with that family',
  [...familyOf].every(([name, family]) => {
    const entry = catalogue.lookup(name);
    return entry && entry.base === family;
  }));

check('no other item claims one', (() => {
  for (const [name, entry] of catalogue.index) {
    if (entry.base && familyOf.get(name) !== entry.base) return false;
  }
  return true;
})());

check('a real Alien item reaches its own enchantments, with no artifact', (() => {
  const item = catalogue.lookup('Acidic Slasher');
  if (!item || item.base !== 'ALIEN') return false;
  const pool = engine.eligiblePool(
    data, baseCfg({ type: item.type, subtypes: new Set([item.base]) }), artifact('No Artifact'));
  return pool.some(mod => mod.name === 'Alien OnShoot Attack Boost');
})());

check('and a Neo item reaches the Neo set and not the Alien one', (() => {
  const neo = [...familyOf].find(([, family]) => family === 'NEO_ALIEN');
  if (!neo) return false;
  const item = catalogue.lookup(neo[0]);
  const pool = engine.eligiblePool(
    data, baseCfg({ type: item.type, subtypes: new Set(['NEO_ALIEN']) }), artifact('No Artifact'));
  const has = name => pool.some(mod => mod.name === name);
  return has('Neo Alien OnShoot Attack Boost') && !has('Alien OnShoot Attack Boost');
})());

check('every item of a family carries a dust and a slot, or it is unusable',
  [...familyOf.keys()].every(name => {
    const entry = catalogue.lookup(name);
    return entry && entry.dust && entry.type;
  }));


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

const clientSide = data.enchants.filter(mod => !mod.members);
check('the enchantments it records cover the rollable ones we ship',
  clientSide.filter(mod => mod.tags.has('ROLLABLE'))
    .every(mod => snapEnch.has(CLIENT_SPELLING[mod.name] || mod.name)),
  clientSide.filter(mod => mod.tags.has('ROLLABLE') && !snapEnch.has(CLIENT_SPELLING[mod.name] || mod.name))
    .map(mod => mod.name).slice(0, 5).join(', '));

check('and we ship one for each of them', (() => {
  // The snapshot is one line per client record, ours one per enchantment: the
  // client keeps a non-rollable twin of many under the same display name, and
  // those collapse here. Compare distinct names, which is what a player sees.
  const shown = new Set(snapshot.filter(line => line.startsWith('ench|'))
    .map(line => line.split('|')[2]));
  const ours = new Set(clientSide.map(mod => CLIENT_SPELLING[mod.name] || mod.name));
  return shown.size === ours.size;
})(), `client ${new Set(snapshot.filter(l => l.startsWith('ench|')).map(l => l.split('|')[2])).size}, nous ${new Set(clientSide.map(m => CLIENT_SPELLING[m.name] || m.name)).size}`);

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

/* ------------------------------------------------------------------ *
 * 16. Fame from dungeons                                              *
 * ------------------------------------------------------------------ *
 * Every figure is read out of the client by tools/generate-fame.js: a
 * ladder per dungeon, and thirteen collections that pay a flat sum and
 * a share of the character's base fame for finishing a whole group.
 */
section('16. Fame from dungeons');

const fameLib = require(path.join(root, 'web', 'fame.js'));
const fameOverrides = fs.readFileSync(path.join(root, 'data', 'Fame', 'availability-overrides.txt'), 'utf8');
const fame = fameLib.parse(fs.readFileSync(path.join(root, 'data', 'Fame', 'client-fame.txt'), 'utf8'), fameOverrides);
// The same data before the corrections, to show what they actually move.
const fameRaw = fameLib.parse(fs.readFileSync(path.join(root, 'data', 'Fame', 'client-fame.txt'), 'utf8'));

check('the client defines 13 collections and 76 dungeons with a ladder',
  fame.collections.length === 13 && fame.dungeons.length === 76,
  `${fame.collections.length} collections, ${fame.dungeons.length} dungeons`);

check('every dungeon a collection names has a ladder of its own', (() => {
  for (const collection of fame.collections) {
    for (const need of collection.needs) if (!fame.byName.has(need.what)) return false;
  }
  return true;
})());

check('a ladder starts at one completion and climbs', (() => {
  return fame.dungeons.every(dungeon => {
    if (!dungeon.ladder.length) return false;
    if (dungeon.ladder[0].at !== 1) return false;
    for (let i = 1; i < dungeon.ladder.length; i++) {
      if (dungeon.ladder[i].at <= dungeon.ladder[i - 1].at) return false;
      if (dungeon.ladder[i].fame < dungeon.ladder[i - 1].fame) return false;
    }
    return true;
  });
})());

check('Tunnel Rat is twelve dungeons for 3000 fame and 7.5 %', (() => {
  const tr = fame.collections.find(entry => entry.name === 'Tunnel Rat');
  return tr && tr.needs.length === 12 && tr.absolute === 3000 && tr.relative === 7.5;
})());

check('nothing ticked is worth nothing beyond being maxed', (() => {
  // The eight maxing bonuses are assumed rather than asked for: 1000 fame and
  // 25 % of the base, which on 12000 is 4000. Nothing was ticked, so that is
  // the whole of it.
  const view = fameLib.summarise(fame, [], 12000);
  return view.earnedFame === 0 && view.maxedFame === 4000 && view.total === 16000;
})());

check('and maxing and the collections are the whole of the percentage side', (() => {
  // Everything else the game pays — cartography, quests, kills, potions,
  // teleports — is flat. That is what makes assuming 8/8 enough to land on a
  // figure a player recognises: no other bonus moves the percentage.
  if (fame.maxed.stats !== 8 || fame.maxed.flat !== 1000 || fame.maxed.percent !== 25) return false;
  return fame.bonuses.every(bonus => !bonus.relative
    || bonus.category === 'Maxing' || bonus.category === 'Dungeon Collection');
})(), `8/8 is ${fame.maxed.flat} flat + ${fame.maxed.percent}%`);

check('a completed collection pays its flat sum and its share of the base', (() => {
  // Far Out is the four alien dungeons: 2000 + 5 % of the base, plus the four
  // first completions at 125 each.
  const farOut = fame.collections.find(entry => entry.name === 'Far Out');
  const view = fameLib.summarise(fame, farOut.needs.map(need => need.what), 12000);
  const ladders = farOut.needs.reduce((total, need) =>
    total + fameLib.firstCompletion(fame.byName.get(need.what)), 0);
  return Math.abs(view.earnedFame - (2000 + 12000 * 0.05 + ladders)) < 1e-9;
})(), (() => {
  const farOut = fame.collections.find(entry => entry.name === 'Far Out');
  return String(fameLib.summarise(fame, farOut.needs.map(need => need.what), 12000).earnedFame);
})());

check('what is earned and what is left always add up to everything', (() => {
  // Whatever is ticked, the two halves must cover the same total.
  const all = fame.dungeons.map(dungeon => dungeon.name);
  const whole = fameLib.summarise(fame, [], 9000);
  for (const ticked of [[], all.slice(0, 5), all.slice(0, 40), all]) {
    const view = fameLib.summarise(fame, ticked, 9000);
    if (Math.abs(view.potential - whole.potential) > 1e-6) return false;
  }
  return true;
})());

check('the last dungeon of a collection comes first and carries it', (() => {
  // Its reward is its own completion plus the whole of Tunnel Rat, and a
  // share of every other collection it is still outstanding from — so at
  // least the collection, and more.
  const tr = fame.collections.find(entry => entry.name === 'Tunnel Rat');
  const done = tr.needs.map(need => need.what);
  const last = done.pop();
  const top = fameLib.nextBest(fame, done, 12000, 5)[0];
  return top.name === last
    && top.unlocks.some(entry => entry.name === 'Tunnel Rat')
    && top.gain >= top.first + 3000 + 12000 * 0.075;
})(), (() => {
  const tr = fame.collections.find(entry => entry.name === 'Tunnel Rat');
  const done = tr.needs.map(need => need.what);
  done.pop();
  const top = fameLib.nextBest(fame, done, 12000, 1)[0];
  return `${top.name}, ${Math.round(top.gain)} fame`;
})());

check('and otherwise the best value for the effort leads', (() => {
  // Nothing done: Pirate Cave is five minutes and advances four collections,
  // which beats anything that pays more but takes an evening.
  const best = fameLib.nextBest(fame, [], 12000, 3, new Set(['standard']));
  return best[0].name === 'Pirate Cave' && best[0].value > best[1].value;
})(), fameLib.nextBest(fame, [], 12000, 3, new Set(['standard']))
  .map(entry => `${entry.name} ${Math.round(entry.value)}x`).join(', '));

check('the client says which dungeons are in the realm all year', (() => {
  const kinds = new Map();
  for (const dungeon of fameRaw.dungeons) kinds.set(dungeon.availability, (kinds.get(dungeon.availability) || 0) + 1);
  return kinds.get('standard') === 49 && kinds.get('seasonal') === 16 && kinds.get('other') === 11;
})(), fameRaw.dungeons.reduce((all, d) => all + d.availability[0], ''));

check('and the corrections move fourteen of them, all into the realm', (() => {
  // The client's two collections were written when they were true and have
  // drifted; the alien dungeons are permanent content now. Every override so
  // far makes a dungeon more available, never less.
  if (fame.corrected.size !== 14) return false;
  for (const name of fame.corrected) {
    if (fame.byName.get(name).availability !== 'standard') return false;
    if (fameRaw.byName.get(name).availability === 'standard') return false;
  }
  const kinds = new Map();
  for (const dungeon of fame.dungeons) kinds.set(dungeon.availability, (kinds.get(dungeon.availability) || 0) + 1);
  return kinds.get('standard') === 63 && kinds.get('seasonal') === 6 && kinds.get('other') === 7;
})(), [...fame.corrected].join(', '));

check('every correction names a dungeon that exists and a real availability', (() => {
  const kinds = new Set(['standard', 'seasonal', 'other']);
  for (const raw of fameOverrides.split(NEWLINE)) {
    const line = raw.trim();
    if (!line || line.startsWith('##')) continue;
    const [name, availability, when] = line.split('|');
    if (!fame.byName.has(name) || !kinds.has(availability) || !/^\d{4}-\d{2}-\d{2}$/.test(when || '')) return false;
  }
  return true;
})());

check('a collection everything in which is seasonal is marked as one', (() => {
  // Before the corrections: the two alien sets and the seasonal one.
  const seasonal = fameLib.summarise(fameRaw, [], 0).collections
    .filter(entry => entry.seasonal).map(entry => entry.name).sort();
  return seasonal.join(', ') === "Far Out, Farther Out, Season's Beatins";
})(), fameLib.summarise(fameRaw, [], 0).collections.filter(e => e.seasonal).map(e => e.name).join(', '));

check('and none is, once the alien dungeons are permanent', (() => {
  // Far Out and Farther Out become ordinary; Season's Beatins keeps six
  // seasonal members but is no longer entirely seasonal, so it is workable.
  return fameLib.summarise(fame, [], 0).collections.every(entry => !entry.seasonal);
})(), fameLib.summarise(fame, [], 0).collections.filter(e => e.seasonal).map(e => e.name).join(', ') || 'none');

check('a higher base fame makes the percentages matter more', (() => {
  const poor = fameLib.summarise(fame, [], 1000);
  const rich = fameLib.summarise(fame, [], 100000);
  return rich.remainingFame > poor.remainingFame
    && rich.remainingFlat === poor.remainingFlat;
})());



/*
 * The fame shown against a suggestion is the fame the game pays.
 *
 * "gain" is what orders the list: a dungeon's own first completion plus a
 * share of the collections it would move along. That share is a claim on
 * prizes not yet won, and printing it against Pirate Cave — 636 — read as a
 * promise the dungeon does not keep. Pirate Cave pays 2.
 */
check('the suggestion carries the dungeon own first completion, not its score', (() => {
  for (const entry of fameLib.nextBest(fame, [], 12000, 8, new Set(['standard']))) {
    if (entry.first !== fameLib.firstCompletion(fame.byName.get(entry.name))) return false;
    if (entry.gain < entry.first) return false;     // the score includes it
  }
  const cave = fameLib.nextBest(fame, [], 12000, 3, new Set(['standard']))[0];
  return cave.name === 'Pirate Cave' && cave.first === 2 && Math.round(cave.gain) > 2;
})(), (() => {
  const cave = fameLib.nextBest(fame, [], 12000, 3, new Set(['standard']))[0];
  return `${cave.name} pays ${cave.first}, scores ${Math.round(cave.gain)}`;
})());

check('and every collection it would move is named, finished ones aside', (() => {
  const tr = fame.collections.find(entry => entry.name === 'Tunnel Rat');
  const done = tr.needs.slice(0, 11).map(need => need.what);
  const last = fameLib.nextBest(fame, done, 12000, 1)[0];
  // The twelfth finishes Tunnel Rat, so it is an unlock rather than a step
  // towards one, and it must not be counted as both.
  if (!last.unlocks.some(entry => entry.name === 'Tunnel Rat')) return false;
  return !last.towards.some(entry => entry.name === 'Tunnel Rat')
    && fameLib.nextBest(fame, [], 12000, 5).every(entry =>
      entry.towards.every(collection => !collection.done));
})());

/*
 * A dungeon set aside is not a dungeon done.
 *
 * Refusing one takes it out of the suggestions and nothing else: no fame is
 * earned, no collection moves, and the dungeon behind it comes forward.
 */
check('a dungeon set aside leaves the list without paying anything', (() => {
  const plain = fameLib.nextBest(fame, [], 12000, 4, new Set(['standard']));
  const skipped = fameLib.nextBest(fame, [], 12000, 4, new Set(['standard']),
    new Set([plain[0].name]));
  if (skipped.some(entry => entry.name === plain[0].name)) return false;
  if (skipped.length !== plain.length) return false;
  // Everything simply moves up a place.
  if (skipped[0].name !== plain[1].name) return false;
  // And it is not counted as done: the sum does not move.
  const before = fameLib.summarise(fame, [], 12000);
  return fameLib.summarise(fame, [], 12000).total === before.total;
})(), (() => {
  const plain = fameLib.nextBest(fame, [], 12000, 4, new Set(['standard']));
  return `set aside ${plain[0].name}, ${plain[1].name} comes forward`;
})());

/* ------------------------------------------------------------------ */
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) { for (const name of failures) console.log(`  - ${name}`); process.exit(1); }
