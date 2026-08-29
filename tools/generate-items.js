'use strict';
/*
 * Write data/Items/client-items.txt from an extracted client.
 *
 *   node tools/extract-client.js && node tools/generate-items.js
 *
 * Every item the game will let a player enchant, with what the enchanter needs
 * to know about it. This replaces a catalogue scraped from RealmEye's wiki and
 * a tier-to-dust table inferred from it: the client states the dust outright,
 * and it knows 2018 enchantable items where the scrape found 1618.
 *
 * It also replaces the awakened-item mapping, which was 148 pairs read off wiki
 * pages. An awakened enchantment says which item label it is compatible with
 * and the items carry that label, so the mapping is simply read rather than
 * assembled.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const IN = path.join(root, 'client-data');
const OUT = path.join(root, 'data', 'Items', 'client-items.txt');

if (!fs.existsSync(path.join(IN, 'Enchantments.xml'))) {
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
  const match = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(text);
  return match ? unescapeXml(match[1].trim()) : null;
};

const SLOTS = ['WEAPON', 'ABILITY', 'ARMOR', 'RING'];
const FAMILIES = ['ALIEN', 'NEO_ALIEN', 'SUMMONPOWERED'];
const DUST = { greenDust: 'Green', redDust: 'Red', purpleDust: 'Purple' };

/* ---------------------------------------------------------------- *
 * 1. Read every enchantable item                                    *
 * ---------------------------------------------------------------- */
