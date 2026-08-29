/*
 * Checks our enchantment data against DECA's own published list.
 *
 *   node tools/fetch-deca.js            report only
 *   node tools/fetch-deca.js --freeze   also refresh tools/deca-weights.txt
 *
 * Why this exists. The enchantment weights, labels and incompatibilities come
 * from a snapshot of the original Qt program, and a snapshot goes stale the
 * moment DECA changes anything. DECA publishes the "Equipment Rarity Public
 * List" as a Google Sheet, which is readable as CSV without an API key, and it
 * is the game's publisher rather than a community reading of it.
 *
 * It found three real faults on its first run:
 *   - eight "Relative X Bonus" enchantments carried weight 50000 where DECA
 *     publishes tiers totalling 52000, on a different split;
 *   - "Vitality to Attack Bonus" was missing its item-types line, so it parsed
 *     one field short and was rollable on no item type at all;
 *   - and it independently confirmed the Jester's Trick correction.
 *
 * Tiered enchantments are one row per tier in the sheet ("Attack Bonus I") and
 * a single record with a weight and a distribution in ours, so the two are
 * compared by summing the tiers and taking their proportions.
 *
 * The frozen copy exists so the test suite can make the same comparison with
 * no network access.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const engine = require(path.join(root, 'web', 'engine.js'));
const outFile = path.join(root, 'tools', 'deca-weights.txt');

const SHEET = '1lZRkY3kr0IFD6vKqfMqF56LlSy7rtNzf-w2JxBVAs9k';
const TABS = ['Enchantment List', 'Public Testing Enchantment List'];
const url = tab => `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

function get(target) {
  return new Promise((resolve, reject) => {
    https.get(target, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rotmg-enchant-calculator)' } }, response => {
      if ([301, 302, 307].includes(response.statusCode)) {
        response.resume();
        return get(new URL(response.headers.location, target).href).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    }).on('error', reject);
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/*
 * A tiered enchantment is four rows in the sheet, each carrying its own TIER1
 * to TIER4 label, against one record here carrying TIERED. That is a
 * difference in how the two describe the same thing, not a disagreement, so
 * the tier labels are left out of the comparison.
 */
const withoutTierLabels = list => list.filter(label => !/^TIER([1-4]|ED)$/.test(label));

const norm = value => String(value || '').toLowerCase()
  .replace(/[‘’ʼ]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

async function readSheet() {
  const rows = new Map();                 // normalised name -> { name, weight, labels, incompatible }
  for (const tab of TABS) {
    const table = parseCsv(await get(url(tab)));
    const head = table[0];
    const at = name => head.indexOf(name);
    const columns = {
      name: at('EnchantmentName'), weight: at('Weight'),
      labels: at('EnchantmentLabels'), incompatible: at('IncompatibleEnchantmentLabels')
    };
    for (const row of table.slice(1)) {
      const name = (row[columns.name] || '').trim();
      // Rows with no labels are the sheet's own group totals, not enchantments.
      if (!name || !(row[columns.labels] || '').trim()) continue;
      const key = norm(name);
      if (rows.has(key)) continue;
      rows.set(key, {
        name,
        weight: Number(row[columns.weight]) || 0,
        labels: withoutTierLabels((row[columns.labels] || '').split(',').map(s => s.trim()).filter(Boolean)).sort().join(','),
        incompatible: (row[columns.incompatible] || '').split(',').map(s => s.trim()).filter(Boolean).sort().join(',')
      });
    }
    console.log(`  ${tab.padEnd(34)} ${table.length - 1} rows`);
  }
  return rows;
}

function ourDataset() {
  const read = (...parts) => fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
  return engine.buildDataset({
    clientModText: read('Enchantment documents', 'client-enchantments.txt'),
    clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
    awakenText: read('Awakened Items', 'awakenedItems.txt'),
    awokenExtraText: read('Awakened Items', 'awoken-items.txt')
  });
}

const ROMAN = ['i', 'ii', 'iii', 'iv'];

// What the sheet says a record of ours should weigh, and how its tiers split.
function expectedFor(mod, sheet) {
  const direct = sheet.get(norm(mod.name));
  if (direct) return { weight: direct.weight, distribution: null, row: direct };
  const tiers = ROMAN.map(tier => sheet.get(`${norm(mod.name)} ${tier}`));
  if (tiers.some(tier => !tier)) return null;
  const total = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  return { weight: total, distribution: tiers.map(tier => tier.weight / total), row: tiers[0], tiers };
}

async function main() {
  console.log(`\n  reading DECA's Equipment Rarity Public List`);
  const sheet = await readSheet();
  const data = ourDataset();

  let compared = 0, agree = 0;
  const problems = [];
  const frozen = [];

  for (const mod of data.enchants) {
    const expected = expectedFor(mod, sheet);
    if (!expected) continue;
    compared++;

    const faults = [];
    if (expected.weight !== mod.weight) faults.push(`weight ${mod.weight} vs ${expected.weight}`);
    if (expected.distribution) {
      const ours = mod.distribution;
      const off = expected.distribution.some((share, index) => Math.abs(share - (ours[index] || 0)) > 0.0005);
      if (off) faults.push(`tiers ${ours.join('/')} vs ${expected.distribution.map(s => s.toFixed(5)).join('/')}`);
    }
    const labels = withoutTierLabels([...mod.tags]).sort().join(',');
    if (expected.row.labels && expected.row.labels !== labels) faults.push(`labels ${labels} vs ${expected.row.labels}`);
    const incompatible = [...mod.excludes].sort().join(',');
    if (expected.row.incompatible && expected.row.incompatible !== incompatible) {
      faults.push(`incompatible ${incompatible || '-'} vs ${expected.row.incompatible}`);
    }

    if (faults.length) problems.push(`${mod.name}: ${faults.join(' | ')}`);
    else agree++;

    frozen.push([mod.name, expected.weight,
      expected.distribution ? expected.distribution.map(s => s.toFixed(5)).join(' ') : '',
      expected.row.labels, expected.row.incompatible].join('|'));
  }

  console.log(`\n  ${data.enchants.length} enchantments here, ${compared} of them in the sheet`);
  console.log(`  agreeing on weight, tier split, labels and incompatibilities: ${agree}`);
  console.log(`  disagreeing: ${problems.length}`);
  for (const line of problems) console.log(`    - ${line}`);

  if (process.argv.includes('--freeze')) {
    const header = `## DECA's published weights, tier splits, labels and incompatibilities,
## for every enchantment this program also holds.
##
## Source: the "Equipment Rarity Public List" spreadsheet, read as CSV.
##   https://docs.google.com/spreadsheets/d/${SHEET}
##
## Refresh with: node tools/fetch-deca.js --freeze
## The test suite compares against this copy, so it needs no network.
##
## A tiered enchantment is four rows in the sheet and one record here; the
## weight below is the sum of its tiers and the split their proportions.
##
## Format: Name|Weight|TierSplit|Labels|IncompatibleLabels
`;
    fs.writeFileSync(outFile, `${header}\n${frozen.sort().join('\n')}\n`, 'utf8');
    console.log(`\n  ${frozen.length} rows -> ${path.relative(root, outFile)}`);
  } else {
    console.log('\n  (run with --freeze to refresh tools/deca-weights.txt)');
  }
  console.log('');
  if (problems.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exit(1); });
