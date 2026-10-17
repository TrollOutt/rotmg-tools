'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { sourceSlice } = require('./source-slice');
const hands = [['weapon'], ['ring']];
const clone = value => JSON.parse(JSON.stringify(value));

// Preserve undefined, signed zero and non-finite numbers in the frozen rows.
function encode(value) {
  if (value === undefined) return ['undefined'];
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))
    return ['number', String(value), Object.is(value, -0)];
  if (Array.isArray(value)) return Array.from(value, encode);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).map(key => [key, encode(value[key])]));
  return value;
}

function exercise(createResults) {
  const rows = [];
  for (let mode = 0; mode < 12; mode++) {
    const calls = [];
    let data = { byClass: { Test: { slots: [1, 2] } }, byItem: { low1: {}, low2: {} } };
    let profile = { mode: 'best' };
    const state = { klass: mode === 10 ? 'missing' : 'Test', name: 'kept',
      gear: { weapon: { name: 'old', slots: mode % 3, ench: ['ok', 'bad', null] },
        ring: { name: null, slots: 1, ench: [null] } },
      locked: { weapon: !!(mode % 2), 'weapon:0': true, 'weapon:1': mode === 2 },
      goals: ['hp'], share: { hp: 100 }, extra: null };
    const goal = { id: 'hp', say: 'Life' };
    const api = createResults({ hands, HANDS: hands, alternativesTry: 6, alternativesKeep: 4,
      getData() { calls.push(['data']); return data; },
      getProfile() { calls.push(['profile']); return profile; },
      bottomOf(slot) { calls.push(['bottom', slot]); return 'low' + slot; },
      enchantFitsItem(name, ench, at) { calls.push(['fits', name, ench.slice(), at]); return ench[at] === 'ok'; },
      *optimiseSteps(trial, aim, report) {
        calls.push(['optimise', clone(trial), aim === goal, report]);
        yield 'first';
        calls.push(['resume', trial.gear.weapon.name]);
        yield 'second';
        const n = Number(trial.gear.weapon.name.slice(1));
        if (mode === 11) throw Error('kept failure');
        if (mode === 9) trial.gear.weapon.name = 'same';
        return { state: trial, looked: n + 1, score: mode === 8 ? NaN : n % 3 === 0 ? Infinity : n % 3 === 1 ? 10 : 12 };
      },
      scoreOf(probe, aim) { calls.push(['score', clone(probe), aim === goal]); return probe.value; },
      sayGoal(aim, value) { calls.push(['say', aim === goal, value]); return String(value); }
    });
    const before = clone(state), bare = api.bareOf(state);
    const best = { state, score: mode === 1 ? NaN : 10, looked: 3 };
    const leadKey = api.gearSignature(state);
    const offers = new Map([['winner', { key: leadKey, score: 100, gear: {} }]]);
    for (const n of [7, 2, 5, 1, 4, 6, 3, 0]) {
      offers.set(String(n), { key: 'k' + n, score: n % 2 ? 10 : 12,
        gear: { weapon: 'w' + n, ring: n % 2 ? 'r' : null } });
    }
    const generator = api.alternativesOfSteps(best, mode === 0 ? undefined : offers, goal);
    const lazyCalls = calls.length, yields = [];
    let ranked, error;
    try { for (;;) { const one = generator.next(); if (one.done) { ranked = one.value; break; } yields.push([one.value, clone(calls)]); } }
    catch (one) { error = one.message; }
    const context = api.alternativeContext(state);
    profile = { mode: 'personal', zones: ['changed'] };
    data = { byClass: {}, byItem: {} };
    const changedContext = api.alternativeContext(state), bareChanged = api.bareOf(state);
    const summaries = [0, -0, null, undefined, NaN, Infinity, -Infinity, 10, -10, '10'];
    const changes = summaries.map(value => [api.goalChange({ ...state, value: 12 }, goal, value)]);
    const metrics = summaries.map((value, i) => api.describeAlternative(state,
      { gear: state.gear, score: value }, { score: i % 2 ? -10 : 10 }, i % 2, [goal]));
    let remembered, validity, identities;
    if (ranked) {
      remembered = api.rememberAlternatives(ranked, state, goal);
      validity = remembered && [api.alternativesLive(remembered, state),
        api.alternativesLive({ ...remembered, at: 999 }, state),
        api.alternativesLive({ ...remembered, context: 'stale' }, state)];
      identities = [ranked.list.some(one => one.state === state),
        ranked.list.every(one => one.key === leadKey ? one.state === state : one.state !== state),
        !remembered || remembered.goal === goal,
        !remembered || remembered.list.every((one, i) => one.gear !== ranked.list[i].state.gear)];
    }
    rows.push(encode({ mode, bare, before, after: state, leadKey, lazyCalls, yields, ranked, error,
      context, changedContext, bareChanged, changes, metrics, remembered, validity, identities, calls }));
  }
  return rows;
}

// Exercise the real UI bindings, with source markers normalized for LF/CRLF.
function adapters(newline) {
  const file = path.join(__dirname, '../web/theorycraft.js');
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (newline === 'crlf') text = text.replace(/\n/g, '\r\n');
  const slice = sourceSlice(text, 'theorycraft.js');
  const binding = slice('  const resultCalculations = TheoryEngine.createResults({',
    '\n  const { optimiseSteps } = TheoryEngine.createOptimiser({');
  return deps => {
    const context = { TheoryEngine: require('../web/theory-engine'), HANDS: deps.hands, ...deps };
    Object.defineProperty(context, 'data', { get: deps.getData });
    Object.defineProperty(context, 'profile', { get: deps.getProfile });
    return vm.runInNewContext(binding + '\nresultCalculations;', context);
  };
}

module.exports = { exercise, encode, adapters };
