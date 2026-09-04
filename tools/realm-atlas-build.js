#!/usr/bin/env node
/*
 * The atlas, built from what was actually walked.
 *
 * tools/realm-render.js draws the recordings one for one and stops there. This
 * takes the same store and makes an atlas of it: a pyramid of zoom levels so
 * the whole realm can be panned at any scale without holding a million tiles
 * on screen, a biome for every tile worked out from the ground it is made of,
 * and the roads and beacons picked out.
 *
 *     node tools/realm-atlas-build.js
 *
 * It reads local/realm-copy - a copy, never the live store, because that one
 * is still being recorded into - and writes local/atlas.
 *
 *
 * Why a pyramid.
 *
 * At one-to-one the realm is about two thousand tiles square, which is two
 * hundred and fifty million pixels. Nothing can hold that, and at any zoom
 * further out than a few tiles across, most of it would be thrown away by the
 * screen anyway. So the same ground is drawn at five scales, each half the
 * last, and the viewer takes whichever level puts about one image pixel on one
 * screen pixel and loads only the squares the window actually covers. Zooming
 * out drops to a coarser level and a quarter of the images; zooming in climbs
 * back. Every level is complete, so a level change never leaves a hole.
 *
 * The coarse levels are made by halving the level below rather than by drawing
 * the tiles again: a box filter over four pixels is what the eye would have
 * done anyway, and it is thousands of times faster than re-reading the sheets.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const FROM = path.join(root, 'local', 'realm-copy');
/*
 * Where the atlas is written. Local by default; --publish puts it where the
 * site can serve it, which is the same files in a different place.
 */
const OUT = process.argv.includes('--publish')
  ? path.join(root, 'web', 'assets', 'atlas')
  : path.join(root, 'local', 'atlas');

/*
 * Only the page, into an atlas that is already there.
 *
 * Everything else this tool writes wants the client and the recordings,
 * and neither is on every machine the page gets worked on. The page itself
 * wants nothing but the template and an atlas.json to inline - so
 * --page-only reads the atlas already sitting in OUT and puts a fresh page
 * beside it, through the same writePage() a full build ends with. There is
 * no second copy of the inlining and no second guess at what the bench cut
 * takes out, and no data is touched: the pyramid, the things standing on
 * it and the sky are left exactly as they were.
 */
if (process.argv.includes('--page-only')) {
  const already = path.join(OUT, 'atlas.json');
  if (!fs.existsSync(already)) {
    console.error('--page-only wants an atlas already built at '
      + path.relative(root, OUT));
    process.exit(1);
  }
  writePage(JSON.parse(fs.readFileSync(already, 'utf8')));
  console.log('  page written from the template -> '
    + path.relative(root, path.join(OUT, 'index.html')));
  process.exit(0);
}

const PX = 8;                    // pixels a game tile is drawn at, at level 0
const CHUNK = 128;               // tiles across a level-0 chunk
const LEVELS = 5;                // 0 is one-to-one, each one after is half
const KEY = 1e5;

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
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ *
 * What was walked                                                     *
 * ------------------------------------------------------------------ */
function loadStore() {
  const file = path.join(FROM, 'store.bin');
  if (!fs.existsSync(file)) {
    console.error('\n  ' + path.relative(root, file) + ' is missing.'
      + '\n  Copy the live store into ' + path.relative(root, FROM) + ' first;'
      + '\n  this never reads the one being recorded into.\n');
    process.exit(1);
  }
  const b = zlib.gunzipSync(fs.readFileSync(file));
  const tiles = new Map();
  const objects = [];
  let at = 0;
  const tileCount = b.readUInt32LE(at); at += 4;
  const objectCount = b.readUInt32LE(at); at += 4;
  for (let i = 0; i < tileCount; i++) {
    tiles.set(b.readUInt16LE(at + 2) * KEY + b.readUInt16LE(at), b.readUInt16LE(at + 4));
    at += 6;
  }
  for (let i = 0; i < objectCount; i++) {
    objects.push({ type: b.readUInt16LE(at), x: b.readFloatLE(at + 2), y: b.readFloatLE(at + 6) });
    at += 10;
  }
  return { tiles, objects };
}

function nameById(prefix) {
  const out = new Map();
  for (const file of fs.readdirSync(XML).filter(n => new RegExp('^' + prefix + '\\.').test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8')
      .matchAll(/<(?:Ground|Object)\b([^>]*)>/g)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      const id = /id="([^"]+)"/.exec(m[1]);
      if (type && id) out.set(Number(type[1]) & 0xffff, id[1]);
    }
  }
  return out;
}

/*
 * The objects that are alive.
 *
 * A creature is an object the client gives hit points to. That is a better
 * test than any name or label: it takes the bosses and the minions and leaves
 * out the walls, the loot bags and the decorations, all of which the recording
 * saw just as often.
 */
function readEnemies() {
  const out = new Set();
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      if (!/<Enemy\s*\/>/.test(m[2])) continue;
      // Hit points alone do not make a monster: the client gives them to the
      // walls and barriers you are meant to break through as well.
      const id = /id="([^"]*)"/.exec(m[1]);
      if (id && /wall|barrier|blocker|obstacle|totem/i.test(id[1])) continue;
      const type = /type="([^"]+)"/.exec(m[1]);
      if (type) out.add(Number(type[1]) & 0xffff);
    }
  }
  return out;
}

/*
 * A class, everything it is made of, and everything it carries.
 *
 * The client is unusually forthcoming here and none of this has to be guessed
 * at. A class declares eight statistics, each with the value it starts life
 * with and the value it can never pass - a Wizard begins on a hundred hit
 * points and stops at seven hundred - and then declares, one line per
 * statistic, how much of it a level is worth. That is enough to build any
 * character at any level without inventing a curve: level twenty of anything
 * is its base plus nineteen levels of its own increments.
 *
 * The Equipment line is a list of object types by slot - weapon, ability,
 * armour, ring, and then whatever is in the pack - and each of those objects
 * says what it does. A weapon and an ability each carry a Projectile, which
 * is the attack: how much it hurts, how fast it flies, how long it lives,
 * how many go at once and how wide they fan. An ability also says what it
 * costs in magic. Armour and rings say which statistic they raise and by how
 * much, so a Robe of the Neophyte is two points of defence and not a guess.
 */
function readKit() {
  const byType = new Map();
  const shape = /<Object\s+type="([^"]+)"\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/Object>/g;
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      const ty = Number.parseInt(m[1], 16);
      if (Number.isFinite(ty)) byType.set(ty, { id: m[2], body: m[3] });
    }
  }

  const num = (body, tag, attr) => {
    const m = attr
      ? new RegExp('<' + tag + '[^>]*' + attr + '="([^"]+)"').exec(body)
      // Allowing for attributes, because every statistic carries its ceiling
      // on the tag itself: <MaxHitPoints max="700">100</MaxHitPoints>.
      : new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>').exec(body);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
  };

  /*
   * The shot an item throws. Speed is given in tenths of a tile a second and
   * life in milliseconds, so the range is the two multiplied - which is how
   * a Short Sword comes out at three and a half tiles and an Energy Staff at
   * eight and a half, and why a warrior has to walk in and a wizard does not.
   */
  const shotOf = body => {
    const p = /<Projectile\b[^>]*>([\s\S]*?)<\/Projectile>/.exec(body);
    if (!p) return undefined;
    const low = num(p[1], 'MinDamage'), high = num(p[1], 'MaxDamage');
    const flat = num(p[1], 'Damage');
    const fast = num(p[1], 'Speed'), lives = num(p[1], 'LifetimeMS');
    if (low === undefined && high === undefined && flat === undefined) return undefined;
    return {
      low: low === undefined ? (high === undefined ? flat : high) : low,
      high: high === undefined ? (low === undefined ? flat : low) : high,
      fast: fast === undefined ? undefined : fast / 10,
      reach: fast !== undefined && lives !== undefined
        ? Math.round(fast * lives / 1000) / 10 : undefined,
      many: num(body, 'NumProjectiles') || 1,
      // How wide the fan is, in degrees, when more than one goes at once.
      fan: num(body, 'ArcGap'),
      rate: num(body, 'RateOfFire') || 1,
      // A shot that carries through what it hits rather than stopping in it.
      through: /<MultiHit\s*\/>/.test(body),
      pierce: /<ArmorPiercing\s*\/>/.test(body)
    };
  };

  /* What a piece of gear is worth just for being worn. */
  const wornOf = body => {
    const out = {};
    for (const m of body.matchAll(
      /<ActivateOnEquip\s+stat="([^"]+)"\s+amount="([^"]+)"[^>]*>IncrementStat</g)) {
      const n = Number(m[2]);
      if (Number.isFinite(n)) out[m[1]] = (out[m[1]] || 0) + n;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const itemOf = type => {
    const one = byType.get(type);
    if (!one) return undefined;
    return {
      name: one.id,
      tier: num(one.body, 'Tier'),
      slot: num(one.body, 'SlotType'),
      // Which colour of bag this falls in, straight from the client.
      bag: num(one.body, 'BagType'),
      mp: num(one.body, 'MpCost'),
      worn: wornOf(one.body),
      shot: shotOf(one.body)
    };
  };

  const out = new Map();
  for (const [, one] of byType) {
    if (!/<Player\s*\/>/.test(one.body)) continue;
    const gear = /<Equipment>([^<]*)<\/Equipment>/.exec(one.body);
    const kit = gear ? gear[1].split(',').map(x => Number.parseInt(x.trim(), 16)) : [];

    /* What a level is worth, one statistic at a time, in the client's words. */
    const grow = {};
    const named = {
      MaxHitPoints: 'hp', MaxMagicPoints: 'mp', Attack: 'att', Defense: 'def',
      Speed: 'pace', Dexterity: 'dex', HpRegen: 'vit', MpRegen: 'wis'
    };
    for (const m of one.body.matchAll(
      /<LevelIncrease\s+min="(-?\d+)"\s+max="(-?\d+)"\s*>(\w+)<\/LevelIncrease>/g)) {
      const key = named[m[3]];
      if (key) grow[key] = (Number(m[1]) + Number(m[2])) / 2;
    }

    const stat = (tag, what) => num(one.body, tag, what);
    out.set(one.id, {
      // Where it starts, and the ceiling it may never pass.
      hp: stat('MaxHitPoints'), hpTop: stat('MaxHitPoints', 'max'),
      mp: stat('MaxMagicPoints'), mpTop: stat('MaxMagicPoints', 'max'),
      att: stat('Attack'), attTop: stat('Attack', 'max'),
      def: stat('Defense'), defTop: stat('Defense', 'max'),
      pace: stat('Speed'), paceTop: stat('Speed', 'max'),
      dex: stat('Dexterity'), dexTop: stat('Dexterity', 'max'),
      vit: stat('HpRegen'), vitTop: stat('HpRegen', 'max'),
      wis: stat('MpRegen'), wisTop: stat('MpRegen', 'max'),
      grow,
      weapon: itemOf(kit[0]),
      ability: itemOf(kit[1]),
      armour: itemOf(kit[2]),
      ring: itemOf(kit[3]),
      pack: kit.slice(4).map(itemOf).filter(Boolean).slice(0, 2)
    });
  }
  return out;
}

function readSpawnRules() {
  const out = new Map();
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  const num = (body, tag) => {
    const m = new RegExp('<' + tag + '>([^<]*)<' + '\/' + tag + '>').exec(body);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
  };
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      if (!type) continue;
      const most = num(m[2], 'PerRealmMax');
      const odds = num(m[2], 'SpawnProb');
      const bunch = /<Spawn>([\s\S]*?)<\/Spawn>/.exec(m[2]);
      const few = bunch ? num(bunch[1], 'Min') : undefined;
      const many = bunch ? num(bunch[1], 'Max') : undefined;
      if (most === undefined && odds === undefined && few === undefined) continue;
      out.set(Number(type[1]) & 0xffff, { most, odds, few, many });
    }
  }
  return out;
}

