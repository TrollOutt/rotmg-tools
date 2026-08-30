'use strict';
/*
 * Trace the shape of the New Realm into data/Realm/realm-terrain.txt.
 *
 *   node tools/trace-realm-map.js
 *
 * The realm is the one part of this project the client cannot answer for.
 * Every other data file here is read out of an installed game client, but the
 * client carries no map: the realm is generated on the server and streamed to
 * you tile by tile as you walk, so there is nothing on disk to read. What the
 * client does carry is the vocabulary — 10,400 ground types, 53 terrains, the
 * creatures that spawn in each — and tools/generate-realm.js already reads
 * that. What is missing is the shape.
 *
 * The New Realm, unlike the old one, is the same map every time, so a shape
 * exists to be had. It is taken here from a picture of it with the fog of war
 * lifted, reduced to a coarse grid of terrain classes — about eight pixels a
 * cell. What is written out is a topology, not the picture: which kind of
 * ground is where, at a resolution far below the original, for the atlas to
 * draw in its own way. Nothing of the image itself is kept or published.
 *
 * Colours are classified by nearest neighbour against the table below, which
 * covers 97 % of the picture; the rest is the fog-of-war edge and the game's
 * own overlay markers, and lands on whatever it is closest to.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'data', 'Realm', 'realm-terrain.txt');
const CACHE = path.join(root, 'client-data', 'realm-map-source.png');
const SOURCE = 'https://cdn.wikiwiki.jp/to/w/rmd/New%20realm/%3A%3Aref/Map.png'
  + '?rev=4e62388c0f1a45f41996c82caf09f2b5&t=20240711175913';

// How many cells across. The land is about 900 of the 2026 pixels wide, so
// this puts roughly 110 cells across the realm itself — enough to keep every
// bay and inlet, coarse enough that it is a topology rather than a copy.
const COLS = 248;

/*
 * What the map is made of.
 *
 * Each class is one letter in the file and one thing to draw. The greys are
 * the mountains the player cannot walk into, the blues are sea, and the rest
 * is ground, kept as families rather than as the twenty-four named biomes:
 * naming is the atlas's job, and it has the client's own biome list for it.
 */
