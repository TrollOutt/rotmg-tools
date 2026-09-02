'use strict';
/*
 * Cut the encounters and the Heroes of Oryx out of the game client.
 *
 *   node tools/boss-sprites.js            what it would do, and nothing else
 *   node tools/boss-sprites.js --write    cut them and write them
 *
 * The imported reference data names the things a realm is actually visited
 * for - the Cube God, the Lord of the Lost Lands, the Skull Shrine - and the
 * side panel wants a picture of each. Most of them have none: the catalogue
 * that came with the data covers the common ones and stops, and fifty-six
 * were left with nothing at all.
 *
 * They are all in the client. The difficulty is only that the client does not
 * call them what the wiki calls them, so a name has to be matched three ways:
 * the id it is filed under, the name it is shown by, and - failing both - a
 * name that contains it. Every match is printed with the client id it came
 * from, and the loose ones are printed apart, because a picture of the wrong
 * monster is worse than none.
 *
 * Written where the roles tool already looks, so it is picked up by:
 *
 *   node tools/merge-realm-roles.js --atlas=DIR
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const TEXTURES = path.join(XML, 'textures');
const REGISTRY = path.join(XML, 'spritesheet.bin');
const MONSTERS = path.join(root, 'web', 'assets', 'realm-monsters');
const CATALOG = path.join(root, 'web', 'assets', 'realm-catalog');
const WRITE = process.argv.includes('--write');

/*
 * The same name-to-filename rule the rest of the pipeline uses, curly
 * apostrophe and all: it leaves a stranded s, so Dragon's Treasure is filed
 * as dragon-s-treasure, and the catalogue that came with the data is already
 * spelt that way. Spelling it more sensibly here would simply mean the roles
 * tool never found any of these.
 */
const slug = name => String(name).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ *
 * Pictures, read and written                                          *
 * ------------------------------------------------------------------ */
