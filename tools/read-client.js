/*
 * Reads the enchantment data out of an installed RotMG client, and says what
 * changed since the last time it looked.
 *
 *   node tools/read-client.js                  compare, and report
 *   node tools/read-client.js --snapshot       record this client as the new baseline
 *   node tools/read-client.js --news           write the report into the changelog
 *   node tools/read-client.js --save           also dump the raw XML to client-data/
 *   node tools/read-client.js --client <dir>   a client installed somewhere else
 *
 * Why this exists. Everything the calculator knows came from a snapshot of
 * someone else's program, and a snapshot is only right about the day it was
 * taken. The client on this machine is the game: whatever it says is, by
 * definition, what the game does. After an update, run this and it will name
 * every weight, pool rule, artifact and item dust that moved.
 *
 * No Unity asset parser is needed. The data is plain, uncompressed XML sitting
 * inside resources.assets as TextAssets, and the documents can be lifted out
 * by their own tags. The whole read takes well under a second.
 *
 *   <Enchantments>      one <Enchantment> per tier, with Weight, the item
 *                       labels it needs, its own labels, and the enchantment
 *                       labels it refuses to sit beside
 *   <EnchantmentLists>  the pools, as generic rules:
 *                       <ModifyEnchantmentWeightLabel includeLabelsOR="..."
 *                         excludeLabelsOR="UNIQUE" mult="0.2" />
 *   <Objects>           every item with its <EnchantmentSlots slotChance="..."
 *                       dustType="..." dustAmounts="..." />, and artifacts with
 *                       <Artifact list="..." consumeProb="..." />
 *
 * Nothing is downloaded and nothing is sent anywhere: it reads a file already
 * on the machine.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };

const SNAPSHOT = path.join(root, 'data', 'client-snapshot.txt');
const CHANGES = path.join(root, 'data', 'client-changes.txt');

const DEFAULT_CLIENTS = [
  path.join(process.env.LOCALAPPDATA || '', 'RealmOfTheMadGod', 'Production'),
  'C:/Program Files (x86)/Steam/steamapps/common/Realm of the Mad God Exalt'
];

function findClient() {
  const given = option('--client');
  for (const base of given ? [given] : DEFAULT_CLIENTS) {
    if (!base) continue;
    for (const folder of ['RotMG Exalt_Data', 'Realm of the Mad God Exalt_Data', '']) {
      const assets = path.join(base, folder, 'resources.assets');
      if (fs.existsSync(assets)) return { base, dataDir: path.join(base, folder), assets };
    }
  }
  return null;
}

// Unity writes a stable identifier per build; it is what tells two reads apart.
function buildId(dataDir) {
  try {
    const boot = fs.readFileSync(path.join(dataDir, 'boot.config'), 'utf8');
    const match = boot.match(/build-guid=([0-9a-f]+)/i);
    if (match) return match[1];
  } catch (error) { /* not every build ships one */ }
  return 'unknown';
}

/* ---------------------------------------------------------------- *
 * Reading                                                           *
 * ---------------------------------------------------------------- */

const unescape = text => String(text)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&amp;/g, '&');

const attr = (text, name) => {
  const match = text && text.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return match ? unescape(match[1]) : '';
};
const tag = (body, name) => {
  const match = body.match(new RegExp(`<${name}\\s*>([\\s\\S]*?)</${name}>`));
  return match ? unescape(match[1]).trim() : '';
};
const list = value => value.split(',').map(part => part.trim()).filter(Boolean);

/*
 * One pass over the asset file. The enchantments and the pools each live in a
 * single document; the items are spread over dozens of them, so objects are
 * harvested as they go by rather than by finding a document boundary.
 */