function readTerrain() {
  const out = new Map();
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      const said = /<Terrain>([^<]+)<\/Terrain>/.exec(m[2]);
      if (!said) continue;
      const type = /type="([^"]+)"/.exec(m[1]);
      if (!type) continue;
      const on = said[1].split(',').map(one => one.trim()).filter(Boolean);
      if (on.length) out.set(Number(type[1]) & 0xffff, new Set(on));
    }
  }
  return out;
}

/*
 * How a creature fights, out of the client.
 *
 * Not its plans - those live on a server nobody here can see - but everything
 * about it that is fixed: how hard it is, what it shoots, how far the shot
 * carries, what it will not be stopped by, and which family the client files
 * it under. That is enough to say why one thing in a place is worse than
 * another, which is the question a map gets asked.
 *
 * A shot's reach is its speed times how long it lives. The client keeps speed
 * in tenths of a tile a second and life in milliseconds, so the two multiply
 * out to ten thousand tile-milliseconds per tile.
 */
function readFight() {
  const out = new Map();
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  const one = (body, tag) => {
    const m = new RegExp('<' + tag + '>([^<]*)<' + '\/' + tag + '>').exec(body);
    return m ? m[1].trim() : '';
  };
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      if (!/<Enemy\s*\/>/.test(m[2])) continue;
      const type = /type="([^"]+)"/.exec(m[1]);
      if (!type) continue;
      const shots = [];
      for (const shot of m[2].matchAll(/<Projectile\b[^>]*>([\s\S]*?)<\/Projectile>/g)) {
        const hurt = Number(one(shot[1], 'Damage'));
        const fast = Number(one(shot[1], 'Speed'));
        const lives = Number(one(shot[1], 'LifetimeMS'));
        if (!Number.isFinite(hurt) || !hurt) continue;
        shots.push({
          hurt,
          // Tiles a second, which is what the page needs to fly one.
          fast: Number.isFinite(fast) ? fast / 10 : undefined,
          reach: Number.isFinite(fast) && Number.isFinite(lives)
            ? Math.round(fast * lives / 10000 * 10) / 10 : undefined,
          pierce: /<ArmorPiercing\s*\/>/.test(shot[1]) || undefined,
          many: /<MultiHit\s*\/>/.test(shot[1]) || undefined
        });
      }
      const held = [];
      for (const [tag, say] of [['StasisImmune', 'stasis'], ['PetrifyImmune', 'petrify'],
        ['ParalyzeImmune', 'paralyse'], ['DazedImmune', 'daze'], ['SlowedImmune', 'slow'],
        ['StunImmune', 'stun'], ['CurseImmune', 'curse']]) {
        if (new RegExp('<' + tag + '\\s*/>').test(m[2])) held.push(say);
      }
      out.set(Number(type[1]) & 0xffff, {
        group: one(m[2], 'Group') || undefined,
        labels: one(m[2], 'Labels') || undefined,
        size: Number(one(m[2], 'Size')) || undefined,
        hp: Number(one(m[2], 'MaxHitPoints')) || undefined,
        def: Number(one(m[2], 'Defense')) || undefined,
        exp: Number(one(m[2], 'Exp')) || undefined,
        shots: shots.length ? shots.slice(0, 4) : undefined,
        immune: held.length ? held : undefined
      });
    }
  }
  return out;
}

function readUnfightable() {
  const out = new Set();
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      if (!/<Enemy\s*\/>/.test(m[2])) continue;
      if (!/<Invincible\s*\/>/.test(m[2])) continue;
      if (/<MaxHitPoints>/.test(m[2])) continue;
      const type = /type="([^"]+)"/.exec(m[1]);
      if (type) out.add(Number(type[1]) & 0xffff);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The sprite registry, and the frames of everything that moves        *
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
const SHEET_OF = { 1: 'groundTiles', 2: 'characters', 4: 'mapObjects' };

/*
 * Every frame the client can draw of an animated thing is one record, tagged
 * with which way it faces and what it is doing: nought standing, one walking,
 * two attacking. Grouped by those, the animations come back whole.
 */
