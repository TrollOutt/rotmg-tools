'use strict';
/*
 * Every artifact's effect on every enchantment, ours against the client's.
 *
 *   node tools/check-artifacts.js          (also runs as part of npm test)
 *
 * An artifact is a pool of weight rules. The client states them as a list that
 * each multiply the running weight in turn, and names enchantments either by
 * label or by id. This walks all ~7000 artifact/enchantment pairs and reports
 * any where our final multiplier is not the client's.
 *
 * It reads data/client-snapshot.txt and nothing else, deliberately. The first
 * version of this check read the raw client XML, which is not committed — so it
 * could only run on a machine with the game installed, and in practice it never
 * ran again. That is how two bugs survived a "the client is the authority"
 * pass: the values had been compared, the way the rules combine never had. The
 * snapshot carries every pool rule verbatim and maps each enchantment id to its
 * name, which is everything this needs.
 *
 * That the rules multiply rather than compete is the client's own design, not a
 * reading of it. The Freezing Core pool bars SPEED,DEXTERITY,BERSERK,
 * WEAPONFIRERATE at x0 and lifts DEFENSE,DAMAGERESISTANCE,ARMORED to x4, and
 * nine enchantments carry a label from each list. Multiplying, they stay
 * barred. Taking the largest match, they would come back at four times their
 * weight — which would leave that card no way to bar anything at all.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engine = require(path.join(root, 'web', 'engine.js'));

const snapshot = fs.readFileSync(path.join(root, 'data', 'client-snapshot.txt'), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('##'));

// The client's own display names, which are not always ours: four are its
// typos, and it gives the Alien and Neo forms of two enchantments one name
// apiece. The id is what actually separates those.
const SPELLING = {
  'Mana -Attack Tradeoff': 'Mana -AttackTradeoff',
  "Pirate's Expertise": 'Pirates Expertise',
  'Vampiric Lifeforce': 'Vampric Lifeforce',
  'MP Cost Reduction': 'Mp Cost Reduction',
  'Acid Guardian (Neo)': 'Acid Guardian',
  'Solar Mastery (Neo)': 'Solar Mastery'
};

// The rule is the client's own attribute list, kept verbatim in the snapshot:
// "ModifyEnchantmentWeightLabel includeLabelsOR=A,B excludeLabelsOR=C mult=2".
// Split it into key=value pairs rather than matching each key with a regex:
// there is no escaping to get wrong, and an unknown attribute simply lands in
// the map instead of being silently dropped.
function attributes(rule) {
  const out = new Map();
  for (const piece of rule.split(' ')) {
    const at = piece.indexOf('=');
    if (at > 0) out.set(piece.slice(0, at), piece.slice(at + 1));
  }
  return out;
}

// ench|<id>|<name>|…
const nameOf = new Map();
for (const line of snapshot) {
  if (!line.startsWith('ench|')) continue;
  const parts = line.split('|');
  nameOf.set(parts[1], parts[2]);
}

// artifact|<name>|<pool>|…
const poolOf = new Map();
for (const line of snapshot) {
  if (!line.startsWith('artifact|')) continue;
  const parts = line.split('|');
  poolOf.set(parts[1], parts[2]);
}

// pool|<name> #n|<rule, as the client wrote it>
const pools = new Map();
for (const line of snapshot) {
  if (!line.startsWith('pool|')) continue;
  const parts = line.split('|');
  const pool = parts[1].replace(/ #\d+$/, '');
  const rule = parts.slice(2).join('|');
  const fields = attributes(rule);
  const include = fields.get('includeLabelsOR');
  const exclude = fields.get('excludeLabelsOR');
  if (!pools.has(pool)) pools.set(pool, []);

  // An entry rule that excludes TIER1..3 says the same thing as a weight rule
  // that multiplies them by zero: only tier 4 of a tiered enchantment is in
  // play. Night Prince Engraving states it the first way and every other
  // artifact the second, so both are read as tier multipliers here — the
  // engine unifies them the same way.
  if (/^EnchantmentEntryLabel/.test(rule)) {
    for (const label of (exclude || '').split(',').filter(Boolean)) {
      if (/^TIER[1-4]$/.test(label)) pools.get(pool).push({ labels: [label], excludes: [], id: null, mult: 0 });
    }
    continue;
  }
  if (!/^ModifyEnchantmentWeight/.test(rule)) continue;
  const mult = fields.has('mult') ? Number(fields.get('mult')) : null;
  const increment = fields.has('increment') ? Number(fields.get('increment')) : null;
  if (mult === null && increment === null) continue;
  pools.get(pool).push({
    labels: include ? include.split(',') : null,
    excludes: exclude ? exclude.split(',') : [],
    id: fields.get('id') || null,
    mult, increment
  });
}

const read = (...parts) => fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
const data = engine.buildDataset({
  clientModText: read('Enchantment documents', 'client-enchantments.txt'),
  clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt'),
  awokenExtraText: read('Awakened Items', 'awoken-items.txt')
});

// Tier rules are left out on both sides: they are a share of the enchantment's
// own weight rather than a multiplier on all of it, and engine.tierMass has
// them. tools/read-client.js is what checks those.
function clientWeight(mod, rules, artifact) {
  let weight = mod.weight * engine.tierMass(mod, artifact);
  for (const rule of rules) {
    if (rule.labels && rule.labels.every(label => /^TIER[1-4]$/.test(label))) continue;
    let hit = false;
    if (rule.id) {
      hit = nameOf.get(rule.id) === (SPELLING[mod.name] || mod.name) || rule.id === mod.name;
      if (hit && / (Neo)$/.test(mod.name) !== /NEO/.test(rule.id)) hit = false;
    } else if (rule.labels) {
      hit = rule.labels.some(label => mod.tags.has(label));
    }
    if (!hit || rule.excludes.some(label => mod.tags.has(label))) continue;
    if (rule.increment !== null && rule.increment !== undefined) weight += rule.increment;
    else weight *= rule.mult;
  }
  return Math.trunc(weight);
}

let compared = 0;
const off = [];
for (const artifact of data.artifacts) {
  if (artifact.name === 'No Artifact') continue;
  const rules = pools.get(poolOf.get(artifact.name));
  if (!rules) { off.push(`${artifact.name}: the client has no pool by that name`); continue; }
  for (const mod of data.enchants) {
    compared++;
    // Absolute weights, not ratios: 34 enchantments carry a weight of zero —
    // Crown and the legacy ones — and a ratio against zero says nothing.
    const ours = engine.weightFor(mod, artifact);
    const theirs = clientWeight(mod, rules, artifact);
    if (Math.abs(ours - theirs) > 1) {
      off.push(`${artifact.name} / ${mod.name}: ours ${ours}, client ${theirs}`);
    }
  }
}

console.log(`\n  ${compared} artifact/enchantment pairs against the recorded client`);
console.log(`  ${off.length} disagreements\n`);
for (const line of off.slice(0, 30)) console.log(`    - ${line}`);
if (off.length > 30) console.log(`    … and ${off.length - 30} more`);
console.log('');

/*
 * And the tier rules, which the loop above skips.
 *
 * They are skipped there because they are a share of a tiered enchantment's own
 * weight rather than a multiplier on all of it — but skipping them everywhere
 * is exactly how Premium Silver kept a missing TIER2 x2.166 line, which left
 * every tiered enchantment at 65 % of its weight under that card. So they are
 * compared here, the same way: what the client's rules leave, against what
 * engine.tierMass says.
 */
