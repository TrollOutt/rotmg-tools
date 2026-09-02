'use strict';
/*
 * A finer, blacker line round everything that stands up.
 *
 *   node tools/refine-outline.js
 *
 * The line is baked into the art, not drawn by the page: one pixel of it laid
 * round every silhouette in things.png and in each creature's own file,
 * coloured from whatever it happened to touch and let through at three
 * eighths opacity. Close in, where a tile is forty screen pixels and a sprite
 * pixel is five of them, that is a five pixel band of soft grey-brown, and
 * the scenery ends up wearing a halo rather than an outline.
 *
 * A pixel is as thin as a pixel gets, so the line cannot be narrowed where it
 * lies. What can be narrowed is the pixel. The art is redrawn at twice the
 * size - nearest neighbour, so not one colour is invented and nothing goes
 * soft - and the line is laid round it one pixel wide at that size, which is
 * half a pixel at the size the art is actually drawn. Then it is inked flat
 * black at full opacity rather than a faint tint of its neighbour.
 *
 * Everything measured in sheet pixels doubles with the sheet: the rectangles
 * in things.json, the frame sizes each creature carries in atlas.json, and
 * the pixel of foot every sprite was lifted by to stand back down on its own
 * tile. The page divides by the same factor when it draws, so nothing changes
 * size on screen. Only the line does.
 *
 * The ground is untouched. A.px stays eight, because the floor chunks are
 * still eight pixels to a tile; the factor added here belongs to the sprite
 * sheets alone, and only they are divided by it.
 *
 * Once the line is black it cannot be told from black art, so this runs once.
 * To lay it down again at another thickness, put the atlas back first:
 *
 *   git checkout -- web/assets/atlas && node tools/refine-outline.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const ATLAS = path.join(root, 'web', 'assets', 'atlas');

// How many sheet pixels to one pixel of the original art. The line is always
// one sheet pixel, so this is what divides its thickness: 2 halves it, 3
// thirds it. Every step costs the square of itself in sheet area.
const SS = 2;

// The line itself. Flat black, all of it - it is meant to read as an edge the
// game drew, not as a shadow the art cast.
const INK = [0, 0, 0];
const INK_ALPHA = 255;

// What the baked line was let through at. Nothing else in either sheet uses
// this exact alpha, which is what makes the old line findable at all.
const OLD_ALPHA = 96;

/* ---------------- PNG ---------------- */
function readPng(buffer) {
  if (buffer[24] !== 8 || buffer[25] !== 6 || buffer[28] !== 0) {
    throw new Error('expected 8-bit RGBA, not interlaced');
  }
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
/*
 * Written with each row filtered against the pixel to its left. Magnified
 * pixel art is long runs of one colour, and a difference along a run is a
 * run of zeroes, which is what keeps a sheet four times the area from being
 * four times the file.
 */
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

/* ---------------- the three passes ---------------- */
/*
 * Take the old line off. It is the only thing in either sheet at that alpha,
 * and every pixel of it was checked to be touching real art before this was
 * written, so there is nothing else it can be taking with it.
 */
function strip(image) {
  const { pixels } = image;
  let gone = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] !== OLD_ALPHA) continue;
    pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 0;
    gone++;
  }
  return gone;
}

// Every pixel becomes a block of k by k of itself. Nothing is blended, so the
// art is the same art, held at a finer grain.
function magnify(image, k) {
  const width = image.width * k, height = image.height * k;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y / k) | 0) * image.width * 4;
    const to = y * width * 4;
    for (let x = 0; x < width; x++) {
      const at = from + ((x / k) | 0) * 4;
      image.pixels.copy(pixels, to + x * 4, at, at + 4);
    }
  }
  return { width, height, pixels };
}

/*
 * Lay the line: every clear pixel sharing a side with a drawn one.
 *
 * Sides only, not corners. The line it replaces was the same - of a hundred
 * and twelve thousand pixels of it in things.png, forty-five were corners -
 * and a corner pixel is the one that makes an outline look bitten on rather
 * than drawn.
 */
