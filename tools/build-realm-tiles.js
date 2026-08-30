'use strict';
/*
 * Give every biome a set of the game's own ground tiles.
 *
 *   node tools/extract-client-textures.js      (writes client-data/textures/)
 *   node tools/build-realm-tiles.js
 *
 * The client's groundTiles sheet holds every tile the realm's floor is made
 * of, but nothing here says which tile belongs to which biome: that mapping
 * lives in a FlatBuffers blob keyed by the game's own atlas names, and this
 * atlas has no need of it. What it needs is tiles that look like the biome
 * they are laid on, and colour answers that.
 *
 * So: find the tiles, average each one, and give every biome the ones nearest
 * its own colour. The art is the game's; the pairing is this tool's, which is
 * the same bargain the rest of the realm data strikes — see realm-biomes.txt.
 *
 * The tiles are found rather than cut on a grid. The sheet is packed, not
 * ruled: the gaps between tiles run 12, 13, 14 and 15 pixels apart, so a grid
 * would slice half of them in two. Connected runs of opaque pixels do not
 * care how the packer felt that day.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const SHEET = path.join(root, 'client-data', 'textures', 'groundTiles.png');
const BIOMES = path.join(root, 'data', 'Realm', 'realm-biomes.txt');
const OUT = path.join(root, 'web', 'assets', 'realm-tiles');
const INDEX = path.join(OUT, 'index.json');

// How many tiles a biome gets. Enough that a field of them does not repeat
// visibly, few enough that they still read as one biome.
const PER_BIOME = 6;
// A tile is a small square. Anything bigger is a wall or a set piece, and
// anything smaller is a speck of packing.
const MIN = 6;
const MAX = 18;

/* ---------------- PNG in and out ---------------- */
function readPng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colour = buffer[25];
  if (colour !== 6) throw new Error('expected RGBA, got colour type ' + colour);
  const parts = [];
  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    if (buffer.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(kind, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function writePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- find the tiles ---------------- */
if (!fs.existsSync(SHEET)) {
  console.error('\n  ' + path.relative(root, SHEET) + ' is missing. Run:'
    + '\n    node tools/extract-client-textures.js\n');
  process.exit(1);
}
const sheet = readPng(fs.readFileSync(SHEET));
const { width: W, height: H, pixels } = sheet;
const alpha = (x, y) => pixels[(y * W + x) * 4 + 3];

console.log('\n  ' + W + 'x' + H + ' sheet');
const seen = new Uint8Array(W * H);
const tiles = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (seen[y * W + x] || alpha(x, y) === 0) continue;
    const queue = [[x, y]];
    seen[y * W + x] = 1;
    let minX = x, maxX = x, minY = y, maxY = y, n = 0;
    while (queue.length) {
      const [cx, cy] = queue.pop();
      n++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (seen[ny * W + nx] || alpha(nx, ny) === 0) continue;
        seen[ny * W + nx] = 1;
        queue.push([nx, ny]);
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (w < MIN || h < MIN || w > MAX || h > MAX) continue;
    // A ground tile is solid. A blob with holes in it is a decoration that
    // happened to land in this sheet.
    if (n < w * h * 0.92) continue;
    let r = 0, g = 0, b = 0;
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const i = (ty * W + tx) * 4;
        r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2];
      }
    }
    const count = w * h;
    tiles.push({ x: minX, y: minY, w, h, mean: [r / count, g / count, b / count] });
  }
}
console.log('  ' + tiles.length + ' ground tiles found');

/* ---------------- pair them with the biomes ---------------- */
const biomes = new Map();
for (const raw of fs.readFileSync(BIOMES, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('##')) continue;
  const [hex, biome] = line.split('|');
  if (!hex || !biome) continue;
  if (!biomes.has(biome)) biomes.set(biome, []);
  biomes.get(biome).push([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
}

fs.mkdirSync(OUT, { recursive: true });
const index = {};
let written = 0;
for (const [biome, colours] of biomes) {
  // A biome painted in several tones is matched against their average: it is
  // one place, and its tiles should look like all of it.
  const target = [0, 1, 2].map(c => colours.reduce((sum, rgb) => sum + rgb[c], 0) / colours.length);
  const ranked = tiles
    .map(tile => ({
      tile,
      distance: (tile.mean[0] - target[0]) ** 2 + (tile.mean[1] - target[1]) ** 2 + (tile.mean[2] - target[2]) ** 2
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, PER_BIOME);

  // One strip per biome, tiles side by side, so the atlas fetches one file.
  const size = Math.max(...ranked.map(entry => Math.max(entry.tile.w, entry.tile.h)));
  const strip = Buffer.alloc(size * ranked.length * size * 4);
  const stripWidth = size * ranked.length;
  ranked.forEach((entry, slot) => {
    const { x, y, w, h } = entry.tile;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const from = ((y + ty) * W + x + tx) * 4;
        const to = (ty * stripWidth + slot * size + tx) * 4;
        pixels.copy(strip, to, from, from + 4);
      }
    }
  });
  const slug = biome.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  fs.writeFileSync(path.join(OUT, slug + '.png'), writePng(stripWidth, size, strip));
  index[biome] = { file: slug + '.png', tile: size, count: ranked.length };
  written++;
  const off = Math.round(Math.sqrt(ranked[0].distance));
  console.log('    ' + biome.padEnd(18) + ranked.length + ' tiles at ' + size + 'px'
    + '   nearest is ' + off + ' off');
}

fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
console.log('\n  ' + written + ' biomes -> ' + path.relative(root, OUT) + '\n');
