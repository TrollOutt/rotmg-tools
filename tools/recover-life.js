'use strict';
/*
 * The creatures of the Realm Atlas, as the client drew them: no line round them.
 *
 *   node tools/recover-life.js            compare, and say how many would come out identical
 *   node tools/recover-life.js --write    put the bare drawings in web/assets/atlas/life
 *
 * tools/refine-outline.js laid a line round every creature in the sheets
 * themselves: half a sprite pixel, flat black, the same at every zoom. A line
 * in the picture cannot follow the zoom, and cannot be told from black art, so
 * it could not be taken off again by looking. It can be taken off by
 * cutting the creature once more from the client, exactly as
 * tools/realm-atlas-build.js cut it (every pose of the creature on one strip,
 * a pixel of room round each frame), doubling it the way refine-outline did so
 * the numbers in atlas.json still hold - and not laying the line.
 *
 * Before it writes anything it lays the old line on its own cut and compares
 * the result with the file on disk. Where they are the same pixel for pixel,
 * the cut is the one that was made, and the bare strip is exactly what the
 * line was laid on. Where they are not, the file is left alone and said.
 *
 * The atlas draws the line itself now, at the width every other page uses
 * (web/outline.js, tools/atlas-viewer.html), so nothing is lost by this. A new
 * client's creatures arrive without a line to take off.
 */
const fs = require('fs');
const path = require('path');
const { readPng, writePng } = require('./png');
const registry = require('./spritesheet');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const LIFE = path.join(root, 'web', 'assets', 'atlas', 'life');
const SS = 2;        // sheet pixels to a pixel of art, as refine-outline.js doubled it
const PAD = 1;       // the pixel of room round every frame the atlas builder leaves

/* Where each object keeps its picture, by type: the same reading as realm-atlas-build.js. */
function artOf() {
  const out = new Map();
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      if (!type) continue;
      const key = Number(type[1]) & 0xffff;
      if (out.has(key)) continue;
      const art = /<(?:Animated)?Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
      if (art) out.set(key, { atlas: art[1].trim(), index: Number(art[2]) });
    }
  }
  return out;
}

/*
 * The strips on disk were cut when the atlas builder still read a sprite's last two numbers as width then
 * height, the wrong way round (see tools/spritesheet.js). They are exactly what that cut makes, so that is
 * the cut that is repeated here: the numbers in atlas.json describe those strips, and a corrected cut would
 * make strips those numbers do not describe. Putting the crops right is a rebuild of the atlas, not this.
 */
const blob = registry.read(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const moving = new Map();
for (const f of blob.animated) {
  const key = f.atlas + '#' + f.index;
  if (!f.sheet || !f.rect.w || !f.rect.h) continue;
  (moving.get(key) || moving.set(key, []).get(key)).push({ facing: f.direction, doing: f.action, x: f.rect.x, y: f.rect.y, w: f.rect.h, h: f.rect.w, sheet: f.sheet });
}
const still = new Map();
for (const atlas of blob.still) {
  const rects = new Map();
  for (const one of atlas.sprites) if (!rects.has(one.index)) rects.set(one.index, { x: one.rect.x, y: one.rect.y, w: one.rect.h, h: one.rect.w, sheet: one.sheet });
  still.set(atlas.name, rects);
}
const sheets = new Map();
const sheetFor = name => {
  if (!sheets.has(name)) {
    const file = path.join(XML, 'textures', name + '.png');
    sheets.set(name, fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null);
  }
  return sheets.get(name);
};

/* One creature's strip, as the atlas builder cut it, with no rim. */
function cut(art) {
  const list = moving.get(art.atlas + '#' + art.index);
  let rects = null;
  if (list && list.length) rects = list.slice().sort((a, b) => (a.facing - b.facing) || (a.doing - b.doing));
  else { const one = (still.get(art.atlas) || new Map()).get(art.index); if (one) rects = [one]; }
  if (!rects) return null;
  const usable = rects.filter(r => {
    const sheet = r.sheet && sheetFor(r.sheet);
    return sheet && r.w && r.h && r.x + r.w <= sheet.width && r.y + r.h <= sheet.height;
  });
  if (!usable.length) return null;
  const w = Math.max(...usable.map(r => r.w)) + PAD * 2;
  const h = Math.max(...usable.map(r => r.h)) + PAD * 2;
  const stride = w * usable.length;
  const strip = Buffer.alloc(stride * h * 4);
  usable.forEach((r, slot) => {
    const sheet = sheetFor(r.sheet);
    const ox = slot * w + ((w - r.w) >> 1);
    const oy = h - PAD - r.h;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const from = ((r.y + y) * sheet.width + r.x + x) * 4;
        sheet.pixels.copy(strip, ((y + oy) * stride + ox + x) * 4, from, from + 4);
      }
    }
  });
  // A clear pixel carries no colour: the client leaves some under them, and the strips on disk never had it.
  for (let i = 0; i < strip.length; i += 4) if (!strip[i + 3]) strip.fill(0, i, i + 3);
  return { width: stride, height: h, pixels: strip };
}

