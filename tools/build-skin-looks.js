/*
 * Where every frame of every skin sits, and what every dye does.
 *
 *   node tools/build-skin-looks.js
 *
 * The Skin Viewer used to carry a catalogue of its own: 1,475 skins with
 * their names, their class, a costume worked out from the name, 802 dyes and
 * a bridge of guessed links back to the index. All of that is in the index
 * now, read out of the same client files by the same build - so what is left
 * here is the one thing the index has no use for, which is geometry.
 *
 * This file is rectangles. For each skin, every frame of every animation:
 * where it is on the client's packed sheet, where its dye mask is, and which
 * action, direction and animation set it belongs to. For each dye, what it
 * lays down - a colour, or a patch of cloth that may scroll or spin. For each
 * class, the sprite the picker draws.
 *
 * Nothing here is named and nothing here is deduced. Names, classes, tiers,
 * costumes and every join live on the index record, found by the client type
 * that is the key of each entry below.
 *
 * It reads only client-data/, which is what `npm run extract-client-data`
 * writes, so `npm run scrape` reproduces it like everything else.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('./spritesheet');
const provenance = require('./provenance');

const root = path.join(__dirname, '..');
const XML = process.env.ROTMG_CLIENT_DATA || path.join(root, 'client-data');
const OUT = path.join(root, 'web', 'assets', 'skins', 'generated', 'looks.json');

if (!fs.existsSync(XML)) {
  console.log('\n  No client-data/ here, so there is nothing to read.');
  console.log('  On a machine with the game installed:  npm run extract-client-data\n');
  process.exit(0);
}

/* ---------------- the client ---------------- */
const documents = new Map(fs.readdirSync(XML).filter(name => name.endsWith('.xml')).sort()
  .map(name => [name, fs.readFileSync(path.join(XML, name), 'utf8')]));
const objectFiles = [...documents.keys()].filter(name => /^Objects\.\d+\.xml$/.test(name)).sort();

const SHAPE = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;
const text = (body, tag) => {
  const m = new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>').exec(body);
  return m ? m[1].trim() : '';
};
/* An index may be written decimal or hex, and both appear in the same file. */
const number = said => {
  const value = /^0x/i.test(said) ? Number.parseInt(said, 16) : Number(said);
  return Number.isFinite(value) ? value : undefined;
};

const objects = [];
for (const file of objectFiles) {
  for (const m of documents.get(file).matchAll(SHAPE)) {
    const id = /\bid="([^"]*)"/.exec(m[1]);
    const said = /\btype="([^"]+)"/.exec(m[1]);
    if (!id || !said) continue;
    const type = Number.parseInt(said[1], 16);
    if (!Number.isFinite(type)) continue;
    objects.push({ file, type, id: id[1], body: m[2] });
  }
}

/* ---------------- the registry ---------------- */
const bin = path.join(XML, 'spritesheet.bin');
if (!fs.existsSync(bin)) {
  console.error('\n  spritesheet.bin is missing. Run: npm run extract-client-data\n');
  process.exit(1);
}
const sheet = registry.read(fs.readFileSync(bin));

/*
 * Every animated frame, kept under the atlas and index an object points at,
 * in the order the client wrote them. That order is the animation: frame 0 of
 * a walk is simply the first one written.
 */
const frames = new Map();
for (const one of sheet.animated) {
  const key = one.atlas + '#' + one.index;
  if (!frames.has(key)) frames.set(key, []);
  frames.get(key).push(one);
}

/* And the still ones, for the pictures that do not move: a dye's vial, its
   bolt of cloth, the sprite on a class button. */
const stills = new Map();
for (const atlas of sheet.still) {
  const mine = new Map();
  for (const one of atlas.sprites) if (!mine.has(one.index)) mine.set(one.index, one);
  stills.set(atlas.name, mine);
}
const stillAt = (atlas, index) => {
  const mine = stills.get(atlas);
  const one = mine && mine.get(index);
  return one ? { sheet: one.sheet, rect: one.rect } : null;
};

/* What an object points its picture at. */
function textureOf(body, tag) {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(body);
  if (!m) return null;
  const file = text(m[1], 'File');
  const index = number(text(m[1], 'Index'));
  return file && index !== undefined ? { file, index } : null;
}

const hex = type => '0x' + type.toString(16);

/* ---------------- skins ---------------- */
/*
 * A frame is written as one flat row rather than an object with eleven keys
 * repeated 28,936 times. The mask is always the same size as the sprite where
 * there is one, so only its corner is kept.
 *
 *   [set, action, direction, x, y, w, h, maskX, maskY, padding]
 *
 * A mask corner of -1 means the client declares none, and the viewer draws
 * the sprite undyed.
 */
