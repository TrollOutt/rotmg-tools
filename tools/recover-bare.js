'use strict';
/*
 * The Realm Atlas's scenery and combat pictures, as the client drew them: no line round them.
 *
 *   node tools/recover-bare.js            compare, and say how many cells would come out identical
 *   node tools/recover-bare.js --write    put the bare drawings in web/assets/atlas (things.png and combat/)
 *
 * The line round the scenery was laid in the sheet by tools/refine-outline.js
 * (half a sprite pixel, flat black), and round the combat pictures by the
 * laboratory that supplied them (a whole pixel): it has one thickness at every
 * zoom and cannot be told from black art. The page lays the line itself now, at
 * the width every other page uses (web/outline.js), so the pictures have to be
 * the art alone. The creatures' own files were cut bare by tools/recover-life.js.
 *
 * Nothing can be told by looking at the sheet, so each picture is found in the
 * client: the pixels of a cell that are one colour over their whole block and
 * are not flat black are the art's own, and name the sprite they were cut from
 * (no ring is ever any other colour than black). The sprite found is laid back
 * in its place, doubled the way refine-outline.js doubled it, and the line is
 * laid on it once more; only if that is the cell on disk, pixel for pixel, is
 * the bare one written. A picture the client cannot account for keeps what it
 * has, and is marked as one that already carries its line, which the page then
 * does not draw again: the tenth number of its entry in things.json, or its
 * name in `carriesLine` in combat.json.
 */
const fs = require('fs');
const path = require('path');
const { readPng, writePng } = require('./png');
const registry = require('./spritesheet');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const ATLAS = path.join(root, 'web', 'assets', 'atlas');

const blob = registry.read(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const sheets = {};
const sheet = name => sheets[name] || (sheets[name] = readPng(fs.readFileSync(path.join(XML, 'textures', name + '.png'))));
const at = (img, x, y) => (y * img.width + x) * 4;

/* What of a picture is certainly the art's own: pixels with colour, other than the line's flat black. */
const evidence = (r, g, b, a) => a > 0 && a !== 96 && !(r === 0 && g === 0 && b === 0 && a === 255);
const keyOf = list => {
  if (!list.length) return null;
  let mx = 1e9, my = 1e9;
  for (const p of list) { mx = Math.min(mx, p[0]); my = Math.min(my, p[1]); }
  return list.map(p => (p[0] - mx) + ',' + (p[1] - my) + ',' + p[2] + ',' + p[3] + ',' + p[4] + ',' + p[5]).sort().join(';');
};
const bounds = list => { let mx = 1e9, my = 1e9; for (const p of list) { mx = Math.min(mx, p[0]); my = Math.min(my, p[1]); } return [mx, my]; };

/* Every sprite the client has, by what of it is certainly art. */
const seen = new Set();
const index = new Map();
function addCandidate(rect, name) {
  if (!name || !rect.w || !rect.h) return;
  const key = name + ':' + rect.x + ',' + rect.y + ',' + rect.w + ',' + rect.h;
  if (seen.has(key)) return;
  seen.add(key);
  const img = sheet(name);
  if (rect.x + rect.w > img.width || rect.y + rect.h > img.height) return;
  const list = [];
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = at(img, rect.x + x, rect.y + y), p = img.pixels;
      if (evidence(p[i], p[i + 1], p[i + 2], p[i + 3])) list.push([x, y, p[i], p[i + 1], p[i + 2], p[i + 3]]);
    }
  }
  const k = keyOf(list);
  if (!k) return;
  const mine = { name, ...rect, origin: bounds(list) };
  (index.get(k) || index.set(k, []).get(k)).push(mine);
}
for (const a of blob.still) for (const s of a.sprites) addCandidate(s.rect, s.sheet);
for (const f of blob.animated) addCandidate(f.rect, f.sheet);

/* The line refine-outline.js laid on a doubled cell: clear pixels that share a side with a drawn one, flat black. */
function lined(cell) {
  const { width, height } = cell, out = Buffer.from(cell.pixels);
  const drawn = i => cell.pixels[i * 4 + 3] !== 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (drawn(i)) continue;
      if (!((x > 0 && drawn(i - 1)) || (x < width - 1 && drawn(i + 1)) || (y > 0 && drawn(i - width)) || (y < height - 1 && drawn(i + width)))) continue;
      out.fill(0, i * 4, i * 4 + 3); out[i * 4 + 3] = 255;
    }
  }
  return { width, height, pixels: out };
}
const settled = pixels => { const b = Buffer.from(pixels); for (let i = 0; i < b.length; i += 4) if (!b[i + 3]) b.fill(0, i, i + 3); return b; };