function clientTierMass(mod, rules) {
  if (!mod.tags.has('TIERED') || !mod.distribution.length) return 1;
  let total = 0;
  for (let index = 0; index < mod.distribution.length; index++) {
    const label = `TIER${index + 1}`;
    let share = mod.distribution[index] || 0;
    for (const rule of rules) {
      if (rule.labels && rule.labels.includes(label)) share *= rule.mult;
    }
    total += share;
  }
  return total;
}

let tiersCompared = 0;
const tiersOff = [];
for (const artifact of data.artifacts) {
  if (artifact.name === 'No Artifact') continue;
  const rules = pools.get(poolOf.get(artifact.name));
  if (!rules) continue;
  for (const mod of data.enchants) {
    if (!mod.tags.has('TIERED') || !mod.distribution.length) continue;
    tiersCompared++;
    const ours = engine.tierMass(mod, artifact);
    const theirs = clientTierMass(mod, rules);
    if (Math.abs(ours - theirs) > 1e-3) {
      tiersOff.push(`${artifact.name} / ${mod.name}: ours ${ours.toFixed(5)}, client ${theirs.toFixed(5)}`);
    }
  }
}

console.log(`  ${tiersCompared} of those pairs are tiered, and their tier mass is checked too`);
console.log(`  ${tiersOff.length} disagreements\n`);
for (const line of tiersOff.slice(0, 20)) console.log(`    - ${line}`);
if (tiersOff.length > 20) console.log(`    … and ${tiersOff.length - 20} more`);
console.log('');
process.exit(off.length || tiersOff.length ? 1 : 0);
