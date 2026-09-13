'use strict';

/*
 * Cache RealmEye primary images only for Index records that still need art.
 *
 * The enrichment exporter marks those records with `needsSprite`. Existing
 * client art always wins. Files are content-addressed by the source URL so a
 * later run downloads only genuinely new candidates.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const sourceFile = path.join(root, 'data', 'Index', 'realmeye-enrichment.json');
const outDir = path.join(root, 'web', 'assets', 'index', 'realmeye-sprites');
const manifestFile = path.join(outDir, 'index.json');
const delayArg = process.argv.find(x => x.startsWith('--delay='));
const limitArg = process.argv.find(x => x.startsWith('--limit='));
const delayMs = delayArg ? Math.max(0, Number(delayArg.split('=')[1]) || 0) : 120;
const limit = limitArg ? Math.max(0, Number(limitArg.split('=')[1]) || 0) : Infinity;

// Biome pages usually use RealmEye's beacon artwork rather than a page hero
// image. Reuse the project's existing local importer, but only when that cache
// is absent/incomplete.
const biomeManifest = path.join(root, 'web', 'assets', 'realm-biomes', 'index.json');
const biomeFetcher = path.join(root, 'tools', 'fetch-realmeye-biomes.js');
let needBiomes = !fs.existsSync(biomeManifest);
if (!needBiomes) {
  try {
    const manifest = JSON.parse(fs.readFileSync(biomeManifest, 'utf8'));
    const floral = manifest.beacons && manifest.beacons['Floral Escape'];
    needBiomes = !floral || !fs.existsSync(path.join(path.dirname(biomeManifest), floral.file));
  } catch (_) { needBiomes = true; }
}
if (needBiomes && fs.existsSync(biomeFetcher)) {
  const run = spawnSync(process.execPath, [biomeFetcher], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) console.warn('RealmEye biome beacon refresh failed; continuing with existing Index art.');
}

if (!fs.existsSync(sourceFile)) {
  console.log('RealmEye sprite cache: no enrichment sidecar yet; nothing to fetch.');
  process.exit(0);
}

function extOf(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.png', '.gif', '.webp', '.jpg', '.jpeg'].includes(ext) ? ext : '.png';
  } catch (_) { return '.png'; }
}

function fileOf(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 24) + extOf(url);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function request(url, attempt = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'rotmg-tools RealmEye archive sprite cache',
        'Accept': 'image/avif,image/webp,image/png,image/*,*/*;q=0.8'
      },
      timeout: 20000
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const next = new URL(response.headers.location, url).href;
        response.resume();
        return request(next, attempt).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        const retryable = response.statusCode === 429 || response.statusCode >= 500;
        if (retryable && attempt < 3) {
          const wait = Math.max(750, 700 * Math.pow(2, attempt));
          return sleep(wait).then(() => request(url, attempt + 1)).then(resolve, reject);
        }
        return reject(new Error(`HTTP ${response.statusCode}: ${url}`));
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${url}`)));
    req.on('error', err => {
      if (attempt < 2) {
        const wait = 700 * Math.pow(2, attempt);
        sleep(wait).then(() => request(url, attempt + 1)).then(resolve, reject);
      } else reject(err);
    });
  });
}

(async () => {
  const sidecar = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const candidates = [];
  for (const [id, record] of Object.entries(sidecar.records || {})) {
    if (!record.needsSprite || !Array.isArray(record.images) || !record.images.length) continue;
    const source = record.images.find(one => one && typeof one.source === 'string' && /^https:\/\//.test(one.source));
    if (!source) continue;
    candidates.push({ id, name: record.name || id.replace(/^[^:]+:/, ''), url: source.source });
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  const selected = candidates.slice(0, limit);
  fs.mkdirSync(outDir, { recursive: true });

  let manifest = { schema: 1, source: 'RealmEye', sprites: {} };
  if (fs.existsSync(manifestFile)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
    catch (_) { /* rebuild below */ }
    manifest.schema = 1;
    manifest.source = 'RealmEye';
    manifest.sprites ||= {};
  }

  let cached = 0, downloaded = 0, failed = 0;
  for (let i = 0; i < selected.length; i++) {
    const one = selected[i];
    const file = fileOf(one.url);
    const target = path.join(outDir, file);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      cached++;
      manifest.sprites[one.id] = { file, source: one.url, name: one.name };
      continue;
    }
    try {
      const bytes = await request(one.url);
      if (!bytes.length) throw new Error('empty response');
      fs.writeFileSync(target, bytes);
      manifest.sprites[one.id] = { file, source: one.url, name: one.name };
      downloaded++;
    } catch (error) {
      failed++;
      console.warn(`\n  sprite failed ${one.id}: ${error.message}`);
    }
    process.stdout.write(`\r  RealmEye sprites ${i + 1}/${selected.length} | new ${downloaded} | cached ${cached} | failed ${failed}`);
    if (delayMs && i + 1 < selected.length) await sleep(delayMs);
  }
  if (selected.length) process.stdout.write('\n');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ candidates: candidates.length, selected: selected.length, downloaded, cached, failed }));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