const CLASSES = [
  ['~', 'sea', '#3d61ae'],
  ['~', 'sea', '#3a5da8'],
  ['-', 'shallow', '#467cc7'],
  ['^', 'mountain', '#434a52'],
  ['^', 'mountain', '#757c72'],
  ['*', 'snow', '#a0bde4'],
  ['g', 'grass', '#799831'],
  ['g', 'grass', '#69a453'],
  ['p', 'plains', '#5b6945'],
  ['f', 'forest', '#2d3a1b'],
  ['f', 'forest', '#3a421c'],
  ['F', 'deepforest', '#235f24'],
  ['F', 'deepforest', '#184a1d'],
  ['y', 'scrub', '#888a1d'],
  ['s', 'sand', '#bda388'],
  ['s', 'sand', '#d1bc99'],
  ['s', 'sand', '#aa9177'],
  ['s', 'sand', '#b79679'],
  ['S', 'palesand', '#fdd5a2'],
  ['d', 'desert', '#704e1c'],
  ['d', 'desert', '#946e36'],
  ['h', 'highland', '#231843'],
  ['n', 'night', '#1f283d'],
  ['n', 'night', '#404a6d'],
  ['n', 'night', '#373d5b'],
  ['n', 'night', '#252c3c'],
  ['n', 'night', '#45455b'],
  ['x', 'thicket', '#2d1a15'],
  ['r', 'ember', '#300f10'],
  ['c', 'clay', '#87675b'],
  ['m', 'murk', '#2c352f'],
  ['v', 'mauve', '#775b61'],
  // The game's own beacon markers, drawn over the terrain in the source. They
  // are read as whatever ground they sit on rather than as a class of their
  // own: the atlas places beacons from the client's data, not from a picture.
  ['?', 'marker', '#7fffff']
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rotmg-realm-atlas build script' } }, response => {
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

// The same small reader the sprite fetcher uses, cut down to what this needs.
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
  const rgb = (x, y) => {
    const i = y * stride + x * samples;
    if (colour === 3) { const p = flat[i] * 3; return [palette[p], palette[p + 1], palette[p + 2]]; }
    if (colour === 0 || colour === 4) return [flat[i], flat[i], flat[i]];
    return [flat[i], flat[i + 1], flat[i + 2]];
  };
  return { width, height, rgb };
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
  const table = CLASSES.map(([letter, name, hex]) => ({
    letter, name, rgb: [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  }));

  const cell = image.width / COLS;
  const ROWS = Math.round(image.height / cell);
  const grid = [];
  const tally = new Map();

  // Each cell votes: sixteen samples, and the class most of them are nearest
  // to wins. A single sample would make the coastline ragged wherever the
  // picture dithers, which is most of it.
  for (let row = 0; row < ROWS; row++) {
    let line = '';
    for (let col = 0; col < COLS; col++) {
      const votes = new Map();
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = Math.min(image.width - 1, Math.floor((col + (sx + 0.5) / 4) * cell));
          const y = Math.min(image.height - 1, Math.floor((row + (sy + 0.5) / 4) * cell));
          const [r, g, b] = image.rgb(x, y);
          let best = table[0];
          let bestDistance = Infinity;
          for (const entry of table) {
            const distance = (r - entry.rgb[0]) ** 2 + (g - entry.rgb[1]) ** 2 + (b - entry.rgb[2]) ** 2;
            if (distance < bestDistance) { bestDistance = distance; best = entry; }
          }
          votes.set(best.letter, (votes.get(best.letter) || 0) + 1);
        }
      }
      const won = [...votes].sort((a, b) => b[1] - a[1])[0][0];
      line += won;
      tally.set(won, (tally.get(won) || 0) + 1);
    }
    grid.push(line);
  }

  /*
   * The game draws its own beacon markers over the terrain, and those cells
   * come out as a class that is not ground at all. They are filled in with
   * whatever surrounds them: the atlas places beacons from the client's data,
   * so all a marker leaves behind here is a hole to be closed.
   */
  let filled = 0;
  for (let pass = 0; pass < 4; pass++) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (grid[row][col] !== '?') continue;
        const votes = new Map();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const y = row + dy, x = col + dx;
            if (y < 0 || y >= ROWS || x < 0 || x >= COLS) continue;
            const letter = grid[y][x];
            if (letter === '?') continue;
            votes.set(letter, (votes.get(letter) || 0) + 1);
          }
        }
        if (!votes.size) continue;
        const won = [...votes].sort((a, b) => b[1] - a[1])[0][0];
        grid[row] = grid[row].slice(0, col) + won + grid[row].slice(col + 1);
        tally.set(won, (tally.get(won) || 0) + 1);
        tally.set('?', tally.get('?') - 1);
        filled++;
      }
    }
  }
  if (filled) console.log('  ' + filled + ' marker cells closed up from what surrounds them');

  const names = new Map();
  for (const entry of table) if (!names.has(entry.letter)) names.set(entry.letter, entry.name);

  const header = [
    '## The shape of the New Realm, as a grid of terrain classes.',
    '##',
    '## Written by tools/trace-realm-map.js. Do not edit by hand.',
    '##',
    '## The client carries no map — the realm is generated on the server and',
    '## streamed tile by tile — so unlike every other data file here this one',
    '## is not read out of an installed client. It is traced from a picture of',
    '## the realm with the fog of war lifted and reduced to one letter per',
    '## eight-pixel cell: a topology for the atlas to draw its own way, not a',
    '## copy of the picture.',
    '##',
    '## ' + COLS + ' by ' + ROWS + ', one character a cell:',
    ...[...names].map(([letter, name]) =>
      '##   ' + letter + '  ' + name.padEnd(10) + String(tally.get(letter) || 0).padStart(6) + ' cells'),
    ''
  ];

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, header.join('\n') + '\n' + grid.join('\n') + '\n', 'utf8');

  const land = [...tally].filter(([letter]) => letter !== '~' && letter !== '-')
    .reduce((total, [, n]) => total + n, 0);
  console.log('  ' + COLS + ' by ' + ROWS + ' cells, ' + land + ' of them land'
    + ' -> ' + path.relative(root, OUT));
  for (const [letter, name] of names) {
    const n = tally.get(letter) || 0;
    if (n) console.log('    ' + letter + '  ' + name.padEnd(11) + String(n).padStart(6));
  }
  console.log('');
})().catch(error => { console.error('\n  ' + error.message + '\n'); process.exit(1); });
