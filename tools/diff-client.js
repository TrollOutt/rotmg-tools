#!/usr/bin/env node
/*
 * What a game update brought.
 *
 * Two extractions of the client, one before an update and one after, read
 * object for object and compared. What comes out is every piece of equipment,
 * skin, creature and dungeon that appeared, vanished or had a number changed,
 * with its picture cut from the client's own sheets - moving, where the client
 * draws it moving.
 *
 *     node tools/diff-client.js
 *
 * The "before" is a copy of client-data taken while the old client was still
 * installed, kept in local/client-before. There is no way to make one after
 * the fact: the update overwrites the client in place, and nothing on disk
 * remembers what it replaced. So the copy is made before running the scrape,
 * and this reads it.
 *
 * Output is web/assets/whats-new/ - one picture per thing, a strip per
 * animation, and an index naming what moved and by how much.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const AFTER = path.join(root, 'client-data');
const BEFORE = path.join(root, 'local', 'client-before');
const TEXTURES = path.join(AFTER, 'textures');
const REGISTRY = path.join(AFTER, 'spritesheet.bin');
const OUT = path.join(root, 'web', 'assets', 'whats-new');

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
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ *
 * The sprite registry                                                 *
 * ------------------------------------------------------------------ */
class Flat {
  constructor(buffer) { this.b = buffer; }
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

// Which sheet a sprite's pixels are on. Two is the character sheet, which is
// where everything that moves lives - players, skins, monsters.
const SHEET_OF = { 1: 'groundTiles', 2: 'characters', 4: 'mapObjects' };

function loadSprites() {
  const flat = new Flat(fs.readFileSync(REGISTRY));
  const fields = flat.fields(flat.root());

  // Still pictures: one rectangle per (atlas, index).
  const still = new Map();
  const list = flat.vector(fields[0]);
  for (let i = 0; i < list.length; i++) {
    const atlas = flat.fields(flat.indirect(list.at + i * 4));
    const name = flat.string(atlas[0]);
    const sprites = flat.vector(atlas[2]);
    const rects = new Map();
    for (let s = 0; s < sprites.length; s++) {
      const sprite = flat.fields(flat.indirect(sprites.at + s * 4));
      if (!sprite[0] || !sprite[7]) continue;
      // Filed under the number it carries: the vector is sorted by the text
      // of that number, so position is index only for the first two entries.
      const index = sprite[3] ? flat.i32(sprite[3]) : 0;
      if (rects.has(index)) continue;
      rects.set(index, {
        x: Math.round(flat.f32(sprite[0])), y: Math.round(flat.f32(sprite[0] + 4)),
        w: Math.round(flat.f32(sprite[0] + 8)), h: Math.round(flat.f32(sprite[0] + 12)),
        sheet: SHEET_OF[flat.i32(sprite[7])] || null
      });
    }
    still.set(name, rects);
  }

  /*
   * Moving pictures.
   *
   * Every frame the client can draw of an animated thing is one record here,
   * tagged with which way it is facing and what it is doing: nought standing,
   * one walking, two attacking. Grouping them by (atlas, index, facing, doing)
   * gives back the animations whole.
   */
  const moving = new Map();
  const frames = flat.vector(fields[1]);
  for (let i = 0; i < frames.length; i++) {
    const record = flat.fields(flat.indirect(frames.at + i * 4));
    if (!record[5]) continue;
    const atlas = flat.string(record[0]);
    const index = record[1] ? flat.i32(record[1]) : 0;
    const facing = record[3] ? flat.i32(record[3]) : 0;
    const doing = record[4] ? flat.i32(record[4]) : 0;
    const sprite = flat.fields(flat.indirect(record[5]));
    if (!sprite[0] || !sprite[7]) continue;
    const key = atlas + '#' + index;
    if (!moving.has(key)) moving.set(key, []);
    moving.get(key).push({
      facing, doing,
      x: Math.round(flat.f32(sprite[0])), y: Math.round(flat.f32(sprite[0] + 4)),
      w: Math.round(flat.f32(sprite[0] + 8)), h: Math.round(flat.f32(sprite[0] + 12)),
      sheet: SHEET_OF[flat.i32(sprite[7])] || null
    });
  }
  return { still, moving };
}

/* ------------------------------------------------------------------ *
 * What the client says a thing is                                     *
 * ------------------------------------------------------------------ */
const tag = (body, name) => {
  const m = new RegExp('<' + name + '>([^<]*)</' + name + '>').exec(body);
  return m ? m[1].trim() : null;
};
const num = value => (value === null || value === '' ? null : Number(value));

function artOf(body) {
  for (const kind of ['AnimatedTexture', 'Texture', 'RandomTexture']) {
    const block = new RegExp('<' + kind + '>([\\s\\S]*?)</' + kind + '>').exec(body);
    if (!block) continue;
    const file = /<File>([^<]+)<\/File>/.exec(block[1]);
    const index = /<Index>([^<]+)<\/Index>/.exec(block[1]);
    if (file && index) {
      return { kind: kind === 'AnimatedTexture' ? 'moving' : 'still',
        atlas: file[1].trim(), index: Number(index[1]) };
    }
  }
  return null;
}

/*
 * The facts about a thing that are worth watching for a change.
 *
 * Everything comparable and nothing that is not: the shape of the XML varies
 * enormously between a bow and a boss, so what is pulled out is a flat set of
 * named numbers and strings that either match the previous build or do not.
 */
function factsOf(body) {
  const out = {};
  const put = (name, value) => { if (value !== null && value !== undefined && value !== '') out[name] = value; };

  put('class', tag(body, 'Class'));
  put('slot', num(tag(body, 'SlotType')));
  put('tier', num(tag(body, 'Tier')));
  put('tier', num(tag(body, 'ItemTier')));
  // A skin says which class it dresses by that class's type number, which
  // is resolved to its name once every object has been read.
  put('for', tag(body, 'PlayerClassType'));
  put('power', num(tag(body, 'PowerLevel')));
  put('feed power', num(tag(body, 'feedPower')));
  put('bag', num(tag(body, 'BagType')));
  put('XP bonus', num(tag(body, 'XPBonus')));
  put('mp cost', num(tag(body, 'MpCost')));
  put('mp per second', num(tag(body, 'MpEndCost')));
  put('cooldown', num(tag(body, 'Cooldown')));
  put('rate of fire', num(tag(body, 'RateOfFire')));
  put('shots', num(tag(body, 'NumProjectiles')));
  put('arc gap', num(tag(body, 'ArcGap')));
  if (/<Soulbound\s*\/>/.test(body)) put('soulbound', true);
  if (/<Consumable\s*\/>/.test(body)) put('consumable', true);

  // A creature's own numbers.
  put('hp', num(tag(body, 'MaxHitPoints')));
  put('defense', num(tag(body, 'Defense')));
  put('xp', num(tag(body, 'Exp')));

  // The first projectile is the one a tooltip shows.
  const shot = /<Projectile[\s\S]*?<\/Projectile>/.exec(body);
  if (shot) {
    const min = num(tag(shot[0], 'MinDamage'));
    const max = num(tag(shot[0], 'MaxDamage'));
    if (min !== null || max !== null) put('damage', (min ?? max) + '-' + (max ?? min));
    const speed = num(tag(shot[0], 'Speed'));
    const life = num(tag(shot[0], 'LifetimeMS'));
    if (speed !== null && life !== null) put('range', Math.round(speed * life / 1000) / 10);
    if (/<MultiHit\s*\/>/.test(shot[0])) put('pierces', true);
    if (/<PassesCover\s*\/>/.test(shot[0])) put('passes cover', true);
  }
  const shots = body.match(/<Subattack\b/g);
  if (shots && shots.length > 1) put('subattacks', shots.length);

  // What it does to you while worn.
  for (const m of body.matchAll(/<ActivateOnEquip[^>]*amount="([^"]*)"[^>]*stat="([^"]*)"[^>]*>/g)) {
    put('on equip ' + m[2], Number(m[1]));
  }
  for (const m of body.matchAll(/<ActivateOnEquip[^>]*stat="([^"]*)"[^>]*amount="([^"]*)"[^>]*>/g)) {
    put('on equip ' + m[1], Number(m[2]));
  }
  return out;
}

function readObjects(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  for (const file of fs.readdirSync(dir).filter(n => /^Objects\.\d+\.xml$/.test(n)).sort()) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(shape)) {
      const id = /id="([^"]*)"/.exec(m[1]);
      const type = /type="([^"]*)"/.exec(m[1]);
      if (!id) continue;
      out.set(id[1], {
        id: id[1],
        type: type ? type[1] : null,
        art: artOf(m[2]),
        description: tag(m[2], 'Description'),
        labels: (tag(m[2], 'Labels') || '').split(',').filter(Boolean),
        facts: factsOf(m[2]),
        from: file
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Cutting the pictures                                                *
 * ------------------------------------------------------------------ */
function cutter() {
  const sheets = new Map();
  const sheetFor = name => {
    if (!sheets.has(name)) {
      const file = path.join(TEXTURES, name + '.png');
      sheets.set(name, fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null);
    }
    return sheets.get(name);
  };
  // A row of frames, left to right, at their own size.
  return (rects, file) => {
    const usable = rects.filter(r => {
      const sheet = r.sheet && sheetFor(r.sheet);
      return sheet && r.w && r.h && r.x + r.w <= sheet.width && r.y + r.h <= sheet.height;
    });
    if (!usable.length) return null;
    const w = Math.max(...usable.map(r => r.w));
    const h = Math.max(...usable.map(r => r.h));
    const strip = Buffer.alloc(w * usable.length * h * 4);
    const stride = w * usable.length;
    usable.forEach((r, slot) => {
      const sheet = sheetFor(r.sheet);
      const ox = slot * w + ((w - r.w) >> 1);
      const oy = h - r.h;
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const from = ((r.y + y) * sheet.width + r.x + x) * 4;
          sheet.pixels.copy(strip, ((y + oy) * stride + ox + x) * 4, from, from + 4);
        }
      }
    });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, file), writePng(stride, h, strip));
    return { file, tile: w, height: h, frames: usable.length };
  };
}

