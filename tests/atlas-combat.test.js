'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const atlas = require(path.join(root, 'web', 'assets', 'atlas', 'atlas.json'));
const combat = require(path.join(root, 'web', 'assets', 'atlas', 'combat.json'));
const summary = require(path.join(root, 'web', 'assets', 'atlas', 'combat-summary.json'));
const viewer = fs.readFileSync(path.join(root, 'tools', 'atlas-viewer.html'), 'utf8');
const published = fs.readFileSync(path.join(root, 'web', 'assets', 'atlas', 'index.html'), 'utf8');

const types = new Set(atlas.zones.flatMap(zone => (zone.lives || []).map(one => String(one.type))));
assert(Object.keys(combat.enemies).length >= types.size,
  'the combat corpus must include wildlife plus bound encounters and heroes');
for (const type of types) {
  assert(combat.enemies[type], `missing combat definition for creature ${type}`);
  for (const shot of combat.enemies[type].attacks) {
    assert(Number.isFinite(shot.fast) && shot.fast >= 0, `${type}/${shot.id} has no speed`);
    assert(Number.isFinite(shot.life) && shot.life > 0, `${type}/${shot.id} has no lifetime`);
    if (shot.visual) {
      assert(fs.existsSync(path.join(root, 'web', 'assets', 'atlas', 'combat', shot.visual.file)),
        `${type}/${shot.id} is missing projectile art`);
    }
  }
}
const allowedTypes = new Set([...types, ...Object.values(combat.landmarkBindings || {}).map(String)]);
assert(Object.keys(combat.landmarkBindings || {}).length >= 70,
  'the laboratory encounter/Hero bindings must be imported');
for (const [name, type] of Object.entries(combat.landmarkBindings || {})) {
  const enemy = combat.enemies[type];
  assert(enemy, `${name} must have a live combat definition`);
  // A handful such as Sea Dragon already use the Atlas wildlife sheet.
  if (!types.has(String(type))) {
    assert(enemy.sprite, `${name} must have a live client body`);
    assert(fs.existsSync(path.join(root, 'web', 'assets', 'atlas', 'combat', enemy.sprite.file)),
      `${name} is missing its live body art`);
  }
}

assert.strictEqual(Object.keys(combat.folk).length, atlas.folk.length,
  'every playable class must receive the local weapon and ability definitions');
assert.deepStrictEqual([combat.reactors.adept.type, combat.reactors.veteran.type], [56341, 56342],
  'alien camps must use the two real client reactor types');
for (const reactor of Object.values(combat.reactors)) {
  assert(reactor.hp > 0 && reactor.attacks.length, `${reactor.type} has no combat definition`);
  assert(fs.existsSync(path.join(root, 'web', 'assets', 'atlas', 'combat', reactor.sprite.file)),
    `${reactor.type} is missing its client sprite`);
}
let clipCount = 0;
for (const [type, clips] of Object.entries(combat.observed)) {
  const definitions = combat.enemies[type].attacks;
  assert(clips.length, `${type} has an empty observed entry`);
  for (const clip of clips) {
    clipCount++;
    assert(clip.duration > 0 && clip.points.length, `${type}/${clip.id} is empty`);
    for (let i = 1; i < clip.points.length; i++) {
      assert(clip.points[i][0] >= clip.points[i - 1][0], `${type}/${clip.id} goes backward in time`);
    }
    for (const salvo of clip.attacks) {
      assert(salvo[0] >= 0 && salvo[0] <= clip.duration + 0.001,
        `${type}/${clip.id} has a salvo outside the clip`);
      assert(definitions.some(shot => Number(shot.slot) === salvo[1] && shot.id === salvo[8]),
        `${type}/${clip.id} refers to an unrelated projectile`);
    }
  }
}
assert.strictEqual(clipCount, summary.clips, 'summary clip count must describe the payload');

