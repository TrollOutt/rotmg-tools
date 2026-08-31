'use strict';
/*
 * Give every biome the tiles the game actually floors it with.
 *
 *   node tools/extract-client-textures.js     (sheets + the sprite registry)
 *   node tools/build-realm-tiles.js
 *
 * Three things have to meet for this to work, and all three are the client's:
 *
 *   GroundTypes    10,400 ground types, each naming an atlas and an index —
 *                  and, it turns out, naming its biome: "Risen Hell Lava",
 *                  "Runic Tundra Light Ice", "Sprite Forest Grass".
 *   spritesheet    a FlatBuffers registry: for each atlas, the rectangle every
 *                  one of its sprites occupies in the packed sheets.
 *   the sheets     groundTiles and mapObjects, the pixels themselves.
 *
 * So a ground type resolves to a rectangle resolves to a tile, and its own
 * name says which biome it belongs to. Nothing is guessed at — which matters,
 * because a biome's floor is not one tile repeated: it is dirt and grass and
 * the worn patches between them, and around an encounter it is arranged.
 *
 * Where a biome's name matches no ground type the old bargain still applies:
 * the tiles nearest its colour, and the report says which biomes fell back.
 *
 * And where the realm has actually been walked, it is not a bargain at all.
 * client-data/capture/realm-map.json holds tens of thousands of real
 * placements — this ground type, at this coordinate — so for the biomes it
 * covers the tiles are the ones the server laid down, in the proportions it
 * laid them, with the decorations it stood on them at the density it used.
 * That file is a local extract and is never published; only what is learned
 * from it is.
 *
 * The join for the generic grounds is worth explaining, because it is the
 * only clever part. "Dark Grass" and "Shoreline Sand" carry no biome in their
 * name, so no amount of string matching places them. But every observation
 * has a coordinate, so a cell whose ground is nameless can be given the biome
 * of the named ground around it. Which is how the plains and the beaches —
 * the biomes with no ground type of their own — finally get real tiles.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const SHEETS = path.join(root, 'client-data', 'textures');
const REGISTRY = path.join(root, 'client-data', 'spritesheet.bin');
const GROUND = path.join(root, 'client-data');
const BIOMES = path.join(root, 'data', 'Realm', 'realm-biomes.txt');
const OUT = path.join(root, 'web', 'assets', 'realm-tiles');

// How many tiles a biome gets. Enough that a field of them does not repeat
// visibly, few enough that the strip stays small.
const PER_BIOME = 10;

/*
 * The atlas the client calls a ground type's home is one of two packed
 * sheets, and the registry says which by a small number.
 */
const SHEET_OF = { 1: 'groundTiles', 4: 'mapObjects' };

/* ---------------- FlatBuffers, only as far as needed ---------------- */
class Flat {
  constructor(buffer) { this.b = buffer; }
  u16(at) { return this.b.readUInt16LE(at); }
  i32(at) { return this.b.readInt32LE(at); }
  u32(at) { return this.b.readUInt32LE(at); }
  f32(at) { return this.b.readFloatLE(at); }
  root() { return this.u32(0); }
  fields(table) {
    const v = table - this.i32(table);
    const size = this.u16(v);
    const out = [];
    for (let slot = 0; slot * 2 + 4 < size; slot++) {
      const offset = this.u16(v + 4 + slot * 2);
      out.push(offset ? table + offset : 0);
    }
    return out;
  }
  string(at) { const p = at + this.u32(at); const n = this.u32(p); return this.b.toString('utf8', p + 4, p + 4 + n); }
  vector(at) { const p = at + this.u32(at); return { at: p + 4, length: this.u32(p) }; }
  indirect(at) { return at + this.u32(at); }
}

/* ---------------- PNG ---------------- */
function readPng(buffer) {
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
function writePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- read it all in ---------------- */
for (const needed of [REGISTRY, path.join(SHEETS, 'groundTiles.png')]) {
  if (fs.existsSync(needed)) continue;
  console.error('\n  ' + path.relative(root, needed) + ' is missing. Run:'
    + '\n    node tools/extract-client-textures.js\n');
  process.exit(1);
}

const flat = new Flat(fs.readFileSync(REGISTRY));
const atlases = new Map();
{
  const list = flat.vector(flat.fields(flat.root())[0]);
  for (let i = 0; i < list.length; i++) {
    const fields = flat.fields(flat.indirect(list.at + i * 4));
    /*
     * A sprite is filed under the number it carries, not where it sits.
     *
     * The registry's sprite vector is sorted by the *text* of that number, so
     * an atlas runs 0, 1, 10, 11, 12, 121, 122, 13, ... and a sprite's
     * position in the vector is its index only for the first two. Reading
     * position as index — which is what this did — quietly hands back a
     * different picture for all but the first couple of entries in every
     * atlas, which is how the beach came to be paved in dark red brick.
     *
     * The number itself is the sprite's fourth field, and FlatBuffers leaves
     * a field out when it holds the default, so an absent one means nought.
     */
    const sprites = flat.vector(fields[2]);
    const rects = new Map();
    for (let s = 0; s < sprites.length; s++) {
      const sprite = flat.fields(flat.indirect(sprites.at + s * 4));
      if (!sprite[0] || !sprite[7]) continue;
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
}
console.log('\n  registry: ' + atlases.size + ' atlases, '
  + [...atlases.values()].reduce((n, r) => n + r.size, 0).toLocaleString('en-US') + ' sprites');

const grounds = [];
for (const file of fs.readdirSync(GROUND).filter(name => /^GroundTypes\./.test(name))) {
  const text = fs.readFileSync(path.join(GROUND, file), 'utf8');
  for (const m of text.matchAll(/<Ground\b([^>]*)>([\s\S]*?)<\/Ground>/g)) {
    const id = /id="([^"]*)"/.exec(m[1]);
    const type = /type="([^"]*)"/.exec(m[1]);
    const art = /<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
    if (id && art) {
      grounds.push({
        id: id[1], atlas: art[1], index: Number(art[2]),
        type: type ? (Number(type[1]) & 0xffff) : null
      });
    }
  }
}
console.log('  ' + grounds.length.toLocaleString('en-US') + ' ground types');