/* ------------------------------------------------------------------ *
 * Which drawer a thing belongs in                                     *
 * ------------------------------------------------------------------ */
const WEAPON = /^(BOW|STAFF|WAND|SWORD|DAGGER|KATANA|TACHI)$/;
const ABILITY = /^(SPELL|TOME|CLOAK|QUIVER|HELM|SHIELD|SEAL|POISON|SKULL|TRAP|ORB|PRISM|SCEPTER|STAR|WAKIZASHI|LUTE|MASK|SIGIL|MACE)$/;
/*
 * The machinery behind the game, which is not news.
 *
 * Most of what an update adds is not something anyone sees as a thing: the
 * projectile a new bow fires, the wall a new dungeon is built from, the
 * invisible object a spell drops on the floor. They are counted, because the
 * size of an update is worth knowing, but no picture is cut for them and they
 * are not put in front of you.
 */
/*
 * What is put in front of you.
 *
 * An update moves a great many objects and most of them are not news. What
 * is kept is what a player holds, wears, becomes or walks into; creatures,
 * consumables and machinery are counted in the summary and go no further,
 * because a page of two hundred and thirty-five monsters is a page nobody
 * reads.
 */
const SHOWN = ['weapons', 'abilities', 'armour', 'rings', 'skins', 'pets', 'equipment', 'places'];

