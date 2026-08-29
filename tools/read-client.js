/*
 * Reads the enchantment data straight out of an installed RotMG client.
 *
 *   node tools/read-client.js                 read, report, compare
 *   node tools/read-client.js --save          also write the XML to client-data/
 *   node tools/read-client.js --client <dir>  a client somewhere else
 *
 * Why this is worth doing. Everything the calculator knows about enchantments
 * came from a snapshot of someone else's program, and a snapshot is only ever
 * right about the day it was taken. The client on this machine is the game
 * itself: whatever it says is, by definition, what the game does.
 *
 * The data turns out to be plain XML, uncompressed, sitting inside
 * resources.assets as Unity TextAssets. No asset parser is needed — the
 * documents are contiguous and can be lifted out by their own tags:
 *
 *   <Enchantments>      one <Enchantment> per tier, with Weight, the item
 *                       labels it is compatible with, its own labels, and the
 *                       enchantment labels it refuses to sit beside
 *   <EnchantmentLists>  the pools, as generic rules:
 *                       <ModifyEnchantmentWeightLabel includeLabelsOR="..."
 *                         excludeLabelsOR="UNIQUE" mult="0.2" />
 *   <Objects>           every item, with its <Labels> and
 *                       <EnchantmentSlots slotChance="..." enchantmentList="..." />
 *                       and, for artifacts,
 *                       <Artifact list="..." consumeProb="..." dustType="..." />
 *
 * Nothing here is downloaded and nothing is sent anywhere: it reads a file
 * already on the machine.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };

const DEFAULT_CLIENTS = [
  'C:/Users/' + (process.env.USERNAME || '') + '/AppData/Local/RealmOfTheMadGod/Production',
  'C:/Program Files (x86)/Steam/steamapps/common/Realm of the Mad God Exalt'
];

function findAssets() {
  const given = option('--client');
  const candidates = given ? [given] : DEFAULT_CLIENTS;
  for (const base of candidates) {
    for (const folder of ['RotMG Exalt_Data', 'Realm of the Mad God Exalt_Data', '']) {
      const file = path.join(base, folder, 'resources.assets');
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/*
 * Pulls every embedded XML document out of the asset file.
 *
 * Streamed with a sliding window rather than read whole: the file is several
 * hundred megabytes and only a fraction of it is text.
 */
function extractDocuments(file, wanted) {
  return new Promise((resolve, reject) => {
    const found = new Map();
    const open = wanted.map(name => ({ name, start: `<${name}>`, end: `</${name}>` }));
    let tail = '';
    let offset = 0;
    const OVERLAP = 4096;

    const stream = fs.createReadStream(file, { highWaterMark: 8 * 1024 * 1024 });
    stream.on('data', chunk => {
      const text = tail + chunk.toString('latin1');
      for (const doc of open) {
        if (found.has(doc.name)) continue;
        const from = text.indexOf(doc.start);
        if (from < 0) continue;
        const to = text.indexOf(doc.end, from);
        if (to < 0) continue;                       // spans further than this window
        // Take the declaration with it when it is right in front.
        const decl = text.lastIndexOf('<?xml', from);
        const begin = decl >= 0 && from - decl < 80 ? decl : from;
        found.set(doc.name, text.slice(begin, to + doc.end.length));
      }
      if (found.size === open.length) { stream.destroy(); return; }
      tail = text.slice(-OVERLAP);
      offset += chunk.length;
    });
    stream.on('error', reject);
    stream.on('close', () => resolve(found));
    stream.on('end', () => resolve(found));
  });
}

/* --------------------------------------------------------------- *
 * A deliberately small XML reader: these documents are flat and     *
 * machine-written, so the shapes below are all that occur.          *
 * --------------------------------------------------------------- */

const unescape = text => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

function attributes(tag) {
  const out = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[match[1]] = unescape(match[2]);
  return out;
}