/*
 * And the things standing on the ground.
 *
 * The client names these after their biome too — "Sanguine Forest Single Red
 * Vine", "Runic Tundra Small Ice", "Undead Forest Small Purple Tree" — so the
 * same trick that finds a biome's floor finds what grows out of it. Static
 * ones only: anything that moves is a creature, and creatures come from
 * somewhere else.
 */
const props = [];
for (const file of fs.readdirSync(GROUND).filter(name => /^Objects\./.test(name))) {
  const text = fs.readFileSync(path.join(GROUND, file), 'utf8');
  for (const m of text.matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
    if (!m[2].includes('<Class>GameObject</Class>') || !m[2].includes('<Static')) continue;
    const id = /id="([^"]*)"/.exec(m[1]);
    const type = /type="([^"]*)"/.exec(m[1]);
    const art = /<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
    if (id && art) {
      props.push({
        id: id[1], atlas: art[1], index: Number(art[2]),
        type: type ? (Number(type[1]) & 0xffff) : null
      });
    }
  }
}
console.log('  ' + props.length.toLocaleString('en-US') + ' static objects');

const pixels = new Map();
for (const name of new Set(Object.values(SHEET_OF))) {
  const file = path.join(SHEETS, name + '.png');
  if (fs.existsSync(file)) pixels.set(name, readPng(fs.readFileSync(file)));
}

const biomes = new Map();
for (const raw of fs.readFileSync(BIOMES, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('##')) continue;
  const [hex, biome] = line.split('|');
  if (!hex || !biome) continue;
  if (!biomes.has(biome)) biomes.set(biome, []);
  biomes.get(biome).push([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
}

/* ---------------- what the realm was actually seen to be ---------------- */
/*
 * Everything below reads the capture if it is there, and does nothing at all
 * if it is not — a clone without one still builds, just by name and colour.
 */
const CAPTURE = path.join(root, 'client-data', 'capture', 'realm-map.json');

function nameById(prefix) {
  const out = new Map();
  for (const file of fs.readdirSync(GROUND).filter(name => new RegExp('^' + prefix + '\\.').test(name))) {
    const text = fs.readFileSync(path.join(GROUND, file), 'utf8');
    for (const m of text.matchAll(/<(?:Ground|Object)\b([^>]*)>/g)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      const id = /id="([^"]+)"/.exec(m[1]);
      if (type && id) out.set(Number(type[1]) & 0xffff, id[1]);
    }
  }
  return out;
}

/*
 * The traced map, which is the only thing that knows the whole realm's shape.
 */
const traced = (() => {
  const file = path.join(root, 'data', 'Realm', 'realm-terrain.txt');
  const beaconFile = path.join(root, 'data', 'Realm', 'realm-beacons.txt');
  if (!fs.existsSync(file)) return null;
  const legend = new Map();
  const grid = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('legend|')) {
      const part = line.split('|');
      legend.set(part[1], { hex: part[2], biome: part[3] });
    } else if (line && !line.startsWith('#')) grid.push(line);
  }
  if (!grid.length) return null;
  const beacons = [];
  if (fs.existsSync(beaconFile)) {
    for (const line of fs.readFileSync(beaconFile, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const part = line.split('|');
      const col = Number(part[0]), row = Number(part[1]);
      if (Number.isFinite(col) && Number.isFinite(row)) beacons.push({ col, row });
    }
  }
  const cols = grid[0].length, rows = grid.length;
  // Sea is the letter the tracer gave open water, and anything the legend
  // never named — off the edge of the picture is sea too.
  const wet = (col, row) => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return true;
    const letter = grid[row][col];
    const entry = legend.get(letter);
    return !entry || /water|ocean|sea/i.test(entry.biome || '');
  };
  return {
    cols, rows, beacons, wet,
    biomeOfCell: (col, row) => {
      const entry = legend.get(grid[row][col]);
      return entry ? entry.biome : null;
    }
  };
})();

/*
 * Join the capture's coordinates to the traced map's, using the beacons.
 *
 * Two observed beacons matched to two traced ones give a scale and an offset
 * per axis. There are a few thousand such pairings and only one of them is
 * right, so each is scored by how many of the *other* observed beacons it
 * then lands on a traced beacon. The winner is checked a second time against
 * the coastline, which was traced from a picture and knows nothing about
 * where any beacon is: if the walked water does not fall on the traced water,
 * the two agreements cannot both be coincidence and neither can be trusted.
 */
