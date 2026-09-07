/*
 * The icon on the browser tab, from one picture.
 *
 * A tab icon is drawn at sixteen or thirty-two pixels and nowhere else, so
 * handing the page a thousand-pixel picture would put most of a megabyte into
 * every copy of it - the offline build carries its icon inline - to draw
 * something the size of a full stop. This takes whatever picture is given and
 * reduces it once, properly: a box filter over the block of source pixels
 * that lands under each icon pixel, which is what the eye would have done
 * anyway and keeps the colours honest rather than sampling one pixel in
 * sixteen and hoping.
 *
 *     node tools/tab-icon.js <picture.png>
 *
 * It writes data/appicon.png, which the build inlines.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'data', 'appicon.png');
const SIDE = 64;                         // enough for a retina tab, still tiny

/* ---------------- just enough PNG ---------------- */
function readPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  const depth = buffer[24], kind = buffer[25];
  if (depth !== 8 || (kind !== 6 && kind !== 2)) {
    throw new Error('wants an 8-bit RGB or RGBA png, not colour type ' + kind);
  }
  const wide = kind === 6 ? 4 : 3;
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
  const stride = width * wide;
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= wide ? rows[y * stride + x - wide] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const c = x >= wide && y > 0 ? rows[(y - 1) * stride + x - wide] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      rows[y * stride + x] = value & 0xff;
    }
  }
  // Everything downstream wants four channels.
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    pixels[i * 4] = rows[i * wide];
    pixels[i * 4 + 1] = rows[i * wide + 1];
    pixels[i * 4 + 2] = rows[i * wide + 2];
    pixels[i * 4 + 3] = wide === 4 ? rows[i * wide + 3] : 255;
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

/* ---------------- the reduction ---------------- */
function shrink(image, side) {
  const out = Buffer.alloc(side * side * 4);
  /*
   * Square, whatever shape it came in. A tab icon that is not square is
   * squashed into one by the browser, so the crop is taken here where it can
   * be taken from the middle rather than from the top left.
   */
  const cut = Math.min(image.width, image.height);
  const left = (image.width - cut) >> 1;
  const top = (image.height - cut) >> 1;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const x0 = left + Math.floor(x * cut / side);
      const x1 = left + Math.floor((x + 1) * cut / side);
      const y0 = top + Math.floor(y * cut / side);
      const y1 = top + Math.floor((y + 1) * cut / side);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < Math.max(y0 + 1, y1); sy++) {
        for (let sx = x0; sx < Math.max(x0 + 1, x1); sx++) {
          const at = (sy * image.width + sx) * 4;
          const alpha = image.pixels[at + 3];
          // Colour is averaged over what is actually there, so a transparent
          // edge does not drag the colour towards black.
          r += image.pixels[at] * alpha; g += image.pixels[at + 1] * alpha;
          b += image.pixels[at + 2] * alpha; a += alpha; n++;
        }
      }
      const to = (y * side + x) * 4;
      out[to] = a ? Math.round(r / a) : 0;
      out[to + 1] = a ? Math.round(g / a) : 0;
      out[to + 2] = a ? Math.round(b / a) : 0;
      out[to + 3] = Math.round(a / n);
    }
  }
  return out;
}

const from = process.argv[2];
if (!from) {
  console.error('\n  node tools/tab-icon.js <picture.png>\n');
  process.exit(1);
}
if (!fs.existsSync(from)) {
  console.error('\n  ' + from + ' is not there\n');
  process.exit(1);
}
const image = readPng(fs.readFileSync(from));
fs.writeFileSync(OUT, writePng(SIDE, SIDE, shrink(image, SIDE)));
console.log('\n  ' + image.width + 'x' + image.height + ' -> ' + SIDE + 'x' + SIDE
  + '  (' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)'
  + '\n  -> ' + path.relative(root, OUT)
  + '\n  now run: npm run build\n');
