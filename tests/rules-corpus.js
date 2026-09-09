'use strict';
// Run --record only when deliberately accepting a reviewed change of rules or
// source data. Ordinary npm test compares, and never rewrites, the corpus.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const engine = require('../web/engine'), fame = require('../web/fame');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'data', file), 'utf8');
const sources = {
  clientModText: read('Enchantment documents/client-enchantments.txt'),
  clientItemText: read('Items/client-items.txt'),
  clientArtifactText: read('Artifacts/client-artifacts.txt'),
  awakenText: read('Awakened Items/awakenedItems.txt')
};
const raw = JSON.parse(read('TheoryCraft/theorycraft.json'));
const data = engine.buildDataset(sources);
const t = require('./theory-harness')(sources, raw);
function clean(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') return value;
  const type = Object.prototype.toString.call(value);
  if (type === '[object Set]' || ArrayBuffer.isView(value)) return [...value].map(clean);
  if (type === '[object Map]') return [...value].map(clean);
  if (Array.isArray(value)) return value.map(clean);
  return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined && typeof value[k] !== 'function')
    .map(k => [k, k === 'artifact' ? (typeof value[k] === 'string' ? value[k] : value[k]?.name) : k === 'pool' ? value[k].map(m => m.id) : clean(value[k])]));
}
const corpus = { source: raw.from, theory: [], damage: [], searches: [], engine: [], fame: [] };
const itemNames = new Set();
const hands = ['weapon', 'ability', 'armor', 'ring'];
for (const klass of raw.classes) {
  for (let n = 0; n < 20; n++) {
    const state = t.fresh(klass.name);
    state.maxed = n % 3 !== 0; state.exalt = n % 4 !== 0;
    state.using = ['both', 'weapon', 'ability'][n % 3];
    state.against = [0, 30, 75, 150, 400][n % 5];
    t.use(state);
    for (const [at, hand] of hands.entries()) {
      const pool = t.itemsFor(hand, klass.name);
      const item = pool[(n * 37 + at * 13 + raw.classes.indexOf(klass) * 11) % pool.length];
      if (!item) continue;
      state.gear[hand].name = item.name; itemNames.add(item.name);
      for (let e = 0; e < n % 4; e++) {
        const offered = t.enchantsFor(item.name, state.gear[hand].ench, e);
        if (offered.length) state.gear[hand].ench[e] = offered[(n * 17 + at * 7 + e) % offered.length].id;
      }
    }
    const stats = t.statsOf(state), scale = t.scaleOf(state), sub = t.subOf(state);
    const weapon = raw.items.find(x => x.name === state.gear.weapon.name);
    const ability = raw.items.find(x => x.name === state.gear.ability.name);
    corpus.theory.push({ state, stats, sets: t.setsOn(state), scale, sub,
      weapon: t.weaponRate(weapon, stats.now, state.against, scale, sub),
      ability: t.abilityRate(ability, stats.now, state.against),
      numbers: t.numbersFor(state, state.against),
      scores: t.GOALS.map(goal => [goal.id, t.scoreOf(state, goal)]),
      eligible: hands.map(hand => t.enchantsFor(state.gear[hand].name, state.gear[hand].ench, 3).map(x => [x.id, x.roll])) });
  }
  // A real search over a bounded shelf: every class and goal, without making
  // the regression suite run the full interactive optimiser hundreds of times.
  const state = t.fresh(klass.name); t.use(state);
  state.scope = 'gear'; state.locked = { weapon: true, ability: true, armor: true };
  const candidates = new Set(t.itemsFor('ring', klass.name).filter((_, n) => n % 50 === 0).map(x => x.name));
  state.banned = Object.fromEntries(raw.items.filter(x => x.hand === 'ring' && !candidates.has(x.name)).map(x => [x.name, true]));
  for (const goal of t.GOALS) {
    const result = t.optimise(state, goal);
    corpus.searches.push({ klass: klass.name, goal: goal.id, ...result });
  }
  state.goals = ['dps', 'stat:hp']; state.share = { dps: 0.6, 'stat:hp': 0.4 };
  const aim = t.aimOf(state);
  corpus.searches.push({ klass: klass.name, goal: 'combined', score: t.scoreOf(state, aim), result: t.optimise(state, aim) });
}
// Complete set thresholds and the special relative/conversion items receive
// direct coverage in addition to the broad class spread above.
for (const set of raw.sets) {
  const state = t.fresh('Wizard'); t.use(state);
  for (const name of set.pieces) {
    const item = raw.items.find(x => x.name === name);
    if (item) state.gear[item.hand].name = name;
  }
  corpus.theory.push({ set: set.name, stats: t.statsOf(state), sets: t.setsOn(state), numbers: t.numbersFor(state, 75) });
}
for (const roll of [0, 1, 20, 100, 1000]) for (const att of [0, 25, 75, 200]) {
  for (const def of [0, 20, 100, 1000]) for (const pierce of [false, true]) corpus.damage.push([roll, att, def, pierce, t.landed(roll, att, def, pierce)]);
}
corpus.beaten = t.beatenOnes();
const cfgFor = n => ({ slots: 2, type: ['WEAPON','ABILITY','ARMOR','RING'][n % 4], dust: 'Red', item: '',
  subtypes: new Set(), tiers: new Set([1,2,3,4]), locks: [], desired: '', goals: [] });
