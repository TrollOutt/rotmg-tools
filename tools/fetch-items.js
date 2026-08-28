/*
 * Builds the item catalogue from the RotMG wiki, in one reproducible pass.
 *
 *   node tools/fetch-items.js            catalogue only
 *   node tools/fetch-items.js --sprites  catalogue + download every sprite
 *
 * Five pages are read, no more: the four equipment indexes, which list every
 * item with its sprite and (for tiered gear) its tier, and the enchanting page,
 * whose reroll tables say which dust an item is billed in.
 *
 *   https://www.realmeye.com/wiki/weapons
 *   https://www.realmeye.com/wiki/ability-items
 *   https://www.realmeye.com/wiki/armor
 *   https://www.realmeye.com/wiki/rings
 *   https://www.realmeye.com/wiki/enchanting
 *
 * Dust is resolved in this order:
 *   1. read from the item's own wiki page (tools/item-dust.txt);
 *   2. otherwise named in the enchanting reroll tables;
 *   3. otherwise derived from the item's tier through the published bands;
 *   4. otherwise left unknown — almost always a T0 starter item, which
 *      cannot be enchanted at all — and the interface asks for it.
 *
 * Output: web/item-catalog.json, plus web/assets/items/ with --sprites.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const outCatalog = path.join(root, 'web', 'item-catalog.json');
const spriteDir = path.join(root, 'web', 'assets', 'items');
const HOST = 'https://www.realmeye.com';
const IMG_PREFIX = '/s/a/img/wiki/i/';

const PAGES = [
  { url: '/wiki/weapons', slot: 'WEAPON' },
  { url: '/wiki/ability-items', slot: 'ABILITY' },
  { url: '/wiki/armor', slot: 'ARMOR' },
  { url: '/wiki/rings', slot: 'RING' }
];

// Published reroll bands: tier -> dust, per slot.
const BANDS = {
  WEAPON: { Green: [1, 9], Red: [10, 12], Purple: [13, 14] },
  ABILITY: { Green: [1, 4], Red: [5, 6], Purple: [7, 7] },
  ARMOR: { Green: [1, 9], Red: [10, 12], Purple: [13, 14] },
  RING: { Green: [1, 4], Red: [5, 6], Purple: [7, 7] }
};
function dustForTier(slot, tier) {
  const bands = BANDS[slot];
  if (!bands || tier === undefined || tier === null) return null;
  for (const [dust, [low, high]] of Object.entries(bands)) if (tier >= low && tier <= high) return dust;
  return null;
}

const UA = 'Mozilla/5.0 (compatible; rotmg-enchant-calculator build script)';
function get(url, binary) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        return get(new URL(response.headers.location, url).href, binary).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`HTTP ${response.statusCode} for ${url}`)); }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    }).on('error', reject);
  });
}

const decode = text => String(text)
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .trim();

/*
 * Tier extraction.
 *
 * The "Tier N" caption sits *after* the sprites it labels in the markup, not
 * before: on the weapons page, Darksteel Tachi (really T9) appears ahead of the
 * "Tier 9" text while Bow of Fey Magic (T10) follows it. Reading the label as a
 * heading for what comes next shifts every tiered item down by one and puts the
 * boundary items in the wrong dust band.
 *
 * So sprites are buffered and the caption closes the group behind it. A real
 * heading discards the buffer, because it starts an untiered section.
 *
 * Verified against the items' own pages: Darksteel Tachi 9, Bow of Fey Magic 10,
 * Hippogriff Hide Armor 10, Cloak of Endless Twilight 5, Ring of Exalted
 * Attack 5.
 */
function parseItems(html, slot) {
  const found = {};
  const token = /<h[1-6][^>]*>|Tier\s+(\d+)|<img\b[^>]*>/gi;
  let pending = [];
  let match;
  const remember = (name, file, tier) => {
    if (found[name]) return;
    const entry = { s: slot, f: file };
    if (tier !== null && tier !== undefined) entry.t = tier;
    found[name] = entry;
  };
  while ((match = token.exec(html))) {
    const text = match[0];
    if (/^<h[1-6]/i.test(text)) {
      for (const item of pending) remember(item.name, item.file, null);
      pending = [];
      continue;
    }
    if (match[1] !== undefined) {
      const tier = +match[1];
      for (const item of pending) remember(item.name, item.file, tier);
      pending = [];
      continue;
    }
    const src = (text.match(/\ssrc="([^"]+)"/i) || [])[1];
    const title = (text.match(/\stitle="([^"]*)"/i) || [])[1];
    if (!src || !title || !src.startsWith(IMG_PREFIX)) continue;
    const name = decode(title);
    if (!name || found[name]) continue;
    pending.push({ name, file: src.slice(IMG_PREFIX.length) });
  }
  for (const item of pending) remember(item.name, item.file, null);
  return found;
}

/*
 * The enchanting page's reroll tables: which dust each named item uses.
 *
 * The dust cell carries a rowspan over its whole group, so it only appears in
 * the group's first row. Reading rows in order and remembering the last dust
 * seen reproduces that span; the memory resets at each table.
 */
