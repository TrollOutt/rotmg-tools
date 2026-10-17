'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const { decode, graph } = require('./skin-viewer-harness');
const { exercise, limits } = require('./skin-viewer-animation-harness');
const { createCatalogueData } = require('../web/skin-viewer-data');
const { createSequencePlayback } = require('../web/skin-viewer-animation');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const source = read('web/skins/app.js'), moduleSource = read('web/skin-viewer-animation.js');
// Frozen before extraction at 7d1cafc. Reuse the catalogue inputs; store only
// the 47 distinct playback result graphs, without copying frame geometry.
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'skin-viewer-animation-corpus.json.gz'))));
const catalogues = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'skin-viewer-data-corpus.json.gz'))));
let count = 0;
for (const text of [source.replace(/\r\n/g, '\n'), source.replace(/\r?\n/g, '\r\n')]) {
  catalogues.cases.forEach((frozen, c) => {
    const input = decode(frozen.input), api = createCatalogueData({ getLooks: () => input.looks,
      getActions: () => input.looks.actions || [], getDirections: () => input.looks.directions || [] });
    const { skins } = api.skinEntries(input.skinCatalogue);
    assert.equal(skins.length, corpus.results[c].length);
    skins.forEach((skin, i) => {
      const before = graph(skin);
      assert.deepStrictEqual(exercise(text, moduleSource, skin), corpus.profiles[corpus.results[c][i]], skin.id);
      assert.deepStrictEqual(graph(skin), before, 'Playback preserves input values, order and aliases');
      count++;
    });
  });
  assert.deepStrictEqual(limits(text, moduleSource), corpus.limits, 'Exact operations and live period lookup order');
  for (const edge of corpus.edges)
    assert.deepStrictEqual(exercise(text, moduleSource, decode(edge.input)), edge.expected);
}

// A classic module and one factory, without DOM, graphics, clocks or caches.
const page = {};
vm.runInNewContext(moduleSource, page);
assert.deepStrictEqual(Object.keys(page.SkinViewerAnimation), ['createSequencePlayback']);
assert.equal((source.match(/SkinViewerAnimation\.createSequencePlayback\(/g) || []).length, 1);
assert(!/\b(?:document|window|performance|requestAnimationFrame|Date|Image|WebGL)\b/.test(moduleSource));
let reads = 0, period = 600;
const deps = { getAttackPeriod() { reads++; return period; } }, api = createSequencePlayback(deps);
const frames = [{ spriteAvailable: false }, { spriteAvailable: true }, { spriteAvailable: false }, { spriteAvailable: true }];
const seq = { set: 0, actionRaw: 2, directionRaw: 0, frames };
assert.equal(api.attackFrameIndex(seq, 0, 300, 0), 3);
period = 1200;
assert.equal(api.attackFrameIndex(seq, 0, 300, 0), 1, 'Period is read live');
deps.getAttackPeriod = () => { reads++; return 200; };
assert.equal(api.attackFrameIndex(seq, 0, 300, 0), 3, 'Dependency function is read live');
assert.equal(reads, 3);
for (const absent of [null, undefined, { actionRaw: 0, frames }, { actionRaw: 2, frames: [] }, { actionRaw: 2, frames: [frames[0]] }])
  assert.equal(api.attackFrameIndex(absent, 7, NaN, Infinity), 7);
assert.equal(reads, 3, 'No period lookup for an inactive or unplayable sequence');
assert.strictEqual(api.current(seq, 3), frames[3]);
assert.strictEqual(api.sequence([seq], 2, 0, 0), seq);
assert.equal(api.nextIndex(seq, 1), 3);
assert.equal(api.nextIndex(seq, 3), 1);
assert.equal(api.nextIndex(null, 7), 7);
const other = createSequencePlayback({ getAttackPeriod: () => 1200 });
assert.equal(other.attackFrameIndex(seq, 0, 300, 0), 1, 'Concurrent viewers have independent dependencies');
assert.equal(api.attackFrameIndex(seq, 0, 300, 0), 3);
console.log(`Skin playback: ${count} skin replays (LF/CRLF), frozen edges, identities and live DOM-free factory pass.`);
