'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../web/engine.js');

const root = path.join(__dirname, '..');
const read = (...parts) =>
  fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');

const data = engine.buildDataset({
  clientModText: read('Enchantment documents', 'client-enchantments.txt'),
  clientItemText: read('Items', 'client-items.txt'),
  clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt')
});

const artifact = name => {
  const found = data.byArtifact.get(name);
  assert(found, `fixture artifact exists: ${name}`);
  return found;
};

const baseCfg = extra => Object.assign({
  slots: 4,
  type: 'RING',
  dust: 'Red',
  item: '',
  subtypes: new Set(),
  tiers: new Set([1, 2, 3, 4]),
  locks: [],
  desired: '',
  goals: []
}, extra);

/* ------------------------------------------------------------------ *
 * Cost objective                                                      *
 * ------------------------------------------------------------------ */

const synthetic = (dust, value, consumeProb) => ({
  name: 'Synthetic Artifact',
  cost: { dust, value },
  consumeProb
});

{
  const cfg = baseCfg();

  const same = engine.costFor(
    cfg, 10, synthetic('Red', 25, 0.5), 'Red'
  );

  const other = engine.costFor(
    cfg, 10, synthetic('Green', 25, 0.5), 'Red'
  );

  assert.equal(same.rerolls, 10, 'OPT-001 geometric wait is 1/p');
  assert.equal(same.perReroll, 100, 'OPT-001 base 4-slot reroll costs 100');
  assert.equal(same.dust, 1250,
    'OPT-002 same-colour artifact dust belongs to the primary objective');

  assert.equal(other.dust, 1000,
    'OPT-003 other-colour artifact dust does not inflate primary dust');

  assert.equal(other.artifactDust, 250,
    'OPT-003 other-colour artifact dust remains visible separately');

  assert.equal(other.artifactDustType, 'Green',
    'OPT-003 secondary dust keeps its own currency');
}

{
  const unlocked = engine.costFor(
    baseCfg(), 10, synthetic('Red', 25, 0.5), 'Red'
  );

  const locked = engine.costFor(
    baseCfg({ locks: ['already locked'] }),
    10,
    synthetic('Red', 25, 0.5),
    'Red'
  );

  assert.equal(locked.perReroll, unlocked.perReroll * 2,
    'OPT-004 each lock doubles later reroll cost');

  assert.equal(locked.dust, unlocked.dust * 2,
    'OPT-004 same-colour artifact charge follows the lock multiplier');
}

{
  const half = engine.costFor(
    baseCfg(), 10, synthetic('na', 0, 0.5), 'Red'
  );

  const always = engine.costFor(
    baseCfg(), 10, synthetic('na', 0, 1), 'Red'
  );

  assert.equal(half.dust, always.dust,
    'OPT-006 consume probability does not change the dust objective');

  assert.equal(half.rerolls, always.rerolls,
    'OPT-006 consume probability does not change roll odds');

  assert.equal(half.artifactsUsed, 5,
    'OPT-006 50% consumption changes expected artifacts used');

  assert.equal(always.artifactsUsed, 10,
    'OPT-006 100% consumption changes expected artifacts used');
}

{
  const impossible = engine.costFor(
    baseCfg(), 0, synthetic('na', 0, 0.5), 'Red'
  );

  assert.equal(impossible.dust, Infinity,
    'OPT-007 zero probability has infinite expected dust');

  assert.equal(impossible.rerolls, Infinity,
    'OPT-007 zero probability has infinite expected wait');
}

{
  const none = artifact('No Artifact');
  const result = engine.costFor(baseCfg(), 10, none, 'Red');

  assert.equal(result.artifactDust, 0,
    'OPT-008 No Artifact never spends artifact dust');

  assert.equal(result.artifactsUsed, 0,
    'OPT-008 No Artifact consumes no artifact');
}

/* ------------------------------------------------------------------ *
 * Conditional multi-goal strategy                                     *
 * ------------------------------------------------------------------ */

const goals = ['Mermaid Magic', 'Dust Bonus'];

const planCfg = baseCfg({
  item: 'Nightmatter Circlet',
  locks: ["Night's Soul"],
  desired: goals[0],
  goals: [goals[1]]
});

const plan = engine.planGoals(data, planCfg, goals);

assert(plan && plan.feasible,
  'OPT-021 reference conditional plan must remain feasible');

assert(Number.isFinite(plan.dust) && plan.dust > 0,
  'OPT-021 global policy must have a finite objective');

assert(plan.path.length >= 2,
  'OPT-021 reference policy contains multiple decision states');

{
  const first = plan.path[0];

  assert(first.hunt.includes('Mermaid Magic'),
    'OPT-026 policy hunts the difficult goal before the cheap goal');

  assert(first.declined.some(one => one.name === 'Dust Bonus'),
    'OPT-024 a wanted enchant may deliberately be thrown back');

  const dustAlone = first.decisions.find(decision =>
    decision.rolled.length === 1
    && decision.rolled[0] === 'Dust Bonus'
  );

  assert(dustAlone,
    'OPT-024 singleton Dust Bonus decision is exposed');

  assert.equal(dustAlone.action, 'reroll',
    'OPT-024 Dust Bonus alone is rerolled in the reference state');

  assert.deepEqual(dustAlone.lock, [],
    'OPT-024 rejected wanted result locks nothing');

  const mermaidAlone = first.decisions.find(decision =>
    decision.rolled.length === 1
    && decision.rolled[0] === 'Mermaid Magic'
  );

  assert(mermaidAlone,
    'OPT-023 singleton Mermaid Magic decision is exposed');

  assert.equal(mermaidAlone.action, 'lock',
    'OPT-023 the useful singleton result is locked');

  assert.deepEqual(mermaidAlone.lock, ['Mermaid Magic'],
    'OPT-023 policy locks the selected wanted result');
}

