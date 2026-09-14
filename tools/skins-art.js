/*
 * The picture on the Skin Viewer card, cut out of the client's own sheet.
 *
 * Every other way in on the front page shows something out of the game: the
 * enchanter's room, the forge, a dungeon's portal, the index's book. The skin
 * viewer's card was a CSS diamond — a glyph standing in for a picture, which
 * is the one thing on that page that is not the game.
 *
 * So it gets what the module is actually about: nine characters wearing nine
 * different skins, in the row-and-column the viewer itself lays them out in,
 * each enlarged whole pixel by whole pixel so it stays the pixel art it is.
 *
 *   node tools/skins-art.js
 *
 * It reads the two files the viewer already ships — the skin catalogue and the
 * character sheet it points into — so it needs no installed client.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readPng, writePng } = require('./png.js');

const root = path.join(__dirname, '..');
const SKINS = path.join(root, 'web', 'assets', 'skins', 'generated', 'skins.json');
const SHEET = path.join(root, 'web', 'assets', 'skins', 'textures', 'characters.png');
const OUT = path.join(root, 'data', 'GUI Files', 'Page Art', 'Skins.png');

/*
 * Nine of the eighteen classes, in the order the viewer lists them, so the
 * card reads as a row of the game's people rather than a random nine. One
 * skin each: the first the client declares for that class which has a
 * standing-still, facing-you frame on the sheet.
 */
const WANTED = ['Wizard', 'Priest', 'Archer', 'Rogue', 'Warrior',
  'Knight', 'Paladin', 'Huntress', 'Necromancer'];

const COLUMNS = 3;
const CELL = 8;          // the client draws a character eight pixels square
const SCALE = 16;        // whole pixels only, never a fraction
const GAP = 8;           // in finished pixels, between one cell and the next

/*
 * Standing still and facing the reader. A walking or attacking frame catches
 * the character mid-stride, which on a still picture reads as a mistake.
 */
function restingFrame(skin) {
  const order = [
    q => q.set === 0 && q.action === 'idle' && q.direction === 'front',
    q => q.set === 0 && q.action === 'idle' && q.direction === 'side',
    q => q.action === 'idle'
  ];
  for (const wants of order) {
    for (const sequence of skin.sequences || []) {
      if (!wants(sequence)) continue;
      const frame = (sequence.frames || []).find(one =>
        one.spriteAvailable && one.atlas === 'characters'
        && one.rect && one.rect.w === CELL && one.rect.h === CELL);
      if (frame) return frame;
    }
  }
  return null;
}

/* A skin nobody would recognise is not worth a ninth of the card. */
function real(skin) {
  return skin.className && !/placeholder|\bunused\b|\btest\b/i.test(skin.id || '');
}

function main() {
  const skins = JSON.parse(fs.readFileSync(SKINS, 'utf8'));
  const chosen = [];
  /*
   * A different family for each of the nine. Taking simply the first skin
   * each class declares gives nine members of whichever family the client
   * happens to list first, and nine of the same costume is a picture of one
   * skin, not of a viewer for fifteen hundred.
   */
  const spent = new Set();
  for (const className of WANTED) {
    const one = skins.find(skin =>
      skin.className === className && real(skin)
      && !spent.has(skin.family) && restingFrame(skin));
    if (!one) {
      console.error(`No unused family left for ${className}; the catalogue has changed shape.`);
      process.exit(1);
    }
    spent.add(one.family);
    chosen.push({ className, skin: one, frame: restingFrame(one) });
  }

  const sheet = readPng(fs.readFileSync(SHEET));
  const rows = Math.ceil(chosen.length / COLUMNS);
  const cell = CELL * SCALE;
  const width = COLUMNS * cell + (COLUMNS - 1) * GAP;
  const height = rows * cell + (rows - 1) * GAP;
  const out = Buffer.alloc(width * height * 4);

  chosen.forEach(({ frame }, at) => {
    const left = (at % COLUMNS) * (cell + GAP);
    const top = Math.floor(at / COLUMNS) * (cell + GAP);
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const from = ((frame.rect.y + y) * sheet.width + frame.rect.x + x) * 4;
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const to = ((top + y * SCALE + dy) * width + left + x * SCALE + dx) * 4;
            sheet.pixels.copy(out, to, from, from + 4);
          }
        }
      }
    }
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const png = writePng(width, height, out);
  fs.writeFileSync(OUT, png);
  console.log(`Skins.png  ${width}x${height}  ${(png.length / 1024).toFixed(1)} KB`);
  for (const { className, skin } of chosen) console.log(`  ${className.padEnd(13)} ${skin.id}`);
}

main();
