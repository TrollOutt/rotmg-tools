/*
 * What an Index card shows that the Index itself does not carry, read out of
 * the installed client.
 *
 *   node tools/build-index-extras.js
 *
 * The card of a piece of gear (web/fiches-c.js) draws more than the record:
 * what the Forge takes and gives for it, the projectile it fires and how that
 * projectile moves, the loot bag it drops in, the family icon of an untiered
 * item, and the material, dust and forgefire icons those rows are written
 * with. Every one of those is something the client declares, so every one is
 * rebuilt here from the client on each `npm run scrape`; nothing under the
 * files below is made by hand.
 *
 *   web/assets/index/client-forge.json       forge, feed power, XP, dust, bag, family, blueprints
 *   web/assets/index/projectiles.json/.png   what each item fires, and every projectile's frames
 *   web/assets/index/loot-bags.png           Loot Bag 0 to 9, in BagType order
 *   web/assets/index/forge-ui.png            materials, dusts and forgefire, from the GUI atlas
 *   web/assets/index/collection-icons.json/.png   CollectionIcon_N, the untiered families
 *
 * The first three come from the XML documents, the sprite registry and the
 * texture sheets that `npm run extract-client-data` has already written into
 * client-data/. The last two are Unity sprites that only the client's own
 * resources.assets holds, so they are read from the installed client.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('./spritesheet');
const { readPng, writePng } = require('./png');
const unity = require('./extract-client-textures');

const root = path.join(__dirname, '..');
const XML = unity.CLIENT_DATA;
const OUT = path.join(root, 'web', 'assets', 'index');

const attr = (s, name) => { const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(s); return m ? m[1] : undefined; };
const tag = (s, name) => { const m = new RegExp('<' + name + '>([^<]*)</' + name + '>').exec(s); return m ? m[1].trim() : undefined; };
const flag = (s, n) => new RegExp('<' + n + '\\s*/>').test(s) || new RegExp('<' + n + '>\\s*(true|1)?\\s*</' + n + '>').test(s);
const num = (s, n) => { const v = tag(s, n); return v === undefined || v === '' ? undefined : Number(v); };

/* Every object of the client, by id, in document order: the first declaration of an id wins. */
const documents = fs.readdirSync(XML).filter(f => /^Objects\.\d+\.xml$/.test(f)).sort()
  .map(f => fs.readFileSync(path.join(XML, f), 'utf8'));
