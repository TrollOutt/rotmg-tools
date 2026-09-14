'use strict';
// Artwork decoration called by build-index with its already-read source.
// It writes the sheet only; catalogue membership belongs to the index.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
module.exports=function({ root, documents, readAsset, facts }) {
const OUT=path.join(root,'web','assets','index');
/*
 * Where every picture is, read once by the shared reader.
 *
 * This used to carry its own copy of the FlatBuffers decoder and its own
 * understanding of the sprite record. That copy had the rectangle's last two
 * floats the wrong way round - they are height then width, not width then
 * height - which is invisible on a square sprite and wrong on the 7,498 that
 * are not. See tools/spritesheet.js, which now holds the one reader.
 */
const registry = require('./spritesheet');
const { readPng, writePng } = require('./png');
const sheetName = registry.sheetName;
const blob = registry.read(readAsset('spritesheet.bin'));

const still = new Map();                       // atlas -> index -> rectangle
for (const atlas of blob.still) {
  const rects = new Map();
  for (const one of atlas.sprites) {
    if (rects.has(one.index)) continue;
    rects.set(one.index, { x: one.rect.x, y: one.rect.y, w: one.rect.w, h: one.rect.h, sheet: one.sheet });
  }
  still.set(atlas.name, rects);
}

/* And the moving ones, of which one standing frame is enough here. */
const moving = new Map();
for (const one of blob.animated) {
  const key = one.atlas + '#' + one.index;
  // Standing, facing the reader where there is such a frame.
  const rank = (one.action === 0 ? 0 : 4)
    + (one.direction === 3 ? 0 : one.direction === 0 ? 1 : 2);
  const had = moving.get(key);
  if (had && had.rank <= rank) continue;
  moving.set(key, { rank, x: one.rect.x, y: one.rect.y, w: one.rect.w, h: one.rect.h, sheet: one.sheet });
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