function alignToTraced(objects, objectName, atTile, groundName) {
  if (!traced || traced.beacons.length < 4) return null;
  const found = [];
  for (const object of objects) {
    const name = objectName.get(object.type) || '';
    if (!/^(Actual Active Beacon|Captured Beacon|Teleport Beacon|Beacon Guardian [A-Z])/.test(name)) continue;
    if (found.some(c => Math.abs(c.x - object.x) < 20 && Math.abs(c.y - object.y) < 20)) continue;
    found.push({ x: object.x, y: object.y });
  }
  if (found.length < 4) return null;

  const want = traced.beacons;
  let best = null;
  for (let a = 0; a < found.length; a++) {
    for (let b = a + 1; b < found.length; b++) {
      const dx = found[b].x - found[a].x, dy = found[b].y - found[a].y;
      // A pair too close together turns a small error in either into a large
      // one in the scale, so only well-separated beacons set it.
      if (Math.abs(dx) < 60 || Math.abs(dy) < 60) continue;
      for (let i = 0; i < want.length; i++) {
        for (let j = 0; j < want.length; j++) {
          if (i === j) continue;
          const ex = want[j].col - want[i].col, ey = want[j].row - want[i].row;
          if (!ex || !ey) continue;
          const sx = dx / ex, sy = dy / ey;
          if (sx < 6 || sx > 11 || sy < 6 || sy > 11) continue;
          const ox = found[a].x / sx - want[i].col;
          const oy = found[a].y / sy - want[i].row;
          let hit = 0, err = 0;
          for (const one of found) {
            const col = one.x / sx - ox, row = one.y / sy - oy;
            let near = Infinity;
            for (const w of want) near = Math.min(near, Math.abs(w.col - col) + Math.abs(w.row - row));
            if (near < 2.5) { hit++; err += near; }
          }
          if (!best || hit > best.hit || (hit === best.hit && err < best.err)) {
            best = { sx, sy, ox, oy, hit, err };
          }
        }
      }
    }
  }
  if (!best || best.hit < Math.max(4, found.length * 0.6)) return null;

  // The second, independent check.
  const wet = type => /ocean water|shoreline water|deep water/i.test(groundName.get(type) || '');
  let ok = 0, n = 0;
  for (const [key, type] of atTile) {
    const x = key % 100000, y = (key - x) / 100000;
    const col = Math.floor(x / best.sx - best.ox), row = Math.floor(y / best.sy - best.oy);
    if (col < 0 || col >= traced.cols || row < 0 || row >= traced.rows) continue;
    n++;
    if (traced.wet(col, row) === wet(type)) ok++;
  }
  const coast = n ? ok / n : 0;
  if (coast < 0.9) return null;
  return { ...best, beacons: found.length, coast, checked: n };
}

