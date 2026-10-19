'use strict';
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'web/training', file), 'utf8');
const { readTrainingCatalog, projectTraining } = require('../tools/training-catalog');
const catalog = readTrainingCatalog(root);
const combat = require('../web/training/index-combat');
const { Game: Base } = require('../web/training/engine').createEngine({ walls: [], water: [], tendrils: [], shades: [] });
class Quiet extends Base { shootTendril() {} }
const Game = combat.createGame(Quiet, catalog);
const options = { hp: 1000, def: 43, spd: 57, chases: 100, classId: 'class:Paladin' };
const hit = (g, dmg = 2) => g.onHit({ dmg, kind: 'ab', hit: false });

// Every projected item: compatible slot, no worn stats, no protection at start,
// real trigger/strict thresholds, every active tick, first expired tick and cooldown.
for (const item of catalog.equipment) {
  const cl = catalog.classes.find(c => c.slots.includes(item.slot));
  assert(['ability', 'armor', 'ring'].includes(item.hand));
  const g = new Game(42, { ...options, classId: cl.id, swaps: { [item.hand]: item.id } });
  assert.deepEqual([g.maxHp, g.hp, g.def, g.spdStat, g.invuln], [1000, 1000, 43, 57, 0]);
  if (item.simulation === 'manual') {
    g.mana = item.cost - 1; assert(!g.activateAbility());
    g.mana = item.cost; assert(g.activateAbility()); assert.equal(g.mana, 0);
  } else {
    g.hp = 1000 * item.below + item.damageThreshold; hit(g, item.damageThreshold);
    assert.equal(g.activeUntil, 0, item.name + ': strict threshold');
    g.hp = 100; hit(g, item.damageThreshold - 1); assert.equal(g.activeUntil, 0);
    hit(g, item.damageThreshold);
  }
  const duration = Math.round(item.duration * 60), cd = item.cooldown * 60;
  assert.equal(g.activeUntil, duration); assert.equal(g.cooldownUntil[item.id], cd);
  const hp = g.hp;
  for (let t = 0; t < duration; t++) {
    hit(g); assert.equal(g.hp, hp, item.name + ': protects tick ' + t);
    g.tick(0, 0);
  }
  assert.equal(g.healed, 0, item.name + ': no secondary healing');
  hit(g); assert.equal(g.hp, hp - 2); assert.equal(g.activeUntil, duration);
  // Set the clock to each boundary; the longer paths are already exercised by TG2.
  g.frames = g.indexTick = cd - 1;
  if (item.simulation === 'manual') { g.mana = item.cost; assert(!g.activateAbility()); }
  else { hit(g); assert.equal(g.activeUntil, duration); }
  g.frames = g.indexTick = cd;
  if (item.simulation === 'manual') assert(g.activateAbility());
  else hit(g);
  assert.equal(g.activeUntil, cd + duration, item.name + ': ready exactly at cooldown');
}
const armor = catalog.equipment.find(it => it.id === 'item:Heavy Protective Matrix');
const ring = catalog.equipment.find(it => it.hand === 'ring');
const ability = catalog.equipment.find(it => it.hand === 'ability');
const all = { ring: ring.id, armor: armor.id, ability: ability.id };
const g = new Game(42, { ...options, swaps: all });
assert.deepEqual(g.selectedItems.map(it => it.hand), ['ability', 'armor', 'ring']);
g.hp = 150; hit(g);
assert.equal(g.events.length, 2, 'both same-hit procs are evaluated');
assert(g.events[0].text.startsWith(armor.name) && g.events[1].text.startsWith(ring.name));
assert.equal(g.activeUntil, 120, 'overlap takes latest end, never sums');
assert.equal(g.cooldownUntil[armor.id], 10800); assert.equal(g.cooldownUntil[ring.id], 108000);
assert.equal(g.cooldown(ability), 0, 'passive procs do not consume ability cooldown');
assert(g.activateAbility()); assert.equal(g.activeUntil, 132);
const protectedHp = g.hp; hit(g); assert.equal(g.hp, protectedHp);
assert.equal(g.cooldownUntil[armor.id], 10800, 'blocked hits do not retrigger passives');
g.frames = g.indexTick = 10800;
hit(g);
assert.equal(g.cooldownUntil[armor.id], 21600, 'Armor is ready while Ring is still on cooldown');
assert.equal(g.cooldownUntil[ring.id], 108000);
for (const ctl of ['equip', 'unequip', 'useSlot']) assert.equal(g[ctl]('armor', false), false);
assert.deepEqual(g.eq, { armor: false, ring: false, nild: false });
const reordered = combat.createGame(Quiet, { ...catalog, equipment: [...catalog.equipment].reverse() });
assert.deepEqual(new reordered(42, { ...options, swaps: all }).selectedItems, g.selectedItems);
const alone = new Game(42, options); alone.hp = 150; hit(alone);
assert.equal(alone.events.length, 0); assert.equal(alone.activeUntil, 0);
const boosted = new Game(42, { ...options, swaps: { armor: armor.id }, consumableId: 'item:Tincture of Life' });
const unboosted = new Game(42, { ...options, swaps: { armor: armor.id } });
for (const attempt of [boosted, unboosted]) { attempt.hp = 532; hit(attempt); }
assert.equal(boosted.activeUntil, 84, 'hit threshold uses the temporary maximum');
assert.equal(unboosted.activeUntil, 0);
assert.equal(combat.selection(catalog, { swaps: all }).equipment.length, 0, 'no fallback class');
assert.equal(combat.selection(catalog, { classId: 'missing', swaps: all }).character, undefined);

