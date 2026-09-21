#!/usr/bin/env node
/*
 * The realm, one for one.
 *
 * Every recording in client-data/capture is a stretch of realm the client was
 * told about while it was walked through: a ground type at a coordinate, an
 * object at a coordinate. This draws exactly that and nothing else.
 *
 * There is no judgement in here anywhere. No biomes, no guessing at which
 * ground belongs where, no scattering, no filling in of ground that was never
 * seen. A tile that was recorded is drawn with the sprite the client uses for
 * it, at the coordinate it was recorded at; a tile that was not recorded is
 * left empty. Ocean, shoreline, roads, set pieces, the flagstones of the
 * castle — all of it is ground and all of it is drawn.
 *
 * Recordings accumulate. Drop another file in and run this again; where two
 * recordings cover the same tile, the newer one wins.
 *
 *     node tools/realm-render.js
 *
 * Output is local and stays local: local/realm/ holds one PNG per chunk of
 * 128 by 128 tiles, a manifest, and a viewer. Open local/realm/index.html.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const CAPTURE = path.join(XML, 'capture');
const TEXTURES = path.join(XML, 'textures');
const REGISTRY = path.join(XML, 'spritesheet.bin');
/*
 * Where the chunks are written. The live store is recorded into while this
 * runs, so --copy points everything at a copy of it and the original is never
 * opened for writing.
 */
const OUT = process.argv.includes('--copy')
  ? path.join(root, 'local', 'realm-copy')
  : path.join(root, 'local', 'realm');
const REBUILD = process.argv.includes('--rebuild') || process.argv.includes('--fresh');

const PX = 8;                    // pixels drawn per game tile
const CHUNK = 128;               // tiles per chunk, so 1024px images

/* ------------------------------------------------------------------ *
 * PNG                                                                 *
 * ------------------------------------------------------------------ */
function readPng(buffer) {
  let at = 8, width = 0, height = 0;
  const parts = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const kind = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    else if (kind === 'IDAT') parts.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
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

/*
 * The same, for a picture that is one byte a pixel.
 *
 * Some of what is written here is not a picture at all - the water index is a
 * lookup with one number per tile, and it was being written as four channels
 * with three of them repeating the first and a fourth saying 255 four million
 * times. Deflate is good at constant planes, so this is not the three quarters
 * it looks like, but it is measured at three fifths of the file, and it is the
 * single largest thing the page fetches before it can draw anything.
 *
 * Nothing downstream changes: a grey PNG drawn onto a canvas comes back out of
 * getImageData with red, green and blue all set to the value, which is what
 * the reader was taking anyway.
 */
function writeGreyPng(width, height, bytes) {
  /*
   * Unfiltered, on the evidence.
   *
   * PNG lets every scanline say how it was encoded, and the usual advice is
   * to try all five and keep whichever leaves the smallest numbers in the
   * row. That was tried here and it made the file bigger - eight hundred and
   * thirty-six kilobytes against seven hundred and fourteen - because this is
   * a lookup rather than a picture: it is long runs of one value, and a run
   * is exactly what deflate is best at and exactly what a difference filter
   * destroys. Every uniform filter was measured too, and none beat none.
   */
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    bytes.copy(raw, y * (width + 1) + 1, y * width, y * width + width);
  }
  const chunk = (kind, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(kind, 4, 'ascii');
    body.copy(out, 8);
    out.writeInt32BE(crc(Buffer.concat([Buffer.from(kind, 'ascii'), body])), body.length + 8);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; head[9] = 0;                        // eight bits, grey, no alpha
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function writePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const chunk = (kind, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(kind, 4, 'ascii');
    body.copy(out, 8);
    out.writeInt32BE(crc(Buffer.concat([Buffer.from(kind, 'ascii'), body])), body.length + 8);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; head[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
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
  for (let i = 0; i < buffer.length; i++) c = CRC[(c ^ buffer[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}

/* ------------------------------------------------------------------ *
 * The sprite registry                                                 *
 * ------------------------------------------------------------------ */
class Flat {
  constructor(buffer) { this.b = buffer; }
  u8(at) { return this.b.readUInt8(at); }
  i16(at) { return this.b.readInt16LE(at); }
  i32(at) { return this.b.readInt32LE(at); }
  u32(at) { return this.b.readUInt32LE(at); }
  f32(at) { return this.b.readFloatLE(at); }
  root() { return this.u32(0); }
  indirect(at) { return at + this.u32(at); }
  fields(table) {
    const vtable = table - this.i32(table);
    const size = this.i16(vtable);
    const out = [];
    for (let i = 4; i < size; i += 2) {
      const offset = this.i16(vtable + i);
      out.push(offset ? table + offset : 0);
    }
    return out;
  }
  vector(at) {
    if (!at) return { at: 0, length: 0 };
    const start = this.indirect(at);
    return { at: start + 4, length: this.u32(start) };
  }
  string(at) {
    if (!at) return '';
    const start = this.indirect(at);
    return this.b.toString('utf8', start + 4, start + 4 + this.u32(start));
  }
}

const SHEET_OF = { 1: 'groundTiles', 4: 'mapObjects' };

function loadRegistry() {
  const flat = new Flat(fs.readFileSync(REGISTRY));
  const atlases = new Map();
  const list = flat.vector(flat.fields(flat.root())[0]);
  for (let i = 0; i < list.length; i++) {
    const fields = flat.fields(flat.indirect(list.at + i * 4));
    const sprites = flat.vector(fields[2]);
    const rects = new Map();
    for (let s = 0; s < sprites.length; s++) {
      const sprite = flat.fields(flat.indirect(sprites.at + s * 4));
      if (!sprite[0] || !sprite[7]) continue;
      // A sprite is filed under the number it carries, not where it sits: the
      // vector is sorted by the text of that number, so it runs 0, 1, 10, 11,
      // 12, 121, 13 and position is index only for the first two entries.
      const index = sprite[3] ? flat.i32(sprite[3]) : 0;
      if (rects.has(index)) continue;
      rects.set(index, {
        x: Math.round(flat.f32(sprite[0])),
        y: Math.round(flat.f32(sprite[0] + 4)),
        w: Math.round(flat.f32(sprite[0] + 8)),
        h: Math.round(flat.f32(sprite[0] + 12)),
        sheet: SHEET_OF[flat.i32(sprite[7])] || null
      });
    }
    atlases.set(flat.string(fields[0]), rects);
  }
  return atlases;
}

/* ------------------------------------------------------------------ *
 * What the client calls things, and what it draws for them            *
 * ------------------------------------------------------------------ */
function readXml(prefix, tag) {
  const out = new Map();
  const shape = new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)</' + tag + '>', 'g');
  for (const file of fs.readdirSync(XML).filter(name => new RegExp('^' + prefix + '\\.').test(name))) {
    const text = fs.readFileSync(path.join(XML, file), 'utf8');
    for (const m of text.matchAll(shape)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      const id = /id="([^"]*)"/.exec(m[1]);
      if (!type) continue;
      const key = Number(type[1]) & 0xffff;
      if (out.has(key)) continue;
      /*
       * Every picture the thing can wear, not just the first.
       *
       * More than half of what stands in the realm declares a RandomTexture -
       * a list the client draws one of, per thing, at random. Taking the first
       * one drew every clump of rocks in the Ancient City as the same clump
       * and every tree as the same tree, which is why the whole map read as a
       * simplified version of itself. The list is kept whole and one is chosen
       * per thing from where it stands, so the realm is as varied as the game
       * and identical every time it is drawn.
       */
      const random = /<RandomTexture>([\s\S]*?)<\/RandomTexture>/.exec(m[2]);
      const animated = /<AnimatedTexture>([\s\S]*?)<\/AnimatedTexture>/.exec(m[2]);
      const plain = /<Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>\s*<\/Texture>/.exec(m[2]);
      const wears = [];
      const gather = text => {
        for (const one of text.matchAll(/<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/g)) {
          wears.push({ atlas: one[1].trim(), index: Number(one[2]) });
        }
      };
      if (random) gather(random[1]);
      else if (animated) gather(animated[1]);
      else if (plain) wears.push({ atlas: plain[1].trim(), index: Number(plain[2]) });
      else gather(m[2]);
      const size = /<Size>([^<]+)<\/Size>/.exec(m[2]);
      const sort = /<Class>([^<]*)<\/Class>/.exec(m[2]);
      // What flies, flies. A bat declares a quarter of a tile and the client
      // draws it that far up the screen from where it actually is.
      const high = /<Z>([^<]+)<\/Z>/.exec(m[2]);
      /*
       * And the flipbook, for the things that never stand still. A dungeon
       * portal, a torch, a campfire, a captured beacon: each declares a run
       * of frames and how long to hold each one, and drawing only the first
       * left the whole realm holding its breath.
       */
      const reel = /<Animation\b([^>]*)>([\s\S]*?)<\/Animation>/.exec(m[2]);
      const flips = [];
      let beat = 0;
      if (reel) {
        for (const one of reel[2].matchAll(
          /<Frame\b([^>]*)>\s*<Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/g)) {
          /*
           * Held for a sane length of time. A frame that is meant to stay put
           * until something happens declares a time in the millions, and a
           * run summed straight from those takes a day to play once.
           */
          const said = Number((/time="([^"]+)"/.exec(one[1]) || [0, 0.2])[1]) || 0.2;
          const held = Math.max(0.04, Math.min(1.5, said));
          flips.push({ atlas: one[2].trim(), index: Number(one[3]) });
          beat += held;
        }
      }
      /*
       * And how it meets what lies beside it. Where two grounds touch, the
       * one that ranks higher bleeds across the seam - sand into grass, grass
       * into dirt - unless either of them says not to. A ground that asks for
       * a random offset is drawn nudged off the grid.
       */
      const rank = /<BlendPriority>([^<]+)<\/BlendPriority>/.exec(m[2]);
      /*
       * And whether it moves. Water, lava and the like carry a drift in tiles
       * a second and a manner: Flow runs one way for ever, the way a river
       * or a lava channel does, and Wave rocks back and forth, the way open
       * sea does.
       */
      const move = /<Animate([^>]*)>([^<]*)<\/Animate>/.exec(m[2]);
      const drift = move ? {
        dx: Number((/dx="([^"]+)"/.exec(move[1]) || [0, 0])[1]) || 0,
        dy: Number((/dy="([^"]+)"/.exec(move[1]) || [0, 0])[1]) || 0,
        wave: /wave/i.test(move[2])
      } : null;
      /*
       * Some grounds carry their own border. A castle rug is a plain red
       * square and the gold line round it is a second picture, laid on the
       * squares that sit at the rug's edge and turned to face outwards:
       * a strip for one side, a piece for two sides meeting, and a small
       * corner for where the rug turns back on itself.
       */
      const piece = tag => {
        const found = new RegExp('<' + tag + '>\\s*<Texture>\\s*<File>([^<]+)</File>'
          + '\\s*<Index>([^<]+)</Index>').exec(m[2]);
        return found ? { atlas: found[1].trim(), index: Number(found[2]) } : null;
      };
      const edge = piece('Edge'), bend = piece('InnerCorner'), nub = piece('Corner');
      out.set(key, {
        id: id ? id[1] : String(key),
        sort: sort ? sort[1].trim() : '',
        /*
         * Whether the client calls it an enemy, which is the only reliable
         * way to tell a creature from a piece of scenery. Not the class: a
         * Goblin Village Bush is a Character and is a bush, and a Barnacle
         * Rock is a Character with three thousand hit points and is a
         * monster. Not the name either, for the same reason.
         */
        enemy: /<Enemy\s*\/>/.test(m[2]),
        /*
         * Whether it is masonry rather than dressing.
         *
         * A wall may never be thinned out - a wall with a gap in it is not a
         * thinner wall, it is a different wall - and the client says which is
         * which plainly enough once the right question is asked. Occupying
         * its square is the wrong question: a tree occupies its square too,
         * and guarding everything that does left a forest with three hundred
         * and seventy-eight trees to the thousand tiles exactly as it was.
         * What separates them is that a wall is filed as a Wall, fills its
         * square outright and cannot be seen through, and a tree does none of
         * those things.
         */
        blocks: /<Class>Wall<\/Class>/.test(m[2])
          || /<(FullOccupy|BlocksSight)\s*\/>/.test(m[2]),
        wears,
        moving: !!animated && !random,
        blend: rank ? Number(rank[1]) : 0,
        lift: high ? Math.max(0, Math.min(8, Number(high[1]) || 0)) : 0,
        flips, beat: beat || 1,
        drift,
        edge, bend, nub,
        still: /<NoBlend\s*\/?>/i.test(m[2]),
        // Ground nothing can cross: the mountains that ring the Deep Sea,
        // which stand where the map would otherwise simply stop.
        noWalk: /<NoWalk\s*\/?>/i.test(m[2]),
        jitter: /<RandomOffset\s*\/?>/.test(m[2]),
        // What the client scales it to. A spider at fifty is drawn half size,
        // and drawing everything at a hundred made the small things big.
        size: size ? Math.max(10, Math.min(400, Number(size[1]))) : 100,
        atlas: wears.length ? wears[0].atlas : null,
        index: wears.length ? wears[0].index : null
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The recordings                                                      *
 * ------------------------------------------------------------------ */
/*
 * Everything recorded so far, kept between runs.
 *
 * A recording is read once. What comes out of it is folded into a store that
 * lives in local/realm/, alongside a ledger naming every file already folded
 * in and how big it was at the time; a file that is in the ledger unchanged is
 * not opened again. So the cost of a run is the cost of the new recording,
 * not of every recording ever made, and the map only ever grows.
 *
 * The store is written as plain numbers rather than as text — three unsigned
 * shorts a tile, ten bytes an object — because at a million tiles the same
 * thing as JSON is forty megabytes of digits and quotation marks.
 */
const STORE = path.join(OUT, 'store.bin');
const LEDGER = path.join(OUT, 'ledger.json');
const KEY = 1e5;

function loadStore() {
  const tiles = new Map();
  const objects = new Map();
  let ledger = { files: {} };
  if (REBUILD) return { tiles, objects, ledger };
  if (fs.existsSync(LEDGER)) {
    try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { ledger = { files: {} }; }
  }
  if (fs.existsSync(STORE)) {
    const b = zlib.gunzipSync(fs.readFileSync(STORE));
    let at = 0;
    const tileCount = b.readUInt32LE(at); at += 4;
    const objectCount = b.readUInt32LE(at); at += 4;
    for (let i = 0; i < tileCount; i++) {
      const x = b.readUInt16LE(at), y = b.readUInt16LE(at + 2), type = b.readUInt16LE(at + 4);
      at += 6;
      tiles.set(y * KEY + x, type);
    }
    for (let i = 0; i < objectCount; i++) {
      const type = b.readUInt16LE(at);
      const x = b.readFloatLE(at + 2), y = b.readFloatLE(at + 6);
      at += 10;
      const key = Math.floor(y) * KEY + Math.floor(x);
      if (!objects.has(key)) objects.set(key, []);
      objects.get(key).push({ type, x, y });
    }
  }
  return { tiles, objects, ledger };
}

function saveStore(tiles, objects, ledger) {
  let objectCount = 0;
  for (const here of objects.values()) objectCount += here.length;
  const b = Buffer.alloc(8 + tiles.size * 6 + objectCount * 10);
  b.writeUInt32LE(tiles.size, 0);
  b.writeUInt32LE(objectCount, 4);
  let at = 8;
  for (const [key, type] of tiles) {
    const x = key % KEY, y = (key - x) / KEY;
    b.writeUInt16LE(x, at); b.writeUInt16LE(y, at + 2); b.writeUInt16LE(type, at + 4);
    at += 6;
  }
  for (const here of objects.values()) {
    for (const o of here) {
      b.writeUInt16LE(o.type & 0xffff, at);
      b.writeFloatLE(o.x, at + 2); b.writeFloatLE(o.y, at + 6);
      at += 10;
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STORE, zlib.gzipSync(b, { level: 6 }));
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n');
}

/*
 * Fold in whatever is new. A recording is identified by its name together
 * with its size, so a file that is rewritten under the same name is folded in
 * again rather than being taken on trust.
 */
function foldNew(tiles, objects, ledger, dirty) {
  const added = [];
  if (!fs.existsSync(CAPTURE)) return added;
  for (const file of fs.readdirSync(CAPTURE).filter(n => /\.json$/.test(n)).sort()) {
    const full = path.join(CAPTURE, file);
    const stat = fs.statSync(full);
    const size = stat.size;
    const at = Math.round(stat.mtimeMs);
    const known = ledger.files[file];
    // Size and time both, so a file rewritten in place - which is what a
    // decoder writing as it goes does - is folded in again rather than taken
    // on trust because its name has been seen before.
    if (known && known.size === size && known.at === at) continue;
    let seen;
    try { seen = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
    if (!Array.isArray(seen.tiles) || !seen.tiles.length) continue;
    for (const tile of seen.tiles) {
      tiles.set(tile.y * KEY + tile.x, tile.type);
      if (dirty) dirty.add(Math.floor(tile.x / CHUNK) + '_' + Math.floor(tile.y / CHUNK));
    }
    let objectCount = 0;
    for (const object of seen.observedObjects || []) {
      const key = Math.floor(object.y) * KEY + Math.floor(object.x);
      if (!objects.has(key)) objects.set(key, []);
      const here = objects.get(key);
      if (here.some(old => old.type === object.type && old.x === object.x && old.y === object.y)) continue;
      here.push({ type: object.type, x: object.x, y: object.y });
      objectCount++;
      /*
       * An object taller than its tile leans onto the chunk above it, so a
       * new one makes its neighbours stale as well as its own square.
       */
      if (dirty) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            dirty.add(Math.floor((object.x + dx * 4) / CHUNK) + '_'
              + Math.floor((object.y + dy * 4) / CHUNK));
          }
        }
      }
    }
    /*
     * How much of its own bounding box a recording actually filled. A walk
     * covers a corridor, so this is never near a hundred; but a recording
     * that was cut off mid-stream — which the capture says of itself in
     * stopReason — will be conspicuously thin, and that is worth seeing
     * before wondering why the map has holes in it.
     */
    const b = seen.bounds || {};
    const area = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
    added.push({
      file, tiles: seen.tiles.length, objects: objectCount,
      fill: area > 0 ? seen.tiles.length / area : 0,
      whole: seen.completePrefix !== false,
      stopped: seen.stopReason || ''
    });
    ledger.files[file] = { size, at, tiles: seen.tiles.length, objects: objectCount };
  }
  return added;
}

/* ------------------------------------------------------------------ *
 * Draw                                                                *
 * ------------------------------------------------------------------ */
function prepare() {
  for (const needed of [REGISTRY, path.join(TEXTURES, 'groundTiles.png')]) {
    if (!fs.existsSync(needed)) {
      console.error('\n  ' + path.relative(root, needed) + ' is missing. Run:'
        + '\n    node tools/extract-client-textures.js\n');
      process.exit(1);
    }
  }
  const atlases = loadRegistry();
  const grounds = readXml('GroundTypes', 'Ground');
  const objectKinds = readXml('Objects', 'Object');

  const sheets = new Map();
  const sheetFor = name => {
    if (!sheets.has(name)) {
      const file = path.join(TEXTURES, name + '.png');
      const img = fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null;
      if (img) img.name = name;
      sheets.set(name, img);
    }
    return sheets.get(name);
  };

  /*
   * A type resolved to a piece of a sheet, once. Ground is cut to the eight
   * pixels the game draws - the registry files it as ten with a pixel of
   * packer's padding all round. An object keeps its whole rectangle, because
   * its size is part of what it is.
   */
  const art = new Map();
  const cut = (atlas, index, isGround) => {
    const rects = atlases.get(atlas);
    const rect = rects && rects.get(index);
    const sheet = rect && rect.sheet && sheetFor(rect.sheet);
    if (!rect || !sheet) return null;
    if (rect.x + rect.w > sheet.width || rect.y + rect.h > sheet.height) return null;
    if (isGround) {
      /*
       * A ground tile is filed as ten pixels for the eight it draws. The ring
       * round the outside is not packer's waste - it is bleed, and it is what
       * lets a tile be drawn a pixel off its square without tearing.
       */
      const w = Math.min(8, rect.w), h = Math.min(8, rect.h);
      return {
        sheet, w, h,
        x: rect.x + ((rect.w - w) >> 1),
        y: rect.y + ((rect.h - h) >> 1),
        pad: Math.min((rect.w - w) >> 1, (rect.h - h) >> 1)
      };
    }
    /*
     * The dark rim the game draws round everything that stands up.
     *
     * Written at one opacity and no other, so that anything downstream can
     * tell the line from the art without being told which is which - the
     * chunk baker relies on exactly that.
     *
     * The art does not carry one: measured over the whole realm, a sprite's
     * silhouette is as bright as its middle - a hundred and two against a
     * hundred and four - and only one picture in seven has an edge darker
     * than its inside. So the game puts it there, and it is most of why the
     * scenery and the creatures read as objects on the ground rather than as
     * patterns in it.
     *
     * The picture is copied out with a pixel of room round it, and every
     * clear pixel touching a solid one is filled with a darkened version of
     * what it touches - dark, but not flat black, so a pale thing keeps a
     * grey edge and a red thing a maroon one, the way the art does.
     */
    const pad = 1;
    const w = rect.w + pad * 2, h = rect.h + pad * 2;
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const f = ((rect.y + y) * sheet.width + rect.x + x) * 4;
        sheet.pixels.copy(pixels, ((y + pad) * w + x + pad) * 4, f, f + 4);
      }
    }
    const near = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const rim = Buffer.from(pixels);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = (y * w + x) * 4;
        if (pixels[at + 3] > 8) continue;              // already something here
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of near) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const from = (ny * w + nx) * 4;
          if (pixels[from + 3] < 9) continue;
          r += pixels[from]; g += pixels[from + 1]; b += pixels[from + 2]; n++;
        }
        if (!n) continue;
        rim[at] = (r / n) * 0.22; rim[at + 1] = (g / n) * 0.22;
        rim[at + 2] = (b / n) * 0.30; rim[at + 3] = RIM_ALPHA;
      }
    }
    return {
      sheet: { width: w, height: h, pixels: rim, name: rect.sheet + '#' + atlas + ':' + index },
      x: 0, y: 0, w, h, pad
    };
  };

  /*
   * Every picture a kind of thing can wear, cut once and kept.
   *
   * A thing that declares a RandomTexture wears one of a list, and which one
   * is settled where it stands rather than here - so the same clump of rocks
   * is the same clump every time the map is drawn, and the clump beside it is
   * a different one.
   */
  const wardrobe = new Map();
  const lookOf = (kinds, type, isGround, at) => {
    const key = (isGround ? 'g' : 'o') + type;
    let worn = wardrobe.get(key);
    if (worn === undefined) {
      const kind = kinds.get(type);
      worn = [];
      for (const one of (kind && kind.wears) || (kind && kind.atlas ? [kind] : [])) {
        const made = cut(one.atlas, one.index, isGround);
        if (made) worn.push(made);
      }
      if (worn.length) worn.size = (kind && kind.size) || 100;
      wardrobe.set(key, worn);
    }
    if (!worn.length) return null;
    if (worn.length === 1) return worn[0];
    // Settled by where it stands: stable between runs, varied across the map.
    let n = Math.imul((at | 0) ^ 0x9e3779b9, 0x85ebca6b);
    n = (n ^ (n >>> 13)) >>> 0;
    return worn[n % worn.length];
  };
  /*
   * The five masks the ground is blended through, lifted off the sheet into
   * plain arrays of alpha. Each is four pixels square, which is a quarter of
   * a tile: the client cuts every tile into four and decides each quarter
   * separately from the three neighbours that touch it.
   *
   *   sides    - one neighbour along an edge, fading over four pixels
   *   inner    - two neighbours meeting, the same ground round the corner
   *   innerP1  - the half of that corner belonging to the one above
   *   innerP2  - the half belonging to the one beside, when they differ
   *   outer    - only the diagonal touches, so just the tip of the corner
   *
   * They are drawn once, pointing right and up; every other direction is the
   * same sixteen numbers read backwards.
   */
  const maskOf = name => {
    const worn = [];
    const rects = atlases.get(name);
    if (!rects) return worn;
    for (const rect of rects.values()) {
      const sheet = rect.sheet && sheetFor(rect.sheet);
      if (!sheet || rect.w !== 4 || rect.h !== 4) continue;
      const a = new Uint8Array(16);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          a[y * 4 + x] = sheet.pixels[((rect.y + y) * sheet.width + rect.x + x) * 4 + 3];
        }
      }
      worn.push(a);
    }
    return worn;
  };
  const masks = {
    sides: maskOf('sides_mask'),
    inner: maskOf('inner_mask'),
    outer: maskOf('outer_mask'),
    p1: maskOf('innerP1_mask'),
    p2: maskOf('innerP2_mask')
  };

  /*
   * The trim of a ground, cut once. All three pieces are whole opaque tiles,
   * so the client lays exactly one of them over a square rather than painting
   * a border on top of what is already there.
   */
  const trimCut = new Map();
  const trimFor = type => {
    if (trimCut.has(type)) return trimCut.get(type);
    const kind = grounds.get(type);
    let made = null;
    if (kind && (kind.edge || kind.bend || kind.nub)) {
      const one = t => (t ? cut(t.atlas, t.index, true) : null);
      made = { edge: one(kind.edge), bend: one(kind.bend), nub: one(kind.nub) };
      if (!made.edge && !made.bend && !made.nub) made = null;
    }
    trimCut.set(type, made);
    return made;
  };

  const sizeOf = (kinds, type) => {
    const kind = kinds.get(type);
    return kind && kind.size ? kind.size : 100;
  };
  return { grounds, objectKinds, lookOf, sizeOf, masks, trimFor, cutOne: cut,
    offMap: readOffMap(), beaconSwap: beaconSwap(objectKinds) };
}

