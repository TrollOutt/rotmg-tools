'use strict';
/*
 * Write data/Artifacts/client-artifacts.txt from an extracted client.
 *
 *   node tools/extract-client.js && node tools/generate-artifacts.js
 *
 * Every artifact the client defines, with the pool it draws from and that
 * pool's rules verbatim. Nothing is selected by hand, which is the point: the
 * file this replaces was inherited, held 24 of the 54 artifacts, and could not
 * express three of the rule forms the client uses at all.
 *
 * Enchantment ids are resolved to display names here rather than in the engine,
 * so nothing downstream has to know that the client writes "Vampric Lifeforce"
 * or gives the Alien and Neo forms of two enchantments the same name.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const IN = path.join(root, 'client-data');
const OUT = path.join(root, 'data', 'Artifacts', 'client-artifacts.txt');

if (!fs.existsSync(path.join(IN, 'EnchantmentLists.xml'))) {
  console.error('\n  client-data/ is missing. Run:  node tools/extract-client.js\n');
  process.exit(1);
}

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
const enchXml = fs.readFileSync(path.join(IN, 'Enchantments.xml'), 'utf8');
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
const listsXml = fs.readFileSync(path.join(IN, 'EnchantmentLists.xml'), 'utf8');
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
for (const file of fs.readdirSync(IN).filter(f => /^Objects\./.test(f))) {
  const xml = fs.readFileSync(path.join(IN, file), 'utf8');
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
const lines = [
  '## Every artifact an installed RotMG client defines, and the rules of the',
  '## pool each one draws from.',
  '##',
  '## Written by tools/generate-artifacts.js. Do not edit by hand: run the',
  '## generator again after a game update and diff the result.',
  '##',
  '## artifact|name|pool|dustType|dustAmount|consumeProb|labels|description',
  '##   entry|includeLabelsOR|excludeLabelsOR      which enchantments the pool holds',
  '##   entry-name|<enchantment>                   one added by name',
  '##   weight|includeLabelsOR|excludeLabelsOR|mult=x or increment=n',
  '##   weight-name|<enchantment>|mult=x or increment=n',
  '##',
  '## Weight rules compound: each multiplies what the last one left.',
  ''
];

/*
 * Four of the 54 are not artifacts a player uses in the enchanter, and the
 * client says which: an artifact carries the ARTIFACT item label. Three are
 * developer test items — Awakened, Tier 4 and Unique Test Artifact — and the
 * fourth is Night Prince Engraving, whose own description says it "can be used
 * as an Artifact" but which the game does not label as one.
 *
 * All four cost nothing and are never consumed, so ranking them puts a free,
 * strictly better artifact at the top of every table. Night Prince also carries
 * a x999 on UNIQUE and a x9999 on AWAKENED, which made it the answer to every
 * question a player could ask.
 */
const playable = [...artifacts.values()].filter(a => a.labels.includes('ARTIFACT'));
const dropped = [...artifacts.values()].filter(a => !a.labels.includes('ARTIFACT'));
const sorted = playable.sort((a, b) => a.name.localeCompare(b.name));
let ruleCount = 0;
let unknown = 0;
for (const artifact of sorted) {
  lines.push(['artifact', artifact.name, artifact.pool, artifact.dustType,
    artifact.dustAmount, artifact.consumeProb, artifact.labels.join(','), artifact.description].join('|'));
  for (const rule of pools.get(artifact.pool) || []) {
    lines.push('  ' + rule);
    ruleCount++;
    if (rule.startsWith('unknown|')) unknown++;
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

console.log('\n  ' + sorted.length + ' artifacts, ' + ruleCount + ' rules -> ' + path.relative(root, OUT));
if (dropped.length) {
  console.log('  ' + dropped.length + ' artifacts the client does not label ARTIFACT, left out: '
    + dropped.map(a => a.name).join(', '));
}
const poolless = sorted.filter(a => !pools.has(a.pool));
if (poolless.length) {
  console.log('  ' + poolless.length + ' name a pool the client does not define: '
    + poolless.map(a => a.name).join(', '));
}
if (unknown) console.log('  ' + unknown + ' rules in a form this does not understand, marked "unknown" in the file');
console.log('');