function learnFromCapture(biomeNames) {
  const dir = path.dirname(CAPTURE);
  if (!fs.existsSync(dir)) return null;

  /*
   * Every walk there is, laid on top of one another.
   *
   * Each file is one session's worth of realm: the tiles the client was told
   * about while it was being walked through. They cover different ground, so
   * they are merged rather than chosen between, and where two sessions saw
   * the same tile the later one wins — the realm is regenerated between them,
   * but its shape is not, so the disagreements are few and about details.
   */
  const atTile = new Map();                         // y * KEY + x -> ground type
  const objects = [];
  const KEY = 100000;
  let walks = 0;
  for (const file of fs.readdirSync(dir).filter(name => /\.json$/.test(name)).sort()) {
    let seen;
    try { seen = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
    if (!Array.isArray(seen.tiles) || !seen.tiles.length) continue;
    walks++;
    for (const tile of seen.tiles) atTile.set(tile.y * KEY + tile.x, tile.type);
    for (const object of seen.observedObjects || []) objects.push(object);
  }
  if (!atTile.size) return null;

  const groundName = nameById('GroundTypes');
  const objectName = nameById('Objects');

  /*
   * Where a walked tile falls on the traced map.
   *
   * The two speak different coordinates — the capture in the server's own
   * tiles, the traced map in cells of an annotated picture — and until they
   * are joined a walk can only be attributed to a biome by reading the names
   * of the ground in it. That worked for the twelve biomes with a ground type
   * carrying their name and not at all for the seven without, which is why
   * the plains and the beach were still being guessed at from colour: their
   * floor is called "Shoreline Sand" and "New Low Forest Grass" and belongs,
   * by name, to nobody.
   *
   * The beacons join them. Both sources know where all of them are, so two
   * beacons matched to two beacons give a scale and an offset per axis, and
   * the right pairing is the one that then puts every other observed beacon
   * on a traced one. What comes out is checked against the coastline, which
   * knows nothing about beacons: if the two independent agreements do not
   * both hold, the fit is refused and the tool falls back to reading names.
   */
  const fit = alignToTraced(objects, objectName, atTile, groundName);
  if (!fit) return null;

  const biomeAt = (x, y) => {
    const col = Math.floor(x / fit.sx - fit.ox);
    const row = Math.floor(y / fit.sy - fit.oy);
    if (col < 0 || col >= traced.cols || row < 0 || row >= traced.rows) return null;
    const biome = traced.biomeOfCell(col, row);
    return biome && !/water|ocean|sea/i.test(biome) ? biome : null;
  };

  /*
   * Which ground is a floor, and which belongs to something built.
   *
   * A biome's floor is laid over the whole biome, so wherever it appears at
   * all it appears nearly everywhere: cut the realm into blocks of sixteen by
   * sixteen and a floor fills eighty-five to a hundred and thirty of the two
   * hundred and fifty-six cells in every block it touches. A monument's floor
   * — a beacon platform, a churchyard, the flagstones of a ruin — is laid in
   * one tight shape, so it touches a few blocks and fills less than fifty of
   * each. Between forty-eight and eighty-six there is nothing at all, which
   * is a wide enough gap to put a line through.
   *
   * The distinction matters because the two are used differently. A floor is
   * scattered at random over its biome; a monument is not scattered anywhere,
   * because its tiles mean nothing except in the arrangement they were built
   * in. Treating the second as the first is what put the churchyard's purple
   * grass in clumps all over Dead Church.
   */
  const BLOCK = 16;
  const FLOOR_FILL = 70;
  const blocksOf = new Map();
  for (const [key, type] of atTile) {
    const x = key % KEY, y = (key - x) / KEY;
    if (!blocksOf.has(type)) blocksOf.set(type, new Map());
    const bag = blocksOf.get(type);
    const block = Math.floor(y / BLOCK) * KEY + Math.floor(x / BLOCK);
    bag.set(block, (bag.get(block) || 0) + 1);
  }
  const structural = new Set();
  for (const [type, bag] of blocksOf) {
    let total = 0;
    for (const n of bag.values()) total += n;
    if (total / bag.size < FLOOR_FILL) structural.add(type);
  }

  // Which biome a ground's name claims, where it claims one at all. Read off
  // the traced map a tile could sit a cell inside its neighbour, so a ground
  // that names a biome is still only counted for the one it names.
  const claims = text => {
    const flat = plain(text || '');
    for (const biome of biomeNames) {
      if (flat.includes(plain(ALIAS[biome] || biome))) return biome;
    }
    return null;
  };

  const ground = new Map();
  const tileTally = new Map();
  for (const [key, type] of atTile) {
    const x = key % KEY, y = (key - x) / KEY;
    const biome = biomeAt(x, y);
    if (!biome) continue;
    const name = groundName.get(type) || '';
    tileTally.set(biome, (tileTally.get(biome) || 0) + 1);
    if (/^road /i.test(name)) continue;
    const owner = claims(name);
    if (owner && owner !== biome) continue;
    if (!owner && /castle|shatters|oryx|nexus|vault|guild/i.test(name)) continue;
    // Beacons and set pieces are things placed on a biome, not the biome.
    if (/beacon|set piece/i.test(name)) continue;
    // And neither is anything that was only ever laid in one tight shape.
    if (structural.has(type)) continue;
    if (!ground.has(biome)) ground.set(biome, new Map());
    const bag = ground.get(biome);
    bag.set(type, (bag.get(type) || 0) + 1);
  }

  // And what was standing on it, by the biome of the ground underneath.
  const props = new Map();
  for (const object of objects) {
    const biome = biomeAt(Math.round(object.x), Math.round(object.y));
    if (!biome) continue;
    const name = objectName.get(object.type) || '';
    // Barriers and beacon beams are the game's furniture, not the realm's.
    if (/barrier|beacon|portal|wall|loot bag|anchor|set piece/i.test(name)) continue;
    /*
     * Where it stood says which biome it is in; what it is called overrules
     * that when the two disagree. A Sprite Forest mushroom growing a few
     * tiles inside Dead Church is a mushroom near a border, not evidence
     * that Dead Church has mushrooms.
     */
    const owns = claims(name);
    if (owns && owns !== biome) continue;
    if (!props.has(biome)) props.set(biome, new Map());
    const bag = props.get(biome);
    bag.set(object.type, (bag.get(object.type) || 0) + 1);
  }

  /*
   * The beacon platform.
   *
   * Every beacon in the realm stands in the middle of the same plate: a
   * square of the castle's flagstones, a ring of the darker ones, Oryx's rug
   * at the centre. They are identical tile for tile — which is the proof that
   * it is built rather than grown, and the reason it can be stamped rather
   * than sown.
   *
   * No single walk covers a whole plate, so they are laid on top of one
   * another and each cell takes the type that at least two of them agree on.
   * The ground around the plate differs from beacon to beacon, so it loses
   * every vote it might have won.
   */
  const REACH = 10;
  const SPAN = 2 * REACH + 1;
  const centres = [];
  for (const object of objects) {
    const name = objectName.get(object.type) || '';
    if (!/^(Actual Active Beacon|Captured Beacon|Beacon Guardian [A-Z])/.test(name)) continue;
    const x = Math.round(object.x), y = Math.round(object.y);
    if (centres.some(c => Math.abs(c[0] - x) < 14 && Math.abs(c[1] - y) < 14)) continue;
    centres.push([x, y]);
  }
  const votes = Array.from({ length: SPAN * SPAN }, () => new Map());
  let plates = 0;
  for (const [cx, cy] of centres) {
    let hits = 0;
    for (let dy = -REACH; dy <= REACH; dy++) {
      for (let dx = -REACH; dx <= REACH; dx++) {
        const type = atTile.get((cy + dy) * KEY + (cx + dx));
        if (type === undefined) continue;
        hits++;
        const bag = votes[(dy + REACH) * SPAN + (dx + REACH)];
        bag.set(type, (bag.get(type) || 0) + 1);
      }
    }
    if (hits > 200) plates++;
  }
  let plate = null;
  if (plates >= 3) {
    /*
     * Roads are laid rather than grown, so they pass the built test, but a
     * road is not part of the plate it runs up to — and every beacon's road
     * is its own biome's, so at the centre, where they all arrive, no single
     * type can win. Left in, the vote splits five ways and punches a hole
     * through the middle of the plate. So roads are set aside and the best
     * of what is left takes the cell.
     */
    const cells = votes.map(bag => {
      let best = -1, most = 0;
      for (const [type, n] of bag) {
        if (!structural.has(type)) continue;
        if (/^road /i.test(groundName.get(type) || '')) continue;
        if (n > most) { most = n; best = type; }
      }
      return most >= 2 ? best : -1;
    });
    /*
     * Where the plate stops, found by its own symmetry.
     *
     * A beacon's position rounds to one tile or its neighbour depending on
     * which side of a half it fell, so the beacon is not reliably the middle
     * of anything. But the plate is built, and built things are symmetric: a
     * cell and the cell opposite it through the centre hold the same tile.
     * So the four candidate centres around the beacon are each tried, and the
     * one that carries the largest square that reads the same upside down is
     * the middle of the plate.
     */
    const mirrors = (cx, cy, r) => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const a = cells[(cy + dy) * SPAN + (cx + dx)];
          const b = cells[(cy - dy) * SPAN + (cx - dx)];
          if (a === undefined || b === undefined || a !== b) return false;
        }
      }
      return true;
    };
    let best = null;
    for (const cy of [REACH - 1, REACH]) {
      for (const cx of [REACH - 1, REACH]) {
        let r = 0;
        while (r + 1 <= Math.min(cx, cy, SPAN - 1 - cx, SPAN - 1 - cy) && mirrors(cx, cy, r + 1)) r++;
        if (!best || r > best.r) best = { cx, cy, r };
      }
    }
    if (best && best.r >= 4) {
      const { cx, cy, r } = best;
      const span = 2 * r + 1;
      const cut = [];
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) cut.push(cells[y * SPAN + x]);
      }
      /*
       * A plate is one built thing, so it has no holes in it. What is left
       * unresolved is the few cells at the very centre, where every beacon's
       * road arrives and covers the floor from a different direction; they
       * take the nearest cell that was resolved.
       */
      for (let pass = 0; pass < span; pass++) {
        let left = 0;
        for (let i = 0; i < cut.length; i++) {
          if (cut[i] >= 0) continue;
          const x = i % span, y = (i - x) / span;
          let take = -1;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= span || ny < 0 || ny >= span) continue;
            if (cut[ny * span + nx] >= 0) { take = cut[ny * span + nx]; break; }
          }
          if (take >= 0) cut[i] = take; else left++;
        }
        if (!left) break;
      }
      plate = { w: span, h: span, ox: r, oy: r, cells: cut, seen: plates };
    }
  }

  return { ground, props, tileTally, structural, plate, groundName, objectName, walks, fit };
}

