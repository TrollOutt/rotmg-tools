'use strict';
/*
 * Give every biome the tiles the game actually floors it with.
 *
 *   node tools/extract-client-textures.js     (sheets + the sprite registry)
 *   node tools/build-realm-tiles.js
 *
 * Three things have to meet for this to work, and all three are the client's:
 *
 *   GroundTypes    10,400 ground types, each naming an atlas and an index —
 *                  and, it turns out, naming its biome: "Risen Hell Lava",
 *                  "Runic Tundra Light Ice", "Sprite Forest Grass".
 *   spritesheet    a FlatBuffers registry: for each atlas, the rectangle every
 *                  one of its sprites occupies in the packed sheets.
 *   the sheets     groundTiles and mapObjects, the pixels themselves.
 *
 * So a ground type resolves to a rectangle resolves to a tile, and its own
 * name says which biome it belongs to. Nothing is guessed at — which matters,
 * because a biome's floor is not one tile repeated: it is dirt and grass and
 * the worn patches between them, and around an encounter it is arranged.
 *
 * Where a biome's name matches no ground type the old bargain still applies:
 * the tiles nearest its colour, and the report says which biomes fell back.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const SHEETS = path.join(root, 'client-data', 'textures');
const REGISTRY = path.join(root, 'client-data', 'spritesheet.bin');
const GROUND = path.join(root, 'client-data');
const BIOMES = path.join(root, 'data', 'Realm', 'realm-biomes.txt');
const OUT = path.join(root, 'web', 'assets', 'realm-tiles');

// How many tiles a biome gets. Enough that a field of them does not repeat
// visibly, few enough that the strip stays small.
const PER_BIOME = 10;

/*
 * The atlas the client calls a ground type's home is one of two packed
 * sheets, and the registry says which by a small number.
 */
const SHEET_OF = { 1: 'groundTiles', 4: 'mapObjects' };

/* ---------------- FlatBuffers, only as far as needed ---------------- */
class Flat {
  constructor(buffer) { this.b = buffer; }
  u16(at) { return this.b.readUInt16LE(at); }
  i32(at) { return this.b.readInt32LE(at); }
  u32(at) { return this.b.readUInt32LE(at); }
  f32(at) { return this.b.readFloatLE(at); }
  root() { return this.u32(0); }
  fields(table) {
    const v = table - this.i32(table);
    const size = this.u16(v);
    const out = [];
    for (let slot = 0; slot * 2 + 4 < size; slot++) {
      const offset = this.u16(v + 4 + slot * 2);
      out.push(offset ? table + offset : 0);
    }
    return out;
  }
  string(at) { const p = at + this.u32(at); const n = this.u32(p); return this.b.toString('utf8', p + 4, p + 4 + n); }
  vector(at) { const p = at + this.u32(at); return { at: p + 4, length: this.u32(p) }; }
  indirect(at) { return at + this.u32(at); }
}

/* ---------------- PNG ---------------- */
function readPng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
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
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  return table;
})();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(kind, body) {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function writePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- read it all in ---------------- */
for (const needed of [REGISTRY, path.join(SHEETS, 'groundTiles.png')]) {
  if (fs.existsSync(needed)) continue;
  console.error('\n  ' + path.relative(root, needed) + ' is missing. Run:'
    + '\n    node tools/extract-client-textures.js\n');
  process.exit(1);
}

const flat = new Flat(fs.readFileSync(REGISTRY));
const atlases = new Map();
{
  const list = flat.vector(flat.fields(flat.root())[0]);
  for (let i = 0; i < list.length; i++) {
    const fields = flat.fields(flat.indirect(list.at + i * 4));
    const sprites = flat.vector(fields[2]);
    const rects = [];
    for (let s = 0; s < sprites.length; s++) {
      const sprite = flat.fields(flat.indirect(sprites.at + s * 4));
      if (!sprite[0] || !sprite[7]) { rects.push(null); continue; }
      rects.push({
        x: Math.round(flat.f32(sprite[0])),
        y: Math.round(flat.f32(sprite[0] + 4)),
        w: Math.round(flat.f32(sprite[0] + 8)),
        h: Math.round(flat.f32(sprite[0] + 12)),
        sheet: SHEET_OF[flat.i32(sprite[7])] || null
      });
    }
    atlases.set(flat.string(fields[0]), rects);
  }
}
console.log('\n  registry: ' + atlases.size + ' atlases, '
  + [...atlases.values()].reduce((n, r) => n + r.length, 0).toLocaleString('en-US') + ' sprites');

const grounds = [];
for (const file of fs.readdirSync(GROUND).filter(name => /^GroundTypes\./.test(name))) {
  const text = fs.readFileSync(path.join(GROUND, file), 'utf8');
  for (const m of text.matchAll(/<Ground\b([^>]*)>([\s\S]*?)<\/Ground>/g)) {
    const id = /id="([^"]*)"/.exec(m[1]);
    const art = /<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
    if (id && art) grounds.push({ id: id[1], atlas: art[1], index: Number(art[2]) });
  }
}
console.log('  ' + grounds.length.toLocaleString('en-US') + ' ground types');

const pixels = new Map();
for (const name of new Set(Object.values(SHEET_OF))) {
  const file = path.join(SHEETS, name + '.png');
  if (fs.existsSync(file)) pixels.set(name, readPng(fs.readFileSync(file)));
}