assert.strictEqual(combat.schema, 2, 'combat payload must include the loot/death integration');
assert.strictEqual(summary.schema, 2, 'combat summary must describe the same payload schema');
assert(Object.keys(combat.items).length > 0, 'known equipment drops must be imported');
assert(Object.keys(combat.loot).length > 0, 'monster loot tables must be imported');
for (const [type, names] of Object.entries(combat.loot)) {
  assert(allowedTypes.has(type), `loot table ${type} does not belong to an Atlas creature`);
  for (const name of names) {
    const item = combat.items[name];
    assert(item, `${type} refers to missing item ${name}`);
    if (item.visual) assert(fs.existsSync(path.join(root, 'web', 'assets', 'atlas', 'combat', item.visual.file)),
      `${type}/${name} is missing item art`);
  }
}
for (const [type, portals] of Object.entries(combat.portals)) {
  assert(allowedTypes.has(type), `portal table ${type} does not belong to an Atlas creature`);
  for (const portal of portals) {
    assert(portal.name && portal.sprite, `${type} has an incomplete portal drop`);
    assert(fs.existsSync(path.join(root, 'web', 'assets', 'atlas', 'combat', portal.sprite.file)),
      `${type}/${portal.name} is missing portal art`);
  }
}
assert.strictEqual(summary.items, Object.keys(combat.items).length);
assert.strictEqual(summary.lootTables, Object.keys(combat.loot).length);
assert.strictEqual(summary.portalTables, Object.keys(combat.portals).length);

// Guard the Git Atlas performance work that this merge is required to retain.
for (const phrase of ['const GRID = 32', 'function nearTo(', 'const SIM_STEP = 1 / 30',
  'const SIM_IDLE = 0.5', 'if (watched()) ensureCombat()', 'function installAlienReactors()',
  'reactor, leash: 15']) {
  assert(viewer.includes(phrase), `Atlas optimization missing: ${phrase}`);
}
assert(viewer.includes("fetch(asset('combat.json'))"), 'combat corpus must remain lazy-loaded');
for (const phrase of ['function equipLoot(', 'one.lootGoal = usefulLootFor(one)',
  'beast.down = beast.kind.role === \'hero\'', 'combatData.portals',
  'formerOwnerLeft: 12', 'Every death with a resolved equipment table leaves one item',
  'const next = zone && pointBy(zone, null, 0, Infinity)', 'outlined: true',
  'if (one.down > 0 || one.dying > 0 || one.hp <= 0) continue;',
  'function installLiveLandmarks()', 'landmarkAnchor: { x: mark.x, y: mark.y }',
  'function distributedRoam(', 'clearOfFolk(x, y, 7)',
  'const pull = worth / (crowd * (4 + far))',
  'if ((beast.onIt || 0) >= capacity) continue;',
  'if (one.lootGoal) one.lootGoal.claimedBy = one;',
  'apart < 3.5', 'const MONSTERS_PER_FOLK = 6;',
  'function balancePopulation(delta)', 'spawnWanderer(zone, anchor, true)',
  'function sparePreyNear(one, skip)', 'function reinforcementFor(one, forecast)',
  'one.target.hp <= one.target.full * 0.22',
  'if (!one.target) one.target = reinforcementFor(one, false)',
  'const STARTING_SHARE = { Rookie: 0.20, Adept: 0.50, Veteran: 0.30 };',
  'const MAX_FOLK = 120;', 'const MAX_LOOT_BAGS = 100;', 'function leaveBag(bit)',
  'function usefulLootFor(one)', 'const populations = new Map();',
  'const TYPE_CHARS_PER_SECOND = 14;', 'function beginSpeech(who, filled)',
  'function finishSpeech(who)', 'who.speechQueue.push(filled)',
  'if (one.chatPause > 0)', 'if (one.chatPause <= 0) finishSpeech(one)']) {
  assert(viewer.includes(phrase), `Atlas death/loot behavior missing: ${phrase}`);
}
assert(!published.includes('local live captures plus client projectile declarations'),
  'the combat payload must not be inlined into the initial Atlas page');

console.log(`atlas combat: ${types.size} creatures, ${Object.keys(combat.observed).length} observed types, ${clipCount} clips`);