/*
 * The client does not always call a place what the map does. Where it does
 * not, the name it uses is written here rather than left to a guess.
 */
const ALIAS = { 'Abandoned City': 'Ancient City', 'Coral Reefs': 'Coral Reef' };

/*
 * What a floor is called when nothing is named for the biome.
 *
 * The generic terrains — the plains, the forests, the beach — have no ground
 * type carrying their name, so those fall back to colour. Left to the whole
 * catalogue that picked things like "AI Untaris Dark Background Crater": the
 * right colour, and nothing anyone would call a floor. Restricting the pool
 * to ground types that sound like ground is cruder than a name and far better
 * than none.
 */
const SOUNDS_LIKE_GROUND = /grass|dirt|sand|stone|ice|snow|rock|water|tile|floor|moss|mud|gravel|earth|soil/i;

/* ---------------- cut ---------------- */
const plain = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
/*
 * The rectangle, trimmed to what is actually drawn in it.
 *
 * The registry's rectangles carry a pixel of transparent padding on each side
 * — an eight-by-eight tile is filed as ten by ten — which the packer needs
 * and nothing downstream does. Left in, it costs twice: a floor tile reads as
 * 64 % opaque and gets thrown out as a decoration, and the tiles that survive
 * are laid with a transparent seam between them. Trimming to the opaque
 * bounding box fixes both, and for a tile that genuinely has transparency in
 * it — water, a flower — it simply changes nothing.
 */
const TILE_ART = 8;                            // the game's ground tile, in pixels