const objects = new Map();
const typeToId = new Map();
const typeNameToId = new Map();
for (const text of documents) {
  for (const m of text.matchAll(/<Object\s+([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const id = attr(m[1], 'id'), type = attr(m[1], 'type');
    if (!id) continue;
    if (!objects.has(id)) objects.set(id, { head: m[1], body: m[2] });
    if (type && !typeToId.has(parseInt(type, 16))) typeToId.set(parseInt(type, 16), id);
    if (type) typeNameToId.set(type.toLowerCase(), id);
  }
}

const blob = registry.read(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const sheets = {};
const sheetFor = name => (name in sheets ? sheets[name] : (sheets[name] = (() => {
  const file = path.join(XML, 'textures', name + '.png');
  return fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null;
})()));

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log('  ' + name.padEnd(24) + (data.length / 1024).toFixed(0).padStart(6) + ' KB');
}

/* ---------------- the Forge, and the rest of what an item declares ---------------- */
function buildForge() {
  const nums = s => (s ? Object.fromEntries(['common', 'rare', 'legendary', 'mythical']
    .map(k => [k, Number(attr(s, k) || 0)]).filter(([, v]) => v)) : {});
  const items = {};
  const forge = {};
  const blueprintOf = {};
  for (const text of documents) {
    for (const m of text.matchAll(/<Object\s+([^>]*)>([\s\S]*?)<\/Object>/g)) {
      const extra = m[1], body = m[2];
      const id = attr(extra, 'id'), type = attr(extra, 'type');
      if (!id || !type) continue;
      /* A blueprint says itself which item it unlocks at the Forge. */
      const unlock = /<Activate\s+id="([^"]+)"\s*>UnlockForgeBlueprint<\/Activate>/.exec(body);
      if (unlock) (blueprintOf[unlock[1]] || (blueprintOf[unlock[1]] = [])).push(id);
      if (!/<Item\s*\/>/.test(body)) continue;
      const family = attr(extra, 'collectionIcon');
      const ench = /<EnchantmentSlots[^>]*>/.exec(body);
      const one = {
        feed: num(body, 'feedPower'),
        xp: num(body, 'XPBonus'),
        power: num(body, 'PowerLevel'),
        bag: num(body, 'BagType'),
        family: family !== undefined ? Number(family) : undefined,
        dust: ench ? attr(ench[0], 'dustType') : undefined,
        dustAmounts: ench && attr(ench[0], 'dustAmounts') ? attr(ench[0], 'dustAmounts').split(',').map(Number) : undefined
      };
      for (const k of Object.keys(one)) if (one[k] === undefined) delete one[k];
      if (Object.keys(one).length) items[id] = one;
    }
    for (const m of text.matchAll(/<ForgeProperties\s+([^>]*)>([\s\S]*?)<\/ForgeProperties>/g)) {
      const id = attr(m[1], 'id'), body = m[2];
      if (!id) continue;
      forge[id] = {
        canDismantle: /<CanDismantle\s*\/>/.test(body),
        canCraft: /<CanCraft\s*\/>/.test(body),
        dismantle: nums((/<DismantleRequirements[^>]*>/.exec(body) || [])[0]),
        craft: nums((/<CraftRequirements[^>]*>/.exec(body) || [])[0]),
        forgefire: Number(tag(body, 'ForgefireCost') || 0),
        forgefireBack: Number(tag(body, 'ForgefireDismantle') || 0),
        blueprint: /<BlueprintRequired\s*\/>/.test(body),
        hide: (tag(body, 'HideItemsWithLabels') || '').split(',').map(x => x.trim()).filter(Boolean),
        needs: [...body.matchAll(/<RequiredItem\s+quantity="(\d+)"\s*>([^<]+)<\/RequiredItem>/g)]
          .map(x => ({ quantity: Number(x[1]), type: x[2].trim().toLowerCase() })),
        sacrifice: [...body.matchAll(/<RequireDismantleWithLabel\s+amount="(\d+)"\s*>([^<]+)<\/RequireDismantleWithLabel>/g)]
          .map(x => ({ amount: Number(x[1]), label: x[2].trim() }))
      };
    }
  }
  for (const one of Object.values(forge)) for (const n of one.needs) n.id = typeNameToId.get(n.type) || null;
  for (const [id, one] of Object.entries(forge)) (items[id] || (items[id] = {})).forge = one;
  for (const [id, list] of Object.entries(blueprintOf)) (items[id] || (items[id] = {})).blueprints = list;
  write('client-forge.json', Buffer.from(JSON.stringify(items)));
  return Object.keys(forge).length;
}

/* ---------------- what each item fires ---------------- */
function buildProjectiles() {
  const still = new Map();
  for (const atlas of blob.still) {
    const m = new Map();
    for (const s of atlas.sprites) if (!m.has(s.index)) m.set(s.index, s);
    still.set(atlas.name, m);
  }
  const moving = new Map();
  for (const one of blob.animated) {
    const key = one.atlas + '#' + one.index;
    (moving.get(key) || moving.set(key, []).get(key)).push(one);
  }

  /* A projectile object's picture: its still texture, or the frames of its animated one. */
  const cut = new Map();
  function picOf(projId) {
    if (cut.has(projId)) return cut.get(projId);
    const body = (objects.get(projId) || {}).body;
    let out = null;
    const art = body && /<(Animated)?Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/.exec(body);
    /*
     * An <Animation> replaces the texture above it: two hundred projectiles
     * declare a placeholder there (Love Witch Proj 1's is an orange bullet)
     * and draw themselves with the frames of the animation, always playing.
     */
    const anim = body && /<Animation\b[^>]*>([\s\S]*?)<\/Animation>/.exec(body);
    const played = anim ? [...anim[1].matchAll(/<Frame\s+time="([^"]+)"[^>]*>\s*<Texture>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>/g)]
      .map(f => ({ time: Number(f[1]), atlas: f[2].trim(), sprite: (still.get(f[2].trim()) || new Map()).get(Number(f[3])) }))
      .filter(f => f.sprite) : [];
    if (played.length) {
      const atlas = played[0].atlas;
      const rects = played.map(f => ({ ...f.sprite.rect, sheet: f.sprite.sheet }))
        .filter(r => r.w && r.h && sheetFor(registry.sheetName(r.sheet))).slice(0, 8);
      const time = played.reduce((sum, f) => sum + f.time, 0) / played.length;
      if (rects.length) {
        const cellM = /(\d+)x\d+/.exec(atlas) || /Embed(\d+)/.exec(atlas);
        const cell = cellM ? Number(cellM[1]) : /Big/i.test(atlas) ? 16 : 8;
        out = { key: projId, rects, cell, atlas, fps: time > 0 ? Math.round(10 / time) / 10 : undefined,
          size: num(body, 'Size'), tilt: num(body, 'AngleCorrection'), spin: num(body, 'Rotation') };
      }
    }
    if (art && !out) {
      const atlas = art[2].trim(), index = Number(art[3]);
      let rects = [];
      const run = moving.get(atlas + '#' + index);
      if (art[1] && run && run.length) {
        rects = run.filter(r => r.action === 0 && (r.direction === 0 || r.direction === undefined));
        if (!rects.length) rects = run;
        rects = rects.map(r => ({ ...r.rect, sheet: r.sheet }));
      } else {
        const one = (still.get(atlas) || new Map()).get(index);
        if (one) rects = [{ ...one.rect, sheet: one.sheet }];
      }
      rects = rects.filter(r => r.w && r.h && sheetFor(registry.sheetName(r.sheet))).slice(0, 8);
      if (rects.length) {
        /* The atlas cell: a sprite of a 16x16 atlas covers one tile as an 8x8 one does, only finer. */
        const cellM = /(\d+)x\d+/.exec(atlas) || /Embed(\d+)/.exec(atlas);
        const cell = cellM ? Number(cellM[1]) : /Big/i.test(atlas) ? 16 : 8;
        out = { key: projId, rects, cell, atlas, size: num(body, 'Size'), tilt: num(body, 'AngleCorrection'), spin: num(body, 'Rotation') };
      }
    }
    cut.set(projId, out);
    return out;
  }

  const items = {};
  for (const [id, { body }] of objects) {
    if (!/<Item\s*\/>/.test(body) || !/<Projectile\b/.test(body)) continue;
    const shots = [];
    for (const m of body.matchAll(/<Projectile\b([^>]*)>([\s\S]*?)<\/Projectile>/g)) {
      const p = m[2];
      const proj = tag(p, 'ObjectId');
      const pic = proj ? picOf(proj) : null;
      shots.push({
        pid: (/\bid="(\d+)"/.exec(m[1]) || [])[1] || '0',
        pic: pic ? pic.key : null,
        sizeDeclared: num(p, 'Size') !== undefined,
        size: num(p, 'Size') !== undefined ? num(p, 'Size') : (pic && pic.size !== undefined ? pic.size : 100),
        speed: (num(p, 'Speed') || 0) / 10,                 // tenths of a tile a second, to tiles a second
        life: (num(p, 'LifetimeMS') || 0) / 1000,
        amp: num(p, 'Amplitude') || 0,
        freq: num(p, 'Frequency') || 1,
        mag: num(p, 'Magnitude') || 3,
        wavy: flag(p, 'Wavy'), param: flag(p, 'Parametric'), boom: flag(p, 'Boomerang'),
        multi: flag(p, 'MultiHit'), pierce: flag(p, 'ArmorPiercing'), cover: flag(p, 'PassesCover'),
        accel: num(p, 'Acceleration'), accelDelay: num(p, 'AccelerationDelay'), speedClamp: num(p, 'SpeedClamp')
      });
    }
    if (!shots.length) continue;
    items[id] = { many: num(body, 'NumProjectiles') || 1, arc: num(body, 'ArcGap'), rate: num(body, 'RateOfFire') || 1, tilt: num(body, 'AngleCorrection'), shots };
  }

  /*
   * A full set changes the skin, and sometimes its weapon's projectile too
   * (ChangeSkin ... bulletType). Most sets say it once, for all four pieces
   * (ActivateOnEquipAll); a few say it several times with
   * ActivateOnEquipCustom, one skin and one projectile per combination of
   * pieces (requiredItems). Every one of them is read, and filed by the skin
   * it gives. A skin whose set changes no projectile still fires its set's
   * weapon, as the game does.
   */
  const sets = {};
  const skins = {};
  const firing = pid => pid && items[pid] && /<SlotType>(1|2|3|8|17|24)<\/SlotType>/.test((objects.get(pid) || {}).body || '');
  const text = fs.readFileSync(path.join(XML, 'EquipmentSets.xml'), 'utf8');
  for (const m of text.matchAll(/<EquipmentSet\s+([^>]*)>([\s\S]*?)<\/EquipmentSet>/g)) {
    const id = attr(m[1], 'id');
    if (!id) continue;
    const pieces = [...m[2].matchAll(/itemtype="([^"]+)"/g)].map(x => typeToId.get(parseInt(x[1], 16)));
    for (const change of m[2].matchAll(/<(ActivateOnEquip\w*)\s+([^>]*)>\s*ChangeSkin\s*<\/\1>/g)) {
      const bullet = attr(change[2], 'bulletType');
      const pic = bullet ? picOf(bullet) : null;
      const needs = attr(change[2], 'requiredItems');
      /* The set's weapon: the piece that fires - among those this skin requires, when it names them. */
      const from = needs ? needs.split(',').map(x => typeToId.get(parseInt(x.trim(), 16))) : pieces;
      const weapon = from.find(firing) || pieces.find(firing);
      const skin = attr(change[2], 'skinType'), size = attr(change[2], 'size');
      const one = {
        weapon: weapon || null,
        skin: skin ? '0x' + parseInt(skin, 16).toString(16) : null,
        skinSize: size ? Number(size) : 100,
        bullet: pic ? pic.key : null,
        bulletSize: pic && pic.size !== undefined ? pic.size : 100
      };
      if (!sets['set:' + id]) sets['set:' + id] = one;
      if (one.skin && !skins[one.skin]) skins[one.skin] = { set: 'set:' + id, ...one };
    }
  }

  /* One sheet for every picture, laid out on shelves. */
  const used = [...cut.values()].filter(Boolean);
  const WIDE = 1024;
  let x = 0, y = 0, shelf = 0;
  const pics = {};
  const place = [];
  for (const one of used) {
    const w = Math.max(...one.rects.map(r => r.w)), h = Math.max(...one.rects.map(r => r.h));
    const run = w * one.rects.length;
    if (x + run > WIDE) { x = 0; y += shelf; shelf = 0; }
    pics[one.key] = { x, y, w, h, cell: one.cell, atlas: one.atlas, frames: one.rects.length, ...(one.fps ? { fps: one.fps } : {}), ...(one.tilt ? { tilt: one.tilt } : {}), ...(one.spin ? { spin: one.spin } : {}) };
    place.push([one, x, y, w]);
    x += run; shelf = Math.max(shelf, h);
  }
  const TALL = y + shelf;
  const out = Buffer.alloc(WIDE * TALL * 4);
  for (const [one, ox, oy, w] of place) {
    one.rects.forEach((r, f) => {
      const png = sheetFor(registry.sheetName(r.sheet));
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
        const si = ((r.y + j) * png.width + r.x + i) * 4, di = ((oy + j) * WIDE + ox + f * w + i) * 4;
        png.pixels.copy(out, di, si, si + 4);
      }
    });
  }
  write('projectiles.png', writePng(WIDE, TALL, out));
  write('projectiles.json', Buffer.from(JSON.stringify({ wide: WIDE, tall: TALL, pics, items, sets, skins })));
  return { items: Object.keys(items).length, pics: used.length, sets: Object.keys(skins).length };
}