const BACKSTAGE = /^(Projectile|Wall|Summon|PlayerSpawnedObject|PetBehavior|ConnectedWall|CaveWall|Container|Merchant|GuildHallPortal|Sign|Stalagmite|Character Changer|Name Changer|Vault Chest|Reskin)$/;

function drawerOf(thing) {
  const labels = new Set(thing.labels);
  const kind = thing.facts['class'] || '';
  const id = thing.id;

  if (kind === 'Skin' || labels.has('SKIN')) return 'skins';
  if (kind === 'PetSkin' || /Pet (Skin|Stone)$/.test(id)) return 'pets';
  if (kind === 'Equipment' || kind === 'Dye') {
    // The item that unlocks a skin is filed with the skin it unlocks, not
    // among the equipment, because that is what anyone looking for it means.
    if (/Skin$/.test(id)) return 'skins';
    // A "Proc" is the invisible thing an item fires, not an item.
    if (/Proc/.test(id)) return 'backstage';
    for (const label of thing.labels) {
      if (WEAPON.test(label)) return 'weapons';
      if (ABILITY.test(label)) return 'abilities';
    }
    if (labels.has('ARMOR')) return 'armour';
    if (labels.has('RING')) return 'rings';
    if (labels.has('CONSUMABLE') || thing.facts['consumable']) return 'consumables';
    return 'equipment';
  }
  if (kind === 'Portal') return 'places';
  if (kind === 'Pet') return 'pets';
  if (BACKSTAGE.test(kind)) return 'backstage';
  if (kind === 'Character' || labels.has('ENEMY')) return 'creatures';
  return 'backstage';
}