function tileFor(ground, isFloor) {
  const rects = atlases.get(ground.atlas);
  if (!rects) return null;
  const rect = rects.get(ground.index);
  if (!rect || !rect.sheet || !rect.w || !rect.h) return null;
  const sheet = pixels.get(rect.sheet);
  if (!sheet || rect.x + rect.w > sheet.width || rect.y + rect.h > sheet.height) return null;

  /*
   * A floor is cut to the size the game draws it, which is eight pixels
   * square — the atlases say so in their own names. The registry files it as
   * ten by ten with a pixel of packer's padding all round, so the middle
   * eight are taken and the padding is left behind.
   *
   * Its own outline will not do here, even though that is right for a tree.
   * Grass is drawn with gaps in it; take the outline of "New Low Forest
   * Grass" and you get six pixels by eight, which then has to be stretched
   * back across a whole tile. The blades come out fat and the tile no longer
   * lines up with its neighbours.
   */
  if (isFloor) {
    const w = Math.min(TILE_ART, rect.w), h = Math.min(TILE_ART, rect.h);
    return {
      rect: {
        x: rect.x + Math.floor((rect.w - w) / 2),
        y: rect.y + Math.floor((rect.h - h) / 2),
        w, h, sheet: rect.sheet
      },
      sheet
    };
  }

  let minX = rect.w, minY = rect.h, maxX = -1, maxY = -1;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (sheet.pixels[((rect.y + y) * sheet.width + rect.x + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;                       // nothing drawn in it at all
  const trimmed = {
    x: rect.x + minX, y: rect.y + minY,
    w: maxX - minX + 1, h: maxY - minY + 1,
    sheet: rect.sheet
  };
  return { rect: trimmed, sheet };
}
const luminance = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
function meanOf(tile) {
  const { rect, sheet } = tile;
  let r = 0, g = 0, b = 0, seen = 0;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = ((rect.y + y) * sheet.width + rect.x + x) * 4;
      if (sheet.pixels[i + 3] < 200) continue;
      r += sheet.pixels[i]; g += sheet.pixels[i + 1]; b += sheet.pixels[i + 2]; seen++;
    }
  }
  return seen ? { mean: [r / seen, g / seen, b / seen], solid: seen / (rect.w * rect.h) } : null;
}

const learned = learnFromCapture([...biomes.keys()]);
if (learned) {
  const covered = [...learned.tileTally].sort((a, b) => b[1] - a[1]);
  console.log('  capture: ' + learned.walks + ' walks, ' + covered.length + ' biomes, '
    + covered.reduce((n, row) => n + row[1], 0).toLocaleString('en-US') + ' tiles placed');
  console.log('  aligned on ' + learned.fit.beacons + ' beacons ('
    + learned.fit.hit + ' matched), coastline agrees on '
    + (100 * learned.fit.coast).toFixed(1) + '% of '
    + learned.fit.checked.toLocaleString('en-US') + ' tiles');
}
const groundByType = new Map();
for (const ground of grounds) if (ground.type !== null && !groundByType.has(ground.type)) groundByType.set(ground.type, ground);
const propByType = new Map();
for (const prop of props) if (prop.type !== null && !propByType.has(prop.type)) propByType.set(prop.type, prop);
/*
 * Everything with art, static or not. What the realm was seen to stand on its
 * ground is scenery whether or not the client tagged it Static — the tag is
 * about collision, not about whether the thing is furniture.
 */
const anyByType = new Map();
for (const file of fs.readdirSync(GROUND).filter(name => /^Objects\./.test(name))) {
  const text = fs.readFileSync(path.join(GROUND, file), 'utf8');
  for (const m of text.matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const type = /type="([^"]*)"/.exec(m[1]);
    const id = /id="([^"]*)"/.exec(m[1]);
    const art = /<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
    if (!type || !id || !art) continue;
    const key = Number(type[1]) & 0xffff;
    if (!anyByType.has(key)) anyByType.set(key, { id: id[1], atlas: art[1], index: Number(art[2]), type: key });
  }
}

