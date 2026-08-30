'use strict';
/*
 * Read the RealmEye hierarchy that supplements the installed client:
 * biome rank, regular enemies, Heroes of Oryx, encounters, and public wiki
 * links for each creature.  `--details` follows the creature pages too and
 * preserves compact Stats / Drops / Reproduction facts for later Atlas views.
 *
 * It deliberately writes structured facts only, not copied page prose.
 *
 *   node tools/fetch-realmeye-realm.js
 *   node tools/fetch-realmeye-realm.js --details
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const output = path.join(root, 'web', 'realmeye-data.json');
const assetDir = path.join(root, 'web', 'assets', 'realm-catalog');
const HOST = 'https://www.realmeye.com';
const PAUSE = 35;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// These ids are the Atlas' stable editorial ids. The terrain ids continue to
// come from the installed client in generate-realm.js.
const BIOMES = [
  ['shore-plains', 'Rookie', 'beach'], ['shore-sand', 'Rookie', 'undead-forest'],
  ['low-forest', 'Rookie', 'low-forest'], ['low-desert', 'Rookie', 'low-desert'],
  ['low-plains', 'Rookie', 'mid-plains'], ['mid-forest', 'Rookie', 'nature-ruins'],
  ['mid-plains', 'Rookie', 'mid-desert'], ['high-plains', 'Rookie', 'high-plains'],
  ['high-forest', 'Rookie', 'high-forest'], ['high-desert', 'Rookie', 'high-desert'],
  ['coral-reefs', 'Adept', 'coral-reefs'], ['sprite-forest', 'Adept', 'sprite-forest'],
  ['haunted-hallows', 'Adept', 'haunted-hallows'], ['shipwreck-cove', 'Adept', 'shipwreck-cove'],
  ['dead-church', 'Adept', 'dead-church'], ['risen-hell', 'Adept', 'risen-hell'],
  ['abandoned-city', 'Adept', 'abandoned-city'], ['deep-sea-abyss', 'Veteran', 'deep-sea-abyss'],
  ['carboniferous', 'Veteran', 'carboniferous'], ['floral-escape', 'Veteran', 'floral-escape'],
  ['sanguine-forest', 'Veteran', 'sanguine-forest'], ['runic-tundra', 'Veteran', 'runic-tundra'],
  ['eternal-frost', 'Seasonal', 'eternal-frost'], ['spring-of-meaning', 'Seasonal', 'relentless-springs']
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rotmg-realm-atlas data collector' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        return get(new URL(response.headers.location, url).href).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}
function getBytes(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rotmg-realm-atlas data collector' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume(); return getBytes(new URL(response.headers.location, url).href).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}
const decode = text => String(text || '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const plain = markup => decode(markup.replace(/<br\s*\/?\s*>/gi, ' | ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const section = (html, id) => {
  const start = html.search(new RegExp(`<h[234][^>]*\\bid="${id}"[^>]*>`, 'i'));
  if (start < 0) return sectionByHeading(html, id);
  const next = html.slice(start + 4).search(/<h[234]\b/i);
  return html.slice(start, next < 0 ? html.length : start + 4 + next);
};
function sectionByHeading(html, name) {
  const labels = {
    regular: ['regular enemies', 'monsters'], heroes: ['heroes of oryx'],
    encounters: ['encounters'], beaconGuardians: ['beacon guardian'],
    stats: ['stats'], drops: ['drops'], reproduction: ['reproduction']
  };
  const wanted = labels[name] || [name];
  const headings = [...html.matchAll(/<h([234])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const current = headings.find(entry => wanted.includes(plain(entry[2]).toLowerCase()));
  if (!current) return '';
  const start = current.index;
  const next = headings.find(entry => entry.index > start);
  return html.slice(start, next ? next.index : html.length);
}
function enemyLinks(markup) {
  const entries = [];
  for (const match of markup.matchAll(/<a\s+[^>]*href="(\/wiki\/[^"#?]+)"[^>]*>\s*<img\s+[^>]*\balt="([^"]+)"[^>]*>\s*<br\s*\/?\s*>\s*([^<]+)\s*<\/a>/gi)) {
    const name = plain(match[3]) || decode(match[2]);
    const image = /\bsrc="([^"]+)"/i.exec(match[0]);
    if (!entries.some(entry => entry.name === name && entry.path === match[1])) entries.push({ name, path: match[1], image: image && image[1] });
  }
  return entries;
}
function parseBiome(html, id, rank, slug) {
  const groups = {};
  for (const [source, target] of [['regular', 'regular'], ['heroes', 'heroes'], ['encounters', 'encounters'], ['beaconGuardians', 'beaconGuardians']]) groups[target] = enemyLinks(section(html, source));
  return { id, rank, slug, groups };
}
function firstStat(markup, label) {
  const hit = new RegExp(`${label}:\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)`, 'i').exec(plain(markup));
  return hit ? Number(hit[1].replace(/,/g, '')) : null;
}
function detailFor(html, path) {
  const stats = section(html, 'stats');
  const drops = section(html, 'drops');
  const reproduction = section(html, 'reproduction');
  const fact = {};
  for (const [label, key] of [['HP', 'hp'], ['DEF', 'defense'], ['EXP', 'exp'], ['Realm Score', 'realmScore'], ['Spawn Probability', 'spawnProbability']]) {
    const value = firstStat(stats, label); if (value !== null) fact[key] = value;
  }
  const links = markup => [...markup.matchAll(/<a\s+[^>]*href="(\/wiki\/[^"#?]+)[^>]*>([^<]+)<\/a>/gi)]
    .map(match => ({ name: plain(match[2]), path: match[1] })).filter(entry => entry.name && !/back to top/i.test(entry.name));
  const unique = values => values.filter((value, index) => values.findIndex(other => other.name === value.name && other.path === value.path) === index);
  if (drops) fact.drops = unique(links(drops));
  if (reproduction) fact.reproduction = unique(links(reproduction));
  return Object.keys(fact).length ? fact : null;
}

async function main() {
  const wantsDetails = process.argv.includes('--details');
  const wantsAssets = process.argv.includes('--assets');
  const onlyArgument = process.argv.find(value => value.startsWith('--only='));
  const only = onlyArgument ? new Set(onlyArgument.slice('--only='.length).split(',').map(value => value.trim().toLowerCase()).filter(Boolean)) : null;
  const previous = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { creatures: {} };
  const data = { schema: 1, generatedAt: new Date().toISOString().slice(0, 10), source: 'Imported Realm reference data', biomes: {}, creatures: {} };
  for (let i = 0; i < BIOMES.length; i++) {
    const [id, rank, slug] = BIOMES[i];
    try { data.biomes[id] = parseBiome(await get(`${HOST}/wiki/${slug}`), id, rank, slug); }
    catch (error) { data.biomes[id] = { id, rank, slug, groups: {}, error: error.message }; }
    process.stdout.write(`\r  biome ${i + 1}/${BIOMES.length}`);
    await sleep(PAUSE);
  }
  console.log('');
  const creatures = new Map();
  for (const biome of Object.values(data.biomes)) for (const [group, entries] of Object.entries(biome.groups || {})) for (const entry of entries) {
    const key = entry.path; const found = creatures.get(key) || { ...entry, groups: [] };
    found.groups.push({ biome: biome.id, role: group }); creatures.set(key, found);
  }
  for (const creature of creatures.values()) {
    const earlier = previous.creatures && previous.creatures[creature.path];
    data.creatures[creature.path] = { name: creature.name, groups: creature.groups, ...(earlier && earlier.detail && !wantsDetails ? { detail: earlier.detail } : {}) };
  }
  if (wantsDetails) {
    const list = [...creatures.values()].filter(creature => !only || only.has(creature.path.replace(/^\/wiki\//, '').toLowerCase()));
    for (let at = 0; at < list.length; at += 4) {
      await Promise.all(list.slice(at, at + 4).map(async creature => {
        try { const detail = detailFor(await get(`${HOST}${creature.path}`), creature.path); if (detail) data.creatures[creature.path].detail = detail; }
        catch (error) { data.creatures[creature.path].error = error.message; }
      }));
      process.stdout.write(`\r  creature ${Math.min(at + 4, list.length)}/${list.length}`);
      await sleep(PAUSE);
    }
    console.log('');
  }
  if (wantsAssets) {
    fs.mkdirSync(assetDir, { recursive: true });
    const list = [...creatures.values()].filter(creature => !only || only.has(creature.path.replace(/^\/wiki\//, '').toLowerCase()));
    for (let at = 0; at < list.length; at += 4) {
      await Promise.all(list.slice(at, at + 4).map(async creature => {
        const record = data.creatures[creature.path];
        if (!creature.image) return;
        const extension = (/\.(png|gif|webp)$/i.exec(creature.image) || [])[1] || 'png';
        const file = creature.path.replace(/^\/wiki\//, '').replace(/[^a-z0-9]+/gi, '-') + `.${extension.toLowerCase()}`;
        const target = path.join(assetDir, file);
        try {
          if (!fs.existsSync(target) || !fs.statSync(target).size) fs.writeFileSync(target, await getBytes(new URL(creature.image, HOST).href));
          record.art = file;
        } catch (error) { record.assetError = error.message; }
      }));
      process.stdout.write(`\r  sprite ${Math.min(at + 4, list.length)}/${list.length}`);
      await sleep(PAUSE);
    }
    console.log('');
  }
  fs.writeFileSync(output, JSON.stringify(data) + '\n', 'utf8');
  console.log(`Realm catalog data -> ${path.relative(root, output)} (${Object.keys(data.biomes).length} biomes, ${Object.keys(data.creatures).length} local creature records${wantsDetails ? ', with page facts' : ''}${wantsAssets ? ', with local sprites' : ''})`);
}
main().catch(error => { console.error(error); process.exit(1); });
