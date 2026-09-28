'use strict';

const assert = require('assert/strict');

const {
  RealmBrushEngine,
  field,
  weighted
} = require('../tools/realm-brush-engine');

/* ------------------------------------------------------------------ *
 * Deterministic terrain brush                                         *
 * ------------------------------------------------------------------ */

const brushes = {
  A: {
    ground: [
      { type: 1, weight: 0.7 },
      { type: 2, weight: 0.3 }
    ],
    road: [
      { type: 3, weight: 1 }
    ]
  },
  B: {
    ground: [
      { type: 4, weight: 1 }
    ],
    road: []
  }
};

{
  assert.equal(
    weighted(
      [
        { type: 'a', weight: 0.7 },
        { type: 'b', weight: 0.3 }
      ],
      0
    ),
    'a',
    'TILE-010 weighted selection starts in the first bucket'
  );

  assert.equal(
    weighted(
      [
        { type: 'a', weight: 0.7 },
        { type: 'b', weight: 0.3 }
      ],
      0.7
    ),
    'b',
    'TILE-010 bucket boundary belongs to the following bucket'
  );

  assert.equal(
    weighted([], 0.5),
    null,
    'TILE-010 an empty weighted palette yields no invented tile'
  );
}

{
  const first = new RealmBrushEngine(brushes, 12345);
  const second = new RealmBrushEngine(brushes, 12345);

  for (let y = -32; y <= 32; y++) {
    for (let x = -32; x <= 32; x++) {
      assert.equal(
        first.paint({ biome: 'A', x, y }),
        second.paint({ biome: 'A', x, y }),
        `TILE-011 identical seed is deterministic at ${x},${y}`
      );
    }
  }
}

{
  const brush = new RealmBrushEngine(brushes, 12345);

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      assert.equal(
        brush.paint({ biome: 'A', x, y, road: true }),
        3,
        'TILE-012 a defined road palette overrides ground'
      );

      assert.equal(
        brush.paint({ biome: 'B', x, y, road: true }),
        4,
        'TILE-012 a biome with no road palette falls back to its ground'
      );
    }
  }
}

{
  for (let y = -64; y <= 64; y += 4) {
    for (let x = -64; x <= 64; x += 4) {
      const value = field(x, y, 987654321);

      assert(
        Number.isFinite(value) && value >= 0 && value < 1,
        `TILE-013 terrain field stays in [0,1) at ${x},${y}`
      );
    }
  }
}

{
  const brush = new RealmBrushEngine(brushes, 24680);
  let borrowed = 0;

  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const noBlend = brush.paint({
        biome: 'A',
        neighbour: 'B',
        boundary: 0,
        x,
        y
      });

      assert(
        noBlend === 1 || noBlend === 2,
        'TILE-014 boundary=0 must not borrow the neighbouring biome'
      );

      const blend = brush.paint({
        biome: 'A',
        neighbour: 'B',
        boundary: 0.1,
        x,
        y
      });

      assert(
        [1, 2, 4].includes(blend),
        'TILE-014 blended ground must come from one of the two declared palettes'
      );

      if (blend === 4) borrowed++;
    }
  }

  assert(
    borrowed > 0,
    'TILE-014 an active boundary band actually borrows neighbouring ground'
  );
}

console.log('realm / tile contract: ok');
