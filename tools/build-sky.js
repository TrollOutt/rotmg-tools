'use strict';
/*
 * Pack the drawn clouds into the sheet the atlas reads.
 *
 *   node tools/build-sky.js                 into web/assets/atlas
 *   node tools/build-sky.js --atlas=DIR     into a copy
 *
 * The weather sheet and its table are written by buildSky() in
 * realm-render.js, and that is still where they come from on a full build.
 * But realm-render.js reads the recordings and is only on the machine that
 * has them, and the clouds are drawings that have nothing to do with either -
 * so on any other machine there was no way to put a new set of clouds in
 * front of anyone. This does that one thing and touches nothing else.
 *
 * It reads the same folder under the same rule, so the two agree about what
 * the clouds are and in what order:
 *
 *     data/Realm/clouds/NN-name.png    one cloud per file
 *
 * Taken in the order the names sort - hence the numbers, because the page
 * picks a cloud for each of its banks by index, and a bank that changes shape
 * between builds is a bank that visibly jumps.
 *
 * Each file is honoured for the alpha it already carries, trimmed to what is
 * actually drawn, and eased down by averaging whole blocks so that nothing a
 * pixel wide is lost on the way. Oryx keeps his own rectangles: they point
 * into oryx.png rather than into this sheet, so they are read out of the
 * table that is there and written back unchanged.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const CLOUDS = path.join(root, 'data', 'Realm', 'clouds');
const asked = process.argv.find(one => one.startsWith('--atlas='));
const ATLAS = asked
  ? path.resolve(root, asked.slice('--atlas='.length))
  : path.join(root, 'web', 'assets', 'atlas');

/*
 * How wide a cloud is allowed to be on the sheet.
 *
 * The page draws a bank at a share of the sky's radius, which on a wide
 * window comes to a couple of hundred pixels at the distance the weather is
 * thickest - so art much smaller than this is visibly soft, and art much
 * larger than it is a megabyte spent on a blur. Wide clouds are the ones that
 * set the sheet's size, and there are only twenty of them.
 */
const WIDEST = 128;
const PAD = 1;                  // a clear pixel between neighbours
const SHEET = 1024;             // how wide the sheet is allowed to grow

/* ---------------- PNG ---------------- */

