'use strict';
// Artwork decoration called by build-index with its already-read source.
// It writes the sheet only; catalogue membership belongs to the index.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
module.exports=function({ root, documents, readAsset, facts }) {
const OUT=path.join(root,'web','assets','index');
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

/* Just enough PNG, shared with the tools that also cut from a sheet. */
const { readPng, writePng } = require('./png');

/* ---------------- where every picture lives ---------------- */
const SHEET_OF = { 1: 'groundTiles', 2: 'characters', 4: 'mapObjects' };
const sheetName = field => SHEET_OF[field] || 'mapObjects';

// The caller owns source access; both sprite decorators share its asset cache.
const flat = new Flat(readAsset('spritesheet.bin'));
const rootFields = flat.fields(flat.root());

const still = new Map();                       // atlas -> index -> rectangle
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

/* And the moving ones, of which one standing frame is enough here. */
const moving = new Map();
{
  const list = flat.vector(rootFields[1]);
  for (let i = 0; i < list.length; i++) {
    const one = flat.fields(flat.indirect(list.at + i * 4));
    if (!one[0] || !one[5]) continue;
    const sprite = flat.fields(flat.indirect(one[5]));
    if (!sprite[0]) continue;
    const key = flat.string(one[0]) + '#' + (one[1] ? flat.i32(one[1]) : 0);
    const facing = one[3] ? flat.i32(one[3]) : 0;
    const doing = one[4] ? flat.i32(one[4]) : 0;
    // Standing, facing the reader where there is such a frame.
    const rank = (doing === 0 ? 0 : 4) + (facing === 3 ? 0 : facing === 0 ? 1 : 2);
    const had = moving.get(key);
    if (had && had.rank <= rank) continue;
    moving.set(key, {
      rank,
      x: Math.round(flat.f32(sprite[0])), y: Math.round(flat.f32(sprite[0] + 4)),
      w: Math.round(flat.f32(sprite[0] + 8)), h: Math.round(flat.f32(sprite[0] + 12)),
      sheet: sheetName(sprite[7] ? flat.i32(sprite[7]) : 0)
    });
  }
}

const sheets = new Map();
const sheetFor = name => {
  if (sheets.has(name)) return sheets.get(name);
  const bytes = readAsset('textures/' + name + '.png');
  const got = bytes ? readPng(bytes) : null;
  sheets.set(name, got);
  return got;
};

/* ---------------- which texture each thing declares ---------------- */
const objectFiles = [...documents.keys()]
  .filter(name => /^Objects\.\d+\.xml$/.test(name)).sort();
const artOf = new Map();                       // client id -> {atlas, index, moves}
for (const file of objectFiles) {
  const raw = documents.get(file);
  for (const m of raw.matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const id = /\bid="([^"]*)"/.exec(m[1]);
    if (!id || artOf.has(id[1])) continue;
    /*
     * The offsets a texture may carry sit in the opening tag, and a pattern
     * that insists on a bare one walks past eight hundred and forty items -
     * every potion, every tier-nought weapon, the whole of Objects.134.
     */
    const art = /<(Animated)?Texture(?:\s[^>]*)?>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/
      .exec(m[2]);
    if (!art) continue;
    const index = art[3].trim();
    artOf.set(id[1], {
      atlas: art[2].trim(),
      index: /^0x/i.test(index) ? Number.parseInt(index, 16) : Number(index),
      moves: Boolean(art[1])
    });
  }
}

/* The enchantments carry their texture themselves, not through an object. */
const charmArt = new Map();
{
  const raw = documents.get('Enchantments.xml');
  for (const m of raw.matchAll(
    /<Enchantment id="([^"]+)"[\s\S]*?<Texture(?:\s[^>]*)?>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/g)) {
    const index = m[3].trim();
    charmArt.set(m[1], {
      atlas: m[2].trim(),
      index: /^0x/i.test(index) ? Number.parseInt(index, 16) : Number(index)
    });
  }
}

/* ---------------- the cutting ---------------- */


function rectFor(art) {
  if (!art) return null;
  if (art.moves) {
    const got = moving.get(art.atlas + '#' + art.index);
    if (got) return got;
  }
  const bag = still.get(art.atlas);
  return (bag && bag.get(art.index)) || null;
}

const cut = [];
const seen = new Map();                        // rectangle key -> the cut it went into
let drawn = 0, none = 0;
for (const one of facts.records) {
  /*
   * A record is drawn from whatever the client says draws it: an object by its
   * own id, an enchantment by the texture in the enchantment file. A set, a
   * pool and a place have no picture of their own and are left without one
   * rather than given somebody else's.
   */
  let art = null;
  if (one.kind === 'enchant') art = charmArt.get(one.alias || one.name);
  /*
   * A set has no picture of its own, but most of them turn the wearer into a
   * skin, and that skin is an object the client draws. The build says which.
   */
  else if (one.drawnAs) art = artOf.get(one.drawnAs);
  else art = artOf.get(one.alias || one.name);
  const rect = rectFor(art);
  if (!rect || !rect.w || !rect.h) { none++; continue; }
  const from = sheetFor(rect.sheet);
  if (!from || rect.x + rect.w > from.width || rect.y + rect.h > from.height) { none++; continue; }
  /*
   * The same rectangle twice is the same picture twice. Three hundred things
   * share a texture with something else, and a sheet that repeats them is a
   * sheet that is bigger for no reason.
   */
  const key = rect.sheet + ':' + rect.x + ':' + rect.y + ':' + rect.w + ':' + rect.h;
  const had = seen.get(key);
  if (had !== undefined) { one.art = had; drawn++; continue; }
  const at = cut.length;
  cut.push({ rect, from });
  seen.set(key, at);
  one.art = at;
  drawn++;
}

/* ---------------- one sheet for the lot ---------------- */
/*
 * Laid out in rows of a fixed height, tallest first, so a row is filled before
 * the next begins. Nothing here is bigger than a creature, and most of it is
 * eight pixels square.
 */
const WIDE = 1024;
const order = cut.map((one, at) => at).sort((a, b) => cut[b].rect.h - cut[a].rect.h);
let x = 0, y = 0, rowH = 0;
const place = new Array(cut.length);
for (const at of order) {
  const { rect } = cut[at];
  if (x + rect.w > WIDE) { x = 0; y += rowH; rowH = 0; }
  place[at] = [x, y, rect.w, rect.h];
  x += rect.w;
  if (rect.h > rowH) rowH = rect.h;
}
const tall = y + rowH;
const sheet = Buffer.alloc(WIDE * tall * 4);
for (let at = 0; at < cut.length; at++) {
  const { rect, from } = cut[at];
  const [px, py] = place[at];
  for (let ry = 0; ry < rect.h; ry++) {
    for (let rx = 0; rx < rect.w; rx++) {
      const source = ((rect.y + ry) * from.width + rect.x + rx) * 4;
      from.pixels.copy(sheet, ((py + ry) * WIDE + px + rx) * 4, source, source + 4);
    }
  }
}

/* The record keeps the rectangle rather than a number into a list nobody has. */
for (const one of facts.records) {
  if (one.art === undefined) continue;
  one.art = place[one.art];
}
facts.sheet = { wide: WIDE, tall };

fs.mkdirSync(OUT, { recursive: true });
const png = path.join(OUT, 'sheet.png');
fs.writeFileSync(png, writePng(WIDE, tall, sheet));



return facts;
};
if (require.main === module) {
  console.error('Run node tools/build-index.js --sprites, then npm run project-data.');
  process.exitCode = 1;
}
