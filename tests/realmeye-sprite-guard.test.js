'use strict';
// ROT-B-15: the RealmEye sprite cache keeps only images, from RealmEye, after
// a few redirects at most. Offline, on made-up bytes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { imageKind, isRealmEye, redirectTarget, realmEyeGet, MAX_REDIRECTS } = require('../tools/realmeye-sprite-guard.js');

const pad = head => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
assert.strictEqual(imageKind(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
assert.strictEqual(imageKind(pad(Buffer.from('GIF89a'))), 'gif');
assert.strictEqual(imageKind(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'webp');
assert.strictEqual(imageKind(pad([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
// The error page answered with a 200: not an image, so not written.
assert.strictEqual(imageKind(Buffer.from('<!doctype html><html><body>Just a moment...</body></html>')), null);
assert.strictEqual(imageKind(Buffer.alloc(0)), null);

assert.ok(isRealmEye('https://www.realmeye.com/s/a/img/x.png'));
assert.ok(!isRealmEye('http://www.realmeye.com/s/a/img/x.png'));
assert.ok(!isRealmEye('https://realmeye.com.example.org/x.png'));

const from = 'https://www.realmeye.com/s/a/img/x.png';
assert.strictEqual(redirectTarget('/s/b/img/x.png', from, 0), 'https://www.realmeye.com/s/b/img/x.png');
assert.throws(() => redirectTarget('https://elsewhere.example/x.png', from, 0), /away from RealmEye/);
assert.throws(() => redirectTarget('/s/c/x.png', from, MAX_REDIRECTS), /more than 5 redirects/);
assert.throws(() => redirectTarget('', from, 0), /without a location/);

// R4: nothing is requested from another host, not even the first address.
const asked = [];
const fakeGet = (url, options, callback) => { asked.push(url); return { url, options, callback }; };
assert.throws(() => realmEyeGet(fakeGet, 'https://elsewhere.example/x.png', {}, () => {}), /not requested/);
assert.throws(() => realmEyeGet(fakeGet, 'http://www.realmeye.com/x.png', {}, () => {}), /not requested/);
assert.deepStrictEqual(asked, []);
realmEyeGet(fakeGet, from, {}, () => {});
assert.deepStrictEqual(asked, [from]);
// The fetcher goes through it for every request, redirects included (they call request() again).
const fetcher = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fetch-realmeye-index-sprites.js'), 'utf8');
assert.ok(!fetcher.includes('https.get(url'), 'the fetcher must not call https.get directly');
assert.ok(fetcher.includes('guard.realmEyeGet(https.get, url'));

// Every sprite already published is a real image.
const dir = path.join(__dirname, '..', 'web', 'assets', 'index', 'realmeye-sprites');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
for (const [id, sprite] of Object.entries(manifest.sprites)) {
  const file = path.join(dir, sprite.file);
  if (!fs.existsSync(file)) continue;
  assert.ok(imageKind(fs.readFileSync(file)), `${id}: ${sprite.file} is not an image`);
  assert.ok(isRealmEye(sprite.source), `${id}: source outside RealmEye`);
}

console.log('realmeye sprite guard: ok');