function readClient(assets) {
  return new Promise((resolve, reject) => {
    const docs = new Map();
    const objects = new Map();
    const wanted = ['Enchantments', 'EnchantmentLists'];
    let tail = '';

    const harvestObjects = text => {
      const re = /<Object\s([^>]*)>([\s\S]*?)<\/Object>/g;
      let match;
      while ((match = re.exec(text))) {
        const [, attrs, body] = match;
        const slots = body.match(/<EnchantmentSlots([^>]*)\/>/);
        const artifact = body.match(/<Artifact([^>]*)\/>/);
        if (!slots && !artifact) continue;
        const id = attr(attrs, 'id');
        if (!id || objects.has(id)) continue;
        objects.set(id, {
          id,
          display: tag(body, 'DisplayId') || id,
          labels: list(tag(body, 'Labels')),
          slots: slots ? {
            slotChance: attr(slots[1], 'slotChance'),
            dustType: attr(slots[1], 'dustType'),
            dustAmounts: attr(slots[1], 'dustAmounts'),
            pool: attr(slots[1], 'enchantmentList'),
            seasonal: attr(slots[1], 'seasonalSlotMod'),
            forge: attr(slots[1], 'forgeSlotMod')
          } : null,
          artifact: artifact ? {
            pool: attr(artifact[1], 'list'),
            consumeProb: attr(artifact[1], 'consumeProb'),
            dustType: attr(artifact[1], 'dustType'),
            dustAmount: attr(artifact[1], 'dustAmount')
          } : null
        });
      }
    };

    const stream = fs.createReadStream(assets, { highWaterMark: 8 * 1024 * 1024 });
    stream.on('data', chunk => {
      const text = tail + chunk.toString('latin1');
      for (const name of wanted) {
        if (docs.has(name)) continue;
        const from = text.indexOf(`<${name}>`);
        if (from < 0) continue;
        const to = text.indexOf(`</${name}>`, from);
        if (to < 0) continue;
        docs.set(name, text.slice(from, to + name.length + 3));
      }
      harvestObjects(text);
      tail = text.slice(-32768);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ docs, objects }));
  });
}

/* ---------------------------------------------------------------- *
 * Normalising                                                       *
 * ---------------------------------------------------------------- */

/*
 * Two rules, both learned by getting them wrong.
 *
 * Only ROLLABLE records count. The client keeps non-rollable twins under the
 * same display name — an "Alien OnShoot Attack Boost" of weight 15000 that can
 * be rolled and one of 10000 that cannot — and every pool filters on exactly
 * that label. Taking whichever came last invents differences by the hundred.
 *
 * And tiers fold on the id, not on the roman numeral in the name: the client
 * itself displays Dexterity_Mana_Tradeoff_3 as "Dexterity -Mana Tradeoff II".
 */