function loadFrames() {
  const file = path.join(XML, 'spritesheet.bin');
  if (!fs.existsSync(file)) return null;
  const flat = new Flat(fs.readFileSync(file));
  const fields = flat.fields(flat.root());
  const moving = new Map();
  const list = flat.vector(fields[1]);
  for (let i = 0; i < list.length; i++) {
    const record = flat.fields(flat.indirect(list.at + i * 4));
    if (!record[5]) continue;
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
    for (let n = 0; n < sprites.length; n++) {
      const sprite = flat.fields(flat.indirect(sprites.at + n * 4));
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

// Where each ground type keeps its picture, by type.
function readGroundArt() {
  const out = new Map();
  const shape = /<Ground\b([^>]*)>([\s\S]*?)<\/Ground>/g;
  for (const file of fs.readdirSync(XML).filter(n => /^GroundTypes\./.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      if (!type) continue;
      const key = Number(type[1]) & 0xffff;
      if (out.has(key)) continue;
      const art = /<Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
      // And the size the client draws it at: a spider declares fifty and is
      // half its sprite, a god declares a hundred and fifty. Drawing them all
      // at a hundred flattens the difference between a rat and a boss.
      const size = /<Size>([^<]+)<\/Size>/.exec(m[2]);
      if (art) {
        out.set(key, { atlas: art[1].trim(), index: Number(art[2]),
          size: size ? Math.max(10, Math.min(400, Number(size[1]))) : 100 });
      }
    }
  }
  return out;
}

// Where each object keeps its picture, by type.
function readArt() {
  const out = new Map();
  const shape = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8').matchAll(shape)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      if (!type) continue;
      const key = Number(type[1]) & 0xffff;
      if (out.has(key)) continue;
      const art = /<(?:Animated)?Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(m[2]);
      if (art) out.set(key, { atlas: art[1].trim(), index: Number(art[2]) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Which biome a tile is in                                            *
 * ------------------------------------------------------------------ */
/*
 * The biomes as the client names them. A ground type usually carries its
 * biome in its own name - "Sprite Forest Grass" - and those are the seeds.
 * The generic floors carry nothing: "Shoreline Sand", "Dark Grass", "New Low
 * Forest Grass" belong to no one by name, and they are the majority of the
 * ground. So the named tiles are grown outwards over the nameless ones until
 * the whole landmass has an owner, which is what a biome map is.
 */
const BIOMES = [
  'Deep Sea Abyss', 'Carboniferous', 'Floral Escape', 'Haunted Hallows',
  'Runic Tundra', 'Sanguine Forest', 'Coral Reef', 'Dead Church',
  'Shipwreck Cove', 'Ancient City', 'High Plains', 'Risen Hell',
  'Desert', 'Mid Forest', 'Undead Forest', 'Mid Plains', 'Beach',
  'High Forest', 'Sprite Forest', 'Nature Ruins', 'Low Forest'
];
/*
 * Which ground each place is, in the client's own word for it.
 *
 * Keyed on the name the map shows, because that is the name a person has
 * looked at and agreed with, and because two places can share a patch of
 * colour and still be different ground - the deserts do exactly that.
 *
 * It is a table and not a measurement on purpose. It used to be worked out by
 * asking the creatures standing on each patch what ground they declared and
 * taking the majority, which is a fine way to identify ground and the wrong
 * way to decide who lives on it: it makes where a thing happened to be
 * standing when somebody walked past into evidence about where it belongs.
 * Nothing downstream of here looks at a sighting again.
 */
const TERRAIN_OF = {
  'Deep Sea Abyss': 'DeepSea',
  Carboniferous: 'Carboniferous',
  'Floral Escape': 'FloralEscape',
  'Haunted Hallows': 'HauntedHallows',
  'Runic Tundra': 'RunicTundra',
  'Sanguine Forest': 'SanguineForest',
  'Ancient City': 'Abandoned',
  'Coral Reef': 'CoralReefs',
  'Dead Church': 'DeadChurch',
  'Shipwreck Cove': 'ShipWreck',
  'Sprite Forest': 'SpriteForest',
  'Withered Plains': 'HighPlains',
  'High Plains': 'HighPlains',
  'Lime Plains': 'MidPlains',
  'Mid Plains': 'MidPlains',
  'Risen Hell': 'RisenHell',
  'Undead Forest': 'UndeadForest',
  'Nature Ruins': 'Nature',
  'Mid Forest': 'MidForest',
  'Low Forest': 'LowForest',
  Beach: 'Beach',
  'Mid Desert': 'MidDesert',
  'High Desert': 'HighDesert',
  'Dark Forest': 'HighForest',
  'High Forest': 'HighForest'
};

const flat = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/*
 * Where one place stops and the next begins.
 *
 * The names of the ground types are not enough. Twelve biomes have a ground
 * type carrying their name and seven do not: the beach's floor is "Shoreline
 * Sand", the plains' is "New Low Forest Grass", and by name they belong to
 * nobody. Growing the named ones outwards over the nameless gave every stretch
 * of coast to whichever named biome happened to be nearest, which is how a
 * cove came to own two hundred and seventy thousand tiles of shoreline on the
 * far side of the realm.
 *
 * So the ground is grouped by what it looks like instead. Every ground type is
 * reduced to the average colour of its tile, those colours are clustered, and
 * a place is a run of touching tiles whose colours fall in the same cluster.
 * That is the same judgement a player makes at a glance - sand is sand, and the
 * line where sand becomes forest is where it stops being the colour of sand -
 * and it puts the boundary where the eye puts it rather than where the nearest
 * named tile happens to be.
 */
/*
 * Where one place stops and the next begins.
 *
 * Three things have to hold at once, and the first two attempts each got one
 * of them and broke another.
 *
 * A place is one thing. Cutting by name gave whole coastlines to whichever
 * named biome happened to be nearest. Cutting by colour alone did the reverse:
 * it merged the Floral Escape into the low forest because both are green, and
 * split the Ancient City into a lawn and a scattering of buildings because its
 * own ground is several colours.
 *
 * So the cutting starts as fine as it can be - a region is a run of touching
 * tiles of exactly one ground type, which is the client's own distinction and
 * cannot be wrong - and regions are then merged under rules that each say
 * something true:
 *
 *   a region wholly inside another is part of it, always. A courtyard is part
 *   of the city, and this is what puts the city back together;
 *
 *   two regions whose ground names the same biome are the same place;
 *
 *   two regions of nearly the same colour are the same place, unless their
 *   ground names two different biomes - which is what keeps the Floral Escape
 *   out of the forest;
 *
 *   and anything too small to be a place joins whichever neighbour it shares
 *   the longest border with.
 *
 * The rules are applied over and over until nothing moves.
 */
/*
 * The grounds nothing can walk on.
 *
 * The realm is fenced by its own floor: the Deep Sea is ringed by ninety-nine
 * thousand tiles of Craggle that no creature and no player can cross, and the
 * client says so plainly with a NoWalk. Without reading it, the wildlife
 * wanders out over the mountains that are supposed to hold it in.
 */
function readNoWalk() {
  const out = new Set();
  for (const file of fs.readdirSync(XML).filter(n => /^GroundTypes\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8')
      .matchAll(/<Ground\b([^>]*)>([\s\S]*?)<\/Ground>/g)) {
      const type = /type="([^"]+)"/.exec(m[1]);
      if (!type || !/<NoWalk\s*\/?>/.test(m[2])) continue;
      out.add(Number(type[1]) & 0xffff);
    }
  }
  return out;
}

/*
 * Cutting a patch along what stands in it.
 *
 * Two places can be laid with the same ground. The Dead Church and the
 * Withered Plains beside it are both floored with Dead Church grass, so no
 * amount of reading the floor will tell them apart and the segmentation had
 * no choice but to hand back one patch of a hundred thousand tiles.
 *
 * What does tell them apart is what lives in them. Every creature in the
 * client says which terrain it belongs to, and inside that one patch the two
 * kinds are not mixed: sixteen hundred of one stand about a point in the
 * south-west and seven hundred of the other about a point two hundred tiles
 * away to the north-east. So the patch is cut where the wildlife changes.
 *
 * The rule is deliberately shy. It asks for two terrains each holding a
 * quarter of the vote, standing well apart, with enough of them to mean
 * something - and if any of that fails the patch is left exactly as it was.
 * A wrong cut is worse than a merge, because a merge is visible and a wrong
 * cut looks like an answer.
 */
const CLEAVE_SHARE = 0.25;               // each side must hold this much of the vote
const CLEAVE_VOICES = 60;                // and this many creatures must have spoken
const CLEAVE_APART = 0.18;               // their middles this far apart, of the diagonal
const CLEAVE_KEEP = 4000;                // a piece smaller than this is not a place
const CLEAVE_CELL = 6;                   // tiles to a cell of the voting grid

/*
 * Two patches that are one place.
 *
 * A place is found by growing a run of touching tiles of one colour, so a
 * stretch of the same ground with a road or a river through it comes out as
 * two. Most of the time that is right - the realm really does have three
 * Floral Escapes - and sometimes it is not, and only a person looking at the
 * map can say which. So it is said in data/Realm/zone-names.txt:
 *
 *     join 852,1610 into 820,1637
 *
 * The patch holding the first tile is folded into the one holding the second.
 * It happens before anything is named, so the surviving patch takes the name,
 * and its middle and its box are worked out again from everything it now has.
 */
function joinZones(map) {
  const file = path.join(root, 'data', 'Realm', 'zone-names.txt');
  if (!fs.existsSync(file)) return;
  const W = map.width;
  const idAt = (x, y) => {
    const gx = x - map.minX, gy = y - map.minY;
    if (gx < 0 || gy < 0 || gx >= W || gy >= map.height) return 0;
    return map.zoneByte[gy * W + gx];
  };
  let folded = 0;
  for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    line = line.replace(/\s*##.*$/, '').trim();
    const m = /^join\s+(-?\d+),(-?\d+)\s+into\s+(-?\d+),(-?\d+)$/.exec(line);
    if (!m) continue;
    const gone = idAt(Number(m[1]), Number(m[2]));
    const host = idAt(Number(m[3]), Number(m[4]));
    if (!gone || !host || gone === host) {
      console.log('  join ' + m[1] + ',' + m[2] + ' into ' + m[3] + ',' + m[4]
        + ' does nothing: ' + (!gone || !host ? 'one of the tiles is in no patch'
          : 'both tiles are already the same patch'));
      continue;
    }
    for (let at = 0; at < map.zoneByte.length; at++) {
      if (map.zoneByte[at] === gone) map.zoneByte[at] = host;
    }
    map.zones = map.zones.filter(one => one.id !== gone);
    folded++;
  }
  if (!folded) return;

  // What each surviving patch now holds.
  const left = new Map();
  for (let at = 0; at < map.zoneByte.length; at++) {
    const id = map.zoneByte[at];
    if (!id) continue;
    let bag = left.get(id);
    if (!bag) { bag = { n: 0, sx: 0, sy: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }; left.set(id, bag); }
    const tx = (at % W) + map.minX, ty = ((at - at % W) / W) + map.minY;
    bag.n++; bag.sx += tx; bag.sy += ty;
    if (tx < bag.x0) bag.x0 = tx; if (tx > bag.x1) bag.x1 = tx;
    if (ty < bag.y0) bag.y0 = ty; if (ty > bag.y1) bag.y1 = ty;
  }
  for (const zone of map.zones) {
    const bag = left.get(zone.id);
    if (!bag || !bag.n) continue;
    zone.tiles = bag.n;
    zone.at = [Math.round(bag.sx / bag.n), Math.round(bag.sy / bag.n)];
    zone.box = [bag.x0, bag.y0, bag.x1, bag.y1];
  }
  console.log('  ' + folded + ' patch' + (folded === 1 ? '' : 'es')
    + ' folded into the one next to it, by hand');
}

function cleaveByLife(map, store, groundName) {
  const terrain = new Map();
  for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
    for (const m of fs.readFileSync(path.join(XML, file), 'utf8')
      .matchAll(/<Object [^>]*>[\s\S]*?<\/Object>/g)) {
      const t = /type="([^"]+)"/.exec(m[0]);
      if (!t) continue;
      const k = Number(t[1]) & 0xffff;
      if (terrain.has(k)) continue;
      const said = [];
      for (const one of m[0].matchAll(/<Terrain>([^<]*)<\/Terrain>/g)) {
        for (const part of one[1].split(',')) if (part.trim()) said.push(part.trim());
      }
      // Only the ones that name a single terrain vote; a creature at home in
      // seven places cannot tell you which one you are standing in.
      if (said.length === 1) terrain.set(k, said[0]);
    }
  }

  const W = map.width, H = map.height;
  const zoneOf = (x, y) => {
    const gx = Math.floor(x) - map.minX, gy = Math.floor(y) - map.minY;
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return 0;
    return map.zoneByte[gy * W + gx];
  };

  // Who stands where, gathered once for every patch at the same time.
  const standing = new Map();
  for (const one of store.objects) {
    const say = terrain.get(one.type);
    if (!say) continue;
    const id = zoneOf(one.x, one.y);
    if (!id) continue;
    if (!standing.has(id)) standing.set(id, []);
    standing.get(id).push({ say, x: one.x, y: one.y });
  }

  let nextId = Math.max(0, ...map.zones.map(z => z.id));
  const made = [];

  for (const zone of map.zones.slice()) {
    const stood = standing.get(zone.id);
    if (!stood || stood.length < CLEAVE_VOICES) continue;

    const tally = new Map();
    for (const one of stood) {
      let bag = tally.get(one.say);
      if (!bag) { bag = { n: 0, x: 0, y: 0 }; tally.set(one.say, bag); }
      bag.n++; bag.x += one.x; bag.y += one.y;
    }
    const top = [...tally].sort((a, b) => b[1].n - a[1].n).slice(0, 2);
    if (top.length < 2) continue;
    if (top[1][1].n / stood.length < CLEAVE_SHARE) continue;

    const [x0, y0, x1, y1] = zone.box;
    const across = Math.hypot(x1 - x0, y1 - y0);
    const apart = Math.hypot(top[0][1].x / top[0][1].n - top[1][1].x / top[1][1].n,
      top[0][1].y / top[0][1].n - top[1][1].y / top[1][1].n);
    if (apart < across * CLEAVE_APART) continue;

    /*
     * Which floor belongs to which side, and then the floor decides.
     *
     * The creatures say only that there are two places here and roughly
     * where each one is - a line drawn from how far away the nearest animal
     * happens to be stands where nothing on the ground changes, and lands
     * some way off wherever a herd was thin. The floor is exact: the Dead
     * Church is seven parts in ten Dead Church Grass Dark and the plain
     * beside it is almost all Dead Church Grass Light, and the two do not
     * blur into each other.
     *
     * So each side's creatures are asked what they are standing on, that
     * gives every ground type a leaning, and every tile of the patch is then
     * settled by what is laid across the few tiles around it. Reading a
     * neighbourhood rather than the tile itself is what keeps a stray square
     * of the wrong grass from punching a hole through the middle.
     */
    const groundAt = (tx, ty) => store.tiles.get(ty * KEY + tx);
    const under = [new Map(), new Map()];
    const spoke = [0, 0];
    for (const one of stood) {
      const side = one.say === top[0][0] ? 0 : (one.say === top[1][0] ? 1 : -1);
      if (side < 0) continue;
      // What it stands on, and the ring of tiles about its feet.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const g = groundAt(Math.round(one.x) + dx, Math.round(one.y) + dy);
          if (g === undefined) continue;
          under[side].set(g, (under[side].get(g) || 0) + 1);
          spoke[side]++;
        }
      }
    }
    if (!spoke[0] || !spoke[1]) continue;

    /*
     * How much each ground leans, as the log of the odds. A ground seen only
     * on one side leans hard; one seen evenly says nothing and is left at
     * about zero, so it neither helps nor hurts.
     */
    const leaning = new Map();
    for (const g of new Set([...under[0].keys(), ...under[1].keys()])) {
      const a = ((under[0].get(g) || 0) + 1) / (spoke[0] + 2);
      const b = ((under[1].get(g) || 0) + 1) / (spoke[1] + 2);
      leaning.set(g, Math.log(b / a));
    }

    const mine = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (map.zoneByte[y * W + x] !== zone.id) continue;
        mine.push(y * W + x);
      }
    }

    // Read across a few tiles, so the line follows the grass and not a
    // single square of it.
    const ROUND = 5;
    const sideOf = new Int8Array(mine.length);
    mine.forEach((at, i) => {
      const tx = (at % W) + map.minX, ty = ((at - at % W) / W) + map.minY;
      let sum = 0;
      for (let dy = -ROUND; dy <= ROUND; dy++) {
        for (let dx = -ROUND; dx <= ROUND; dx++) {
          if (dx * dx + dy * dy > ROUND * ROUND) continue;
          const g = groundAt(tx + dx, ty + dy);
          if (g === undefined) continue;
          const lean = leaning.get(g);
          if (lean !== undefined) sum += lean;
        }
      }
      sideOf[i] = sum > 0 ? 1 : 0;
    });

    /*
     * And no islands. A place does not have specks of its neighbour dotted
     * about inside it: a few squares of the other grass in the middle of a
     * forest is a feature of the forest, not a piece of the plain next door.
     * Anything too small to be a place at all is handed to whatever surrounds
     * it, on both sides, before the pieces are counted.
     */
    const ISLAND = 500;
    {
      const which = new Map();
      mine.forEach((at, i) => which.set(at, i));
      const walked = new Uint8Array(mine.length);
      for (let i = 0; i < mine.length; i++) {
        if (walked[i]) continue;
        const side = sideOf[i];
        const piece = [i];
        walked[i] = 1;
        const round = new Map();
        for (let k = 0; k < piece.length; k++) {
          const at = mine[piece[k]];
          for (const step of [-1, 1, -W, W]) {
            const j = which.get(at + step);
            if (j === undefined) continue;
            if (sideOf[j] === side) {
              if (!walked[j]) { walked[j] = 1; piece.push(j); }
            } else round.set(sideOf[j], (round.get(sideOf[j]) || 0) + 1);
          }
        }
        if (piece.length >= ISLAND || !round.size) continue;
        const to = [...round].sort((x, y) => y[1] - x[1])[0][0];
        for (const j of piece) sideOf[j] = to;
      }
    }

    // The second side, taken in whole connected pieces so a scattering of
    // cells cannot become a place.
    const where = new Map();
    mine.forEach((at, i) => where.set(at, i));
    const seen = new Uint8Array(mine.length);
    const pieces = [];
    for (let i = 0; i < mine.length; i++) {
      if (seen[i] || sideOf[i] !== 1) continue;
      const piece = [i]; seen[i] = 1;
      for (let k = 0; k < piece.length; k++) {
        const at = mine[piece[k]];
        for (const step of [-1, 1, -W, W]) {
          const j = where.get(at + step);
          if (j === undefined || seen[j] || sideOf[j] !== 1) continue;
          seen[j] = 1; piece.push(j);
        }
      }
      if (piece.length >= CLEAVE_KEEP) pieces.push(piece);
    }
    if (!pieces.length) continue;

    for (const piece of pieces) {
      const id = ++nextId;
      if (id > 250) break;                            // the mask has one byte for it
      let sumX = 0, sumY = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
      const kinds = new Map();
      for (const i of piece) {
        const at = mine[i];
        map.zoneByte[at] = id;
        map.mask[at] = (id - 1) % 250;
        const tx = (at % W) + map.minX, ty = ((at - at % W) / W) + map.minY;
        sumX += tx; sumY += ty;
        if (tx < bx0) bx0 = tx; if (tx > bx1) bx1 = tx;
        if (ty < by0) by0 = ty; if (ty > by1) by1 = ty;
        const type = store.tiles.get(ty * KEY + tx);
        if (type !== undefined) kinds.set(type, (kinds.get(type) || 0) + 1);
      }
      made.push({
        id, biome: (id - 1) % 250, tiles: piece.length,
        at: [Math.round(sumX / piece.length), Math.round(sumY / piece.length)],
        box: [bx0, by0, bx1, by1],
        name: 'Zone ' + id, named: false, from: null,
        roadSplit: [], colour: zone.colour,
        madeOf: [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([type, n]) => ({ ground: groundName.get(type) || ('#' + type), tiles: n })),
        cleftFrom: zone.id
      });
      console.log('  cut ' + piece.length.toLocaleString() + ' tiles out of "' + zone.name
        + '" as patch ' + id + ', where the ' + top[1][0] + ' creatures stand');
      zone.tiles -= piece.length;
    }
  }

  if (!made.length) return;
  map.zones.push(...made);

  // The patches that were cut into have moved; their middles and their boxes
  // are worked out again from what is left of them.
  const left = new Map();
  for (let at = 0; at < map.zoneByte.length; at++) {
    const id = map.zoneByte[at];
    if (!id) continue;
    let bag = left.get(id);
    if (!bag) { bag = { n: 0, sx: 0, sy: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }; left.set(id, bag); }
    const tx = (at % W) + map.minX, ty = ((at - at % W) / W) + map.minY;
    bag.n++; bag.sx += tx; bag.sy += ty;
    if (tx < bag.x0) bag.x0 = tx; if (tx > bag.x1) bag.x1 = tx;
    if (ty < bag.y0) bag.y0 = ty; if (ty > bag.y1) bag.y1 = ty;
  }
  for (const zone of map.zones) {
    const bag = left.get(zone.id);
    if (!bag || !bag.n) continue;
    zone.tiles = bag.n;
    zone.at = [Math.round(bag.sx / bag.n), Math.round(bag.sy / bag.n)];
    zone.box = [bag.x0, bag.y0, bag.x1, bag.y1];
  }
  map.zones.sort((a, b) => b.tiles - a.tiles);
}

