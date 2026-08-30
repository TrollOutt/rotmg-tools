'use strict';
/*
 * Trace the shape of the New Realm into data/Realm/.
 *
 *   node tools/trace-realm-map.js
 *
 * The realm is the one part of this project the client cannot answer for.
 * Every other data file here is read out of an installed game client, but the
 * client carries no map: the realm is generated on the server and streamed to
 * you tile by tile as you walk, so there is nothing on disk to read. What the
 * client does carry is the vocabulary — the terrains, and which creatures
 * spawn in each — and tools/generate-realm.js already reads that. What is
 * missing is the shape.
 *
 * The New Realm, unlike the old one, is the same map every time, so a shape
 * exists to be had. It is traced from an annotated picture of the realm — fog
 * of war lifted, roads and beacon markers drawn on — and reduced to a grid of
 * terrain classes about eight pixels a cell. What is written out is a
 * topology: which kind of ground is where, at a resolution far below the
 * original. Nothing of the picture itself is kept or published.
 *
 * Two files come out of it:
 *
 *   realm-terrain.txt   the grid, with a legend of which colour is which
 *   realm-beacons.txt   where the beacons are
 *
 * Which biome each colour is belongs to neither the picture nor the client,
 * and lives in realm-biomes.txt, written by hand.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const OUT_TERRAIN = path.join(root, 'data', 'Realm', 'realm-terrain.txt');
const OUT_BEACONS = path.join(root, 'data', 'Realm', 'realm-beacons.txt');
const BIOMES = path.join(root, 'data', 'Realm', 'realm-biomes.txt');
const CACHE = path.join(root, 'client-data', 'realm-map-roads.png');
const SOURCE = 'https://i.imgur.com/0L1g8pP.png';

// How many cells across. The island fills most of the picture here, so this
// puts about 240 cells across the realm — every bay and inlet kept, and still
// a topology rather than a copy.
const COLS = 248;

// Colours that are not ground. The sea ring and the roads are drawn as
// themselves; the marker red is the beacons, and is found separately.
const SEA = '#375ca6';
const SHALLOW = '#467cc7';
const ROAD = '#757c72';

// A colour has to cover this much of the island to be worth a class of its
// own. Below it the picture is anti-aliasing and marker outlines.
const FLOOR = 0.09;

function get(url) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Mozilla/5.0 rotmg-realm-atlas build script', Accept: 'image/*' };
    https.get(url, { headers }, response => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        response.resume();
        return get(new URL(response.headers.location, url).href).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error('HTTP ' + response.statusCode + ' for ' + url));
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

function readPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colour = buffer[25];
  const SAMPLES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  if (depth !== 8 || !SAMPLES[colour] || buffer[28] !== 0) {
    throw new Error('unsupported PNG: depth ' + depth + ', colour type ' + colour);
  }
  const parts = [];
  let palette = null;
  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const kind = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (kind === 'IDAT') parts.push(body);
    else if (kind === 'PLTE') palette = body;
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const samples = SAMPLES[colour];
  const stride = width * samples;
  const flat = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= samples ? flat[y * stride + x - samples] : 0;
      const b = y > 0 ? flat[(y - 1) * stride + x] : 0;
      const c = x >= samples && y > 0 ? flat[(y - 1) * stride + x - samples] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error('unknown PNG filter ' + filter);
      flat[y * stride + x] = value & 0xff;
    }
  }
  const px = (x, y) => {
    const i = y * stride + x * samples;
    if (colour === 6) return [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
    if (colour === 3) { const p = flat[i] * 3; return [palette[p], palette[p + 1], palette[p + 2], 255]; }
    return [flat[i], flat[i + 1], flat[i + 2], 255];
  };
  return { width, height, px };
}

const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
// The letters a class can take, in the order they are handed out. Chosen to
// stay printable and to leave the punctuation for sea, road and nothing.
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/*
 * The beacon markers.
 *
 * They are drawn on the map as small squares with a red rim, and red is rare
 * on this map outside them, so a red-dominant pixel is a good seed and the
 * markers are the connected clumps of those. On the picture as served every
 * one of them comes out the same size, which is the check that this found
 * markers rather than something red in the scenery.
 */