function enchantmentsFrom(xml) {
  const records = [];
  const re = /<Enchantment\s+([^>]*)>([\s\S]*?)<\/Enchantment>/g;
  let match;
  while ((match = re.exec(xml))) {
    const [, attrs, body] = match;
    const labels = list(tag(body, 'EnchantmentLabels'));
    if (!labels.includes('ROLLABLE')) continue;
    records.push({
      id: attr(attrs, 'id'),
      name: tag(body, 'DisplayId') || attr(attrs, 'id'),
      weight: Number(tag(body, 'Weight')) || 0,
      labels,
      refuses: list(tag(body, 'IncompatibleWithEnchantmentLabels')),
      itemLabels: list(tag(body, 'CompatibleWithItemLabels')),
      refusedItemLabels: list(tag(body, 'IncompatibleWithItemLabels'))
    });
  }

  const folded = new Map();
  for (const record of records) {
    const tier = record.labels.find(label => /^TIER[1-4]$/.test(label));
    if (!tier) { folded.set(record.id, { id: record.id, name: record.name, tiers: null, one: record }); continue; }
    const stem = record.id.replace(/_[1-4]$/, '');
    if (!folded.has(stem)) folded.set(stem, { id: stem, name: record.name.replace(/ (I{1,3}|IV)$/, ''), tiers: [], one: record });
    folded.get(stem).tiers[Number(tier.slice(4)) - 1] = record;
  }

  const out = [];
  for (const group of folded.values()) {
    const present = group.tiers ? group.tiers.filter(Boolean) : [group.one];
    const weight = present.reduce((sum, record) => sum + record.weight, 0);
    const split = group.tiers && present.length === 4
      ? group.tiers.map(record => (record.weight / weight).toFixed(5)).join(' ')
      : '';
    const sample = present[0];
    out.push({
      id: group.id,
      name: group.name,
      weight,
      split,
      labels: sample.labels.filter(label => !/^TIER[1-4]$/.test(label)).sort(),
      refuses: sample.refuses.slice().sort(),
      itemLabels: sample.itemLabels.slice().sort(),
      refusedItemLabels: sample.refusedItemLabels.slice().sort()
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function poolsFrom(xml) {
  const out = [];
  const re = /<EnchantmentList[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/EnchantmentList>/g;
  let match;
  while ((match = re.exec(xml))) {
    const rules = [];
    for (const rule of match[2].matchAll(/<(\w+)([^>]*)\/>/g)) {
      const bits = [rule[1]];
      for (const name of ['id', 'includeLabelsOR', 'excludeLabelsOR', 'includeLabelsAND', 'excludeLabelsAND', 'mult']) {
        const value = attr(rule[2], name);
        if (value) bits.push(`${name}=${value}`);
      }
      rules.push(bits.join(' '));
    }
    out.push({ id: match[1], rules });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------------------------------------------------------------- *
 * The snapshot: one sorted line per fact, so git can diff it too    *
 * ---------------------------------------------------------------- */

function buildSnapshot(state) {
  const lines = [];
  lines.push(`build|${state.build}`);
  // Keyed on the id, not the display name: the client gives two different
  // enchantments the name "Acid Guardian" and separates them only by id, so a
  // name-keyed line would hide one of them from every future comparison.
  for (const e of state.enchantments) {
    lines.push(['ench', e.id, e.name, e.weight, e.split, e.labels.join(','), e.refuses.join(','),
      e.itemLabels.join(','), e.refusedItemLabels.join(',')].join('|'));
  }
  // Numbered, because a pool has several rules and they would otherwise share
  // one key: a changed multiplier would vanish instead of being reported.
  for (const p of state.pools) {
    p.rules.forEach((rule, index) => lines.push(['pool', `${p.id} #${index + 1}`, rule].join('|')));
  }
  for (const a of state.artifacts) {
    lines.push(['artifact', a.name, a.pool, a.consumeProb, a.dustType, a.dustAmount].join('|'));
  }
  for (const i of state.items) {
    lines.push(['item', i.name, i.dustType, i.slotChance, i.dustAmounts, i.pool].join('|'));
  }
  return lines;
}

function parseSnapshot(text) {
  const map = new Map();
  let build = 'unknown';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('##')) continue;
    if (line.startsWith('build|')) { build = line.slice(6); continue; }
    const cut = line.indexOf('|', line.indexOf('|') + 1);
    map.set(line.slice(0, cut), line.slice(cut + 1));
  }
  return { build, map };
}

// What moved, said the way a person would say it.
function describe(kind, name, before, after) {
  const FIELDS = {
    ench: ['name', 'weight', 'tier split', 'Labels', 'Incompatible Labels', 'item labels', 'refused item labels'],
    artifact: ['pool', 'consume chance', 'dust', 'dust cost'],
    item: ['dust', 'slot chances', 'reroll costs', 'pool'],
    pool: ['rule']
  };
  const names = FIELDS[kind] || [];
  const from = before.split('|');
  const to = after.split('|');
  const parts = [];
  for (let index = 0; index < Math.max(from.length, to.length); index++) {
    if ((from[index] || '') === (to[index] || '')) continue;
    const label = names[index] || `field ${index + 1}`;
    parts.push(`${label} ${from[index] || '(none)'} -> ${to[index] || '(none)'}`);
  }
  return parts.length ? `${name}: ${parts.join(', ')}` : null;
}

function compare(previous, current) {
  const added = [], removed = [], changed = [];
  for (const [key, value] of current) {
    if (!previous.has(key)) { added.push(key); continue; }
    if (previous.get(key) !== value) {
      const [kind, id] = key.split('|');
      // For enchantments the readable name is the first field, not the key.
      const name = kind === 'ench' ? `${value.split('|')[0]} [${id}]` : id;
      const line = describe(kind, name, previous.get(key), value);
      if (line) changed.push(`${kind}: ${line}`);
    }
  }
  for (const key of previous.keys()) if (!current.has(key)) removed.push(key);
  return { added, removed, changed };
}

/* ---------------------------------------------------------------- */

async function main() {
  const client = findClient();
  if (!client) {
    console.error('\n  No RotMG client found. Looked in:');
    for (const base of DEFAULT_CLIENTS) console.error(`    ${base}`);
    console.error('  Point at one with:  node tools/read-client.js --client <folder>\n');
    process.exit(1);
  }

  const started = Date.now();
  const { docs, objects } = await readClient(client.assets);
  if (!docs.has('Enchantments')) { console.error('\n  no <Enchantments> document in this client\n'); process.exit(1); }

  const build = buildId(client.dataDir);
  const enchantments = enchantmentsFrom(docs.get('Enchantments'));
  const pools = docs.has('EnchantmentLists') ? poolsFrom(docs.get('EnchantmentLists')) : [];

  const artifacts = [];
  const seenArtifact = new Set();
  const items = [];
  for (const object of objects.values()) {
    if (object.artifact && object.artifact.pool) {
      // One object per stack size: "The Fool Tarot Card x7".
      const name = object.display.replace(/\s*x\d+$/, '').trim();
      if (!seenArtifact.has(name)) {
        seenArtifact.add(name);
        artifacts.push({ name, ...object.artifact });
      }
    }
    if (object.slots && object.slots.slotChance) {
      items.push({ name: object.id, ...object.slots });
    }
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name));
  items.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n  client : ${client.assets}`);
  console.log(`  build  : ${build}`);
  console.log(`  read in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`\n  ${enchantments.length} rollable enchantments, ${pools.length} pools, ${artifacts.length} artifacts, ${items.length} enchantable items`);

  if (flag('--save')) {
    const out = path.join(root, 'client-data');
    fs.mkdirSync(out, { recursive: true });
    for (const [name, xml] of docs) fs.writeFileSync(path.join(out, `${name}.xml`), xml, 'utf8');
    console.log(`\n  raw XML -> ${path.relative(root, out)}/`);
  }

  const lines = buildSnapshot({ build, enchantments, pools, artifacts, items });
  const current = parseSnapshot(lines.join('\n'));

  const header = `## What an installed RotMG client says about enchanting, as of the build below.
##
## Written by tools/read-client.js --snapshot. Its only purpose is to be
## compared against the next read: run the tool after a game update and it will
## name every weight, pool rule, artifact and item that moved.
##
## One sorted line per fact, so git can diff it as well.
## Format: kind|name|fields…
`;

  if (!fs.existsSync(SNAPSHOT)) {
    if (!flag('--snapshot')) {
      console.log(`\n  no baseline yet. Record this client as one with:\n    node tools/read-client.js --snapshot\n`);
      return;
    }
  } else {
    const previous = parseSnapshot(fs.readFileSync(SNAPSHOT, 'utf8'));
    const { added, removed, changed } = compare(previous.map, current.map);
    console.log(`\n  against the recorded build ${previous.build}:`);
    if (previous.build === build) console.log('    same build — nothing can have changed');
    console.log(`    ${changed.length} changed, ${added.length} added, ${removed.length} gone`);
    for (const line of changed.slice(0, 40)) console.log(`      ~ ${line}`);
    if (changed.length > 40) console.log(`      … and ${changed.length - 40} more`);
    for (const key of added.slice(0, 20)) console.log(`      + ${key.replace('|', ': ')}`);
    if (added.length > 20) console.log(`      … and ${added.length - 20} more added`);
    for (const key of removed.slice(0, 20)) console.log(`      - ${key.replace('|', ': ')}`);
    if (removed.length > 20) console.log(`      … and ${removed.length - 20} more gone`);

    if (flag('--news') && (changed.length || added.length || removed.length)) {
      const when = fs.statSync(client.assets).mtime.toISOString().slice(0, 10);
      const entry = [`## ${when} — build ${build}`, ...changed.map(l => `~ ${l}`),
        ...added.map(k => `+ ${k.replace('|', ': ')}`), ...removed.map(k => `- ${k.replace('|', ': ')}`), ''];
      const before = fs.existsSync(CHANGES) ? fs.readFileSync(CHANGES, 'utf8') : '';
      fs.writeFileSync(CHANGES, `${entry.join('\n')}\n${before}`, 'utf8');
      console.log(`\n  written to ${path.relative(root, CHANGES)}`);
    }
  }

  if (flag('--snapshot')) {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, `${header}\n${lines.join('\n')}\n`, 'utf8');
    console.log(`\n  ${lines.length} lines -> ${path.relative(root, SNAPSHOT)}`);
  }
  console.log('');
}

main().catch(error => { console.error(error); process.exit(1); });