const skins = {};
let frameCount = 0;
let skinsWithoutFrames = 0;
for (const one of objects) {
  if (text(one.body, 'Class') !== 'Skin') continue;
  const texture = textureOf(one.body, 'AnimatedTexture');
  const mine = texture ? frames.get(texture.file + '#' + texture.index) : null;
  if (!mine || !mine.length) { skinsWithoutFrames++; continue; }
  const rows = mine.map(frame => {
    frameCount++;
    return [
      frame.set, frame.action, frame.direction,
      frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h,
      frame.mask ? frame.mask.x : -1, frame.mask ? frame.mask.y : -1,
      frame.pad
    ];
  });
  skins[hex(one.type)] = {
    on: mine[0].sheet,
    at: texture.file + '#' + texture.index,
    frames: rows
  };
}

/* ---------------- dyes ---------------- */
/*
 * The client writes a dye as one number.
 *
 *   <Tex1>  what it puts on your clothes
 *   <Tex2>  what it puts on your accessory
 *
 * Its top byte says which kind: 0x01 is a flat colour and the rest of the
 * number is the colour itself; 0x04, 0x05, 0x09 and 0x0a are the four cloth
 * atlases, four pixels square through ten, and the rest is the index into
 * one; 0xff is the remover.
 *
 * <AnimatedDye> makes the cloth move - along, down, or around a pivot.
 */
const CLOTH = { 4: 'textile4x4', 5: 'textile5x5', 9: 'textile9x9', 10: 'textile10x10' };
const SPIN = { 1: 'horizontal', 2: 'vertical', 3: 'spinning' };

const dyes = {};
let dyesUnreadable = 0;
for (const one of objects) {
  if (text(one.body, 'Class') !== 'Dye') continue;
  const which = /<Tex1>([^<]+)<\/Tex1>/.exec(one.body) ? 'clothing'
    : /<Tex2>([^<]+)<\/Tex2>/.exec(one.body) ? 'accessory' : null;
  if (!which) continue;
  const said = text(one.body, which === 'clothing' ? 'Tex1' : 'Tex2');
  const value = number(said);
  if (value === undefined) { dyesUnreadable++; continue; }
  const kind = (value >>> 24) & 0xff;
  const rest = value & 0xffffff;

  const made = { on: which };
  if (kind === 0xff) made.kind = 'remove';
  else if (kind === 1) {
    made.kind = 'color';
    made.color = '#' + rest.toString(16).padStart(6, '0');
  } else if (CLOTH[kind]) {
    const cloth = stillAt(CLOTH[kind], rest);
    if (!cloth) { dyesUnreadable++; continue; }
    made.kind = 'cloth';
    made.cloth = { atlas: CLOTH[kind], index: rest, on: cloth.sheet, rect: cloth.rect };
  } else { dyesUnreadable++; continue; }

  const moves = /<AnimatedDye\b([^>]*)\/>/.exec(one.body);
  if (moves) {
    const attr = name => {
      const m = new RegExp(name + '="([^"]*)"').exec(moves[1]);
      return m ? Number(m[1]) : undefined;
    };
    const how = SPIN[attr('type')];
    if (how) {
      made.moves = { how, speed: attr('speed') || 0,
        pivotX: attr('pivotX') || 0, pivotY: attr('pivotY') || 0 };
    }
  }

  /* The vial or the bolt as it sits in a bag, which is what the list shows. */
  const icon = textureOf(one.body, 'Texture');
  const drawn = icon && stillAt(icon.file, icon.index);
  if (drawn) made.icon = { on: drawn.sheet, rect: drawn.rect };

  dyes[hex(one.type)] = made;
}

/* ---------------- classes ---------------- */
const classes = {};
for (const one of objects) {
  if (!/<Player\s*\/>/.test(one.body)) continue;
  const texture = textureOf(one.body, 'AnimatedTexture');
  const mine = texture ? frames.get(texture.file + '#' + texture.index) : null;
  if (!mine || !mine.length) continue;
  /* Standing still, facing the reader, for a button the size of a thumbnail. */
  const still = mine.find(f => f.action === 0 && f.direction === 2) || mine[0];
  classes[hex(one.type)] = { on: still.sheet, rect: still.rect };
}

/* ---------------- one sheet, holding only what is drawn ---------------- */
/*
 * The client packs every creature in the game onto three sheets totalling
 * thirty-seven megabytes, and this viewer draws characters and a few bolts of
 * cloth out of them. So the rectangles above are cut out and laid down again
 * on a sheet of their own, the same way the index cuts its own.
 *
 * Every rectangle is claimed first and the sheet is built from the claims, so
 * a sprite that two skins share - and a mask shared by a whole family - is
 * carried once. Laid out tallest first in rows of a fixed width, which wastes
 * a sliver at the end of each row and nothing else.
 */
const claims = new Map();                      // "sheet x y w h" -> index
const cut = [];
function claim(on, rect) {
  if (!rect || !rect.w || !rect.h) return -1;
  const key = on + ' ' + rect.x + ' ' + rect.y + ' ' + rect.w + ' ' + rect.h;
  if (claims.has(key)) return claims.get(key);
  const at = cut.length;
  claims.set(key, at);
  cut.push({ on, rect });
  return at;
}

