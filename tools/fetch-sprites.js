'use strict';
/*
 * Downloads the artwork the original Qt assets never had.
 *
 *   node tools/fetch-sprites.js
 *
 * The client draws these too, but only as an index into a packed spritesheet
 * inside a Unity texture, which would mean decoding the texture formats and
 * slicing the atlas. https://www.realmeye.com/wiki/artifacts shows every one of
 * them on a single page with the artifact's name on the image, so that is where
 * they come from. One page is read; nothing else is crawled, and a file already
 * on disk is left alone, so re-running this costs nothing.
 *
 * Two files are written per artifact, matching what the interface already
 * expects: the sprite as served (40x40) and a "-div2" copy at half that. The
 * halving is a plain 2x nearest-neighbour reduction, which is exact for pixel
 * art and keeps the name honest.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'data', 'GUI Files', 'Artifact Icons');
const PAGE = 'https://www.realmeye.com/wiki/artifacts';
const ENCHANT_PAGE = 'https://www.realmeye.com/wiki/enchanting';
const DUNGEON_PAGE = 'https://www.realmeye.com/wiki/dungeons';

// The client calls it Premium Silver Card; the Qt assets are filed under the
// older name and the interface already knows to look there.
const ART_ALIAS = { 'Premium Silver Card': 'Premium Silver Tarot Card' };

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rotmg-enchant-calculator build script' } }, response => {
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

/* ---------------------------------------------------------------- *
 * A very small PNG reader and writer                                *
 * ---------------------------------------------------------------- *
 * Whatever those pages serve, at 8 bits a sample and not interlaced:
 * greyscale, greyscale with alpha, RGB, palette, RGBA. All of it comes
 * out as RGBA here. Anything else is refused rather than mangled.
 */
function readPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colour = buffer[25];
  const SAMPLES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  if (depth !== 8 || !SAMPLES[colour] || buffer[28] !== 0) {
    throw new Error('unsupported PNG: depth ' + depth + ', colour type ' + colour + ', interlace ' + buffer[28]);
  }

  const parts = [];
  let palette = null;
  let alpha = null;
  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const kind = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (kind === 'IDAT') parts.push(body);
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') alpha = body;
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));

  // Undo the per-scanline filter, working in whatever the stored samples are.
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
  if (colour === 6) return { width, height, pixels: flat };

  // Everything else becomes RGBA: greyscale with or without alpha, plain RGB,
  // and palette entries looked up through PLTE and tRNS.
  if (colour !== 3) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const at = i * samples;
      const grey = colour === 0 || colour === 4;
      pixels[i * 4] = grey ? flat[at] : flat[at];
      pixels[i * 4 + 1] = grey ? flat[at] : flat[at + 1];
      pixels[i * 4 + 2] = grey ? flat[at] : flat[at + 2];
      pixels[i * 4 + 3] = colour === 4 ? flat[at + 1] : 255;
    }
    return { width, height, pixels };
  }

  if (!palette) throw new Error('palette image with no PLTE');
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const index = flat[i];
    pixels[i * 4] = palette[index * 3];
    pixels[i * 4 + 1] = palette[index * 3 + 1];
    pixels[i * 4 + 2] = palette[index * 3 + 2];
    // tRNS lists alpha for the first entries; the rest are opaque.
    pixels[i * 4 + 3] = alpha && index < alpha.length ? alpha[index] : 255;
  }
  return { width, height, pixels };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
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
function writePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Exact for pixel art drawn at twice the size: take one pixel of each 2x2.
function halve(image) {
  if (image.width % 2 || image.height % 2) throw new Error('odd dimensions, cannot halve exactly');
  const width = image.width / 2, height = image.height / 2;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      image.pixels.copy(out, (y * width + x) * 4,
        ((y * 2) * image.width + x * 2) * 4, ((y * 2) * image.width + x * 2) * 4 + 4);
    }
  }
  return { width, height, pixels: out };
}

// One wiki page, or null when there is none under that name. A dungeon can be
// filed under a slug that keeps its apostrophe as "-s-", so a miss is normal
// and not worth an error.
async function getPage(url) {
  try {
    return (await get(url)).toString('utf8');
  } catch (error) {
    return null;
  }
}

// Every named image on one wiki page, by the name it is labelled with.
async function imagesOn(page) {
  const html = (await get(page)).toString('utf8');
  const source = new Map();
  for (const m of html.matchAll(/<img[^>]*>/g)) {
    const title = /title="([^"]+)"/.exec(m[0]);
    const src = /src="([^"]+)"/.exec(m[0]);
    if (title && src) source.set(title[1], new URL(src[1], page).href);
  }
  return source;
}