/* ---------------- loot bags ---------------- */
function buildLootBags() {
  const atlas = blob.still.find(a => a.name === 'lofiObj4');
  const INDEX = [0xd0, 0xd1, 0xd2, 0xd3, 0xd5, 0xd6, 0xd9, 0xd4, 0xd7, 0xd8];   // Loot Bag 0..9
  const out = Buffer.alloc(80 * 8 * 4);
  INDEX.forEach((index, n) => {
    const s = atlas.sprites.find(one => one.index === index);
    const png = sheetFor(registry.sheetName(s.sheet));
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const si = ((s.rect.y + y) * png.width + (s.rect.x + x)) * 4, di = (y * 80 + n * 8 + x) * 4;
      png.pixels.copy(out, di, si, si + 4);
    }
  });
  write('loot-bags.png', writePng(80, 8, out));
}

/* ---------------- Unity sprites: the GUI atlas and the family icons ---------------- */
function openClient() {
  const assets = unity.findClient();
  if (!assets) throw new Error('No installed client found: forge-ui.png and collection-icons.png need its resources.assets');
  const file = unity.openAssets(assets);
  return { file, dir: path.dirname(assets), byPath: new Map(file.objects.map(o => [o.pathID, o])) };
}

/* A Sprite (class 213), read by position: rect, then past offset, border, ppu, pivot and extrude, to its render key and textures. */
function readSprite(file, object) {
  const r = new unity.Reader(file.buffer, false);
  r.at = object.byteStart;
  const f32 = () => { const v = file.buffer.readFloatLE(r.at); r.at += 4; return v; };
  const name = r.string();
  const rect = [f32(), f32(), f32(), f32()];
  r.at += 8 + 16 + 4 + 8 + 4;
  r.bool(); r.align();
  const key = file.buffer.subarray(r.at, r.at + 16).toString('hex'); r.bytes(16);
  const key2 = r.i64();
  const tags = r.i32(); for (let i = 0; i < tags; i++) r.string();
  r.i32(); const atlasPath = r.i64();
  r.i32(); const texPath = r.i64();
  return { name, rect, key: key + ':' + key2, atlasPath, texPath };
}