// What the rim round a cut sprite is written at, and nothing else is.
const RIM_ALPHA = 96;

const side = CHUNK * PX;

/*
 * What does not belong on a map of a place.
 *
 * A recording keeps whatever was standing there, and some of it is the
 * afternoon rather than the realm: other players, their pets, the bags their
 * kills dropped, an attack still in the air. All of it comes back every time
 * more of the realm is walked, so it is turned away here - at the moment the
 * map is built, not cleaned off afterwards - from a list that can be added to
 * as more of it turns up.
 */
/*
 * Whether a picture has anything in it at all. Cached, because the same
 * handful of empty squares is asked about tens of thousands of times.
 */
const clearCache = new Map();
function allClear(look) {
  const key = look.sheet.name + ':' + look.x + ',' + look.y + ',' + look.w + ',' + look.h;
  let got = clearCache.get(key);
  if (got !== undefined) return got;
  got = true;
  const px = look.sheet.pixels, w = look.sheet.width;
  for (let j = 0; j < look.h && got; j++) {
    for (let i = 0; i < look.w; i++) {
      if (px[((look.y + j) * w + look.x + i) * 4 + 3] > 8) { got = false; break; }
    }
  }
  clearCache.set(key, got);
  return got;
}

/*
 * A beacon, shown with its guardian still standing.
 *
 * The client keeps four of every beacon and they are four different moments.
 * "Active Beacon Forest" is the one that is being fought over and it turns
 * through eleven frames. "Captured Beacon Forest" is what is left after the
 * guardian is dead, eight frames of something winding down. The other two are
 * single frames and do not move at all.
 *
 * A recording holds whichever of the four happened to be there when somebody
 * walked past, and on this map that is mostly the still one and twice the
 * one that has already been won - so the beacons either sat there doing
 * nothing or played the aftermath of a fight on a loop. A map is not a replay
 * of one afternoon: it should show a beacon as a beacon, which is guarded.
 *
 * So whichever was recorded, the picture used is the active one. Only the
 * picture: the beacon keeps its own name and the state it was found in, which
 * is what the page says about it when it is clicked.
 */
/*
 * Which of these are the same beacon in a different mood, and which is a
 * different object standing near one.
 *
 * "Captured Beacon Shore" and "Actual Active Beacon Shore" are the same thing
 * before and after its guardian dies, and either of them should be shown as
 * it looks while there is still a fight to be had. "Teleport Beacon Shore" is
 * not: it is the pad, and it stands three tiles south of the beacon in every
 * one of the eight places both were walked past. Giving it the beacon's
 * picture put two beacons at every beacon, which is what it looked like.
 */
const BEACON_STATE = /^(Actual Active|Captured)\s+Beacon\s+(.+)$/;

function beaconSwap(objectKinds) {
  const active = new Map();
  for (const [type, kind] of objectKinds) {
    const m = /^Active Beacon\s+(.+)$/.exec(kind.id || '');
    if (m) active.set(m[1].trim(), type);
  }
  const swap = new Map();
  for (const [type, kind] of objectKinds) {
    const m = BEACON_STATE.exec(kind.id || '');
    if (!m) continue;
    const alive = active.get(m[2].trim());
    if (alive !== undefined && alive !== type) swap.set(type, alive);
  }
  return swap;
}

function readOffMap() {
  const file = path.join(root, 'data', 'Realm', 'off-the-map.txt');
  const sorts = new Set(), ids = [], keep = new Set(), lives = new Set();
  const elsewhere = [];
  let blank = false, creatures = false;
  if (fs.existsSync(file)) {
    for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      line = line.replace(/\s*##.*$/, '').trim();
      if (!line) continue;
      // A directive with nothing after it, of which there is one.
      if (line === 'blank') { blank = true; continue; }
      if (line === 'creatures') { creatures = true; continue; }
      const cut = line.indexOf(' ');
      if (cut < 0) continue;
      const what = line.slice(0, cut), name = line.slice(cut + 1).trim();
      if (what === 'class') sorts.add(name);
      else if (what === 'id') ids.push(name);
      else if (what === 'keep') keep.add(name);
      else if (what === 'life') lives.add(name);
      else if (what === 'elsewhere') {
        const at = name.split(',').map(Number);
        if (at.length === 2 && at.every(Number.isFinite)) elsewhere.push(at);
      }
    }
  }
  /*
   * A star in a name stands for any tail, so a whole family can be turned
   * away by one line. A keep beats everything else.
   */
  const turnedAway = kind => {
    if (!kind) return false;
    if (keep.has(kind.id)) return false;
    if (creatures && kind.enemy) return true;
    if (sorts.has(kind.sort)) return true;
    return ids.some(one => {
      const star = one.indexOf('*');
      if (star < 0) return one === kind.id;
      return kind.id.startsWith(one.slice(0, star))
        && kind.id.endsWith(one.slice(star + 1));
    });
  };
  return { turnedAway, lives, elsewhere, blank, creatures,
    count: sorts.size + ids.length + (blank ? 1 : 0) };
}

/* ------------------------------------------------------------------ *
 * What stands in the realm, as a layer of its own                     *
 * ------------------------------------------------------------------ */
/*
 * Close up, the map stops treating the scenery as marks in the floor and
 * draws each thing as itself: sorted by how far down it stands so the near
 * one passes in front of the far one, and lifted by the height it carries so
 * what flies is seen to fly. That needs three things the floor pictures
 * cannot hold - every distinct picture in one sheet, where each thing stands,
 * and which picture it wears.
 *
 * Which picture matters: a thing with several to choose from settles on one
 * from where it stands, and the choice is made here exactly as it is made
 * when the floor is drawn, so the close view and the far view agree.
 */
/*
 * The water that moves.
 *
 * A fifth of the ground recorded in the realm drifts: a hundred and fifty
 * thousand tiles of open sea rocking gently, rivers running, lava creeping.
 * Baked into the floor it can only sit still, so the tiles that move are
 * listed here and the map draws them itself, sliding each one's own texture
 * under it.
 *
 * Only tiles walled in by their own kind are listed. A tile at the water's
 * edge has the sand blended across it, and sliding a whole tile over that
 * would cut the shoreline back to a hard step - so the edge keeps the floor
 * it was baked with and the open water moves.
 */