{
  const used = new Set(plan.path.map(step => step.artifact.name));

  assert(used.size > 1,
    'OPT-022 reference optimum really changes artifact between phases');
}

{
  const together = engine.planSimultaneous(data, planCfg, goals);

  assert(together && Number.isFinite(together.dust),
    'OPT-028 simultaneous comparison remains feasible');

  assert(plan.dust <= together.dust + 1e-9,
    'OPT-028 conditional optimum never loses to all-goals-at-once');
}

/* ------------------------------------------------------------------ *
 * Allowed artifact action space                                       *
 * ------------------------------------------------------------------ */

const representativeArtifacts = [
  'No Artifact',
  'Premium Diamond Card',
  'Premium Gold Card',
  'Premium Silver Card',
  'The Moon Tarot Card',
  'Ascension Ankh',
  'The Fool Tarot Card'
].map(artifact);

const fixedPlans = representativeArtifacts.map(one => ({
  artifact: one,
  plan: engine.planGoals(data, planCfg, goals, { artifacts: [one] })
}));

for (const entry of fixedPlans) {
  assert(entry.plan && entry.plan.feasible,
    `OPT-030 fixed-artifact plan remains feasible: ${entry.artifact.name}`);

  assert(
    entry.plan.path.every(step => step.artifact.name === entry.artifact.name),
    `OPT-030 planner must obey hard artifact constraint: ${entry.artifact.name}`
  );
}

const flexibleRepresentative = engine.planGoals(
  data,
  planCfg,
  goals,
  { artifacts: representativeArtifacts }
);

assert(flexibleRepresentative && flexibleRepresentative.feasible,
  'OPT-032 representative action set remains feasible');

const bestFixed = Math.min(...fixedPlans.map(entry => entry.plan.dust));

assert(
  flexibleRepresentative.dust <= bestFixed + 1e-9,
  'OPT-033 dynamic artifact policy never loses to best fixed artifact'
);

assert(
  flexibleRepresentative.dust < bestFixed - 1e-6,
  'OPT-033 reference scenario proves phase-specific artifact choice has value'
);

{
  const diamond = artifact('Premium Diamond Card');

  const oneChoice = engine.planGoals(
    data, planCfg, goals, { artifacts: [diamond] }
  );

  const twoChoices = engine.planGoals(
    data,
    planCfg,
    goals,
    { artifacts: [diamond, artifact('The Moon Tarot Card')] }
  );

  assert(
    twoChoices.dust <= oneChoice.dust + 1e-9,
    'OPT-032 adding an allowed artifact cannot worsen the optimum'
  );
}

/* ------------------------------------------------------------------ *
 * Accepted tiers                                                      *
 * ------------------------------------------------------------------ */

{
  const tierGoals = ['Mana -any Tradeoff', 'Attack Bonus'];
  const onlyNoArtifact = [artifact('No Artifact')];

  const make = tiers => baseCfg({
    type: 'ARMOR',
    item: '',
    desired: tierGoals[0],
    goals: [tierGoals[1]],
    tiers: new Set(tiers)
  });

  const all = engine.planGoals(
    data,
    make([1, 2, 3, 4]),
    tierGoals,
    { artifacts: onlyNoArtifact }
  );

  const tier4 = engine.planGoals(
    data,
    make([4]),
    tierGoals,
    { artifacts: onlyNoArtifact }
  );

  assert(all && all.feasible && tier4 && tier4.feasible,
    'OPT-034 tier comparison plans remain feasible');

  assert(
    tier4.dust >= all.dust - 1e-9,
    'OPT-034 accepting fewer tiers cannot make the optimum cheaper'
  );
}

/* ------------------------------------------------------------------ *
 * Determinism and displayed path                                      *
 * ------------------------------------------------------------------ */

{
  const again = engine.planGoals(data, planCfg, goals);

  assert.equal(again.dust, plan.dust,
    'OPT-042 identical input gives identical optimal dust');

  assert.equal(again.rerolls, plan.rerolls,
    'OPT-042 identical input gives identical expected rerolls');

  assert.deepEqual(
    again.path.map(step => [
      step.artifact.name,
      step.locked,
      step.pending,
      step.expectedDustFromHere
    ]),
    plan.path.map(step => [
      step.artifact.name,
      step.locked,
      step.pending,
      step.expectedDustFromHere
    ]),
    'OPT-042 identical input gives identical displayed policy'
  );
}

assert(
  plan.path.every((step, index) =>
    index === 0
    || step.expectedDustFromHere
      <= plan.path[index - 1].expectedDustFromHere + 1e-9
  ),
  'OPT-043 expected remaining dust decreases along the displayed path'
);

console.log('enchant optimization contract: ok');