// A weapon with copied, otherwise admissible declarations must not enter the projection.
const index = require('../data/Index/index.json');
const original = index.records.find(r => r.id === ability.id);
const fakeWeapon = { ...original, hand: 'weapon', slot: 1 };
assert.equal(projectTraining({ ...index, records: [...index.records.filter(r => r.kind === 'class'), fakeWeapon] }).equipment.length, 0);

// Minimal settings harness: real UI functions, isolated DOM and storage.
const prefix = 'rotmg:training:patience:';
function settings(saved, version = 'v2') {
  const storage = new Map(saved ? [[prefix + 'settings:' + version, JSON.stringify(saved)]] : []);
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', value: '', hidden: false,
      childNodes: [], addEventListener(type, cb) { this[type] = cb; }, focus() { this.focused = true; },
      replaceChildren() { this.childNodes = []; }, appendChild(p) { this.childNodes.push(p); } });
    return nodes.get(id);
  };
  const selectors = ['ability', 'armor', 'ring'].map(hand => ({ dataset: { hand }, parentElement: {}, nextElementSibling: {}, addEventListener() {} }));
  const ctx = { TRAINING_CATALOG: catalog, cv: { addEventListener() {} },
    document: { getElementById: node, querySelector: s => node(s.slice(1)), querySelectorAll: s => s === '#gearGrid select' ? selectors : [], createElement: () => ({}) },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), get length() { return storage.size; }, key: i => [...storage.keys()][i] }, addEventListener() {} };
  vm.createContext(ctx);
  vm.runInContext(read('ui_code.js') + '\n' + read('ui_gear.js') + '\n' + read('ui_game.js') +
    '\nclampSettings();save();globalThis.setup=SETTINGS;', ctx);
  return { ctx, storage, node, selectors, run: s => vm.runInContext(s, ctx) };
}
const fresh = settings();
assert.equal(fresh.ctx.setup.classId, '');
fresh.run('refreshMenu=()=>refreshGear();showStep=n=>{globalThis.shown=n};');
assert.equal(fresh.run('startGame()'), false, 'launch refused before constructing a Game');
assert.equal(fresh.ctx.shown, 1); assert(fresh.node('trainingClass').focused);
assert(fresh.node('start').disabled); assert.match(fresh.node('launchNotice').textContent, /Choose a ROTMG class/);
assert(fresh.selectors.every(s => s.parentElement.hidden));
const oldSave = { classId: options.classId, equipment: { ...all, weapon: 'item:irrelevant' }, hp: 987, consumableId: catalog.consumables[0].id };
const migrated = settings(oldSave);
assert.equal(migrated.ctx.setup.classId, options.classId); assert.equal(migrated.ctx.setup.hp, 987);
assert.deepEqual(JSON.parse(JSON.stringify(migrated.ctx.setup.swaps)), all);
assert.equal(migrated.ctx.setup.consumableId, oldSave.consumableId);
assert.equal(migrated.storage.get(prefix + 'settings:v2'), JSON.stringify(oldSave));
assert(migrated.storage.has(prefix + 'settings:v3')); assert.match(migrated.run('selectionMessage'), /Ignored incompatible/);
migrated.run('refreshMenu=()=>refreshGear();buildGear();refreshGear();');
assert(!migrated.node('start').disabled); assert(migrated.selectors.every(s => !s.parentElement.hidden));
assert.match(migrated.selectors[0].nextElementSibling.innerHTML, /120 MP.*2.2 s.*5 s/);
assert.match(migrated.selectors[0].nextElementSibling.innerHTML, /index-icon/);
migrated.node('trainingClass').value = 'class:Wizard'; migrated.node('trainingClass').change();
assert.equal(migrated.ctx.setup.swaps.ability, undefined); assert.equal(migrated.ctx.setup.swaps.armor, undefined);
assert.equal(migrated.ctx.setup.swaps.ring, ring.id); assert(migrated.selectors[0].parentElement.hidden);
assert.match(migrated.node('equipmentNotice').textContent, /Ignored incompatible.*Heavy.*Seal/);
assert.equal(migrated.ctx.setup.consumableId, oldSave.consumableId, 'class change leaves consumable independent');
const invalid = settings({ classId: 'unavailable', equipment: all });
assert.equal(invalid.ctx.setup.classId, ''); assert.equal(Object.keys(invalid.ctx.setup.swaps).length, 0);
const persisted = settings({ classId: options.classId, swaps: all }, 'v3');
assert.equal(persisted.ctx.setup.classId, options.classId);

