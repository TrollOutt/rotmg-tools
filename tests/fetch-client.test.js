'use strict';

/*
 * tools/fetch-client.js against a pretend CDN, so no network is involved. The
 * cases that matter are the ones that must leave the previous download alone:
 * a corrupt file, or a folder that is really somebody's installed client.
 */
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { parseBuild, latestBuild, pickFiles, download, currentHash, remoteBootBuild } = require('../tools/fetch-client');

const md5 = text => crypto.createHash('md5').update(text).digest('hex');
const init = (cdn = 'https://rotmg-build.decagames.com/build-release/', hash = 'abc123') =>
  `<AppSettings><BuildId>rotmg-exalt-win-64</BuildId><BuildHash>${hash}</BuildHash><BuildCDN>${cdn}</BuildCDN>`
  + '<LauncherBuildHash>launcher</LauncherBuildHash></AppSettings>';

assert.deepEqual(parseBuild(init()), {
  hash: 'abc123',
  id: 'rotmg-exalt-win-64',
  base: 'https://rotmg-build.decagames.com/build-release/abc123/rotmg-exalt-win-64/'
}, 'FETCH-001 reads the build, not the launcher build');
assert.throws(() => parseBuild('<AppSettings><UseExternalPayments>1</UseExternalPayments></AppSettings>'), /no build/,
  'FETCH-002 an answer without build fields is an error');
assert.throws(() => parseBuild(init('https://example.com/build/')), /unexpected CDN/, 'FETCH-003 only the game\'s CDN');
assert.throws(() => parseBuild(init('http://rotmg-build.decagames.com/build-release/')), /unexpected CDN/, 'FETCH-004 https only');
assert.throws(() => parseBuild(init(undefined, '../..')), /odd build/, 'FETCH-005 a hash cannot walk the URL');

assert.throws(() => pickFiles({ files: [] }), /does not list/, 'FETCH-006 a missing wanted file is an error');

const CONTENT = {
  'RotMG Exalt_Data/resources.assets': 'assets',
  'RotMG Exalt_Data/resources.assets.resS': 'streams',
  'RotMG Exalt_Data/boot.config': 'build-guid=f1f4\n'
};
const MODIFIED = 'Wed, 14 Oct 2026 08:57:56 GMT';

/* A CDN holding the files above; `corrupt` serves one with the wrong bytes. */
function cdn(build, corrupt) {
  return async url => {
    const file = decodeURIComponent(url.slice(build.base.length));
    if (file === 'checksum.json') {
      return Response.json({ files: Object.entries(CONTENT).map(([name, text]) =>
        ({ file: name.replaceAll('/', '\\'), checksum: md5(text), size: 1 })) });
    }
    const name = file.replace(/\.gz$/, '');
    if (!(name in CONTENT)) return new Response('', { status: 404 });
    const text = name === corrupt ? 'tampered' : CONTENT[name];
    return new Response(zlib.gzipSync(text), { headers: { 'last-modified': MODIFIED } });
  };
}

(async () => {
  let asked;
  const found = await latestBuild('k y', async (url, options) => {
    asked = { url, method: options.method };
    return new Response(init());
  });
  assert.equal(found.hash, 'abc123');
  assert.equal(asked.method, 'POST', 'FETCH-007 /app/init is a POST');
  assert.ok(asked.url.endsWith('key=k%20y'), 'FETCH-008 the key is encoded into the URL');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-client-'));
  try {
    const dir = path.join(work, 'client');
    const first = parseBuild(init());
    await download(first, dir, cdn(first));
    for (const [name, text] of Object.entries(CONTENT)) {
      assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), text, `FETCH-009 ${name} is decompressed`);
    }
    assert.equal(currentHash(dir), 'abc123', 'FETCH-010 the download records its build');
    const assets = path.join(dir, 'RotMG Exalt_Data', 'resources.assets');
    assert.equal(fs.statSync(assets).mtime.toISOString().slice(0, 10), '2026-10-14',
      'FETCH-011 a file is dated by the CDN, not by the day it was fetched');

    const second = parseBuild(init(undefined, 'def456'));
    await assert.rejects(download(second, dir, cdn(second, 'RotMG Exalt_Data/resources.assets.resS')), /MD5/,
      'FETCH-012 a corrupt file is an error');
    assert.equal(currentHash(dir), 'abc123', 'FETCH-013 a failed download leaves the previous build whole');

    await download(second, dir, cdn(second));
    assert.equal(currentHash(dir), 'def456', 'FETCH-014 a good download replaces the previous build');
    assert.ok(!fs.existsSync(dir + '.partial'), 'FETCH-015 nothing partial is left behind');

    const installed = path.join(work, 'installed');
    fs.mkdirSync(installed);
    fs.writeFileSync(path.join(installed, 'RotMG Exalt.exe'), 'real');
    await assert.rejects(download(first, installed, cdn(first)), /not an earlier download/,
      'FETCH-016 a real client is never replaced');
    assert.ok(fs.existsSync(path.join(installed, 'RotMG Exalt.exe')), 'FETCH-017 the real client is untouched');

    assert.equal(await remoteBootBuild(first, cdn(first)), 'f1f4', 'FETCH-018 the build id is read from boot.config alone');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log('fetch-client: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
