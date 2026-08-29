/*
 * Rebuilds the item → Awoken enchantment mapping from the RotMG wiki.
 *
 *   node tools/fetch-awoken.js
 *
 * Why this exists. The Qt program ships "Awakened Items/awakenedItems.txt",
 * which names some entries after a *group* rather than an item: "AoO Rings",
 * "Matrix Armors", "Tomb Rings", "LoD Armors", "Beehemoth Armors". The
 * interface looks an item up by its own name, so every real item behind one of
 * those group names was offered no Awoken enchantment at all — 10 of the 49
 * entries, covering most of the Agents of Oryx and Protective Matrix gear.
 *
 * The "Awakened Enchantments" table at the bottom of /wiki/enchanting lists
 * every enchantment against the actual items that can roll it, which is the
 * mapping the interface needs. It is read once and frozen into
 * data/Awakened Items/awoken-items.txt, so a build needs no network access.
 *
 * The result is merged with the original file rather than replacing it: a pair
 * the Qt data knows and the page does not is kept, because the page being
 * silent about something is not the same as the something being wrong.
 *
 * Output: data/Awakened Items/awoken-items.txt   (Item|Enchantment per line)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const engine = require(path.join(root, 'web', 'engine.js'));
const outFile = path.join(root, 'data', 'Awakened Items', 'awoken-items.txt');
const PAGE = 'https://www.realmeye.com/wiki/enchanting';
const UA = 'Mozilla/5.0 (compatible; rotmg-enchant-calculator build script)';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, response => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        response.resume();
        return get(new URL(response.headers.location, url).href).then(resolve, reject);
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

const decode = text => String(text)
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .trim();

// The wiki writes curly apostrophes and en dashes; the Qt files write plain
// ones. Compare on a form that ignores the difference.
const norm = value => decode(value).toLowerCase()
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ').trim();

function parseTable(html) {
  const start = html.indexOf('<h3 id="awakened">');
  if (start < 0) throw new Error('the "Awakened Enchantments" section is no longer on the page');
  const after = html.slice(start);
  const end = after.search(/<h[23] /);
  const section = end > 0 ? after.slice(0, end) : after;

  const rows = [];
  for (const row of section.split(/<tr[^>]*>/).slice(1)) {
    const cells = row.split(/<td[^>]*>/).slice(1).map(cell => cell.split('</td>')[0]);
    if (cells.length < 3) continue;
    const enchant = decode(cells[1].replace(/<[^>]*>/g, ''));
    // Each eligible item is an <img alt="Item Name"> inside a link.
    const items = [...cells[2].matchAll(/<img[^>]*\salt="([^"]*)"/g)].map(match => decode(match[1]));
    if (enchant && items.length) rows.push({ enchant, items });
  }
  return rows;
}

async function main() {
  const MOD_FILES = ['globalMods.txt', 'weaponMods.txt', 'abilityMods.txt', 'armorMods.txt',
    'ringMods.txt', 'alienMods.txt', 'neoAlienMods.txt', 'summonPoweredMods.txt', 'awakenedMods.txt'];
  const readData = (...parts) => fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
  const data = engine.buildDataset({
    modTexts: MOD_FILES.map(file => readData('Enchantment documents', file)),
    clientArtifactText: readData('Artifacts', 'client-artifacts.txt'),
    awakenText: readData('Awakened Items', 'awakenedItems.txt')
  });
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'web', 'item-catalog.json'), 'utf8')).items;
  const catalogByNorm = new Map(Object.keys(catalog).map(name => [norm(name), name]));
  const modByNorm = new Map(data.enchants.map(mod => [norm(mod.name), mod.name]));

  console.log(`\n  reading ${PAGE}`);
  const rows = parseTable(await get(PAGE));
  console.log(`  ${rows.length} rows in the Awakened Enchantments table`);

  const mapping = new Map();           // item -> Set of enchantment names
  const add = (item, mod) => {
    if (!mapping.has(item)) mapping.set(item, new Set());
    mapping.get(item).add(mod);
  };

  const missingMods = new Set();
  const missingItems = new Set();

  for (const { enchant, items } of rows) {
    const base = modByNorm.get(norm(enchant));
    if (!base) { missingMods.add(enchant); continue; }
    for (const raw of items) {
      const item = catalogByNorm.get(norm(raw));
      if (!item) { missingItems.add(raw); continue; }
      /*
       * The page gives the Neo variant of an item the same enchantment name as
       * the ordinary one; the Qt data separates them, "Acid Guardian" and
       * "Acid Guardian (Neo)", with different weights. Follow the data.
       */
      const neo = modByNorm.get(norm(`${base} (Neo)`));
      add(item, /^neo\s/i.test(item) && neo ? neo : base);
    }
  }

  // Keep what the Qt file already knew about real items: the page being silent
  // is not evidence against it.
  let kept = 0;
  for (const [item, mods] of data.awakenings) {
    if (!catalog[item]) continue;      // a group name; the page replaces those
    for (const mod of mods) {
      const before = (mapping.get(item) || new Set()).size;
      add(item, mod);
      if ((mapping.get(item) || new Set()).size > before) kept++;
    }
  }

  const lines = [];
  for (const item of [...mapping.keys()].sort((a, b) => a.localeCompare(b))) {
    for (const mod of [...mapping.get(item)].sort((a, b) => a.localeCompare(b))) lines.push(`${item}|${mod}`);
  }

  const header = `## Which items can roll which Awoken enchantment.
##
## Generated by tools/fetch-awoken.js from the "Awakened Enchantments" table at
## ${PAGE}
##
## The Qt program's own awakenedItems.txt names ten of its entries after a
## group rather than an item -- "AoO Rings", "Matrix Armors", "Tomb Rings" --
## and the interface looks items up by their own name, so every real item
## behind one of those was offered nothing. This file names them.
##
## Merged with awakenedItems.txt rather than replacing it: pairs the Qt data
## knows and the page does not are kept.
##
## Format: Item|Enchantment
`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${header}\n${lines.join('\n')}\n`, 'utf8');

  console.log(`\n  ${lines.length} item/enchantment pairs -> ${path.relative(root, outFile)}`);
  console.log(`  ${mapping.size} distinct items, ${kept} pairs carried over from awakenedItems.txt`);
  if (missingMods.size) {
    console.log(`\n  ${missingMods.size} enchantment(s) on the page with no record in the mod files:`);
    for (const name of missingMods) console.log(`    - ${name}`);
    console.log('    (newer than the Qt snapshot: no weight or labels, so nothing to add)');
  }
  if (missingItems.size) {
    console.log(`\n  ${missingItems.size} item(s) on the page missing from web/item-catalog.json:`);
    for (const name of missingItems) console.log(`    - ${name}`);
  }
  console.log('');
}

main().catch(error => { console.error(error); process.exit(1); });
