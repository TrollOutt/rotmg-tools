'use strict';
// Extraction moved from generate-items.js; source text is supplied by build-index.
module.exports = function(documents) {
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
for (const file of [...documents.keys()].filter(f => /^Objects\./.test(f))) {
  const xml = documents.get(file);
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
const enchXml = documents.get('Enchantments.xml');
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
/*
 * The five items the game's own developers left in. Nothing in the client marks
 * them — SUBTYPE and BASETYPE both cover dozens of real items — so they are
 * named here, and a tripwire below catches any new one rather than letting it
 * through silently. Four are rarity templates carrying no dust at all; the
 * fifth has complete data and only its name gives it away.
 */
const DEVELOPER_ITEMS = new Set([
  'Long Sword 1Rarity', 'Long Sword 2Rarity', 'Long Sword 3Rarity', 'Long Sword 4Rarity',
  'Def Test Flail'
]);
const DEVELOPER_NAME = new RegExp('\\b(test|debug|dummy|placeholder|temp|dev|sample|unused|deprecated|wip|todo)\\b|[0-9]Rarity$', 'i');
const unlisted = items
  .filter(item => !DEVELOPER_ITEMS.has(item.name) && DEVELOPER_NAME.test(item.name + ' ' + item.id))
  .map(item => item.name);

const byName = new Map();
for (const item of items) {
  if (DEVELOPER_ITEMS.has(item.name)) continue;
  const seen = byName.get(item.name);
  if (!seen) { byName.set(item.name, item); continue; }
  const shiny = item.labels.includes('SHINY');
  if (!shiny && seen.labels.includes('SHINY')) byName.set(item.name, item);
}
const dropped = items.length - byName.size;
items.length = 0;
items.push(...byName.values());
items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

return items;
};