function parseDust(html) {
  const dust = {};
  for (const table of html.split(/<table\b/i).slice(1)) {
    let colour = null;
    for (const row of table.split(/<tr\b/i).slice(1)) {
      const declared = (row.match(/title="(Green|Red|Purple) Dust"/i) || [])[1];
      if (declared) colour = declared;
      if (!colour) continue;
      for (const image of row.match(/<img\b[^>]*>/gi) || []) {
        const src = (image.match(/\ssrc="([^"]+)"/i) || [])[1] || '';
        const title = (image.match(/\stitle="([^"]*)"/i) || [])[1];
        if (!src.startsWith(IMG_PREFIX) || !title) continue;
        const name = decode(title);
        if (/\bDust\b/.test(name) || /^Tier \d+/.test(name)) continue;
        if (!dust[name]) dust[name] = colour;
      }
    }
  }
  return dust;
}

// Which slot a reroll table belongs to, from the heading above it.
function parseSlots(html) {
  const slots = {};
  const headings = { Weapons: 'WEAPON', Abilities: 'ABILITY', Armors: 'ARMOR', Rings: 'RING' };
  for (const table of html.split(/<table\b/i).slice(1)) {
    const header = (table.match(/<th\b[^>]*>\s*(Weapons|Abilities|Armors|Rings)\s*</i) || [])[1];
    if (!header) continue;
    const slot = headings[header];
    for (const image of table.match(/<img\b[^>]*>/gi) || []) {
      const src = (image.match(/\ssrc="([^"]+)"/i) || [])[1] || '';
      const title = (image.match(/\stitle="([^"]*)"/i) || [])[1];
      if (!src.startsWith(IMG_PREFIX) || !title) continue;
      const name = decode(title);
      if (/\bDust\b/.test(name) || /^Tier \d+/.test(name)) continue;
      if (!slots[name]) slots[name] = slot;
    }
  }
  return slots;
}

function spriteFor(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, '&#39;');
  const pattern = new RegExp(`<img\\b[^>]*title="(?:${escaped}|${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})"[^>]*>`, 'i');
  const tag = (html.match(pattern) || [])[0];
  if (!tag) return null;
  const src = (tag.match(/\ssrc="([^"]+)"/i) || [])[1] || '';
  return src.startsWith(IMG_PREFIX) ? src.slice(IMG_PREFIX.length) : null;
}

