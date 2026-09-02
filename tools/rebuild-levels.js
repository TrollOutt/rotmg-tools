'use strict';
/*
 * Bake the far-off zoom levels again, from the ground up.
 *
 *   node tools/rebuild-levels.js
 *
 * Only the closest level draws the scenery as the page runs. The four levels
 * behind it are pictures with the scenery already painted into them, which is
 * what makes a whole realm in one view cheap - and what made taking anything
 * off the map only half work. Prune things.bin and the closest level loses
 * them; zoom out one step and there they all are again, baked into the
 * ground years ago as far as the page is concerned.
 *
 * The recipe was worked out by measuring rather than assuming. Over a whole
 * level-1 chunk, every pixel that no thing's footprint could reach matches a
 * two-by-two average of level 0 exactly - 771,531 of them, with twelve
 * disagreeing - while inside the footprints only two in five match. So:
 *
 *   level 0            the ground, and nothing standing on it
 *   level n            level n-1 halved, with the things drawn on top
 *
 * The ground is halved from the ground rather than from the finished picture
 * of the level before, so nothing that was taken off leaves a ghost of itself
 * averaged into the floor underneath where it used to stand.
 *
 * Water is not composited here and does not need to be: it is in the ground
 * at every level, and only the closest one lifts it out to be drawn moving.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

const root = path.join(__dirname, '..');
const ATLAS = path.join(root, 'web', 'assets', 'atlas');
const SIDE = 1024;                                  // every chunk picture, at every level

/* ---------------- PNG ---------------- */
function readPng(buffer) {
  if (buffer[24] !== 8 || buffer[25] !== 6 || buffer[28] !== 0) throw new Error('expected 8-bit RGBA');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
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
  for (let y = 0; y < height; y++) {
    const to = y * (stride + 1);
    raw[to] = 1;
    for (let x = 0; x < stride; x++) {
      raw[to + 1 + x] = (rgba[y * stride + x] - (x >= 4 ? rgba[y * stride + x - 4] : 0)) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- the pieces ---------------- */
const atlas = JSON.parse(fs.readFileSync(path.join(ATLAS, 'atlas.json'), 'utf8'));
const things = JSON.parse(fs.readFileSync(path.join(ATLAS, 'things.json'), 'utf8'));
const rawBin = fs.readFileSync(path.join(ATLAS, 'things.bin'));
const placed = new Uint16Array(rawBin.buffer, rawBin.byteOffset, rawBin.length / 2);
const sheet = readPng(fs.readFileSync(path.join(ATLAS, 'things.png')));
const SS = things.ss || 1;
const PER_SHEET_TILE = atlas.px * SS;                // sheet pixels to a tile

const LEVELS = atlas.levels.length;                  // five of them
const CHUNK = atlas.px === 8 ? atlas.chunk : atlas.chunk;   // 128 tiles at level 0
const tilesPerChunk = z => CHUNK * (1 << z);
const pixelsPerTile = z => SIDE / tilesPerChunk(z);  // 8, 4, 2, 1, 0.5

// The ground pyramid is written aside rather than kept in hand: eighty-one
// megapixel chunks is three hundred megabytes and there are four levels of it.
const GROUND = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ground-'));

function groundPath(z, key) { return path.join(GROUND, 'z' + z + '_' + key + '.bin'); }

/* Level 0's ground is the published picture; it has nothing on it. */
let held = 0;
for (const key of atlas.levels[0].chunks) {
  const file = path.join(ATLAS, 'z0', key + '.png');
  if (!fs.existsSync(file)) continue;
  fs.writeFileSync(groundPath(0, key), readPng(fs.readFileSync(file)).pixels);
  held++;
}
console.log('level 0 ground read: ' + held + ' chunks');

/*
 * Halving.
 *
 * Averaged with alpha as the weight, so a pixel of ground next to a pixel of
 * nothing keeps its own colour instead of being dragged towards black.
 */
function halveInto(out, kids) {
  for (let ky = 0; ky < 2; ky++) {
    for (let kx = 0; kx < 2; kx++) {
      const kid = kids[ky * 2 + kx];
      const ox = kx * (SIDE / 2), oy = ky * (SIDE / 2);
      for (let y = 0; y < SIDE / 2; y++) {
        for (let x = 0; x < SIDE / 2; x++) {
          const to = ((oy + y) * SIDE + ox + x) * 4;
          if (!kid) { out[to] = 0; out[to + 1] = 0; out[to + 2] = 0; out[to + 3] = 0; continue; }
          let r = 0, g = 0, b = 0, a = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const from = ((y * 2 + dy) * SIDE + x * 2 + dx) * 4;
              const al = kid[from + 3];
              r += kid[from] * al; g += kid[from + 1] * al; b += kid[from + 2] * al; a += al;
            }
          }
          if (!a) { out[to] = 0; out[to + 1] = 0; out[to + 2] = 0; out[to + 3] = 0; continue; }
          out[to] = Math.round(r / a); out[to + 1] = Math.round(g / a); out[to + 2] = Math.round(b / a);
          out[to + 3] = Math.round(a / 4);
        }
      }
    }
  }
}

/*
 * A thing, drawn small.
 *
 * The same placement the page uses - a foot in the middle of the bottom edge,
 * lifted by the pixel of outline and by whatever rise the client gives it -
 * and the sprite averaged down to the size it wants rather than sampled, so a
 * tree does not come apart into three pixels of leaf.
 */
function paintThing(out, pic, tx, ty, ppt, x0, y0) {
  const size = (pic[4] || 100) / 100;
  const perPixel = ppt / PER_SHEET_TILE;
  const wide = pic[2] * size * perPixel, tall = pic[3] * size * perPixel;
  if (wide < 0.05 || tall < 0.05) return 0;
  const foot = (pic[6] || 0) * size * perPixel;
  const left = (tx - x0) * ppt - wide / 2;
  const top = (ty + 1 - y0) * ppt - tall + foot - ((pic[5] || 0) / 100) * ppt;
  const sx = pic[0], sy = pic[1], sw = pic[2], sh = pic[3];
  let touched = 0;
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(SIDE, Math.ceil(top + tall)); y++) {
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(SIDE, Math.ceil(left + wide)); x++) {
      // the patch of sprite this destination pixel covers
      const u0 = ((x - left) / wide) * sw, u1 = ((x + 1 - left) / wide) * sw;
      const v0 = ((y - top) / tall) * sh, v1 = ((y + 1 - top) / tall) * sh;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let v = Math.max(0, Math.floor(v0)); v < Math.min(sh, Math.max(Math.ceil(v1), Math.floor(v0) + 1)); v++) {
        for (let u = Math.max(0, Math.floor(u0)); u < Math.min(sw, Math.max(Math.ceil(u1), Math.floor(u0) + 1)); u++) {
          const from = ((sy + v) * sheet.width + sx + u) * 4;
          const al = sheet.pixels[from + 3];
          r += sheet.pixels[from] * al; g += sheet.pixels[from + 1] * al; b += sheet.pixels[from + 2] * al;
          a += al; n++;
        }
      }
      if (!n || !a) continue;
      const cover = (a / n) / 255;
      const to = (y * SIDE + x) * 4;
      const under = out[to + 3] / 255;
      const over = cover;
      const both = over + under * (1 - over);
      if (!both) continue;
      const sr = r / a, sg = g / a, sb = b / a;
      out[to] = Math.round((sr * over + out[to] * under * (1 - over)) / both);
      out[to + 1] = Math.round((sg * over + out[to + 1] * under * (1 - over)) / both);
      out[to + 2] = Math.round((sb * over + out[to + 2] * under * (1 - over)) / both);
      out[to + 3] = Math.round(both * 255);
      touched++;
    }
  }
  return touched ? 1 : 0;
}