function biomeMap(tiles, groundName, colourOf) {
  const noWalkType = readNoWalk();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const key of tiles.keys()) {
    const x = key % KEY, y = (key - x) / KEY;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const width = maxX - minX + 1, height = maxY - minY + 1;

  const wetType = new Set();
  const roadType = new Set();
  for (const [type, name] of groundName) {
    const low = name.toLowerCase();
    if (/ocean water|shoreline water|deep water|\bwater\b/.test(low)) wetType.add(type);
    if (/^road /.test(low)) roadType.add(type);
  }

  /*
   * Which biome a ground type names, if any. The Deep Sea Abyss floors itself
   * with "Deep Sea Light Sand", so the first two words of a biome's name are
   * enough to claim ground that begins with them.
   */
  const keysFor = name => {
    const words = name.split(/\s+/);
    const out = [flat(name)];
    if (words.length > 2) out.push(flat(words.slice(0, 2).join(' ')));
    return out;
  };
  const biomeKeys = BIOMES.map(name => [name, keysFor(name)]);
  const claimOf = new Map();
  for (const [type, name] of groundName) {
    const plain = flat(name);
    for (const [biome, keys] of biomeKeys) {
      if (keys.some(key => plain.includes(key))) { claimOf.set(type, biome); break; }
    }
  }
  /*
   * And the ground the client leaves nameless, named by someone who has
   * walked it. A graveyard is laid with "Blue Grass" and nothing in the
   * client says a graveyard belongs to the Dead Church; that is knowledge
   * from outside, so it is kept outside, in its own file.
   */
  const byHand = path.join(root, 'data', 'Realm', 'zone-names.txt');
  if (fs.existsSync(byHand)) {
    const said = new Map();
    for (const line of fs.readFileSync(byHand, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const cut = line.indexOf('|');
      if (cut < 0) continue;
      said.set(flat(line.slice(0, cut)), line.slice(cut + 1).trim());
    }
    for (const [type, name] of groundName) {
      const place = said.get(flat(name));
      if (place) claimOf.set(type, place);
    }
  }

  const NONE = 255, SEA = 254;
  const ground = new Int32Array(width * height).fill(-1);   // ground type, or -1
  for (const [key, type] of tiles) {
    const x = key % KEY, y = (key - x) / KEY;
    ground[(y - minY) * width + (x - minX)] = type;
  }

  /*
   * Roads first: a road belongs to what it crosses, so it borrows the ground
   * around it rather than cutting a place in two.
   */
  /*
   * A road says where it is.
   *
   * "Road Floral Escape" runs through the Floral Escape and nowhere else, so
   * where a biome's own floor went unrecorded - and Floral Escape's did, ninety
   * tiles of it against six thousand of its roads - the roads still name it.
   * The name is kept before the road is absorbed into the ground it crosses.
   */
  // Marked before the roads eat the ground array, and kept beside them.
  const wallBits = new Uint8Array((width * height + 7) >> 3);
  let wallCount = 0;
  for (let at = 0; at < ground.length; at++) {
    if (ground[at] < 0 || !noWalkType.has(ground[at])) continue;
    wallBits[at >> 3] |= 1 << (at & 7);
    wallCount++;
  }

  const roadBits = new Uint8Array((width * height + 7) >> 3);
  const roadClaim = new Array(width * height).fill(null);
  let roadCount = 0;
  let pending = [];
  for (let at = 0; at < ground.length; at++) {
    if (ground[at] < 0 || !roadType.has(ground[at])) continue;
    roadBits[at >> 3] |= 1 << (at & 7);
    roadCount++;
    roadClaim[at] = claimOf.get(ground[at]) || null;
    ground[at] = -2;                                   // road, waiting
    pending.push(at);
  }
  for (let pass = 0; pass < 16 && pending.length; pass++) {
    const left = [];
    for (const at of pending) {
      const x = at % width, y = (at - x) / width;
      const tally = new Map();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const v = ground[ny * width + nx];
        if (v >= 0 && !wetType.has(v)) tally.set(v, (tally.get(v) || 0) + 1);
      }
      if (!tally.size) { left.push(at); continue; }
      ground[at] = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    }
    pending = left;
  }
  for (const at of pending) ground[at] = -1;

  /* ---- fine regions: one ground type, touching ---- */
  const region = new Int32Array(width * height).fill(-1);
  const parts = [];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < ground.length; start++) {
    if (region[start] >= 0) continue;
    const type = ground[start];
    if (type < 0 || wetType.has(type)) continue;
    const id = parts.length;
    let head = 0, tail = 0;
    queue[tail++] = start; region[start] = id;
    let n = 0, sumX = 0, sumY = 0, x0 = width, y0 = height, x1 = 0, y1 = 0;
    const roads = new Map();
    while (head < tail) {
      const at = queue[head++];
      const x = at % width, y = (at - x) / width;
      n++; sumX += x; sumY += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (roadClaim[at]) {
        const bag = roads;
        bag.set(roadClaim[at], (bag.get(roadClaim[at]) || 0) + 1);
      }
      if (x > 0 && region[at - 1] < 0 && ground[at - 1] === type) { region[at - 1] = id; queue[tail++] = at - 1; }
      if (x + 1 < width && region[at + 1] < 0 && ground[at + 1] === type) { region[at + 1] = id; queue[tail++] = at + 1; }
      if (y > 0 && region[at - width] < 0 && ground[at - width] === type) { region[at - width] = id; queue[tail++] = at - width; }
      if (y + 1 < height && region[at + width] < 0 && ground[at + width] === type) { region[at + width] = id; queue[tail++] = at + width; }
    }
    parts.push({ type, n, sumX, sumY, x0, y0, x1, y1,
      rgb: colourOf(type) || [80, 80, 80], claim: claimOf.get(type) || null, roads });
  }

  /* ---- who touches whom, and along how much ---- */
  const border = new Map();                            // "a,b" -> tiles of shared edge
  const touch = (a, b) => {
    if (a === b || a < 0 || b < 0) return;
    const key = a < b ? a + ',' + b : b + ',' + a;
    border.set(key, (border.get(key) || 0) + 1);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (region[at] < 0) continue;
      if (x + 1 < width) touch(region[at], region[at + 1]);
      if (y + 1 < height) touch(region[at], region[at + width]);
    }
  }
  const neighbours = new Map();
  for (const [key, n] of border) {
    const [a, b] = key.split(',').map(Number);
    if (!neighbours.has(a)) neighbours.set(a, new Map());
    if (!neighbours.has(b)) neighbours.set(b, new Map());
    neighbours.get(a).set(b, n);
    neighbours.get(b).set(a, n);
  }

  /* ---- merging ---- */
  const owner = parts.map((_, i) => i);
  const find = i => { while (owner[i] !== i) { owner[i] = owner[owner[i]]; i = owner[i]; } return i; };
  const live = parts.map(part => ({
    n: part.n, sumX: part.sumX, sumY: part.sumY,
    x0: part.x0, y0: part.y0, x1: part.x1, y1: part.y1,
    // The colour of a place is the average of its ground, weighted by area:
    // one flagstone does not move the colour of a meadow.
    r: part.rgb[0] * part.n, g: part.rgb[1] * part.n, b: part.rgb[2] * part.n,
    claims: new Map(part.claim ? [[part.claim, part.n]] : []),
    roads: new Map(part.roads),
    kinds: new Map([[part.type, part.n]])
  }));
  const joinLists = (a, b) => {
    for (const [k, v] of b) a.set(k, (a.get(k) || 0) + v);
  };
  const join = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return a;
    if (live[a].n < live[b].n) { const t = a; a = b; b = t; }
    const A = live[a], B = live[b];
    A.n += B.n; A.sumX += B.sumX; A.sumY += B.sumY;
    A.r += B.r; A.g += B.g; A.b += B.b;
    A.x0 = Math.min(A.x0, B.x0); A.y0 = Math.min(A.y0, B.y0);
    A.x1 = Math.max(A.x1, B.x1); A.y1 = Math.max(A.y1, B.y1);
    joinLists(A.claims, B.claims);
    joinLists(A.roads, B.roads);
    joinLists(A.kinds, B.kinds);
    const mine = neighbours.get(a) || new Map();
    for (const [other, len] of neighbours.get(b) || []) {
      const root = find(other);
      if (root === a) continue;
      mine.set(root, (mine.get(root) || 0) + len);
      const theirs = neighbours.get(root);
      if (theirs) { theirs.delete(b); theirs.set(a, (theirs.get(a) || 0) + len); }
    }
    mine.delete(b);
    neighbours.set(a, mine);
    neighbours.delete(b);
    owner[b] = a;
    return a;
  };
  const colour = i => {
    const L = live[i];
    return [L.r / L.n, L.g / L.n, L.b / L.n];
  };
  const claimsOf = i => {
    const L = live[i];
    let best = null, most = 0;
    for (const [name, n] of L.claims) if (n > most) { most = n; best = name; }
    // A claim only counts if the ground carrying it is a quarter of the place.
    return most / L.n >= 0.25 ? best : null;
  };
  /*
   * Failing that, the roads. They are a thin thread through a place rather
   * than a share of it, so they are judged against each other: whichever
   * biome's roads dominate, dominates, and a place crossed by two biomes'
   * roads in similar measure is left unnamed rather than guessed at.
   */
  const roadSays = i => {
    const L = live[i];
    if (!L.roads.size) return null;
    const sorted = [...L.roads].sort((a, b) => b[1] - a[1]);
    const whole = sorted.reduce((n, row) => n + row[1], 0);
    /*
     * Strictly, because a road wanders. One that crosses a border carries its
     * own biome's name into the neighbour, and eighty per cent of a few
     * hundred tiles was enough to put "Undead Forest" on a beach. It has to be
     * nearly all of them, and there have to be enough of them to mean
     * anything; short of that the place keeps its number and waits.
     */
    if (whole < 300) return null;
    return sorted[0][1] / whole >= 0.85 ? sorted[0][0] : null;
  };
  const apart = (a, b) => {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + 2 * dg * dg + db * db);
  };

  /*
   * How much a place may swallow.
   *
   * "Wholly inside another" was taken to mean "part of it", full stop, and
   * that is only true of something small. A courtyard is part of the city; a
   * desert that happens to be ringed by forest is a desert. Absorbing without
   * looking at size put a desert and a dark forest inside the Nature Ruins, a
   * beach inside a desert, and a high plain inside a Dead Church.
   *
   * So a place is taken in only if it is modest beside the one taking it - a
   * twentieth of it, or small outright. A graveyard of two thousand tiles is
   * part of the church around it; forty thousand tiles of sand is not.
   */
  /*
   * Being inside something does not make you part of it.
   *
   * A courtyard is part of the city and a clearing is part of the forest, but
   * a stretch of sand ringed by trees is a stretch of sand - and absorbing on
   * enclosure alone put a desert and a beach inside their neighbours. What
   * saves the city is not that its buildings are surrounded; it is that its
   * buildings are called Ancient City. Ground that says what it belongs to is
   * taken in however large it is, and ground that says nothing is taken in
   * only if it is small enough to be a feature rather than a place.
   */
  const CLOSE = 22;          // how near two colours must be to be one place
  const SMALL = 900;         // below this, not a place at all
  const TUCKED = 2500;       // and below this, small enough to be inside one
  for (let round = 0; round < 40; round++) {
    let moved = 0;
    for (let i = 0; i < parts.length; i++) {
      const a = find(i);
      if (a !== i) continue;
      const near = neighbours.get(a);
      if (!near || !near.size) continue;
      const roots = new Map();
      for (const [other, len] of near) {
        const root = find(other);
        if (root === a) continue;
        roots.set(root, (roots.get(root) || 0) + len);
      }
      if (!roots.size) continue;
      const sorted = [...roots].sort((x, y) => y[1] - x[1]);
      const mine = claimsOf(a);

      const biggest = sorted[0][0];

      // Too small to be a place at all: join the longest border.
      if (live[a].n < SMALL) { join(biggest, a); moved++; continue; }

      // Wholly inside one other, and small enough to be a feature of it.
      if (sorted.length === 1 && live[a].n < TUCKED) { join(biggest, a); moved++; continue; }

      for (const [other] of sorted) {
        const theirs = claimsOf(other);
        if (mine && theirs && mine !== theirs) continue;   // two named biomes stay apart
        if (mine && theirs && mine === theirs) { join(other, a); moved++; break; }
        if (apart(colour(a), colour(other)) <= CLOSE) { join(other, a); moved++; break; }
      }
    }
    if (!moved) break;
  }

  /* ---- what came out ---- */
  const roots = [...new Set(parts.map((_, i) => find(i)))]
    .filter(i => live[i].n >= 900)
    .sort((a, b) => live[b].n - live[a].n)
    .slice(0, 254);
  const idOf = new Map();
  roots.forEach((root, i) => idOf.set(root, i + 1));

  const zoneByte = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height).fill(NONE);
  for (let at = 0; at < region.length; at++) {
    if (ground[at] >= 0 && wetType.has(ground[at])) { mask[at] = SEA; continue; }
    if (region[at] < 0) continue;
    const id = idOf.get(find(region[at]));
    if (!id) continue;
    zoneByte[at] = id;
    mask[at] = (id - 1) % 250;
  }

  const zones = roots.map(root => {
    const L = live[root];
    const id = idOf.get(root);
    const byGround = claimsOf(root);
    const byRoad = byGround ? null : roadSays(root);
    const name = byGround || byRoad;
    const kinds = [...L.kinds].sort((a, b) => b[1] - a[1]);
    return {
      id, biome: (id - 1) % 250, tiles: L.n,
      at: [Math.round(L.sumX / L.n) + minX, Math.round(L.sumY / L.n) + minY],
      box: [L.x0 + minX, L.y0 + minY, L.x1 + minX, L.y1 + minY],
      name: name || ('Zone ' + id), named: !!name, from: byGround ? 'ground' : (byRoad ? 'roads' : null),
      roadSplit: [...live[root].roads].sort((x,y)=>y[1]-x[1]).slice(0,3).map(([n,c])=>({biome:n,tiles:c})),
      colour: '#' + colour(root).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''),
      madeOf: kinds.slice(0, 4).map(([type, n]) => ({ ground: groundName.get(type) || ('#' + type), tiles: n }))
    };
  });

  // Where the realm actually is, as opposed to where the odd stray tile is.
  let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
  for (const zone of zones) {
    if (zone.tiles < 4000) continue;
    fx0 = Math.min(fx0, zone.box[0]); fy0 = Math.min(fy0, zone.box[1]);
    fx1 = Math.max(fx1, zone.box[2]); fy1 = Math.max(fy1, zone.box[3]);
  }
  const focus = Number.isFinite(fx0) ? [fx0, fy0, fx1, fy1] : [minX, minY, maxX, maxY];

  const found = zones.map(z => ({ index: z.biome, name: z.name, tiles: z.tiles, at: z.at }));

  return { mask, roadBits, roadCount, wallBits, wallCount, zoneByte, zones, focus,
    width, height, minX, minY, maxX, maxY, found, NONE, SEA, ROAD: 253 };
}

