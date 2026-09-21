'use strict';
/*
 * Paint the traced Realm topology with the extracted client tile palettes.
 *
 *   node tools/render-procedural-realm.js
 *
 * This is deliberately a visual generator, not a claim that every tile was
 * observed. Its companion report marks the biomes with measured packet
 * brushes and those currently using the installed-client palette only.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { field } = require('./realm-brush-engine.js');

const root = path.join(__dirname, '..');
const terrainFile = path.join(root, 'data', 'Realm', 'realm-terrain.txt');
const tileDir = path.join(root, 'web', 'assets', 'realm-tiles');
const tileIndex = JSON.parse(fs.readFileSync(path.join(tileDir, 'index.json'), 'utf8'));
const learned = JSON.parse(fs.readFileSync(path.join(root, 'data', 'Realm', 'realm-brushes.json'), 'utf8')).brushes;
const output = path.join(root, 'client-data', 'capture', 'procedural-realm.png');
const reportFile = path.join(root, 'client-data', 'capture', 'procedural-realm-report.json');
const CELL = 8;

function readPng(buffer) {
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  const parts = []; let at = 8;
  while (at < buffer.length) { const size = buffer.readUInt32BE(at); if (buffer.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(buffer.subarray(at + 8, at + 8 + size)); at += size + 12; }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * 4, pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0, up = y ? pixels[(y - 1) * stride + x] : 0, corner = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) { const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner); value += a <= b && a <= c ? left : b <= c ? up : corner; }
      pixels[y * stride + x] = value & 255;
    }
  }
  return { width, height, pixels };
}
const crcTable = (() => { const table = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; } return table; })();
const crc32 = buffer => { let c = -1; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (kind, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length); head.write(kind, 4, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body]))); return Buffer.concat([head, body, crc]); };
function png(width, height, pixels) { const raw = Buffer.alloc(height * (width * 4 + 1)); for (let y = 0; y < height; y++) { pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]); }

const legend = new Map(), grid = [];
for (const line of fs.readFileSync(terrainFile, 'utf8').replace(/\r/g, '').split('\n')) {
  if (!line || line.startsWith('##')) continue;
  if (line.startsWith('legend|')) { const [, key, hex, biome] = line.split('|'); legend.set(key, { hex, biome }); }
  else grid.push(line);
}
const width = Math.max(...grid.map(line => line.length)), height = grid.length;
const palettes = new Map();
for (const [biome, entry] of Object.entries(tileIndex)) {
  const ground = entry.ground;
  if (!ground) continue;
  palettes.set(biome, { ...ground, image: readPng(fs.readFileSync(path.join(tileDir, ground.file))) });
}
const canvas = Buffer.alloc(width * CELL * height * CELL * 4);
const copy = (source, sx, sy, sw, sh, dx, dy) => {
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const fromX = sx + Math.min(sw - 1, Math.floor(x * sw / CELL)), fromY = sy + Math.min(sh - 1, Math.floor(y * sh / CELL));
    const from = (fromY * source.width + fromX) * 4, to = ((dy + y) * width * CELL + dx + x) * 4;
    source.pixels.copy(canvas, to, from, from + 4);
  }
};
function fillCell(col, row, rgba) { for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const at = ((row * CELL + y) * width * CELL + col * CELL + x) * 4; canvas[at] = rgba[0]; canvas[at + 1] = rgba[1]; canvas[at + 2] = rgba[2]; canvas[at + 3] = 255; } }
function sea(col, row) { for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const at = ((row * CELL + y) * width * CELL + col * CELL + x) * 4, wave = (x + y * 3 + col * 5 + row * 7) % 11 === 0; canvas[at] = wave ? 69 : 41; canvas[at + 1] = wave ? 113 : 82; canvas[at + 2] = wave ? 151 : 130; canvas[at + 3] = 255; } }
function road(col, row) { for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const at = ((row * CELL + y) * width * CELL + col * CELL + x) * 4, light = (x * 3 + y * 5 + col + row) % 13 < 3; canvas[at] = light ? 138 : 101; canvas[at + 1] = light ? 140 : 105; canvas[at + 2] = light ? 126 : 100; canvas[at + 3] = 255; } }

for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
  const key = grid[row][col] || '.', entry = legend.get(key);
  if (key === '.' || key === '~') { sea(col, row); continue; }
  if (key === '=') { road(col, row); continue; }
  const palette = palettes.get(entry?.biome);
  if (!palette) { fillCell(col, row, [54, 58, 67, 255]); continue; }
  const slot = Math.min(palette.count - 1, Math.floor(field(col, row, 0x524f544d) * palette.count));
  copy(palette.image, slot * palette.tile, 0, palette.tile, palette.tile, col * CELL, row * CELL);
}

const aliases = { Beach: 'Shore', 'Mid Forest': 'Nature Ruins' };
const biomes = [...new Set([...legend.values()].map(value => value.biome).filter(Boolean))].sort();
const report = {
  schema: 1, image: path.basename(output), dimensions: { width: width * CELL, height: height * CELL, cells: { width, height } },
  learnedBrushes: Object.keys(learned).sort(),
  biomes: biomes.map(biome => ({ biome, learnedBrush: aliases[biome] || biome, observed: Boolean(learned[aliases[biome] || biome]), palette: Boolean(palettes.get(biome)) }))
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, png(width * CELL, height * CELL, canvas));
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(path.relative(root, output) + '  (' + (width * CELL) + '×' + (height * CELL) + ')');
console.log(path.relative(root, reportFile));