/* A SpriteAtlas (class 687078895): for each render key, the texture and rectangle the sprite is packed at. */
function readAtlas(file, object) {
  const r = new unity.Reader(file.buffer, false);
  r.at = object.byteStart;
  const f32 = () => { const v = file.buffer.readFloatLE(r.at); r.at += 4; return v; };
  r.string();
  const packed = r.i32(); for (let i = 0; i < packed; i++) { r.i32(); r.i64(); }
  const names = r.i32(); for (let i = 0; i < names; i++) r.string();
  const maps = r.i32();
  const data = {};
  for (let i = 0; i < maps; i++) {
    const k = file.buffer.subarray(r.at, r.at + 16).toString('hex'); r.bytes(16);
    const k2 = r.i64();
    r.i32(); const texPath = r.i64();
    r.i32(); r.i64();                                     // alpha texture
    const rect = [f32(), f32(), f32(), f32()];
    r.at += 4 * (2 + 2 + 4 + 1);                          // texture and atlas offsets, uv transform, downscale
    r.u32();                                              // settings
    const sec = r.i32(); for (let j = 0; j < sec; j++) { r.i32(); r.i64(); r.string(); }
    data[k + ':' + k2] = { texPath, rect };
  }
  return data;
}

/* A texture's raw RGBA32 pixels, bottom-up as Unity keeps them: inline, or streamed from the .resS beside the assets. */
function pixelsOf(client, texPath) {
  const { file } = client;
  const tex = client.byPath.get(texPath);
  const r = new unity.Reader(file.buffer, false);
  r.at = tex.byteStart;
  r.string();
  const base = r.at;
  const w = file.buffer.readInt32LE(base + 4), h = file.buffer.readInt32LE(base + 8);
  const size = file.buffer.readInt32LE(base + 12), format = file.buffer.readInt32LE(base + 20);
  if (format !== 4) throw new Error('texture ' + texPath + ' is format ' + format + ', not RGBA32');
  const end = tex.byteStart + tex.byteSize;
  const streamName = 'resources.assets.resS';
  const at = file.buffer.lastIndexOf(Buffer.from(streamName), end);
  let raw;
  if (at > tex.byteStart) {
    const length = file.buffer.readUInt32LE(at - 8), offset = Number(file.buffer.readBigUInt64LE(at - 16));
    raw = Buffer.alloc(length);
    const fd = fs.openSync(path.join(client.dir, streamName), 'r');
    fs.readSync(fd, raw, 0, length, offset);
    fs.closeSync(fd);
  } else raw = file.buffer.subarray(end - size - 16, end - 16);
  return { w, h, raw };
}

