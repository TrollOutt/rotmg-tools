'use strict';
const fs = require('fs'), path = require('path');
const harness = require('./theory-harness');
const { encode } = require('./theory-results-harness');
const raw = require('../data/TheoryCraft/theorycraft.json');
const sources = Object.fromEntries([
  ['clientModText', 'Enchantment documents/client-enchantments.txt'],
  ['clientItemText', 'Items/client-items.txt'],
  ['clientArtifactText', 'Artifacts/client-artifacts.txt'],
  ['awakenText', 'Awakened Items/awakenedItems.txt']
].map(([key, file]) => [key, fs.readFileSync(path.join(__dirname, '../data', file), 'utf8')]));

module.exports = function realCases() {
  const rows = [];
  for (const [klass, goalId, scope, personal, locks] of [
    ['Wizard', 'dps', 'gear', false, false],
    ['Archer', 'kill', 'helps', false, true],
    ['Warrior', 'stat:hp', 'gear', false, true],
    ['Ninja', 'stat:dex', 'all', false, true],
    ['Wizard', 'stat:hp', 'helps', true, false],
    ['Priest', 'unknown', 'gear', false, false]
  ]) {
    const t = harness(sources, raw, true), state = t.fresh(klass);
    state.scope = scope;
    if (locks) {
      const item = t.searchItems('weapon', klass, state).find(one => one.name !== state.gear.weapon.name);
      const enchant = t.enchantsFor(item.name, [], 0).find(one => one.id);
      state.gear.weapon = { name: item.name, slots: 2, ench: [enchant.id, null] };
      state.locked.weapon = true; state.locked['weapon:0'] = true;
      state.banned = { ring: t.searchItems('ring', klass, state).slice(-3).map(one => one.name) };
    }
    if (personal) {
      const items = raw.items.filter(one => one.tier !== undefined && one.tier <= 7);
      t.progression({ zones: [{ id: 'fixture', kind: 'dungeon' }], starter: new Set(),
        sources: new Map(items.map(one => [one.name, new Set(['fixture'])])) },
      { mode: 'personal', zones: ['fixture'], biomeRanks: [] });
      state.searchUntiered = false; state.searchSets = false;
    }
    t.use(state);
    const wanted = t.goalsOf({ goal: goalId }), plain = t.prepareAccessible(t.bareOf(state));
    const aim = t.aimOf(plain, wanted), was = wanted.map(goal => t.scoreOf(state, goal));
    const gather = new Map(), fromPlain = t.optimise(plain, aim, null, gather);
    const fromHere = t.optimise(state, aim, null, gather);
    const best = fromPlain.score >= fromHere.score ? fromPlain : fromHere;
    const ranked = t.alternativesOf(best, gather, aim);
    rows.push(encode({ klass, goalId, plain, was, fromPlain, fromHere, gather: [...gather], ranked,
      input: state, identities: [ranked.list.some(one => one.state === best.state),
        ranked.list.every(one => one.key !== t.gearSignature(best.state) || one.state === best.state)] }));
  }
  return rows;
};
