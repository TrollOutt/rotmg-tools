'use strict';
/*
 * The parade on the Skin Viewer's module.
 *
 * The front page shows each tool beside a picture of what it does, and what
 * the Skin Viewer does is show people walking about in the game's own clothes.
 * A still of a costume rack says "clothes"; a handful of them walking past one
 * after another says what the page is for. So this cuts a few named skins out
 * of the sheet the viewer already carries and lays their side-on walk frames
 * end to end in one strip, which the page then steps along.
 *
 * Out of the sheet the site ships, not out of the client: `looks.json` already
 * says where every frame of every skin sits on `looks.png`, both of which are
 * in the repository, so this runs on a machine that has never had the game
 * installed. `npm run skin-looks` is what puts those there in the first place,
 * and is the thing to run first if a client update moves anything.
 *
 * The strip is deliberately tiny - the frames are eight pixels square, so
 * thirteen skins walking four steps each is a few kilobytes - because it is
 * loaded by the front page, which is the one page nobody chose to visit.
 */
const fs = require('fs');
const path = require('path');
const { readPng, writePng } = require('./png');

const root = path.join(__dirname, '..');
const skinsDir = path.join(root, 'web', 'assets', 'skins');
const LOOKS = path.join(skinsDir, 'generated', 'looks.json');
const NAMES = path.join(skinsDir, 'generated', 'skins.json');
const SHEET = path.join(skinsDir, 'textures', 'looks.png');
const OUT = path.join(root, 'web', 'assets', 'skins', 'generated', 'walk.png');

/*
 * Who walks past, in the order they do it.
 *
 * Chosen rather than gathered: a run of fourteen hundred skins picked by rule
 * would be a run of fourteen hundred palette swaps, and what this wants is a
 * dozen that read as different people from across the game at eight pixels
 * square. Matched by name and loosely, because a skin is called "Set Skin" in
 * the client about half the time and nobody says that out loud.
 */
const CAST = [
  'Beefcake Santa',
  'Big Monster Knight',
  'Bluebell Borzoi Warrior',
  'Court Jester Summoner',
  'Court Magician Sorcerer',
  'Evolutionary Trex Shiny',
  'Exalted Mad God Oryx Paladin',
  'New Twilight Archmage',
  'Shattered King Necromancer',
  'Shattered Queen Mystic',
  'Void Doctor Priest',
  'Void Priest'
];

/* How many cells each of them gets. Two frames is a walk cycle, so six cells
   is three steps - long enough to read as walking and short enough that the
   next one is never far off. */
const STEPS = 6;

const tidy = said => String(said).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function main() {
  for (const file of [LOOKS, NAMES, SHEET]) {
    if (!fs.existsSync(file)) {
      console.error('missing ' + path.relative(root, file) + ' — run `npm run skin-looks` first.');
      process.exit(1);
    }
  }
  const looks = JSON.parse(fs.readFileSync(LOOKS, 'utf8'));
  const named = JSON.parse(fs.readFileSync(NAMES, 'utf8')).skins;
  const sheet = readPng(fs.readFileSync(SHEET));

  const walk = looks.actions.indexOf('walk');
  const side = looks.directions.indexOf('side');
  if (walk < 0 || side < 0) throw new Error('the sheet no longer says which frames are a walk from the side');

  /* Name to type, preferring an exact match and falling back to the one whose
     name is the asked-for one with something like "Set Skin" after it. */
  const byName = new Map();
  for (const skin of named) if (!byName.has(tidy(skin.name))) byName.set(tidy(skin.name), skin);
  const find = want => {
    const key = tidy(want);
    if (byName.has(key)) return byName.get(key);
    let best = null;
    for (const [name, skin] of byName) {
      if (!name.startsWith(key + ' ')) continue;
      if (!best || name.length < tidy(best.name).length) best = skin;
    }
    return best;
  };

  const cells = [];
  const missing = [];
  for (const want of CAST) {
    const skin = find(want);
    const look = skin && looks.skins[skin.type];
    const frames = look ? look.frames.filter(f => f[1] === walk && f[2] === side) : [];
    if (!frames.length) { missing.push(want); continue; }
    for (let i = 0; i < STEPS; i++) cells.push({ name: skin.name, frame: frames[i % frames.length] });
  }
  if (missing.length) {
    console.error('no side-on walk for: ' + missing.join(', '));
    process.exit(1);
  }

  /* One square cell for all of them, the size of the largest frame there is,
     so the page can work out how many there are by dividing the strip's width
     by its height and nothing has to be written down twice. */
  const box = cells.reduce((most, cell) => Math.max(most, cell.frame[5], cell.frame[6]), 0);
  const wide = box * cells.length;
  const out = Buffer.alloc(wide * box * 4);

  /*
   * And everybody the same height in it.
   *
   * These are drawn at whatever size the game drew them - most at sixteen
   * pixels, one at eight, one at thirty-two across - and a parade in which
   * one of them is a quarter of the others is not a parade, it is a mistake.
   * So each is enlarged by whole pixels until the next whole pixel would not
   * fit: whole ones because they are pixel art and half a pixel is a blur,
   * and the largest that fits because a cell that is not filled is a person
   * standing further away.
   */
  cells.forEach((cell, index) => {
    const [, , , sx, sy, w, h] = cell.frame;
    const grow = Math.max(1, Math.min(Math.floor(box / w), Math.floor(box / h)));
    const left = index * box + Math.floor((box - w * grow) / 2);
    const top = Math.floor((box - h * grow) / 2);   // and stood on the same line
    for (let y = 0; y < h * grow; y++) {
      const from = ((sy + Math.floor(y / grow)) * sheet.width + sx) * 4;
      const to = ((top + y) * wide + left) * 4;
      for (let x = 0; x < w * grow; x++) {
        sheet.pixels.copy(out, to + x * 4,
          from + Math.floor(x / grow) * 4, from + Math.floor(x / grow) * 4 + 4);
      }
    }
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, writePng(wide, box, out));
  console.log('Skin parade: ' + (cells.length / STEPS) + ' skins, ' + cells.length
    + ' frames of ' + box + 'px, ' + Math.round(fs.statSync(OUT).size / 102.4) / 10 + ' KB.');
}

main();
