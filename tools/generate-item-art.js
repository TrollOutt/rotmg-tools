'use strict';
/*
 * Where every module gets an item's picture.
 *
 * There used to be three answers to "what does this item look like". The
 * calculator read a folder of sixteen hundred PNGs downloaded from the wiki;
 * Theory Crafting read the same folder and fell back to a sheet of its own;
 * the index cut its own sheet out of the client. So three pages of one site
 * disagreed about the same object, and the three Venerable rings - which the
 * wiki has never drawn - showed a picture on one page and an empty slot on the
 * other two, while the pixels sat in a sheet the other two never opened.
 *
 * There is one answer now, and it is the index's: the rectangle it cut from
 * the installed client. This projects that rectangle out under the item's name
 * so a page can look one up without carrying the six megabyte index, and every
 * page draws the same picture from the same sheet.
 *
 * Names, not client ids, because that is what the calculator and the bench
 * have to hand. Where a name is filed twice - a thing and its shiny, a base
 * and its reskin - the first is kept: they are the same picture often enough,
 * and the index itself is where you go when you need to tell them apart.
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const provenance = require('./provenance');
const meta = provenance.stamp(__filename, index.from, index.built);

const art = {};
for (const record of index.records) {
  if (record.kind !== 'item' || !record.art) continue;
  if (!art[record.name]) art[record.name] = record.art;
}

const out = { ...meta, sheet: index.sheet, art };
const file = path.join(root, 'data', 'Index', 'item-art.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out) + '\n');

// Beside the index it was cut from, which is where the pages fetch it.
const served = path.join(root, 'web', 'assets', 'index');
fs.mkdirSync(served, { recursive: true });
fs.copyFileSync(file, path.join(served, 'item-art.json'));

console.log(`${Object.keys(art).length} item pictures projected from index build ${index.from.build}`);