/*
 * One pass over a set of names that should have artwork and do not. Artifacts
 * are filed at two sizes because the interface asks for the half-size copy;
 * enchantment icons are filed at one, as the existing ones are.
 */
async function fill(what, page, dir, missing, halved, look) {
  if (!missing.length) {
    console.log('  every ' + what + ' already has artwork.');
    return;
  }
  console.log('\n  ' + missing.length + ' ' + what + 's without artwork; reading ' + page);
  const source = await imagesOn(page);
  console.log('  ' + source.size + ' named images there\n');

  fs.mkdirSync(dir, { recursive: true });
  const absent = [];
  let written = 0;
  for (const name of missing) {
    const url = look ? look(source, name) : source.get(name);
    if (!url) { absent.push(name); continue; }
    const image = readPng(await get(url));
    fs.writeFileSync(path.join(dir, name + '.png'), writePng(image.width, image.height, image.pixels));
    let note = image.width + 'x' + image.height;
    if (halved) {
      const small = halve(image);
      fs.writeFileSync(path.join(dir, name + '-div2.png'), writePng(small.width, small.height, small.pixels));
      note += ' and ' + small.width + 'x' + small.height;
    }
    written++;
    console.log('    ' + name.padEnd(34) + note);
  }
  console.log('\n  ' + written + ' written to ' + path.relative(root, dir));
  if (absent.length) console.log('  ' + absent.length + ' not on that page: ' + absent.join(', '));
}

// Mirrors iconFor() in tools/build-standalone.js: only an awakened
// enchantment gets a picture of its own, the rest share one per label.
function iconName(labels) {
  return labels.includes('AWAKENED') ? true : false;
}

/*
 * The page labels a portal "Kogbold Steamworks Portal" where the fame bonus
 * calls the dungeon "Kogbold Steamworks", and disagrees on a capital here and
 * an apostrophe there. Try the name, then the name with "Portal", then
 * ignoring case and punctuation altogether — and say which are left rather
 * than matching something that only looks close.
 */
/*
 * Two the matcher cannot reach on its own. The client drops an apostrophe the
 * wiki keeps, and one dungeon has no portal drawn on that page at all — its
 * key is the only picture of it there, which is still what a player looks for.
 */
const DUNGEON_TITLE = {
  'Santa Workshop': "Santa's Workshop",
  'Ice Citadel': 'Ice Citadel Key'
};

function findImage(source, name) {
  if (DUNGEON_TITLE[name] && source.has(DUNGEON_TITLE[name])) return source.get(DUNGEON_TITLE[name]);
  const plain = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = plain(name);
  if (source.has(name)) return source.get(name);
  if (source.has(name + ' Portal')) return source.get(name + ' Portal');
  for (const [title, url] of source) {
    if (plain(title) === wanted || plain(title) === wanted + 'portal') return url;
  }
  return null;
}

/*
 * The picture at the head of the enchanting page: the enchanter's room, and
 * the only drawing of the thing this calculator is about.
 *
 * It carries no title attribute, so imagesOn() cannot see it — it is found as
 * the first wiki image on the page instead. Stored exactly as served: the copy
 * there has been resampled at some point and is no longer a whole multiple of
 * its own pixels, so there is no honest way to reduce it back to them, and it
 * is shown small and smoothed rather than pretending otherwise.
 */
/*
 * Cut the background out of a picture that was drawn on one.
 *
 * The wiki serves the enchanter's room on a flat near-black field, which on a
 * dark card reads as a photograph pasted onto it rather than a thing standing
 * on it. There is no alpha channel to trust, so the field has to be found.
 *
 * Colour alone cannot do it. The room's own shadows — inside the bookcase,
 * under the shelf, behind the emblem — are the same near-black as the field,
 * and they touch it through gaps a pixel or two wide where the drawing does
 * not quite close. A plain flood walks straight through those gaps and eats
 * holes out of the middle of the room.
 *
 * So the field is found by shape as well as colour: erode it first, keeping
 * only what is field for two pixels in every direction, and flood that. A gap
 * two pixels wide does not survive being eroded, so the flood cannot get in.
 * Then the result is grown back out through the field to recover the edge it
 * lost, which cannot reach the inside again — the gap is long and the growth
 * is bounded.
 */