const items = [];
for (const file of fs.readdirSync(IN).filter(f => /^Objects\./.test(f))) {
  const xml = fs.readFileSync(path.join(IN, file), 'utf8');
  for (const m of xml.matchAll(/<Object[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Object>/g)) {
    const body = m[2];
    const slots = /<EnchantmentSlots\b([^>]*)\/>/.exec(body);
    if (!slots) continue;
    const labels = (tag(body, 'Labels') || '').split(',').filter(Boolean);
    items.push({
      id: m[1],
      name: tag(body, 'DisplayId') || m[1],
      slotType: Number(tag(body, 'SlotType')),
      labels,
      // The four categories, when the item says so. 34 do not, and those are
      // settled below from what other items of the same slot type say.
      category: labels.find(label => SLOTS.includes(label)) || null,
      family: labels.find(label => FAMILIES.includes(label)) || '',
      dust: DUST[attr(slots[1], 'dustType')] || '',
      costs: attr(slots[1], 'dustAmounts') || '',
      slotChance: attr(slots[1], 'slotChance') || '',
      pool: attr(slots[1], 'enchantmentList') || ''
    });
  }
}

/*
 * The slot type to category map, derived rather than written down. Each numeric
 * slot type is whatever the items that do carry a category label say it is; the
 * 34 that carry none — the katanas, the amulets — then follow their own kind.
 * A slot type whose labelled items disagree is reported instead of guessed at.
 */
const votes = new Map();
for (const item of items) {
  if (!item.category) continue;
  if (!votes.has(item.slotType)) votes.set(item.slotType, new Map());
  const tally = votes.get(item.slotType);
  tally.set(item.category, (tally.get(item.category) || 0) + 1);
}
const categoryOf = new Map();
const contested = [];
for (const [slotType, tally] of votes) {
  const ranked = [...tally].sort((a, b) => b[1] - a[1]);
  categoryOf.set(slotType, ranked[0][0]);
  if (ranked.length > 1) contested.push(`${slotType}: ${ranked.map(([c, n]) => `${c} x${n}`).join(', ')}`);
}
const homeless = [];
for (const item of items) {
  if (item.category) continue;
  const guess = categoryOf.get(item.slotType);
  if (guess) item.category = guess;
  else homeless.push(`${item.name} (slot type ${item.slotType})`);
}

/* ---------------------------------------------------------------- *
 * 2. Which awakened enchantment each item unlocks                   *
 * ---------------------------------------------------------------- */
const enchXml = fs.readFileSync(path.join(IN, 'Enchantments.xml'), 'utf8');
const TYPOS = {
  'Mana -AttackTradeoff': 'Mana -Attack Tradeoff',
  'Pirates Expertise': "Pirate's Expertise",
  'Vampric Lifeforce': 'Vampiric Lifeforce',
  'Mp Cost Reduction': 'MP Cost Reduction'
};
/*
 * An awakened enchantment names two things at once: the slot it goes on and the
 * item it belongs to. NIGHTMATTER_STRENGTH is "WEAPON,AOO" — any Agents of Oryx
 * weapon — while its three siblings are the same AOO label on the other three
 * slots. Matching on the specific label alone put all four on every AoO item.
 */
const GENERIC = new Set([...SLOTS, 'EQUIPMENT', 'UT', 'ST', 'SUPER']);
const awakened = [];
for (const m of enchXml.matchAll(/<Enchantment[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Enchantment>/g)) {
  const labels = (tag(m[2], 'EnchantmentLabels') || '').split(',').filter(Boolean);
  if (!labels.includes('AWAKENED') || !labels.includes('ROLLABLE')) continue;
  const shown = tag(m[2], 'DisplayId');
  const compatible = (tag(m[2], 'CompatibleWithItemLabels') || '').split(',').filter(Boolean);
  const refused = (tag(m[2], 'IncompatibleWithItemLabels') || '').split(',').filter(Boolean);
  const named = compatible.filter(label => SLOTS.includes(label));
  awakened.push({
    id: m[1],
    name: TYPOS[shown] || shown,
    neo: labels.includes('NEO_ALIEN'),
    slots: (named.length ? named : SLOTS).filter(slot => !refused.includes(slot)),
    keys: compatible.filter(label => !GENERIC.has(label))
  });
}
// Two awakened enchantments share a display name across the Alien and Neo Alien
// forms; the same suffix the enchantment file uses keeps them apart.
const timesNamed = new Map();
for (const a of awakened) timesNamed.set(a.name, (timesNamed.get(a.name) || 0) + 1);
for (const a of awakened) if (a.neo && timesNamed.get(a.name) > 1) a.name += ' (Neo)';

for (const item of items) {
  item.awoken = awakened
    .filter(a => a.slots.includes(item.category) && a.keys.some(key => item.labels.includes(key)))
    .map(a => a.name);
}

// An awakened enchantment no item in the client can carry. Reported, not
// patched: the gap is in the game's own data.
const unreachable = awakened.filter(a => !items.some(item => item.awoken.includes(a.name)));

/* ---------------------------------------------------------------- *
 * 3. Write it                                                       *
 * ---------------------------------------------------------------- */
/*
 * One line per name. The client holds a shiny copy of many items as a separate
 * object with the same display name and a better slot-chance table, and four
 * "Long Sword NRarity" test swords that carry no dust at all. A player picking
 * an item by name wants one row, and the ordinary copy is the one to show.
 */
const byName = new Map();
for (const item of items) {
  if (/[0-9]Rarity$/.test(item.id)) continue;
  const seen = byName.get(item.name);
  if (!seen) { byName.set(item.name, item); continue; }
  const shiny = item.labels.includes('SHINY');
  if (!shiny && seen.labels.includes('SHINY')) byName.set(item.name, item);
}
const dropped = items.length - byName.size;
items.length = 0;
items.push(...byName.values());
items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
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
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

const withAwoken = items.filter(i => i.awoken.length);
console.log('\n  ' + items.length + ' enchantable items -> ' + path.relative(root, OUT));
console.log('  ' + withAwoken.length + ' of them unlock an awakened enchantment');
const odd = items.filter(i => i.pool && i.pool !== 'Default Enchantment Pool');
if (odd.length) console.log('  ' + odd.length + ' draw from a pool of their own: ' + odd.map(i => `${i.name} (${i.pool})`).join(', '));
if (unreachable.length) {
  console.log('  ' + unreachable.length + ' awakened enchantments no item in the client can carry: '
    + unreachable.map(a => `${a.name} (wants ${a.keys.join(',')})`).join(', '));
}
if (contested.length) console.log('  slot types whose items disagree on the category: ' + contested.join(' ; '));
if (homeless.length) console.log('  ' + homeless.length + ' with no category and no slot type to borrow one from: ' + homeless.join(', '));
const noDust = items.filter(i => !i.dust);
if (noDust.length) console.log('  ' + noDust.length + ' carry no dust type: ' + noDust.map(i => i.name).slice(0, 12).join(', '));
console.log('');
