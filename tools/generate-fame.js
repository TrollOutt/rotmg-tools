'use strict';
/*
 * Write data/Fame/client-fame.txt from an extracted client.
 *
 *   node tools/extract-client.js && node tools/generate-fame.js
 *
 * The fame a character earns for what it has done. The client states all of it:
 * every bonus, what it is worth flat, what it is worth as a share of the base
 * fame, and the exact condition that earns it.
 *
 * Two shapes matter for a player working through dungeons:
 *
 *   - a collection, "Tunnel Rat", earned by completing each of a dozen named
 *     dungeons once. Those are the large ones: flat fame and a percentage on
 *     top.
 *   - a ladder, "Pirate Cave Scout" through "Master", earned at 1, 10, 20, 40
 *     and 100 completions of one dungeon. Small, flat, and they add up.
 *
 * A dungeon's completions are counted by a PlayerStat, and the same file maps
 * that stat to the dungeon's name, so a condition can be shown as the dungeon
 * a player would recognise rather than as "PirateCavesCompleted".
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const IN = path.join(root, 'client-data');
const OUT = path.join(root, 'data', 'Fame', 'client-fame.txt');

if (!fs.existsSync(IN)) {
  console.error('\n  client-data/ is missing. Run:  node tools/extract-client.js\n');
  process.exit(1);
}

const APOSTROPHE = String.fromCharCode(38, 97, 112, 111, 115, 59);
const unescapeXml = text => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .split(APOSTROPHE).join(String.fromCharCode(39))
  .replace(/&amp;/g, '&');
const attr = (text, name) => {
  const match = new RegExp(name + '="([^"]*)"').exec(text);
  return match ? match[1] : null;
};
const tag = (text, name) => {
  const match = new RegExp('<' + name + '(?:[^>]*)>([\\s\\S]*?)</' + name + '>').exec(text);
  return match ? unescapeXml(match[1].trim()) : null;
};

// The document holding them; found rather than assumed, so a reshuffle of the
// client's own file numbering does not break this.
let xml = null;
for (const file of fs.readdirSync(IN).filter(f => /^Objects\./.test(f))) {
  const text = fs.readFileSync(path.join(IN, file), 'utf8');
  if (text.includes('<FameBonus')) { xml = text; break; }
}
if (!xml) {
  console.error('\n  no <FameBonus> in any Objects document.\n');
  process.exit(1);
}

/* ---------------------------------------------------------------- *
 * 1. Which dungeon a completion stat counts                         *
 * ---------------------------------------------------------------- */
const dungeonOf = new Map();
for (const m of xml.matchAll(/<PlayerStat\b([^>]*)\/>/g)) {
  const id = attr(m[1], 'id');
  const dungeon = attr(m[1], 'dungeonId');
  if (id && dungeon) dungeonOf.set(id, unescapeXml(dungeon));
}

/* ---------------------------------------------------------------- *
 * 2. The bonuses                                                    *
 * ---------------------------------------------------------------- */
const bonuses = [];
for (const m of xml.matchAll(/<FameBonus[^>]*\bid="([^"]*)"[^>]*\bcode="([^"]*)"[^>]*>([\s\S]*?)<\/FameBonus>/g)) {
  const body = m[3];
  const conditions = [...body.matchAll(/<Condition([^>]*)>([^<]*)<\/Condition>/g)].map(c => ({
    kind: c[2].trim(),
    stat: attr(c[1], 'stat'),
    threshold: Number(attr(c[1], 'threshold')) || 0
  }));
  bonuses.push({
    id: m[1],
    code: Number(m[2]),
    group: tag(body, 'DisplayGroup') || '',
    category: tag(body, 'DisplayCategory') || '',
    name: (tag(body, 'DisplayName') || m[1]).replace(/\s*\{0\}\s*$/, ''),
    absolute: Number(tag(body, 'AbsoluteBonus')) || 0,
    relative: Number(tag(body, 'RelativeBonus')) || 0,
    repeatable: /<Repeatable\b/.test(body),
    description: (tag(body, 'Description') || '').replace(/\s+/g, ' '),
    conditions
  });
}

/* ---------------------------------------------------------------- *
 * 3. Write it                                                       *
 * ---------------------------------------------------------------- */
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
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

const groups = new Map();
for (const bonus of bonuses) groups.set(bonus.group, (groups.get(bonus.group) || 0) + 1);
console.log('\n  ' + bonuses.length + ' fame bonuses -> ' + path.relative(root, OUT));
for (const [group, count] of [...groups].sort((a, b) => b[1] - a[1])) {
  console.log('    ' + String(count).padStart(4) + '  ' + group);
}
console.log('  ' + dungeonOf.size + ' dungeons have a completion counter; '
  + named + ' conditions name one, ' + unnamed + ' count something else');
const collections = bonuses.filter(b => b.category === 'Dungeon Collection');
console.log('  ' + collections.length + ' collections, wanting '
  + collections.reduce((total, b) => total + b.conditions.length, 0) + ' dungeon completions between them');
console.log('');
