'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const theory = read('web/theorycraft.js');
const cards = read('web/fiches-c.js');
const app = read('web/app.js');
const file = 'assets/realm-biomes/floral-escape.png';
const bytes = fs.readFileSync(path.join(__dirname, '../web', file));
const source = 'data:image/png;base64,' + bytes.toString('base64');

async function main() {
  const blobs = [], window = { ROTMG_BUNDLE: { cardImages: { [file]: source } } };
  const context = { window, Uint8Array, Blob,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:zone-' + blobs.length; } } };
  // Exercise the existing card resolver, including its document-lifetime URL cache.
  vm.runInNewContext(cards.slice(cards.indexOf('  const cardBundle ='), cards.indexOf('  const esc ='))
    + '\nwindow.RealmCardExtras = { asset: cardAssetUrl };', context);
  const harness = { ...context, module: { exports: {} },
    TheoryEngine: require('../web/theory-engine'), BuildProgression: require('../web/progression') };
  vm.runInNewContext(theory.replace('return { start, share, open, put };', 'return { zonePicture };'), harness);
  const picture = harness.module.exports.zonePicture;
  const zone = { icon: file }, expected = src => '<img class="tc-zone-file" width="44" height="44" src="' + src + '" alt="">';
  assert.equal(picture(zone, 44), expected('blob:zone-1'));
  assert.equal(picture(zone, 44), expected('blob:zone-1'));
  assert.equal(window.RealmCardExtras.asset(file), 'blob:zone-1');
  assert.equal(blobs.length, 1, 'Theory and cards share one existing resource URL');
  assert.deepEqual(Buffer.from(await blobs[0].arrayBuffer()), bytes, 'The committed PNG bytes are unchanged');
  window.ROTMG_BUNDLE = { sources: {} }; // The served build also has a bundle, without cardImages.
  assert.equal(picture(zone, 44), expected(file));
  assert.equal(picture({ icon: file + '?v=build' }, 44), expected(file + '?v=build'));
  window.ROTMG_BUNDLE = { cardImages: { [file]: source } };
  delete window.RealmCardExtras;
  assert.equal(picture(zone, 44), expected(source), 'Embedded fallback works before card helpers are available');
  assert.equal(picture(null, 44), '');

  const atlas = app.slice(app.indexOf('let atlasAsked = false;'), app.indexOf('const GLOBE_TAKES'));
  async function probe(bundle, ok) {
    const frame = { src: '', hidden: false, addEventListener() {} }, missing = { hidden: true }, calls = [], ring = [];
    const ctx = { BUNDLE: bundle, window: {}, document: { getElementById: id => id === 'realmFrame' ? frame : missing },
      Ring: { set: (...args) => ring.push(args) }, location: { protocol: 'file:' },
      fetch: async (...args) => { calls.push(args); return { ok }; } };
    vm.runInNewContext(atlas + '\npointAtAtlas(); pointAtAtlas();', ctx);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    return { frame, missing, calls, ring };
  }
  const offline = await probe({ cardImages: {} }, false);
  assert.equal(offline.calls.length, 0, 'The kept HTML never probes the omitted Atlas');
  const absent = await probe({ sources: {} }, false);
  assert.equal(absent.calls.length, 1);
  assert.equal(absent.calls[0][0], 'assets/atlas/atlas.json');
  assert.equal(absent.calls[0][1].method, 'HEAD');
  for (const result of [offline, absent]) {
    assert.equal(result.frame.hidden, true);
    assert.equal(result.missing.hidden, false);
    assert.deepEqual(Array.from(result.ring[0]), [false, false]);
  }
  const served = await probe({ sources: {} }, true);
  assert.equal(served.frame.src, 'assets/atlas/index.html', 'Served Atlas still loads normally');
  assert.equal(served.frame.hidden, false);
  console.log('Standalone zones: shared exact PNG, unchanged served URLs, identical missing-Atlas fallback.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