corpus.baseCosts = engine.BASE_COSTS;
for (const [n, mod] of data.enchants.entries()) {
  const cfg = cfgFor(n), artifact = data.artifacts[n % data.artifacts.length];
  cfg.desired = mod.name;
  const pool = engine.eligiblePool(data, cfg, artifact);
  const goals = [mod.name];
  corpus.engine.push({ name: mod.name, artifact: artifact.name, type: cfg.type,
    eligible: pool.map(m => m.id), locked: engine.lockedLabels(data, cfg),
    weighted: (() => { const w = engine.weightedPool(data, cfg, artifact); return { weights: w.weights, total: w.total }; })(),
    weight: engine.weightFor(mod, artifact), mass: engine.tierMass(mod, artifact),
    multiplier: [new Set([1]), new Set([4]), cfg.tiers].map(tiers => engine.tierMultiplier(mod, artifact, tiers)),
    tierRules: engine.tierRules(artifact), reroll: engine.rerollCost(cfg),
    distribution: engine.distributionFor(data, cfg, artifact, goals),
    direct: engine.goalDistribution(pool, artifact, 1, [pool.filter(m => m.name === mod.name)], data.blockingLabels),
    any: engine.oddsAny(data, cfg, artifact, goals), all: engine.oddsAll(data, cfg, artifact, goals),
    cost: [0, 0.5, 25, 100].map(p => engine.costFor(cfg, p, artifact, cfg.dust)),
    evaluated: engine.evaluate(data, cfg, artifact) });
}
for (let n = 0; n < 12; n++) {
  const cfg = cfgFor(n), artifact = data.artifacts[0];
  const pool = engine.eligiblePool(data, cfg, artifact);
  const goals = [pool[n % pool.length].name, pool[(n + 13) % pool.length].name];
  const options = { artifacts: data.artifacts.slice(0, 4) };
  corpus.engine.push({ goals, type: cfg.type, plans: engine.planGoals(data, cfg, goals, options), simultaneous: engine.planSimultaneous(data, cfg, goals, options) });
}
const f = fame.parse(read('Fame/client-fame.txt'), read('Fame/availability-overrides.txt'));
corpus.fame = f.dungeons.map(d => [d.name, d.availability, fame.firstCompletion(d)]);
corpus.coverage = { classes: raw.classes.length, items: itemNames.size, goals: t.GOALS.map(g => g.id), enchantments: data.enchants.length, theoryCases: corpus.theory.length, searches: corpus.searches.length };
const result = JSON.parse(JSON.stringify(clean(corpus))), file = path.join(__dirname, 'rules-corpus.json');
function difference(a, b, at = 'corpus') {
  if (Object.is(a, b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return at;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const key of keys) {
    if (!(key in a) || !(key in b)) return at + '.' + key;
    const off = difference(a[key], b[key], at + '.' + key);
    if (off) return off;
  }
  return null;
}
if (process.argv.includes('--record')) {
  fs.writeFileSync(file, JSON.stringify(result) + '\n');
  console.log('Recorded characterisation corpus:', result.coverage);
} else {
  const off = difference(result, JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(off, null, 'Rule output changed at ' + off + '; review before recording it.');
  console.log('Rule corpus reproduced exactly:', result.coverage);
}