function cutBackground(image, tolerance = 8, radius = 2) {
  const { width, height, pixels } = image;
  const bg = [pixels[0], pixels[1], pixels[2]];
  const size = width * height;
  const clamp = (value, high) => value < 0 ? 0 : value > high ? high : value;

  const flat = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const at = i * 4;
    flat[i] = Math.max(
      Math.abs(pixels[at] - bg[0]),
      Math.abs(pixels[at + 1] - bg[1]),
      Math.abs(pixels[at + 2] - bg[2])) <= tolerance ? 1 : 0;
  }

  // Field for `radius` in every direction. Outside the picture counts as
  // field, so the border it is seeded from is not eroded away.
  const open = new Uint8Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let all = 1;
      for (let dy = -radius; dy <= radius && all; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (!flat[clamp(y + dy, height - 1) * width + clamp(x + dx, width - 1)]) { all = 0; break; }
        }
      }
      open[y * width + x] = all;
    }
  }

  const outside = new Uint8Array(size);
  const queue = [];
  const seed = at => { if (open[at] && !outside[at]) { outside[at] = 1; queue.push(at); } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (queue.length) {
    const at = queue.pop();
    const x = at % width, y = (at - x) / width;
    if (x > 0) seed(at - 1);
    if (x < width - 1) seed(at + 1);
    if (y > 0) seed(at - width);
    if (y < height - 1) seed(at + width);
  }

  // Grow it back through the field by what the erosion took, and one more so
  // the outline is not left a pixel short of where it belongs.
  for (let round = 0; round <= radius; round++) {
    const grown = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        if (outside[at] || !flat[at]) continue;
        if ((x > 0 && outside[at - 1]) || (x < width - 1 && outside[at + 1])
          || (y > 0 && outside[at - width]) || (y < height - 1 && outside[at + width])) grown.push(at);
      }
    }
    for (const at of grown) outside[at] = 1;
  }

  let cut = 0;
  for (let i = 0; i < size; i++) if (outside[i]) { pixels[i * 4 + 3] = 0; cut++; }
  return { cut, kept: size - cut };
}

async function pageArt() {
  const dir = path.join(root, 'data', 'GUI Files', 'Page Art');
  const file = path.join(dir, 'Enchanting.png');
  if (fs.existsSync(file)) {
    console.log('\n  the enchanter room is already on disk.');
    return;
  }
  const html = (await get(ENCHANT_PAGE)).toString('utf8');
  const first = /<img[^>]+src="([^"]*\/img\/wiki\/i\/[^"]+\.png)"/.exec(html);
  if (!first) {
    console.log('\n  no picture at the head of ' + ENCHANT_PAGE);
    return;
  }
  const image = readPng(await get(new URL(first[1], ENCHANT_PAGE).href));
  const { cut } = cutBackground(image);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, writePng(image.width, image.height, image.pixels));
  const share = Math.round(100 * cut / (image.width * image.height));
  console.log('\n  the enchanter room ' + image.width + 'x' + image.height
    + ', ' + share + '% of it background cut away -> ' + path.relative(root, file));
}

