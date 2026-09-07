/*
 * The pictures theory crafting needs, cut out of the installed client.
 *
 * Two of them, and neither is drawn here:
 *
 *   the targets      every thing worth hitting, with the whole run of poses
 *                    the client keeps for it - standing, walking, swinging,
 *                    in each direction it has one for. The registry files
 *                    them by facing and action, so a boss in the frame moves
 *                    the way it moves in the game.
 *
 *   the shots        a weapon's projectile names an object of its own, and
 *                    that object has a texture. So the thing crossing the
 *                    frame is the actual bolt the actual weapon throws,
 *                    rather than a line.
 *
 * Everything lands on one sheet with an index of rectangles, the way the
 * atlas keeps its scenery. Six hundred separate files would be six hundred
 * requests served and six hundred data URIs carried in the offline copy; one
 * sheet is one of each.
 *
 *   node tools/theory-sprites.js        (after tools/build-theorycraft.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const SHEETS = path.join(XML, 'textures');
const OUT = path.join(root, 'web', 'assets', 'theory');
const FACTS = path.join(root, 'data', 'TheoryCraft', 'theorycraft.json');

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

/* ---------------- the registry ---------------- */
/*
 * Which packed sheet a rectangle lives on.
 *
 * The registry writes a number and only two of them ever appear: one, whose
 * rectangles all fit inside the two-thousand-pixel ground sheet, and four,
 * whose reach past six thousand across leaves only the two big ones. Both big
 * ones hold something at the Grey Missile's rectangle - but the characters
 * sheet holds it in flat white, which is the mask, and the objects sheet
 * holds it in grey, which is the missile. So four is the objects sheet, and
 * that was worth checking rather than assuming: read off the mask, every bolt
 * in the game would have come out a white smudge.
 */
const SHEET_OF = { 1: 'groundTiles' };
const sheetName = field => SHEET_OF[field] || 'mapObjects';

for (const needed of [path.join(XML, 'spritesheet.bin'), FACTS]) {
  if (fs.existsSync(needed)) continue;
  console.error('\n  ' + path.relative(root, needed) + ' is missing.'
    + (needed === FACTS ? '  Run: node tools/build-theorycraft.js' : '') + '\n');
  process.exit(1);
}