/* One cell of the sheet on disk (w by h sheet pixels at x, y), found in the client; the bare cell, or null. */
function bareCell(X, x0, y0, w, h, SS) {
  const cw = w / SS, ch = h / SS, list = [];
  for (let by = 0; by < ch; by++) {
    for (let bx = 0; bx < cw; bx++) {
      const a = at(X, x0 + bx * SS, y0 + by * SS), p = X.pixels;
      let same = true;
      for (let dy = 0; dy < SS && same; dy++) for (let dx = 0; dx < SS; dx++) {
        const b = at(X, x0 + bx * SS + dx, y0 + by * SS + dy);
        if (p[b] !== p[a] || p[b + 1] !== p[a + 1] || p[b + 2] !== p[a + 2] || p[b + 3] !== p[a + 3]) { same = false; break; }
      }
      if (same && evidence(p[a], p[a + 1], p[a + 2], p[a + 3])) list.push([bx, by, p[a], p[a + 1], p[a + 2], p[a + 3]]);
    }
  }
  const k = keyOf(list);
  const found = k && index.get(k);
  if (!found) return null;
  const [ex, ey] = bounds(list);
  for (const c of found) {
    const sprite = sheet(c.name);
    // The sprite goes where its own art begins, which is where the cell's art begins.
    const ox = ex - c.origin[0], oy = ey - c.origin[1];
    const bare = { width: w, height: h, pixels: Buffer.alloc(w * h * 4) };
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const cx = ox + x, cy = oy + y;
        if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
        const from = at(sprite, c.x + x, c.y + y);
        if (!sprite.pixels[from + 3] || sprite.pixels[from + 3] === 96) continue;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
          sprite.pixels.copy(bare.pixels, ((cy * SS + dy) * w + cx * SS + dx) * 4, from, from + 4);
        }
      }
    }
    // Only the cell the client accounts for completely is taken.
    const check = lined(bare);
    let same = true;
    const have = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) X.pixels.copy(have, y * w * 4, at(X, x0, y0 + y), at(X, x0, y0 + y) + w * 4);
    if (Buffer.compare(settled(have), settled(check.pixels)) !== 0) same = false;
    if (same) return bare;
  }
  return null;
}

const write = process.argv.includes('--write');

/* ---------------- the scenery: things.png, two sheet pixels to a pixel of art ---------------- */
const things = JSON.parse(fs.readFileSync(path.join(ATLAS, 'things.json'), 'utf8'));
if (things.bare) {
  console.log('things.png has already been cut bare. Rebuild the atlas and run tools/refine-outline.js first if it is to be done again.');
} else {
  const file = path.join(ATLAS, 'things.png');
  const X = readPng(fs.readFileSync(file));
  const out = { width: X.width, height: X.height, pixels: Buffer.from(X.pixels) };
  let cells = 0, found = 0;
  const kept = [];
  things.pics.forEach((pic, n) => {
    if (!pic) return;
    const [sx, sy, w, h] = pic;
    const frames = pic[7] || 1;
    const got = [];
    for (let f = 0; f < frames; f++) {
      cells++;
      const cell = bareCell(X, sx + f * w, sy, w, h, 2);
      if (cell) { found++; got.push([sx + f * w, cell]); }
    }
    // A picture is taken bare only if every frame of it is: half of one would be drawn with two lines.
    if (got.length === frames) {
      for (const [x0, cell] of got) for (let y = 0; y < h; y++) cell.pixels.copy(out.pixels, at(out, x0, sy + y), y * w * 4, y * w * 4 + w * 4);
      pic.length = Math.min(pic.length, 9);
    } else { kept.push(n); pic[9] = 1; }
  });
  console.log('things.png: ' + cells + ' cells in ' + things.pics.length + ' pictures; ' + found + ' found in the client exactly as they were drawn.');
  console.log('  ' + kept.length + ' pictures keep the line they carry: ' + kept.slice(0, 40).join(' ') + (kept.length > 40 ? ' …' : ''));
  if (write) {
    fs.writeFileSync(file, writePng(out.width, out.height, out.pixels));
    things.bare = true;
    fs.writeFileSync(path.join(ATLAS, 'things.json'), JSON.stringify(things));
    console.log('  written without the line.');
  }
}

/* ---------------- the combat pictures: one sheet pixel to a pixel of art ---------------- */
const combatFile = path.join(ATLAS, 'combat.json');
const combat = JSON.parse(fs.readFileSync(combatFile, 'utf8'));
if (combat.bare) {
  console.log('combat/ has already been cut bare.');
} else {
  // Every picture the laboratory's file names, with the size of one cell of it.
  const named = new Map();
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (typeof o.file === 'string' && o.width && o.height) named.set(o.file, { w: o.width, h: o.height, frames: o.frames || 1 });
    for (const v of Object.values(o)) walk(v);
  })(combat);
  const dir = path.join(ATLAS, 'combat');
  let cells = 0, found = 0;
  const carries = [], todo = [];
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.png'))) {
    const X = readPng(fs.readFileSync(path.join(dir, name)));
    const one = named.get(name);
    const w = one ? one.w : X.width, h = one ? one.h : X.height;
    const frames = one ? Math.round(X.width / w) : 1;
    if (!one || w * frames !== X.width || h !== X.height) { carries.push(name); continue; }
    const out = { width: X.width, height: X.height, pixels: Buffer.from(X.pixels) };
    let all = true;
    const got = [];
    for (let f = 0; f < frames; f++) {
      cells++;
      const cell = bareCell(X, f * w, 0, w, h, 1);
      if (cell) { found++; got.push([f * w, cell]); } else all = false;
    }
    if (!all) { carries.push(name); continue; }
    for (const [x0, cell] of got) for (let y = 0; y < h; y++) cell.pixels.copy(out.pixels, at(out, x0, y), y * w * 4, y * w * 4 + w * 4);
    todo.push([name, out]);
  }
  console.log('combat/: ' + cells + ' cells; ' + found + ' found in the client exactly as they were drawn.');
  console.log('  ' + todo.length + ' pictures cut bare, ' + carries.length + ' keep the line they carry.');
  if (write) {
    for (const [name, out] of todo) fs.writeFileSync(path.join(dir, name), writePng(out.width, out.height, out.pixels));
    combat.carriesLine = carries.sort();
    combat.bare = true;
    fs.writeFileSync(combatFile, JSON.stringify(combat) + '\n');
    console.log('  written.');
  }
}
