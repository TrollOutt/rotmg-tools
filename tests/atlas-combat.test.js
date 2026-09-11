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
assert.strictEqual(Object.keys(combat.enemies).length, types.size,
  'every creature placed by the Atlas must receive its complete attack catalogue');
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

// Guard the Git Atlas performance work that this merge is required to retain.
for (const phrase of ['const GRID = 32', 'function nearTo(', 'const SIM_STEP = 1 / 30',
  'const SIM_IDLE = 0.5', 'if (watched()) ensureCombat()', 'function installAlienReactors()',
  'reactor, leash: 15']) {
  assert(viewer.includes(phrase), `Atlas optimization missing: ${phrase}`);
}
assert(viewer.includes("fetch(asset('combat.json'))"), 'combat corpus must remain lazy-loaded');
assert(!published.includes('local live captures plus client projectile declarations'),
  'the combat payload must not be inlined into the initial Atlas page');

console.log(`atlas combat: ${types.size} creatures, ${Object.keys(combat.observed).length} observed types, ${clipCount} clips`);