/* Which things fall in a chunk, sorted down the screen as the page sorts them. */
function thingsIn(x0, y0, span) {
  const list = [];
  const reach = 12;
  for (let i = 0; i < placed.length; i += 3) {
    const tx = placed[i + 1] / 8, ty = placed[i + 2] / 8;
    if (tx < x0 - reach || tx > x0 + span + reach || ty < y0 - reach || ty > y0 + span + reach) continue;
    const pic = things.pics[placed[i]];
    if (!pic) continue;
    list.push({ pic, tx, ty });
  }
  list.sort((p, q) => p.ty - q.ty);
  return list;
}

/* ---------------- build ---------------- */
/*
 * `--only=1:2_5` builds that one chunk and stops, which is how the recipe was
 * checked against the published picture before anything was overwritten.
 * `--to=DIR` writes the pictures somewhere else, for the same reason.
 */
const onlyArg = process.argv.find(value => value.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(':') : null;
const toArg = process.argv.find(value => value.startsWith('--to='));
const outDir = toArg ? toArg.slice('--to='.length) : null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });

let written = 0, drawnTotal = 0;
for (let z = 1; z < LEVELS; z++) {
  if (only && Number(only[0]) !== z) continue;
  const span = tilesPerChunk(z), ppt = pixelsPerTile(z);
  const keys = only ? atlas.levels[z].chunks.filter(key => key === only[1]) : atlas.levels[z].chunks;
  let painted = 0;
  for (const key of keys) {
    const [c, r] = key.split('_').map(Number);
    const kids = [];
    for (let ky = 0; ky < 2; ky++) {
      for (let kx = 0; kx < 2; kx++) {
        const kidKey = (c * 2 + kx) + '_' + (r * 2 + ky);
        const file = groundPath(z - 1, kidKey);
        kids.push(fs.existsSync(file) ? fs.readFileSync(file) : null);
      }
    }
    const ground = Buffer.alloc(SIDE * SIDE * 4);
    halveInto(ground, kids);
    fs.writeFileSync(groundPath(z, key), ground);

    const out = Buffer.from(ground);
    const x0 = c * span, y0 = r * span;
    for (const one of thingsIn(x0, y0, span)) painted += paintThing(out, one.pic, one.tx, one.ty, ppt, x0, y0);
    const target = outDir ? path.join(outDir, 'z' + z + '_' + key + '.png')
      : path.join(ATLAS, 'z' + z, key + '.png');
    fs.writeFileSync(target, writePng(SIDE, SIDE, out));
    written++;
  }
  drawnTotal += painted;
  console.log('level ' + z + ': ' + keys.length + ' chunks at ' + ppt
    + ' pixels to the tile, ' + painted.toLocaleString() + ' things painted');
}

fs.rmSync(GROUND, { recursive: true, force: true });
console.log('');
console.log(written + ' chunk pictures written, ' + drawnTotal.toLocaleString() + ' things painted in all');