// Every <Name>…</Name> and <Name /> directly inside one element's body.
function children(body) {
  const out = [];
  const re = /<([\w:-]+)([^>]*?)(\/)?>/g;
  let match;
  while ((match = re.exec(body))) {
    const [full, name, attrs, selfClosing] = match;
    if (selfClosing) { out.push({ name, attrs: attributes(attrs), text: '' }); continue; }
    const close = `</${name}>`;
    const end = body.indexOf(close, re.lastIndex);
    if (end < 0) continue;
    out.push({ name, attrs: attributes(attrs), text: body.slice(re.lastIndex, end), inner: body.slice(re.lastIndex, end) });
    re.lastIndex = end + close.length;
  }
  return out;
}

function elements(xml, name) {
  const out = [];
  const openRe = new RegExp(`<${name}(\\s[^>]*?)?(/)?>`, 'g');
  let match;
  while ((match = openRe.exec(xml))) {
    const attrs = attributes(match[1] || '');
    if (match[2]) { out.push({ attrs, body: '' }); continue; }
    const close = `</${name}>`;
    const end = xml.indexOf(close, openRe.lastIndex);
    if (end < 0) break;
    out.push({ attrs, body: xml.slice(openRe.lastIndex, end) });
    openRe.lastIndex = end + close.length;
  }
  return out;
}

const textOf = (body, name) => {
  const match = body.match(new RegExp(`<${name}\\s*>([\\s\\S]*?)</${name}>`));
  return match ? unescape(match[1]).trim() : '';
};
const list = value => value.split(',').map(s => s.trim()).filter(Boolean);

/* --------------------------------------------------------------- */

