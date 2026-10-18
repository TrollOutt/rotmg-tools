'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const harness = require('./theory-harness');
const raw = require('../data/TheoryCraft/theorycraft.json');
const clone = value => JSON.parse(JSON.stringify(value));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sources = {
  clientModText: read('data/Enchantment documents/client-enchantments.txt'),
  clientItemText: read('data/Items/client-items.txt'),
  clientArtifactText: read('data/Artifacts/client-artifacts.txt'),
  awakenText: read('data/Awakened Items/awakenedItems.txt')
};
const near = (got, want) => assert(Math.abs(got - want) < 1e-8, `${got} != ${want}`);

// Exercise the actual delegated input handler, storage, shared-link codec and
// control synchronisation. Native keyboard/pointer behaviour is browser QA.
{
  const storage = new Map(), nodes = new Map(), labels = ['melee', 'mid', 'long'].map(id => ({
    dataset: { distanceLabel: id }, classList: { toggle(_, value) { this.on = value; } }
  }));
  const slider = { value: '', attrs: {}, style: { setProperty() {} },
    setAttribute(key, value) { this.attrs[key] = value; } };
  nodes.set('tcDistance', slider);
  nodes.set('tcGoals', { querySelectorAll: () => labels });
  const globals = {
    document: { getElementById: id => nodes.get(id) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  };
  const t = harness(sources, raw, true, globals), state = t.fresh('Wizard');
  t.use(state);
  const html = t.distanceControl();
  assert.match(html, /label for="tcDistance"/);
  assert.match(html, /type="range" min="0" max="2" step="1"/);
  assert.match(html, /aria-valuetext=/);
  let input, changes = 0;
  t.wireDistance({ addEventListener(type, fn) { assert.equal(type, 'input'); input = fn; } }, () => {
    changes++; t.keep(); t.syncDistance();
  });
  const move = value => input({ target: { id: 'tcDistance', value: String(value) } });
  for (const [position, id, distance] of [[0, 'melee', 0], [1, 'mid', 4.5], [2, 'long', 7.5]]) {
    move(position); t.syncDistance();
    assert.equal(t.rangePosition(state), position);
    assert.equal(t.standOf(state).d, distance);
    assert.equal(slider.value, String(position));
    assert(labels[position].classList.on);
    assert(slider.attrs['aria-valuetext'].startsWith(['Melee', 'Mid range', 'Long range'][position]));
    move(position); move(position); // no duplicate heavy callback
    const saved = clone(state); saved.range = id;
    assert.equal(t.unpackBuild(t.packBuild(saved)).range, id);
    t.keep();
    const reloaded = harness(sources, raw, true, globals);
    assert(reloaded.recall());
    assert.equal(reloaded.rangePosition(reloaded.recalled()), position);
  }
  assert.equal(changes, 2);
  move(1.5); move(-1); move(3); assert.equal(changes, 2);
  // A short-range weapon really stops hitting; no continuous distance formula.
  const weapon = { shots: [{ low: 100, reach: 5 }], rate: 1 };
  state.range = 'mid'; assert(t.weaponRate(weapon, { att: 25, dex: 50 }, 0, null, null, null, t.standOf(state)).dps > 0);
  state.range = 'long'; assert.equal(t.weaponRate(weapon, { att: 25, dex: 50 }, 0, null, null, null, t.standOf(state)).dps, 0);
  const legacyLink = globals.btoa(JSON.stringify({ v: 1, k: 'Wizard', g: [], m: 1, e: 1 }));
  assert.equal(t.rangePosition(t.unpackBuild(legacyLink)), 0);
  const invalidLink = globals.btoa(JSON.stringify({ v: 1, k: 'Wizard', r: 'bogus', g: [] }));
  assert.equal(t.rangePosition(t.unpackBuild(invalidLink)), 0);

  const saved = { ...clone(state), goals: ['stat:vit', 'stat:wis', 'dps'],
    share: { 'stat:vit': 25, 'stat:wis': 35, dps: 40 }, pinned: { 'stat:wis': true }, locked: { armor: true } };
  storage.set('rotmg.theorycraft.v1', JSON.stringify({ tabs: [saved], onTab: 0 }));
  assert(t.recall());
  const restored = t.recalled(); assert.deepEqual(clone(restored), saved);
  assert.deepEqual(Array.from(t.goalsOf(restored), g => g.id), ['dps', 'stat:vit', 'stat:wis']);
  near(t.scoreOf(restored, t.GOALS.find(g => g.id === 'stat:wis')), t.statsOf(restored).now.wis);
  const single = clone(restored); delete single.goals; single.goal = 'stat:wis';
  assert.deepEqual(Array.from(t.goalsOf(single), g => g.id), ['stat:wis']);
  const legacyNodes = new Map(['stat:vit', 'stat:wis'].map(id => [id, {}]));
  nodes.set('tcGoals', { querySelector: selector => legacyNodes.get(/data-goal="([^"]+)"/.exec(selector)[1]) });
  nodes.set('tcLegacyGoals', {}); t.syncLegacyGoals();
  assert.equal(nodes.get('tcLegacyGoals').hidden, false);
  assert.equal(legacyNodes.get('stat:wis').hidden, false);
  restored.goals = ['regen:mp']; t.syncLegacyGoals();
  assert.equal(nodes.get('tcLegacyGoals').hidden, true);
  assert.equal(legacyNodes.get('stat:wis').hidden, true);
  t.keep(); assert(t.recall()); assert.equal(t.recalled().goals[0], 'regen:mp');
}

// A deliberately small shelf makes the optimum independently enumerable.
// The item with most raw WIS/VIT has a combat penalty; it must not prune the
// lower-stat winner. The same fixture tests ranking and combined objectives.
{
  const seed = harness(sources, raw), initial = seed.fresh('Wizard');
  const ring = raw.items.find(i => i.name === initial.gear.ring.name);
  const small = { ...clone(raw), classes: raw.classes.filter(c => c.name === 'Wizard'),
    items: [...Object.values(initial.gear).map(w => raw.items.find(i => i.name === w.name)),
      { ...clone(ring), name: 'High raw', worn: { WIS: 30, VIT: 30, ATT: 30 }, tier: undefined },
      { ...clone(ring), name: 'Better passive', worn: { WIS: 20, VIT: 20 }, tier: undefined }], sets: [] };
  const t = harness(sources, small), info = new Map([['High raw', { combat: { WIS: -30, VIT: -30 } }]]);
  t.setGearInfo(info);
  const state = t.fresh('Wizard'); state.scope = 'gear';
  state.locked = { weapon: true, ability: true, armor: true };
  t.use(state);
  assert(t.beatenOnes().gear.has('Better passive'), 'fixture is dominated on raw statistics');
  for (const id of ['regen:hp', 'regen:mp']) {
    const goal = t.GOALS.find(g => g.id === id); state.goals = [id];
    const high = clone(state), better = clone(state);
    high.gear.ring.name = 'High raw'; better.gear.ring.name = 'Better passive';
    assert(t.statsOf(high).now.wis > t.statsOf(better).now.wis);
    assert(t.scoreOf(better, goal) > t.scoreOf(high, goal));
    const gather = new Map(), result = t.optimise(state, goal, null, gather);
    assert.equal(result.state.gear.ring.name, 'Better passive');
    assert.equal(result.score, t.scoreOf(better, goal));
    assert.equal(result.state.gear.armor.name, state.gear.armor.name);
    const alternatives = t.alternativesOf(result, gather, goal).list;
    for (const alt of alternatives) {
      near(alt.score, t.scoreOf(alt.state, goal));
      assert(alt.score <= result.score + 1e-8);
    }
    const held = clone(state); held.gear.ring.name = 'High raw'; held.locked.ring = true;
    assert.equal(t.optimise(held, goal).state.gear.ring.name, 'High raw');
  }
  state.goals = ['regen:hp', 'regen:mp']; state.share = { 'regen:hp': 70, 'regen:mp': 30 };
  state.pinned = { 'regen:hp': true };
  const aim = t.aimOf(state), combined = t.optimise(state, aim);
  assert.equal(combined.state.gear.ring.name, 'Better passive');
  assert.deepEqual(clone(combined.state.share), state.share);
  assert.deepEqual(clone(combined.state.pinned), state.pinned);
  assert.deepEqual(Array.from(t.sharesOf(state), s => s.part), [0.7, 0.3]);
  state.goals = ['dps', 'regen:hp']; state.share = { dps: 60, 'regen:hp': 40 };
  state.pinned = {};
  const mixed = t.aimOf(state), mixedResult = t.optimise(state, mixed);
  const exhaustive = small.items.filter(i => i.hand === 'ring').map(item => {
    const trial = clone(state); trial.gear.ring.name = item.name;
    return t.scoreOf(trial, mixed);
  });
  near(mixedResult.score, Math.max(...exhaustive));
}

// Real client-projected enchantments, evaluated and selected by the real
// eligibility/optimisation pipeline. Extra max HP/MP can beat extra VIT/WIS.
{
  const t = harness(sources, raw), state = t.fresh('Wizard'); t.use(state);
  const goal = id => t.GOALS.find(g => g.id === id);
  state.scope = 'ench';
  for (const hand of ['weapon', 'ability', 'armor', 'ring']) {
    state.locked[hand] = true; state.gear[hand].slots = 0; state.gear[hand].ench = [];
  }
  state.gear.armor.name = 'Robe of the Grand Sorcerer';
  assert(raw.items.some(i => i.name === state.gear.armor.name));
  for (const [id, prefix, hand] of [['regen:hp', 'Life', 'armor'], ['regen:mp', 'Mana', 'ability']]) {
    state.gear.armor.slots = state.gear.ability.slots = 0;
    state.gear.armor.ench = []; state.gear.ability.ench = [];
    state.gear[hand].slots = 1; state.gear[hand].ench = [null];
    state.goals = [id];
    const available = t.enchantsFor(state.gear[hand].name, [null], 0).filter(e => e.heal && (e.heal['flat' + (prefix === 'Life' ? 'HP' : 'MP')] || e.heal['part' + (prefix === 'Life' ? 'HP' : 'MP')]));
    assert(available.length >= 2, 'flat and percentage regeneration are eligible');
    const result = t.optimise(state, goal(id));
    const candidates = t.enchantsFor(state.gear[hand].name, [null], 0).map(e => {
      const trial = clone(state); trial.gear[hand].ench[0] = e.id;
      return t.scoreOf(trial, goal(id));
    });
    near(result.score, Math.max(...candidates));
    assert(result.score > t.scoreOf(state, goal(id)));
    const selected = raw.enchants.find(e => e.id === result.state.gear[hand].ench[0]);
    assert(selected.heal, 'a regeneration enchant beats a raw-stat enchant');
    const locked = clone(state);
    locked.gear[hand].ench[0] = available[0].id; locked.locked[hand + ':0'] = true;
    assert.equal(t.optimise(locked, goal(id)).state.gear[hand].ench[0], available[0].id);
  }
  for (const [key, stat, maximum, part] of [['hp', 'VIT', 'HP', 'Percentage_Life_Regen_4'], ['mp', 'WIS', 'MP', 'Percentage_Mana_Regen_4']]) {
    const a = clone(state), b = clone(state);
    const hand = key === 'hp' ? 'armor' : 'ability';
    a.gear[hand].ench = b.gear[hand].ench = [part];
    // Synthetic rings isolate exactly one contribution while keeping the
    // regeneration effect itself from the client projection.
    const local = clone(raw), ring = raw.items.find(i => i.name === state.gear.ring.name);
    local.items.push({ ...clone(ring), name: 'More capacity', worn: { [maximum]: 300 } },
      { ...clone(ring), name: 'More stat', worn: { [stat]: 5 } });
    const probe = harness(sources, local); a.gear.ring.name = 'More capacity'; b.gear.ring.name = 'More stat';
    assert(probe.statsOf(a).now[stat.toLowerCase()] < probe.statsOf(b).now[stat.toLowerCase()]);
    const objective = probe.GOALS.find(g => g.id === 'regen:' + key);
    assert(probe.scoreOf(a, objective) > probe.scoreOf(b, objective));
  }
  // Aggregate recovery includes these sources; passive objectives must not.
  const base = t.scoreOf(state, goal('regen:hp'));
  state.assume.Healing = true;
  t.setGearInfo(new Map([[state.gear.armor.name, {
    gains: [{ on: 'shoot', proc: 1, cooldown: 1, give: 'hp', amount: 100 }],
    boosts: [{ on: 'shoot', proc: 1, cooldown: 1, stat: 'VIT', amount: 100, duration: 2 }]
  }]]));
  assert(t.numbersFor(state, 0).regen.hp.combat > base + 20);
  near(t.scoreOf(state, goal('regen:hp')), base);
  const mpBase = t.scoreOf(state, goal('regen:mp'));
  t.setGearInfo(new Map([[state.gear.ability.name, {
    gains: [{ on: 'shoot', proc: 1, cooldown: 1, give: 'mp', amount: 100 }],
    boosts: [{ on: 'shoot', proc: 1, cooldown: 1, stat: 'WIS', amount: 100, duration: 2 }]
  }]]));
  assert(t.numbersFor(state, 0).regen.mp.combat > mpBase + 20);
  near(t.scoreOf(state, goal('regen:mp')), mpBase);
}
const en = JSON.parse(read('web/locales/en/common.json'));
for (const text of ['HP Regeneration (HP/s)', 'MP Regeneration (MP/s)',
  'Melee \u2014 on the target', 'Mid range \u2014 3 to 6 tiles away', 'Long range \u2014 6 to 9 tiles away']) {
  assert(Object.values(en).includes(text), `UI text is catalogued exactly: ${text}`);
}
console.log('Theory range/regeneration: discrete input, persistence, legacy objectives, passive scoring, gear/enchant optima, locks, shares and rankings pass.');