/*
 * Cloud, made of the client's own.
 *
 * There is exactly one cloud drawn anywhere in the client - a sixteen pixel
 * puff, lavender with a white top - and one puff is not a sky. Pixel cloud is
 * built the way it always is: the same puff stamped several times over at
 * whole pixel offsets until it reads as one lumpy mass, which is what makes
 * it look drawn rather than blurred.
 *
 * Six of them, so the sky is not one shape repeated, and each is written at
 * the grain the art is at. Nothing is ever drawn between pixels.
 */
const CLOUD_ART = [
  ['sorcEncountersObjects16x16', 408],           // the pale one
  ['mountainTempleObjects16x16', 0x70]           // and a dark one, for weight
];

/* ------------------------------------------------------------------ *
 * Oryx, reaching for the world                                        *
 * ------------------------------------------------------------------ */
/*
 * A head behind the planet, and a pair of hands closing on it.
 *
 * Not drawn the way the rest of the map is drawn, and deliberately. Every
 * other thing here is the game's own art at the game's own size, eight pixels
 * to the tile, and the only right thing to do with that is leave it alone.
 * This is not the game's art. The client has him at sixteen pixels square - a
 * small figure holding a sword - and sixteen pixels blown up to the width of
 * a planet is a smear. So he is built instead of borrowed, and built the way
 * a thing meant to frighten you is built: smooth, lit hard from one side,
 * black plate with a cold sheen on it, and two red eyes that are the only
 * warm thing anywhere in the frame.
 *
 * The method is the same for both pieces. A shape is a handful of strokes, a
 * stroke being either an ellipse or a curve walked with a radius that changes
 * as it goes - which is how you get a finger, or a horn. Each stroke is
 * stamped into a field that keeps, at every pixel, how far below the surface
 * that pixel lies and how thick the stroke was there. Those two give the
 * height of the surface above the page; the slope of that height gives the
 * direction the surface faces; and a direction is all a light needs.
 */

// Depth is kept a little way outside the surface too, so the edge can be soft.
const SKIN = 1.5;

function sculpt(w, h) {
  const deep = new Float32Array(w * h).fill(-1e9);  // pixels below the surface
  const thick = new Float32Array(w * h);            // and how fat it was there
  const who = new Int16Array(w * h).fill(-1);       // which stroke won
  const along = new Float32Array(w * h);            // and how far along it
  /*
   * And which layer it belongs to. Without one the deepest thing wins
   * everywhere, so a broad shape underneath swallows every small plate laid
   * on top of it - which is the wrong way round for armour, where the whole
   * point is that the near piece covers the far one whatever its thickness.
   */
  const tier = new Int8Array(w * h).fill(-128);
  let layer = 0;
  /*
   * A nearer layer takes a pixel only where it properly covers it.
   *
   * The soft outer pixels of a plate are half-covered by design, and letting
   * those overwrite the solid helm beneath punched a hairline of daylight
   * round every panel - which looked, on a white page, exactly like a bright
   * seam, and would have been a crack you could see the ocean through. So the
   * near piece wins where it is genuinely inside itself, and where it is only
   * feathering out it leaves what is underneath alone.
   */
  const beats = (at, under) => {
    if (layer < tier[at]) return false;
    if (layer > tier[at]) return under >= 0 || under > deep[at];
    return under > deep[at];
  };

  const stamp = (cx, cy, r, id, t) => {
    const reach = r + SKIN;
    const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(h - 1, Math.ceil(cy + reach));
    const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(w - 1, Math.ceil(cx + reach));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const under = r - Math.sqrt(dx * dx + dy * dy);
        if (under < -SKIN) continue;
        const at = y * w + x;
        if (!beats(at, under)) continue;
        deep[at] = under; thick[at] = r; who[at] = id; along[at] = t; tier[at] = layer;
      }
    }
  };

  // An ellipse, for a skull or a palm: rounder than a stroke, and not walked.
  const bulb = (cx, cy, rx, ry, id) => {
    const r = Math.min(rx, ry);
    const y0 = Math.max(0, Math.floor(cy - ry - SKIN)), y1 = Math.min(h - 1, Math.ceil(cy + ry + SKIN));
    const x0 = Math.max(0, Math.floor(cx - rx - SKIN)), x1 = Math.min(w - 1, Math.ceil(cx + rx + SKIN));
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / ry;
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / rx;
        const under = (1 - Math.sqrt(dx * dx + dy * dy)) * r;
        if (under < -SKIN) continue;
        const at = y * w + x;
        if (!beats(at, under)) continue;
        deep[at] = under; thick[at] = r; who[at] = id; along[at] = 0; tier[at] = layer;
      }
    }
  };

  // A curve walked from one end to the other, thinning as it goes.
  const limb = (x0, y0, bx, by, x1, y1, from, to, id) => {
    const run = Math.hypot(bx - x0, by - y0) + Math.hypot(x1 - bx, y1 - by);
    const steps = Math.ceil(run * 1.6) + 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      stamp(u * u * x0 + 2 * u * t * bx + t * t * x1,
        u * u * y0 + 2 * u * t * by + t * t * y1,
        from + (to - from) * t, id, t);
    }
  };

  /*
   * A plate of armour: a straight-sided panel, flat across the middle, with
   * the edge chamfered off.
   *
   * Strokes and ellipses can only make a thing that bulges, and plate does
   * not bulge - it is a flat face with a bright chamfer round it where it was
   * ground back, which is why armour reads as armour and not as a pillow. The
   * depth is the distance to the nearest edge, held at the width of the
   * chamfer, so the middle of the panel is dead flat and only the last few
   * pixels turn away from the lamp.
   *
   * The points must go round the outside of a shape with no dents in it.
   */
  const plate = (pts, id, bevel) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, twice = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]);
      y0 = Math.min(y0, a[1]); y1 = Math.max(y1, a[1]);
      twice += a[0] * b[1] - b[0] * a[1];
    }
    const turn = twice > 0 ? -1 : 1;                 // whichever way they wind
    const run = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const len = Math.hypot(ex, ey) || 1;
      run.push([a[0], a[1], ex / len, ey / len]);
    }
    const from = Math.max(0, Math.floor(y0 - SKIN)), to = Math.min(h - 1, Math.ceil(y1 + SKIN));
    const left = Math.max(0, Math.floor(x0 - SKIN)), right = Math.min(w - 1, Math.ceil(x1 + SKIN));
    for (let y = from; y <= to; y++) {
      for (let x = left; x <= right; x++) {
        let inside = 1e9;
        for (const [ax, ay, ex, ey] of run) {
          inside = Math.min(inside, ((x - ax) * ey - (y - ay) * ex) * turn);
          if (inside < -SKIN) break;
        }
        if (inside < -SKIN) continue;
        const under = Math.min(inside, bevel);
        const at = y * w + x;
        if (!beats(at, under)) continue;
        deep[at] = under; thick[at] = bevel; who[at] = id; along[at] = 0; tier[at] = layer;
      }
    }
  };

  return { w, h, deep, thick, who, along, bulb, limb, stamp, plate, on: n => { layer = n; } };
}

/*
 * Lit.
 *
 * One lamp above and to the left and a little in front of him, the sheen it
 * strikes off plate, and a red edge round everything that faces away - which
 * is not a light in the scene at all, but the thing that lets a black shape
 * read as a shape against black water instead of as a hole in the picture.
 */
const LAMP = (() => {
  const v = [-0.46, -0.74, 0.49], n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
const SHEEN = (() => {                                  // halfway to the eye
  const v = [LAMP[0], LAMP[1], LAMP[2] + 1], n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

function light(pad, paint, put, ox, oy) {
  const { w, h, deep, thick, who, along } = pad;
  /*
   * The height of the surface, pressed down.
   *
   * A stroke's true section is a half-circle, and a face built of true
   * half-circles is a heap of balloons: every piece of it turns through a
   * full ninety degrees, so every piece of it catches the lamp square on
   * somewhere and shines. Pressed to a third of its height the same shapes
   * keep their edges and lose their gloss, which is what carved plate does.
   */
  const tall = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(0, deep[i]), r = thick[i];
    tall[i] = r > 0 ? Math.sqrt(Math.max(0, d * (2 * r - d))) * 0.34 : 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = y * w + x;
      const cover = Math.max(0, Math.min(1, deep[at] + 0.5));
      if (cover <= 0) continue;
      const l = x > 0 ? tall[at - 1] : 0, r = x < w - 1 ? tall[at + 1] : 0;
      const u = y > 0 ? tall[at - w] : 0, d = y < h - 1 ? tall[at + w] : 0;
      let nx = l - r, ny = u - d, nz = 2.4;
      /*
       * And the way the whole panel is set, on top of the way its own surface
       * runs. A plate is flat, so every pixel of it faces exactly forward and
       * every plate takes exactly the same light - which is a paper model,
       * not armour. Armour is a dozen panels each canted a little differently,
       * and that is one number per panel rather than a shape.
       */
      const set = paint.set && paint.set[who[at]];
      if (set) { nx += set[0]; ny += set[1]; }
      const n = Math.hypot(nx, ny, nz) || 1;
      nx /= n; ny /= n; nz /= n;

      const lam = Math.max(0, nx * LAMP[0] + ny * LAMP[1] + nz * LAMP[2]);
      const sh = Math.pow(Math.max(0, nx * SHEEN[0] + ny * SHEEN[1] + nz * SHEEN[2]), 64);
      const rim = Math.pow(1 - Math.min(1, nz), 2.6);

      /*
       * Plate. A groove where one piece of armour laps over the next, and a
       * lit lip on the near side of it - stepped off how far along its own
       * stroke the pixel lies, so the bands follow a finger round its bend
       * rather than being ruled straight across it.
       */
      let lap = 1;
      const bands = paint.bands[who[at]] || 0;
      if (bands) {
        const f = (along[at] * bands) % 1;
        if (f < 0.09) lap = 0.26 + f / 0.09 * 0.5;
        else if (f < 0.2) lap = 0.76 + (f - 0.09) / 0.11 * 0.62;
      }

      const coat = paint.coat[who[at]] || paint.coat.d;
      const out = [0, 0, 0];
      // The last pixel of the silhouette goes towards nothing, which is the line.
      const edge = 0.34 + 0.66 * Math.min(1, deep[at] / 2.2);
      for (let c = 0; c < 3; c++) {
        const v = (coat.base[c] + Math.pow(lam, 1.25) * coat.lit[c]) * lap
          + sh * coat.hot[c] + rim * coat.edge[c];
        out[c] = Math.max(0, Math.min(255, Math.round(v * edge)));
      }
      put(ox + x, oy + y, out, Math.round(cover * 255));
    }
  }
}

// Black plate, steel at the edges of it, and a red light off the rim.
const PLATE = { base: [8, 8, 11], lit: [34, 35, 46], hot: [48, 51, 64], edge: [146, 26, 20] };
const CLAW = { base: [15, 14, 16], lit: [62, 61, 66], hot: [188, 190, 200], edge: [168, 44, 32] };
const HORN = { base: [13, 10, 11], lit: [40, 33, 33], hot: [126, 114, 114], edge: [184, 38, 27] };

/*
 * Given art, if any has been left for him.
 *
 * A head somebody drew beats a head built out of arithmetic every time, so a
 * picture at data/Realm/oryx-head.png is used exactly as it stands and all
 * the sculpting below is skipped. Two courtesies to whoever leaves it there.
 * The white field a picture saved from almost anywhere arrives with is taken
 * out - by flooding in from the border, so white *inside* the drawing, which
 * is a highlight and wanted, is left alone. And it is then trimmed to what is
 * actually drawn, so he is placed on the screen by his own horns rather than
 * by the size of the paper he came on.
 */
const HEAD_ART = path.join(root, 'data', 'Realm', 'oryx-head.png');
const HEAD_MOST = 720;                   // pixels across, past which it is eased down
const HAND_ART = path.join(root, 'data', 'Realm', 'oryx-hands.png');
const HAND_MOST = 540;                   // and the same for one hand

/*
 * A picture read, cleaned and cut down to what is drawn on it.
 *
 * `from` and `to` say which slice of the width to take, so one file holding
 * two hands can be read as two pictures without being cut up by hand first.
 */
function givenArt(where, most, from, to) {
  if (!fs.existsSync(where)) return null;
  const img = readPng(fs.readFileSync(where));
  const { width: w, height: h } = img;
  const px = Buffer.from(img.pixels);

  // The paper: white, and reachable from the edge without crossing the drawing.
  // A picture that arrives already cut out has none, and the flood finds none.
  const paper = new Uint8Array(w * h);
  const queue = [];
  const pale = at => px[at + 3] > 8
    && px[at] > 232 && px[at + 1] > 232 && px[at + 2] > 232;
  const look = (x, y) => {
    const at = (y * w + x) * 4;
    if (paper[y * w + x]) return;
    if (px[at + 3] <= 8) { paper[y * w + x] = 1; queue.push(y * w + x); return; }
    if (!pale(at)) return;
    paper[y * w + x] = 1; queue.push(y * w + x);
  };
  for (let x = 0; x < w; x++) { look(x, 0); look(x, h - 1); }
  for (let y = 0; y < h; y++) { look(0, y); look(w - 1, y); }
  while (queue.length) {
    const at = queue.pop(), x = at % w, y = (at - x) / w;
    if (x > 0) look(x - 1, y);
    if (x < w - 1) look(x + 1, y);
    if (y > 0) look(x, y - 1);
    if (y < h - 1) look(x, y + 1);
  }
  for (let i = 0; i < w * h; i++) if (paper[i]) px[i * 4 + 3] = 0;

  // What is left of it, and where - within the slice that was asked for.
  const only0 = Math.max(0, Math.floor(from * w)), only1 = Math.min(w - 1, Math.ceil(to * w) - 1);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = only0; x <= only1; x++) {
      if (px[(y * w + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;                       // nothing but paper
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

  /*
   * Eased down if it is enormous, by averaging every source pixel that falls
   * under the new one rather than by picking one of them - a horn a pixel
   * wide survives an average and vanishes from a sample. Averaged in
   * proportion to how solid each source pixel is, too, so the colour of a
   * feathered edge is the colour of the drawing and not a wash of it with
   * whatever the emptiness beside it happens to hold.
   */
  const by = Math.max(1, cw / most);
  const ow = Math.max(1, Math.round(cw / by)), oh = Math.max(1, Math.round(ch / by));
  const out = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const fromY = y0 + Math.floor(y * by), toY = Math.min(y1, y0 + Math.ceil((y + 1) * by) - 1);
    for (let x = 0; x < ow; x++) {
      const fromX = x0 + Math.floor(x * by), toX = Math.min(x1, x0 + Math.ceil((x + 1) * by) - 1);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = fromY; sy <= toY; sy++) {
        for (let sx = fromX; sx <= toX; sx++) {
          const at = (sy * w + sx) * 4, weight = px[at + 3] / 255;
          r += px[at] * weight; g += px[at + 1] * weight; b += px[at + 2] * weight;
          a += px[at + 3]; n++;
        }
      }
      if (!n) continue;
      const lit = a / 255 || 1;
      const at = (y * ow + x) * 4;
      out[at] = Math.round(r / lit); out[at + 1] = Math.round(g / lit);
      out[at + 2] = Math.round(b / lit); out[at + 3] = Math.round(a / n);
    }
  }
  return { w: ow, h: oh, pixels: out };
}

const givenHead = () => givenArt(HEAD_ART, HEAD_MOST, 0, 1);

/*
 * The two hands, out of one picture.
 *
 * They are drawn facing each other with clear air between them, so the split
 * is the emptiest column in the middle third of the sheet rather than the
 * exact middle - which would cut a finger off whichever of them reaches
 * further. Each is then read as its own picture and trimmed to itself.
 */
function givenHands() {
  if (!fs.existsSync(HAND_ART)) return null;
  const img = readPng(fs.readFileSync(HAND_ART));
  const { width: w, height: h, pixels } = img;
  let split = Math.floor(w / 2), emptiest = Infinity;
  for (let x = Math.floor(w * 0.34); x < Math.ceil(w * 0.66); x++) {
    let ink = 0;
    for (let y = 0; y < h; y++) if (pixels[(y * w + x) * 4 + 3] > 8) ink++;
    if (ink < emptiest) { emptiest = ink; split = x; }
  }
  if (emptiest > h * 0.02) {
    console.log('  the two hands do not part cleanly - ' + emptiest + ' pixels at the seam');
  }
  const left = givenArt(HAND_ART, HAND_MOST, 0, split / w);
  const right = givenArt(HAND_ART, HAND_MOST, split / w, 1);
  if (!left || !right) return null;
  console.log('  and the hands left for him, ' + left.w + 'x' + left.h
    + ' and ' + right.w + 'x' + right.h + ', parted at ' + split);
  return { left, right };
}

/*
 * Lit by the world, and by his own eyes, and by nothing else.
 *
 * He is in space. There is no sun in the frame and no sky to bounce anything
 * back, so the only two things throwing light are the blue face of the planet
 * below him and the two red lamps in his helm - and a picture drawn in a
 * studio arrives evenly lit from everywhere, which reads as a photograph
 * pasted onto a starfield rather than as a thing that is out there.
 *
 * So the studio light is taken back off. Every pixel is dimmed by how far it
 * lies from the lamps that are actually in the scene, and tinted by them
 * besides: cold and blue where the world reaches it, red near the eyes, and
 * down to almost nothing at the far tips of the horns, which have nothing
 * anywhere near them.
 */
const VOID = [26, 30, 44];               // what the starfield alone is worth
const EARTHSHINE = [150, 196, 255];      // the blue face of the world below
const EYELIGHT = [255, 82, 48];          // and the two lamps in the helm

function inSpace(px, w, h, lamps) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (y * w + x) * 4;
      if (!px[at + 3]) continue;
      const lit = [VOID[0] / 255, VOID[1] / 255, VOID[2] / 255];
      for (const lamp of lamps) {
        const d = Math.hypot(x - lamp.x, y - lamp.y);
        const fall = lamp.power * Math.exp(-d / lamp.reach);
        for (let k = 0; k < 3; k++) lit[k] += (lamp.colour[k] / 255) * fall;
      }
      for (let k = 0; k < 3; k++) {
        px[at + k] = Math.max(0, Math.min(255, Math.round(px[at + k] * Math.min(1, lit[k]))));
      }
    }
  }
}

