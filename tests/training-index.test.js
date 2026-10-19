'use strict';
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const { projectTraining, readTrainingCatalog } = require('../tools/training-catalog');
const catalog = readTrainingCatalog(root);
const { createEngine } = require('../web/training/engine');
const combat = require('../web/training/index-combat');
const { Game: HazardEngine } = createEngine({ walls: [], water: [], tendrils: [], shades: [] });
// Isolate effect timing from incoming projectiles, without replacing damage formulas.
class HistoricalGame extends HazardEngine { shootTendril() {} }
const Game = combat.createGame(HistoricalGame, catalog);
const index = require('../data/Index/index.json');
const byId = new Map(index.records.map(r => [r.id, r]));
assert.equal(catalog.classes.length, 19);
assert.equal(catalog.equipment.length, 8);
assert.equal(catalog.consumables.length, 0, 'missing temporary stat values must never become guessed consumables');
assert.equal(catalog.healingPerSecond, 20);
for (const item of catalog.equipment) {
  const source = byId.get(item.id);
  const c = source.conditions.find(c => c.effect === 'Invulnerable');
  assert.equal(item.name, source.name);
  assert.equal(item.clientId, source.clientId);
  assert.deepEqual(item.icon, source.art);
  assert.equal(item.duration, Number(c.duration));
  assert.equal(item.cooldown, Number(c.cooldown ?? source.cool));
  assert(item.duration > 0 && item.cooldown > 0);
  assert(!source.hidden?.length && !source.availability);
  for (const cl of catalog.classes) {
    const selected = combat.selection(catalog, { classId: cl.id, equipment: { [item.hand]: item.id } });
    assert.equal(selected.equipment.length, cl.slots.includes(source.slot) ? 1 : 0, cl.name + '/' + item.name);
  }
}
assert(catalog.excluded.some(it => it.id === "item:Royal Guard's Cuirass" && /conditions/.test(it.reason)));
assert(catalog.excluded.some(it => it.id === "item:Conqueror's Crown" && /not available/.test(it.reason)));
for (const name of ['Tincture of Life', 'Effusion of Life', 'Blood Nildrop']) {
  assert(catalog.excluded.some(it => it.id === 'item:' + name && /stat, amount and duration/.test(it.reason)));
}
// Mutate real declarations as counterexamples, rather than maintaining another item list.
const sealSource = byId.get('item:Seal of Blasphemous Prayer');
function altered(changes, condition = {}) {
  const source = { ...sealSource, ...changes, conditions: [{ ...sealSource.conditions[2], ...condition }] };
  return projectTraining({ ...index, records: [...index.records.filter(r => r.kind === 'class'), source] }, '');
}
for (const effect of ['Armored', 'Healing', 'Damaging']) assert.equal(altered({}, { effect }).equipment.length, 0);
for (const condition of [{ duration: undefined }, { duration: '-1' }, { duration: 'Infinity' }, { proc: '0.5' }, { requiredConditions: 'In Combat' }, { trigger: 'OnPlayerShootActivate' }]) {
  assert.equal(altered({}, condition).equipment.length, 0);
}
assert.equal(altered({ cool: undefined }).equipment.length, 0);
assert.equal(altered({ mp: undefined }).equipment.length, 0);
assert.equal(altered({ availability: 'unreleased' }).equipment.length, 0);
assert.equal(altered({ hidden: ['admin only'] }).equipment.length, 0);
const empty = { ...catalog, equipment: [] };
assert.deepEqual(combat.selection(empty, { classId: catalog.classes[0].id }).equipment, []);
const options = { hp: 1000, def: 43, spd: 57, chases: 100, classId: 'class:Wizard' };
const hit = (game, dmg = 45, kind = 'ab') => game.onHit({ dmg, kind, hit: false });
const matrix = catalog.equipment.find(it => it.id === 'item:Magic Protective Matrix');
function matrixGame() { return new Game(42, { ...options, equipment: { armor: matrix.id } }); }
const plain = new Game(42, options), equipped = matrixGame();
assert.equal(equipped.invuln, 0, 'equipping does not activate protection');
hit(plain, 100, 'sr'); hit(equipped, 100, 'sr');
assert.equal(equipped.hp, plain.hp, 'no DEF or damage reduction from selecting a piece outside its window');
assert.equal(equipped.def, options.def);
assert.equal(equipped.spdStat, options.spd);
equipped.curse = 0; equipped.hp = 551; hit(equipped, 52);
assert.equal(equipped.hp, 499, 'triggering damage is applied first');
assert.equal(equipped.activeUntil, 84);
hit(equipped); assert.equal(equipped.hp, 499);
assert.equal(equipped.blocked, 1);
for (let i = 0; i < 83; i++) equipped.tick(0, 0);
hit(equipped); assert.equal(equipped.hp, 499, 'last active tick still protects');
equipped.tick(0, 0);
hit(equipped); assert.equal(equipped.hp, 454, 'first expired tick takes full damage');
assert.equal(equipped.activeUntil, 84, 'cooldown prevents retrigger');
for (let i = equipped.frames; i < 10800; i++) equipped.tick(0, 0);
hit(equipped); assert.equal(equipped.activeUntil, 10884, '180-second cooldown expires exactly');
const edge = matrixGame(); edge.hp = 545; hit(edge); assert.equal(edge.hp, 500); assert.equal(edge.activeUntil, 0, 'threshold is strict');
edge.hp = 100; hit(edge, 1); assert.equal(edge.activeUntil, 0, 'damage threshold is enforced');
edge.hp = 1; hit(edge, 45); assert.equal(edge.activeUntil, 0, 'lethal damage cannot be rescued');
const bleed = matrixGame(); bleed.hp = 100; hit(bleed, 2); bleed.bleed = 10; bleed.tick(0, 0);
assert(bleed.hp < 98, 'Invulnerable does not erase status damage');
const collision = matrixGame();
collision.projs.push({ x: 141, y: 200, vx: 0, vy: 0, dir: 0, life: 2, kind: 'ab', dmg: 501, hit: false, m: [-1,-1,1,1] });
collision.tick(0, 0);
assert.equal(collision.events[0].f, 1);
assert.equal(collision.activeUntil, 85, 'proc gets all 84 ticks after its actual collision boundary');
assert.equal(collision.invuln, 84);
const amulet = new Game(42, { ...options, equipment: { ring: 'item:Amulet of Restoration' } });
amulet.hp = 245; hit(amulet); assert.equal(amulet.activeUntil, 0, 'exactly 20 percent does not proc');
hit(amulet); assert.equal(amulet.activeUntil, 120); assert.equal(amulet.cooldownUntil['item:Amulet of Restoration'], 108000);
const seal = catalog.equipment.find(it => it.simulation === 'manual');
const paladin = new Game(42, { ...options, classId: 'class:Paladin', equipment: { ability: seal.id } });
paladin.tick(0, 0, 0, { pre: true, ability: true });
assert.equal(paladin.mana, 300); assert.equal(paladin.activeUntil, 0, 'countdown cannot spend MP or activate');
paladin.hp = 500;
paladin.tick(0, 0, 0, { ability: true });
assert.equal(paladin.activeUntil, 132); assert.equal(paladin.mana, 180);
assert.equal(paladin.healingUntil, 450, '5 s + (75 WIS - 50) * 0.1 s');
assert(paladin.hp > 500, 'Healing uses the repository status model');
assert(!paladin.activateAbility(), 'manual cooldown is enforced');
for (let i = 1; i < 132; i++) paladin.tick(0, 0);
const preHit = paladin.hp; hit(paladin); assert.equal(paladin.hp, preHit - 45, 'no damage reduction after manual protection expires');
for (let i = paladin.frames; i < 300; i++) paladin.tick(0, 0);
assert(paladin.activateAbility()); assert.equal(paladin.mana, 60);
for (let i = paladin.frames; i < 600; i++) paladin.tick(0, 0);
assert(!paladin.activateAbility(), 'MP cost is required, no invented regeneration');
const invalid = new Game(42, { ...options, equipment: { ability: seal.id, armor: 'item:Wretched Rags' }, consumableId: 'item:Blood Nildrop', gear: { nild: { id: 'blood', mode: 'start', at: 1 } } });
assert.equal(invalid.selectedItems.length, 0); assert.equal(invalid.maxHp, 1000, 'invalid and archive gear cannot bypass the Index boundary');