function readPng(buffer) {
  let at = 8, width = 0, height = 0;
  const parts = [];
  while (at < buffer.length) {
    const len = buffer.readUInt32BE(at);
    const kind = buffer.toString('latin1', at + 4, at + 8);
    if (kind === 'IHDR') { width = buffer.readUInt32BE(at + 8); height = buffer.readUInt32BE(at + 12); }
    if (kind === 'IDAT') parts.push(buffer.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  let from = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[from++];
    const line = raw.subarray(from, from + stride); from += stride;
    const above = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const here = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? here[x - 4] : 0, b = above[x], c = x >= 4 ? above[x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      here[x] = v & 0xff;
    }
  }
  return { width, height, pixels: out };
}

function crc(buffer) {
  let c = ~0;
  for (let i = 0; i < buffer.length; i++) {
    c ^= buffer[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function writePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (kind, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(kind, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ *
 * The sprite registry                                                 *
 * ------------------------------------------------------------------ */
class Flat {
  constructor(b) { this.b = b; }
  u32(at) { return this.b.readUInt32LE(at); }
  i32(at) { return this.b.readInt32LE(at); }
  f32(at) { return this.b.readFloatLE(at); }
  root() { return this.u32(0); }
  fields(at) {
    const table = at - this.i32(at);
    const size = this.b.readUInt16LE(table);
    const out = [];
    for (let i = 4; i < size; i += 2) {
      const off = this.b.readUInt16LE(table + i);
      out.push(off ? at + off : 0);
    }
    return out;
  }
  indirect(at) { return at + this.u32(at); }
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

const SHEET_OF = { 1: 'groundTiles', 2: 'characters', 4: 'mapObjects' };

function loadFrames() {
  const flat = new Flat(fs.readFileSync(REGISTRY));
  const fields = flat.fields(flat.root());
  const moving = new Map();                      // "atlas#index" -> frames
  const records = flat.vector(fields[1]);
  for (let i = 0; i < records.length; i++) {
    const record = flat.fields(flat.indirect(records.at + i * 4));
    if (!record[0] || !record[5]) continue;
    const sprite = flat.fields(flat.indirect(record[5]));
    if (!sprite[0] || !sprite[7]) continue;
    const key = flat.string(record[0]) + '#' + (record[1] ? flat.i32(record[1]) : 0);
    if (!moving.has(key)) moving.set(key, []);
    moving.get(key).push({
      facing: record[3] ? flat.i32(record[3]) : 0,
      doing: record[4] ? flat.i32(record[4]) : 0,
      x: Math.round(flat.f32(sprite[0])), y: Math.round(flat.f32(sprite[0] + 4)),
      w: Math.round(flat.f32(sprite[0] + 8)), h: Math.round(flat.f32(sprite[0] + 12)),
      sheet: SHEET_OF[flat.i32(sprite[7])] || null
    });
  }
  const still = new Map();
  const atlases = flat.vector(fields[0]);
  for (let i = 0; i < atlases.length; i++) {
    const atlas = flat.fields(flat.indirect(atlases.at + i * 4));
    const sprites = flat.vector(atlas[2]);
    const rects = new Map();
    for (let s = 0; s < sprites.length; s++) {
      const sprite = flat.fields(flat.indirect(sprites.at + s * 4));
      if (!sprite[0] || !sprite[7]) continue;
      const index = sprite[3] ? flat.i32(sprite[3]) : 0;
      if (rects.has(index)) continue;
      rects.set(index, {
        x: Math.round(flat.f32(sprite[0])), y: Math.round(flat.f32(sprite[0] + 4)),
        w: Math.round(flat.f32(sprite[0] + 8)), h: Math.round(flat.f32(sprite[0] + 12)),
        sheet: SHEET_OF[flat.i32(sprite[7])] || null
      });
    }
    still.set(flat.string(atlas[0]), rects);
  }
  return { moving, still };
}

/* ------------------------------------------------------------------ *
 * What the client has, and what it is called                          *
 * ------------------------------------------------------------------ */
function readClient() {
  const byName = new Map();                      // slug -> record
  const all = [];
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8')
      .matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
      const id = /id="([^"]*)"/.exec(m[1]);
      if (!id) continue;
      const shown = /<DisplayId>([^<]*)<\/DisplayId>/.exec(m[2]);
      const art = /<(?:Animated)?Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
      if (!art) continue;
      const one = {
        id: id[1], shown: shown ? shown[1] : null,
        atlas: art[1].trim(), index: Number(art[2]),
        enemy: /<Enemy\s*\/?>/.test(m[2]),
        size: Number((/<Size>([^<]+)<\/Size>/.exec(m[2]) || [0, 100])[1]) || 100
      };
      all.push(one);
      for (const name of [one.id, one.shown]) {
        if (!name) continue;
        const key = slug(name);
        // An enemy beats a decoration of the same name, and the first of
        // either wins - the client repeats a name across reskins.
        if (!byName.has(key) || (one.enemy && !byName.get(key).enemy)) byName.set(key, one);
      }
    }
  }
  return { byName, all };
}

/* ------------------------------------------------------------------ *
 * Do it                                                               *
 * ------------------------------------------------------------------ */
function main() {
  if (!fs.existsSync(REGISTRY) || !fs.existsSync(TEXTURES)) {
    console.error('\n  This needs the extracted client art:'
      + '\n    node tools/extract-client-textures.js\n');
    process.exit(1);
  }

  /* Everyone the reference data expects a picture of. */
  const data = JSON.parse(fs.readFileSync(path.join(root, 'web', 'realmeye-data.json'), 'utf8'));
  const wanted = new Map();                      // name -> where it is expected
  const biomes = Array.isArray(data.biomes) ? data.biomes : Object.values(data.biomes || {});
  for (const biome of biomes) {
    // The wildlife is on the map already; these are the ones a realm is
    // actually visited for, and none of them was met on a walk through it.
    for (const part of ['encounters', 'heroes', 'beaconGuardians']) {
      for (const one of ((biome.groups || {})[part] || [])) {
        const name = typeof one === 'string' ? one : (one && one.name);
        if (name && !wanted.has(name)) wanted.set(name, part);
      }
    }
  }

  const has = name => {
    const key = slug(name);
    for (const [dir, file] of [
      [MONSTERS, key + '.png'], [CATALOG, key + '.png'],
      [CATALOG, key + '.gif'], [CATALOG, key + '.webp']
    ]) if (fs.existsSync(path.join(dir, file))) return true;
    return false;
  };

  const missing = [...wanted.keys()].filter(name => !has(name));
  console.log(wanted.size + ' encounters, heroes and guardians named in the data');
  console.log('  ' + missing.length + ' of them have no picture anywhere\n');
  if (!missing.length) return;

  const client = readClient();
  const frames = loadFrames();
  const sheets = new Map();
  const sheetFor = name => {
    if (!sheets.has(name)) {
      const file = path.join(TEXTURES, name + '.png');
      sheets.set(name, fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null);
    }
    return sheets.get(name);
  };

  /*
   * Standing still and facing the way the game shows most. An encounter is
   * one picture, not a walk - it is a portrait in a list.
   */
  const cutOf = one => {
    let rect = null;
    const run = frames.moving.get(one.atlas + '#' + one.index);
    if (run && run.length) {
      const facings = [...new Set(run.map(f => f.facing))].sort();
      const facing = facings.includes(0) ? 0 : facings[0];
      rect = run.find(f => f.facing === facing && f.doing === 0)
        || run.find(f => f.facing === facing) || run[0];
    }
    if (!rect) {
      const bag = frames.still.get(one.atlas);
      rect = bag && bag.get(one.index);
    }
    if (!rect || !rect.sheet || !rect.w || !rect.h) return null;
    const sheet = sheetFor(rect.sheet);
    if (!sheet || rect.x + rect.w > sheet.width || rect.y + rect.h > sheet.height) return null;
    return { rect, sheet };
  };

  /* Blown up whole pixels to about the size the other pictures are. */
  const AIM = 80;
  const draw = made => {
    const { rect, sheet } = made;
    const grow = Math.max(1, Math.round(AIM / Math.max(rect.w, rect.h)));
    const side = Math.max(rect.w, rect.h) * grow;
    const out = Buffer.alloc(side * side * 4);
    const ox = ((side - rect.w * grow) >> 1), oy = ((side - rect.h * grow) >> 1);
    for (let y = 0; y < rect.h * grow; y++) {
      for (let x = 0; x < rect.w * grow; x++) {
        const f = ((rect.y + ((y / grow) | 0)) * sheet.width + rect.x + ((x / grow) | 0)) * 4;
        if (sheet.pixels[f + 3] < 8) continue;
        const t = ((oy + y) * side + ox + x) * 4;
        sheet.pixels.copy(out, t, f, f + 4);
      }
    }
    return { png: writePng(side, side, out), side };
  };

  const sure = [], loose = [], lost = [];
  for (const name of missing) {
    const key = slug(name);
    let one = client.byName.get(key), how = 'its own name';
    if (!one) {
      // The wiki drops a "the", pluralises, or adds a word the client omits.
      const bare = key.replace(/^the-/, '');
      one = client.byName.get(bare) || client.byName.get(bare + 's') || client.byName.get(bare.replace(/s$/, ''));
      if (one) how = 'a name close to it';
    }
    if (!one) {
      const hits = client.all.filter(o => o.enemy
        && (slug(o.id).includes(key) || key.includes(slug(o.id))));
      if (hits.length === 1) { one = hits[0]; how = 'the only client name containing it'; }
    }
    if (!one) { lost.push(name); continue; }
    const made = cutOf(one);
    if (!made) { lost.push(name + '  (found "' + one.id + '" but it has no art)'); continue; }
    const picture = draw(made);
    const row = { name, from: one.id, how, side: picture.side, png: picture.png };
    (how === 'its own name' ? sure : loose).push(row);
  }

  const put = row => {
    const file = path.join(MONSTERS, slug(row.name) + '.png');
    if (WRITE) fs.writeFileSync(file, row.png);
    return path.relative(root, file);
  };

  console.log('matched by the name the client uses (' + sure.length + '):');
  for (const row of sure) {
    console.log('  ' + row.name.padEnd(34) + ' <- ' + row.from.padEnd(34)
      + ' ' + row.side + 'px  ' + put(row));
  }
  if (loose.length) {
    console.log('\nmatched loosely - worth an eye (' + loose.length + '):');
    for (const row of loose) {
      console.log('  ' + row.name.padEnd(34) + ' <- ' + row.from.padEnd(34)
        + ' by ' + row.how);
      put(row);
    }
  }
  if (lost.length) {
    console.log('\nstill nothing for ' + lost.length + ':');
    for (const name of lost) console.log('  ' + name);
  }
  console.log('\n' + (WRITE
    ? (sure.length + loose.length) + ' pictures written into ' + path.relative(root, MONSTERS)
    : 'nothing written - run again with --write'));
}

main();