/*
 * Where the lamps in his helm are, found rather than written down: the two
 * hottest red places in the picture, one in each half of it. Written down,
 * they would be wrong the moment a different picture was left for him.
 */
function findEyes(px, w, h) {
  const eyes = [];
  for (const half of [0, 1]) {
    let sx = 0, sy = 0, n = 0, most = 0;
    const from = half ? Math.floor(w / 2) : 0, to = half ? w : Math.floor(w / 2);
    for (let y = 0; y < h; y++) {
      for (let x = from; x < to; x++) {
        const at = (y * w + x) * 4;
        if (!px[at + 3]) continue;
        const red = px[at] - Math.max(px[at + 1], px[at + 2]);
        if (px[at] < 190 || red < 60) continue;
        const weight = red * px[at];
        sx += x * weight; sy += y * weight; n += weight;
        most = Math.max(most, red);
      }
    }
    if (n > 0 && most > 90) eyes.push({ x: sx / n, y: sy / n });
  }
  return eyes;
}

function buildOryx() {
  /*
   * The hand reaches to the left: a forearm at the right edge, a fist of a
   * palm, four fingers curling in on the world and a thumb coming up under
   * them. The other hand is this one turned over, so the pair always match.
   */
  const paws = givenHands();
  const HW = 186, HH = 252;
  const hand = sculpt(HW, HH);
  hand.limb(196, 168, 176, 126, 148, 112, 38, 32, 1);      // the forearm
  hand.bulb(126, 122, 44, 50, 0);                          // the palm
  hand.bulb(100, 92, 30, 24, 0);                           // the knuckles
  hand.limb(104, 74, 56, 54, 26, 88, 18, 5, 2);            // and four fingers
  hand.limb(96, 98, 42, 90, 16, 128, 19, 5, 3);
  hand.limb(99, 124, 44, 126, 20, 168, 18, 5, 4);
  hand.limb(108, 148, 60, 160, 38, 198, 16, 4.4, 5);
  hand.limb(146, 162, 112, 200, 76, 212, 21, 6, 6);        // the thumb
  hand.limb(26, 88, 12, 92, 2, 104, 5, 1.2, 7);            // each with a claw
  hand.limb(16, 128, 4, 136, 1, 150, 5, 1.2, 8);
  hand.limb(20, 168, 10, 182, 8, 196, 5, 1.2, 9);
  hand.limb(38, 198, 30, 214, 30, 228, 4.4, 1.1, 10);
  hand.limb(76, 212, 62, 226, 54, 240, 6, 1.4, 11);

  const art = givenHead();
  const DW = art ? art.w : 520, DH = art ? art.h : 500;
  /*
   * Two hands side by side and then the head. Where there is no picture for
   * the hands, the sculpted one is written twice - once as it is and once
   * turned over - so that the page always has a left hand and a right hand
   * and never has to know the difference.
   */
  const LW = paws ? paws.left.w : HW, LH = paws ? paws.left.h : HH;
  const RW = paws ? paws.right.w : HW, RH = paws ? paws.right.h : HH;

  const gap = 4;
  const wide = LW + RW + DW + gap * 4;
  const tall = Math.max(LH, RH, DH) + gap * 2;
  const sheet = Buffer.alloc(wide * tall * 4);
  const put = (x, y, c, a) => {
    if (x < 0 || y < 0 || x >= wide || y >= tall) return;
    const at = (y * wide + x) * 4;
    if (a <= sheet[at + 3]) return;
    sheet[at] = c[0]; sheet[at + 1] = c[1]; sheet[at + 2] = c[2]; sheet[at + 3] = a;
  };

  const lx = gap, rx = gap + LW + gap, ox = gap + LW + gap + RW + gap;
  if (paws) {
    /*
     * The world is between them, so each is lit from the edge it reaches
     * across: the left hand from its right side, the right hand from its
     * left. What is turned away from the world gets the starfield and no
     * more.
     */
    const shine = (one, towards) => {
      inSpace(one.pixels, one.w, one.h, [{
        x: towards > 0 ? one.w : 0, y: one.h * 0.42,
        reach: one.w * 0.78, power: 1.15, colour: EARTHSHINE
      }]);
    };
    shine(paws.left, 1);
    shine(paws.right, -1);
    const lay = (one, atX) => {
      for (let y = 0; y < one.h; y++) {
        for (let x = 0; x < one.w; x++) {
          const from = (y * one.w + x) * 4, to = ((gap + y) * wide + atX + x) * 4;
          sheet[to] = one.pixels[from]; sheet[to + 1] = one.pixels[from + 1];
          sheet[to + 2] = one.pixels[from + 2]; sheet[to + 3] = one.pixels[from + 3];
        }
      }
    };
    lay(paws.left, lx);
    lay(paws.right, rx);
  } else {
    const coat = {
      coat: { d: PLATE, 7: CLAW, 8: CLAW, 9: CLAW, 10: CLAW, 11: CLAW },
      bands: { 1: 2, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2 }
    };
    light(hand, coat, put, rx, gap);            // reaching left, for the right side
    const flip = (x, y, c, a) => put(lx + (HW - 1 - (x - rx)), y, c, a);
    light(hand, coat, flip, rx, gap);           // and turned over for the other
  }

  if (art) {
    /*
     * The world is below him and a good way off, so it is put below the
     * bottom of his picture rather than inside it, and it reaches the jaw and
     * the cheeks and hardly touches the horns at all.
     */
    const lamps = [{
      x: art.w / 2, y: art.h * 1.18, reach: art.h * 0.62,
      power: 1.05, colour: EARTHSHINE
    }];
    for (const eye of findEyes(art.pixels, art.w, art.h)) {
      lamps.push({ x: eye.x, y: eye.y, reach: art.h * 0.19, power: 0.85, colour: EYELIGHT });
    }
    console.log('  lit by the world and by ' + (lamps.length - 1) + ' eye(s)');
    inSpace(art.pixels, art.w, art.h, lamps);
    for (let y = 0; y < art.h; y++) {
      for (let x = 0; x < art.w; x++) {
        const from = (y * art.w + x) * 4, to = ((gap + y) * wide + ox + x) * 4;
        sheet[to] = art.pixels[from]; sheet[to + 1] = art.pixels[from + 1];
        sheet[to + 2] = art.pixels[from + 2]; sheet[to + 3] = art.pixels[from + 3];
      }
    }
  } else {
    buildHelm(DW, DH, sheet, wide, tall, put, ox, gap);
  }

  fs.writeFileSync(path.join(OUT, 'oryx.png'), writePng(wide, tall, sheet));
  return {
    sheet: [wide, tall],
    handL: [lx - 2, gap - 2, LW + 4, LH + 4],
    handR: [rx - 2, gap - 2, RW + 4, RH + 4],
    head: [ox - 2, gap - 2, DW + 4, DH + 4]
  };
}

/*
 * The helm, when there is no picture to use instead.
 *
 * Built out of plates rather than out of lumps, because that is what it is: a
 * face of flat angular panels, each one chamfered at its edge, laid over one
 * another so the near piece hides the far one. What holds it together is the
 * light in the seams - the gaps between the panels are the only part of him
 * that is lit from inside, and they are the same red as the eyes.
 */
function buildHelm(DW, DH, sheet, wide, tall, put, ox, gap) {
  const head = sculpt(DW, DH);
  const mid = DW / 2;
  const mirror = pts => pts.map(([x, y]) => [DW - x, y]);
  /*
   * How each panel is canted. The far side of a face is the near side turned
   * over, so a plate laid on the left and its twin on the right are two
   * panels and not one - they are given separate names, thirty-two apart, and
   * the twin is canted the other way about so both of them lean outwards.
   */
  const set = {};
  const both = (pts, id, bevel, lean) => {
    head.plate(pts, id, bevel);
    head.plate(mirror(pts), id + 32, bevel);
    if (lean) { set[id] = lean; set[id + 32] = [-lean[0], lean[1]]; }
  };

  // The helm itself, under everything, so a gap between plates is a recess.
  head.on(0);
  head.plate([[260, 18], [196, 34], [150, 74], [120, 134], [106, 214], [112, 300],
    [146, 392], [198, 454], [260, 486], [322, 454], [374, 392], [408, 300],
    [414, 214], [400, 134], [370, 74], [324, 34]], 0, 22);

  // Horns, springing from the temples and swept up and out to a point.
  head.on(1);
  head.limb(132, 150, -30, 165, 40, 14, 26, 3, 20);
  head.limb(388, 150, 550, 165, 480, 14, 26, 3, 21);
  both([[148, 386], [184, 432], [200, 478], [150, 486], [126, 428]], 8, 6, [-0.5, 0.3]);

  head.on(2);
  both([[256, 26], [256, 150], [200, 140], [188, 76], [226, 36]], 1, 5, [-0.16, -0.3]);
  both([[188, 76], [200, 140], [160, 152], [146, 98], [166, 60]], 2, 5, [-0.42, -0.22]);
  both([[146, 98], [160, 152], [126, 172], [112, 128], [130, 92]], 3, 5, [-0.62, -0.1]);
  both([[128, 224], [180, 240], [206, 300], [168, 334], [122, 290], [114, 248]], 4, 6, [-0.5, 0.12]);
  both([[230, 312], [258, 330], [258, 398], [216, 384], [206, 336]], 5, 5, [-0.1, 0.36]);
  both([[166, 334], [206, 344], [220, 398], [182, 428], [150, 380]], 6, 5, [-0.36, 0.34]);

  head.on(3);
  both([[256, 156], [198, 144], [154, 158], [132, 184], [184, 200], [254, 206]], 7, 5, [-0.2, -0.44]);
  both([[256, 204], [228, 224], [232, 306], [256, 326]], 9, 4, [-0.26, 0.06]);
  both([[218, 392], [258, 406], [258, 478], [218, 448]], 10, 4, [-0.14, 0.4]);

  light(head, {
    coat: { d: PLATE, 20: HORN, 21: HORN },
    bands: { 20: 7, 21: 7 },
    set
  }, put, ox, gap);

  /*
   * Cut, rather than built: a mouth and a pair of nostrils are holes, and
   * there is no way to stamp a hole. Drawn straight over the lit picture, a
   * dark line down into the plate with the barest lip along the top of it -
   * on a face this dark a lip of any strength turns a snarl into a row of
   * teeth, and a grinning Oryx is not a frightening one.
   */
  const carve = (x0, y0, bx, by, x1, y1, wide0, wide1, deep) => {
    const steps = Math.ceil((Math.hypot(bx - x0, by - y0) + Math.hypot(x1 - bx, y1 - by)) * 3) + 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const cx = u * u * x0 + 2 * u * t * bx + t * t * x1;
      const cy = u * u * y0 + 2 * u * t * by + t * t * y1;
      const r = wide0 + (wide1 - wide0) * t;
      for (let dy = -Math.ceil(r) - 2; dy <= Math.ceil(r) + 2; dy++) {
        for (let dx = -Math.ceil(r) - 1; dx <= Math.ceil(r) + 1; dx++) {
          const px = ox + Math.round(cx) + dx, py = gap + Math.round(cy) + dy;
          if (px < 0 || py < 0 || px >= wide || py >= tall) continue;
          const at = (py * wide + px) * 4;
          if (!sheet[at + 3]) continue;
          const q = Math.hypot(dx, dy) / r;
          if (q <= 1) {
            const dim = 1 - deep * (1 - q * q * 0.7);
            for (let k = 0; k < 3; k++) sheet[at + k] = Math.round(sheet[at + k] * dim);
          } else if (q < 1.4 && dy < 0) {
            const lit = (1.4 - q) * 2.5;
            for (let k = 0; k < 3; k++) {
              sheet[at + k] = Math.min(255, Math.round(sheet[at + k] + 7 * lit));
            }
          }
        }
      }
    }
  };
  carve(206, 366, 260, 342, 314, 366, 5, 5, 0.9);          // the mouth
  carve(246, 300, 244, 308, 245, 316, 2.4, 2.4, 0.85);     // and a nose
  carve(274, 300, 276, 308, 275, 316, 2.4, 2.4, 0.85);

  /*
   * The light in the seams.
   *
   * Every place a plate runs out and another begins is a hairline gap, and
   * every gap has the same fire behind it that the eyes have. Told apart from
   * the outside edge of him by whether there is anything on the far side: a
   * pixel at the outer rim has empty space beside it and stays dark, and one
   * in a seam is surrounded and glows.
   */
  for (let y = 1; y < DH - 1; y++) {
    for (let x = 1; x < DW - 1; x++) {
      const at = y * DW + x;
      if (head.deep[at] < 0 || head.deep[at] > 1.6) continue;
      if (head.deep[at - 1] < 0 || head.deep[at + 1] < 0) continue;
      if (head.deep[at - DW] < 0 || head.deep[at + DW] < 0) continue;
      const hot = 1 - head.deep[at] / 1.6;
      const to = ((gap + y) * wide + ox + x) * 4;
      if (!sheet[to + 3]) continue;
      sheet[to] = Math.min(255, Math.round(sheet[to] + 122 * hot));
      sheet[to + 1] = Math.min(255, Math.round(sheet[to + 1] + 16 * hot));
      sheet[to + 2] = Math.min(255, Math.round(sheet[to + 2] + 12 * hot));
    }
  }

  /*
   * The eyes, last and over everything: slits rather than discs, slanting
   * down towards the nose, which is the whole of the expression. The light
   * they throw is laid on top of what is already there rather than replacing
   * it, so it falls on the brow it sits under.
   */
  const glow = (cx, cy, tilt) => {
    const co = Math.cos(tilt), si = Math.sin(tilt);
    for (let y = -84; y <= 84; y++) {
      for (let x = -110; x <= 110; x++) {
        const px = ox + cx + x, py = gap + cy + y;
        if (px < 0 || py < 0 || px >= wide || py >= tall) continue;
        const u = (x * co + y * si) / 42, v = (-x * si + y * co) / 9.5;
        const q = Math.sqrt(u * u + v * v);
        const at = (py * wide + px) * 4;
        if (q <= 1) {
          const hot = Math.max(0, 1 - q / 0.42);
          const c = [255, Math.round(38 + hot * 200), Math.round(26 + hot * 168)];
          const a = Math.max(0, Math.min(1, (1 - q) * 9));
          for (let k = 0; k < 3; k++) {
            sheet[at + k] = Math.round(sheet[at + k] * (1 - a) + c[k] * a);
          }
          sheet[at + 3] = Math.max(sheet[at + 3], Math.round(a * 255));
          continue;
        }
        if (!sheet[at + 3]) continue;
        const cast = Math.pow(Math.max(0, 1 - (q - 1) / 3.4), 2.4) * 0.8;
        if (cast <= 0.002) continue;
        sheet[at] = Math.min(255, Math.round(sheet[at] + 210 * cast));
        sheet[at + 1] = Math.min(255, Math.round(sheet[at + 1] + 34 * cast));
        sheet[at + 2] = Math.min(255, Math.round(sheet[at + 2] + 24 * cast));
      }
    }
  };
  glow(Math.round(mid - 90), 219, 0.21);
  glow(Math.round(mid + 90), 219, -0.21);
}

