'use strict';
/*
 * Fetch the current client build from the game's CDN, with no installation.
 *
 *   node tools/fetch-client.js [--dir <dir>]   download it if the build is new
 *   node tools/fetch-client.js --scrape        then run `npm run scrape` on it
 *                                              if the data is on another build
 *   node tools/fetch-client.js --check         download nothing; print, as JSON,
 *                                              whether the data is on another build
 *
 * The launcher's own route: /app/init names the current build, checksum.json
 * lists its files with the MD5 of each decompressed file, and each file sits
 * beside it as <path>.gz. Only the three files the scrape reads are taken.
 *
 * /app/init answers without build fields unless given the launcher's key. It
 * is read from ROTMG_APP_KEY, else local/rotmg-app-key.txt, rather than written
 * here, so publishing this repository never publishes it.
 *
 * Files keep the CDN's Last-Modified as their date, because the extraction
 * dates a build from its resources.assets: a download stamped today would
 * misdate the build in every catalogue and in data/client-changes.txt.
 *
 * A build arrives whole or not at all. Everything lands in a partial folder
 * and is verified before replacing the previous download, so a cut connection
 * can never leave the textures of one build beside the XML of another.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const INIT_URL = 'https://www.realmofthemadgod.com/app/init?platform=standalonewindows64&key=';
const KEY_FILE = path.join(root, 'local', 'rotmg-app-key.txt');
const DEFAULT_DIR = path.join(root, 'local', 'client');
const CDN_HOST = 'rotmg-build.decagames.com';
const MARKER = 'fetched-build.json';
const WANTED = [
  'RotMG Exalt_Data/resources.assets',
  'RotMG Exalt_Data/resources.assets.resS',
  'RotMG Exalt_Data/boot.config'
];

/* What /app/init says, refused unless it points at the game's own CDN. */
function parseBuild(xml) {
  const tag = name => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
  const [hash, id, cdn] = [tag('BuildHash'), tag('BuildId'), tag('BuildCDN')];
  if (!hash || !id || !cdn) throw new Error('/app/init named no build: has the launcher key changed?');
  if (!/^[\w.-]+$/.test(hash) || !/^[\w.-]+$/.test(id)) throw new Error(`/app/init named an odd build: ${id} ${hash}`);
  const url = new URL(cdn);
  if (url.protocol !== 'https:' || url.hostname !== CDN_HOST) throw new Error(`/app/init named an unexpected CDN: ${cdn}`);
  return { hash, id, base: `${cdn.replace(/\/+$/, '')}/${hash}/${id}/` };
}

async function latestBuild(key, get = fetch) {
  const response = await get(INIT_URL + encodeURIComponent(key), { method: 'POST', body: '' });
  if (!response.ok) throw new Error(`/app/init answered ${response.status}`);
  return parseBuild(await response.text());
}

/* The manifest's entries for the wanted files; its paths may use either slash. */
function pickFiles(manifest) {
  const byPath = new Map(manifest.files.map(file => [file.file.replaceAll('\\', '/'), file]));
  return WANTED.map(wanted => {
    const file = byPath.get(wanted);
    if (!file) throw new Error(`checksum.json does not list ${wanted}`);
    return { path: wanted, checksum: file.checksum };
  });
}

