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

const MOD_FILES = ['globalMods.txt', 'weaponMods.txt', 'abilityMods.txt', 'armorMods.txt', 'ringMods.txt', 'alienMods.txt', 'neoAlienMods.txt', 'summonPoweredMods.txt', 'awakenedMods.txt'];
const read = (...parts) => fs.readFileSync(path.join(dataRoot, ...parts), 'utf8');

const data = engine.buildDataset({
  modTexts: MOD_FILES.map(file => read('Enchantment documents', file)),
  artifactText: read('Artifacts', 'artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt')
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
  locks: [], virtualLabels: [], desired: '', goals: []
}, extra);

/* ------------------------------------------------------------------ *
 * 1. Data loading                                                     *
 * ------------------------------------------------------------------ */
section('1. Data loading');
check('292 unique enchantments after de-duplicating shared documents', data.enchants.length === 292, `got ${data.enchants.length}`);
check('25 artifacts', data.artifacts.length === 25, `got ${data.artifacts.length}`);
check('duplicate records are identical, so de-duplication is lossless', (() => {
  const seen = new Map();
  for (const file of MOD_FILES) {
    for (const mod of engine.parseMods(read('Enchantment documents', file))) {
      const signature = JSON.stringify([mod.weight, [...mod.tags].sort(), [...mod.excludes].sort(), [...mod.itemTags].sort(), [...mod.special].sort(), mod.distribution]);
      if (seen.has(mod.name) && seen.get(mod.name) !== signature) return false;
      seen.set(mod.name, signature);
    }
  }
  return true;
})());
check('no record was dropped for having too few fields', (() => {
  let groups = 0;
  for (const file of MOD_FILES) groups += engine.readBracketGroups(read('Enchantment documents', file)).length;
  let parsed = 0;
  for (const file of MOD_FILES) parsed += engine.parseMods(read('Enchantment documents', file)).length;
  return groups === parsed;
})());
check('Death Tarot Card cost parses despite the stray space', artifact('Death Tarot Card').cost.value === 25 && artifact('Death Tarot Card').cost.dust === 'Green');
check('The Moon Tarot Card is billed in Green dust, not Red', artifact('The Moon Tarot Card').cost.dust === 'Green');
check('the four alien technologies are the only pool-opening artifacts',
  data.artifacts.filter(a => a.pools.size).map(a => a.name).join(',') === 'Malogia Technology,Untaris Technology,Katalund Technology,Forax Technology');

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
 * 3. Incompatibility direction                                        *
 * ------------------------------------------------------------------ */
section('3. Incompatibility is directional: Labels(prior) ∩ Incompatible(candidate)');
const jester = data.byName.get("Jester's Trick");
const attackBonus = data.byName.get('Attack Bonus');
check("Jester's Trick has DUALSTAT among its Labels and SINGLESTAT among its Incompatible Labels",
  jester.tags.has('DUALSTAT') && jester.excludes.has('SINGLESTAT') && !jester.tags.has('SINGLESTAT'));
check("locking Attack Bonus (SINGLESTAT) removes Jester's Trick",
  !engine.eligiblePool(data, baseCfg({ locks: ['Attack Bonus'] }), artifact('No Artifact')).some(m => m.name === "Jester's Trick"));
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
check('a virtual (hypothetical) lock also consumes a roll',
  engine.rollsRemaining(Object.assign({}, twoLocks, { virtualLabels: [new Set(['SINGLESTAT'])] })) === 1);
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
near('artifacts used equals the mean reroll count', engine.costFor(twoLocks, 2, artifact('The Moon Tarot Card'), 'Red').artifactsUsed, 50, 1e-9);

/* ------------------------------------------------------------------ *
 * 5. Reference scenario from the handoff document                     *
 * ------------------------------------------------------------------ */
section('5. Nightmatter Circlet reference scenario');
const moon = artifact('The Moon Tarot Card');
const scenarioPool = engine.weightedPool(data, twoLocks, moon);
const mermaid = data.byName.get('Mermaid Magic');
check('112 candidates in the pool', scenarioPool.mods.length === 112, `got ${scenarioPool.mods.length}`);
check('total weighted pool is 5,575,000', scenarioPool.total === 5575000, `got ${scenarioPool.total}`);
check('Mermaid Magic weighs 30,000 under the Moon card', scenarioPool.weights.get(mermaid.id) === 30000, `got ${scenarioPool.weights.get(mermaid.id)}`);
near('chance on the next slot is 0.5381 %', scenarioPool.weights.get(mermaid.id) / scenarioPool.total * 100, 0.5381, 0.0001);
const scenarioOdds = engine.oddsAny(data, twoLocks, moon, ['Mermaid Magic']);
near('exact chance over the 2 remaining slots is 0.8391 %', scenarioOdds.odds, 0.8391, 0.0001);
check('the 2-slot result is exact, not sampled', scenarioOdds.exact === true);
const scenarioRow = engine.evaluate(data, twoLocks, moon);
near('expected Red dust is 47,670', scenarioRow.dust, 47670, 5);
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
check('total weight 5,575,000 → 4,925,000', lockedPool.total === 4925000, `got ${lockedPool.total}`);
check('Mermaid Magic weight is unchanged', lockedPool.weights.get(mermaid.id) === 30000);
near('per-slot chance rises to 0.6091 %', lockedPool.weights.get(mermaid.id) / lockedPool.total * 100, 0.6091, 0.0001);
const lockedOdds = engine.oddsAny(data, lockedCfg, moon, ['Mermaid Magic']);
near('but the single remaining slot only gives 0.6091 %', lockedOdds.odds, 0.6091, 0.0001);
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
 * 9. Lock routes                                                      *
 * ------------------------------------------------------------------ */
section('9. Lock-route candidates');
const routes = engine.lockRoutes(data, twoLocks);
check('every suggested lock actually shrinks the pool', routes.every(route => route.removed > 0));
check('no suggested lock makes the target unreachable',
  routes.every(route => engine.eligiblePool(data, route.cfg, artifact('No Artifact')).some(m => m.name === 'Mermaid Magic')));
check('no suggested lock is already locked', routes.every(route => !twoLocks.locks.includes(route.representative.name)));
check('each route leaves at least one random roll', routes.every(route => engine.rollsRemaining(route.cfg) >= 1));
check('group members all share the route Labels',
  routes.every(route => route.members.every(name => {
    const labels = [...data.byName.get(name).tags].filter(label => data.blockingLabels.has(label)).sort();
    return labels.join('|') === route.labels.join('|');
  })));
check('the ONABILITYSTAT/PROCATTACK route is found and removes 7 candidates', (() => {
  const route = routes.find(r => r.labels.join('|') === 'ONABILITYSTAT|PROCATTACK');
  return route && route.removed === 7;
})(), JSON.stringify(routes.slice(0, 3).map(r => [r.labels.join('|'), r.removed])));

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
  return plan.dust <= naive + 1e-6 && naive / plan.dust > 1.2;
})());
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

/* ------------------------------------------------------------------ */
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) { for (const name of failures) console.log(`  - ${name}`); process.exit(1); }