/*
 * Clouds somebody drew, if there are any.
 *
 * The eighteen below are arithmetic - stacks of ellipses shaded by how far
 * each pixel lies under the crest of its own lobe - because when the sky was
 * put in there was nothing to draw them from. Drawn ones beat them, so any
 * PNG dropped in data/Realm/clouds/ is taken instead, and the whole table
 * below is skipped.
 *
 * The convention, so that two people adding to this do not collide:
 *
 *   data/Realm/clouds/01-name.png   one cloud per file, any name
 *
 * They are taken in the order the names sort, which is why numbering them is
 * worth the trouble - the page picks a cloud by index and a bank that changes
 * shape between builds is a bank that jumps. Each is cut from its paper the
 * same way the head is (flooded in from the border, so white inside the
 * drawing survives), trimmed to what is actually drawn, and eased down to at
 * most CLOUD_MOST across. Alpha already in the file is honoured, so a proper
 * cut-out needs no keying at all.
 *
 * There is no other reader of that folder and no second sky tool: this is the
 * one place clouds come from, and sky.png and sky.json are its only output.
 */
const CLOUD_DIR = path.join(root, 'data', 'Realm', 'clouds');
/*
 * Kept the same as WIDEST in tools/build-sky.js, which packs the same folder
 * on a machine that cannot run this one. Two numbers here would mean a full
 * build and a clouds-only build producing different sheets, and since the
 * page picks a cloud for each bank by index, a sheet that changes is a sky
 * that jumps. If one of them moves, move both.
 */
const CLOUD_MOST = 128;                  // pixels across for one cloud

function givenClouds() {
  if (!fs.existsSync(CLOUD_DIR)) return null;
  const files = fs.readdirSync(CLOUD_DIR).filter(n => /\.png$/i.test(n)).sort();
  if (!files.length) return null;
  const drawn = [];
  for (const name of files) {
    const one = givenArt(path.join(CLOUD_DIR, name), CLOUD_MOST, 0, 1);
    if (one) drawn.push(one); else console.log('  nothing drawn on ' + name);
  }
  if (!drawn.length) return null;
  console.log('  ' + drawn.length + ' clouds taken from data/Realm/clouds');
  return drawn;
}

function buildSky(kit) {
  /*
   * Drawn clouds, laid out and written exactly as the built ones are, so the
   * page cannot tell which it was given.
   */
  const drawn = givenClouds();
  if (drawn) {
    let wide = 2, tall = 0;
    const laid = drawn.map(one => {
      const at = { one, w: one.w, h: one.h, x: wide, y: 2 };
      wide += one.w + 2; tall = Math.max(tall, one.h + 4);
      return at;
    });
    wide += 2;
    const sheet = Buffer.alloc(wide * tall * 4);
    for (const at of laid) {
      for (let y = 0; y < at.h; y++) {
        for (let x = 0; x < at.w; x++) {
          const from = (y * at.w + x) * 4, to = ((at.y + y) * wide + at.x + x) * 4;
          sheet[to] = at.one.pixels[from]; sheet[to + 1] = at.one.pixels[from + 1];
          sheet[to + 2] = at.one.pixels[from + 2]; sheet[to + 3] = at.one.pixels[from + 3];
        }
      }
    }
    fs.writeFileSync(path.join(OUT, 'sky.png'), writePng(wide, tall, sheet));
    const oryx = buildOryx();
    fs.writeFileSync(path.join(OUT, 'sky.json'), JSON.stringify({
      sheet: [wide, tall],
      clouds: laid.map(at => [at.x - 1, at.y - 1, at.w + 2, at.h + 2]),
      oryx
    }));
    console.log('  ' + laid.length + ' clouds drawn, on a ' + wide + 'x' + tall + ' sheet'
      + ', and Oryx on a ' + oryx.sheet.join('x') + ' one');
    return;
  }

  /*
   * Cloud is white, and its shadow is blue. The one cloud the client draws
   * anywhere is a spell effect and carries its own violet, which is right on
   * a sorcerer and wrong on weather - so the shape is drawn the way the game
   * draws things, with a hard outline and flat bands of tone, and the tones
   * are a cloud's.
   */
  const RIM = [116, 133, 170];
  const DARK = [163, 178, 208];
  const MID = [204, 216, 236];
  const LIGHT = [233, 240, 250];
  const TOP = [255, 255, 255];

  /*
   * Twelve of them, and no two the same sort of thing: little scraps, fat
   * fair-weather heaps, long low banks that run for a while, and a couple of
   * towers. One shape repeated across a whole sky is the thing that gives it
   * away, so the point of the list is that they differ.
   *
   * Each lobe is where along, how high its crest sits, and how wide and tall
   * it is. Later lobes stand in front of earlier ones.
   */
  const shapes = [
    // scraps
    [[7, 14, 7, 8], [16, 11, 8, 10]],
    [[6, 12, 6, 7], [14, 15, 7, 6], [21, 11, 6, 8]],
    [[8, 16, 8, 9], [18, 13, 7, 8]],
    // fair-weather heaps
    [[11, 21, 10, 12], [26, 12, 14, 19], [43, 18, 12, 14], [57, 23, 8, 9]],
    [[9, 19, 9, 11], [22, 11, 13, 18], [37, 17, 11, 13], [49, 22, 7, 8]],
    [[12, 22, 11, 13], [28, 14, 14, 19], [44, 11, 13, 21], [60, 19, 10, 12]],
    // long low banks
    [[8, 22, 9, 8], [20, 19, 11, 11], [34, 21, 10, 9], [47, 18, 11, 12],
      [61, 22, 10, 9], [74, 20, 9, 10]],
    [[9, 23, 10, 8], [22, 20, 12, 10], [37, 22, 11, 9], [51, 19, 12, 11], [66, 23, 9, 8]],
    [[7, 21, 8, 8], [18, 23, 10, 7], [31, 20, 11, 10], [45, 23, 9, 7]],
    // towers
    [[10, 24, 9, 11], [23, 9, 13, 24], [38, 18, 11, 15], [50, 24, 8, 9]],
    [[9, 25, 8, 10], [20, 12, 12, 22], [33, 7, 11, 26], [45, 17, 10, 16], [56, 24, 7, 8]],
    // and one wide and flat, the sort that sits over water
    [[8, 24, 9, 7], [21, 22, 12, 9], [36, 23, 12, 8], [51, 21, 12, 10], [66, 24, 10, 7],
      [79, 22, 9, 9]],
    // a torn one, with a gap in the middle
    [[7, 18, 8, 9], [18, 14, 10, 13], [38, 16, 9, 11], [50, 19, 8, 8]],
    // one leaning, as though the wind had it
    [[9, 22, 9, 10], [22, 15, 12, 17], [37, 12, 11, 19], [50, 16, 9, 14]],
    // a small pair
    [[7, 15, 7, 9], [17, 18, 8, 7], [29, 14, 8, 10]],
    // a long thin streak
    [[6, 20, 8, 5], [17, 19, 10, 6], [30, 20, 10, 5], [43, 19, 9, 6], [55, 20, 8, 5]],
    // a heavy one with a shoulder
    [[11, 23, 11, 13], [27, 12, 15, 22], [45, 20, 12, 14], [59, 24, 9, 9], [70, 22, 8, 10]],
    // and a puff with a tail
    [[9, 17, 9, 12], [21, 12, 11, 16], [34, 20, 8, 8], [45, 22, 7, 6], [55, 23, 6, 5]]
  ];

  const laid = [];
  let wide = 2, tall = 0;
  for (const shape of shapes) {
    /*
     * Dropped far enough that the highest crest still fits. Written by hand,
     * a tall lobe is easy to put above the top of its own picture, and what
     * comes out then is a cloud with a flat lid on it.
     */
    let over = 0;
    for (const [, cy, , ry] of shape) over = Math.max(over, ry - cy + 1);
    const lobes = shape.map(([cx, cy, rx, ry]) => [cx, cy + over, rx, ry]);
    let w = 0, h = 0;
    for (const [cx, cy, rx, ry] of lobes) {
      w = Math.max(w, cx + rx + 2);
      h = Math.max(h, cy + ry + 3);
    }
    laid.push({ lobes, w, h, x: wide, y: 2 });
    wide += w + 2;
    tall = Math.max(tall, h + 4);
  }
  wide += 2;

  const sheet = Buffer.alloc(wide * tall * 4);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= wide || y >= tall) return;
    const at = (y * wide + x) * 4;
    sheet[at] = c[0]; sheet[at + 1] = c[1]; sheet[at + 2] = c[2]; sheet[at + 3] = 255;
  };

  for (const one of laid) {
    /*
     * Which lobe owns each pixel, not merely whether one does: the one that
     * owns it is the last to claim it, and that is what lets the seam between
     * two of them be drawn.
     */
    const owner = new Int8Array(one.w * one.h).fill(-1);
    let baseY = 0;
    for (const [cx, cy, rx, ry] of one.lobes) baseY = Math.max(baseY, cy + Math.round(ry * 0.42));
    one.lobes.forEach(([cx, cy, rx, ry], lobe) => {
      for (let y = 0; y <= Math.min(baseY, one.h - 1); y++) {
        for (let x = 0; x < one.w; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) owner[y * one.w + x] = lobe;
        }
      }
    });

    /*
     * Shaded by how far a pixel lies under the crest of its own lobe. Reading
     * the column afresh wherever the lobe changes is the whole of the detail:
     * each puff keeps a lit top even where another stands in front of it, and
     * the row where they meet takes the shadow that says which is in front.
     */
    for (let x = 0; x < one.w; x++) {
      let above = 0, was = -1;
      for (let y = 0; y < one.h; y++) {
        const here = owner[y * one.w + x];
        if (here < 0) { above = 0; was = -1; continue; }
        const seam = was >= 0 && here !== was;
        if (here !== was) { above = 0; was = here; }
        const bottom = y === one.h - 1 || owner[(y + 1) * one.w + x] < 0;
        put(one.x + x, one.y + y, bottom ? DARK
          : seam ? MID
            : above === 0 ? TOP
              : above < 3 ? LIGHT
                : above < 8 ? MID : DARK);
        above++;
      }
    }

    // And a line round the outside, which is what makes it drawn art.
    for (let y = 0; y < one.h; y++) {
      for (let x = 0; x < one.w; x++) {
        if (owner[y * one.w + x] >= 0) continue;
        let touches = false;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= one.w || ny >= one.h) continue;
          if (owner[ny * one.w + nx] >= 0) { touches = true; break; }
        }
        if (touches) put(one.x + x, one.y + y, RIM);
      }
    }
  }

  fs.writeFileSync(path.join(OUT, 'sky.png'), writePng(wide, tall, sheet));
  const oryx = buildOryx();
  fs.writeFileSync(path.join(OUT, 'sky.json'), JSON.stringify({
    sheet: [wide, tall],
    clouds: laid.map(one => [one.x - 1, one.y - 1, one.w + 2, one.h + 2]),
    oryx
  }));
  console.log('  ' + laid.length + ' clouds drawn, on a ' + wide + 'x' + tall + ' sheet'
    + ', and Oryx on a ' + oryx.sheet.join('x') + ' one');
}

function buildWater(seen, kit, minX, minY, maxX, maxY) {
  const wide = maxX - minX + 1, tall = maxY - minY + 1;
  const index = Buffer.alloc(wide * tall * 4);
  const pics = new Map();
  let moving = 0;

  const groundAt = (x, y) => {
    const t = seen.tiles.get(y * KEY + x);
    return t !== undefined ? t : (seen.sea ? seen.sea.at(x, y) : undefined);
  };
  const every = [];
  for (const key of seen.tiles.keys()) every.push(key);
  if (seen.sea) {
    const S = seen.sea;
    for (let gy = 0; gy < S.tall; gy++) {
      for (let gx = 0; gx < S.wide; gx++) {
        if (S.grid[gy * S.wide + gx] === 2) every.push((gy + S.minY) * KEY + gx + S.minX);
      }
    }
  }

  for (const key of every) {
    const x = key % KEY, y = (key - x) / KEY;
    const type = groundAt(x, y);
    const kind = type === undefined ? null : kit.grounds.get(type);
    if (!kind || !kind.drift) continue;
    // Walled in by its own kind, or the shoreline would lose its blending.
    if (groundAt(x - 1, y) !== type) continue;
    if (groundAt(x + 1, y) !== type) continue;
    if (groundAt(x, y - 1) !== type) continue;
    if (groundAt(x, y + 1) !== type) continue;

    const look = kit.lookOf(kit.grounds, type, true, (x * 7919) ^ y);
    if (!look) continue;
    const id = look.sheet.name + ':' + look.x + ',' + look.y
      + ':' + kind.drift.dx + ',' + kind.drift.dy + ',' + (kind.drift.wave ? 'w' : 'f');
    let pic = pics.get(id);
    if (!pic) {
      if (pics.size >= 254) continue;                // one byte an entry
      pic = { look, drift: kind.drift, n: pics.size + 1 };
      pics.set(id, pic);
    }
    index[((y - minY) * wide + (x - minX)) * 4] = pic.n;
    index[((y - minY) * wide + (x - minX)) * 4 + 3] = 255;
    moving++;
  }
  if (!moving) return;

  /*
   * Each texture laid out twice over in both directions, so the map can take
   * an eight pixel window at any offset inside it and always land on whole
   * water rather than running off the edge.
   */
  const list = [...pics.values()].sort((a, b) => a.n - b.n);
  const COLS = 16;
  const artW = COLS * 16, artH = Math.ceil(list.length / COLS) * 16;
  const art = Buffer.alloc(artW * artH * 4);
  const table = [];
  list.forEach((pic, k) => {
    const ox = (k % COLS) * 16, oy = Math.floor(k / COLS) * 16;
    const from = pic.look.sheet.pixels, w = pic.look.sheet.width;
    for (let ry = 0; ry < 16; ry++) {
      for (let rx = 0; rx < 16; rx++) {
        const f = ((pic.look.y + (ry % 8)) * w + pic.look.x + (rx % 8)) * 4;
        const t = ((oy + ry) * artW + ox + rx) * 4;
        from.copy(art, t, f, f + 4);
      }
    }
    table.push([ox, oy, pic.drift.dx, pic.drift.dy, pic.drift.wave ? 1 : 0]);
  });

  // Only the first channel of the index ever meant anything, so only the
  // first channel is written. See writeGreyPng.
  const oneByte = Buffer.alloc(wide * tall);
  for (let i = 0, j = 0; j < oneByte.length; i += 4, j++) oneByte[j] = index[i];
  fs.writeFileSync(path.join(OUT, 'water.png'), writeGreyPng(wide, tall, oneByte));
  fs.writeFileSync(path.join(OUT, 'water-art.png'), writePng(artW, artH, art));
  fs.writeFileSync(path.join(OUT, 'water.json'),
    JSON.stringify({ minX, minY, wide, tall, pics: table }));
  console.log('  ' + moving.toLocaleString() + ' tiles of water on the move, '
    + list.length + ' kinds of drift');
}

