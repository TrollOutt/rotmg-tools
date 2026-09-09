'use strict';
// Build-time projection; the browser keeps its existing compact text file.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const provenance = require('./provenance');
const meta = provenance.stamp(__filename, index.from, index.built);
const OUT = path.join(root, 'data', 'Fame', 'client-fame.txt');
const { bonuses, dungeons } = index.catalogues.fame;
const dungeonOf = new Map(Object.entries(dungeons));
const lines = [
  '## Every fame bonus an installed RotMG client defines.',
  '##',
  '## Written by tools/generate-fame.js. Do not edit by hand: run the',
  '## generator again after a game update and diff the result.',
  '##',
  '## bonus|id|group|category|name|absolute|relative %|repeatable|description',
  '##   needs|<dungeon or stat>|<completions required>',
  '##',
  '## "relative" is a percentage of the character\'s base fame, added on top of',
  '## the flat amount. A bonus with several "needs" wants all of them.',
  ''
];

bonuses.sort((a, b) => a.code - b.code);
let named = 0;
let unnamed = 0;
for (const bonus of bonuses) {
  lines.push(['bonus', bonus.id, bonus.group, bonus.category, bonus.name,
    bonus.absolute, bonus.relative, bonus.repeatable ? 'repeatable' : '', bonus.description].join('|'));
  for (const condition of bonus.conditions) {
    // A dungeon condition is written as the dungeon; anything else keeps the
    // stat's own name, which is at least honest about what it counts.
    const dungeon = condition.stat && dungeonOf.get(condition.stat);
    if (dungeon) named++; else unnamed++;
    lines.push(['  needs', dungeon || condition.stat || condition.kind, condition.threshold].join('|'));
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, provenance.header(meta) + lines.join('\n') + '\n', 'utf8');
console.log('Projected fame from index build ' + index.from.build);