async function fetchFile(base, file, out, get) {
  const url = base + file.path.split('/').map(encodeURIComponent).join('/') + '.gz';
  const response = await get(url);
  if (!response.ok) throw new Error(`${file.path}: the CDN answered ${response.status}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const md5 = crypto.createHash('md5');
  await pipeline(
    Readable.fromWeb(response.body),
    zlib.createGunzip(),
    async function* (chunks) { for await (const chunk of chunks) { md5.update(chunk); yield chunk; } },
    fs.createWriteStream(out)
  );
  const actual = md5.digest('hex');
  if (actual !== file.checksum) throw new Error(`${file.path}: MD5 ${actual}, the manifest says ${file.checksum}`);
  const modified = new Date(response.headers.get('last-modified'));
  if (Number.isNaN(modified.getTime())) throw new Error(`${file.path}: the CDN gave no Last-Modified to date the build by`);
  fs.utimesSync(out, modified, modified);
  console.log(`  ${file.path}  ${(fs.statSync(out).size / 1048576).toFixed(1)} MB  ${modified.toISOString().slice(0, 10)}`);
}

function currentHash(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')).hash; } catch (error) { return null; }
}

/* Replaces only an earlier download: a folder without the marker may be a real client. */
async function download(build, dir, get = fetch) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length && !currentHash(dir)) {
    throw new Error(`${dir} is not an earlier download; refusing to replace it`);
  }
  const response = await get(build.base + 'checksum.json');
  if (!response.ok) throw new Error(`checksum.json: the CDN answered ${response.status}`);
  const files = pickFiles(await response.json());

  const partial = dir + '.partial';
  fs.rmSync(partial, { recursive: true, force: true });
  fs.mkdirSync(partial, { recursive: true });
  for (const file of files) await fetchFile(build.base, file, path.join(partial, file.path), get);
  fs.writeFileSync(path.join(partial, MARKER), JSON.stringify({ hash: build.hash, id: build.id }) + '\n');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(partial, dir);
}

function recordedBuild() {
  return require('./provenance').read(path.join(root, 'data', 'client-snapshot.txt'))?.from?.build;
}

function bootBuild(dir) {
  const boot = fs.readFileSync(path.join(dir, 'RotMG Exalt_Data', 'boot.config'), 'utf8');
  return /build-guid=([0-9a-f]+)/i.exec(boot)?.[1];
}

/* The build's own id, from its boot.config alone: a few hundred bytes, not the whole build. */
async function remoteBootBuild(build, get = fetch) {
  const response = await get(build.base + 'RotMG%20Exalt_Data/boot.config.gz');
  if (!response.ok) throw new Error(`boot.config: the CDN answered ${response.status}`);
  const boot = zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
  const guid = /build-guid=([0-9a-f]+)/i.exec(boot)?.[1];
  if (!guid) throw new Error('boot.config names no build-guid');
  return guid;
}

function launcherKey() {
  if (process.env.ROTMG_APP_KEY) return process.env.ROTMG_APP_KEY.trim();
  if (!fs.existsSync(KEY_FILE)) throw new Error(`The launcher key goes in ${KEY_FILE} or ROTMG_APP_KEY`);
  return fs.readFileSync(KEY_FILE, 'utf8').trim();
}

async function main() {
  const args = process.argv.slice(2);
  const dirAt = args.indexOf('--dir');
  const dir = path.resolve(dirAt >= 0 ? args[dirAt + 1] : DEFAULT_DIR);

  const build = await latestBuild(launcherKey());
  if (args.includes('--check')) {
    const guid = await remoteBootBuild(build), recorded = recordedBuild();
    console.log(JSON.stringify({ hash: build.hash, guid, recorded, new: guid !== recorded }));
    return;
  }
  if (currentHash(dir) === build.hash) {
    console.log(`\n  Build ${build.hash} is already in ${dir}\n`);
  } else {
    console.log(`\n  New build ${build.hash}`);
    await download(build, dir);
    console.log(`  -> ${dir}\n`);
  }

  if (!args.includes('--scrape')) return;
  if (bootBuild(dir) === recordedBuild()) {
    console.log('  The data is already on this build; nothing to scrape.\n');
    return;
  }
  const scrape = spawnSync('npm', ['run', 'scrape'], {
    cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ROTMG_CLIENT: dir }
  });
  process.exitCode = scrape.status ?? 1;
}

module.exports = { parseBuild, latestBuild, pickFiles, download, currentHash, remoteBootBuild };

if (require.main === module) {
  main().catch(error => {
    console.error(`\n  ${error.message}\n`);
    // Not process.exit: on Windows it aborts Node while fetch's sockets are closing.
    process.exitCode = 1;
  });
}