/* ------------------------------------------------------------------ *
 * The pyramid                                                         *
 * ------------------------------------------------------------------ */
/*
 * Each level above is built by halving the one below: four pixels average
 * into one, and four chunks become one. Transparency averages with the rest,
 * so ground that was never recorded stays see-through however far out you go.
 *
 * The outline averages with the rest too, and that is deliberate. Keeping it
 * black through the halving was tried - a square with any black in it staying
 * black - and on anything but sparse scenery it floods: a field of tufts has
 * a line round every blade, and at half size the lines touch and the field
 * becomes a black mass. Averaged, the same field stays a field. The line is
 * kept sharp where it can be read, which is the level the sprites are drawn
 * at, and allowed to become shading where it cannot.
 */
function halve(image) {
  const w = image.width >> 1, h = image.height >> 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const at = ((y * 2 + dy) * image.width + x * 2 + dx) * 4;
          const alpha = image.pixels[at + 3];
          r += image.pixels[at] * alpha; g += image.pixels[at + 1] * alpha;
          b += image.pixels[at + 2] * alpha; a += alpha;
        }
      }
      const to = (y * w + x) * 4;
      if (a) { out[to] = r / a; out[to + 1] = g / a; out[to + 2] = b / a; }
      out[to + 3] = a >> 2;
    }
  }
  return { width: w, height: h, pixels: out };
}

