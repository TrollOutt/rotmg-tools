'use strict';
// Artwork decoration called by build-index with its already-read source.
// It writes the sheet only; catalogue membership belongs to the index.
const fs=require('fs'),path=require('path');

/*
 * Where the drawing actually is inside one packed cell.
 *
 * A cell is not the drawing. A boss is often declared in a rectangle far wider
 * than the thing in it - the reach of its swing is in the rectangle, not the
 * picture - and a renderer that fits the rectangle to a room draws a small
 * creature in the corner of a large empty box. Measuring the pixels instead
 * leaves the packing alone and only says which part of the cell to show.
 *
 * The union across a run, not each frame on its own: a target that measured
 * every frame separately would breathe in and out as it animated. One window
 * for the whole run keeps its scale and its feet still. The cell stays the
 * cell - this is a view window inside it, and the stride is still the full
 * declared width.
 */
function cellAlphaBounds(pixels, stride, cell) {
  let left = -1, right = -1, top = -1, bottom = -1;
  for (let y = 0; y < cell.h; y++) {
    const row = cell.y + y;
    for (let x = 0; x < cell.w; x++) {
      const column = cell.x + x;
      if (pixels[(row * stride + column) * 4 + 3] <= 8) continue;
      if (left < 0 || x < left) left = x;
      if (x > right) right = x;
      if (top < 0 || y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function visibleBounds(pixels, stride, cells) {
  let out = null;
  for (const cell of cells) {
    const one = cellAlphaBounds(pixels, stride, cell);
    if (!one) continue;
    if (!out) { out = { ...one }; continue; }
    const right = Math.max(out.x + out.w, one.x + one.w);
    const bottom = Math.max(out.y + out.h, one.y + one.h);
    out.x = Math.min(out.x, one.x);
    out.y = Math.min(out.y, one.y);
    out.w = right - out.x;
    out.h = bottom - out.y;
  }
  return out;
}

module.exports=function({ root, documents, readAsset, facts }) {
const OUT=path.join(root,'web','assets','theory');
const { readPng, writePng } = require('./png');

/* ---------------- the registry ---------------- */
/*
 * Where every picture is, read once by the shared reader.
 *
 * This carried a third copy of the FlatBuffers decoder, with the same
 * misreading as the other two: a sprite rectangle's last two floats are
 * height then width, not width then height. Invisible on a square sprite and
 * wrong on the rest - which on this sheet is every attack frame, because an
 * attack frame is wider than the body swinging it. See tools/spritesheet.js.
 */
const registry = require('./spritesheet');
const blob = registry.read(readAsset('spritesheet.bin'));

// Still pictures, by atlas and index.
const still = new Map();
for (const atlas of blob.still) {
  const rects = new Map();
  for (const one of atlas.sprites) {
    if (rects.has(one.index)) continue;
    rects.set(one.index, { x: one.rect.x, y: one.rect.y, w: one.rect.w, h: one.rect.h, sheet: one.sheet });
  }
  still.set(atlas.name, rects);
}

// And moving ones, filed by which way they face and what they are doing.
const moving = new Map();
for (const one of blob.animated) {
  const key = one.atlas + '#' + one.index;
  if (!moving.has(key)) moving.set(key, []);
  moving.get(key).push({
    facing: one.direction, doing: one.action,
    x: one.rect.x, y: one.rect.y, w: one.rect.w, h: one.rect.h, sheet: one.sheet
  });
}

const sheets = new Map();
const sheetFor = name => {
  if (sheets.has(name)) return sheets.get(name);
  const bytes = readAsset('textures/' + name + '.png');
  const got = bytes ? readPng(bytes) : null;
  sheets.set(name, got);
  return got;
};

/* ---------------- what to cut ---------------- */
/*
 * Whatever order the attributes come in: the client writes type first for
 * most objects and something else for five thousand of them, and a pattern
 * that insisted on the order never saw those at all.
 */
const SHAPE = /<Object\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/Object>/g;

const objectText = [...documents.keys()]
  .filter(name => /^Objects\.\d+\.xml$/.test(name)).sort()
  .map(name => documents.get(name));

const artOf = new Map();          // object id -> { atlas, index, size }
for (const text of objectText) {
  for (const m of text.matchAll(SHAPE)) {
    if (artOf.has(m[1])) continue;
    const art = /<(?:Animated)?Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
    if (!art) continue;
    const size = /<Size>([^<]+)<\/Size>/.exec(m[2]);
    const shown = /<DisplayId>([^<]*)<\/DisplayId>/.exec(m[2]);
    /*
     * How a projectile is meant to sit.
     *
     * A bolt is drawn pointing one particular way in its own picture, and the
     * client says which as an eighth of a turn: AngleCorrection one means the
     * art points up and right, so it has to be turned back before it can be
     * pointed anywhere. Rotation, where a projectile has one, is how many
     * milliseconds it takes to turn a radian - a spinner rather than an
     * arrow. Neither changes where the shot goes; both change how it looks
     * going there.
     */
    const tilt = /<AngleCorrection>([^<]*)<\/AngleCorrection>/.exec(m[2]);
    const spin = /<Rotation>([^<]*)<\/Rotation>/.exec(m[2]);
    artOf.set(m[1], {
      atlas: art[1].trim(),
      index: Number(art[2]),
      size: size ? Math.max(10, Math.min(400, Number(size[1]))) : 100,
      shown: shown ? shown[1].trim() : null,
      tilt: tilt ? Number(tilt[1]) : undefined,
      spin: spin ? Number(spin[1]) : undefined
    });
  }
}

/* Which projectile object each weapon and ability throws. */
const shotOf = new Map();         // item id -> projectile object id
for (const text of objectText) {
  for (const m of text.matchAll(SHAPE)) {
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
  if (Number.isFinite(art.tilt) && art.tilt) out.tilt = art.tilt;
  if (Number.isFinite(art.spin) && art.spin) out.spin = art.spin;
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



// The things worth hitting, moving.
let hitters = 0;
const byShown = new Map();
for (const [id, art] of artOf) if (art.shown && !byShown.has(art.shown)) byShown.set(art.shown, id);
for (const one of facts.bosses) {
  const where = artOf.has(one.id) ? one.id : byShown.get(one.name);
  if (!where) continue;
  const got = cutOne('t:' + one.id, where, true);
  if (!got) continue;
  /*
   * And nothing that turns out to be drawn from nothing. A few things the
   * client calls enemies are doors and triggers whose picture is two stray
   * pixels - the Gates of the Nether is one - and a row of empty squares in
   * a list of things to fight is a row of questions nobody can answer.
   */
  let lit = 0;
  for (const r of got.tiles) {
    const from = sheetFor(r.sheet);
    for (let y = 0; y < r.h && lit < 12; y++) {
      for (let x = 0; x < r.w; x++) {
        if (from.pixels[((r.y + y) * from.width + r.x + x) * 4 + 3] > 8) { lit++; break; }
      }
    }
  }
  if (lit < 3) continue;
  one.pic = 't:' + one.id;
  hitters++;
}

// And the bolt each weapon and ability actually throws.
let bolts = 0;
for (const one of facts.items) {
  const thrown = shotOf.get(one.name);
  if (!thrown) continue;
  const key = 'p:' + thrown;
  // Poses wanted: a good many bolts have a run of frames and spin as they go.
  if (cutOne(key, thrown, true)) { one.pic = key; bolts++; }
}

/*
 * And the nineteen classes, in the same way.
 *
 * They were being read out of the realm atlas instead - a folder of one strip
 * a class, built for the map - which meant the offline copy of this page,
 * which cannot carry a folder, had no figure in its frame at all. A class is
 * a thing with poses like any other, so it is cut here with the rest.
 */
let folk = 0;
for (const one of facts.classes) {
  if (cutOne('c:' + one.name, one.name, true)) { one.pic = 'c:' + one.name; folk++; }
}

/*
 * Items are not cut here.
 *
 * They used to be, because the folder of wiki renders this page read was
 * always a patch behind the game and the newest items had no picture at all.
 * That folder is gone: an item's picture is the rectangle the index cut out of
 * the client, on the index's own sheet, and every page of the site draws it
 * from there. Cutting a second copy onto this sheet would be two pictures of
 * one thing, which is the arrangement that let them disagree.
 */

/*
 * And an icon for each enchantment, which is the one thing on that side of
 * the page nobody can identify from words alone: a thousand of them, most
 * named "something Bonus" with a numeral, and the picture is how a player
 * tells them apart at a glance. They are not objects, so they carry their
 * texture in the enchantment file rather than pointing at one.
 */
let charms = 0;
{
  const raw = documents.get('Enchantments.xml');
  const byId = new Map(facts.enchants.map(one => [one.id, one]));
  const shape = new RegExp('<Enchantment id="([^"]+)"[\\s\\S]*?<Texture>'
    + '\\s*<File>([^<]+)</File>\\s*<Index>([^<]+)</Index>', 'g');
  for (const m of raw.matchAll(shape)) {
    const one = byId.get(m[1]);
    if (!one) continue;
    const key = 'e:' + m[1];
    if (already.has(key)) { if (already.get(key)) one.pic = key; continue; }
    const bag = still.get(m[2].trim());
    const rect = bag && bag.get(Number(m[3]));
    const sheet = rect && rect.sheet && sheetFor(rect.sheet);
    if (!sheet || !rect.w || !rect.h
      || rect.x + rect.w > sheet.width || rect.y + rect.h > sheet.height) {
      already.set(key, null);
      continue;
    }
    const made = { key, w: rect.w, h: rect.h, frames: 1, size: 100, tiles: [rect] };
    cut.push(made);
    already.set(key, made);
    one.pic = key;
    charms++;
  }
}

/*
 * Where the drawing actually is inside its rectangle.
 *
 * A rectangle is not the drawing. Several of them are taller than what they
 * hold - the Assassin's swing is declared sixteen rows deep and the art sits
 * in the top eight of them - so standing a frame on the bottom of its
 * rectangle stands some frames on nothing, and the figure leaps every time
 * that frame comes round. Each frame is measured, stood on the floor of its
 * cell, and the cell is made no taller than the tallest drawing in it: a cell
 * with empty rows in it is drawn at the size of the emptiness, which is what
 * made one class half the height of the next.
 */
function bounds(from, r) {
  let top = -1, bottom = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (from.pixels[((r.y + y) * from.width + r.x + x) * 4 + 3] > 8) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  return top < 0 ? { top: 0, bottom: r.h - 1, high: r.h } : { top, bottom, high: bottom - top + 1 };
}

for (const one of cut) {
  one.shape = one.tiles.map(r => bounds(sheetFor(r.sheet), r));
  one.h = Math.max(1, ...one.shape.map(b => b.high));
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
  /*
   * Middled in its cell, unless the run reaches forward when it swings.
   *
   * Centring is right for a run whose frames grow in every direction, and
   * wrong for a character: seventeen of the nineteen classes draw an
   * eight-pixel body and a sixteen-pixel attack, the body still at the left
   * of it and the weapon reaching right. Centred, the body sat four pixels
   * further back on the swing than at rest, and the figure hopped backwards
   * on every shot.
   *
   * Such a run is laid out from its leading edge instead - every frame of
   * it, not only the wide ones, or the body would move on the frames that
   * stayed narrow. See tools/spritesheet.js for the rule and
   * attackAnchorX in web/skins/app.js for the same rule applied by
   * something that draws rather than packs.
   */
  const forward = registry.reachesForward(one.tiles);
  one.tiles.forEach((r, slot) => {
    const from = sheetFor(r.sheet);
    // Standing on its floor, so a rectangle taller than its drawing does not
    // make the figure leap when that frame comes round.
    const ox = one.px + slot * one.w + (forward ? 0 : (one.w - r.w) >> 1);
    const oy = one.py + one.h - 1 - one.shape[slot].bottom;
    for (let ry = 0; ry < r.h; ry++) {
      const row = oy + ry;
      if (row < one.py || row >= one.py + one.h) continue;
      for (let rx = 0; rx < r.w; rx++) {
        const at = ((r.y + ry) * from.width + r.x + rx) * 4;
        from.pixels.copy(sheet, (row * WIDE + ox + rx) * 4, at, at + 4);
      }
    }
  });
}


/*
 * Which part of a target's cell is the creature.
 *
 * Targets only: a charm or an item is cut to its own picture already, and the
 * class runs are packed to their leading edge on purpose. A target's
 * rectangle carries the reach of its swing, so this is measured from the
 * packed pixels - the same cells the sheet was just written from - and stored
 * beside the rectangle rather than replacing it. Nothing moves: the stride,
 * the frames and the poses stay exactly what the packer above decided.
 */
for (const one of cut) {
  if (!one.key.startsWith('t:')) continue;
  const cells = [];
  for (let slot = 0; slot < one.frames && slot < one.tiles.length; slot++) {
    cells.push({ x: one.px + slot * one.w, y: one.py, w: one.w, h: one.h });
  }
  /*
   * Keep the visible window of every frame too. The picker and the fight may
   * show only the walk/idle run; an enormous attack frame must not make that
   * displayed animation look tiny.
   */
  one.visibleFrames = cells.map(cell => cellAlphaBounds(sheet, WIDE, cell));
  const visible = visibleBounds(sheet, WIDE, cells);
  if (visible && (visible.x || visible.y || visible.w !== one.w || visible.h !== one.h)) {
    one.visible = visible;
  }
}

fs.mkdirSync(OUT, { recursive: true });
const png = path.join(OUT, 'sheet.png');
fs.writeFileSync(png, writePng(WIDE, tall, sheet));

facts.sheet = {
  wide: WIDE, tall,
  pics: Object.fromEntries(cut.map(one => [one.key, {
    x: one.px, y: one.py, w: one.w, h: one.h,
    frames: one.frames, size: one.size,
    ...(one.tilt ? { tilt: one.tilt } : {}),
    ...(one.spin ? { spin: one.spin } : {}),
    ...(one.poses ? { poses: one.poses } : {}),
    ...(one.visible ? { visible: one.visible } : {}),
    ...(one.visibleFrames ? { visibleFrames: one.visibleFrames } : {})
  }]))
};


return facts;
};
module.exports.visibleBounds = visibleBounds;
module.exports.cellAlphaBounds = cellAlphaBounds;
if (require.main === module) {
  console.error('Run node tools/build-index.js --sprites, then npm run project-data.');
  process.exitCode = 1;
}