fs.mkdirSync(OUT, { recursive: true });
const index = {};
const report = [];
for (const [biome, colours] of biomes) {
  const wanted = plain(ALIAS[biome] || biome);
  let chosen = grounds
    .filter(ground => plain(ground.id).includes(wanted))
    .map(ground => ({ ground, tile: tileFor(ground, true) }))
    .filter(entry => entry.tile)
    .map(entry => ({ ...entry, look: meanOf(entry.tile) }))
    // A floor tile is opaque. A half-empty rectangle is a decoration that
    // happens to be filed as ground.
    .filter(entry => entry.look && entry.look.solid > 0.95);

  let how = 'named';

  /*
   * What the realm was seen to be beats what its name suggests. The weight is
   * the number of times that ground was actually laid, so a biome that is
   * nine parts sand and one part rock is drawn nine parts sand.
   */
  const observed = learned && learned.ground.get(biome);
  if (observed && observed.size) {
    let fromLife = [...observed]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PER_BIOME * 2)
      .map(([type, count]) => {
        const ground = groundByType.get(type);
        if (!ground) return null;
        const tile = tileFor(ground, true);
        if (!tile) return null;
        /*
         * Barely a gate at all, and deliberately. Opacity used to stand in
         * for "is this a floor", which it does badly: shoreline sand is three
         * quarters opaque and low forest grass is seven tenths, so the test
         * threw out the floor of the beach and of the plains — the two biomes
         * it was most needed for. What makes a floor a floor is that it was
         * laid over a whole biome, and the block test upstream already knows
         * that. All that is left to catch here is art that is very nearly
         * empty, which no floor is.
         */
        const look = meanOf(tile);
        return look && look.solid > 0.3 ? { ground, tile, look, weight: count } : null;
      })
      .filter(Boolean);
    /*
     * Even one real observation beats the colour search, so a biome seen to
     * be sand and water is drawn sand and water. What it is short of is made
     * up from the ground that carries its name, at a weight low enough that
     * the observed floor still dominates.
     */
    const floor = fromLife.reduce((n, e) => n + e.weight, 0);
    // Seen once in ten thousand is a seam or a stray, not a floor, and it
    // costs a slot in a ten-tile strip that a real tile could have had.
    fromLife = fromLife.filter(e => e.weight * 400 >= floor);
    /*
     * What was walked is the answer, and it is not topped up.
     *
     * Filling a short list out from the grounds that carry the biome's name
     * made sense while a walk could only be attributed by name and most
     * biomes had none. Now that a walk is read off the traced map, a biome
     * with three observed floors has three floors — and the top-up was
     * putting beach towels on the beach, because "Beach Towel 1" carries the
     * name and nothing about a name says a thing is ground.
     */
    if (fromLife.length) {
      chosen = fromLife;
      how = 'walked';
    }
  }

  if (how !== 'walked' && chosen.length < 3) {
    // No ground type says this biome's name. Fall back to colour, over every
    // tile the registry knows.
    how = 'colour';
    const target = [0, 1, 2].map(c => colours.reduce((sum, rgb) => sum + rgb[c], 0) / colours.length);
    chosen = grounds
      .filter(ground => SOUNDS_LIKE_GROUND.test(ground.id))
      .map(ground => ({ ground, tile: tileFor(ground, true) }))
      .filter(entry => entry.tile && entry.tile.rect.w <= 16 && entry.tile.rect.h <= 16)
      .map(entry => ({ ...entry, look: meanOf(entry.tile) }))
      .filter(entry => entry.look && entry.look.solid > 0.95)
      .sort((a, b) =>
        ((a.look.mean[0] - target[0]) ** 2 + (a.look.mean[1] - target[1]) ** 2 + (a.look.mean[2] - target[2]) ** 2)
        - ((b.look.mean[0] - target[0]) ** 2 + (b.look.mean[1] - target[1]) ** 2 + (b.look.mean[2] - target[2]) ** 2));
  }

  /*
   * What a biome is mostly made of, not a sample across everything ever seen
   * in it. Spreading the pick made sense when the order was arbitrary; on a
   * list sorted by how often the ground was actually laid it reaches into the
   * tail and comes back with set pieces instead of grass. Where the order is
   * arbitrary — the name and colour paths — spreading still applies.
   */
  const picked = [];
  if (how === 'walked') {
    for (const entry of chosen) { if (picked.length >= PER_BIOME) break; picked.push(entry); }
  } else {
    const step = Math.max(1, Math.floor(chosen.length / PER_BIOME));
    for (let i = 0; i < chosen.length && picked.length < PER_BIOME; i += step) picked.push(chosen[i]);
  }
  if (!picked.length) { report.push([biome, 'none', 0, '']); continue; }

  /*
   * Ordered dark to light, which is what makes coherent noise usable: the
   * atlas picks a tile by a smooth field rather than at random, so slot 0
   * next to slot 1 has to mean something. Brightness is the ordering the eye
   * already reads as worn-to-fresh, dirt-to-grass.
   */
  picked.sort((a, b) => luminance(a.look.mean) - luminance(b.look.mean));

  const slug = biome.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cut = (entries, file) => {
    const size = Math.max(...entries.map(e => Math.max(e.tile.rect.w, e.tile.rect.h)));
    const stripWidth = size * entries.length;
    const strip = Buffer.alloc(stripWidth * size * 4);
    entries.forEach((entry, slot) => {
      const { rect, sheet } = entry.tile;
      // Small art is centred in its cell rather than shoved into the corner,
      // so a tuft and a tree sit on the same ground line.
      const ox = Math.floor((size - rect.w) / 2);
      const oy = size - rect.h;
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const from = ((rect.y + y) * sheet.width + rect.x + x) * 4;
          const to = ((y + oy) * stripWidth + slot * size + x + ox) * 4;
          sheet.pixels.copy(strip, to, from, from + 4);
        }
      }
    });
    fs.writeFileSync(path.join(OUT, file), writePng(stripWidth, size, strip));
    return { file, tile: size, count: entries.length };
  };

  const strip = cut(picked, slug + '.png');
  // Weights ride along with the strip, so the atlas can lay a biome down in
  // the proportions it was seen in rather than evenly.
  strip.weights = picked.map(entry => entry.weight || 1);
  strip.names = picked.map(entry => entry.ground.id);
  // Each floor's own average colour, for the atlas to lay behind it. Many of
  // the client's floors are drawn with gaps in them and need something solid
  // underneath; their own colour is the one thing that cannot show a seam.
  strip.colours = picked.map(entry => '#' + entry.look.mean
    .map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
  strip.from = how;
  index[biome] = { ground: strip };

  /*
   * And what stands on it. Only what the client names for this biome — there
   * is no guessing a fallback here, because a biome with no vine of its own
   * is better bare than wearing another's.
   */
  const watched = learned && learned.props.get(biome);
  let standing = [];
  let density = 0;
  if (watched && watched.size) {
    // How thickly the realm actually stands things on this ground: one prop
    // per so many tiles, straight off the count.
    const walked = learned.tileTally.get(biome) || 0;
    const total = [...watched.values()].reduce((n, v) => n + v, 0);
    if (walked > 200) density = total / walked;
    standing = [...watched]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PER_BIOME * 2)
      .map(([type, count]) => {
        const prop = propByType.get(type) || anyByType.get(type);
        if (!prop) return null;
        const tile = tileFor(prop);
        // Up to a two-by-two tile: a large tree is scenery too, and holding
        // the limit at 24 was throwing away the commonest thing in half the
        // biomes — Coral Reefs lost its seaweed, the desert lost its trees.
        if (!tile || tile.rect.w > 40 || tile.rect.h > 40) return null;
        const look = meanOf(tile);
        return look && look.solid > 0.04 && look.solid < 0.97
          ? { ground: prop, tile, look, weight: count, name: prop.id } : null;
      })
      .filter(Boolean);
  }
  if (standing.length < 2) {
    density = 0;
    standing = props
      .filter(prop => plain(prop.id).includes(wanted))
      .map(prop => ({ ground: prop, tile: tileFor(prop) }))
      .filter(entry => entry.tile && entry.tile.rect.w <= 24 && entry.tile.rect.h <= 24)
      .map(entry => ({ ...entry, look: meanOf(entry.tile) }))
      // Something you can see through is scenery; something solid is a wall.
      .filter(entry => entry.look && entry.look.solid > 0.08 && entry.look.solid < 0.9);
  }
  if (standing.length >= 2) {
    const spread = Math.max(1, Math.floor(standing.length / PER_BIOME));
    const someProps = [];
    for (let i = 0; i < standing.length && someProps.length < PER_BIOME; i += spread) someProps.push(standing[i]);
    const propStrip = cut(someProps, slug + '-props.png');
    propStrip.weights = someProps.map(entry => entry.weight || 1);
    propStrip.names = someProps.map(entry => entry.ground.id);
    // Capped: a biome seen with a prop on every other tile was seen in its
    // busiest corner, and a whole region drawn that way is a thicket.
    if (density) propStrip.density = Math.min(0.22, density);
    index[biome].props = propStrip;
    report.push([biome, how, picked.length, picked[0].ground.id, someProps.length, someProps[0].ground.id]);
  } else {
    report.push([biome, how, picked.length, picked[0].ground.id, 0, '']);
  }
}