function buildThings(seen, kit) {
  const seen2 = new Map();                         // one entry per distinct picture
  const placed = [];
  let turnedAway = 0;
  for (const here of seen.objects.values()) {
    for (const o of here) {
      if (o.crowded) { turnedAway++; continue; }
      const was = kit.objectKinds.get(o.type) || {};
      if (kit.offMap.turnedAway(was)) { turnedAway++; continue; }
      /*
       * Drawn as it looks while it is still worth going to. Only the picture
       * changes: what it is, and the state it was found in, stay its own.
       * See beaconSwap.
       */
      const shownAs = kit.beaconSwap.get(o.type);
      const drawType = shownAs === undefined ? o.type : shownAs;
      const kind = shownAs === undefined ? was : (kit.objectKinds.get(drawType) || was);
      const size = kind.size || 100;
      const lift = kind.lift || 0;
      let got = null;

      // A thing with a flipbook is filed once for the whole run of frames.
      if (kind.flips && kind.flips.length > 1) {
        const key = 'reel:' + drawType;
        got = seen2.get(key);
        if (got === undefined) {
          const looks = [];
          for (const one of kind.flips) {
            const made = kit.cutOne(one.atlas, one.index, false);
            if (made) looks.push(made);
          }
          got = looks.length > 1
            ? { looks, size, lift, beat: kind.beat, id: seen2.size }
            : null;
          seen2.set(key, got);
        }
      }

      if (!got) {
        const spot = (Math.round(o.x * 2) * 7919) ^ Math.round(o.y * 2);
        const look = kit.lookOf(kit.objectKinds, drawType, false, spot);
        if (!look || !look.sheet || !look.sheet.name) continue;
        /*
         * A picture with nothing in it is not a thing on the map.
         *
         * A great deal of the machinery of the realm is placed as an object
         * because that is the only way the client knows to put something on a
         * tile: the spawner that puts the monsters there, the anchor a
         * guardian paces round, the beam it throws, the marker where the loot
         * fell. All of them are drawn from an empty square, so nine thousand
         * of them were being sorted by depth and written into things.bin
         * every build to draw exactly nothing.
         *
         * The beacons are drawn from an empty square too, and they are not
         * lost with them: they are read out of the store by name and carried
         * in atlas.json, and the page draws them from there.
         */
        if (kit.offMap.blank && allClear(look)) { turnedAway++; continue; }
        const key = look.sheet.name + ':' + look.x + ',' + look.y + ','
          + look.w + ',' + look.h + ':' + size + ':' + lift;
        got = seen2.get(key);
        if (!got) { got = { looks: [look], size, lift, beat: 0, id: seen2.size }; seen2.set(key, got); }
      }
      if (got) { (got.from || (got.from = new Set())).add(o.type); }
      placed.push({ pic: got, x: o.x, y: o.y });
    }
  }
  if (!placed.length) return;

  /*
   * The pictures on one sheet, laid in rows of a thousand pixels: tallest
   * first, so a row is filled by things of much the same height and little is
   * wasted between them.
   */
  const WIDE = 1024;
  const pics = [...seen2.values()].filter(Boolean);
  // A cell big enough for every frame, so one number moves along the strip.
  for (const pic of pics) {
    pic.cw = Math.max(...pic.looks.map(l => l.w));
    pic.ch = Math.max(...pic.looks.map(l => l.h));
    if (pic.cw * pic.looks.length > WIDE) pic.looks = [pic.looks[0]];   // too long a run
  }
  pics.sort((a, b) => b.ch - a.ch);
  // Numbered only once the ones that could not be cut have been dropped.
  pics.forEach((pic, i) => { pic.id = i; });
  let x = 0, y = 0, rowH = 0;
  for (const pic of pics) {
    const runs = pic.cw * pic.looks.length;
    if (x + runs > WIDE) { x = 0; y += rowH; rowH = 0; }
    pic.px = x; pic.py = y;
    x += runs;
    if (pic.ch > rowH) rowH = pic.ch;
  }
  const tall = y + rowH;
  const sheet = Buffer.alloc(WIDE * tall * 4);
  for (const pic of pics) {
    pic.looks.forEach((look, slot) => {
      const from = look.sheet.pixels, w = look.sheet.width;
      // Middled across its cell and standing on its floor, so a run whose
      // frames differ in size does not jitter about as it plays.
      const ox = pic.px + slot * pic.cw + ((pic.cw - look.w) >> 1);
      const oy = pic.py + (pic.ch - look.h);
      for (let ry = 0; ry < look.h; ry++) {
        for (let rx = 0; rx < look.w; rx++) {
          const f = ((look.y + ry) * w + look.x + rx) * 4;
          from.copy(sheet, ((oy + ry) * WIDE + ox + rx) * 4, f, f + 4);
        }
      }
    });
  }

  /*
   * Where each one stands, kept chunk by chunk and sorted down the screen, so
   * the map can draw a square of the realm without sorting it first.
   */
  const byChunk = new Map();
  for (const one of placed) {
    const key = Math.floor(one.x / CHUNK) + '_' + Math.floor(one.y / CHUNK);
    if (!byChunk.has(key)) byChunk.set(key, []);
    byChunk.get(key).push(one);
  }
  const index = {};
  let total = 0;
  for (const [key, list] of byChunk) {
    list.sort((a, b) => a.y - b.y);
    index[key] = [total, list.length];
    total += list.length;
  }
  const bin = Buffer.alloc(total * 6);
  let at = 0;
  for (const list of byChunk.values()) {
    for (const one of list) {
      bin.writeUInt16LE(one.pic.id, at);
      bin.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(one.x * 8))), at + 2);
      bin.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(one.y * 8))), at + 4);
      at += 6;
    }
  }

  const table = new Array(pics.length);
  for (const pic of pics) {
    // where on the sheet, how big it is, how big the client draws it, how high
    table[pic.id] = [pic.px, pic.py, pic.cw, pic.ch, pic.size,
      Math.round(pic.lift * 100), pic.looks[0].pad || 0,
      pic.looks.length, Math.round((pic.beat || 0) * 1000)];
  }
  /*
   * A ledger of what each picture actually is, written beside the sheet.
   *
   * things.json carries rectangles and nothing else, which is all the page
   * needs and no help at all when something is covering the realm four
   * hundred times over and has to be named before it can be turned away. One
   * picture can serve several kinds - they are filed by sprite, not by kind -
   * so every kind that landed on it is listed.
   */
  {
    const ledger = {};
    for (const pic of pics) {
      ledger[pic.id] = [...(pic.from || [])].map(type => {
        const kind = kit.objectKinds.get(type) || {};
        return { type, id: kind.id || '?', sort: kind.sort || '?' };
      });
    }
    fs.writeFileSync(path.join(OUT, 'things-names.json'), JSON.stringify(ledger, null, 1));
  }
  fs.writeFileSync(path.join(OUT, 'things.png'), writePng(WIDE, tall, sheet));
  fs.writeFileSync(path.join(OUT, 'things.bin'), bin);
  fs.writeFileSync(path.join(OUT, 'things.json'),
    JSON.stringify({ sheet: [WIDE, tall], px: PX, chunk: CHUNK, pics: table, chunks: index }));
  if (turnedAway) {
    console.log('  ' + turnedAway.toLocaleString()
      + ' things turned away as not being the realm (data/Realm/off-the-map.txt)');
  }
  const reels = pics.filter(pic => pic.looks.length > 1).length;
  console.log('  ' + total.toLocaleString() + ' things standing, '
    + pics.length + ' distinct pictures on a ' + WIDE + 'x' + tall + ' sheet, '
    + reels + ' of them a run of frames');
}

/*
 * The sea, where nothing was recorded.
 *
 * The realm is an island and the recording stops at the water's edge, which
 * left the map ending in black: black beyond the coast, and black in the
 * pools and channels inside it that cannot be walked into. None of that is
 * nothing - it is ocean, and the client has ocean to draw.
 *
 * Two kinds of hole are filled. Everything outside the island is sea, out to
 * a margin, so the coast has water beyond it rather than an edge. And a hole
 * shut inside the island is sea only if what surrounds it is sea - a clearing
 * ringed by forest is a clearing, and stays as it is.
 *
 * None of this is written back. The recording is what was walked; this is
 * only what is drawn around it.
 */
const SHORE = 80;                        // tiles of open water beyond the coast

function findSea(tiles, grounds) {
  let deep = null;
  const wet = new Set();          // water, and the walls that stand in for it
  for (const [type, kind] of grounds) {
    const id = (kind.id || '').toLowerCase();
    if (/water|ocean/.test(id) || kind.noWalk) wet.add(type);
    if (id === 'low ocean water') deep = type;
  }
  if (deep === null) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const key of tiles.keys()) {
    const x = key % KEY, y = (key - x) / KEY;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  minX -= SHORE; minY -= SHORE; maxX += SHORE; maxY += SHORE;
  if (minX < 0) minX = 0; if (minY < 0) minY = 0;
  const wide = maxX - minX + 1, tall = maxY - minY + 1;

  // 0 nothing recorded, 1 recorded, 2 sea
  const grid = new Uint8Array(wide * tall);
  for (const key of tiles.keys()) {
    const x = key % KEY, y = (key - x) / KEY;
    grid[(y - minY) * wide + (x - minX)] = 1;
  }

  /*
   * Everything the open sea can reach from outside, taken in one sweep from
   * the rim of the margin inwards.
   */
  const queue = new Int32Array(wide * tall);
  let head = 0, tail = 0;
  const push = at => { if (!grid[at]) { grid[at] = 2; queue[tail++] = at; } };
  for (let x = 0; x < wide; x++) { push(x); push((tall - 1) * wide + x); }
  for (let y = 0; y < tall; y++) { push(y * wide); push(y * wide + wide - 1); }
  while (head < tail) {
    const at = queue[head++];
    const x = at % wide, y = (at - x) / wide;
    if (x > 0) push(at - 1);
    if (x < wide - 1) push(at + 1);
    if (y > 0) push(at - wide);
    if (y < tall - 1) push(at + wide);
  }

  /*
   * Then the holes shut inside the island, each taken whole and filled only
   * if what it touches is water.
   */
  let pools = 0;
  const patch = [];
  for (let seed = 0; seed < grid.length; seed++) {
    if (grid[seed]) continue;
    patch.length = 0;
    let n = 0, near = 0, nearWet = 0;
    grid[seed] = 3;                                   // looking at it
    patch.push(seed);
    for (let i = 0; i < patch.length; i++) {
      const at = patch[i];
      n++;
      const x = at % wide, y = (at - x) / wide;
      const round = [];
      if (x > 0) round.push(at - 1);
      if (x < wide - 1) round.push(at + 1);
      if (y > 0) round.push(at - wide);
      if (y < tall - 1) round.push(at + wide);
      for (const other of round) {
        if (grid[other] === 0) { grid[other] = 3; patch.push(other); continue; }
        if (grid[other] !== 1) continue;
        near++;
        const ox = other % wide, oy = (other - ox) / wide;
        if (wet.has(tiles.get((oy + minY) * KEY + ox + minX))) nearWet++;
      }
    }
    const drown = near > 0 && nearWet / near >= 0.8;
    // Marked either way, so a hole that stays dry is not walked again
    // from every one of its own cells.
    for (const at of patch) grid[at] = drown ? 2 : 4;
    if (drown) pools += n;
  }

  let open = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === 2) open++;
  return {
    minX, minY, wide, tall, grid, type: deep,
    open, pools,
    at(x, y) {
      const gx = x - minX, gy = y - minY;
      if (gx < 0 || gy < 0 || gx >= wide || gy >= tall) return undefined;
      return grid[gy * wide + gx] === 2 ? deep : undefined;
    }
  };
}

