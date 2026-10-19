'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const room = require('../web/training/room.json');
const { createEngine } = require('../web/training/engine');
const { scenarios, snapshots } = require('./patience-scenarios');
const baseline = require('./fixtures/patience-baseline.json');
for (const scenario of scenarios) {
  const run = () => snapshots(createEngine(room).Game, scenario);
  const one = run();
  assert.deepEqual(run(), one, `${scenario.name}: fixed seed and inputs repeat`);
  const hash = crypto.createHash('sha256').update(JSON.stringify(one)).digest('hex');
  assert.equal(hash, baseline.hashes[scenario.name], `${scenario.name}: exact standalone numerical states`);
}
const { Game, hitRect } = createEngine(room);
const make = () => new Game(42, { hp: 10000 });
assert.equal(hitRect(0, 0, [0, 0, 4, 4], [4, 0, 8, 4]), false, 'touching edges do not collide');
assert.equal(hitRect(0, 0, [0, 0, 4, 4], [3.99, 0, 8, 4]), true, 'overlapping masks collide');
for (const [kind, dmg, expected] of [['ab', 45, 45], ['ar', 20, 20], ['sb', 70, 71], ['sr', 100, 57]]) {
  const game = make();
  game.onHit({ kind, dmg, hit: false });
  assert.equal(game.hp, 10000 - expected, kind + ': supplied damage formula');
  assert.equal(game.hits, 1);
}
const game = make();
for (let i = 0; i < 60; i++) game.tick(0, 0);
assert.equal(game.current_shot, 0, 'ring begins after initial 60 ticks');
game.tick(0, 0);
assert.equal(game.projs.filter(p => p.kind === 'sb').length, 64, 'four rings of sixteen spikes');
for (let i = 61; i < 301; i++) game.tick(0, 0);
assert(game.shades.every(s => s.state === 'CHASE'), 'chase follows reset at tick 301');
const before = game.frames; game.tick(1, 0, 0, { pre: true });
assert.equal(game.frames, before, 'countdown does not advance combat time');

const storage = new Map();
const context = {
  document: { getElementById: () => ({ addEventListener() {} }) },
  addEventListener() {},
  localStorage: { getItem: key => storage.get(key) || null }
};
vm.createContext(context);
vm.runInContext(read('web/training/ui_game.js'), context);
const plain = { hp: 1245, def: 43, spd: 57, lvl: 5, mode: 'solo', hard: false, chases: 3 };
const key = context.recKey(plain);
assert.notEqual(context.recKey({ ...plain, dmgMult: 2 }), key, 'handicaps cannot share best results');
assert.notEqual(context.recKey({ ...plain, hp: 2000 }), key, 'different characters cannot share best results');
assert(context.better({ win: true, lost: 100 }, { win: false, frames: 9999 }));
assert(!context.better({ win: true, lost: 101 }, { win: true, lost: 100 }));
storage.set(key, 'broken JSON');
assert.equal(context.loadBest(plain), null, 'corrupt best result does not block launch');

// Build the independent page without docs/ or game-client dependencies.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotmg-training-test-'));
try {
  require('../tools/build-training').buildTraining(root, temp);
  const html = fs.readFileSync(path.join(temp, 'training/index.html'), 'utf8');
  assert(!html.includes('<!--TRAINING_UI-->'));
  assert(html.includes('href="../#home"') && html.includes('id="touchPad"'));
  const scripts = [...html.matchAll(/<script src="([^"?]+)\?v=[0-9a-f]{10}"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['data.js', 'engine.js', 'catalog.js', 'index-combat.js', 'renderer.js', 'ui_code.js', 'ui_game.js', 'ui_gear.js', 'ui_bg.js', 'loop.js']);
  const combined = scripts.map(file => fs.readFileSync(path.join(temp, 'training', file), 'utf8')).join('\n');
  new vm.Script(combined);
  for (const font of ['Inter-OFL.txt', 'PressStart2P-OFL.txt']) {
    assert(fs.readFileSync(path.join(temp, 'training/fonts', font), 'utf8').includes('SIL OPEN FONT LICENSE'));
  }
} finally {
  // mkdtemp returns the exact build-owned directory; never an archive or worktree.
  fs.rmSync(temp, { recursive: true, force: true });
}
const html = read('web/index.html');
assert(html.indexOf('<!--TRAINING_ENTRY-->') > html.indexOf('<section class="globe-stage">'), 'entry follows the planet');
assert(!/<script[^>]+training\//.test(html), 'home does not load the engine');
const build = read('tools/build-standalone.js');
assert(build.includes("\nrequire('./build-training').buildTraining(root, pagesDir);"), 'standard build always assembles training');
assert(!build.includes('trainingLocal') && !build.includes('--training-local'), 'no training opt-in flag');
assert(!Object.hasOwn(JSON.parse(read('package.json')).scripts, 'build:training'), 'one standard build command');
console.log(`Training Ground: ${scenarios.length} deterministic standalone comparisons, collision/damage/cycle and independent build checks passed.`);
