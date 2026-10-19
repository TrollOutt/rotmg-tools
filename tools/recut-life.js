'use strict';
/*
 * The creatures of the Realm Atlas, cut again the right way round.
 *
 *   node tools/recut-life.js [--client <client-data folder>]           say what would change
 *   node tools/recut-life.js [--client <client-data folder>] --write   write it
 *
 * The strips in web/assets/atlas/life were cut when the atlas builder still
 * read a sprite's last two numbers as width then height (see
 * tools/spritesheet.js). Square frames came out right and nobody saw it. A
 * frame wider than it is tall did not: a creature's second attack frame is
 * twice the width of its body, because the claw or the blade reaches out of
 * it, and cut as a column twice as tall as it is wide it lost the reach and
 * took the empty sheet below instead. In the atlas the body vanished on that
 * frame and the end of the swing floated over the creature's head.
 *
 * So every strip is cut once more from the client, width as width, and laid
 * out as the builder lays it - every pose on one strip, facing by facing and
 * action by action, a pixel of room round each frame, standing on the bottom
 * - with one difference: a frame keeps the body on its left and the reach to
 * the right of it, as the client draws it, rather than being centred in the
 * strip's widest frame. How wide the body is goes into atlas.json as `body`,
 * and the page stands that, not the middle of the frame, on the spot.
 *
 * The strips are doubled and left bare, as tools/refine-outline.js and
 * tools/recover-life.js left them; the page draws the line itself. A strip is
 * only replaced when the client gives it the same poses the atlas already
 * has, with the same frames in each - except an attack, which may get back
 * the frame the old cut lost - so no creature changes what it does, only how
 * it looks while it does it.
 */
const fs = require('fs');
const path = require('path');
const { readPng, writePng } = require('./png');
const registry = require('./spritesheet');

const root = path.join(__dirname, '..');
const at = process.argv.indexOf('--client');
const XML = at > 0 ? path.resolve(process.argv[at + 1]) : path.join(root, 'client-data');
const ATLAS = path.join(root, 'web', 'assets', 'atlas');
const LIFE = path.join(ATLAS, 'life');
const SS = 2;        // sheet pixels to a pixel of art, as refine-outline.js doubled it
const PAD = 1;       // the pixel of room round every frame
const write = process.argv.includes('--write');

if (!fs.existsSync(path.join(XML, 'spritesheet.bin'))) {
  console.error('No client at ' + XML + ' - pass --client <client-data folder>.');
  process.exit(1);
}

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

const blob = registry.read(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const moving = new Map();
for (const f of blob.animated) {
  const key = f.atlas + '#' + f.index;
  if (!f.sheet || !f.rect.w || !f.rect.h) continue;
  (moving.get(key) || moving.set(key, []).get(key)).push({ facing: f.direction, doing: f.action,
    x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h, sheet: f.sheet });
}
const still = new Map();
for (const atlas of blob.still) {
  const rects = new Map();
  for (const one of atlas.sprites) if (!rects.has(one.index)) rects.set(one.index, { x: one.rect.x, y: one.rect.y, w: one.rect.w, h: one.rect.h, sheet: one.sheet });
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

/* One creature's strip, the right way round, its poses numbered as the builder numbers them. */
function cut(art) {
  const list = moving.get(art.atlas + '#' + art.index);
  let rects = null, poses = null;
  if (list && list.length) {
    rects = list.slice().sort((a, b) => (a.facing - b.facing) || (a.doing - b.doing));
    poses = {};
    rects.forEach((r, slot) => { (poses[r.facing + '/' + r.doing] || (poses[r.facing + '/' + r.doing] = [])).push(slot); });
  } else {
    const one = (still.get(art.atlas) || new Map()).get(art.index);
    if (one) rects = [one];
  }
  if (!rects) return null;
  const usable = rects.filter(r => {
    const sheet = r.sheet && sheetFor(r.sheet);
    return sheet && r.w && r.h && r.x + r.w <= sheet.width && r.y + r.h <= sheet.height;
  });
  if (!usable.length) return null;
  const w = Math.max(...usable.map(r => r.w)) + PAD * 2;
  const h = Math.max(...usable.map(r => r.h)) + PAD * 2;
  const body = Math.min(...usable.map(r => r.w)) + PAD * 2;
  const stride = w * usable.length;
  const strip = Buffer.alloc(stride * h * 4);
  usable.forEach((r, slot) => {
    const sheet = sheetFor(r.sheet);
    const ox = slot * w + PAD, oy = h - PAD - r.h;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const from = ((r.y + y) * sheet.width + r.x + x) * 4;
        sheet.pixels.copy(strip, ((y + oy) * stride + ox + x) * 4, from, from + 4);
      }
    }
  });
  for (let i = 0; i < strip.length; i += 4) if (!strip[i + 3]) strip.fill(0, i, i + 3);
  let numbered = null;
  if (poses) {
    const kept = new Map();
    usable.forEach((r, slot) => kept.set(rects.indexOf(r), slot));
    numbered = {};
    for (const key of Object.keys(poses)) {
      const out = poses[key].map(i => kept.get(i)).filter(i => i !== undefined);
      if (out.length) numbered[key] = out;
    }
    if (Object.keys(numbered).length <= 1) numbered = null;
  }
  return { image: { width: stride, height: h, pixels: strip }, tile: w, height: h, body, frames: usable.length, poses: numbered };
}