// No eligible real consumable has complete values in this Index. The lifecycle is
// verified using explicitly synthetic normalized test data, never shipped to players.
const fixture = { id: 'test:temporary-maxhp', name: 'Synthetic test bonus', bonus: 150, duration: 1 };
const FixtureGame = combat.createGame(HistoricalGame, { ...catalog, consumables: [fixture] });
const consume = () => new FixtureGame(42, { ...options, consumableId: fixture.id });
const con = consume();
assert.equal(con.maxHp, 1150); assert.equal(con.hp, 1000); assert(con.consumableUsed);
for (let i = 0; i < 180; i++) con.tick(0, 0, 0, { pre: true });
assert.equal(con.consumableUntil, 60, 'countdown does not use duration');
for (let i = 0; i < 59; i++) con.tick(0, 0);
con.hp = 1120; con.tick(0, 0);
assert.equal(con.maxHp, 1000); assert.equal(con.hp, 1000); assert.equal(con.clipped, 120);
assert.equal(con.equip('nild', false), false, 'no consumable during combat');
assert.equal(con.useSlot('nild'), false);
assert.equal(consume().maxHp, 1150, 'restart reuses one dose without accumulation');
assert.equal(new FixtureGame(1, { ...options, consumableId: [fixture.id, fixture.id] }).maxHp, 1000, 'multiple selections are not accepted');