/*
 * The monuments, which are stamped rather than sown.
 *
 * One so far: the plate every beacon stands on. It goes out as its own
 * small strip of tiles plus the arrangement they are laid in — a grid of
 * slots into that strip, and where the beacon itself stands in it — so the
 * atlas can put the real thing down at each of the thirty-nine beacons it
 * already knows the position of, instead of scattering flagstones about.
 */
const monuments = {};
if (learned && learned.plate) {
  const plate = learned.plate;
  const order = [...new Set(plate.cells.filter(type => type >= 0))];
  const entries = order
    .map(type => {
      const ground = groundByType.get(type);
      const tile = ground && tileFor(ground, true);
      return tile ? { ground, tile } : null;
    })
    .filter(Boolean);
  const slotOf = new Map(entries.map((entry, i) => [entry.ground.type, i]));
  if (entries.length) {
    const size = Math.max(...entries.map(e => Math.max(e.tile.rect.w, e.tile.rect.h)));
    const stripWidth = size * entries.length;
    const strip = Buffer.alloc(stripWidth * size * 4);
    entries.forEach((entry, slot) => {
      const { rect, sheet } = entry.tile;
      const ox = Math.floor((size - rect.w) / 2);
      const oy = size - rect.h;
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const from = ((rect.y + y) * sheet.width + rect.x + x) * 4;
          sheet.pixels.copy(strip, ((y + oy) * stripWidth + slot * size + x + ox) * 4, from, from + 4);
        }
      }
    });
    fs.writeFileSync(path.join(OUT, 'beacon-plate.png'), writePng(stripWidth, size, strip));
    monuments.beacon = {
      file: 'beacon-plate.png', tile: size, count: entries.length,
      w: plate.w, h: plate.h, ox: plate.ox, oy: plate.oy,
      names: entries.map(entry => entry.ground.id),
      cells: plate.cells.map(type => (slotOf.has(type) ? slotOf.get(type) : -1)),
      seen: plate.seen
    };
    console.log('');
    console.log('  beacon plate: ' + plate.w + 'x' + plate.h + ' of ' + entries.length
      + ' tiles, merged from ' + plate.seen + ' walked beacons');
    console.log('    ' + entries.map(entry => entry.ground.id).join(', '));
  }
}
fs.writeFileSync(path.join(OUT, 'monuments.json'), JSON.stringify(monuments, null, 2) + String.fromCharCode(10));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log('');
for (const [biome, how, n, example, propCount, propExample] of report) {
  const strip = index[biome];
  const density = strip && strip.props && strip.props.density;
  console.log('    ' + biome.padEnd(18) + String(n).padStart(2) + ' tiles ' + how.padEnd(7)
    + String(propCount).padStart(3) + ' props '
    + (density ? (100 * density).toFixed(0).padStart(3) + '%  ' : '      ')
    + (propExample || example || ''));
}
const walked = report.filter(row => row[1] === 'walked').length;
if (walked) console.log('\n  ' + walked + ' biomes taken from ground that was actually walked');
const fell = report.filter(row => row[1] === 'colour').length;
console.log('\n  ' + report.length + ' biomes -> ' + path.relative(root, OUT)
  + (fell ? ', ' + fell + ' still by colour for want of a name or a walk' : '') + '\n');