function buildPyramid() {
  const side = CHUNK * PX;
  const levels = [];
  let below = new Map();                           // "c_r" -> {width,height,pixels}

  // Level zero, straight off the recording.
  fs.mkdirSync(path.join(OUT, 'z0'), { recursive: true });
  let count = 0;
  for (const file of fs.readdirSync(FROM).filter(n => /^-?\d+_-?\d+\.png$/.test(n))) {
    const name = file.replace('.png', '');
    /*
     * The closest level is the floor by itself. Everything that stands on it
     * is drawn over the top as sprites in their own right, sorted and lifted,
     * so it has to be left out of the picture underneath. The coarser levels
     * are made from the whole thing, where there is no room to sort anything
     * and a mark in the floor is all a tree can be.
     */
    const bare = path.join(FROM, name + '.ground.png');
    fs.copyFileSync(fs.existsSync(bare) ? bare : path.join(FROM, file),
      path.join(OUT, 'z0', file));
    below.set(name, null);                         // read lazily when halving
    count++;
  }
  levels.push({ z: 0, chunks: [...below.keys()], side, tilesPerChunk: CHUNK });
  console.log('  z0  ' + count + ' chunks at ' + side + 'px, one pixel per ' + (1 / PX).toFixed(3) + ' tile');

  for (let z = 1; z < LEVELS; z++) {
    const dir = path.join(OUT, 'z' + z);
    fs.mkdirSync(dir, { recursive: true });
    /*
     * Four chunks of the level below make one here, so their coordinates are
     * halved - with a floor that works for negatives, since the realm's
     * origin is not at a chunk corner.
     */
    const groups = new Map();
    for (const name of below.keys()) {
      const [c, r] = name.split('_').map(Number);
      const key = Math.floor(c / 2) + '_' + Math.floor(r / 2);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([c, r, name]);
    }
    const made = new Map();
    for (const [key, members] of groups) {
      const [gc, gr] = key.split('_').map(Number);
      const canvas = Buffer.alloc(side * side * 4);
      for (const [c, r, name] of members) {
        const src = below.get(name)
          || readPng(fs.readFileSync(z === 1
            ? path.join(FROM, name + '.png')        // the whole thing, not the bare floor
            : path.join(OUT, 'z' + (z - 1), name + '.png')));
        const small = halve(src);
        const ox = (c - gc * 2) * (side >> 1);
        const oy = (r - gr * 2) * (side >> 1);
        for (let y = 0; y < small.height; y++) {
          small.pixels.copy(canvas,
            ((y + oy) * side + ox) * 4,
            y * small.width * 4, (y + 1) * small.width * 4);
        }
      }
      fs.writeFileSync(path.join(dir, key + '.png'), writePng(side, side, canvas));
      made.set(key, { width: side, height: side, pixels: canvas });
    }
    levels.push({ z, chunks: [...made.keys()], side, tilesPerChunk: CHUNK * (1 << z) });
    console.log('  z' + z + '  ' + made.size + ' chunks at ' + side + 'px, one pixel per '
      + ((1 << z) / PX).toFixed(3) + ' tile');
    below = made;
  }
  return levels;
}

/* ------------------------------------------------------------------ *
 * Do it                                                               *
 * ------------------------------------------------------------------ */
/*
 * The viewer, with the atlas written into it. The template lives beside
 * this tool as its own file so it can be read and edited as HTML rather
 * than as a string inside a string.
 *
 * A function of its own because it is wanted twice: at the end of a full
 * build, and on its own when nothing but the page has changed. It is the
 * whole of what turns the template into the page, so there is one copy.
 */
function writePage(summary) {
let template = fs.readFileSync(path.join(__dirname, 'atlas-viewer.html'), 'utf8');

/*
 * The bench comes out of anything published. It is a thing for trying
 * questions on this machine - it hides itself anywhere else - but hidden is
 * not the same as absent, and a copy that goes out to be read by anyone
 * should not be carrying it at all.
 */
if (OUT !== path.join(root, 'local', 'atlas')) {
  /*
   * Every line ending is spelled \r?\n, because the template's are not
   * the ones it was written with. It was authored with bare newlines and
   * is checked out with carriage returns, and a cut looking for \n} finds
   * nothing in \r\n} - so all three cuts missed, the guard below fired,
   * and publishing stopped dead on a fresh clone.
   */
  const cuts = [
    /<aside id="bench">[\s\S]*?<\/aside>\r?\n/,
    /  \/\* The bench, for trying things[\s\S]*?#bench p \{[^}]*\}\r?\n/,
    /\/\* -+ the bench, wired up -+ \*\/[\s\S]*?\r?\n\}\r?\n\r?\n(?=requestAnimationFrame)/
  ];
  for (const what of cuts) template = template.replace(what, '');
  // What must not go out is the panel itself. The camera still answers to
  // a and e in a published copy, and the code that does looks for the
  // slider and shrugs when it is not there.
  if (/id="bench"/.test(template) || /the bench, wired up/.test(template)) {
    throw new Error('the bench is still in the published page');
  }
}

fs.writeFileSync(path.join(OUT, 'index.html'),
  template.replace('/*ATLAS*/null', JSON.stringify(summary)));
}