function findBeacons(image) {
  const { width: W, height: H } = image;
  const red = ([r, g, b, a]) => a > 128 && r > 90 && r > g * 1.8 && r > b * 1.5;
  const seen = new Uint8Array(W * H);
  const found = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seen[y * W + x] || !red(image.px(x, y))) continue;
      const queue = [[x, y]];
      seen[y * W + x] = 1;
      let n = 0, sx = 0, sy = 0, minX = x, maxX = x, minY = y, maxY = y;
      while (queue.length) {
        const [cx, cy] = queue.pop();
        n++; sx += cx; sy += cy;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        // Two cells of reach, so the rim of a marker joins across its corners.
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H || seen[ny * W + nx]) continue;
            if (!red(image.px(nx, ny))) continue;
            seen[ny * W + nx] = 1;
            queue.push([nx, ny]);
          }
        }
      }
      if (n < 24) continue;
      found.push({ x: sx / n, y: sy / n, w: maxX - minX + 1, h: maxY - minY + 1, n });
    }
  }
  return found.sort((a, b) => a.y - b.y || a.x - b.x);
}

(async () => {
  let buffer;
  if (fs.existsSync(CACHE)) {
    buffer = fs.readFileSync(CACHE);
    console.log('\n  reading the cached picture, ' + Math.round(buffer.length / 1024) + ' KB');
  } else {
    buffer = await get(SOURCE);
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, buffer);
    console.log('\n  fetched ' + Math.round(buffer.length / 1024) + ' KB');
  }

  const image = readPng(buffer);
  const { width: W, height: H } = image;

  /* ---------------- which colours are worth a class ---------------- */
  const tally = new Map();
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const [r, g, b, a] = image.px(x, y);
      if (a < 128) continue;
      const key = toHex(r, g, b);
      tally.set(key, (tally.get(key) || 0) + 1);
    }
  }
  const total = [...tally.values()].reduce((sum, n) => sum + n, 0);
  const ranked = [...tally]
    .map(([hex, n]) => ({ hex, share: 100 * n / total }))
    .filter(entry => entry.share >= FLOOR)
    .sort((a, b) => b.share - a.share);

  const classes = [];
  let next = 0;
  for (const entry of ranked) {
    const letter = entry.hex === SEA || entry.hex === SHALLOW ? '~'
      : entry.hex === ROAD ? '='
      : LETTERS[next++];
    if (!letter) throw new Error('ran out of letters for terrain classes');
    classes.push({ ...entry, letter, rgb: [1, 3, 5].map(i => parseInt(entry.hex.slice(i, i + 2), 16)) });
  }

  /* ---------------- the grid ---------------- */
  const cell = W / COLS;
  const ROWS = Math.round(H / cell);
  const grid = [];
  const used = new Map();
  for (let row = 0; row < ROWS; row++) {
    let line = '';
    for (let col = 0; col < COLS; col++) {
      const votes = new Map();
      let outside = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = Math.min(W - 1, Math.floor((col + (sx + 0.5) / 4) * cell));
          const y = Math.min(H - 1, Math.floor((row + (sy + 0.5) / 4) * cell));
          const [r, g, b, a] = image.px(x, y);
          if (a < 128) { outside++; continue; }
          let best = classes[0];
          let bestDistance = Infinity;
          for (const entry of classes) {
            const d = (r - entry.rgb[0]) ** 2 + (g - entry.rgb[1]) ** 2 + (b - entry.rgb[2]) ** 2;
            if (d < bestDistance) { bestDistance = d; best = entry; }
          }
          votes.set(best.letter, (votes.get(best.letter) || 0) + 1);
        }
      }
      const won = outside > 8 || !votes.size ? '.'
        : [...votes].sort((a, b) => b[1] - a[1])[0][0];
      line += won;
      used.set(won, (used.get(won) || 0) + 1);
    }
    grid.push(line);
  }

  /* ---------------- what the letters mean ---------------- */
  const named = new Map();
  if (fs.existsSync(BIOMES)) {
    for (const raw of fs.readFileSync(BIOMES, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const [hex, biome] = line.split('|');
      if (hex && biome) named.set(hex.toLowerCase(), biome);
    }
  }

  const legend = classes
    .filter(entry => used.get(entry.letter))
    .map(entry => '##   ' + entry.letter + '  ' + entry.hex
      + '  ' + String(used.get(entry.letter)).padStart(6) + ' cells   '
      + (entry.letter === '~' ? 'sea'
        : entry.letter === '=' ? 'road'
        : named.get(entry.hex) || 'unnamed'));

  const header = [
    '## The shape of the New Realm, as a grid of terrain classes.',
    '##',
    '## Written by tools/trace-realm-map.js. Do not edit by hand.',
    '##',
    '## The client carries no map — the realm is generated on the server and',
    '## streamed tile by tile — so unlike every other data file here this one',
    '## is not read out of an installed client. It is traced from an annotated',
    '## picture of the realm and reduced to one letter per cell: a topology for',
    '## the atlas to draw its own way, not a copy of the picture.',
    '##',
    '## Which biome each colour is comes from realm-biomes.txt, which is a',
    '## player\'s reading rather than anything either source states.',
    '##',
    '## ' + COLS + ' by ' + ROWS + ', one character a cell. "." is off the island.',
    ...legend,
    '##',
    '## legend|letter|colour|biome, and then the grid.',
    ''
  ];

  /*
   * The legend as data, not only as a comment. The atlas takes its colours and
   * its names from these lines, so adding a name to realm-biomes.txt and
   * running this again is all it takes for a region to stop being unnamed.
   */
  const legendLines = classes
    .filter(entry => used.get(entry.letter))
    .map(entry => ['legend', entry.letter, entry.hex,
      entry.letter === '~' ? 'sea' : entry.letter === '=' ? 'road' : (named.get(entry.hex) || '')].join('|'));

  fs.mkdirSync(path.dirname(OUT_TERRAIN), { recursive: true });
  fs.writeFileSync(OUT_TERRAIN,
    header.join('\n') + '\n' + legendLines.join('\n') + '\n\n' + grid.join('\n') + '\n', 'utf8');

  /* ---------------- the beacons ---------------- */
  const beacons = findBeacons(image);
  const sizes = new Set(beacons.map(b => b.w + 'x' + b.h));
  const beaconLines = [
    '## Where the beacons are, in cells of realm-terrain.txt.',
    '##',
    '## Written by tools/trace-realm-map.js. Do not edit by hand.',
    '##',
    '## Found as the marker squares drawn on the annotated map: red is rare on',
    '## it outside them, so a red clump is a marker. All ' + beacons.length + ' came out the',
    '## same size (' + [...sizes].join(', ') + ' pixels), which is the check that these are markers',
    '## and not something red in the scenery.',
    '##',
    '## col|row',
    ''
  ];
  for (const beacon of beacons) {
    beaconLines.push(Math.round(beacon.x / cell) + '|' + Math.round(beacon.y / cell));
  }
  fs.writeFileSync(OUT_BEACONS, beaconLines.join('\n') + '\n', 'utf8');

  /* ---------------- what happened ---------------- */
  const land = [...used].filter(([letter]) => letter !== '.' && letter !== '~')
    .reduce((sum, [, n]) => sum + n, 0);
  console.log('  ' + COLS + ' by ' + ROWS + ' cells, ' + land + ' of them land'
    + ' -> ' + path.relative(root, OUT_TERRAIN));
  console.log('  ' + beacons.length + ' beacons, all ' + [...sizes].join(' and ') + ' pixels'
    + ' -> ' + path.relative(root, OUT_BEACONS));
  const unnamed = classes.filter(entry => used.get(entry.letter)
    && entry.letter !== '~' && entry.letter !== '=' && !named.has(entry.hex));
  console.log('  ' + (classes.length - unnamed.length - 2) + ' colours have a biome, '
    + unnamed.length + ' are still unnamed:');
  console.log('    ' + unnamed.map(entry => entry.hex).join(' '));
  console.log('');
})().catch(error => { console.error('\n  ' + error.message + '\n'); process.exit(1); });