const biomes = new Map();
for (const raw of fs.readFileSync(BIOMES, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('##')) continue;
  const [hex, biome] = line.split('|');
  if (!hex || !biome) continue;
  if (!biomes.has(biome)) biomes.set(biome, []);
  biomes.get(biome).push([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
}

/*
 * The client does not always call a place what the map does. Where it does
 * not, the name it uses is written here rather than left to a guess.
 */
const ALIAS = { 'Abandoned City': 'Ancient City', 'Coral Reefs': 'Coral Reef' };

/*
 * What a floor is called when nothing is named for the biome.
 *
 * The generic terrains — the plains, the forests, the beach — have no ground
 * type carrying their name, so those fall back to colour. Left to the whole
 * catalogue that picked things like "AI Untaris Dark Background Crater": the
 * right colour, and nothing anyone would call a floor. Restricting the pool
 * to ground types that sound like ground is cruder than a name and far better
 * than none.
 */
const SOUNDS_LIKE_GROUND = /grass|dirt|sand|stone|ice|snow|rock|water|tile|floor|moss|mud|gravel|earth|soil/i;

/* ---------------- cut ---------------- */
const plain = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
function tileFor(ground) {
  const rects = atlases.get(ground.atlas);
  if (!rects) return null;
  const rect = rects[ground.index];
  if (!rect || !rect.sheet || !rect.w || !rect.h) return null;
  const sheet = pixels.get(rect.sheet);
  if (!sheet || rect.x + rect.w > sheet.width || rect.y + rect.h > sheet.height) return null;
  return { rect, sheet };
}
function meanOf(tile) {
  const { rect, sheet } = tile;
  let r = 0, g = 0, b = 0, seen = 0;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = ((rect.y + y) * sheet.width + rect.x + x) * 4;
      if (sheet.pixels[i + 3] < 200) continue;
      r += sheet.pixels[i]; g += sheet.pixels[i + 1]; b += sheet.pixels[i + 2]; seen++;
    }
  }
  return seen ? { mean: [r / seen, g / seen, b / seen], solid: seen / (rect.w * rect.h) } : null;
}

fs.mkdirSync(OUT, { recursive: true });
const index = {};
const report = [];
for (const [biome, colours] of biomes) {
  const wanted = plain(ALIAS[biome] || biome);
  let chosen = grounds
    .filter(ground => plain(ground.id).includes(wanted))
    .map(ground => ({ ground, tile: tileFor(ground) }))
    .filter(entry => entry.tile)
    .map(entry => ({ ...entry, look: meanOf(entry.tile) }))
    // A floor tile is opaque. A half-empty rectangle is a decoration that
    // happens to be filed as ground.
    .filter(entry => entry.look && entry.look.solid > 0.95);

  let how = 'named';
  if (chosen.length < 3) {
    // No ground type says this biome's name. Fall back to colour, over every
    // tile the registry knows.
    how = 'colour';
    const target = [0, 1, 2].map(c => colours.reduce((sum, rgb) => sum + rgb[c], 0) / colours.length);
    chosen = grounds
      .filter(ground => SOUNDS_LIKE_GROUND.test(ground.id))
      .map(ground => ({ ground, tile: tileFor(ground) }))
      .filter(entry => entry.tile && entry.tile.rect.w <= 16 && entry.tile.rect.h <= 16)
      .map(entry => ({ ...entry, look: meanOf(entry.tile) }))
      .filter(entry => entry.look && entry.look.solid > 0.95)
      .sort((a, b) =>
        ((a.look.mean[0] - target[0]) ** 2 + (a.look.mean[1] - target[1]) ** 2 + (a.look.mean[2] - target[2]) ** 2)
        - ((b.look.mean[0] - target[0]) ** 2 + (b.look.mean[1] - target[1]) ** 2 + (b.look.mean[2] - target[2]) ** 2));
  }

  // Spread the pick across the set rather than taking the first few, so a
  // biome gets its dirt and its grass and not ten shades of one.
  const step = Math.max(1, Math.floor(chosen.length / PER_BIOME));
  const picked = [];
  for (let i = 0; i < chosen.length && picked.length < PER_BIOME; i += step) picked.push(chosen[i]);
  if (!picked.length) { report.push([biome, 'none', 0, '']); continue; }

  const size = Math.max(...picked.map(entry => Math.max(entry.tile.rect.w, entry.tile.rect.h)));
  const stripWidth = size * picked.length;
  const strip = Buffer.alloc(stripWidth * size * 4);
  picked.forEach((entry, slot) => {
    const { rect, sheet } = entry.tile;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const from = ((rect.y + y) * sheet.width + rect.x + x) * 4;
        const to = (y * stripWidth + slot * size + x) * 4;
        sheet.pixels.copy(strip, to, from, from + 4);
      }
    }
  });
  const slug = biome.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  fs.writeFileSync(path.join(OUT, slug + '.png'), writePng(stripWidth, size, strip));
  index[biome] = { file: slug + '.png', tile: size, count: picked.length };
  report.push([biome, how, picked.length, picked[0].ground.id]);
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log('');
for (const [biome, how, n, example] of report) {
  console.log('    ' + biome.padEnd(18) + String(n).padStart(2) + ' tiles  ' + how.padEnd(7)
    + (example ? '  e.g. ' + example : ''));
}
const fell = report.filter(row => row[1] !== 'named').length;
console.log('\n  ' + report.length + ' biomes -> ' + path.relative(root, OUT)
  + (fell ? ', ' + fell + ' by colour for want of a named ground type' : '') + '\n');