/* Every pixel a block of SS by SS of itself; nothing is blended. */
function magnify(image) {
  const width = image.width * SS, height = image.height * SS;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y / SS) | 0) * image.width * 4;
    for (let x = 0; x < width; x++) {
      const at = from + ((x / SS) | 0) * 4;
      image.pixels.copy(pixels, (y * width + x) * 4, at, at + 4);
    }
  }
  return { width, height, pixels };
}

/* The line refine-outline.js laid: every clear pixel that shares a side with a drawn one, flat black. */
function lined(image) {
  const { width, height } = image, pixels = Buffer.from(image.pixels);
  const drawn = new Uint8Array(width * height);
  for (let i = 0; i < drawn.length; i++) drawn[i] = pixels[i * 4 + 3] ? 1 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (drawn[at]) continue;
      if (!((x > 0 && drawn[at - 1]) || (x < width - 1 && drawn[at + 1])
        || (y > 0 && drawn[at - width]) || (y < height - 1 && drawn[at + width]))) continue;
      pixels.fill(0, at * 4, at * 4 + 3); pixels[at * 4 + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/*
 * For a creature the client no longer draws as it did when it was cut: take the line off the file itself.
 * Every pixel of the art is a block of SS by SS of one colour, and the line was laid on blocks that were clear,
 * so a block that is not one colour was clear. A block that is solid black is left as art - it is either
 * black art or a gap one pixel wide that the line filled, and the two cannot be told apart.
 */
function unlined(image) {
  const { width, height } = image, pixels = Buffer.from(image.pixels);
  for (let by = 0; by < height; by += SS) {
    for (let bx = 0; bx < width; bx += SS) {
      const first = (by * width + bx) * 4;
      let uniform = true;
      for (let y = 0; y < SS && uniform; y++) for (let x = 0; x < SS; x++) {
        if (Buffer.compare(image.pixels.subarray(first, first + 4), image.pixels.subarray(((by + y) * width + bx + x) * 4, ((by + y) * width + bx + x) * 4 + 4))) { uniform = false; break; }
      }
      if (uniform) continue;
      for (let y = 0; y < SS; y++) for (let x = 0; x < SS; x++) pixels.fill(0, ((by + y) * width + bx + x) * 4, ((by + y) * width + bx + x) * 4 + 4);
    }
  }
  return { width, height, pixels };
}
const settle = pixels => { const b = Buffer.from(pixels); for (let i = 0; i < b.length; i += 4) if (!b[i + 3]) b.fill(0, i, i + 3); return b; };

const write = process.argv.includes('--write');
const arts = artOf();
let exact = 0;
const decoded = [], missing = [], redrawn = [];
let wrong = 0;        // pixels where taking the line off the file alone disagrees with the exact cut
for (const name of fs.readdirSync(LIFE).filter(n => /^c\d+\.png$/.test(n))) {
  const type = Number(name.slice(1, -4));
  const art = arts.get(type);
  const strip = art && cut(art);
  const on = readPng(fs.readFileSync(path.join(LIFE, name)));
  const taken = unlined(on);
  let bare = taken;
  if (strip) {
    const exactly = magnify(strip), check = lined(exactly);
    if (on.width === check.width && on.height === check.height && Buffer.compare(settle(on.pixels), settle(check.pixels)) === 0) {
      bare = exactly; exact++;
      for (let i = 0; i < taken.pixels.length; i += 4) {
        if (Buffer.compare(settle(taken.pixels.subarray(i, i + 4)), settle(exactly.pixels.subarray(i, i + 4)))) wrong++;
      }
    } else if (on.width === check.width && on.height === check.height) {
      // Same frames, other pixels: the client has redrawn it since. The new drawing is the one to show.
      bare = exactly; redrawn.push(name);
    } else decoded.push(name);
  } else { decoded.push(name); missing.push(name); }
  if (write) fs.writeFileSync(path.join(LIFE, name), writePng(bare.width, bare.height, bare.pixels));
}
console.log(exact + ' creatures cut again exactly as they were drawn' + (write ? ', and written without the line.' : '.'));
console.log('  (taking the line off the file alone would have been wrong on ' + wrong + ' pixels of those)');
if (redrawn.length) console.log(redrawn.length + ' the client has redrawn since they were cut, and are cut again' + (write ? ' and written' : '') + ': ' + redrawn.join(' '));
if (decoded.length) console.log(decoded.length + ' with other frames than the file has: the line was taken off the file itself' + (write ? ' and written' : '') + ': ' + decoded.join(' '));