const slugify = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  const wantSprites = process.argv.includes('--sprites');
  const items = {};
  const perSlot = {};

  for (const page of PAGES) {
    const html = await get(HOST + page.url);
    const found = parseItems(html, page.slot);
    let added = 0;
    for (const [name, entry] of Object.entries(found)) if (!items[name]) { items[name] = entry; added++; }
    perSlot[page.slot] = added;
    console.log(`  ${page.url.padEnd(22)} ${String(added).padStart(4)} items`);
  }

  const enchanting = await get(HOST + '/wiki/enchanting');
  const explicitDust = parseDust(enchanting);
  console.log(`  /wiki/enchanting       ${String(Object.keys(explicitDust).length).padStart(4)} items with a named dust`);

  /*
   * Dust read from each item's own page, collected once through a browser and
   * frozen in tools/item-dust.txt (the item pages sit behind an interstitial a
   * plain HTTP client cannot pass). It is the most complete and most direct
   * source, so it wins; the reroll tables and the tier bands fill the rest.
   */
  const LETTER = { G: 'Green', R: 'Red', P: 'Purple' };
  const perItemDust = {};
  const dustFile = path.join(root, 'tools', 'item-dust.txt');
  if (fs.existsSync(dustFile)) {
    for (const line of fs.readFileSync(dustFile, 'utf8').split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const cut = text.lastIndexOf('|');
      const colour = LETTER[text.slice(cut + 1)];
      if (colour) perItemDust[text.slice(0, cut)] = colour;
    }
  }

  // Resolve the dust for every item, most authoritative source first.
  let fromPage = 0, fromTable = 0, fromTier = 0, unknown = 0;
  const disagreements = [];
  for (const [name, entry] of Object.entries(items)) {
    if (perItemDust[name]) {
      entry.d = perItemDust[name];
      fromPage++;
      // The reroll tables should agree; anywhere they do not is worth knowing.
      if (explicitDust[name] && explicitDust[name] !== perItemDust[name]) {
        disagreements.push(`${name}: item page says ${perItemDust[name]}, reroll table says ${explicitDust[name]}`);
      }
      continue;
    }
    if (explicitDust[name]) { entry.d = explicitDust[name]; fromTable++; continue; }
    const derived = dustForTier(entry.s, entry.t);
    if (derived) { entry.d = derived; fromTier++; continue; }
    unknown++;
  }
  if (disagreements.length) {
    console.log(`\n  ${disagreements.length} disagreement(s) between the item pages and the reroll tables:`);
    for (const line of disagreements.slice(0, 10)) console.log(`    - ${line}`);
  }

  /*
   * A handful of items only appear in the enchanting reroll tables — reskins
   * and alien variants the equipment indexes do not list. Their slot comes from
   * the table they sit in, which parseDust already had to walk.
   */
  const enchantOnly = parseSlots(enchanting);
  let extra = 0;
  for (const [name, slot] of Object.entries(enchantOnly)) {
    if (items[name] || !explicitDust[name]) continue;
    const sprite = spriteFor(enchanting, name);
    if (!sprite) continue;
    items[name] = { s: slot, f: sprite, d: explicitDust[name] };
    extra++;
  }
  if (extra) console.log(`  ${String(extra).padStart(4)} more items found only in the reroll tables`);

  // Class names and group headers ride along in the same tables; they are not
  // items and must not reach the picker.
  const CLASSES = new Set(['Rogue', 'Archer', 'Wizard', 'Priest', 'Warrior', 'Knight', 'Paladin', 'Assassin', 'Necromancer', 'Huntress', 'Mystic', 'Trickster', 'Sorcerer', 'Ninja', 'Samurai', 'Bard', 'Summoner', 'Kensei', 'Druid']);
  for (const name of Object.keys(items)) {
    if (CLASSES.has(name)) { delete items[name]; continue; }
    if (/^(Tier \d+|Limited|Legacy) /.test(name)) { delete items[name]; continue; }
    if (/^(Health|Magic|Attack|Defense|Speed|Dexterity|Vitality|Wisdom) Rings$/.test(name)) delete items[name];
  }

  const catalog = {
    _source: 'https://www.realmeye.com/wiki/{weapons,ability-items,armor,rings,enchanting}',
    _generated: 'tools/fetch-items.js',
    _bands: BANDS,
    items
  };
  fs.writeFileSync(outCatalog, `${JSON.stringify(catalog)}\n`, 'utf8');

  const total = Object.keys(items).length;
  console.log(`\n  ${total} items -> ${path.relative(root, outCatalog)}`);
  console.log(`  dust: ${fromPage} from the item pages, ${fromTable} from the reroll tables, ${fromTier} from the tier bands, ${unknown} unknown`);
  const bySlot = {};
  for (const entry of Object.values(items)) bySlot[entry.s] = (bySlot[entry.s] || 0) + 1;
  console.log(`  by slot: ${Object.entries(bySlot).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  if (!wantSprites) { console.log('\n  (run with --sprites to download the artwork)\n'); return; }

  fs.mkdirSync(spriteDir, { recursive: true });
  const index = {};
  const entries = Object.entries(items);
  let downloaded = 0, skipped = 0, failed = 0;
  const BATCH = 6;
  for (let start = 0; start < entries.length; start += BATCH) {
    await Promise.all(entries.slice(start, start + BATCH).map(async ([name, entry]) => {
      const extension = path.extname(entry.f) || '.png';
      const file = `${slugify(name)}${extension}`;
      const target = path.join(spriteDir, file);
      index[name] = file;
      if (fs.existsSync(target) && fs.statSync(target).size > 0) { skipped++; return; }
      try {
        const bytes = await get(HOST + IMG_PREFIX + entry.f, true);
        if (!bytes.length) throw new Error('empty');
        fs.writeFileSync(target, bytes);
        downloaded++;
      } catch (error) { failed++; delete index[name]; }
    }));
    process.stdout.write(`\r  sprites ${Math.min(start + BATCH, entries.length)}/${entries.length}`);
  }
  /*
   * The enchanting page shows artwork for a few items the equipment indexes do
   * not list at all — the Neo alien reskins and the awakenable set groups.
   * Those sprites were captured in tools/item-sprites.json; keep any whose file
   * is on disk, so the picker still has a picture for them.
   */
  const supplementPath = path.join(root, 'tools', 'item-sprites.json');
  if (fs.existsSync(supplementPath)) {
    const supplement = JSON.parse(fs.readFileSync(supplementPath, 'utf8')).sprites || {};
    let kept = 0;
    for (const [name, file] of Object.entries(supplement)) {
      if (index[name]) continue;
      const local = `${slugify(name)}${path.extname(file) || '.png'}`;
      if (!fs.existsSync(path.join(spriteDir, local))) continue;
      index[name] = local;
      kept++;
    }
    if (kept) console.log(`\n  ${kept} extra sprites kept from the enchanting page`);
  }

  fs.writeFileSync(path.join(spriteDir, 'index.json'), `${JSON.stringify(index)}\n`, 'utf8');
  const bytes = fs.readdirSync(spriteDir).filter(f => f !== 'index.json')
    .reduce((sum, f) => sum + fs.statSync(path.join(spriteDir, f)).size, 0);
  console.log(`\n  downloaded ${downloaded}, already present ${skipped}, failed ${failed}`);
  console.log(`  ${Object.keys(index).length} sprites, ${(bytes / 1024).toFixed(0)} KB on disk\n`);
}

main().catch(error => { console.error(error); process.exit(1); });
