'use strict';

/*
 * Import the biome beacon artwork exposed by RealmEye's "The Realm" page.
 *
 * RealmEye is used only as an import source. The application never hotlinks
 * these images at runtime: downloaded files are stored in the repository and
 * consumed by the normal Index/SQLite build.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const HOST = 'https://www.realmeye.com';
const PAGE = HOST + '/wiki/the-realm';

const assetDir = path.join(
  root,
  'web',
  'assets',
  'realm-biomes'
);

const manifestFile = path.join(assetDir, 'index.json');

function request(url, binary = false) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent': 'rotmg-realm-atlas data collector'
        }
      },
      response => {
        if ([301, 302, 307, 308].includes(response.statusCode)) {
          const next = new URL(
            response.headers.location,
            url
          ).href;

          response.resume();

          return request(next, binary).then(
            resolve,
            reject
          );
        }

        if (response.statusCode !== 200) {
          response.resume();

          return reject(
            new Error(
              `HTTP ${response.statusCode}: ${url}`
            )
          );
        }

        const chunks = [];

        response.on(
          'data',
          chunk => chunks.push(chunk)
        );

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);

          resolve(
            binary
              ? buffer
              : buffer.toString('utf8')
          );
        });
      }
    ).on('error', reject);
  });
}

function decode(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag, name) {
  const hit = new RegExp(
    `\\b${name}=["']([^"']*)["']`,
    'i'
  ).exec(tag);

  return hit ? decode(hit[1]) : '';
}

function beaconName(alt) {
  /*
   * Examples observed on RealmEye:
   *
   *   Runic Tundra Beacon (Veteran)
   *   Carboniferous Beacon (Veteran)
   *   Eternal Frost Beacon
   */
  const hit = /^(.*?)\s+Beacon(?:\s+\([^)]+\))?$/i.exec(
    decode(alt)
  );

  return hit ? hit[1].trim() : null;
}

function slug(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extension(url) {
  const pathname = new URL(url).pathname;
  const hit = /\.(png|gif|webp|jpe?g)$/i.exec(pathname);

  return hit ? hit[1].toLowerCase() : 'png';
}

function sameFile(file, bytes) {
  if (!fs.existsSync(file)) return false;

  const existing = fs.readFileSync(file);

  return existing.equals(bytes);
}

async function main() {
  const html = await request(PAGE);

  const found = new Map();

  for (const hit of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = hit[0];

    const alt = attribute(tag, 'alt');
    const src = attribute(tag, 'src');

    const name = beaconName(alt);

    if (!name || !src) continue;

    const url = new URL(src, HOST).href;

    /*
     * One visual beacon per displayed biome name.
     * Duplicate appearances of the same image on the page collapse here.
     */
    if (!found.has(name)) {
      found.set(name, {
        name,
        alt,
        url
      });
    }
  }

  if (!found.size) {
    throw new Error(
      'No biome beacon images found on RealmEye The Realm page'
    );
  }

  fs.mkdirSync(assetDir, {
    recursive: true
  });

  const manifest = {
    schema: 1,
    source: PAGE,
    beacons: {}
  };

  const entries = [...found.values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  let changed = 0;

  for (let n = 0; n < entries.length; n++) {
    const entry = entries[n];

    const ext = extension(entry.url);
    const file = slug(entry.name) + '.' + ext;
    const target = path.join(assetDir, file);

    const bytes = await request(entry.url, true);

    if (!sameFile(target, bytes)) {
      fs.writeFileSync(target, bytes);
      changed++;
    }

    manifest.beacons[entry.name] = {
      file,
      alt: entry.alt,
      source: entry.url
    };

    process.stdout.write(
      `\r  beacon ${n + 1}/${entries.length}`
    );
  }

  process.stdout.write('\n');

  fs.writeFileSync(
    manifestFile,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );

  for (const required of [
    'Runic Tundra',
    'Carboniferous'
  ]) {
    if (!manifest.beacons[required]) {
      throw new Error(
        `RealmEye beacon missing: ${required}`
      );
    }
  }

  console.log(
    `RealmEye biome beacons -> ` +
    `${path.relative(root, assetDir)} ` +
    `(${entries.length} beacons, ${changed} files changed)`
  );

  for (const name of [
    'Runic Tundra',
    'Carboniferous'
  ]) {
    const entry = manifest.beacons[name];

    console.log(
      `  ${name}: ${entry.file} <- ${entry.source}`
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
