'use strict';

const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const index = require('../data/Index/index.json');
const { projectTraining, readTrainingCatalog } = require('../tools/training-catalog');
const catalog = readTrainingCatalog(root);
const { createEngine } = require('../web/training/engine');
const combat = require('../web/training/index-combat');
const HazardEngine = createEngine({ walls: [], water: [], tendrils: [], shades: [] }).Game;
// Isolate effect timing from projectiles while retaining the real tick/clamp path.
class Base extends HazardEngine { shootTendril() {} }
const Game = combat.createGame(Base, catalog);
const options = { hp: 1000, def: 43, spd: 57, chases: 200, classId: 'class:Wizard' };
assert.deepEqual(catalog.consumables.map(it => it.name), ['Minor Teal Nildrop', 'Mistletoe', 'Tincture of Life']);
assert.equal(index.statBoostSource.from.build, index.from.build);
for (const item of catalog.consumables) {
  const r = index.records.find(r => r.id === item.id), boost = r.statBoosts[0];
  // Values are read from the generated client projection, never a second list.
  assert.equal(item.bonus, Number(boost.attributes.amount));
  assert.equal(item.duration, Number(boost.attributes.duration));
  assert.equal(boost.attributes.stat, 'MAXHP');
  assert.equal(boost.on, 'StatBoostSelf');
  assert.equal(item.sourceFile, index.files[r.from[0]]);
  assert.deepEqual(item.source, index.statBoostSource);
  assert.deepEqual(item.icon, r.art);
  const make = () => new Game(42, { ...options, consumableId: item.id });
  const game = make(), duration = item.duration * 60;
  assert.equal(game.maxHp, options.hp + item.bonus);
  assert.equal(game.hp, options.hp, 'MAXHP boost is not instant healing');
  for (let i = 0; i < 180; i++) game.tick(0, 0, 0, { pre: true });
  assert.equal(game.frames, 0); assert.equal(game.consumableUntil, duration);
  for (let i = 0; i < duration - 1; i++) game.tick(0, 0);
  assert(!game.ended, item.name + ': timing fixture must remain alive');
  assert.equal(game.maxHp, options.hp + item.bonus, 'last active tick');
  game.hp = game.maxHp;
  game.tick(0, 0);
  assert.equal(game.maxHp, options.hp); assert.equal(game.hp, options.hp);
  assert.equal(game.clipped, item.bonus); assert.equal(game.consumableUntil, 0);
  assert.equal(game.events.filter(e => /expired/.test(e.text)).length, 1);
  assert.equal(game.useSlot('nild'), false); assert.equal(game.equip('nild', true), false);
  assert.equal(make().maxHp, options.hp + item.bonus, 'retry starts one fresh dose');
  assert.equal(new Game(42, { ...options, consumableId: [item.id, item.id] }).maxHp, options.hp);
}

// Counterexamples are synthetic mutations of a real generated declaration.
const original = index.records.find(r => r.id === catalog.consumables[0].id);
function altered(changes = {}, boost = {}, attrs = {}) {
  const b = original.statBoosts[0];
  const item = { ...original, ...changes, statBoosts: [{ ...b, ...boost, attributes: { ...b.attributes, ...attrs } }] };
  return projectTraining({ ...index, records: [...index.records.filter(r => r.kind === 'class'), item] }, '').consumables;
}
for (const stat of ['HP', 'VIT', 'MAXMP', 'DEF']) assert.equal(altered({}, {}, { stat }).length, 0);
for (const attrs of [{ amount: undefined }, { amount: 'Infinity' }, { amount: '-1' }, { duration: '0' },
  { duration: '0.001' }, { duration: undefined }, { multiplier: '1.3' }, { onlyIn: 'realm' },
  { statRelativeTo: 'MAXHP' }, { requiredConditions: 'In Combat' }, { proc: '0.5' }, { channel: 'unknown' }]) {
  assert.equal(altered({}, {}, attrs).length, 0);
}
assert.equal(altered({}, { on: 'StatBoostAura' }).length, 0);
assert.equal(altered({}, { trigger: 'OnPlayerHitActivate' }).length, 0);
assert.equal(altered({}, { otherActivations: [{ on: 'Heal', trigger: 'Activate' }] }).length, 0);
assert.equal(altered({ conditions: [{ effect: 'Drunk' }] }).length, 0);
assert.equal(altered({ hidden: ['admin only'] }).length, 0);
assert.equal(altered({ availability: 'unreleased' }).length, 0);
const noBoost = { ...original }; delete noBoost.statBoosts;
assert.equal(projectTraining({ ...index, records: [noBoost] }, '').consumables.length, 0);

// Exercise the actual pause switch and frame-loop guard around a real dose.
const game = new Game(42, { ...options, consumableId: catalog.consumables[0].id });
const values = new Map();
const context = { g: game, scene: 'arena', keys: {}, cv: { focus() {} }, acc: 0, last: 0, fps: 60, countdown: 0,
  performance: { now: () => 0 }, requestAnimationFrame() {}, setTimeout() {},
  document: { getElementById: () => ({ hidden: true, addEventListener() {} }) }, addEventListener() {},
  localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) },
  stepGame: () => game.tick(0, 0), recordStep() {}, drawArena() {}, onRunEnd() {} };
vm.createContext(context);
const ui = fs.readFileSync(path.join(root, 'web/training/ui_game.js'), 'utf8');
vm.runInContext(ui + '\nshowOverlay=function(){};', context);
const loop = fs.readFileSync(path.join(root, 'web/training/loop.js'), 'utf8');
vm.runInContext(loop.slice(loop.indexOf('let fpsFrames=0'), loop.indexOf('Promise.all')), context);
context.setPause(true); context.loop(1000);
assert.equal(game.frames, 0); assert.equal(game.consumableUntil, catalog.consumables[0].duration * 60);
context.setPause(false); context.loop(1017); assert.equal(game.frames, 1);
const plain = { ...game.o, consumableId: '' };
for (const item of catalog.consumables) {
  const key = context.recKey({ ...plain, consumableId: item.id });
  assert.notEqual(key, context.recKey(plain));
  assert.equal(catalog.consumables.filter(other => context.recKey({ ...plain, consumableId: other.id }) === key).length, 1);
}
game.ended = true; context.onRunEnd();
assert(values.has(context.recKey(game.o)), 'a real selected consumable writes its own V2 record');
assert(!values.has(context.recKey(plain)), 'a consumable run does not overwrite the no-consumable record');
console.log('Training consumables: real Index values, full durations, countdown/pause/expiry, retries, exclusions and distinct records passed.');