// The adapter with no selections preserves every gameplay field of the old engine.
const room = require('../web/training/room.json');
const { scenarios, snapshots } = require('./patience-scenarios');
for (const scenario of scenarios.filter(s => !s.gear)) {
  const Base = createEngine(room).Game;
  const Wrapped = combat.createGame(Base, catalog);
  const old = snapshots(Base, scenario), current = snapshots(Wrapped, scenario);
  const baseKeys = Object.keys(old[0]);
  for (let i = 0; i < old.length; i++) {
    const copy = Object.fromEntries(baseKeys.map(k => [k, current[i][k]]));
    copy.o = old[i].o; // additional validated identities do not change physics
    assert.deepEqual(copy, old[i], scenario.name + ': adapter without equipment/consumable');
  }
}
const storage = new Map();
const context = { document: { getElementById: () => ({ addEventListener() {} }) }, addEventListener() {}, localStorage: { getItem: key => storage.get(key) || null } };
vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'web/training/ui_game.js'), 'utf8'), context);
const oldOptions = { hp: 1245, def: 43, spd: 57, lvl: 5, mode: 'solo', chases: 3 };
const oldKey = 'rotmg:training:patience:best:v1:normal:solo:3:' + JSON.stringify([1245,43,57,5,undefined,0,1,0,{},{}]);
assert.equal(context.recKey(oldOptions), oldKey);
storage.set(oldKey, JSON.stringify({ frames: 10, win: false }));
assert.equal(context.loadBest(oldOptions).frames, 10);
const full = { ...oldOptions, classId: 'class:Paladin', equipment: { ability: seal.id }, rules: 'index-v2-postHit' };
for (const diff of [{ classId: 'class:Knight' }, { equipment: {} }, { consumableId: fixture.id }, { seedKey: '42' }, { dmgMult: 2 }, { catalogBuild: 'another-client' }]) assert.notEqual(context.recKey({ ...full, ...diff }), context.recKey(full));
assert.equal(context.recKey({ ...full, equipment: { ring: 'x', ability: 'y' } }), context.recKey({ ...full, equipment: { ability: 'y', ring: 'x' } }), 'selection order is canonical');
assert(storage.has(oldKey), 'new records do not overwrite legacy keys');
const oldSave = JSON.stringify({ hp: 987, def: 31, spd: 54, seed: '42', mode: 2, hard: true, layout: 'qwerty',
  armor: { id: 'matrix', mode: 'auto' }, nild: { id: 'blood' } });
const saves = new Map([['rotmg:training:patience:settings:v1', oldSave]]);
const settingsContext = { TRAINING_CATALOG: catalog, cv: { addEventListener() {} },
  document: { getElementById() { return {}; } },
  localStorage: { getItem: key => saves.get(key) || null, setItem: (key, value) => saves.set(key, value) } };
vm.createContext(settingsContext);
vm.runInContext(fs.readFileSync(path.join(root, 'web/training/ui_code.js'), 'utf8')
  + '\n' + fs.readFileSync(path.join(root, 'web/training/ui_gear.js'), 'utf8')
  + '\nclampSettings();save();globalThis.saved=SETTINGS;', settingsContext);
for (const key of ['hp', 'def', 'spd', 'seed', 'mode', 'hard', 'layout']) assert.equal(settingsContext.saved[key], JSON.parse(oldSave)[key]);
assert.equal(saves.get('rotmg:training:patience:settings:v1'), oldSave);
assert(saves.has('rotmg:training:patience:settings:v2'));
assert(!Object.hasOwn(settingsContext.saved, 'armor'), 'archive-only equipment is not silently remapped');
vm.runInContext("SETTINGS.classId='class:Paladin';SETTINGS.equipment={ability:'item:Seal of Blasphemous Prayer',armor:'item:Heavy Protective Matrix'};SETTINGS.classId='class:Wizard';globalThis.removed=validateSelections();", settingsContext);
assert.equal(settingsContext.removed.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(settingsContext.saved.equipment)), {});
console.log('Training Index: classes/slots, source filters, real timed protection, thresholds, MP, synthetic consumable lifecycle, unchanged physics and legacy records passed.');