async function main() {
  const file = findAssets();
  if (!file) {
    console.error('\n  No RotMG client found. Looked in:');
    for (const base of DEFAULT_CLIENTS) console.error(`    ${base}`);
    console.error('  Point at one with:  node tools/read-client.js --client <folder>\n');
    process.exit(1);
  }
  const size = fs.statSync(file).size;
  console.log(`\n  client: ${file}`);
  console.log(`  ${(size / 1024 / 1024).toFixed(0)} MB, last written ${fs.statSync(file).mtime.toISOString().slice(0, 10)}`);

  const started = Date.now();
  const docs = await extractDocuments(file, ['Enchantments', 'EnchantmentLists']);
  console.log(`  read in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);

  for (const [name, xml] of docs) console.log(`  <${name}> ${(xml.length / 1024).toFixed(0)} KB`);
  if (!docs.has('Enchantments')) { console.error('\n  no <Enchantments> document in this client\n'); process.exit(1); }

  /*
   * Enchantments.
   *
   * Two rules, both learned by getting them wrong first.
   *
   * Only ROLLABLE records count. The client keeps non-rollable twins under the
   * same display name — an "Alien OnShoot Attack Boost" of weight 15000 that
   * can be rolled, and one of 10000 that cannot — and every pool filters on
   * exactly that label: <EnchantmentEntryLabel includeLabelsOR="ROLLABLE" />.
   * Taking whichever came last made a hundred imaginary differences.
   *
   * And tiers are folded on the id, not on the roman numeral in the name. The
   * client itself mislabels several tier III records as "II"
   * (Dexterity_Mana_Tradeoff_3 displays as "Dexterity -Mana Tradeoff II"),
   * so the name cannot be trusted to say which tier a record is.
   */
  const enchantments = elements(docs.get('Enchantments'), 'Enchantment').map(node => ({
    id: node.attrs.id,
    name: textOf(node.body, 'DisplayId') || node.attrs.id,
    weight: Number(textOf(node.body, 'Weight')) || 0,
    itemLabels: list(textOf(node.body, 'CompatibleWithItemLabels')),
    refusedItemLabels: list(textOf(node.body, 'IncompatibleWithItemLabels')),
    labels: list(textOf(node.body, 'EnchantmentLabels')),
    refuses: list(textOf(node.body, 'IncompatibleWithEnchantmentLabels'))
  }));
  const rollable = enchantments.filter(e => e.labels.includes('ROLLABLE'));
  console.log(`\n  ${enchantments.length} enchantments defined, ${rollable.length} of them rollable`);

  const folded = new Map();
  for (const e of rollable) {
    const tier = e.labels.find(label => /^TIER[1-4]$/.test(label));
    if (!tier) { folded.set(e.id, { name: e.name, tiers: null, one: e }); continue; }
    const stem = e.id.replace(/_[1-4]$/, '');
    if (!folded.has(stem)) folded.set(stem, { name: e.name.replace(/ (I{1,3}|IV)$/, ''), tiers: [], one: e });
    folded.get(stem).tiers[Number(tier.slice(4)) - 1] = e;
  }
  const weightOf = group => group.tiers
    ? group.tiers.filter(Boolean).reduce((sum, tier) => sum + tier.weight, 0)
    : group.one.weight;
  console.log(`  ${folded.size} once the four tiers of each are folded into one`);

  if (flag('--save')) {
    const out = path.join(root, 'client-data');
    fs.mkdirSync(out, { recursive: true });
    for (const [name, xml] of docs) fs.writeFileSync(path.join(out, `${name}.xml`), xml, 'utf8');
    console.log(`\n  XML written to ${path.relative(root, out)}/`);
  }

  /* ---- what we hold, for comparison ---- */
  const engine = require(path.join(root, 'web', 'engine.js'));
  const MOD_FILES = ['globalMods.txt', 'weaponMods.txt', 'abilityMods.txt', 'armorMods.txt',
    'ringMods.txt', 'alienMods.txt', 'neoAlienMods.txt', 'summonPoweredMods.txt', 'awakenedMods.txt'];
  const read = (...parts) => fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
  const ours = engine.buildDataset({
    modTexts: MOD_FILES.map(f => read('Enchantment documents', f)),
    artifactText: read('Artifacts', 'artifacts.txt'),
    awakenText: read('Awakened Items', 'awakenedItems.txt'),
    awokenExtraText: read('Awakened Items', 'awoken-items.txt')
  });

  const norm = value => String(value).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();
  const byName = new Map();
  for (const group of folded.values()) if (!byName.has(norm(group.name))) byName.set(norm(group.name), group);

  const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  let matched = 0, weightSame = 0, splitSame = 0, refusesSame = 0;
  const weightDiff = [], splitDiff = [], refusesDiff = [], absent = [];

  for (const mod of ours.enchants) {
    const group = byName.get(norm(mod.name));
    if (!group) { absent.push(mod.name); continue; }
    matched++;

    const weight = weightOf(group);
    if (weight === mod.weight) weightSame++;
    else weightDiff.push(`${mod.name}: ${mod.weight} here, ${weight} in the client`);

    if (group.tiers && group.tiers.filter(Boolean).length === 4) {
      const share = group.tiers.map(tier => tier.weight / weight);
      if (share.every((value, index) => Math.abs(value - (mod.distribution[index] || 0)) < 0.0005)) splitSame++;
      else splitDiff.push(`${mod.name}: [${mod.distribution}] here, [${share.map(v => v.toFixed(5))}] in the client`);
    }

    const refuses = (group.tiers ? group.tiers.find(Boolean) : group.one).refuses;
    if (same(refuses, [...mod.excludes])) refusesSame++;
    else refusesDiff.push(`${mod.name}: [${[...mod.excludes]}] here, [${refuses}] in the client`);
  }

  const report = (title, same_, list, limit) => {
    console.log(`    ${title}: ${same_} the same, ${list.length} different`);
    for (const line of list.slice(0, limit)) console.log(`      - ${line}`);
    if (list.length > limit) console.log(`      … and ${list.length - limit} more`);
  };

  console.log(`\n  of our ${ours.enchants.length} enchantments, ${matched} matched by name:`);
  report('weight', weightSame, weightDiff, 15);
  report('tier split', splitSame, splitDiff, 10);
  report('Incompatible Labels', refusesSame, refusesDiff, 10);
  if (absent.length) console.log(`    not matched: ${absent.join(', ')}`);

  const known = new Set(ours.enchants.map(mod => norm(mod.name)));
  const extra = [...byName.values()].filter(group => !known.has(norm(group.name)));
  console.log(`\n  rollable in the client and not here: ${extra.length}`);
  for (const group of extra.slice(0, 20)) console.log(`      + ${group.name} (weight ${weightOf(group)})`);
  if (extra.length > 20) console.log(`      … and ${extra.length - 20} more`);
  console.log('');
}

main().catch(error => { console.error(error); process.exit(1); });
