'use strict';

const assert = require('assert');
const { RC4, readCompressedInt, decodeServerStream, mergeTiles } = require('../tools/realm-codec.js');

const compressedIntCases = [
  [[0x00], 0, 1],
  [[0x3f], 63, 1],
  [[0x80, 0x01], 64, 2],
  [[0xff, 0x01], -127, 2],
  [[0xbf, 0xff, 0xff, 0xff, 0x0f], 0x7fffffff, 5],
  [[0xc0, 0x80, 0x80, 0x80, 0x10], -0x80000000, 5]
];
for (const [bytes, value, next] of compressedIntCases) {
  assert.deepEqual(readCompressedInt(Buffer.from(bytes), 0), { value, next });
}
assert.deepEqual(readCompressedInt(Buffer.from([0x00, 0xbf, 0x01]), 1), { value: 127, next: 3 });
assert.throws(() => readCompressedInt(Buffer.alloc(0), 0), /truncated/);
assert.throws(() => readCompressedInt(Buffer.from([0x80]), 0), /truncated/);
assert.throws(() => readCompressedInt(Buffer.from([0x80, 0x00]), 0), /overlong/);
assert.throws(() => readCompressedInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80]), 0), /oversized/);
assert.throws(() => readCompressedInt(Buffer.from([0xbf, 0xff, 0xff, 0xff, 0x10]), 0), /outside int32/);

const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const body = Buffer.alloc(9 + 1 + 3 * 6);
body.writeFloatBE(128.5, 0);
body.writeFloatBE(96.25, 4);
body[8] = 7;
body[9] = 3;
[[3, 4, 101], [-2, 9, 102], [3, 4, 103]].forEach(([x, y, type], index) => {
  const at = 10 + index * 6;
  body.writeInt16BE(x, at); body.writeInt16BE(y, at + 2); body.writeUInt16BE(type, at + 4);
});
const frame = Buffer.alloc(5 + body.length);
frame.writeUInt32BE(frame.length, 0);
frame[4] = 42;
body.copy(frame, 5);
new RC4(key).cipher(frame.subarray(5));

const result = decodeServerStream({ bytes: frame, filled: new Uint8Array(frame.length).fill(1) }, key, new Set([101, 102, 103]));
assert.equal(result.frames, 1);
assert.equal(result.updates.length, 1);
assert.equal(result.updates[0].origin.x, 128.5);
assert.deepEqual(result.updates[0].tiles, [{ x: 3, y: 4, type: 101 }, { x: -2, y: 9, type: 102 }, { x: 3, y: 4, type: 103 }]);
const merged = mergeTiles(result.updates);
assert.equal(merged.tiles.length, 2);
assert.equal(merged.tiles.find(tile => tile.x === 3 && tile.y === 4).type, 103);
console.log('realm codec: ok');