const flat = new Flat(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const rootFields = flat.fields(flat.root());

// Still pictures, by atlas and index.
const still = new Map();
{
  const list = flat.vector(rootFields[0]);
  for (let i = 0; i < list.length; i++) {
    const atlas = flat.fields(flat.indirect(list.at + i * 4));
    const sprites = flat.vector(atlas[2]);
    const rects = new Map();
    for (let n = 0; n < sprites.length; n++) {
      const one = flat.fields(flat.indirect(sprites.at + n * 4));
      /*
       * Only the rectangle is required. FlatBuffers leaves a field out when
       * it holds the default, so a sprite living on the first sheet writes no
       * sheet at all - and demanding one threw away every projectile in the
       * game, which is how the frame came to have a line in it instead of a
       * bolt.
       */
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

// And moving ones, filed by which way they face and what they are doing.
const moving = new Map();
{
  const list = flat.vector(rootFields[1]);
  for (let i = 0; i < list.length; i++) {
    const one = flat.fields(flat.indirect(list.at + i * 4));
    if (!one[0] || !one[5]) continue;
    const sprite = flat.fields(flat.indirect(one[5]));
    if (!sprite[0]) continue;
    const key = flat.string(one[0]) + '#' + (one[1] ? flat.i32(one[1]) : 0);
    if (!moving.has(key)) moving.set(key, []);
    moving.get(key).push({
      facing: one[3] ? flat.i32(one[3]) : 0,
      doing: one[4] ? flat.i32(one[4]) : 0,
      x: Math.round(flat.f32(sprite[0])), y: Math.round(flat.f32(sprite[0] + 4)),
      w: Math.round(flat.f32(sprite[0] + 8)), h: Math.round(flat.f32(sprite[0] + 12)),
      sheet: sheetName(sprite[7] ? flat.i32(sprite[7]) : 0)
    });
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

/* ---------------- what to cut ---------------- */
const objectText = fs.readdirSync(XML)
  .filter(name => /^Objects\.\d+\.xml$/.test(name)).sort()
  .map(name => fs.readFileSync(path.join(XML, name), 'utf8'));

const artOf = new Map();          // object id -> { atlas, index, size }
for (const text of objectText) {
  for (const m of text.matchAll(/<Object\s+type="[^"]+"\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/Object>/g)) {
    if (artOf.has(m[1])) continue;
    const art = /<(?:Animated)?Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
    if (!art) continue;
    const size = /<Size>([^<]+)<\/Size>/.exec(m[2]);
    const shown = /<DisplayId>([^<]*)<\/DisplayId>/.exec(m[2]);
    artOf.set(m[1], {
      atlas: art[1].trim(),
      index: Number(art[2]),
      size: size ? Math.max(10, Math.min(400, Number(size[1]))) : 100,
      shown: shown ? shown[1].trim() : null
    });
  }
}

/* Which projectile object each weapon and ability throws. */
const shotOf = new Map();         // item id -> projectile object id
for (const text of objectText) {
  for (const m of text.matchAll(/<Object\s+type="[^"]+"\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/Object>/g)) {
    if (!/<Item\s*\/>/.test(m[2]) || shotOf.has(m[1])) continue;
    const shot = /<Projectile\b[^>]*>[\s\S]*?<ObjectId>([^<]+)<\/ObjectId>/.exec(m[2]);
    if (shot) shotOf.set(m[1], shot[1].trim());
  }
}

/* ---------------- cutting ---------------- */
const cut = [];                   // { key, w, h, frames, poses, tiles: [rect] }
const already = new Map();

function cutOne(key, where, wantPoses) {
  if (already.has(key)) return already.get(key);
  const art = artOf.get(where);
  if (!art) { already.set(key, null); return null; }
  let rects = null, poses = null;
  const run = wantPoses && moving.get(art.atlas + '#' + art.index);
  if (run && run.length) {
    rects = run.slice().sort((a, b) => (a.facing - b.facing) || (a.doing - b.doing));
    poses = {};
    rects.forEach((r, slot) => {
      const at = r.facing + '/' + r.doing;
      (poses[at] || (poses[at] = [])).push(slot);
    });
  } else {
    const bag = still.get(art.atlas);
    const one = bag && bag.get(art.index);
    if (one) rects = [one];
  }
  if (!rects || !rects.length) { already.set(key, null); return null; }
  const usable = rects.filter(r => {
    const sheet = r.sheet && sheetFor(r.sheet);
    return sheet && r.w && r.h && r.x + r.w <= sheet.width && r.y + r.h <= sheet.height;
  });
  if (!usable.length) { already.set(key, null); return null; }
  const kept = new Map();
  usable.forEach((r, slot) => kept.set(rects.indexOf(r), slot));
  const out = {
    key,
    w: Math.max(...usable.map(r => r.w)),
    h: Math.max(...usable.map(r => r.h)),
    frames: usable.length,
    size: art.size,
    tiles: usable
  };
  if (poses) {
    const closed = {};
    for (const at of Object.keys(poses)) {
      const list = poses[at].map(i => kept.get(i)).filter(i => i !== undefined);
      if (list.length) closed[at] = list;
    }
    if (Object.keys(closed).length > 1) out.poses = closed;
  }
  cut.push(out);
  already.set(key, out);
  return out;
}

const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));

// The things worth hitting, moving.
let hitters = 0;
const byShown = new Map();
for (const [id, art] of artOf) if (art.shown && !byShown.has(art.shown)) byShown.set(art.shown, id);
for (const one of facts.bosses) {
  const where = artOf.has(one.id) ? one.id : byShown.get(one.name);
  if (!where) continue;
  if (cutOne('t:' + one.id, where, true)) { one.pic = 't:' + one.id; hitters++; }
}

// And the bolt each weapon and ability actually throws.
let bolts = 0;
for (const one of facts.items) {
  const thrown = shotOf.get(one.name);
  if (!thrown) continue;
  const key = 'p:' + thrown;
  if (cutOne(key, thrown, false)) { one.pic = key; bolts++; }
}

/* ---------------- one sheet for the lot ---------------- */
const WIDE = 1024;
cut.sort((a, b) => b.h - a.h);
let x = 0, y = 0, rowH = 0;
for (const one of cut) {
  const runs = one.w * one.frames;
  if (x + runs > WIDE) { x = 0; y += rowH; rowH = 0; }
  one.px = x; one.py = y;
  x += runs;
  if (one.h > rowH) rowH = one.h;
}
const tall = y + rowH;
const sheet = Buffer.alloc(WIDE * tall * 4);
for (const one of cut) {
  one.tiles.forEach((r, slot) => {
    const from = sheetFor(r.sheet);
    // Middled in its cell and standing on its floor, so a run whose frames
    // differ in size does not jitter as it plays.
    const ox = one.px + slot * one.w + ((one.w - r.w) >> 1);
    const oy = one.py + (one.h - r.h);
    for (let ry = 0; ry < r.h; ry++) {
      for (let rx = 0; rx < r.w; rx++) {
        const at = ((r.y + ry) * from.width + r.x + rx) * 4;
        from.pixels.copy(sheet, ((oy + ry) * WIDE + ox + rx) * 4, at, at + 4);
      }
    }
  });
}

fs.mkdirSync(OUT, { recursive: true });
const png = path.join(OUT, 'sheet.png');
fs.writeFileSync(png, writePng(WIDE, tall, sheet));

facts.sheet = {
  wide: WIDE, tall,
  pics: Object.fromEntries(cut.map(one => [one.key, {
    x: one.px, y: one.py, w: one.w, h: one.h,
    frames: one.frames, size: one.size,
    ...(one.poses ? { poses: one.poses } : {})
  }]))
};
fs.writeFileSync(FACTS, JSON.stringify(facts) + '\n');

console.log('\n  ' + hitters + ' targets and ' + bolts + ' bolts on one '
  + WIDE + 'x' + tall + ' sheet'
  + '\n  -> ' + path.relative(root, png)
  + '  (' + (fs.statSync(png).size / 1024).toFixed(0) + ' KB)'
  + '\n  -> ' + path.relative(root, FACTS)
  + '  (' + (fs.statSync(FACTS).size / 1024).toFixed(0) + ' KB)\n');