/* Copy a bottom-up rectangle of a texture, top-down, into a strip. */
function blit(tex, [x, y, w, h], out, outWidth, ox, oy) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = ((y + h - 1 - j) * tex.w + (x + i)) * 4, di = ((oy + j) * outWidth + ox + i) * 4;
    tex.raw.copy(out, di, si, si + 4);
  }
}

function buildForgeIcons(client) {
  const ORDER = ['material_common', 'material_rare', 'material_legendary', 'material_mythical', 'redDust', 'purpleDust', 'greenDust', 'fireforge-points'];
  const found = {};
  for (const o of client.file.objects) {
    if (o.classID !== 213) continue;
    const sprite = readSprite(client.file, o);
    if (ORDER.includes(sprite.name) && !found[sprite.name]) found[sprite.name] = sprite;
  }
  const missing = ORDER.filter(n => !found[n]);
  if (missing.length) throw new Error('GUI sprites not found: ' + missing.join(', '));
  const atlases = {};
  const strip = Buffer.alloc(16 * ORDER.length * 16 * 4);
  const textures = {};
  ORDER.forEach((n, k) => {
    const s = found[n];
    const atlas = atlases[s.atlasPath] || (atlases[s.atlasPath] = readAtlas(client.file, client.byPath.get(s.atlasPath)));
    const d = atlas[s.key];
    if (!d) throw new Error('no atlas render data for ' + n);
    const tex = textures[d.texPath] || (textures[d.texPath] = pixelsOf(client, d.texPath));
    blit(tex, d.rect.map(Math.round), strip, 16 * ORDER.length, k * 16, 0);
  });
  write('forge-ui.png', writePng(16 * ORDER.length, 16, strip));
}