/* Every pixel a block of SS by SS of itself; nothing is blended. */
function magnify(image) {
  const width = image.width * SS, height = image.height * SS;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y / SS) | 0) * image.width * 4;
    for (let x = 0; x < width; x++) image.pixels.copy(pixels, (y * width + x) * 4, from + ((x / SS) | 0) * 4, from + ((x / SS) | 0) * 4 + 4);
  }
  return { width, height, pixels };
}

/* Every sprite record in atlas.json that names a creature's strip. */
const atlasFile = path.join(ATLAS, 'atlas.json');
const atlasText = fs.readFileSync(atlasFile, 'utf8');
const atlas = JSON.parse(atlasText);
const records = new Map();
(function walk(o) {
  if (!o || typeof o !== 'object') return;
  if (typeof o.file === 'string' && /^c\d+\.png$/.test(o.file) && Number.isFinite(o.tile)) {
    (records.get(o.file) || records.set(o.file, []).get(o.file)).push(o);
  }
  for (const k of Object.keys(o)) walk(o[k]);
})(atlas);

const arts = artOf();
const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
/*
 * The one difference the old cut is allowed to have: the frames of an attack.
 * Turned the wrong way round, the wide one ran off the edge of its sheet and
 * was dropped, so a creature whose attack had two frames had one. Every other
 * pose must have as many frames as before.
 */
const onlyAttacksGrew = (before, after) => {
  if (!before || !after) return false;
  const keys = Object.keys(after);
  if (keys.length !== Object.keys(before).length || !keys.every(k => before[k])) return false;
  return keys.every(k => k.endsWith('/2')
    ? after[k].length >= before[k].length : after[k].length === before[k].length);
};
let recut = 0, unchanged = 0;
const skipped = [];
for (const name of fs.readdirSync(LIFE).filter(n => /^c\d+\.png$/.test(n)).sort()) {
  const type = Number(name.slice(1, -4));
  const owners = records.get(name) || [];
  const art = arts.get(type);
  const made = art && cut(art);
  if (!made) { skipped.push(name + ' (not in the client)'); continue; }
  const was = owners[0];
  if (was && !same(was.poses, made.poses) && !onlyAttacksGrew(was.poses, made.poses)) {
    skipped.push(name + ' (the client has other frames now: ' + was.frames + ' ' + JSON.stringify(was.poses) + ' -> ' + made.frames + ' ' + JSON.stringify(made.poses) + ')'); continue;
  }
  const big = magnify(made.image);
  const old = readPng(fs.readFileSync(path.join(LIFE, name)));
  const tile = made.tile * SS, height = made.height * SS, body = made.body * SS;
  if (old.width === big.width && old.height === big.height && Buffer.compare(old.pixels, big.pixels) === 0
    && owners.every(o => o.tile === tile && o.height === height && (o.body || o.tile) === body)) { unchanged++; continue; }
  recut++;
  if (!write) continue;
  fs.writeFileSync(path.join(LIFE, name), writePng(big.width, big.height, big.pixels));
  for (const o of owners) {
    o.tile = tile; o.height = height; o.frames = made.frames;
    if (made.poses) o.poses = made.poses;
    if (body !== tile) o.body = body; else delete o.body;
  }
}
if (write && recut) {
  const crlf = /\r\n/.test(atlasText);
  const text = JSON.stringify(atlas, null, 1) + '\n';
  fs.writeFileSync(atlasFile, crlf ? text.replace(/\n/g, '\r\n') : text);
}
console.log(recut + ' creatures cut again the right way round' + (write ? ' and written' : '') + ', '
  + unchanged + ' already right.');
if (skipped.length) console.log(skipped.length + ' left as they are: ' + skipped.join(', '));
if (!write && recut) console.log('Nothing written: add --write, then node tools/realm-atlas-build.js --publish --page-only.');
