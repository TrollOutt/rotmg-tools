'use strict';
// Extraction moved from generate-enchantments.js; source text is supplied by build-index.
module.exports = function(documents) {
const APOSTROPHE = String.fromCharCode(38, 97, 112, 111, 115, 59);   // &apos;
const unescapeXml = text => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .split(APOSTROPHE).join(String.fromCharCode(39))
  .replace(/&amp;/g, '&');
const tag = (text, name) => {
  const match = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(text);
  return match ? unescapeXml(match[1].trim()) : '';
};
const list = (text, name) => tag(text, name).split(',').map(s => s.trim()).filter(Boolean);

/*
 * Four display names in the client are typos — a missing space, a missing
 * apostrophe, a dropped letter, a lowercase initialism. Corrected at the one
 * place names cross from the client into our data. Not cosmetic: an artifact
 * rule that names an enchantment we spell differently never matches.
 */
const TYPOS = {
  'Mana -AttackTradeoff': 'Mana -Attack Tradeoff',
  'Pirates Expertise': "Pirate's Expertise",
  'Vampric Lifeforce': 'Vampiric Lifeforce',
  'Mp Cost Reduction': 'MP Cost Reduction'
};

const SLOTS = ['WEAPON', 'ABILITY', 'ARMOR', 'RING'];
const FAMILIES = ['ALIEN', 'NEO_ALIEN', 'SUMMONPOWERED'];

const xml = documents.get('Enchantments.xml');
const records = [];
for (const m of xml.matchAll(/<Enchantment[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Enchantment>/g)) {
  const body = m[2];
  const labels = list(body, 'EnchantmentLabels');
  const tier = labels.map(l => /^TIER([1-4])$/.exec(l)).find(Boolean);
  records.push({
    id: m[1],
    shown: tag(body, 'DisplayId'),
    description: tag(body, 'Description').replace(/\\n/g, ' ').replace(/\s+/g, ' '),
    weight: Number(tag(body, 'Weight')) || 0,
    labels,
    excludes: list(body, 'IncompatibleWithEnchantmentLabels'),
    compatible: list(body, 'CompatibleWithItemLabels'),
    incompatible: list(body, 'IncompatibleWithItemLabels'),
    incompatibleIds: list(body, 'IncompatibleWithItemIds'),
    tier: tier ? Number(tier[1]) : 0
  });
}

/*
 * Fold the tiers, keyed on the id stem rather than the display name. The
 * client's own roman numerals are not reliable — Dexterity_Mana_Tradeoff_3
 * displays as "II" — and folding on what it displays merged records that are
 * not the same enchantment.
 */
const groups = new Map();
for (const record of records) {
  const key = record.tier ? record.id.replace(/_[1-4]$/, '') : record.id;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(record);
}

/*
 * A display name shared by two different enchantments: the client calls both
 * the Alien and the Neo Alien form of Acid Guardian, and of Solar Mastery,
 * exactly that. We separate them so a player can tell which one they are
 * aiming at.
 *
 * The count has to be over rollable groups only. The client keeps a
 * non-rollable twin of every alien enchantment — ALIEN_ONSHOOT_ATTACK beside
 * ALIEN_ONSHOOT_ATTACK_ROLLABLE, same display name — and counting those made
 * every alien enchantment look like a collision, which renamed seven that
 * needed no renaming.
 */
const strip = shown => shown.replace(/ (I{1,3}|IV)$/, '');
const isRollable = members => members.some(member => member.labels.includes('ROLLABLE'));
const timesNamed = new Map();
for (const [, members] of groups) {
  if (!isRollable(members)) continue;
  const name = strip(members[0].shown);
  timesNamed.set(name, (timesNamed.get(name) || 0) + 1);
}

const out = [];
for (const [key, members] of groups) {
  members.sort((a, b) => a.tier - b.tier);
  const first = members[0];

  // The commonest stripped name among the tiers, so one typo does not decide.
  const counts = new Map();
  for (const member of members) {
    const name = strip(member.shown);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let shown = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  shown = TYPOS[shown] || shown;
  if (timesNamed.get(strip(first.shown)) > 1 && first.labels.includes('NEO_ALIEN')) shown += ' (Neo)';

  const tiered = members.length > 1 || first.tier > 0;
  const weight = members.reduce((total, member) => total + member.weight, 0);
  const split = tiered && weight
    ? members.map(member => (member.weight / weight).toFixed(5)).join(',')
    : '';

  // Labels are the union across tiers, minus the per-tier markers; TIERED
  // stands in for them, as the rest of the engine expects.
  const labels = new Set();
  for (const member of members) for (const label of member.labels) if (!/^TIER[1-4]$/.test(label)) labels.add(label);
  if (tiered) labels.add('TIERED');

  // Which of the four slots this can land on. A record either names slots
  // outright or says EQUIPMENT, meaning all of them; either way the
  // incompatible list takes some away again.
  const named = first.compatible.filter(label => SLOTS.includes(label));
  let slots = named.length ? named : SLOTS.slice();
  slots = slots.filter(slot => !first.incompatible.includes(slot));

  out.push({
    key,
    name: shown,
    weight,
    split,
    labels: [...labels].sort(),
    excludes: [...new Set(members.flatMap(m => m.excludes))].sort(),
    slots,
    // An equipment family the item itself must be of, which the client states
    // as an item label the enchantment is compatible with.
    families: first.compatible.filter(label => FAMILIES.includes(label)),
    incompatibleIds: [...new Set(members.flatMap(m => m.incompatibleIds))],
    description: first.description
  });
}

out.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));


return out;
};