function buildFamilyIcons(client) {
  const sprites = [];
  for (const o of client.file.objects) {
    if (o.classID !== 213) continue;
    const sprite = readSprite(client.file, o);
    const m = /^CollectionIcon_(\d+)$/.exec(sprite.name);
    if (m) sprites.push({ n: Number(m[1]), rect: sprite.rect.map(Math.round), texPath: sprite.texPath });
  }
  if (!sprites.length) throw new Error('no CollectionIcon sprites in the client');
  const textures = {};
  const S = Math.max(...sprites.map(s => Math.max(s.rect[2], s.rect[3])));
  const COLS = 16, count = Math.max(...sprites.map(s => s.n)) + 1, ROWS = Math.ceil(count / COLS);
  const W = COLS * S, H = ROWS * S, out = Buffer.alloc(W * H * 4);
  for (const s of sprites) {
    const tex = textures[s.texPath] || (textures[s.texPath] = pixelsOf(client, s.texPath));
    blit(tex, s.rect, out, W, (s.n % COLS) * S, Math.floor(s.n / COLS) * S);
  }
  write('collection-icons.png', writePng(W, H, out));
  write('collection-icons.json', Buffer.from(JSON.stringify({ size: S, cols: COLS, wide: W, tall: H, have: sprites.map(s => s.n).sort((a, b) => a - b) })));
  return sprites.length;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('\n  Index card extras, from the client');
  const forged = buildForge();
  const shot = buildProjectiles();
  buildLootBags();
  const client = openClient();
  buildForgeIcons(client);
  const families = buildFamilyIcons(client);
  console.log('\n  ' + forged + ' forge entries, ' + shot.items + ' items that fire ' + shot.pics + ' projectile pictures, '
    + shot.sets + ' set skins, ' + families + ' family icons\n');
}

if (require.main === module) main();