function outline(image) {
  const { width, height, pixels } = image;
  const drawn = new Uint8Array(width * height);
  for (let i = 0; i < drawn.length; i++) drawn[i] = pixels[i * 4 + 3] ? 1 : 0;
  let laid = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (drawn[at]) continue;
      if (!((x > 0 && drawn[at - 1]) || (x < width - 1 && drawn[at + 1])
        || (y > 0 && drawn[at - width]) || (y < height - 1 && drawn[at + width]))) continue;
      const to = at * 4;
      pixels[to] = INK[0]; pixels[to + 1] = INK[1]; pixels[to + 2] = INK[2];
      pixels[to + 3] = INK_ALPHA;
      laid++;
    }
  }
  return laid;
}

// Strip, magnify, line. Kept separate below for things.png, which has to be
// looked over between the first pass and the second.
function relined(image) {
  const gone = strip(image);
  const big = magnify(image, SS);
  const laid = outline(big);
  return { image: big, gone, laid };
}

/* ---------------- what the sheets are measured in ---------------- */
/*
 * A pic is [x, y, width, height, size, rise, foot, frames, run]. The first
 * four are where it sits in the sheet and the seventh is the pixel it was
 * lifted by; all five are sheet pixels, and all five double. Size is a
 * percentage, rise is hundredths of a tile, and frames and run are counts -
 * none of those knows how big a sheet pixel is.
 */
const SHEET_FIELDS = [0, 1, 2, 3, 6];

/*
 * Once the old line is off, no sprite may be touching the edge of its own
 * cell. Run it before the line is stripped and every sprite fails, because
 * the line is exactly what sits on that border.
 *
 * The old line took a pixel all round, so a cell holds its art inset by one,
 * and two neighbouring sprites have two clear pixels between them. Magnified
 * that is four, and a one pixel line each side leaves two spare - which is
 * why laying the line across the whole sheet at once cannot let one sprite's
 * edge bleed into the next one's cell. If a sprite did reach its own border
 * that reasoning is void, so it is checked rather than assumed.
 */
function checkCells(image, pics) {
  const { width, pixels } = image;
  const opaque = (x, y) => pixels[(y * width + x) * 4 + 3] !== 0;
  const bad = [];
  pics.forEach((pic, id) => {
    if (!pic) return;
    const [sx, sy, w, h] = pic;
    for (let frame = 0; frame < (pic[7] || 1); frame++) {
      const x0 = sx + frame * w;
      for (let x = x0; x < x0 + w; x++) {
        if (opaque(x, sy) || opaque(x, sy + h - 1)) { bad.push(id); return; }
      }
      for (let y = sy; y < sy + h; y++) {
        if (opaque(x0, y) || opaque(x0 + w - 1, y)) { bad.push(id); return; }
      }
    }
  });
  return bad;
}

/* ---------------- run ---------------- */
const readJson = file => JSON.parse(fs.readFileSync(path.join(ATLAS, file), 'utf8'));
// atlas.json is written a space to the level with Windows line endings, and
// things.json all on one line. Both are left exactly as they were found.
const writeAtlasJson = value => fs.writeFileSync(path.join(ATLAS, 'atlas.json'),
  JSON.stringify(value, null, 1).replace(/\n/g, '\r\n') + '\r\n');
const writeThingsJson = value => fs.writeFileSync(path.join(ATLAS, 'things.json'),
  JSON.stringify(value));

const things = readJson('things.json');
const atlas = readJson('atlas.json');

if (things.ss || atlas.ss) {
  console.log('The line has already been redrawn, at ' + (things.ss || atlas.ss)
    + ' sheet pixels to the pixel. Black art and a black line cannot be told'
    + ' apart, so this will not run twice.\n\n'
    + '  git checkout -- web/assets/atlas && node tools/refine-outline.js\n');
  process.exit(1);
}

console.log('A line one pixel wide at ' + SS + ' sheet pixels to the pixel, inked '
  + 'rgba(' + INK.join(', ') + ', ' + INK_ALPHA + ').\n');