const record = { ...options, ...migrated.run('selectionOptions()') };
const currentKey = migrated.ctx.recKey(record);
for (const diff of [{ classId: options.classId }, { swaps: {} }, { consumableId: '' }, { seedKey: '42' }, { dmgMult: 2 }])
  assert.notEqual(migrated.ctx.recKey({ ...record, ...diff }), currentKey);
for (const hand of ['ability', 'armor', 'ring']) {
  const swaps = { ...all }; delete swaps[hand];
  assert.notEqual(migrated.ctx.recKey({ ...record, swaps }), migrated.ctx.recKey({ ...record, swaps: all }));
}
assert.equal(migrated.ctx.recKey({ ...record, swaps: all }), migrated.ctx.recKey({ ...record, swaps: { ability: ability.id, armor: armor.id, ring: ring.id } }));
const tg3 = migrated.ctx.recKey({ ...options, rules: 'index-v2-postHit', equipment: all });
assert.notEqual(tg3, migrated.ctx.recKey({ ...options, rules: 'index-v3-swaps-postHit', swaps: all }));
const v1 = prefix + 'best:v1:normal:legacy';
for (const key of [v1, tg3, currentKey]) migrated.storage.set(key, JSON.stringify({ frames: 60, goal: 600 }));
migrated.ctx.showLegacyRecords();
assert.equal(migrated.node('legacyRecords').childNodes.length, 2, 'v1 and TG3 records remain visible; current records separate');
for (const key of [v1, tg3, currentKey]) assert(migrated.storage.has(key));
assert.equal(migrated.ctx.loadBest(record).frames, 60);

const ui = read('ui.html') + read('ui_gear.js') + read('ui_code.js');
assert(!/Currently Worn|Swap In|When to equip|At start|when equipped|data-hand="weapon"/.test(ui));
assert(read('ui.html').includes('Invulnerability swaps'));
assert(!/[\u00c2][\u00b7]|[\u00c3][\u201a]/.test(read('ui_gear.js') + read('ui_game.js')), 'UI separators remain UTF-8');
assert(!/\.gcur|\.gmode|\.gwait|\.gear-grid/.test(read('ui.css')));
console.log('Training swaps: required class, all 8 triggers/durations/cooldowns, MP, no secondary effects, simultaneous independent procs, slots, saves and legacy records passed.');
