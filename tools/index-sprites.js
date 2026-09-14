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
    /*
     * And the frames it turns over, where it has any.
     *
     * A portal shimmers in the game, and the client says how - but not in the
     * sprite registry, which is where everything else here looks. It is an
     * <Animation> block on the object itself, holding a <Frame time="..."> for
     * each picture in turn with its own texture and its own duration. Eighty-
     * four of the two hundred and twenty-three portals carry one, from two
     * frames to thirty-two, and nothing in this repository had ever read it.
     */
    const film = /<Animation[^>]*>([\s\S]*?)<\/Animation>/.exec(m[2]);
    const frames = [];
    if (film) {
      for (const one of film[1].matchAll(
        /<Frame\s+time="([^"]+)"\s*>\s*<Texture(?:\s[^>]*)?>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/g)) {
        const at = one[3].trim();
        frames.push({
          seconds: Number(one[1]),
          atlas: one[2].trim(),
          index: /^0x/i.test(at) ? Number.parseInt(at, 16) : Number(at)
        });
      }
    }
    artOf.set(id[1], {
      atlas: art[2].trim(),
      index: /^0x/i.test(index) ? Number.parseInt(index, 16) : Number(index),
      moves: Boolean(art[1]),
      frames: frames.length > 1 ? frames : undefined
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

const WIDE = 1024;                             // how wide the finished sheet is
const cut = [];
const seen = new Map();
const films = new Map();                       // a strip's frames -> where it went                        // rectangle key -> the cut it went into
let drawn = 0, none = 0, filmed = 0;

/*
 * A thing that turns over, laid out as one strip beside the still pictures.
 *
 * Every frame goes on the sheet in order, so the record carries one rectangle
 * and a count rather than a list of rectangles - and the times beside it,
 * because the client does not space them evenly. A portal that rests for a
 * second and then flickers four times in half of one is a portal, and a strip
 * played at a constant rate is a strip.
 */
function filmOf(one, art) {
  if (!art || !art.frames) return;
  /*
   * Portals only, for now.
   *
   * Three hundred and sixty-three things declare an <Animation> - fifty
   * portals, two hundred and eighty-four creatures and twenty-nine items -
   * and cutting all of them adds a third of a megabyte to a sheet every
   * visitor of the index pays for. A portal is the one this site plays: it is
   * what the progression dialog and the dungeon lists draw, and a dungeon
   * that shimmers is how it looks in the game. The rest are read and left on
   * the floor until something wants to play them.
   */
  if (one.kind !== 'portal') return;
  /* A strip has to fit across the sheet to be laid down in one run. */
  const across = art.frames.length * (rectFor(art) || {}).w;
  if (!(across > 0) || across > WIDE) return;
  const shots = [];
  for (const frame of art.frames) {
    const bag = still.get(frame.atlas);
    const rect = bag && bag.get(frame.index);
    if (!rect || !rect.w || !rect.h) return;
    const from = sheetFor(rect.sheet);
    if (!from || rect.x + rect.w > from.width || rect.y + rect.h > from.height) return;
    shots.push({ rect, from, seconds: frame.seconds });
  }
  /* One size for the strip: the client draws every frame of one into one cell. */
  const wide = Math.max(...shots.map(x => x.rect.w));
  const tall = Math.max(...shots.map(x => x.rect.h));
  if (shots.some(x => x.rect.w !== wide || x.rect.h !== tall)) return;
  /* And the same strip twice is the same strip: the wormholes share theirs. */
  const times = shots.map(x => Math.max(20, Math.round(x.seconds * 1000)));
  const key = shots.map(x => x.rect.sheet + ':' + x.rect.x + ':' + x.rect.y).join(' ')
    + ' @' + times.join(',');
  const had = films.get(key);
  one.filmFor = times;
  if (had !== undefined) { one.film = had; filmed++; return; }
  one.film = cut.length;
  films.set(key, cut.length);
  shots.forEach((shot, at) =>
    cut.push({ rect: shot.rect, from: shot.from, strip: at === 0 ? shots.length : 0 }));
  filmed++;
}
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
  /*
   * A thing whose still picture is somebody else's still picture still has
   * its own animation. The four Alien wormholes share one rectangle and so
   * did the Halloween cemetery with the ordinary one, so all five fell out
   * here and stopped turning over while their neighbours did.
   */
  if (had !== undefined) { one.art = had; drawn++; filmOf(one, art); continue; }
  const at = cut.length;
  cut.push({ rect, from });
  seen.set(key, at);
  one.art = at;
  drawn++;
  filmOf(one, art);
}

/* ---------------- one sheet for the lot ---------------- */
/*
 * Laid out in rows of a fixed height, tallest first, so a row is filled before
 * the next begins. Nothing here is bigger than a creature, and most of it is
 * eight pixels square.
 */
/*
 * Laid out in rows of a fixed height, tallest first - but a strip is laid down
 * whole, because its frames have to sit beside each other in order for
 * anything to play them by sliding along one rectangle.
 */
const units = [];
for (let at = 0; at < cut.length; at++) {
  if (cut[at].strip === 0) continue;           // a later frame of the strip before it
  const count = cut[at].strip || 1;
  units.push({ at, count, w: cut[at].rect.w * count, h: cut[at].rect.h });
}
units.sort((a, b) => b.h - a.h);
let x = 0, y = 0, rowH = 0;
const place = new Array(cut.length);
for (const unit of units) {
  if (x + unit.w > WIDE) { x = 0; y += rowH; rowH = 0; }
  for (let i = 0; i < unit.count; i++) {
    const { rect } = cut[unit.at + i];
    place[unit.at + i] = [x + i * rect.w, y, rect.w, rect.h];
  }
  x += unit.w;
  if (unit.h > rowH) rowH = unit.h;
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
  if (one.art !== undefined) one.art = place[one.art];
  /* The strip as one rectangle and how many frames are along it. */
  if (one.film !== undefined) {
    const at = place[one.film];
    one.film = [at[0], at[1], at[2], at[3], one.filmFor.length];
  }
}
facts.sheet = { wide: WIDE, tall };

fs.mkdirSync(OUT, { recursive: true });
const png = path.join(OUT, 'sheet.png');
fs.writeFileSync(png, writePng(WIDE, tall, sheet));
console.log('  ' + filmed + ' things turn over, ' + cut.length.toLocaleString('en-US') + ' rectangles on the sheet');



return facts;
};
if (require.main === module) {
  console.error('Run node tools/build-index.js --sprites, then npm run project-data.');
  process.exitCode = 1;
}
