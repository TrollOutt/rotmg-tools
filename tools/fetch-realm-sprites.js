'use strict';
/*
 * Fetch one presentation sprite for every terrain monster in RealmData.
 *
 * The game client identifies the exact sheet and frame, which is preserved in
 * realm-data.js. Its current Unity atlas does not retain the old sheet-name →
 * rectangle mapping, so individual images are read from the matching RealmEye
 * monster pages instead. The lookup is strict: the page must label an image
 * with the exact client display name; nothing vaguely similar is accepted.
 *
 *   node tools/generate-realm.js && node tools/fetch-realm-sprites.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const dataPath = path.join(root, 'web', 'realm-data.js');
const outDir = path.join(root, 'web', 'assets', 'realm-monsters');
const indexPath = path.join(outDir, 'index.json');
const HOST = 'https://www.realmeye.com/wiki/';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const source = fs.readFileSync(dataPath, 'utf8');
const found = /var RealmData = ([\s\S]*);\s*$/.exec(source);
if (!found) throw new Error('web/realm-data.js did not contain RealmData. Run generate-realm first.');
const data = JSON.parse(found[1]);

const slug = name => String(name).toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeFile = id => slug(id) + '.png';
const attr = (markup, name) => {
  const hit = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(markup);
  return hit ? hit[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
};
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rotmg-realm-atlas asset builder' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        return get(new URL(response.headers.location, url).href).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}
async function imageFor(monster) {
  const page = HOST + encodeURIComponent(slug(monster.name));
  const html = (await get(page)).toString('utf8');
  for (const image of html.match(/<img\b[^>]*>/gi) || []) {
    const label = attr(image, 'title') || attr(image, 'alt');
    if (label !== monster.name) continue;
    const url = attr(image, 'src');
    if (url) return new URL(url, page).href;
  }
  throw new Error('no exact labelled image');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const monsters = new Map();
  for (const terrain of data.terrains) for (const monster of terrain.monsters) monsters.set(monster.id, monster);
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : {};
  const results = { fetched: 0, cached: 0, missing: [] };
  const entries = [...monsters.values()];
  const pending = entries.filter(monster => !fs.existsSync(path.join(outDir, safeFile(monster.id))));
  results.cached = entries.length - pending.length;
  // The wiki protects itself against bursts. One page at a time and a modest
  // pause keeps this generator friendly; it is rerunnable, so a temporary
  // miss simply remains pending for the next pass.
  const BATCH = 1;
  for (let at = 0; at < pending.length; at += BATCH) {
    await Promise.all(pending.slice(at, at + BATCH).map(async monster => {
      const file = safeFile(monster.id);
      const target = path.join(outDir, file);
      if (fs.existsSync(target) && fs.statSync(target).size) { index[monster.id] = file; return; }
      try {
        const image = await get(await imageFor(monster));
        if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('image was not PNG');
        fs.writeFileSync(target, image);
        index[monster.id] = file;
        results.fetched++;
      } catch (error) {
        delete index[monster.id];
        results.missing.push(`${monster.name}: ${error.message}`);
      }
    }));
    process.stdout.write(`\r  ${Math.min(at + BATCH, pending.length)}/${pending.length} remaining sprites`);
    if (at + BATCH < pending.length) await pause(700);
  }
  fs.writeFileSync(indexPath, JSON.stringify(index) + '\n', 'utf8');
  console.log(`\n\n  fetched ${results.fetched}, already present ${results.cached}, unavailable ${results.missing.length}`);
  console.log(`  ${Object.keys(index).length}/${entries.length} monster sprites -> ${path.relative(root, outDir)}`);
  if (results.missing.length) console.log(`  unavailable: ${results.missing.slice(0, 18).join('; ')}${results.missing.length > 18 ? '…' : ''}`);
}
main().catch(error => { console.error(error); process.exit(1); });
