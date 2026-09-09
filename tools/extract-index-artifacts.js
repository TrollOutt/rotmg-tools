'use strict';
// Extraction moved from generate-artifacts.js; source text is supplied by build-index.
module.exports = function(documents) {
const attr = (text, name) => {
  const match = new RegExp(name + '="([^"]*)"').exec(text);
  return match ? match[1] : null;
};
const tag = (text, name) => {
  const match = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(text);
  return match ? match[1].trim() : null;
};
const APOSTROPHE = String.fromCharCode(38, 97, 112, 111, 115, 59);   // &apos;
const unescapeXml = text => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .split(APOSTROPHE).join(String.fromCharCode(39))
  .replace(/&amp;/g, '&');

/* ---------------------------------------------------------------- *
 * 1. Enchantment id -> the name a player sees                       *
 * ---------------------------------------------------------------- */
const enchXml = documents.get('Enchantments.xml');
const nameOf = new Map();
const labelsOf = new Map();
for (const m of enchXml.matchAll(/<Enchantment[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Enchantment>/g)) {
  nameOf.set(m[1], unescapeXml(tag(m[2], 'DisplayId') || m[1]));
  labelsOf.set(m[1], (tag(m[2], 'EnchantmentLabels') || '').split(',').filter(Boolean));
}
const timesNamed = new Map();
for (const shown of nameOf.values()) timesNamed.set(shown, (timesNamed.get(shown) || 0) + 1);

/*
 * Four display names in the client are typos — a missing space, a missing
 * apostrophe, a dropped letter, a lowercase initialism. They are corrected
 * here, at the one place names cross from the client into our data, so nothing
 * downstream has to know about them. Getting this wrong is not cosmetic: a
 * rule that names an enchantment we spell differently simply never matches,
 * and The Sun's x15 on Pirate's Expertise quietly stops applying.
 */
const TYPOS = {
  'Mana -AttackTradeoff': 'Mana -Attack Tradeoff',
  'Pirates Expertise': "Pirate's Expertise",
  'Vampric Lifeforce': 'Vampiric Lifeforce',
  'Mp Cost Reduction': 'MP Cost Reduction'
};

// The client gives the Alien and the Neo Alien form of two enchantments the
// same display name. We separate them; the id is what tells them apart.
function resolvedName(id) {
  const shown = nameOf.get(id);
  if (!shown) return null;
  const labels = labelsOf.get(id) || [];
  const fixed = TYPOS[shown] || shown;
  if (labels.includes('NEO_ALIEN') && timesNamed.get(shown) > 1) return fixed + ' (Neo)';
  return fixed;
}

/* ---------------------------------------------------------------- *
 * 2. The pools and their rules                                      *
 * ---------------------------------------------------------------- */
const listsXml = documents.get('EnchantmentLists.xml');
const pools = new Map();
for (const m of listsXml.matchAll(/<EnchantmentList[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/EnchantmentList>/g)) {
  const rules = [];
  for (const r of m[2].matchAll(/<(\w+)([^>]*)\/>/g)) {
    const kind = r[1];
    const body = r[2];
    const include = attr(body, 'includeLabelsOR');
    const exclude = attr(body, 'excludeLabelsOR');
    const id = attr(body, 'id');
    const mult = attr(body, 'mult');
    const increment = attr(body, 'increment');
    const amount = mult !== null ? 'mult=' + mult : 'increment=' + increment;
    if (kind === 'EnchantmentEntryLabel') {
      rules.push(['entry', include || '', exclude || ''].join('|'));
    } else if (kind === 'EnchantmentEntry' && id) {
      rules.push(['entry-name', resolvedName(id) || id].join('|'));
    } else if (kind === 'ModifyEnchantmentWeightLabel') {
      rules.push(['weight', include || '', exclude || '', amount].join('|'));
    } else if (kind === 'ModifyEnchantmentWeight' && id) {
      rules.push(['weight-name', resolvedName(id) || id, amount].join('|'));
    } else {
      rules.push(['unknown', kind, body.trim()].join('|'));
    }
  }
  pools.set(m[1], rules);
}

/* ---------------------------------------------------------------- *
 * 3. The artifacts themselves, from the object definitions          *
 * ---------------------------------------------------------------- */
const artifacts = new Map();
for (const file of [...documents.keys()].filter(f => /^Objects\./.test(f))) {
  const xml = documents.get(file);
  for (const m of xml.matchAll(/<Object[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Object>/g)) {
    const body = m[2];
    const artifact = /<Artifact\b([^>]*)\/>/.exec(body);
    if (!artifact) continue;
    const name = unescapeXml(tag(body, 'DisplayId') || m[1]);
    // The same artifact exists as x1, x2, x5 stacks; they are one artifact.
    if (artifacts.has(name)) continue;
    artifacts.set(name, {
      name,
      pool: attr(artifact[1], 'list') || '',
      consumeProb: Number(attr(artifact[1], 'consumeProb')),
      dustType: attr(artifact[1], 'dustType') || 'na',
      dustAmount: Number(attr(artifact[1], 'dustAmount')) || 0,
      labels: (tag(body, 'Labels') || '').split(',').filter(Boolean),
      description: unescapeXml(tag(body, 'Description') || '').replace(/\s+/g, ' ')
    });
  }
}

/* ---------------------------------------------------------------- *
 * 4. Write it                                                       *
 * ---------------------------------------------------------------- */
const playable = [...artifacts.values()].filter(a => a.labels.includes('ARTIFACT'));
const dropped = [...artifacts.values()].filter(a => !a.labels.includes('ARTIFACT'));
const sorted = playable.sort((a, b) => a.name.localeCompare(b.name));

return { artifacts: sorted, pools: Object.fromEntries(pools) };
};
