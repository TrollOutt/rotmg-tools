/*
 * The book on the Index card, cut out of the sheet it was drawn on.
 *
 * The illustration arrives as a contact sheet: twenty frames in two rows, each
 * numbered, with a LOOP arrow underneath. A browser cannot animate that, and
 * hand-cutting twenty frames is the sort of job that is wrong by one pixel
 * somewhere and nobody notices for a month. So the frames are found rather
 * than measured out.
 *
 *     node tools/index-art.js
 *
 * It reads data/GUI Files/Page Art/Index-sheet.png and writes Index.png beside
 * it: one row of twenty equal cells, which the card walks through with a
 * stepped animation.
 *
 *
 * How the frames are found.
 *
 * The sheet's background is transparent, so a pixel is part of the drawing if
 * it has any alpha at all. Rows that hold nothing separate the sheet into five
 * bands - frames, numbers, frames, numbers, the arrow - and only the two tall
 * ones are drawings; the numbers are twenty pixels high and the arrow forty.
 * Within a tall band, columns that hold nothing separate the frames.
 *
 *
 * How they are lined up.
 *
 * Not by their bounding boxes. The glow grows over the animation and shrinks
 * again, so a box drawn around the light is a different size in every frame
 * and lining those up would make the book itself jump about. The book sits on
 * the bottom of its own drawing and stays where it is, so each frame is placed
 * by the lowest pixel it has and by the middle of its widest row - which is
 * the book, not the halo above it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const ART = path.join(root, 'data', 'GUI Files', 'Page Art');
const FROM = path.join(ART, 'Index-sheet.png');
const TO = path.join(ART, 'Index.png');

if (!fs.existsSync(FROM)) {
  console.log('\n  No ' + path.relative(root, FROM) + ' to cut.');
  console.log('  Save the contact sheet there and run this again.\n');
  process.exit(0);
}

/* ---------------- just enough PNG ---------------- */
function readPng(buffer) {
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (buffer[24] !== 8 || buffer[25] !== 6) {
    throw new Error('the sheet has to be 8-bit RGBA; this one is depth '
      + buffer[24] + ' type ' + buffer[25]);
  }
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
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- finding the frames ---------------- */
const sheet = readPng(fs.readFileSync(FROM));
const { width: W, height: H, pixels: P } = sheet;
const drawn = (x, y) => P[(y * W + x) * 4 + 3] > 16;

const runsIn = (from, to, along) => {
  const out = [];
  let start = -1;
  for (let i = from; i <= to; i++) {
    if (along(i)) { if (start < 0) start = i; }
    else if (start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, to]);
  return out;
};

const rowHasInk = y => { for (let x = 0; x < W; x++) if (drawn(x, y)) return true; return false; };
/* The numbers under each frame are twenty pixels high and the arrow forty. */
const bands = runsIn(0, H - 1, rowHasInk).filter(([a, b]) => b - a > 100);
if (!bands.length) throw new Error('no rows of frames in the sheet');

let frames = [];
for (const [top, bottom] of bands) {
  const colHasInk = x => {
    for (let y = top; y <= bottom; y++) if (drawn(x, y)) return true;
    return false;
  };
  for (const [left, right] of runsIn(0, W - 1, colHasInk)) {
    /* Tightened to the drawing itself: the band is as tall as its tallest
       frame, and most frames do not reach the top of it. */
    let high = bottom, low = top;
    for (let y = top; y <= bottom; y++) {
      let any = false;
      for (let x = left; x <= right && !any; x++) if (drawn(x, y)) any = true;
      if (!any) continue;
      if (y < high) high = y;
      if (y > low) low = y;
    }
    /*
     * Where the book is, rather than where the light is. The widest row of a
     * frame is the open book across the middle of it; the glow above is
     * narrower and wanders, so the middle of that widest row holds still from
     * one frame to the next in a way a bounding box does not.
     */
    let widest = 0, middle = (left + right) / 2;
    for (let y = high; y <= low; y++) {
      let first = -1, last = -1;
      for (let x = left; x <= right; x++) {
        if (!drawn(x, y)) continue;
        if (first < 0) first = x;
        last = x;
      }
      if (first < 0 || last - first + 1 <= widest) continue;
      widest = last - first + 1;
      middle = (first + last) / 2;
    }
    frames.push({ left, right, top: high, bottom: low, middle, foot: low });
  }
}

/*
 * And only the part worth watching.
 *
 * The sheet draws the whole business: the book shut, opening, wide open with
 * the light coming and going, then closing again. On a card the size of a
 * thumbnail the opening reads as a flicker rather than as a book, so the strip
 * keeps the frames where it is already open and the light is breathing - here,
 * the tenth to the seventeenth. The card plays those forward and back, which
 * is what that stretch is: the glow rises to the fifth of them and settles.
 *
 * Frame numbers on the sheet, counted from one. Change them, or set KEEP to
 * null for the lot, if the drawing changes.
 */
const KEEP = [10, 17];
const drawnFrames = frames.length;
if (KEEP) frames = frames.slice(Math.max(0, KEEP[0] - 1), KEEP[1]);

/* ---------------- one strip, every cell the same ---------------- */
/*
 * Wide enough for the widest frame either side of its middle, tall enough for
 * the tallest above its foot, and a little air so the glow is not clipped by
 * the edge of a cell.
 */
const AIR = 2;
let leftRoom = 0, rightRoom = 0, headRoom = 0;
for (const one of frames) {
  leftRoom = Math.max(leftRoom, Math.ceil(one.middle - one.left));
  rightRoom = Math.max(rightRoom, Math.ceil(one.right - one.middle));
  headRoom = Math.max(headRoom, one.foot - one.top);
}
/*
 * A cell has to survive the shrink as a whole number of pixels.
 *
 * Two hundred and thirty-three halved is a hundred and sixteen and a half, so
 * the strip came out ten pixels wider than twenty cells and every cell after
 * the first sat half a pixel further along than the box showing it. On the
 * card that read as a strip sliding past rather than a book turning its pages,
 * with two books in frame at once. So the shrink is chosen first and the cell
 * is rounded up to fit it exactly.
 */
const SHRINK = Math.max(1, Math.round((headRoom + 1 + AIR * 2) / 124));
const whole = n => Math.ceil(n / SHRINK) * SHRINK;
/*
 * And square, because the card's picture is. A cell a little taller than it is
 * wide has to be either stretched to fill a square box or scaled to fit and
 * clipped at the top, and the top is where the glow is. Squaring it here costs
 * a few transparent pixels and saves the page from knowing the shape.
 */
const side = whole(Math.max(leftRoom + rightRoom + 1, headRoom + 1) + AIR * 2);
const cellW = side;
const cellH = side;
const stripW = cellW * frames.length;
const strip = Buffer.alloc(stripW * cellH * 4);

frames.forEach((one, at) => {
  /* Centred in its cell, whatever rounding the cell picked up. */
  const originX = at * cellW + Math.round((cellW - leftRoom - rightRoom - 1) / 2)
    + leftRoom - Math.round(one.middle);
  const originY = cellH - AIR - 1 - (one.foot - one.top) - one.top;
  for (let y = one.top; y <= one.bottom; y++) {
    for (let x = one.left; x <= one.right; x++) {
      const alpha = P[(y * W + x) * 4 + 3];
      if (!alpha) continue;
      const to = ((originY + y) * stripW + originX + x) * 4;
      if (to < 0 || to + 3 >= strip.length) continue;
      P.copy(strip, to, (y * W + x) * 4, (y * W + x) * 4 + 4);
    }
  }
});

/*
 * And down to the size it is actually drawn at.
 *
 * The card shows this at about a hundred and sixteen pixels across; the sheet
 * draws it at two hundred and thirty-three, which is a megabyte of picture
 * nobody can see the detail of, carried by every visitor and baked into the
 * file you download to keep. The glow is smoothed rather than blocky, so this
 * is a plain average of each block - no sharpening a drawing that was never
 * sharp.
 */
function smaller(width, height, rgba, by) {
  if (by < 2) return { width, height, rgba };
  const w = Math.floor(width / by), h = Math.floor(height / by);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < by; dy++) {
        for (let dx = 0; dx < by; dx++) {
          const i = ((y * by + dy) * width + x * by + dx) * 4;
          const alpha = rgba[i + 3];
          /* Colour weighted by how much of it there is, or the clear pixels
             drag every edge towards black. */
          r += rgba[i] * alpha; g += rgba[i + 1] * alpha; b += rgba[i + 2] * alpha;
          a += alpha;
        }
      }
      const to = (y * w + x) * 4;
      out[to] = a ? Math.round(r / a) : 0;
      out[to + 1] = a ? Math.round(g / a) : 0;
      out[to + 2] = a ? Math.round(b / a) : 0;
      out[to + 3] = Math.round(a / (by * by));
    }
  }
  return { width: w, height: h, rgba: out };
}
const small = smaller(stripW, cellH, strip, SHRINK);

fs.writeFileSync(TO, writePng(small.width, small.height, small.rgba));
console.log('\n  ' + frames.length + ' of the sheet\u2019s ' + drawnFrames
  + ' frames' + (KEEP ? ' (' + KEEP[0] + ' to ' + KEEP[1] + ')' : '')
  + ', ' + cellW + 'x' + cellH + ' each, shrunk by ' + SHRINK);
console.log('  -> ' + path.relative(root, TO) + '  ' + small.width + 'x' + small.height
  + '  (' + (fs.statSync(TO).size / 1024).toFixed(0) + ' KB)');
console.log('  one cell is ' + Math.floor(cellW / SHRINK) + 'x'
  + Math.floor(cellH / SHRINK) + '\n');