function readPng(buffer) {
  let at = 8, width = 0, height = 0, colour = 6, depth = 8;
  const parts = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const kind = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colour = body[9];
    } else if (kind === 'IDAT') parts.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || colour !== 6) {
    throw new Error('want 8-bit RGBA, got depth ' + depth + ' colour type ' + colour);
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const pixels = Buffer.alloc(width * height * 4);
  const stride = width * 4;
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++];
    const line = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[read++];
      const a = x >= 4 ? pixels[line + x - 4] : 0;
      const b = y > 0 ? pixels[line - stride + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[line - stride + x - 4] : 0;
      let out = value;
      if (filter === 1) out = value + a;
      else if (filter === 2) out = value + b;
      else if (filter === 3) out = value + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        out = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      pixels[line + x] = out & 255;
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
function crc(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(kind, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
function writePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; head[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- the clouds ---------------- */

/* What is actually drawn, which is rarely the whole sheet of paper. */
function trim(image) {
  let x0 = image.width, y0 = image.height, x1 = -1, y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.pixels[(y * image.width + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('nothing drawn in it');
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    image.pixels.copy(pixels, y * width * 4,
      ((y + y0) * image.width + x0) * 4, ((y + y0) * image.width + x1 + 1) * 4);
  }
  return { width, height, pixels };
}

/*
 * Down to a size worth carrying, by averaging whole blocks.
 *
 * Weighted by alpha, and only over the pixels that have any: a cloud's edge
 * runs against nothing at all, and letting transparent black into the average
 * draws a dark rim round every puff. The alpha of the block is its own plain
 * average, since that is the share of the block the cloud covers.
 */
function shrink(image, by) {
  const width = Math.max(1, Math.round(image.width / by));
  const height = Math.max(1, Math.round(image.height / by));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const fromY = Math.floor(y * image.height / height);
    const toY = Math.max(fromY + 1, Math.floor((y + 1) * image.height / height));
    for (let x = 0; x < width; x++) {
      const fromX = Math.floor(x * image.width / width);
      const toX = Math.max(fromX + 1, Math.floor((x + 1) * image.width / width));
      let r = 0, g = 0, b = 0, a = 0, lit = 0, all = 0;
      for (let sy = fromY; sy < toY; sy++) {
        for (let sx = fromX; sx < toX; sx++) {
          const at = (sy * image.width + sx) * 4;
          const alpha = image.pixels[at + 3];
          all++;
          a += alpha;
          if (!alpha) continue;
          r += image.pixels[at] * alpha;
          g += image.pixels[at + 1] * alpha;
          b += image.pixels[at + 2] * alpha;
          lit += alpha;
        }
      }
      const out = (y * width + x) * 4;
      pixels[out] = lit ? Math.round(r / lit) : 0;
      pixels[out + 1] = lit ? Math.round(g / lit) : 0;
      pixels[out + 2] = lit ? Math.round(b / lit) : 0;
      pixels[out + 3] = Math.round(a / all);
    }
  }
  return { width, height, pixels };
}

function main() {
  if (!fs.existsSync(CLOUDS)) {
    console.error('no clouds to pack: ' + path.relative(root, CLOUDS) + ' is not there');
    process.exit(1);
  }
  const files = fs.readdirSync(CLOUDS).filter(one => /[.]png$/i.test(one)).sort();
  if (!files.length) {
    console.error('no clouds to pack in ' + path.relative(root, CLOUDS));
    process.exit(1);
  }

  const cut = [];
  for (const file of files) {
    const whole = readPng(fs.readFileSync(path.join(CLOUDS, file)));
    const drawn = trim(whole);
    const by = Math.max(1, drawn.width / WIDEST);
    const small = by > 1 ? shrink(drawn, by) : drawn;
    cut.push({ file, small, was: [whole.width, whole.height], drawnAt: [drawn.width, drawn.height] });
  }

  /*
   * Laid out in shelves, tallest first, which for twenty pictures of roughly
   * one size is within a few per cent of the best any packer would manage and
   * is a dozen lines rather than three hundred.
   */
  const order = cut.slice().sort((a, b) => b.small.height - a.small.height);
  let x = PAD, y = PAD, shelf = 0, wide = 0;
  for (const one of order) {
    if (x + one.small.width + PAD > SHEET && x > PAD) {
      x = PAD; y += shelf + PAD; shelf = 0;
    }
    one.at = [x, y];
    x += one.small.width + PAD;
    shelf = Math.max(shelf, one.small.height);
    wide = Math.max(wide, x);
  }
  const sheetW = wide + PAD - 1, sheetH = y + shelf + PAD;

  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  for (const one of order) {
    for (let row = 0; row < one.small.height; row++) {
      one.small.pixels.copy(sheet, ((one.at[1] + row) * sheetW + one.at[0]) * 4,
        row * one.small.width * 4, (row + 1) * one.small.width * 4);
    }
  }

  /* The table, in the order the files sort rather than the order they packed. */
  const clouds = cut.map(one => [one.at[0], one.at[1], one.small.width, one.small.height]);

  const tableFile = path.join(ATLAS, 'sky.json');
  const table = fs.existsSync(tableFile)
    ? JSON.parse(fs.readFileSync(tableFile, 'utf8'))
    : {};
  if (!table.oryx) {
    console.error('sky.json has no oryx rectangles to keep - build the atlas first');
    process.exit(1);
  }
  /*
   * The same shape the renderer writes, field for field and byte for byte:
   * no marker saying which tool did it and no trailing newline. Two writers
   * that leave different files behind would show up as a diff every time the
   * other machine ran a full build, which is exactly the drift worth avoiding.
   */
  const next = { sheet: [sheetW, sheetH], clouds, oryx: table.oryx };

  fs.writeFileSync(path.join(ATLAS, 'sky.png'), writePng(sheetW, sheetH, sheet));
  fs.writeFileSync(tableFile, JSON.stringify(next));

  /* ---------------- what happened ---------------- */
  console.log('\n  ' + cut.length + ' clouds -> ' + sheetW + 'x' + sheetH + ', '
    + Math.round(fs.statSync(path.join(ATLAS, 'sky.png')).size / 1024) + 'K');
  for (const one of cut) {
    console.log('    ' + one.file.padEnd(14)
      + String(one.was.join('x')).padEnd(10) + ' drawn ' + String(one.drawnAt.join('x')).padEnd(10)
      + ' -> ' + one.small.width + 'x' + one.small.height
      + ' at ' + one.at.join(','));
  }
  console.log('  -> ' + path.relative(root, ATLAS) + '\n');
}

main();