for (const skin of Object.values(skins)) {
  for (const row of skin.frames) {
    row[10] = claim(skin.on, { x: row[3], y: row[4], w: row[5], h: row[6] });
    row[11] = row[7] < 0 ? -1
      : claim('characters_masks', { x: row[7], y: row[8], w: row[5], h: row[6] });
  }
}
for (const dye of Object.values(dyes)) {
  if (dye.cloth) dye.cloth.at = claim(dye.cloth.on, dye.cloth.rect);
  if (dye.icon) dye.icon.at = claim(dye.icon.on, dye.icon.rect);
}
for (const one of Object.values(classes)) one.at = claim(one.on, one.rect);

const WIDE = 2048;
const order = cut.map((one, at) => at).sort((a, b) => cut[b].rect.h - cut[a].rect.h);
let penX = 0, penY = 0, rowH = 0;
const place = new Array(cut.length);
for (const at of order) {
  const { rect } = cut[at];
  if (penX + rect.w > WIDE) { penX = 0; penY += rowH; rowH = 0; }
  place[at] = [penX, penY, rect.w, rect.h];
  penX += rect.w;
  if (rect.h > rowH) rowH = rect.h;
}
const TALL = penY + rowH;

const { readPng, writePng } = require('./png');
const sources = new Map();
const sourceFor = name => {
  if (!sources.has(name)) {
    const file = path.join(XML, 'textures', name + '.png');
    sources.set(name, fs.existsSync(file) ? readPng(fs.readFileSync(file)) : null);
  }
  return sources.get(name);
};

const sheetPixels = Buffer.alloc(WIDE * TALL * 4);
let unpainted = 0;
for (let at = 0; at < cut.length; at++) {
  const { on, rect } = cut[at];
  const from = sourceFor(on);
  if (!from) { unpainted++; continue; }
  const [px, py] = place[at];
  for (let ry = 0; ry < rect.h; ry++) {
    if (rect.y + ry >= from.height) break;
    for (let rx = 0; rx < rect.w; rx++) {
      if (rect.x + rx >= from.width) break;
      const source = ((rect.y + ry) * from.width + rect.x + rx) * 4;
      from.pixels.copy(sheetPixels, ((py + ry) * WIDE + px + rx) * 4, source, source + 4);
    }
  }
}

/* And now every rectangle names where it landed here, not where it was. */
const at = n => (n >= 0 ? place[n] : null);
for (const skin of Object.values(skins)) {
  skin.frames = skin.frames.map(row => {
    const drawn = at(row[10]), mask = at(row[11]);
    return [row[0], row[1], row[2], drawn[0], drawn[1], drawn[2], drawn[3],
      mask ? mask[0] : -1, mask ? mask[1] : -1, row[9]];
  });
  delete skin.on;
}
for (const dye of Object.values(dyes)) {
  if (dye.cloth) { const p = at(dye.cloth.at); dye.cloth = { atlas: dye.cloth.atlas, index: dye.cloth.index, rect: { x: p[0], y: p[1], w: p[2], h: p[3] } }; }
  if (dye.icon) { const p = at(dye.icon.at); dye.icon = { rect: { x: p[0], y: p[1], w: p[2], h: p[3] } }; }
}
for (const one of Object.values(classes)) {
  const p = at(one.at);
  delete one.on; delete one.at;
  one.rect = { x: p[0], y: p[1], w: p[2], h: p[3] };
}

/* ---------------- written down ---------------- */
const result = Object.assign(
  provenance.clientStamp(XML, __filename),
  {
    sheet: { wide: WIDE, tall: TALL, file: 'looks.png' },
    row: ['set', 'action', 'direction', 'x', 'y', 'w', 'h', 'maskX', 'maskY', 'padding'],
    actions: registry.ACTION,
    directions: registry.DIRECTION,
    skins,
    dyes,
    classes
  }
);

{
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const written = JSON.stringify(result);
  fs.writeFileSync(OUT, written);
  const png = writePng(WIDE, TALL, sheetPixels);
  const sheetFile = path.join(root, 'web', 'assets', 'skins', 'textures', 'looks.png');
  fs.mkdirSync(path.dirname(sheetFile), { recursive: true });
  fs.writeFileSync(sheetFile, png);

  console.log('\n  ' + Object.keys(skins).length.toLocaleString('en-US') + ' skins, '
    + frameCount.toLocaleString('en-US') + ' frames');
  console.log('  ' + Object.keys(dyes).length.toLocaleString('en-US') + ' dyes, '
    + Object.keys(classes).length + ' classes');
  if (skinsWithoutFrames) console.log('  ' + skinsWithoutFrames + ' skins declare a texture the registry does not hold');
  if (dyesUnreadable) console.log('  ' + dyesUnreadable + ' dyes could not be read');
  if (unpainted) console.log('  ' + unpainted + ' rectangles had no sheet to cut from');
  console.log('  ' + cut.length.toLocaleString('en-US') + ' distinct rectangles on one '
    + WIDE + '×' + TALL + ' sheet');
  console.log('  -> ' + path.relative(root, OUT) + '  ('
    + (written.length / 1048576).toFixed(2) + ' MB)');
  console.log('  -> ' + path.relative(root, sheetFile) + '  ('
    + (png.length / 1048576).toFixed(2) + ' MB)\n');
}
