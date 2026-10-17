'use strict';
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const { exercise, adapters } = require('./theory-results-harness');
const corpus = require('./theory-results-corpus.json');
const frozen = JSON.parse(zlib.gunzipSync(Buffer.from(corpus.gzip, 'base64')));
const engineFile = path.join(__dirname, '../web/theory-engine.js');
const text = fs.readFileSync(engineFile, 'utf8').replace(/\r\n/g, '\n');

// No document, window, timer, catalogue or browser service exists at module load.
for (const newline of ['lf', 'crlf']) {
  const context = { module: { exports: {} } };
  vm.runInNewContext(newline === 'crlf' ? text.replace(/\n/g, '\r\n') : text, context);
  const factory = context.module.exports.createResults;
  assert.equal(typeof factory, 'function');
  assert.deepEqual(exercise(factory), frozen.synthetic, newline + ': pure result model');
  assert.deepEqual(exercise(adapters(newline)), frozen.synthetic, newline + ': live UI bindings');
}
assert.deepEqual(require('./theory-results-cases')(), frozen.real,
  'six real catalogue searches: inputs, ordered gather, results, ties, locks and identities');

// A factory binds once, and each generator owns its trials and restored lock map.
{
  const { createResults } = require('../web/theory-engine');
  const hands = [['weapon']];
  const state = { klass: 'Test', gear: { weapon: { name: 'winner', slots: 1, ench: ['kept'] } }, locked: { 'weapon:0': true } };
  const goal = { id: 'test' }, trials = [], completions = [], fitting = [];
  const api = createResults({ hands, alternativesTry: 6, alternativesKeep: 4,
    getData: () => ({ byClass: {}, byItem: {} }), getProfile: () => null,
    bottomOf: () => null, scoreOf: () => 0, sayGoal: () => '',
    enchantFitsItem(name, had, at) { fitting.push([name, had, at]); return true; },
    *optimiseSteps(trial, aim, report) {
      assert.equal(aim, goal); assert.equal(report, null);
      assert.equal(trial.locked.weapon, true);
      assert.notEqual(trial.gear.weapon.ench, fitting.at(-1)[1]);
      const temporaryLocks = trial.locked;
      trials.push(trial); yield;
      const done = { state: trial, score: 1, looked: 7 };
      completions.push([done, temporaryLocks]); return done;
    }
  });
  const best = { state, score: 1, looked: 10 };
  const gather = new Map([['offer', { key: 'other', score: 1, gear: { weapon: 'other' } }]]);
  const left = api.alternativesOfSteps(best, gather, goal), right = api.alternativesOfSteps(best, gather, goal);
  assert.equal(trials.length, 0, 'generator stays lazy');
  assert.equal(left.next().done, false); assert.equal(right.next().done, false);
  const l = left.next().value, r = right.next().value;
  assert.equal(l.list[0].state, state, 'lead wins an exact tie by identity');
  assert.equal(l.list[1].state, completions[0][0].state, 'return optimiser state itself');
  assert.notEqual(l.list[1].state.locked, completions[0][1], 'replace temporary item locks');
  assert.deepEqual(l.list[1].state.locked, state.locked);
  assert.notEqual(l.list[1].state, r.list[1].state, 'overlapping generators remain independent');
  assert.notEqual(l.list[1].state.locked, r.list[1].state.locked);
  assert.equal(l.looked, 7);
  const remembered = api.rememberAlternatives(l, state, goal);
  assert.equal(remembered.goal, goal);
  remembered.list[1].gear.weapon.name = 'changed snapshot';
  assert.equal(l.list[1].state.gear.weapon.name, 'other');
  assert.equal(state.gear.weapon.name, 'winner');
  assert.equal(api.alternativesLive(null, state), false);
  assert.equal(api.gearSignature(null), '');
  assert.equal(api.gearSignature({ gear: {} }), '');
}
console.log('Theory results: frozen real searches and dependency traces, DOM-free LF/CRLF factories/adapters, identities and overlapping generators match.');
