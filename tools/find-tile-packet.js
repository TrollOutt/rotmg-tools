'use strict';
/*
 * Which message carries the ground?
 *
 *   node tools/find-tile-packet.js [file.pcapng]
 *
 * The server tells the client what it can see as it walks, and somewhere in
 * that stream is the ground: a count, then a run of tiles, each a position and
 * a type. This finds it without being told, by testing every message id
 * against that shape and checking the answer against the client's own list of
 * ground types.
 *
 * That last check is what makes it an identification rather than a guess. A
 * run of random bytes read as (x, y, type) will produce types the client has
 * never heard of; the real thing produces types that are all in GroundTypes,
 * every time, for thousands of tiles.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CAPTURES = path.join(root, 'client-data', 'capture');
const PORT = 2050;

/* The reader's own machinery, shared rather than copied. */
const capture = require('./read-capture.js');

/* ---------------- what the client calls ground ---------------- */
const groundTypes = new Set();
for (const file of fs.readdirSync(path.join(root, 'client-data')).filter(n => /^GroundTypes\./.test(n))) {
  const text = fs.readFileSync(path.join(root, 'client-data', file), 'utf8');
  for (const m of text.matchAll(/<Ground\b[^>]*type="([^"]+)"/g)) {
    groundTypes.add(Number(m[1]) & 0xffff);
  }
}
console.log('\n  the client knows ' + groundTypes.size.toLocaleString('en-US') + ' ground types');

/* ---------------- try to read a body as tiles ---------------- */
/*
 * Shapes worth trying. The count is a short or an int, and a tile is a pair of
 * shorts and a type — signed where a position can be negative.
 */
const SHAPES = [
  { name: 'u16 count, i16 x, i16 y, u16 type', count: 2, stride: 6,
    read: (b, at) => ({ x: b.readInt16BE(at), y: b.readInt16BE(at + 2), type: b.readUInt16BE(at + 4) }) },
  { name: 'u16 count, u16 x, u16 y, u16 type', count: 2, stride: 6,
    read: (b, at) => ({ x: b.readUInt16BE(at), y: b.readUInt16BE(at + 2), type: b.readUInt16BE(at + 4) }) },
  { name: 'i32 count, i16 x, i16 y, u16 type', count: 4, stride: 6,
    read: (b, at) => ({ x: b.readInt16BE(at), y: b.readInt16BE(at + 2), type: b.readUInt16BE(at + 4) }) }
];

function tryTiles(body, shape) {
  if (body.length < shape.count + shape.stride) return null;
  const count = shape.count === 2 ? body.readUInt16BE(0) : body.readInt32BE(0);
  if (count < 4 || count > 20000) return null;
  const need = shape.count + count * shape.stride;
  if (need > body.length) return null;
  let known = 0;
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const tile = shape.read(body, shape.count + i * shape.stride);
    if (groundTypes.has(tile.type)) known++;
    tiles.push(tile);
  }
  return { count, known, share: known / count, tiles, trailing: body.length - need };
}

/* ---------------- go ---------------- */
const file = process.argv[2] || capture.newest(CAPTURES);
if (!file) {
  console.error('\n  Nothing captured yet.\n');
  process.exit(1);
}
console.log('  ' + path.relative(root, file));

const streams = capture.streamsOf(file, PORT);
const byId = new Map();
for (const stream of streams) {
  if (stream.fromPort !== PORT) continue;          // server to client only
  for (const frame of stream.frames) {
    const body = stream.bytes.subarray(frame.at + 5, frame.at + frame.length);
    if (!byId.has(frame.id)) byId.set(frame.id, []);
    byId.get(frame.id).push(body);
  }
}

console.log('  ' + byId.size + ' distinct ids from the server\n');

const results = [];
for (const [id, bodies] of byId) {
  for (const shape of SHAPES) {
    let hits = 0, tiles = 0, best = 0;
    for (const body of bodies) {
      const read = tryTiles(body, shape);
      if (!read || read.share < 0.9) continue;
      hits++; tiles += read.count;
      if (read.count > best) best = read.count;
    }
    // One message reading as tiles is chance. Half of them doing it, over
    // thousands of tiles the client all recognises, is the packet.
    if (hits >= 3 && hits / bodies.length > 0.25) {
      results.push({ id, shape: shape.name, hits, of: bodies.length, tiles, best });
    }
  }
}

if (!results.length) {
  console.log('  No message id reads as a run of known ground types.');
  console.log('  Either the ground travels in some other shape, or this capture');
  console.log('  never crossed new ground — walk somewhere unvisited and try again.\n');
  process.exit(0);
}

results.sort((a, b) => b.tiles - a.tiles);
for (const found of results) {
  console.log('  id ' + String(found.id).padStart(3) + '   ' + found.shape);
  console.log('        ' + found.hits + ' of ' + found.of + ' messages, '
    + found.tiles.toLocaleString('en-US') + ' tiles, biggest ' + found.best.toLocaleString('en-US'));
}

// The winner, in detail: where it was and what it laid down.
const winner = results[0];
const shape = SHAPES.find(s => s.name === winner.shape);
let sample = null;
for (const body of byId.get(winner.id)) {
  const read = tryTiles(body, shape);
  if (read && read.share > 0.95 && read.count > (sample ? sample.count : 0)) sample = read;
}
if (sample) {
  const xs = sample.tiles.map(t => t.x), ys = sample.tiles.map(t => t.y);
  console.log('\n  biggest run: ' + sample.count.toLocaleString('en-US') + ' tiles, '
    + (100 * sample.share).toFixed(1) + '% of them types the client knows');
  console.log('    x ' + Math.min(...xs) + ' to ' + Math.max(...xs)
    + ',  y ' + Math.min(...ys) + ' to ' + Math.max(...ys)
    + ',  ' + sample.trailing + ' bytes after the run');
  console.log('    first few: ' + sample.tiles.slice(0, 6)
    .map(t => '(' + t.x + ',' + t.y + ')=' + t.type).join('  '));
}
console.log('');
