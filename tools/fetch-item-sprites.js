/*
 * Downloads the item sprites listed in tools/item-sprites.json into
 * web/assets/items/, once, so the build can inline them.
 *
 *   node tools/fetch-item-sprites.js
 *
 * The name -> file mapping was read off the reroll tables of
 * https://www.realmeye.com/wiki/enchanting, which shows every one of these
 * sprites on a single page; nothing else is crawled. Files already present are
 * skipped, so re-running it costs nothing, and requests go out a few at a time
 * rather than all at once.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'web', 'assets', 'items');
const manifestPath = path.join(root, 'tools', 'item-sprites.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const prefix = manifest._prefix;
const sprites = manifest.sprites;

// A stable, filesystem-safe file name per item.
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rotmg-enchant-calculator build script' } }, response => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        response.resume();
        return download(new URL(response.headers.location, url).href).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const entries = Object.entries(sprites);
  const results = { downloaded: 0, skipped: 0, failed: [] };
  const index = {};

  const BATCH = 6;   // gentle on the server, still finishes quickly
  for (let start = 0; start < entries.length; start += BATCH) {
    const batch = entries.slice(start, start + BATCH);
    await Promise.all(batch.map(async ([name, file]) => {
      const extension = path.extname(file) || '.png';
      const target = path.join(outDir, `${slug(name)}${extension}`);
      index[name] = path.basename(target);
      if (fs.existsSync(target) && fs.statSync(target).size > 0) { results.skipped++; return; }
      try {
        const bytes = await download(prefix + file);
        if (!bytes.length) throw new Error('empty response');
        fs.writeFileSync(target, bytes);
        results.downloaded++;
      } catch (error) {
        results.failed.push(`${name}: ${error.message}`);
        delete index[name];
      }
    }));
    process.stdout.write(`\r  ${Math.min(start + BATCH, entries.length)}/${entries.length}`);
  }

  // What the build reads: item name -> file inside web/assets/items/.
  fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 0)}\n`, 'utf8');

  const bytes = fs.readdirSync(outDir).filter(file => file !== 'index.json')
    .reduce((total, file) => total + fs.statSync(path.join(outDir, file)).size, 0);
  console.log(`\n\n  downloaded ${results.downloaded}, already present ${results.skipped}, failed ${results.failed.length}`);
  console.log(`  ${Object.keys(index).length} sprites, ${(bytes / 1024).toFixed(0)} KB on disk`);
  if (results.failed.length) {
    console.log('\n  failures:');
    for (const line of results.failed.slice(0, 20)) console.log(`    - ${line}`);
  }
  console.log('');
}

main().catch(error => { console.error(error); process.exit(1); });
