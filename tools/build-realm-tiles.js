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
    const sprites = flat.vector(fields[2]);
    const rects = [];
    for (let s = 0; s < sprites.length; s++) {
      const sprite = flat.fields(flat.indirect(sprites.at + s * 4));
      if (!sprite[0] || !sprite[7]) { rects.push(null); continue; }
      rects.push({
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
  + [...atlases.values()].reduce((n, r) => n + r.length, 0).toLocaleString('en-US') + ' sprites');

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

function learnFromCapture(biomeNames) {
  if (!fs.existsSync(CAPTURE)) return null;
  const seen = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'));
  const groundName = nameById('GroundTypes');
  const objectName = nameById('Objects');

  // Which biome a name belongs to, by the same matching the rest of the tool
  // uses. Nameless grounds come back null and are placed by where they sit.
  const biomeOf = text => {
    const flat = plain(text || '');
    for (const biome of biomeNames) {
      if (flat.includes(plain(ALIAS[biome] || biome))) return biome;
    }
    return null;
  };

  const { minX, minY, maxX, maxY } = seen.bounds;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const atCell = new Int32Array(width * height).fill(-1);
  const cellBiome = new Array(width * height).fill(null);

  for (const tile of seen.tiles) {
    const i = (tile.y - minY) * width + (tile.x - minX);
    if (i < 0 || i >= atCell.length) continue;
    atCell[i] = tile.type;
    cellBiome[i] = biomeOf(groundName.get(tile.type));
  }

  /*
   * Spread each named biome outwards over the nameless ground around it, a
   * ring at a time, so a cell of "Dark Grass" takes the biome of whatever
   * named ground it is nearest. Eight rings is about forty tiles of reach at
   * this scale — enough to cross a clearing, not enough to jump a coast.
   */
  const frontier = [];
  for (let i = 0; i < cellBiome.length; i++) if (cellBiome[i]) frontier.push(i);
  let edge = frontier;
  for (let ring = 0; ring < 8 && edge.length; ring++) {
    const next = [];
    for (const i of edge) {
      const x = i % width, y = (i - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const j = ny * width + nx;
        if (cellBiome[j] || atCell[j] < 0) continue;
        cellBiome[j] = cellBiome[i];
        next.push(j);
      }
    }
    edge = next;
  }

  // Ground counted per biome, and roads left out: they are drawn as roads.
  const ground = new Map();
  const tileTally = new Map();
  for (let i = 0; i < atCell.length; i++) {
    const biome = cellBiome[i];
    if (!biome || atCell[i] < 0) continue;
    const name = groundName.get(atCell[i]) || '';
    tileTally.set(biome, (tileTally.get(biome) || 0) + 1);
    if (/^road /i.test(name)) continue;
    /*
     * A cell's biome comes from what surrounds it, which is right for ground
     * with no name of its own and wrong for ground that has one. Oryx's
     * castle sits inside the realm, so its flagstones fall within a ring or
     * two of half the biomes here and were being counted as their floor. If a
     * ground names a biome, it belongs to that one or to none.
     */
    const owner = biomeOf(name);
    if (owner && owner !== biome) continue;
    if (!owner && /castle|shatters|oryx|nexus|vault|guild/i.test(name)) continue;
    // Beacons and set pieces are things placed on a biome, not the biome.
    if (/beacon|set piece/i.test(name)) continue;
    if (!ground.has(biome)) ground.set(biome, new Map());
    const bag = ground.get(biome);
    bag.set(atCell[i], (bag.get(atCell[i]) || 0) + 1);
  }

  // And what was standing on it, by the biome of the ground underneath.
  const props = new Map();
  for (const object of seen.observedObjects || []) {
    const x = Math.round(object.x) - minX, y = Math.round(object.y) - minY;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const biome = cellBiome[y * width + x];
    if (!biome) continue;
    const name = objectName.get(object.type) || '';
    // Barriers and beacon beams are the game's furniture, not the realm's.
    if (/barrier|beacon|portal|wall|loot bag|anchor|set piece/i.test(name)) continue;
    /*
     * Where it stood says which biome it is in; what it is called overrules
     * that when the two disagree. A Sprite Forest mushroom growing a few
     * tiles inside Dead Church is a mushroom near a border, not evidence
     * that Dead Church has mushrooms — and taking the location alone had
     * every biome inheriting its neighbour's scenery.
     */
    const owns = biomeOf(name);
    if (owns && owns !== biome) continue;
    if (!props.has(biome)) props.set(biome, new Map());
    const bag = props.get(biome);
    bag.set(object.type, (bag.get(object.type) || 0) + 1);
  }

  return { ground, props, tileTally, groundName, objectName, bounds: seen.bounds };
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
function tileFor(ground) {
  const rects = atlases.get(ground.atlas);
  if (!rects) return null;
  const rect = rects[ground.index];
  if (!rect || !rect.sheet || !rect.w || !rect.h) return null;
  const sheet = pixels.get(rect.sheet);
  if (!sheet || rect.x + rect.w > sheet.width || rect.y + rect.h > sheet.height) return null;

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
  console.log('  capture: ' + covered.length + ' biomes walked, '
    + covered.reduce((n, row) => n + row[1], 0).toLocaleString('en-US') + ' tiles placed');
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
    .map(ground => ({ ground, tile: tileFor(ground) }))
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
        const tile = tileFor(ground);
        if (!tile) return null;
        const look = meanOf(tile);
        return look && look.solid > 0.9 ? { ground, tile, look, weight: count } : null;
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
    if (fromLife.length) {
      if (fromLife.length < 4) {
        const seenTypes = new Set(fromLife.map(entry => entry.ground.type));
        for (const entry of chosen) {
          if (fromLife.length >= 6) break;
          if (seenTypes.has(entry.ground.type)) continue;
          // Roads are drawn as roads and beacons are drawn as beacons; neither
          // is floor, and neither should be scattered over one.
          if (/beacon|^road |set piece/i.test(entry.ground.id)) continue;
          // A walk-on part: often enough to be seen, rare enough that the
          // ground the realm was actually seen to be still reads as the floor.
          fromLife.push({ ...entry, weight: Math.max(1, Math.round(floor / 300)) });
        }
      }
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
      .map(ground => ({ ground, tile: tileFor(ground) }))
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
const fell = report.filter(row => row[1] !== 'named').length;
console.log('\n  ' + report.length + ' biomes -> ' + path.relative(root, OUT)
  + (fell ? ', ' + fell + ' by colour for want of a named ground type' : '') + '\n');