/* ------------------------------------------------------------------ *
 * Do it                                                               *
 * ------------------------------------------------------------------ */
function main() {
  if (!fs.existsSync(BEFORE)) {
    console.error('\n  No "before" to compare against. ' + path.relative(root, BEFORE) + ' is missing.'
      + '\n  It is a copy of client-data taken while the previous client was still installed,'
      + '\n  and there is no making one after the update has overwritten it.\n');
    process.exit(1);
  }
  const before = readObjects(BEFORE);
  const after = readObjects(AFTER);

  /*
   * Type numbers to names, so a skin can say it is for a Knight rather
   * than for 0x031e. The classes are their own document, and a couple of
   * other things point at each other the same way.
   */
  const named = new Map();
  for (const dir of [AFTER, BEFORE]) {
    for (const file of ['Players.xml']) {
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) continue;
      for (const m of fs.readFileSync(full, 'utf8').matchAll(/<Object\b([^>]*)>/g)) {
        const id = /id="([^"]*)"/.exec(m[1]);
        const type = /type="([^"]*)"/.exec(m[1]);
        if (id && type) named.set(Number(type[1]) & 0xffff, id[1]);
      }
    }
    for (const thing of (dir === AFTER ? after : before).values()) {
      if (thing.type) named.set(Number(thing.type) & 0xffff, thing.id);
    }
  }
  for (const map of [before, after]) {
    for (const thing of map.values()) {
      const at = thing.facts['for'];
      if (at === undefined) continue;
      const name = named.get(Number(at) & 0xffff);
      if (name) thing.facts['for'] = name; else delete thing.facts['for'];
    }
  }
  console.log('\n  before  ' + before.size.toLocaleString('en-US') + ' objects'
    + '\n  after   ' + after.size.toLocaleString('en-US') + ' objects');

  const added = [], gone = [], changed = [];
  for (const [id, thing] of after) {
    const was = before.get(id);
    if (!was) { added.push(thing); continue; }
    const moved = [];
    const keys = new Set([...Object.keys(was.facts), ...Object.keys(thing.facts)]);
    for (const key of keys) {
      const a = was.facts[key], b = thing.facts[key];
      if (String(a ?? '') !== String(b ?? '')) moved.push({ fact: key, was: a ?? null, now: b ?? null });
    }
    if (was.description !== thing.description) {
      moved.push({ fact: 'description', was: was.description, now: thing.description });
    }
    const wasLabels = was.labels.join(','), nowLabels = thing.labels.join(',');
    if (wasLabels !== nowLabels) moved.push({ fact: 'labels', was: wasLabels, now: nowLabels });
    if (moved.length) changed.push({ ...thing, moved });
  }
  for (const [id, thing] of before) if (!after.has(id)) gone.push(thing);

  console.log('  ' + added.length + ' new, ' + changed.length + ' changed, ' + gone.length + ' gone');

  const sprites = loadSprites();
  const cut = cutter();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const slug = id => id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const seen = new Set();
  let drew = 0, animated = 0;

  const withArt = thing => {
    const out = { ...thing };
    delete out.from;
    if (!thing.art) return out;
    let name = slug(thing.id);
    while (seen.has(name)) name += 'x';
    seen.add(name);

    const key = thing.art.atlas + '#' + thing.art.index;
    const moving = sprites.moving.get(key);
    if (moving && moving.length) {
      /*
       * Facing zero is the side-on view, which is the one the game shows you
       * most and the one that reads best standing still. Within an action the
       * frames are kept in the order the client filed them, which is the
       * order it plays them.
       */
      const facings = [...new Set(moving.map(f => f.facing))].sort();
      const facing = facings.includes(0) ? 0 : facings[0];
      const clips = {};
      for (const doing of [0, 1, 2]) {
        const frames = moving.filter(f => f.facing === facing && f.doing === doing);
        if (!frames.length) continue;
        const made = cut(frames, name + '-' + ['stand', 'walk', 'attack'][doing] + '.png');
        if (made) clips[['stand', 'walk', 'attack'][doing]] = made;
      }
      if (Object.keys(clips).length) {
        out.sprite = { moving: true, clips };
        drew++;
        if (clips.walk || clips.attack) animated++;
        return out;
      }
    }
    const rects = sprites.still.get(thing.art.atlas);
    const rect = rects && rects.get(thing.art.index);
    if (rect) {
      const made = cut([rect], name + '.png');
      if (made) { out.sprite = { moving: false, clips: { stand: made } }; drew++; }
    }
    return out;
  };

  const drawers = {};
  const file = (list, why) => {
    for (const thing of list) {
      const drawer = drawerOf(thing);
      if (!drawers[drawer]) drawers[drawer] = { added: [], changed: [], gone: [] };
      if (why === 'gone') { drawers[drawer].gone.push({ id: thing.id, labels: thing.labels }); continue; }
      // Only what is shown is drawn; the rest is a number in the summary.
      drawers[drawer][why].push(SHOWN.includes(drawer)
        ? withArt(thing)
        : { id: thing.id, facts: { class: thing.facts['class'] || null }, labels: [] });
    }
  };
  file(added, 'added');
  file(changed, 'changed');
  file(gone, 'gone');

  // Everything that moved, by drawer, so the summary can say how big the
  // update was even for the parts that are not put on show.
  const tally = {};
  for (const [name, drawer] of Object.entries(drawers)) {
    tally[name] = { added: drawer.added.length, changed: drawer.changed.length, gone: drawer.gone.length };
  }
  for (const name of Object.keys(drawers)) if (!SHOWN.includes(name)) delete drawers[name];

  const buildOf = dir => {
    const snap = path.join(root, 'data', 'client-snapshot.txt');
    const m = fs.existsSync(snap) ? /^build\|(.+)$/m.exec(fs.readFileSync(snap, 'utf8')) : null;
    return m ? m[1] : null;
  };
  /*
   * And why any of it happened, which no client will ever say. The one
   * hand-written part of the page, kept as its own dated file.
   */
  const notes = (() => {
    const dir = path.join(root, 'data', 'Updates');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(n => /\.txt$/.test(n)).sort();
    if (!files.length) return null;
    const out = { parts: [] };
    let part = null;
    const text = fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const cut = line.indexOf('|');
      if (cut < 0) continue;
      const kind = line.slice(0, cut), body = line.slice(cut + 1);
      if (kind === 'part') { part = { title: body, points: [] }; out.parts.push(part); }
      else if (kind === 'blurb') { if (part) part.blurb = body; }
      else if (kind === 'point') { if (part) part.points.push(body); }
      else out[kind] = body;
    }
    return out.parts.length ? out : null;
  })();

  const index = {
    made: new Date().toISOString().slice(0, 10),
    notes,
    before: buildOf(BEFORE),
    counts: { added: added.length, changed: changed.length, gone: gone.length },
    tally,
    drawers
  };
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');

  console.log('  ' + drew + ' pictures cut, ' + animated + ' of them moving');
  for (const [name, drawer] of Object.entries(drawers).sort((a, b) =>
    (b[1].added.length + b[1].changed.length) - (a[1].added.length + a[1].changed.length))) {
    console.log('    ' + name.padEnd(12)
      + String(drawer.added.length).padStart(4) + ' new  '
      + String(drawer.changed.length).padStart(4) + ' changed  '
      + String(drawer.gone.length).padStart(4) + ' gone');
  }
  console.log('\n  -> ' + path.relative(root, OUT) + '\n');
}

main();
