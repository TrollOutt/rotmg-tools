'use strict';
const assert = require('assert');
const { RealmBrushEngine } = require('../tools/realm-brush-engine.js');

const engine = new RealmBrushEngine({
  A: { ground: [{ type: 1, weight: .7 }, { type: 2, weight: .3 }], road: [{ type: 3, weight: 1 }] },
  B: { ground: [{ type: 4, weight: 1 }], road: [] }
});
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  assert.equal(engine.paint({ biome: 'A', x, y, road: true }), 3);
  assert.ok([1, 2].includes(engine.paint({ biome: 'A', x, y })));
}
assert.equal(engine.paint({ biome: 'A', neighbour: 'B', boundary: 0, x: 12, y: 7 }), engine.paint({ biome: 'A', neighbour: 'B', boundary: 0, x: 12, y: 7 }));
assert.throws(() => engine.paint({ biome: 'unknown', x: 0, y: 0 }), /No learned brush/);
console.log('realm brush engine: ok');