async function main() {
  const artifacts = fs.readFileSync(path.join(root, 'data', 'Artifacts', 'client-artifacts.txt'), 'utf8')
    .split(/\r?\n/).filter(line => line.startsWith('artifact|')).map(line => line.split('|')[1]);
  await fill('artifact', PAGE, outDir, artifacts.filter(name =>
    !fs.existsSync(path.join(outDir, (ART_ALIAS[name] || name) + '-div2.png'))), true);

  const enchDir = path.join(root, 'data', 'GUI Files', 'Enchantment Icons');
  const awakened = fs.readFileSync(path.join(root, 'data', 'Enchantment documents', 'client-enchantments.txt'), 'utf8')
    .split(/\r?\n/).filter(line => line.startsWith('ench|')).map(line => line.split('|'))
    .filter(row => iconName(row[4].split(',')))
    .map(row => row[1]);
  await fill('awakened enchantment', ENCHANT_PAGE, enchDir,
    awakened.filter(name => !fs.existsSync(path.join(enchDir, name + '.png'))), false);

  await pageArt();

  /*
   * The dungeon portals, and how hard the game says each dungeon is.
   *
   * From each dungeon's own wiki page rather than the index: the index labels
   * a few of them with the wrong picture — it has "Ice Citadel Key" and no
   * portal at all — and only the individual pages carry the difficulty rating.
   * An animated portal is preferred where one exists; most are drawn as a
   * single frame there, and the client's own animation frames would mean
   * decoding its spritesheets, which is a different job.
   */
  const dungeonDir = path.join(root, 'data', 'GUI Files', 'Dungeon Icons');
  const infoFile = path.join(root, 'data', 'Fame', 'dungeon-pages.txt');
  const fameData = require(path.join(root, 'web', 'fame.js'))
    .parse(fs.readFileSync(path.join(root, 'data', 'Fame', 'client-fame.txt'), 'utf8'));

  // The wiki turns an apostrophe into "-s-", which is why matching on the
  // index page put a key where Ice Citadel's portal should have been.
  const SLUG_ALIAS = {
    'Oryx Pandemonium Decaract': 'decaract',
    // The client drops an apostrophe the wiki keeps.
    'Santa Workshop': 'santa-s-workshop'
  };
  // Two have no portal drawn at all; their boss is the picture a player knows.
  /*
   * Where the page titles the picture something other than the dungeon. Two
   * are variants that share the ordinary dungeon's door, one drops an
   * apostrophe the wiki keeps, and one has no portal drawn at all so its boss
   * stands in.
   */
  const PICTURE_ALIAS = {
    'Oryx Pandemonium Decaract': 'Decaract',
    'Infernal Abyss of Demons': 'Abyss of Demons Portal',
    'Santa Workshop': "Santa's Workshop Portal"
  };
  const slugsFor = name => {
    if (SLUG_ALIAS[name]) return [SLUG_ALIAS[name]];
    const plain = name.toLowerCase().replace(/[\u2019]/g, "'");
    return [...new Set([
      plain.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      plain.replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    ])];
  };

  fs.mkdirSync(dungeonDir, { recursive: true });
  const info = new Map();
  const noPortal = [];
  let fetched = 0;
  let animated = 0;

  for (const dungeon of fameData.dungeons) {
    const target = path.join(dungeonDir, dungeon.name + '.png');
    let page = null;
    for (const slug of slugsFor(dungeon.name)) {
      const attempt = await getPage('https://www.realmeye.com/wiki/' + slug);
      if (attempt) { page = attempt; break; }
    }
    if (!page) { noPortal.push(dungeon.name + ' (no page)'); continue; }

    const difficulty = (/Difficulty:\s*(\d+)/.exec(page) || [, ''])[1];
    if (difficulty) info.set(dungeon.name, { difficulty: Number(difficulty) });

    const images = [...page.matchAll(/<img[^>]*>/g)].map(m => ({
      title: (/title="([^"]+)"/.exec(m[0]) || [, ''])[1],
      src: (/src="([^"]+)"/.exec(m[0]) || [, ''])[1]
    })).filter(x => x.src);

    /*
     * The picture has to be this dungeon's own. A dungeon's page shows the
     * portals of its neighbours too, and preferring any animated one among
     * them put the Lair of Draconis under somebody else's door.
     */
    const plain = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = PICTURE_ALIAS[dungeon.name] || dungeon.name;
    const mine = images.filter(x => PICTURE_ALIAS[dungeon.name]
      ? x.title === wanted
      : plain(x.title) === plain(wanted) + 'portal' || plain(x.title) === plain(wanted));
    // Animated first, but only among this dungeon's own.
    const pick = mine.find(x => /[.]gif/i.test(x.src)) || mine[0];
    if (!pick) { noPortal.push(dungeon.name); continue; }

    const gif = /\.gif/i.test(pick.src);
    const file = path.join(dungeonDir, dungeon.name + (gif ? '.gif' : '.png'));
    if (fs.existsSync(file)) continue;
    const bytes = await get(new URL(pick.src, DUNGEON_PAGE).href);
    fs.writeFileSync(file, bytes);
    if (gif) { animated++; if (fs.existsSync(target)) fs.unlinkSync(target); }
    fetched++;
    console.log('    ' + dungeon.name.padEnd(30) + (gif ? 'animated' : 'still')
      + (difficulty ? '   difficulty ' + difficulty : ''));
  }

  const lines = ['## How hard the game says each dungeon is, and whether its',
    '## portal is drawn moving. Both from the wiki page of the dungeon.',
    '##',
    '## Written by tools/fetch-sprites.js.',
    '##',
    '## dungeon|difficulty|picture',
    ''];
  for (const dungeon of fameData.dungeons) {
    const entry = info.get(dungeon.name) || {};
    const file = fs.existsSync(path.join(dungeonDir, dungeon.name + '.gif')) ? 'gif'
      : fs.existsSync(path.join(dungeonDir, dungeon.name + '.png')) ? 'png' : '';
    lines.push([dungeon.name, entry.difficulty || '', file].join('|'));
  }
  fs.writeFileSync(infoFile, lines.join('\n') + '\n', 'utf8');

  console.log('\n  ' + fetched + ' portals written, ' + animated + ' of them animated');
  console.log('  ' + info.size + ' of ' + fameData.dungeons.length + ' have a difficulty -> '
    + path.relative(root, infoFile));
  if (noPortal.length) console.log('  no portal drawn for: ' + noPortal.join(', '));
  console.log('');
}

main().catch(error => { console.error('\n  ' + error.message + '\n'); process.exit(1); });