function main() {
  const store = loadStore();
  const groundName = nameById('GroundTypes');
  const objectName = nameById('Objects');
  console.log('\n  ' + store.tiles.size.toLocaleString('en-US') + ' tiles, '
    + store.objects.length.toLocaleString('en-US') + ' objects recorded');

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  /*
   * The colour of every kind of ground, which is what the places are cut
   * along. It is the average of the eight-by-eight tile the game draws, taken
   * over the pixels that are actually opaque - a floor with gaps in it is the
   * colour of what is drawn, not of the nothing between.
   */
  const frames = loadFrames();
  const groundArt = readGroundArt();
  const sheets = new Map();
  const sheetFor = name => {
    if (!sheets.has(name)) {
      const file = path.join(XML, 'textures', name + '.png');
      sheets.set(name, fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null);
    }
    return sheets.get(name);
  };
  const colourCache = new Map();
  const colourOf = type => {
    if (colourCache.has(type)) return colourCache.get(type);
    let found = null;
    const art = groundArt.get(type);
    const rects = art && frames && frames.still.get(art.atlas);
    const rect = rects && rects.get(art.index);
    const sheet = rect && rect.sheet && sheetFor(rect.sheet);
    if (rect && sheet && rect.x + rect.w <= sheet.width && rect.y + rect.h <= sheet.height) {
      // The middle eight, which is the tile without the packer's padding.
      const w = Math.min(8, rect.w), h = Math.min(8, rect.h);
      const ox = rect.x + ((rect.w - w) >> 1), oy = rect.y + ((rect.h - h) >> 1);
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const at = ((oy + y) * sheet.width + ox + x) * 4;
          if (sheet.pixels[at + 3] < 40) continue;
          r += sheet.pixels[at]; g += sheet.pixels[at + 1]; b += sheet.pixels[at + 2]; n++;
        }
      }
      if (n) found = [r / n, g / n, b / n];
    }
    colourCache.set(type, found);
    return found;
  };

  const map = biomeMap(store.tiles, groundName, colourOf);
  cleaveByLife(map, store, groundName);
  joinZones(map);
  console.log('  ' + map.width + ' x ' + map.height + ' tiles from ' + map.minX + ',' + map.minY);
  console.log('  ' + map.found.length + ' biomes in ' + map.zones.length + ' separate zones, '
    + map.roadCount.toLocaleString('en-US') + ' road tiles, '
    + map.wallCount.toLocaleString('en-US') + ' that nothing can walk on');
  for (const biome of map.found.sort((a, b) => b.tiles - a.tiles)) {
    console.log('    ' + biome.name.padEnd(18) + String(biome.tiles).padStart(8) + ' tiles  at '
      + biome.at[0] + ',' + biome.at[1]);
  }

  /*
   * The mask goes out as it is - one byte a tile, deflated. Two million bytes
   * of mostly-repeated values comes to a couple of hundred kilobytes, which is
   * cheaper than any cleverer encoding would be to read back.
   */
  /*
   * The mask goes out as a picture rather than as a block of bytes.
   *
   * A browser can read a PNG into a canvas and hand back its pixels in two
   * lines; anything else means fetching a file and unzipping it by hand, which
   * fails outright when the page is opened straight off disk. So one byte a
   * tile becomes one pixel a tile: the biome in the red channel, whether a
   * road crosses it in the green. Nothing draws this - it is data that happens
   * to be shaped like an image.
   */
  {
    const pixels = Buffer.alloc(map.width * map.height * 4);
    for (let at = 0; at < map.mask.length; at++) {
      const to = at * 4;
      pixels[to] = map.mask[at];
      // Green carries two things now: a road in the first bit, ground that
      // cannot be walked on in the second.
      pixels[to + 1] = (((map.roadBits[at >> 3] >> (at & 7)) & 1) ? 1 : 0)
        | (((map.wallBits[at >> 3] >> (at & 7)) & 1) ? 2 : 0);
      pixels[to + 2] = map.zoneByte[at];
      pixels[to + 3] = 255;
    }
    fs.writeFileSync(path.join(OUT, 'mask.png'), writePng(map.width, map.height, pixels));
  }

  /*
   * And the roads as something to look at: a soft pale wash, one pixel a tile,
   * laid over the ground at a low opacity. Drawing fifty thousand tiles one at
   * a time every frame is not affordable and would shout; one stretched image
   * at a fifth opacity is a hint that they are there.
   */
  {
    const pixels = Buffer.alloc(map.width * map.height * 4);
    for (let at = 0; at < map.mask.length; at++) {
      if (!((map.roadBits[at >> 3] >> (at & 7)) & 1)) continue;
      const to = at * 4;
      pixels[to] = 255; pixels[to + 1] = 236; pixels[to + 2] = 196; pixels[to + 3] = 255;
    }
    fs.writeFileSync(path.join(OUT, 'roads.png'), writePng(map.width, map.height, pixels));
  }

  const enemyKinds = readEnemies();

  /*
   * The same list the renderer works from, read before any of the three
   * places that need it rather than in the middle of them.
   *
   * A satellite is a projectile held in orbit round its owner, a trap is a
   * hazard with a hundred thousand hit points, a whirlpool is an attack. The
   * client files every one of them as a Character with <Enemy/>, so nothing
   * about them can be told from their class, and they were all being logged
   * as creatures and given a zone to live in.
   *
   * It used to be read further down, between the two lists that are built
   * from it, which meant only one of them was filtered: the beacons' guards
   * were counted before it existed, the biomes' lists were built before it
   * existed, and a patch nobody was ever met in borrows its biome's list - so
   * the names came back into the zones by the back door immediately after
   * being taken out of them.
   */
  const notCreatures = new Set();
  {
    const file = path.join(root, 'data', 'Realm', 'off-the-map.txt');
    if (fs.existsSync(file)) {
      for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        line = line.replace(/\s*##.*$/, '').trim();
        if (line.startsWith('life ')) notCreatures.add(line.slice(5).trim());
      }
    }
  }
  /*
   * Only the beacons are spared, and they are not spared here: they are found
   * by name in the block below, straight out of the store, before any of this
   * runs. What this governs is who is listed as living somewhere.
   */
  const unfightable = readUnfightable();
  const fightOf = readFight();
  /*
   * Everything the client knows about a creature, folded into its listing so
   * the page has it without a second lookup.
   */
  const withFight = (type, base) => {
    const said = fightOf.get(type);
    if (!said) return base;
    const out = { ...base };
    for (const k of Object.keys(said)) if (said[k] !== undefined) out[k] = said[k];
    return out;
  };
  const isCreature = type => enemyKinds.has(type)
    && !unfightable.has(type)
    && !notCreatures.has(objectName.get(type));
  console.log('  ' + unfightable.size + ' kinds the client marks invincible and gives no hit '
    + 'points, so they are machinery rather than wildlife');

  /*
   * The beacons, and what stands round them.
   *
   * A beacon is inside a place without being of it: it has its own guardian,
   * its own plate and its own fight, and a player looking for one is not
   * looking for the forest it happens to sit in. So each keeps its own record
   * - which zone it is in, what was met within twenty tiles of it - and the
   * atlas lets it be clicked in its own right.
   */
  const beacons = [];
  for (const object of store.objects) {
    const name = objectName.get(object.type) || '';
    if (!/^(Actual Active Beacon|Captured Beacon|Teleport Beacon)/.test(name)) continue;
    if (beacons.some(b => Math.abs(b.x - object.x) < 16 && Math.abs(b.y - object.y) < 16)) continue;
    beacons.push({
      x: Math.round(object.x), y: Math.round(object.y),
      // "Actual Active Beacon Coral Reefs" is the client's bookkeeping; what
      // anyone wants to read is which beacon it is.
      name: name.replace(/^(Actual Active|Captured|Teleport) Beacon\s*/, '').trim() || 'Beacon',
      state: /^Captured/.test(name) ? 'captured' : (/^Teleport/.test(name) ? 'teleport' : 'active')
    });
  }
  for (const beacon of beacons) {
    const bx = beacon.x - map.minX, by = beacon.y - map.minY;
    if (bx >= 0 && by >= 0 && bx < map.width && by < map.height) {
      beacon.zone = map.zoneByte[by * map.width + bx] || 0;
      // Beacons stand on their own plate, which is too small to be a place of
      // its own, so the answer to "where is it" comes from just outside it.
      for (let r = 4; !beacon.zone && r <= 24; r += 4) {
        const tally = new Map();
        for (let dy = -r; dy <= r && !beacon.zone; dy += 2) {
          for (let dx = -r; dx <= r; dx += 2) {
            const nx = bx + dx, ny = by + dy;
            if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
            const id = map.zoneByte[ny * map.width + nx];
            if (id) tally.set(id, (tally.get(id) || 0) + 1);
          }
        }
        if (tally.size) beacon.zone = [...tally].sort((a, b) => b[1] - a[1])[0][0];
      }
    }
    const near = new Map();
    for (const object of store.objects) {
      if (Math.abs(object.x - beacon.x) > 20 || Math.abs(object.y - beacon.y) > 20) continue;
      if (!isCreature(object.type)) continue;
      // A beacon has hit points and stands beside itself; it is not a guard.
      if (/beacon/i.test(objectName.get(object.type) || '')) continue;
      near.set(object.type, (near.get(object.type) || 0) + 1);
    }
    /*
     * Kept until the grounds are known, then sifted the same way the places
     * are: a guard that says it belongs on other ground was standing near the
     * beacon, not guarding it.
     */
    beacon.near = [...near].sort((a, b) => b[1] - a[1]);
  }

  /*
   * Who lives where, counted rather than assumed.
   *
   * The recording holds every creature the client was told about while it was
   * walked past, with its position. Laying those on the biome mask says which
   * monsters were actually seen on which ground - no guessing from a name, no
   * table of what the client says should spawn where. A creature that turns up
   * in three biomes is in all three; one that turns up once is noise and is
   * dropped.
   */
  const census = new Map();
  const perZone = new Map();
  for (const object of store.objects) {
    const name = objectName.get(object.type);
    if (!name) continue;
    const x = Math.round(object.x) - map.minX, y = Math.round(object.y) - map.minY;
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
    const at = y * map.width + x;
    const where = map.mask[at];
    if (where >= 253) continue;
    if (!census.has(where)) census.set(where, new Map());
    census.get(where).set(object.type, (census.get(where).get(object.type) || 0) + 1);
    const zone = map.zoneByte[at];
    if (!zone) continue;
    if (!perZone.has(zone)) perZone.set(zone, new Map());
    perZone.get(zone).set(object.type, (perZone.get(zone).get(object.type) || 0) + 1);
  }
  /*
   * What ground each patch actually is, asked of the creatures standing on it.
   *
   * A recording holds every creature the client mentioned while it was walked
   * past, and that is a wider net than the place: a monster three tiles the
   * other side of a border is in the recording, and so is one that wandered.
   * Counted raw, the Deep Sea kept Carboniferous monsters, the Ancient City
   * kept Risen Hell ones and the Runic Tundra kept Floral Escape ones.
   *
   * The fix is not a table of my own devising. Every creature declares the
   * ground it belongs on, so each patch is asked what the things counted on it
   * declare, weighted by how often each was seen - and the answer is never
   * close: between ninety and ninety-eight per cent of every patch agrees on
   * one ground. That majority is what the patch is; the few per cent that
   * disagree are the strays, and they are the whole of the error.
   */
  const groundOf = readTerrain();
  const spawnOf = readSpawnRules();

  /*
   * Who lives on each ground: everything the client says belongs there, in
   * hit-point order so the worst of it is at the top. Not who was seen there.
   */
  const livesOn = new Map();
  for (const [type, on] of groundOf) {
    if (!isCreature(type)) continue;
    for (const where of on) {
      if (!livesOn.has(where)) livesOn.set(where, []);
      livesOn.get(where).push(type);
    }
  }
  const rosterFor = where => (livesOn.get(where) || [])
    .map(type => {
      const rule = spawnOf.get(type) || {};
      return withFight(type, {
        type,
        name: objectName.get(type),
        most: rule.most,
        odds: rule.odds,
        few: rule.few,
        many: rule.many
      });
    })
    .sort((a, b) => (b.hp || 0) - (a.hp || 0));

  const biomeGround = new Map();
  for (const biome of map.found) biomeGround.set(biome.index, TERRAIN_OF[biome.name] || '');

  /*
   * And nothing is listed as living somewhere it says it does not live. A
   * creature that declares no ground at all is left alone: it was seen there,
   * and there is nothing to contradict it with.
   */
  let livesHere = 0;
  for (const biome of map.found) {
    biome.ground = biomeGround.get(biome.index) || '';
    biome.lives = biome.ground ? rosterFor(biome.ground) : [];
    livesHere += biome.lives.length;
  }

  /*
   * A picture for each of them, moving where the client draws them moving.
   * The side-on facing is the one the game shows most and the one that reads
   * best small, so that is the one taken; the walk cycle is what the atlas
   * plays, and standing still is the fallback for the things that have no
   * walk.
   */
  const artOf = readArt();
  const lifeDir = path.join(OUT, 'life');
  fs.mkdirSync(lifeDir, { recursive: true });
  const drawnAlready = new Map();

  const cutLife = type => {
    if (drawnAlready.has(type)) return drawnAlready.get(type);
    let made = null;
    const art = artOf.get(type);
    if (art && frames) {
      const moving = frames.moving.get(art.atlas + '#' + art.index);
      let rects = null;
      if (moving && moving.length) {
        const facings = [...new Set(moving.map(f => f.facing))].sort();
        const facing = facings.includes(0) ? 0 : facings[0];
        rects = moving.filter(f => f.facing === facing && f.doing === 1);
        if (!rects.length) rects = moving.filter(f => f.facing === facing && f.doing === 0);
        if (!rects.length) rects = [moving[0]];
      } else {
        const bag = frames.still.get(art.atlas);
        const one = bag && bag.get(art.index);
        if (one) rects = [one];
      }
      if (rects && rects.length) {
        const usable = rects.filter(r => {
          const sheet = r.sheet && sheetFor(r.sheet);
          return sheet && r.w && r.h && r.x + r.w <= sheet.width && r.y + r.h <= sheet.height;
        });
        if (usable.length) {
          /*
           * A pixel of room round every frame, for the dark rim the game
           * draws round anything alive. The art does not carry one - across
           * the whole realm a sprite's silhouette is as bright as its middle -
           * so without it a creature reads as a stain on the floor rather
           * than as something standing on it.
           */
          const PAD = 1;
          const w = Math.max(...usable.map(r => r.w)) + PAD * 2;
          const h = Math.max(...usable.map(r => r.h)) + PAD * 2;
          const stride = w * usable.length;
          const strip = Buffer.alloc(stride * h * 4);
          usable.forEach((r, slot) => {
            const sheet = sheetFor(r.sheet);
            const ox = slot * w + ((w - r.w) >> 1);
            const oy = h - PAD - r.h;
            for (let y = 0; y < r.h; y++) {
              for (let x = 0; x < r.w; x++) {
                const from = ((r.y + y) * sheet.width + r.x + x) * 4;
                sheet.pixels.copy(strip, ((y + oy) * stride + ox + x) * 4, from, from + 4);
              }
            }
          });
          // Darkened from what it touches, so a pale creature keeps a grey
          // edge and a red one a maroon edge, the way hand-drawn art does.
          const near = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          const rim = Buffer.from(strip);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < stride; x++) {
              const at = (y * stride + x) * 4;
              if (strip[at + 3] > 8) continue;
              let cr = 0, cg = 0, cb = 0, n = 0;
              for (const [dx, dy] of near) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= stride || ny >= h) continue;
                const f = (ny * stride + nx) * 4;
                if (strip[f + 3] < 9) continue;
                cr += strip[f]; cg += strip[f + 1]; cb += strip[f + 2]; n++;
              }
              if (!n) continue;
              rim[at] = (cr / n) * 0.22; rim[at + 1] = (cg / n) * 0.22;
              rim[at + 2] = (cb / n) * 0.30; rim[at + 3] = 96;
            }
          }
          rim.copy(strip);
          /*
       * Some of what stands in a biome is not meant to be seen: the spawners
       * that put the creatures there, the light beams a beacon throws, the
       * helpers that carry no picture at all. The client draws them from an
       * empty square, and listing them among a zone's wildlife invented two
       * dozen creatures that nobody has ever met.
       */
          let lit = 0;
          for (let i = 3; i < strip.length; i += 4) if (strip[i] > 8) { lit = 1; break; }
          if (lit) {
            const file = 'c' + type + '.png';
            fs.writeFileSync(path.join(lifeDir, file), writePng(stride, h, strip));
            made = { file, tile: w, height: h, frames: usable.length,
              size: (artOf.get(type) || {}).size || 100 };
          }
        }
      }
    }
    drawnAlready.set(type, made);
    return made;
  };

  for (const biome of map.found) {
    for (const one of biome.lives || []) {
      const made = cutLife(one.type);
      if (made) one.sprite = made;
    }
    biome.lives = (biome.lives || []).filter(one => one.sprite);
  }

  /*
   * Each patch keeps its own list of what was met in it. A creature placed
   * from that list belongs to the patch and cannot leave it, which is the
   * difference between a monster in the desert and a monster in *this*
   * desert.
   */
  /*
   * A place whose ground nobody worked out asks its own creatures instead.
   *
   * One place does: the second Dead Church, cleaved out of the first, carries
   * a biome index that has no record of its own, so there was nothing to
   * inherit a ground from. Its cast is not in the least ambiguous - Dead
   * Church Skeleton, Nun, Necromancer, Bat, Vampire, Cleric, Revenant - so it
   * is put to the same vote the patches were, on its own count.
   */
  for (const zone of map.zones) {
    if (biomeGround.has(zone.biome)) continue;
    const bag = perZone.get(zone.id);
    if (!bag) continue;
    const votes = new Map();
    for (const [type, n] of bag) {
      if (!isCreature(type)) continue;
      for (const on of groundOf.get(type) || []) votes.set(on, (votes.get(on) || 0) + n);
    }
    let best = null, most = 0, all = 0;
    for (const [on, n] of votes) { all += n; if (n > most) { most = n; best = on; } }
    if (best && most / all >= 0.5) {
      biomeGround.set(zone.biome, best);
      console.log('  ' + zone.name + ' had no patch to take a ground from; its own '
        + 'creatures say ' + best);
    }
  }

  // The rosters are worked out once the places have their final names, below.
  for (const zone of map.zones) { zone.lives = []; zone.met = true; }

  /*
   * A beacon's guards used to be whatever was counted within twenty tiles of
   * it, which is the same mistake in miniature - a thing near a beacon is
   * near a beacon, not guarding it. The reference names the guardian of each
   * ground and that is carried in from the merge; nothing is guessed here.
   */
  for (const beacon of beacons) delete beacon.near;
  /*
   * A patch with no name of its own asks what lives in it.
   *
   * Every creature in the client declares the terrain it belongs to, and the
   * client's vocabulary is exactly the one the realm is described in -
   * HighForest, MidPlains, MidDesert, Beach, DeepSea. So a patch that the
   * ground could not name is named by the things that were met standing in
   * it, which is the client answering rather than a guess about colour.
   *
   * Only patches that have no name already: a place the ground names is named
   * by the ground, and this is not allowed to argue with it.
   */
  {
    const terrainOf = new Map();
    for (const file of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n))) {
      for (const m of fs.readFileSync(path.join(XML, file), 'utf8')
        .matchAll(/<Object [^>]*>[\s\S]*?<\/Object>/g)) {
        const type = /type="([^"]+)"/.exec(m[0]);
        if (!type) continue;
        const key = Number(type[1]) & 0xffff;
        if (terrainOf.has(key)) continue;
        const said = [];
        for (const one of m[0].matchAll(/<Terrain>([^<]*)<\/Terrain>/g)) {
          for (const part of one[1].split(',')) if (part.trim()) said.push(part.trim());
        }
        if (said.length) terrainOf.set(key, said);
      }
    }
    // HigherForest -> Higher Forest, DeepSea -> Deep Sea.
    const spell = word => word.replace(/([a-z])([A-Z])/g, '$1 $2');
    let named = 0;
    for (const zone of map.zones) {
      if (zone.named || !zone.lives || !zone.lives.length) continue;
      const tally = new Map();
      let voters = 0;
      for (const life of zone.lives) {
        const said = terrainOf.get(life.type);
        if (!said) continue;
        voters++;
        // A creature at home in several terrains speaks a little for each.
        for (const k of said) tally.set(k, (tally.get(k) || 0) + 1 / said.length);
      }
      if (voters < 2) continue;
      const top = [...tally].sort((a, b) => b[1] - a[1])[0];
      if (!top || top[1] / voters < 0.5) continue;
      zone.name = spell(top[0]);
      zone.named = true;
      zone.from = 'creatures';
      named++;
    }
    if (named) console.log('  ' + named + ' places named by what lives in them');
  }

  /*
   * And whatever has been written down by someone who has walked it, which
   * beats every other answer. A line marks a place by a tile inside it, so it
   * survives the map being cut up again - patch numbers do not.
   */
  {
    const byHand = path.join(root, 'data', 'Realm', 'zone-names.txt');
    let fixed = 0;
    if (fs.existsSync(byHand)) {
      for (const line of fs.readFileSync(byHand, 'utf8').split(/\r?\n/)) {
        if (!line || line.startsWith('#') || line[0] !== '@') continue;
        const cut = line.indexOf('|');
        if (cut < 0) continue;
        const where = line.slice(1, cut).split(',').map(Number);
        const name = line.slice(cut + 1).trim();
        if (where.length !== 2 || !name || where.some(v => !Number.isFinite(v))) continue;
        const at = (where[1] - map.minY) * map.width + (where[0] - map.minX);
        if (at < 0 || at >= map.zoneByte.length) continue;
        const id = map.zoneByte[at];
        const zone = map.zones.find(z => z.id === id);
        if (!zone) continue;
        zone.name = name;
        zone.named = true;
        zone.from = 'walked';
        fixed++;
      }
    }
    if (fixed) console.log('  ' + fixed + ' places named by hand');
  }

  /*
   * A place's own roster, worked out now that the names are settled.
   *
   * Its ground is read off the name it is shown under - which is the name a
   * person has looked at and agreed with - falling back to the name of the
   * patch of colour it sits in.
   * falling back to the name of the patch of colour it sits in - the deserts
   * need that, being one colour and two grounds.
   */
  for (const zone of map.zones) {
    const patch = map.found.find(one => one.index === zone.biome);
    zone.ground = TERRAIN_OF[zone.name] || (patch ? TERRAIN_OF[patch.name] : '') || '';
    zone.lives = zone.ground ? rosterFor(zone.ground) : [];
    zone.met = true;
  }
  {
    const known = map.zones.filter(one => one.ground).length;
    const kinds = map.zones.reduce((n, one) => n + one.lives.length, 0);
    console.log('  ' + known + ' of ' + map.zones.length + ' places know their ground, and '
      + kinds + ' creature listings come from what the client says lives on it');
  }

  // A patch nobody was ever met in borrows its biome's list, so it is not
  // silent - but it is marked, so the difference is visible.
  for (const zone of map.zones) {
    if (zone.lives.length) { zone.met = true; continue; }
    const biome = map.found.find(b => b.index === zone.biome);
    zone.lives = (biome && biome.lives ? biome.lives : []).slice(0, 10);
    zone.met = false;
  }

  // Now that each patch has its own list, give those entries their pictures.
  for (const zone of map.zones) {
    for (const one of zone.lives || []) {
      const made = cutLife(one.type);
      if (made) one.sprite = made;
    }
    zone.lives = (zone.lives || []).filter(one => one.sprite);
  }
  for (const beacon of beacons) {
    for (const one of beacon.guards || []) {
      const made = cutLife(one.type);
      if (made) one.sprite = made;
    }
    beacon.guards = (beacon.guards || []).filter(one => one.sprite);
  }

  /*
   * And the people who come to fight all of it.
   *
   * The six classes are objects in the client like anything else, drawn from
   * one sheet called players, and they have the same walk cycle every
   * creature has - so they are cut exactly the way the wildlife is and the
   * page can move them with the same code. They are not wildlife and are not
   * listed as living anywhere: they arrive.
   */
  {
    /*
     * What each class is and what it carries, all of it the client's: the hit
     * points it tops out at, its attack and defence and dexterity, and the
     * four things it starts with. The first of those is its weapon and the
     * second its ability, and each declares the shot it throws. A wizard's
     * Energy Staff throws two missiles for ten to thirty; his Fire Spray
     * costs twenty magic. None of that is a number anybody here chose.
     */
    const kitOf = readKit();
    const wanted = ['Warrior', 'Knight', 'Wizard', 'Priest', 'Archer', 'Rogue'];
    const byName = new Map();
    for (const [type, name] of objectName) if (wanted.includes(name)) byName.set(name, type);
    const folk = [];
    for (const name of wanted) {
      const type = byName.get(name);
      if (type === undefined) continue;
      const sprite = cutLife(type);
      if (sprite) folk.push({ name, type, sprite, ...(kitOf.get(name) || {}) });
    }
    map.folk = folk;
    console.log('  ' + folk.length + ' of the six classes cut, to walk the realm');

    /*
     * And what a death leaves behind.
     *
     * The game has eleven gravestones and gives a dead character the one that
     * matches how far they got - the first four are small markers and the
     * rest are proper stones - and ten loot bags, whose colour is how good
     * what is in it is. Both are objects in the client like anything else, so
     * both are cut the same way, and neither is a picture anybody here drew.
     */
    const marks = { graves: [], bags: [] };
    for (let n = 1; n <= 11; n++) {
      const type = [...objectName].find(([, name]) => name === 'Gravestone ' + n);
      if (!type) continue;
      const sprite = cutLife(type[0]);
      if (sprite) marks.graves.push({ tier: n, sprite });
    }
    for (let n = 0; n <= 9; n++) {
      const type = [...objectName].find(([, name]) => name === 'Loot Bag ' + n);
      if (!type) continue;
      const sprite = cutLife(type[0]);
      if (sprite) marks.bags.push({ tier: n, sprite });
    }
    map.marks = marks;
    console.log('  ' + marks.graves.length + ' gravestones and ' + marks.bags.length
      + ' loot bags cut, for what is left behind');
  }

  const levels = buildPyramid();

  const summary = {
    px: PX, chunk: CHUNK, levels,
    bounds: { minX: map.minX, minY: map.minY, maxX: map.maxX, maxY: map.maxY },
    mask: { width: map.width, height: map.height, none: map.NONE, sea: map.SEA },
    focus: map.focus,
    biomes: map.found,
    zones: map.zones,
    folk: map.folk || [],
    marks: map.marks || { graves: [], bags: [] },
    beacons,
    roads: map.roadCount,
    tiles: store.tiles.size
  };
  /*
   * And what the people in it say to each other, if a corpus has been left
   * beside the project. The lines are filed by what they are for and carry
   * slots - a dungeon, an item, a class, a name - that the page fills from
   * this map, so a portal called out is a portal that really drops here.
   */
  {
    const talkFile = path.join(root, 'rotmg_dialogue_corpus.json');
    if (fs.existsSync(talkFile)) {
      try {
        const said = JSON.parse(fs.readFileSync(talkFile, 'utf8'));
        const lines = (said.lines || [])
          .filter(one => one && one.tag && one.text)
          .map(one => ({ tag: one.tag, text: one.text }));
        const talks = (said.conversations || [])
          .filter(one => one && Array.isArray(one.turns) && one.turns.length)
          .map(one => ({ turns: one.turns }));
        if (lines.length) {
          summary.chatter = { lines, talks };
          console.log('  ' + lines.length + ' things to say and ' + talks.length
            + ' exchanges');
        }
      } catch (e) {
        console.log('  the corpus of dialogue could not be read: ' + e.message);
      }
    }
  }

  /* What stands in the realm, cut and placed when the floor was drawn. */
  let standing = 0;
  for (const name of ['things.png', 'things.bin', 'things.json']) {
    const from = path.join(FROM, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(OUT, name));
    standing++;
  }
  summary.things = standing === 3;

  /* The cloud, cut from the client when the floor was drawn. */
  let sky = 0;
  for (const name of ['sky.png', 'sky.json', 'oryx.png']) {
    const from = path.join(FROM, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(OUT, name));
    sky++;
  }
  summary.sky = sky === 3;

  /* And the water that moves, listed when the floor was drawn. */
  let wet = 0;
  for (const name of ['water.png', 'water-art.png', 'water.json']) {
    const from = path.join(FROM, name);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(OUT, name));
    wet++;
  }
  summary.water = wet === 3;
  if (summary.things) {
    const t = JSON.parse(fs.readFileSync(path.join(OUT, 'things.json'), 'utf8'));
    console.log('  ' + (fs.statSync(path.join(OUT, 'things.bin')).size / 6).toLocaleString()
      + ' things standing, ' + t.pics.length + ' pictures');
  }

  fs.writeFileSync(path.join(OUT, 'atlas.json'), JSON.stringify(summary, null, 1) + '\n');

  writePage(summary);

  const drew = [...drawnAlready.values()].filter(Boolean).length;
  console.log('\n  ' + beacons.length + ' beacons, ' + livesHere
    + ' creature kinds placed by the ground the client gives them, ' + drew
    + ' of them drawn');
  console.log('  -> ' + path.relative(root, OUT) + '\n');
}

main();
