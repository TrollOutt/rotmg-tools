'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// A separate HTTP page. Nothing from the engine is embedded in home or download.
function buildTraining(root, pagesDir) {
  const source = path.join(root, 'web', 'training');
  const target = path.join(pagesDir, 'training');
  fs.mkdirSync(target, { recursive: true });
  const read = file => fs.readFileSync(path.join(source, file), 'utf8').replace(/\r\n/g, '\n');
  const assets = Object.fromEntries(['floor', 's_shade', 's_tendril', 's_arrow_blue', 's_arrow_red', 's_spike_blue', 's_spike_red', 's_fog',
    's_player_right', 's_player_up', 's_player_left', 's_player_down'].map(name => [name, `assets/${name}.png`]));
  fs.writeFileSync(path.join(target, 'data.js'), `const ROOM=${read('room.json')};\nconst SPRITES=${read('assets/sprites.json')};\nconst ASSETS=${JSON.stringify(assets)};\n`);
  const catalog = require('./training-catalog').readTrainingCatalog(root);
  // Cut only the projected icons from the canonical Index sheet.
  const { readPng, writePng } = require('./png');
  const sheet = readPng(fs.readFileSync(path.join(root, 'web/assets/index/sheet.png')));
  const icons = [...catalog.equipment, ...catalog.consumables, ...catalog.excluded].filter(it => it.icon);
  const cell = 16, wide = 128, tall = Math.max(cell, Math.ceil(icons.length / 8) * cell);
  const pixels = Buffer.alloc(wide * tall * 4);
  for (const [i, it] of icons.entries()) {
    const [x, y, w, h] = it.icon, ox = (i % 8) * cell, oy = Math.floor(i / 8) * cell;
    if (w > cell || h > cell) throw new Error('Training icon exceeds cell: ' + it.id);
    for (let row = 0; row < h; row++) sheet.pixels.copy(pixels, ((oy + row) * wide + ox) * 4,
      ((y + row) * sheet.width + x) * 4, ((y + row) * sheet.width + x + w) * 4);
    it.icon = [ox, oy, w, h];
  }
  fs.writeFileSync(path.join(target, 'catalog.js'), `const TRAINING_CATALOG=${JSON.stringify(catalog)};\n`);
  fs.writeFileSync(path.join(target, 'icons.png'), writePng(wide, tall, pixels));
  for (const file of ['engine.js', 'index-combat.js', 'renderer.js', 'ui_code.js', 'ui_game.js', 'ui_gear.js', 'ui_bg.js', 'loop.js', 'ui.css', 'shell.css', 'PROVENANCE.md']) {
    fs.writeFileSync(path.join(target, file), read(file));
  }
  for (const folder of ['assets', 'fonts']) fs.cpSync(path.join(source, folder), path.join(target, folder), { recursive: true });
  // The page loads its parts as separate files. Each URL carries a digest of its content,
  // so a browser holding an older part cannot run it beside newer ones.
  const page = read('page.html').replace('<!--TRAINING_UI-->', () => read('ui.html'))
    .replace(/(src|href)="([\w.-]+\.(?:js|css))"/g, (all, attr, file) => {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(target, file))).digest('hex').slice(0, 10);
      return `${attr}="${file}?v=${digest}"`;
    });
  fs.writeFileSync(path.join(target, 'index.html'), page);
}

module.exports = { buildTraining };
