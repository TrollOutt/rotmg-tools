'use strict';
// Build-time projection; the browser keeps its existing compact text file.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const provenance = require('./provenance');
const meta = provenance.stamp(__filename, index.from, index.built);
const OUT = path.join(root, 'data', 'Enchantment documents', 'client-enchantments.txt');
const out = index.catalogues.enchantments;
const lines = [
  '## Every enchantment an installed RotMG client defines.',
  '##',
  '## Written by tools/generate-enchantments.js. Do not edit by hand: run the',
  '## generator again after a game update and diff the result.',
  '##',
  '## ench|name|weight|tier split|Labels|Incompatible Labels|slots|required family|incompatible item ids|description',
  '##',
  '## A tiered enchantment is four records in the client and one line here; the',
  '## split is those four weights over their total, not a rounded figure.',
  ''
];
for (const record of out) {
  lines.push(['ench', record.name, record.weight, record.split, record.labels.join(','),
    record.excludes.join(','), record.slots.join(','), record.families.join(','),
    record.incompatibleIds.join(','), record.description].join('|'));
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, provenance.header(meta) + lines.join('\n') + '\n', 'utf8');
console.log('Projected enchantments from index build ' + index.from.build);