function drawChunk(seen, kit, cc, cr, missing) {
  const canvas = Buffer.alloc(side * side * 4);
  let painted = 0, drawn = 0;

  /*
   * Drawn at the size the client draws it. A spider declares fifty and is half
   * the size of its sprite; a boss declares a hundred and fifty and is half
   * again. Everything came out at a hundred before, which made the small
   * things big and flattened the difference between a rat and a god.
   *
   * Nearest neighbour, because the art is pixels and anything smoother turns
   * a crisp eight-pixel creature into a smudge.
   */
  const blit = (look, px, py, wide, tall) => {
    const w = wide || look.w, h = tall || look.h;
    for (let y = 0; y < h; y++) {
      const ty = py + y;
      if (ty < 0 || ty >= side) continue;
      const sy = look.y + Math.min(look.h - 1, Math.floor(y * look.h / h));
      for (let x = 0; x < w; x++) {
        const tx = px + x;
        if (tx < 0 || tx >= side) continue;
        const sx = look.x + Math.min(look.w - 1, Math.floor(x * look.w / w));
        const from = (sy * look.sheet.width + sx) * 4;
        const a = look.sheet.pixels[from + 3];
        if (a < 8) continue;
        const to = (ty * side + tx) * 4;
        if (a === RIM_ALPHA) {
          /*
           * The line, laid flat black instead of copied.
           *
           * Every cut sprite wears a rim a shade of what it touches at a bit
           * over a third opacity, and that is right for a sprite the page
           * draws over whatever is behind it. Copied into a chunk it is
           * wrong twice over: the chunk is a flat picture, so the ground does
           * not show through the way it should, and the pixel is written at
           * that opacity into an image the page then draws opaque - which is
           * how the outline came out thick, grey and washed. The scenery in
           * levels one to four is baked in here and never goes near
           * refine-outline, so this is the only place its line is decided.
           */
          canvas[to] = 0; canvas[to + 1] = 0; canvas[to + 2] = 0; canvas[to + 3] = 255;
          continue;
        }
        look.sheet.pixels.copy(canvas, to, from, from + 4);
      }
    }
  };

  /*
   * The ground.
   *
   * A tile is not a plain square of one texture, and drawing it as one is
   * most of why the map read as a simplified version of the game. Three
   * things the client does and this did not:
   *
   *   - a ground with several textures wears a different one per square, so
   *     a field of grass is a field and not wallpaper;
   *   - a ground that asks for it is nudged up to a pixel off its square,
   *     which breaks the eight pixel grid the eye otherwise picks out;
   *   - and where two grounds meet, the higher ranking one bleeds across the
   *     seam through a soft mask, so sand runs into grass instead of ending
   *     at a step.
   *
   * The last is done a quarter of a tile at a time. Each quarter looks at the
   * three neighbours touching its corner: one of them alone gives an edge,
   * two give a corner, only the diagonal gives the tip of one.
   */
  const M = kit.masks;

  const soil = new Map();
  const soilAt = (wx, wy) => {
    if (wx < 0 || wy < 0) return null;
    const key = wy * KEY + wx;
    if (soil.has(key)) return soil.get(key);
    let got = null;
    let type = seen.tiles.get(key);
    if (type === undefined && seen.sea) type = seen.sea.at(wx, wy);
    if (type !== undefined) {
      const look = kit.lookOf(kit.grounds, type, true, (wx * 7919) ^ wy);
      if (look) {
        const kind = kit.grounds.get(type);
        let jx = 0, jy = 0;
        if (kind && kind.jitter && look.pad) {
          let n = Math.imul((wx * 0x27d4eb2d) ^ (wy * 0x165667b1), 0x9e3779b1);
          n = (n ^ (n >>> 15)) >>> 0;
          jx = ((n & 3) % 3 - 1) * look.pad;
          jy = (((n >>> 5) & 3) % 3 - 1) * look.pad;
        }
        got = {
          type, look, jx, jy,
          rank: kind ? kind.blend : 0,
          still: !!(kind && kind.still)
        };
      }
    }
    soil.set(key, got);
    return got;
  };

  // Where in the sheet a given pixel of a given square comes from.
  const soilPixel = (s, ix, iy) =>
    ((s.look.y + iy + s.jy) * s.look.sheet.width + s.look.x + ix + s.jx) * 4;

  for (let ty = 0; ty < CHUNK; ty++) {
    const wy = cr * CHUNK + ty;
    for (let tx = 0; tx < CHUNK; tx++) {
      const wx = cc * CHUNK + tx;
      const me = soilAt(wx, wy);
      if (!me) {
        let type = seen.tiles.get(wy * KEY + wx);
        if (type === undefined && seen.sea) type = seen.sea.at(wx, wy);
        if (type === undefined) continue;
        painted++;
        const id = (kit.grounds.get(type) || {}).id || ('#' + type);
        missing.set(id, (missing.get(id) || 0) + 1);
        continue;
      }
      painted++;
      drawn++;

      const ox = tx * PX, oy = ty * PX;
      const from0 = me.look.sheet.pixels;
      for (let iy = 0; iy < 8; iy++) {
        let at = ((oy + iy) * side + ox) * 4;
        let src = soilPixel(me, 0, iy);
        for (let ix = 0; ix < 8; ix++, at += 4, src += 4) {
          canvas[at] = from0[src];
          canvas[at + 1] = from0[src + 1];
          canvas[at + 2] = from0[src + 2];
          canvas[at + 3] = 255;
        }
      }

      /*
       * The trim, for a ground that carries its own.
       *
       * Which piece a square wears is settled by how many of its four sides
       * face something that is not the same ground: one side takes the strip,
       * two sides meeting take the bend, and a square with all four sides
       * covered still takes the small corner where a diagonal is missing.
       * Each piece is a whole tile, and it is turned so its border faces out.
       */
      const trim = kit.trimFor(me.type);
      if (trim) {
        const ours = (nx, ny) => {
          let o = seen.tiles.get(ny * KEY + nx);
          if (o === undefined && seen.sea) o = seen.sea.at(nx, ny);
          return o === undefined || o === me.type;   // never trim into the unseen
        };
        // Turned a quarter at a time: the pictures are drawn with their
        // border on the left, and a quarter turn clockwise puts it on top.
        const lay = (look, turn) => {
          if (!look) return;
          const src = look.sheet.pixels;
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              let sx = x, sy = y;
              if (turn === 1) { sx = y; sy = 7 - x; }
              else if (turn === 2) { sx = 7 - x; sy = 7 - y; }
              else if (turn === 3) { sx = 7 - y; sy = x; }
              const from = ((look.y + sy) * look.sheet.width + look.x + sx) * 4;
              if (src[from + 3] < 8) continue;
              const to = ((oy + y) * side + ox + x) * 4;
              canvas[to] = src[from]; canvas[to + 1] = src[from + 1];
              canvas[to + 2] = src[from + 2]; canvas[to + 3] = 255;
            }
          }
        };
        // West, north, east, south - in the order the turns run.
        const open = [!ours(wx - 1, wy), !ours(wx, wy - 1),
                      !ours(wx + 1, wy), !ours(wx, wy + 1)];
        const count = open.reduce((a, b) => a + (b ? 1 : 0), 0);
        let laid = false;
        if (count === 1) { lay(trim.edge, open.indexOf(true)); laid = true; }
        else if (count >= 2) {
          // A bend covers two sides that meet; anything stranger falls back
          // to a strip on the first side that is open.
          for (let t = 0; t < 4 && !laid; t++) {
            if (open[t] && open[(t + 1) & 3]) { lay(trim.bend, t); laid = true; }
          }
          if (!laid) { lay(trim.edge, open.indexOf(true)); laid = true; }
        }
        if (!laid && trim.nub) {
          // No side is open, but a diagonal may still be: that is where the
          // rug turns back on itself and wants its small corner.
          const away = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          for (let t = 0; t < 4; t++) {
            if (!ours(wx + away[t][0], wy + away[t][1])) { lay(trim.nub, t); break; }
          }
        }
        // Its border is its own art, so nothing bleeds across it.
        continue;
      }

      // A neighbour bleeds in only if it outranks this square and neither of
      // the two refuses to blend at all.
      const over = one => one && one.type !== me.type && one.rank > me.rank
        && !one.still && !me.still;

      for (let q = 0; q < 4; q++) {
        const dx = (q & 1) ? 1 : -1;
        const dy = (q & 2) ? 1 : -1;
        const h = soilAt(wx + dx, wy);
        const v = soilAt(wx, wy + dy);
        const useH = over(h), useV = over(v);

        // Which mask, worn by which neighbour. 'c' is read as a corner, the
        // rest as an edge coming from that direction.
        const jobs = [];
        const pick = list => list.length
          ? list[(((wx * 31 + wy) * 4 + q) >>> 0) % list.length] : null;
        if (useH && useV) {
          if (h.type === v.type) jobs.push([h, pick(M.inner), 'c']);
          else { jobs.push([v, pick(M.p1), 'c']); jobs.push([h, pick(M.p2), 'c']); }
        } else if (useH) {
          jobs.push([h, pick(M.sides), dx > 0 ? 'r' : 'l']);
        } else if (useV) {
          jobs.push([v, pick(M.sides), dy < 0 ? 'u' : 'd']);
        } else {
          const diag = soilAt(wx + dx, wy + dy);
          if (over(diag)) jobs.push([diag, pick(M.outer), 'c']);
        }
        if (!jobs.length) continue;

        const qx0 = dx > 0 ? 4 : 0, qy0 = dy > 0 ? 4 : 0;
        const fx = dx < 0, fy = dy > 0;
        for (const [one, mask, how] of jobs) {
          if (!mask) continue;
          const src = one.look.sheet.pixels;
          for (let qy = 0; qy < 4; qy++) {
            for (let qx = 0; qx < 4; qx++) {
              let a;
              if (how === 'c') a = mask[(fy ? 3 - qy : qy) * 4 + (fx ? 3 - qx : qx)];
              else if (how === 'r') a = mask[qy * 4 + qx];
              else if (how === 'l') a = mask[qy * 4 + (3 - qx)];
              else if (how === 'u') a = mask[qx * 4 + (3 - qy)];
              else a = mask[qx * 4 + qy];
              if (a < 4) continue;
              const at = ((oy + qy0 + qy) * side + ox + qx0 + qx) * 4;
              const of = soilPixel(one, qx0 + qx, qy0 + qy);
              const k = a / 255, inv = 1 - k;
              canvas[at] = src[of] * k + canvas[at] * inv;
              canvas[at + 1] = src[of + 1] * k + canvas[at + 1] * inv;
              canvas[at + 2] = src[of + 2] * k + canvas[at + 2] * inv;
            }
          }
        }
      }
    }
  }

  /*
   * The ground on its own, kept before anything is stood on it.
   *
   * Close up, the map draws the things standing in the realm as sprites in
   * their own right rather than as marks in the floor - sorted by how far
   * down the screen they stand, so a tree passes in front of the wall behind
   * it, and lifted by the height they carry, so what flies flies. None of
   * that can be done once they have been painted into the floor, so the floor
   * is kept as it was and they are painted onto a copy.
   */
  const bare = Buffer.from(canvas);

  /*
   * Then whatever was standing on it, anchored at the bottom middle of its
   * own tile the way the game stacks things, so a tree twice as tall as a
   * tile grows up out of the ground rather than sitting centred on it. The
   * loop reaches a little past the chunk for exactly that reason.
   */
  for (let ty = -4; ty < CHUNK + 4; ty++) {
    const worldY = cr * CHUNK + ty;
    for (let tx = -4; tx < CHUNK + 4; tx++) {
      const here = seen.objects.get(worldY * KEY + cc * CHUNK + tx);
      if (!here) continue;
      for (const object of here) {
        if (object.crowded) continue;
        if (kit.offMap.turnedAway(kit.objectKinds.get(object.type))) continue;
        const spot = (Math.round(object.x * 2) * 7919) ^ Math.round(object.y * 2);
        const look = kit.lookOf(kit.objectKinds, object.type, false, spot);
        if (!look) {
          const id = (kit.objectKinds.get(object.type) || {}).id || ('#' + object.type);
          missing.set(id, (missing.get(id) || 0) + 1);
          continue;
        }
        const scale = kit.sizeOf(kit.objectKinds, object.type) / 100;
        const wide = Math.max(1, Math.round(look.w * scale));
        const tall = Math.max(1, Math.round(look.h * scale));
        // The rim added a pixel all round, so the thing is put back down by
        // that much and stands where it stood before it had one.
        const foot = Math.round((look.pad || 0) * scale);
        const px = Math.round((object.x - cc * CHUNK) * PX - wide / 2);
        const py = Math.round((object.y - cr * CHUNK) * PX + PX - tall) + foot;
        /*
         * Only things with some height to them. A scorch mark or a patch of
         * flowers lies on the ground and casts nothing; a tree, a wall or a
         * statue stands, and the taller it is the darker it lies.
         */
        blit(look, px, py, wide, tall);
      }
    }
  }

  return painted ? {
    png: writePng(side, side, canvas),
    ground: writePng(side, side, bare),
    painted, drawn
  } : null;
}

/*
 * Thinning out the undergrowth, each zone against its own average.
 *
 * A realm is walked more than once and the same clearing is recorded again
 * from a different angle each time, so the small things that dress the floor
 * pile up wherever the walking was thickest. None of it is wrong - every one
 * of them was really there - but a patch walked five times ends up five
 * times the thicket its neighbour is, and at that point the floor stops
 * being a floor and becomes a wall with a road through it.
 *
 * Two earlier attempts got this wrong in the same way. Giving every patch in
 * the realm one ceiling flattened the map to a single density and took the
 * difference between a forest and a beach out of it entirely; grouping by
 * kind of ground was better but still lumped every stretch of grass in the
 * realm into one number.
 *
 * So the question is asked of each zone on its own. A zone here is what it
 * is on the map: one unbroken run of the same ground. Each is asked what its
 * own patches hold on average, and that average is the ceiling. A patch over
 * it comes down to it; a patch under it is not touched at all, which is the
 * whole point - thinning a sparse corner of a forest would be inventing a
 * different forest, and the sparse corner is as much a fact as the thicket.
 *
 * Which ones survive is settled by a hash of where they stand, so it is the
 * same on every build, and a survivor also has to stand clear of the ones
 * already kept: picking purely at random left the same clumps, only smaller.
 *
 * None of this touches what was recorded. It is decided here, once, each
 * time the map is drawn, and both the painted floor and the standing sprites
 * read the same answer - they would show two different forests otherwise.
 */
const CROWD_CELL = 8;            // tiles across the patch an average is taken over
const CROWD_LEAST = 4;           // a ceiling never bites below this
const CROWD_APART = 1.15;        // tiles between two that are kept

function thinScenery(seen, kit) {
  const cells = new Map();
  let small = 0;
  for (const [, here] of seen.objects) {
    for (const object of here) {
      object.crowded = false;
      const kind = kit.objectKinds.get(object.type);
      if (kit.offMap.turnedAway(kind)) continue;
      if (kind && kind.blocks) continue;              // masonry, never thinned
      const spot = (Math.round(object.x * 2) * 7919) ^ Math.round(object.y * 2);
      const look = kit.lookOf(kit.objectKinds, object.type, false, spot);
      if (!look) continue;
      const scale = kit.sizeOf(kit.objectKinds, object.type) / 100;
      /*
       * Small enough to be undergrowth. Two and a half tiles takes in the
       * mushrooms, the shrubs and the small trees, which are what actually
       * carpets the ground, and leaves out the statues and the big timber.
       */
      if (look.w * scale > PX * 2.5 || look.h * scale > PX * 2.5) continue;
      small++;
      const cx = Math.floor(object.x / CROWD_CELL), cy = Math.floor(object.y / CROWD_CELL);
      const at = cx + ',' + cy;
      let cell = cells.get(at);
      if (!cell) cells.set(at, cell = { cx, cy, at, list: [] });
      cell.list.push(object);
    }
  }

  /*
   * What ground each patch stands on: the commonest of the tiles under it,
   * sampled rather than counted in full, since a patch of sixty-four tiles
   * is one kind of ground and a handful of edge cases.
   */
  for (const cell of cells.values()) {
    const tally = new Map();
    for (let ty = 0; ty < CROWD_CELL; ty += 2) {
      for (let tx = 0; tx < CROWD_CELL; tx += 2) {
        const t = seen.tiles.get((cell.cy * CROWD_CELL + ty) * KEY + cell.cx * CROWD_CELL + tx);
        if (t === undefined) continue;
        tally.set(t, (tally.get(t) || 0) + 1);
      }
    }
    let best = -1, most = 0;
    for (const [t, n] of tally) if (n > most) { most = n; best = t; }
    cell.ground = best;
  }

  /*
   * And which zone that makes it part of: one unbroken run of the same
   * ground, found by walking out from each patch to its neighbours. Two
   * forests at opposite ends of the realm are two zones and are averaged
   * apart, which is the difference between this and the attempt before it.
   */
  let zones = 0;
  for (const start of cells.values()) {
    if (start.zone !== undefined) continue;
    const id = zones++;
    const queue = [start];
    const held = [];
    start.zone = id;
    while (queue.length) {
      const cell = queue.pop();
      held.push(cell);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const near = cells.get((cell.cx + dx) + ',' + (cell.cy + dy));
        if (!near || near.zone !== undefined || near.ground !== cell.ground) continue;
        near.zone = id;
        queue.push(near);
      }
    }
    let total = 0;
    for (const cell of held) total += cell.list.length;
    const ceiling = Math.max(CROWD_LEAST, Math.round(total / held.length));
    for (const cell of held) cell.ceiling = ceiling;
  }

  const rank = one => {
    const h = Math.round(one.x * 4) * 73856093 ^ Math.round(one.y * 4) * 19349663 ^ one.type;
    return (h ^ (h >>> 13)) >>> 0;
  };
  let thinned = 0, pulled = 0;
  for (const cell of cells.values()) {
    // Under its zone's average: left exactly as it was recorded.
    if (cell.list.length <= cell.ceiling) continue;
    pulled++;
    cell.list.sort((p, q) => rank(p) - rank(q));
    const kept = [];
    for (const one of cell.list) {
      const room = kept.length < cell.ceiling && kept.every(k =>
        Math.abs(k.x - one.x) > CROWD_APART || Math.abs(k.y - one.y) > CROWD_APART);
      if (room) kept.push(one);
      else { one.crowded = true; thinned++; }
    }
  }
  return { small, thinned, cells: cells.size, pulled, zones };
}

