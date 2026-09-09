'use strict';
// Build-time projection; the browser keeps its existing compact text file.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const provenance = require('./provenance');
const meta = provenance.stamp(__filename, index.from, index.built);
const OUT = path.join(root, 'data', 'Items', 'client-items.txt');
const items = index.catalogues.items;
const lines = [
  '## Every item an installed RotMG client will let a player enchant.',
  '##',
  '## Written by tools/generate-items.js. Do not edit by hand: run the',
  '## generator again after a game update and diff the result.',
  '##',
  '## item|name|slot|dust|reroll costs|slot chances|family|pool|awakened|labels',
  '##',
  '## "reroll costs" is what a reroll costs at one, two, three and four slots.',
  '## "slot chances" is how likely a dropped copy is to have each slot, which',
  '## the calculator does not use yet but the client states per item.',
  ''
];
for (const item of items) {
  lines.push(['item', item.name, item.category || '', item.dust, item.costs,
    item.slotChance, item.family, item.pool === 'Default Enchantment Pool' ? '' : item.pool,
    item.awoken.join(','), item.labels.join(',')].join('|'));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, provenance.header(meta) + lines.join('\n') + '\n', 'utf8');
console.log('Projected items from index build ' + index.from.build);