/* The scenery. */
const thingsFile = path.join(ATLAS, 'things.png');
const sheet = readPng(fs.readFileSync(thingsFile));
const wasThings = fs.statSync(thingsFile).size;
const wide = sheet.width, tall = sheet.height;

const gone = strip(sheet);
const bad = checkCells(sheet, things.pics);
if (bad.length) {
  console.error('  ' + bad.length + ' sprites reach the border of their own cell ('
    + bad.slice(0, 8).join(', ') + '). Laying one line across the whole sheet would'
    + ' bleed between them. Nothing written.');
  process.exit(1);
}
const big = magnify(sheet, SS);
const laid = outline(big);
fs.writeFileSync(thingsFile, writePng(big.width, big.height, big.pixels));
console.log('  things.png  ' + wide + 'x' + tall + ' -> ' + big.width + 'x' + big.height
  + ', ' + gone + ' pixels of the old line off and ' + laid + ' of the new one on, '
  + Math.round(wasThings / 1024) + 'K -> '
  + Math.round(fs.statSync(thingsFile).size / 1024) + 'K');

for (const pic of things.pics) {
  if (!pic) continue;
  for (const field of SHEET_FIELDS) if (pic[field]) pic[field] *= SS;
}
things.sheet = [big.width, big.height];
things.px *= SS;
things.ss = SS;
writeThingsJson(things);
console.log('  things.json every rectangle, and the pixel of foot, doubled');

/* The creatures. */
const lifeDir = path.join(ATLAS, 'life');
let files = 0, lifeGone = 0, lifeLaid = 0, wasLife = 0, isLife = 0;
for (const name of fs.readdirSync(lifeDir).filter(n => n.endsWith('.png'))) {
  const file = path.join(lifeDir, name);
  wasLife += fs.statSync(file).size;
  const out = relined(readPng(fs.readFileSync(file)));
  fs.writeFileSync(file, writePng(out.image.width, out.image.height, out.image.pixels));
  isLife += fs.statSync(file).size;
  files++; lifeGone += out.gone; lifeLaid += out.laid;
}
console.log('  life/       ' + files + ' creatures, ' + lifeGone + ' pixels of the old line'
  + ' off and ' + lifeLaid + ' of the new one on, ' + Math.round(wasLife / 1024) + 'K -> '
  + Math.round(isLife / 1024) + 'K');

/*
 * And the frame sizes. The same creature is listed under every zone and biome
 * it is found in, and again under any beacon it guards, so a sprite is
 * reached many times over; each listing carries its own copy of the numbers,
 * and each copy is doubled.
 */
let sprites = 0;
for (const owners of [atlas.zones, atlas.biomes]) {
  for (const owner of owners || []) {
    for (const one of owner.lives || []) {
      if (!one.sprite) continue;
      one.sprite.tile *= SS; one.sprite.height *= SS; sprites++;
    }
  }
}
for (const beacon of atlas.beacons || []) {
  for (const guard of beacon.guards || []) {
    if (!guard.sprite) continue;
    guard.sprite.tile *= SS; guard.sprite.height *= SS; sprites++;
  }
}
atlas.ss = SS;
writeAtlasJson(atlas);
console.log('  atlas.json  ' + sprites + ' frame sizes doubled');

/*
 * The page carries its own copy of atlas.json on one line, so that opening it
 * by itself needs nothing fetched. It is the same object, so it is replaced
 * from the one just written rather than edited.
 */
const pageFile = path.join(ATLAS, 'index.html');
const page = fs.readFileSync(pageFile, 'utf8');
const inlined = /^const A = (\{.*\});$/m;
if (!inlined.test(page)) {
  console.error('  index.html no longer carries "const A = {...};" on a line of its own.'
    + ' The page has not been touched, and is now out of step with atlas.json.');
  process.exit(1);
}
fs.writeFileSync(pageFile, page.replace(inlined, () => 'const A = ' + JSON.stringify(atlas) + ';'));
console.log('  index.html  the inlined copy replaced');
