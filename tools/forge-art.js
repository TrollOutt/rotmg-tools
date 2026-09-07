/*
 * The picture on the Theory Crafting card, cut out of the installed client.
 *
 * The other card has a room: the enchanter's, a drawing lifted from the wiki.
 * This one has the forge - the smith, his anvil with the blue fire on it and
 * the two racks of weapons either side of him - which is a place in the game
 * rather than a drawing of one, so it is not fetched from anywhere. Every
 * piece of it is a sprite the client already holds, laid on the same stone
 * floor the game lays it on, and the whole thing is enlarged whole pixel by
 * whole pixel so it stays the pixel art it is.
 *
 *   node tools/forge-art.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const SHEETS = path.join(XML, 'textures');
const OUT = path.join(root, 'data', 'GUI Files', 'Page Art', 'Forge.png');

/* ---------------- just enough FlatBuffers ---------------- */
class Flat {
  constructor(b) { this.b = b; }
  u16(a) { return this.b.readUInt16LE(a); }
  i32(a) { return this.b.readInt32LE(a); }
  u32(a) { return this.b.readUInt32LE(a); }
  f32(a) { return this.b.readFloatLE(a); }
  root() { return this.u32(0); }
  fields(t) {
    const v = t - this.i32(t);
    const size = this.u16(v);
    const out = [];
    for (let slot = 0; slot * 2 + 4 < size; slot++) {
      const off = this.u16(v + 4 + slot * 2);
      out.push(off ? t + off : 0);
    }
    return out;
  }
  string(a) { const p = a + this.u32(a); const n = this.u32(p); return this.b.toString('utf8', p + 4, p + 4 + n); }
  vector(a) { const p = a + this.u32(a); return { at: p + 4, length: this.u32(p) }; }
  indirect(a) { return a + this.u32(a); }
}

/* ---------------- just enough PNG ---------------- */
function readPng(buffer) {
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  const parts = [];
  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    if (buffer.toString('latin1', at + 4, at + 8) === 'IDAT') {
      parts.push(buffer.subarray(at + 8, at + 8 + length));
    }
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
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
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
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- where every picture lives ---------------- */
const SHEET_OF = { 1: 'groundTiles', 2: 'characters', 4: 'mapObjects' };
const sheetName = field => SHEET_OF[field] || 'mapObjects';

const flat = new Flat(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const rootFields = flat.fields(flat.root());

const still = new Map();                     // atlas -> index -> rectangle
{
  const list = flat.vector(rootFields[0]);
  for (let i = 0; i < list.length; i++) {
    const atlas = flat.fields(flat.indirect(list.at + i * 4));
    const sprites = flat.vector(atlas[2]);
    const rects = new Map();
    for (let n = 0; n < sprites.length; n++) {
      const one = flat.fields(flat.indirect(sprites.at + n * 4));
      if (!one[0]) continue;
      const index = one[3] ? flat.i32(one[3]) : 0;
      if (rects.has(index)) continue;
      rects.set(index, {
        x: Math.round(flat.f32(one[0])), y: Math.round(flat.f32(one[0] + 4)),
        w: Math.round(flat.f32(one[0] + 8)), h: Math.round(flat.f32(one[0] + 12)),
        sheet: sheetName(one[7] ? flat.i32(one[7]) : 0)
      });
    }
    still.set(flat.string(atlas[0]), rects);
  }
}

const sheets = new Map();
const sheetFor = name => {
  if (sheets.has(name)) return sheets.get(name);
  const file = path.join(SHEETS, name + '.png');
  const got = fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null;
  sheets.set(name, got);
  return got;
};

/* What the client says a named thing is drawn from. */
function textureOf(files, id) {
  for (const name of files) {
    const raw = fs.readFileSync(path.join(XML, name), 'utf8');
    const shape = new RegExp('<(?:Object|Ground)\\s[^>]*id="' + id
      + '"[^>]*>([\\s\\S]*?)</(?:Object|Ground)>');
    const m = shape.exec(raw);
    if (!m) continue;
    const art = /<(?:Animated)?Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[1]);
    if (!art) continue;
    const index = art[2].trim();
    return {
      atlas: art[1].trim(),
      index: /^0x/i.test(index) ? Number.parseInt(index, 16) : Number(index)
    };
  }
  return null;
}

const objectFiles = fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n)).sort();
const groundFiles = fs.readdirSync(XML).filter(n => /^GroundTypes\.\d+\.xml$/.test(n)).sort();

function pieceOf(where, id) {
  const art = textureOf(where === 'ground' ? groundFiles : objectFiles, id);
  if (!art) throw new Error('no texture for ' + id);
  const bag = still.get(art.atlas);
  const rect = bag && bag.get(art.index);
  if (!rect) throw new Error('no rectangle for ' + id);
  const from = sheetFor(rect.sheet);
  if (!from) throw new Error('no sheet for ' + id);
  return { rect, from };
}

/* ---------------- the scene ---------------- */
/*
 * Six tiles by six, which is about the size of the forge itself. The floor is
 * the grey stone the game lays under it; the things standing on it stand
 * where they stand in the game - the smith with his hammer up, the anvil and
 * its blue fire in front of him, a rack of blades at each shoulder.
 */
const TILE = 8, WIDE = 6, TALL = 6, ZOOM = 9;
const FLOOR = 'Grey Squares';
const STANDING = [
  ['Blacksmith Rack 1', 0, 1],
  ['Blacksmith', 2, 0],
  ['Blacksmith Rack 2', 4, 1],
  ['Blacksmith Magic Anvil', 2, 2],
  ['Anvil', 1, 4],
  ['Blacksmith Hammer', 4, 4]
];

const small = Buffer.alloc(WIDE * TILE * TALL * TILE * 4);
const smallStride = WIDE * TILE * 4;

function blit(piece, atX, atY) {
  const { rect, from } = piece;
  for (let y = 0; y < rect.h; y++) {
    const row = atY + y;
    if (row < 0 || row >= TALL * TILE) continue;
    for (let x = 0; x < rect.w; x++) {
      const col = atX + x;
      if (col < 0 || col >= WIDE * TILE) continue;
      const at = ((rect.y + y) * from.width + rect.x + x) * 4;
      if (from.pixels[at + 3] < 8) continue;           // see the floor through it
      from.pixels.copy(small, row * smallStride + col * 4, at, at + 4);
    }
  }
}

const floor = pieceOf('ground', FLOOR);
for (let ty = 0; ty < TALL; ty++) {
  for (let tx = 0; tx < WIDE; tx++) blit(floor, tx * TILE, ty * TILE);
}
for (const [id, tx, ty] of STANDING) blit(pieceOf('object', id), tx * TILE, ty * TILE);

/* Whole pixels only: five of them for one of the client's. */
const wide = WIDE * TILE * ZOOM, tall = TALL * TILE * ZOOM;
const big = Buffer.alloc(wide * tall * 4);
for (let y = 0; y < tall; y++) {
  for (let x = 0; x < wide; x++) {
    const at = (Math.floor(y / ZOOM) * WIDE * TILE + Math.floor(x / ZOOM)) * 4;
    small.copy(big, (y * wide + x) * 4, at, at + 4);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, writePng(wide, tall, big));
console.log('\n  the forge, ' + wide + 'x' + tall
  + ' -> ' + path.relative(root, OUT)
  + '  (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)\n');
