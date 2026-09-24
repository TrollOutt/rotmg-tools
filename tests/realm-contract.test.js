'use strict';

const assert = require('assert/strict');

const {
  RC4,
  parseUpdateGround,
  decodeServerStream,
  mergeTiles,
  mergeObjects
} = require('../tools/realm-codec');

const {
  RealmBrushEngine,
  field,
  weighted
} = require('../tools/realm-brush-engine');

/* ------------------------------------------------------------------ *
 * RC4 stream contract                                                 *
 * ------------------------------------------------------------------ */

{
  const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const plain = Buffer.from('Realm stream contract');

  const encrypted = Buffer.from(plain);
  new RC4(key).cipher(encrypted);

  const decrypted = Buffer.from(encrypted);
  new RC4(key).cipher(decrypted);

  assert.deepEqual(
    decrypted,
    plain,
    'CODEC-001 fresh RC4 streams decrypt what they encrypt'
  );
}

{
  const key = Buffer.from('1234567890abcdef', 'hex');
  const stream = new RC4(key);

  stream.cipher(Buffer.alloc(17));

  const clone = stream.clone();
  const left = Buffer.from('same continuation');
  const right = Buffer.from(left);

  stream.cipher(left);
  clone.cipher(right);

  assert.deepEqual(
    left,
    right,
    'CODEC-002 cloning preserves the exact stream position'
  );

  stream.reset();

  const reset = Buffer.from('prefix');
  const fresh = Buffer.from(reset);

  stream.cipher(reset);
  new RC4(key).cipher(fresh);

  assert.deepEqual(
    reset,
    fresh,
    'CODEC-003 reset returns RC4 to its initial state'
  );
}

/* ------------------------------------------------------------------ *
 * UPDATE ground parsing                                               *
 * ------------------------------------------------------------------ */

function groundBody(tiles) {
  /*
   * WorldPos(8), level(1), tile count(1 for these fixtures),
   * tiles, object count=0, drop count=0.
   */
  const body = Buffer.alloc(9 + 1 + tiles.length * 6 + 2);

  body.writeFloatBE(128.5, 0);
  body.writeFloatBE(96.25, 4);
  body[8] = 7;
  body[9] = tiles.length;

  tiles.forEach((tile, index) => {
    const at = 10 + index * 6;
    body.writeInt16BE(tile.x, at);
    body.writeInt16BE(tile.y, at + 2);
    body.writeUInt16BE(tile.type, at + 4);
  });

  const tail = 10 + tiles.length * 6;
  body[tail] = 0;       // object count
  body[tail + 1] = 0;   // drop count

  return body;
}

{
  const tiles = [
    { x: -4, y: 9, type: 101 },
    { x: 12, y: -7, type: 102 },
    { x: 0, y: 0, type: 103 }
  ];

  const parsed = parseUpdateGround(
    groundBody(tiles),
    new Set([101, 102, 103])
  );

  assert.deepEqual(
    parsed.origin,
    { x: 128.5, y: 96.25 },
    'CODEC-010 UPDATE keeps its world origin'
  );

  assert.equal(
    parsed.levelType,
    7,
    'CODEC-010 UPDATE keeps its level type'
  );

  assert.deepEqual(
    parsed.tiles,
    tiles,
    'CODEC-010 signed coordinates and ground types survive parsing'
  );

  assert.equal(
    parsed.knownShare,
    1,
    'CODEC-011 fully recognised ground has knownShare 1'
  );

  assert.equal(
    parsed.objectError,
    undefined,
    'CODEC-012 valid empty object/drop sections parse cleanly'
  );
}

{
  const parsed = parseUpdateGround(
    groundBody([
      { x: 0, y: 0, type: 101 },
      { x: 1, y: 0, type: 999 }
    ]),
    new Set([101])
  );

  assert.equal(
    parsed.knownShare,
    0.5,
    'CODEC-011 knownShare measures recognised ground exactly'
  );
}

{
  const parsed = parseUpdateGround(
    groundBody([]),
    new Set([101])
  );

  assert.equal(
    parsed.knownShare,
    1,
    'CODEC-011 an empty ground update is not treated as unknown ground'
  );
}

/* ------------------------------------------------------------------ *
 * Stream validation                                                   *
 * ------------------------------------------------------------------ */

function encryptedUpdateFrame(key, tiles) {
  const body = groundBody(tiles);
  const frame = Buffer.alloc(5 + body.length);

  frame.writeUInt32BE(frame.length, 0);
  frame[4] = 42;
  body.copy(frame, 5);

  new RC4(key).cipher(frame.subarray(5));
  return frame;
}

{
  const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

  const frame = encryptedUpdateFrame(key, [
    { x: 1, y: 1, type: 999 },
    { x: 2, y: 1, type: 998 },
    { x: 3, y: 1, type: 997 },
    { x: 4, y: 1, type: 996 }
  ]);

  const result = decodeServerStream(
    {
      bytes: frame,
      filled: new Uint8Array(frame.length).fill(1)
    },
    key,
    new Set([101, 102, 103])
  );

  assert.equal(
    result.updates.length,
    0,
    'CODEC-020 an UPDATE from the wrong ground universe is rejected'
  );

  assert.match(
    result.reason,
    /ground types do not match/,
    'CODEC-020 rejection explains the ground mismatch'
  );
}

/* ------------------------------------------------------------------ *
 * Tile/object merge semantics                                         *
 * ------------------------------------------------------------------ */

{
  const merged = mergeTiles([
    {
      tiles: [
        { x: 4, y: 2, type: 10 },
        { x: -1, y: 8, type: 20 }
      ]
    },
    {
      tiles: [
        { x: 4, y: 2, type: 30 },
        { x: 0, y: -3, type: 40 }
      ]
    }
  ]);

  assert.deepEqual(
    merged.bounds,
    { minX: -1, maxX: 4, minY: -3, maxY: 8 },
    'TILE-001 merged bounds cover every surviving coordinate'
  );

  assert.equal(
    merged.tiles.find(one => one.x === 4 && one.y === 2).type,
    30,
    'TILE-002 later UPDATE wins when the same tile is observed again'
  );

  assert.deepEqual(
    merged.tiles.map(one => [one.x, one.y]),
    [
      [0, -3],
      [4, 2],
      [-1, 8]
    ],
    'TILE-003 merged tiles have deterministic row-major ordering'
  );

  assert.deepEqual(
    mergeTiles([]),
    { tiles: [], bounds: null },
    'TILE-004 empty input has no invented bounds'
  );
}

{
  const merged = mergeObjects([
    {
      objects: [
        { id: 1, type: 10, x: 5, y: 5 },
        { id: 2, type: 20, x: 9, y: 9 }
      ],
      dropIds: []
    },
    {
      objects: [
        { id: 2, type: 21, x: 3, y: 4 },
        { id: 3, type: 30, x: 1, y: 8 }
      ],
      dropIds: [1]
    }
  ]);

  assert.deepEqual(
    merged,
    [
      { id: 2, type: 21, x: 3, y: 4 },
      { id: 3, type: 30, x: 1, y: 8 }
    ],
    'TILE-005 object additions replace old state and drops remove objects'
  );
}

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
