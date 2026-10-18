'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const vm = require('vm'), zlib = require('zlib'), crypto = require('crypto');
const { createGrid } = require('../web/atlas-spatial');
const { simulation } = require('./atlas-spatial-harness');
const { graph } = require('./atlas-data-harness');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('tools/atlas-viewer.html'), moduleSource = read('web/atlas-spatial.js');
const frozen = require('./atlas-spatial-corpus.json');
const reference = zlib.gunzipSync(Buffer.from(frozen.source, 'base64')).toString();
assert.equal(crypto.createHash('sha256').update(reference).digest('hex'), frozen.sha256);
assert.equal(frozen.base, '8f9c2cb17563cb0ad2daaf8ca104b58d6d837e5b');

let seed = 4402;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const entities = Array.from({ length: 500 }, (_, id) => ({ id,
  x: (random() - 0.5) * 800, y: (random() - 0.5) * 800, mine: id % 3 === 0 }));
entities.push({ id: 500, x: 16, y: -16 }, { id: 501, x: 0, y: 0 },
  { id: 502, x: -16, y: 16 });
const before = graph(entities);
let queries = 0;
for (const hostile of [false, true]) {
  const grid = createGrid(16), filter = e => !hostile || !e.mine;
  grid.rebuild(entities, filter);
  for (let i = 0; i < 300; i++) {
    const x = i < 3 ? [0, 16, -16][i] : (random() - 0.5) * 1000;
    const y = (random() - 0.5) * 1000, radius = [0, 0.7, 3.2, 3.5, 18, 26, 1e8][i % 7];
    const exact = e => Math.abs(e.x - x) <= radius && Math.abs(e.y - y) <= radius;
    assert.deepEqual(grid.query(x, y, radius).filter(exact), entities.filter(e => filter(e) && exact(e)));
    queries++;
  }
}
assert.deepEqual(graph(entities), before, 'Queries and rebuild do not mutate supplied entities');
const grid = createGrid();
const left = { id: 1, x: -1, y: 0 }, right = { id: 2, x: 1, y: 0 };
grid.rebuild([right, left]);
assert.deepEqual(grid.query(0, 0, 2), [right, left], 'Equal distances keep original source order');
const held = grid.query(0, 0, 2);
right.x = 4096; right.y = -4096; grid.update(right);
assert(grid.query(4096, -4096, 0).includes(right));
assert(!grid.query(0, 0, 2).includes(right));
assert.deepEqual(held, [right, left], 'Queries are independent snapshots during later mutations');
grid.remove(left);
const joined = { id: 3, x: 4096, y: -4096 };
grid.update(joined);
assert.deepEqual(grid.queryBox(4096, -4096, 4096, -4096), [right, joined]);
grid.rebuild([joined, right]);
assert.deepEqual(grid.query(4096, -4096, Infinity), [joined, right]);
assert.deepEqual(grid.queryBox(1, 1, -1, -1), []);
joined.mine = true;
grid.rebuild([joined, right], e => !e.mine);
assert.deepEqual(grid.query(4096, -4096, 0), [right]);
joined.mine = false; grid.update(joined);
assert.deepEqual(grid.query(4096, -4096, 0), [joined, right], 'Filter updates retain the source rank');
const invalid = { x: NaN, y: Infinity };
grid.update(invalid);
assert(grid.query(0, 0, 0).includes(invalid), 'Non-finite candidates still reach the original exact filter');
assert.deepEqual(grid.query(1e30, -1e30, 0), [joined, right, invalid], 'Unsafe cell iterators fall back safely');
assert.throws(() => createGrid(0), RangeError);

const classic = { Math: Object.assign(Object.create(Math), { random() { throw Error('Grid must not draw randomness'); } }) };
vm.runInNewContext(moduleSource, classic);
assert.equal(typeof classic.AtlasSpatial.createGrid, 'function', 'Classic module loads without DOM or clock');
classic.AtlasSpatial.createGrid().rebuild([]);

let profiles = 0;
const hashes = [];
for (const multiplier of [1, 2, 4]) for (const seed of [1, 0x2c2026, 0x44c2026]) {
  for (const edge of [false, true]) {
    const expected = simulation(reference, '', frozen.markers, multiplier, seed, edge);
    if (edge) {
      const tie = expected.sample.find(e => e[0] === 'tie');
      assert.equal(tie[1], tie[2], 'Frozen reference selects the first equidistant player');
      const impact = expected.sample.find(e => e[0] === 'teleport-impact');
      assert.equal(impact[1], 48);
      assert(impact[2] < 100, 'Hostile projectile hits the teleported owner in the same shot iteration');
      assert(expected.sample.some(e => e[0] === 'respawn'));
    }
    assert(expected.sample.some(e => e[0] === 'spawn'));
    assert(expected.sample.some(e => e[0] === 'remove'));
    assert(expected.randomCount > 100);
    for (const newline of ['\n', '\r\n']) {
      const text = source.replace(/\r\n/g, '\n').replace(/\n/g, newline);
      const mod = moduleSource.replace(/\r\n/g, '\n').replace(/\n/g, newline);
      const actual = simulation(text, mod, frozen.markers, multiplier, seed, edge);
      assert.deepEqual(actual, expected,
        `Exact per-step states, event order and every RNG draw: ×${multiplier}/${seed}/edge=${edge}/${JSON.stringify(newline)}`);
      profiles++;
    }
    hashes.push([multiplier, seed, edge, expected.state, expected.events, expected.random]);
  }
}
assert.equal((source.match(/AtlasSpatial\.createGrid\(/g) || []).length, 2);
assert(source.indexOf('/*ATLAS_SPATIAL*/') < source.indexOf('AtlasSpatial.createGrid('));
const proof = crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
assert.equal(proof, frozen.proof, 'Frozen states/events/RNG also pin the deterministic environment inputs');
console.log(`Atlas spatial: ${queries} oracle queries; ${profiles} LF/CRLF simulation replays, ×1/×2/×4, 3 seeds, 120 steps, exact events/RNG; proof ${proof}.`);