function build(seen, kit, dirty, options = {}) {
  const undergrowth = thinScenery(seen, kit);
  console.log('  thinned     ' + undergrowth.thinned.toLocaleString() + ' of '
    + undergrowth.small.toLocaleString() + ' small things, from '
    + undergrowth.pulled.toLocaleString() + ' of ' + undergrowth.cells.toLocaleString()
    + ' patches that were over their own zone average, across '
    + undergrowth.zones.toLocaleString() + ' zones');

  /*
   * The sea around and inside what was walked, worked out fresh each time and
   * kept beside the recording rather than in it. Every chunk is redrawn when
   * it changes, because the coast moves as more of the realm is walked.
   */
  seen.sea = findSea(seen.tiles, kit.grounds);
  if (seen.sea) {
    console.log('  ' + seen.sea.open.toLocaleString() + ' tiles of open sea drawn round the realm'
      + (seen.sea.pools ? ', and ' + seen.sea.pools.toLocaleString() + ' in pools inside it' : ''));
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (seen.sea) {
    minX = seen.sea.minX; minY = seen.sea.minY;
    maxX = seen.sea.minX + seen.sea.wide - 1; maxY = seen.sea.minY + seen.sea.tall - 1;
  }
  for (const key of seen.tiles.keys()) {
    const x = key % KEY, y = (key - x) / KEY;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const c0 = Math.floor(minX / CHUNK), c1 = Math.floor(maxX / CHUNK);
  const r0 = Math.floor(minY / CHUNK), r1 = Math.floor(maxY / CHUNK);

  fs.mkdirSync(OUT, { recursive: true });
  seen.ledger.versions = seen.ledger.versions || {};
  const versions = seen.ledger.versions;

  const missing = new Map();
  const chunks = [];
  let redrawn = 0, drawn = 0;

  for (let cr = r0; cr <= r1; cr++) {
    for (let cc = c0; cc <= c1; cc++) {
      const name = cc + '_' + cr;
      const file = name + '.png';
      const full = path.join(OUT, file);
      const known = fs.existsSync(full);
      const stale = !dirty || dirty.has(name) || !known;

      if (!stale) {
        if (known) chunks.push({ file, col: cc, row: cr, v: versions[name] || 1,
          bytes: fs.statSync(full).size });
        continue;
      }
      const made = drawChunk(seen, kit, cc, cr, missing);
      if (!made) {
        if (known) chunks.push({ file, col: cc, row: cr, v: versions[name] || 1,
          bytes: fs.statSync(full).size });
        continue;
      }
      fs.writeFileSync(full, made.png);
      fs.writeFileSync(full.replace(/\.png$/, '.ground.png'), made.ground);
      versions[name] = (versions[name] || 0) + 1;
      redrawn++;
      drawn += made.drawn;
      chunks.push({ file, col: cc, row: cr, v: versions[name], bytes: made.png.length });
    }
  }

  buildSky(kit);
  buildWater(seen, kit, minX, minY, maxX, maxY);
  buildThings(seen, kit);

  const manifest = {
    px: PX, chunk: CHUNK, side,
    minX, minY, maxX, maxY,
    stamp: Date.now(),
    tiles: seen.tiles.size,
    chunks,
    recordings: seen.files
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

  /*
   * The page carries its own pictures - but only when it is small enough to,
   * and only as a fallback. Served over a local address the page prefers the
   * files beside it, so it can pick up a chunk that has just been redrawn
   * without being rebuilt itself. Opened straight off disk it cannot read
   * them, so what it carries is what it shows.
   */
  let carried = false;
  if (options.writePage !== false) {
    const CAP = 48 * 1024 * 1024;
    const weight = chunks.reduce((n, c) => n + c.bytes, 0);
    carried = weight <= CAP;
    if (carried) {
      for (const c of chunks) {
        c.data = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, c.file)).toString('base64');
      }
    }
    fs.writeFileSync(path.join(OUT, 'index.html'), viewer(manifest));
    for (const c of chunks) delete c.data;
  } else {
    carried = fs.existsSync(path.join(OUT, 'index.html'));
  }

  if (options.saveStore !== false) saveStore(seen.tiles, seen.objects, seen.ledger);
  return { chunks: chunks.length, redrawn, drawn, missing, carried,
    span: (maxX - minX + 1) + ' x ' + (maxY - minY + 1), minX, minY };
}

function report(added, seen, before, out, quiet) {
  for (const f of added) {
    console.log('  + ' + f.file.padEnd(34) + String(f.tiles).padStart(7) + ' tiles  '
      + String(f.objects).padStart(6) + ' objects   fills ' + (100 * f.fill).toFixed(1) + '% of its box'
      + (f.whole ? '' : '   CUT SHORT: ' + f.stopped));
  }
  const objectTotal = [...seen.objects.values()].reduce((n, v) => n + v.length, 0);
  console.log('  = ' + 'the map so far'.padEnd(34) + String(seen.tiles.size).padStart(7) + ' tiles  '
    + String(objectTotal).padStart(6) + ' objects'
    + (added.length ? '   (' + (seen.tiles.size - before) + ' new)' : ''));
  console.log('    ' + out.span + ' tiles from ' + out.minX + ',' + out.minY
    + '   ' + out.chunks + ' chunks, ' + out.redrawn + ' redrawn');
  if (!quiet && out.missing.size) {
    const worst = [...out.missing].sort((a, b) => b[1] - a[1]);
    const total = worst.reduce((n, row) => n + row[1], 0);
    console.log('\n  ' + total.toLocaleString('en-US') + ' placements had no art in the client ('
      + out.missing.size + ' kinds):');
    for (const [id, n] of worst.slice(0, 6)) console.log('    ' + String(n).padStart(6) + '  ' + id);
  }
}

/*
 * Whole patches that are not this realm.
 *
 * A recording keeps whatever the client was showing, and now and then that is
 * somewhere else entirely - a vault, a nexus, a seasonal room walked into and
 * out of again. One such sits eight hundred tiles off the coast in the corner
 * of the chart: fifty tiles square of wood plank floor and Space, nothing
 * ever met in it, connected to nothing.
 *
 * A line in data/Realm/off-the-map.txt marks one by a tile inside it, and
 * everything joined to that tile goes. Joined, rather than a rectangle, so it
 * keeps working as more is walked - and capped, so a line put by mistake on
 * the realm itself cannot quietly delete the realm.
 */
const ELSEWHERE_CAP = 60000;             // tiles; past this it is not a stray room

function dropElsewhere(seen, kit) {
  const points = kit.offMap.elsewhere;
  if (!points || !points.length) return;
  let gone = 0, left = 0;
  for (const [px, py] of points) {
    const from = py * KEY + px;
    if (!seen.tiles.has(from)) continue;
    const patch = [from];
    const taken = new Set([from]);
    for (let i = 0; i < patch.length && patch.length <= ELSEWHERE_CAP; i++) {
      const at = patch[i];
      const x = at % KEY, y = (at - x) / KEY;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const next = (y + dy) * KEY + (x + dx);
        if (taken.has(next) || !seen.tiles.has(next)) continue;
        taken.add(next); patch.push(next);
      }
    }
    if (patch.length > ELSEWHERE_CAP) {
      console.log('  the patch at ' + px + ',' + py + ' runs to '
        + patch.length.toLocaleString() + ' tiles and was left alone'
        + ' - that is the realm, not a room off it');
      left++;
      continue;
    }
    for (const at of patch) { seen.tiles.delete(at); seen.objects.delete(at); }
    gone += patch.length;
  }
  if (gone) {
    console.log('  ' + gone.toLocaleString()
      + ' tiles dropped as being somewhere else, not this realm');
  }
}

function main() {
  const watching = process.argv.includes('--watch') || process.argv.includes('-w');
  const kit = prepare();

  const seen = loadStore();
  const before = seen.tiles.size;
  const dirty = new Set();
  const added = foldNew(seen.tiles, seen.objects, seen.ledger, dirty);
  dropElsewhere(seen, kit);
  if (!seen.tiles.size && !watching) {
    console.error('\n  No recordings in ' + path.relative(root, CAPTURE) + '\n');
    process.exit(1);
  }
  seen.files = Object.entries(seen.ledger.files).map(([file, v]) =>
    ({ file, tiles: v.tiles, objects: v.objects }));

  console.log('');
  if (!added.length) {
    console.log('  nothing new - every recording in ' + path.relative(root, CAPTURE)
      + ' is already in the map');
  }
  // Everything is redrawn on a plain run, so a change to how things are drawn
  // reaches the whole map; only a watch redraws just what moved.
  const out = build(seen, kit, null);
  report(added, seen, before, out, false);

  const page = fs.statSync(path.join(OUT, 'index.html')).size;
  console.log('\n  open ' + path.relative(root, path.join(OUT, 'index.html'))
    + '  (' + (page / 1048576).toFixed(1) + ' MB'
    + (out.carried ? ', self-contained - just double-click it)' : ')'));
  if (!out.carried) {
    console.log('  too large to carry its own pictures, so it needs to be served:');
    console.log('    npx serve ' + root + '   then /local/realm/index.html');
  }

  if (!watching) { console.log(''); return; }

  /*
   * Watching.
   *
   * The map grows as recordings land. A file appearing in the capture folder
   * is folded in and the few chunks it touched are redrawn; a page open on a
   * served copy notices the manifest change within a second or two and picks
   * up only the pictures that moved. So the map fills in while you play, and
   * a hole in it is a place to walk back to rather than something to find out
   * about afterwards.
   *
   * A file is left alone until it has stopped growing - a recording being
   * written is half a file, and half a JSON file is no file at all.
   */
  console.log('\n  watching ' + path.relative(root, CAPTURE) + ' - Ctrl+C to stop');
  console.log('  the page reloads itself when it is served from a local address\n');

  let timer = null;
  let running = false;
  let queued = false;
  const refresh = () => {
    if (running) { queued = true; return; }
    running = true;
    try {
      const before = seen.tiles.size;
      const dirty = new Set();
      const added = foldNew(seen.tiles, seen.objects, seen.ledger, dirty);
      if (added.length) {
        seen.files = Object.entries(seen.ledger.files).map(([file, v]) =>
          ({ file, tiles: v.tiles, objects: v.objects }));
        const at = new Date().toTimeString().slice(0, 8);
        console.log('  ' + at);
        report(added, seen, before, build(seen, kit, dirty, { writePage: false, saveStore: false }), true);
        console.log('');
      }
    } catch (e) {
      // A live JSON can be observed between writes. Try again on the next tick.
    } finally {
      running = false;
      if (queued) {
        queued = false;
        clearTimeout(timer);
        timer = setTimeout(refresh, 150);
      }
    }
  };
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  };
  fs.mkdirSync(CAPTURE, { recursive: true });
  fs.watch(CAPTURE, (kind, name) => { if (name && /\.json$/.test(name)) settle(); });
  setInterval(refresh, 500);                     // live files may never settle
  const save = () => {
    try { saveStore(seen.tiles, seen.objects, seen.ledger); } catch {}
  };
  setInterval(save, 30000);
  process.on('SIGINT', () => { save(); process.exit(0); });
  process.on('SIGTERM', () => { save(); process.exit(0); });
}

/* ------------------------------------------------------------------ *
 * The viewer                                                          *
 * ------------------------------------------------------------------ */
function viewer(manifest) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Realm, as recorded</title>
<style>
  html, body { margin: 0; height: 100%; background: #0b0d12; overflow: hidden;
    font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #7b8496; }
  #map { position: absolute; inset: 0; cursor: grab; }
  #map.drag { cursor: grabbing; }
  #sheet { position: absolute; transform-origin: 0 0; }
  #sheet img { position: absolute; image-rendering: pixelated; display: block; }
  #bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 6px 10px;
    background: #0b0d12dd; border-top: 1px solid #1b2030; display: flex; gap: 18px;
    align-items: baseline; }
  #live { margin-left: auto; }
  .on { color: #6ee7a8; }
  .off { color: #4b5364; }
  .beat { animation: beat 1s ease-out; }
  @keyframes beat { from { color: #fff2b0; } to { color: #6ee7a8; } }
</style>
<div id="map"><div id="sheet"></div></div>
<div id="bar">
  <span id="where">-</span>
  <span id="what">-</span>
  <span>drag to pan | wheel to zoom | double-click to fit</span>
  <span id="live" class="off">static</span>
</div>
<script>
/*
 * The manifest is written into the page as well as beside it, so the file can
 * simply be double-clicked. Opened straight off disk a page may not fetch its
 * own neighbours - a browser treats every local file as its own origin - but
 * it may still show them, so the images load and only the manifest had to
 * arrive another way.
 */
const INLINE = ${JSON.stringify(manifest)};
const map = document.getElementById('map');
const sheet = document.getElementById('sheet');
const where = document.getElementById('where');
const what = document.getElementById('what');
const live = document.getElementById('live');
let M = null, view = { x: 0, y: 0, z: 1 }, placed = false;
const shown = new Map();

// Where this page lives, whichever way it was opened: straight off disk, or
// through a server that drops the index.html from the address.
const BASE = (() => {
  let at = location.pathname;
  if (/\.html?$/i.test(at)) return at.replace(/[^/]*$/, '');
  return at.endsWith('/') ? at : at + '/';
})();

function draw(m, useFiles) {
  M = m;
  for (const c of m.chunks) {
    const src = useFiles ? BASE + c.file + '?v=' + (c.v || 1) : c.data;
    let img = shown.get(c.file);
    if (!img) {
      img = document.createElement('img');
      img.width = m.side; img.height = m.side;
      img.style.left = (c.col * m.side) + 'px';
      img.style.top = (c.row * m.side) + 'px';
      sheet.appendChild(img);
      shown.set(c.file, img);
    }
    if (img.dataset.v !== String(c.v || 1) || img.src !== src) {
      img.dataset.v = String(c.v || 1);
      img.src = src;
    }
  }
  for (const [file, img] of shown) {
    if (!m.chunks.some(c => c.file === file)) { img.remove(); shown.delete(file); }
  }
  what.textContent = m.recordings.length + ' recording(s) | '
    + (m.tiles || 0).toLocaleString() + ' tiles | ' + m.chunks.length + ' chunks';
  if (!placed) { placed = true; fit(); }
}

/*
 * Served from a local address the page reads the manifest beside it every
 * second and a half, and replaces only the chunks whose version has moved.
 * The view is left exactly where it is: the point of watching is to see a
 * hole fill in while you are looking at it.
 */
let stamp = null;
function poll() {
  fetch(BASE + 'manifest.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(m => {
      live.className = 'on';
      live.textContent = 'live';
      if (m.stamp !== stamp) {
        if (stamp !== null) { live.className = 'on beat'; setTimeout(() => live.className = 'on', 1000); }
        stamp = m.stamp;
        draw(m, true);
      }
    })
    .catch(() => {
      if (stamp === null) { live.className = 'off'; live.textContent = 'static'; }
    });
}

fetch(BASE + 'manifest.json', { cache: 'no-store' })
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(m => { stamp = m.stamp; live.className = 'on'; live.textContent = 'live'; draw(m, true); setInterval(poll, 1500); })
  .catch(() => draw(INLINE, false));

function fit() {
  if (!M) return;
  const w = (M.maxX - M.minX + 1) * M.px, h = (M.maxY - M.minY + 1) * M.px;
  view.z = Math.min(map.clientWidth / w, (map.clientHeight - 30) / h) * 0.96;
  view.x = -M.minX * M.px * view.z + (map.clientWidth - w * view.z) / 2;
  view.y = -M.minY * M.px * view.z + (map.clientHeight - 30 - h * view.z) / 2;
  apply();
}
function apply() {
  sheet.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')';
}
map.addEventListener('wheel', e => {
  e.preventDefault();
  const k = e.deltaY > 0 ? 1 / 1.2 : 1.2;
  const next = Math.max(0.02, Math.min(16, view.z * k));
  const r = next / view.z;
  view.x = e.clientX - (e.clientX - view.x) * r;
  view.y = e.clientY - (e.clientY - view.y) * r;
  view.z = next;
  apply();
}, { passive: false });
let from = null;
map.addEventListener('pointerdown', e => {
  from = { x: e.clientX - view.x, y: e.clientY - view.y };
  map.classList.add('drag'); map.setPointerCapture(e.pointerId);
});
map.addEventListener('pointermove', e => {
  if (M) {
    const tx = Math.floor(((e.clientX - view.x) / view.z) / M.px);
    const ty = Math.floor(((e.clientY - view.y) / view.z) / M.px);
    where.textContent = 'tile ' + tx + ', ' + ty + '   x' + view.z.toFixed(2);
  }
  if (!from) return;
  view.x = e.clientX - from.x; view.y = e.clientY - from.y; apply();
});
map.addEventListener('pointerup', () => { from = null; map.classList.remove('drag'); });
map.addEventListener('dblclick', fit);
addEventListener('resize', () => { if (!from) fit(); });
</script>
`;
}

main();
