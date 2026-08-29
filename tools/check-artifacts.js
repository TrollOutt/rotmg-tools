'use strict';
/*
 * Every artifact's effect on every enchantment, ours against the client's.
 *
 *   node tools/check-artifacts.js
 *
 * An artifact is a pool of weight rules. The client states them as a list that
 * each multiply the running weight in turn, and names enchantments either by
 * label or by id. This walks all ~7000 artifact/enchantment pairs and reports
 * any where our final multiplier is not the client's.
 *
 * It reads data/client-snapshot.txt for the artifact -> pool link and the raw
 * client XML for the rules, so run tools/read-client.js first if client-data/
 * is not there (it is not committed — it is a copy of DECA's data, and one
 * command rebuilds it).
 *
 * This is the check that found two real bugs: the rules were being combined by
 * taking the largest match rather than by multiplying, and The Fool's rule was
 * written as the STAT label where the client names eight stat labels instead.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engine = require(path.join(root, 'web', 'engine.js'));
const clientDir = path.join(root, 'client-data');

if (!fs.existsSync(path.join(clientDir, 'EnchantmentLists.xml'))) {
  console.error('\n  client-data/ is missing. Rebuild it with:\n    node tools/read-client.js --save\n');
  process.exit(1);
}

const lists = fs.readFileSync(path.join(clientDir, 'EnchantmentLists.xml'), 'utf8');
const enchXml = fs.readFileSync(path.join(clientDir, 'Enchantments.xml'), 'utf8');
const attr = (text, name) => {
  const match = new RegExp(`${name}="([^"]*)"`).exec(text);
  return match ? match[1] : null;
};

// The client's own display names, which are not always ours: four are its
// typos, and it gives the Alien and Neo forms of two enchantments one name
// apiece. The id is what actually separates them.
const SPELLING = {
  'Mana -Attack Tradeoff': 'Mana -AttackTradeoff',
  "Pirate's Expertise": 'Pirates Expertise',
  'Vampiric Lifeforce': 'Vampric Lifeforce',
  'MP Cost Reduction': 'Mp Cost Reduction',
  'Acid Guardian (Neo)': 'Acid Guardian',
  'Solar Mastery (Neo)': 'Solar Mastery'
};
const ARTIFACT_ALIAS = { 'Premium Silver Tarot Card': 'Premium Silver Card' };

const nameOf = new Map();
for (const m of enchXml.matchAll(/<Enchantment[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Enchantment>/g)) {
  const shown = /<DisplayId>([^<]*)<\/DisplayId>/.exec(m[2]);
  if (shown) nameOf.set(m[1], shown[1].trim());
}

const pools = new Map();
for (const m of lists.matchAll(/<EnchantmentList[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/EnchantmentList>/g)) {
  const rules = [];
  for (const rule of m[2].matchAll(/<ModifyEnchantmentWeight(?:Label)?([^>]*)\/>/g)) {
    const mult = Number(attr(rule[1], 'mult'));
    if (!Number.isFinite(mult)) continue;
    const include = attr(rule[1], 'includeLabelsOR');
    const exclude = attr(rule[1], 'excludeLabelsOR');
    rules.push({
      labels: include ? include.split(',') : null,
      excludes: exclude ? exclude.split(',') : [],
      id: attr(rule[1], 'id'),
      mult
    });
  }
  pools.set(m[1], rules);
}

const poolOf = new Map();
for (const line of fs.readFileSync(path.join(root, 'data', 'client-snapshot.txt'), 'utf8').split(/\r?\n/)) {
  if (line.startsWith('artifact|')) { const parts = line.split('|'); poolOf.set(parts[1], parts[2]); }
}

const MOD_FILES = ['globalMods.txt', 'weaponMods.txt', 'abilityMods.txt', 'armorMods.txt',
  'ringMods.txt', 'alienMods.txt', 'neoAlienMods.txt', 'summonPoweredMods.txt', 'awakenedMods.txt'];
const read = (...parts) => fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
const data = engine.buildDataset({
  modTexts: MOD_FILES.map(file => read('Enchantment documents', file)),
  artifactText: read('Artifacts', 'artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt'),
  awokenExtraText: read('Awakened Items', 'awoken-items.txt')
});

// Tier rules are left out on both sides: they are a share of the enchantment's
// own weight, not a multiplier on all of it, and engine.tierMass covers them.
function clientMultiplier(mod, rules) {
  let out = 1;
  for (const rule of rules) {
    if (rule.labels && rule.labels.every(label => /^TIER[1-4]$/.test(label))) continue;
    let hit = false;
    if (rule.id) {
      hit = nameOf.get(rule.id) === (SPELLING[mod.name] || mod.name) || rule.id === mod.name;
      if (hit && / \(Neo\)$/.test(mod.name) !== /NEO/.test(rule.id)) hit = false;
    } else if (rule.labels) {
      hit = rule.labels.some(label => mod.tags.has(label));
    }
    if (!hit || rule.excludes.some(label => mod.tags.has(label))) continue;
    out *= rule.mult;
  }
  return out;
}

// No second copy of the rule: ask the engine what it actually does.
function ourMultiplier(mod, artifact) {
  const whole = mod.weight * engine.tierMass(mod, artifact);
  return whole > 0 ? engine.weightFor(mod, artifact) / whole : 0;
}

let compared = 0;
const off = [];
for (const artifact of data.artifacts) {
  if (artifact.name === 'No Artifact') continue;
  const rules = pools.get(poolOf.get(ARTIFACT_ALIAS[artifact.name] || artifact.name));
  if (!rules) { off.push(`${artifact.name}: no pool for it in the client`); continue; }
  for (const mod of data.enchants) {
    compared++;
    const ours = ourMultiplier(mod, artifact);
    const theirs = clientMultiplier(mod, rules);
    // Loose, because weightFor truncates to an integer like the game does and
    // a fraction of a unit is not a disagreement about the rule.
    if (Math.abs(ours - theirs) > 1e-3 * Math.max(1, theirs)) {
      off.push(`${artifact.name} / ${mod.name}: ours x${ours}, client x${theirs}`);
    }
  }
}

console.log(`\n  ${compared} artifact/enchantment pairs compared`);
console.log(`  ${off.length} disagreements\n`);
for (const line of off.slice(0, 30)) console.log(`    - ${line}`);
if (off.length > 30) console.log(`    … and ${off.length - 30} more`);
console.log('');
process.exit(off.length ? 1 : 0);
