'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), vm = require('vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function bundle(file) {
  const html = read(file);
  const match = /<script>window\.ROTMG_BUNDLE=([\s\S]*?);<\/script>/.exec(html);
  assert(match, file + ': no embedded bundle');
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    new vm.Script(script[1]); // Compile only; do not run a browser or contact a service.
  }
  return { html, data: JSON.parse(match[1]) };
}
const served = bundle('docs/index.html'), offline = bundle('docs/Realm-Tools.html');
for (const name of ['indexText', 'wikiText', 'theoryText', 'realmLootText']) {
  assert(!served.data.sources[name], name + ' must not increase calculator startup');
  assert(offline.data.sources[name], name + ' missing from the downloadable copy');
}
for (const version of [served, offline]) {
  assert(version.html.includes('var BuildProgression'), 'Progression code missing');
}
assert(JSON.parse(offline.data.sources.realmLootText).creatures, 'Biome loot evidence missing');
assert.equal(read('docs/assets/theory/progression.json').trim(), offline.data.sources.realmLootText);
const privateIndex = JSON.parse(read('data/Index/index.json'));
const publicIndex = JSON.parse(offline.data.sources.indexText);
const servedIndex = JSON.parse(read('docs/assets/index/index.json'));

function publicIndexProjection(source) {
  const out = JSON.parse(JSON.stringify(source));

  delete out.files;
  delete out.from;

  for (const one of out.records || []) {
    delete one.from;
    delete one.also;
    for (const fold of one.folds || []) delete fold.from;
  }

  return out;
}

assert(
  privateIndex.records.some(one => one.from),
  'Private local Index must retain client provenance'
);

assert.deepEqual(
  publicIndex,
  publicIndexProjection(privateIndex),
  'Download must contain only the public Index projection'
);

assert.deepEqual(
  servedIndex,
  publicIndex,
  'Served and downloadable public Index projections must match'
);

for (const [where, index] of [
  ['download', publicIndex],
  ['served', servedIndex]
]) {
  assert(!Object.hasOwn(index, 'files'), where + ': client file table must stay private');
  assert(!Object.hasOwn(index, 'from'), where + ': build source metadata must stay private');

  for (const one of index.records || []) {
    assert(!Object.hasOwn(one, 'from'), where + ': record source address must stay private');
    assert(!Object.hasOwn(one, 'also'), where + ': duplicate source addresses must stay private');

    for (const fold of one.folds || []) {
      assert(!Object.hasOwn(fold, 'from'), where + ': folded source address must stay private');
    }
  }

  assert(
    !/Objects\.\d+\.xml/i.test(JSON.stringify(index)),
    where + ': client document names must never be published'
  );
}

const theory = read('data/TheoryCraft/theorycraft.json').replace(/\r\n/g, '\n');
assert.equal(offline.data.sources.theoryText.trim(), theory.trim());
assert.equal(read('docs/assets/theory/theorycraft.json').trim(), theory.trim());
assert(offline.data.theorySheet.startsWith('data:image/png;base64,'));
assert(offline.data.indexSheet.startsWith('data:image/png;base64,'));
assert(Buffer.byteLength(served.html) <= 5256587, 'Calculator startup exceeds the measured pre-migration size');

/*
 * The Skin Viewer is served and not downloaded.
 *
 * It is the one tool that is not inlined: it is a module, and it reads
 * seventy-five megabytes of the client's character and object sheets from
 * beside the page. A file opened from disk can do neither, so the card it
 * offered in the downloadable copy opened a page that stayed empty. The
 * downloadable copy leaves it out and says so instead.
 */
assert(served.html.includes('<script type="module" src="skins/app.js">'),
  'The served page must still load the Skin Viewer module');
assert(served.html.includes('data-go="skins"'),
  'The served page must still offer the Skin Viewer');
for (const absent of ['skins/app.js', 'data-go="skins"', 'id="skinViewerRoot"']) {
  assert(!offline.html.includes(absent),
    'The downloadable copy must not carry ' + absent + ': it cannot load it from disk');
}
assert(offline.html.includes('home-elsewhere'),
  'The downloadable copy must say where the Skin Viewer went');

console.log('Built scripts compile; download embeds index, theory, wiki and sheets; served startup stays below baseline.');
console.log('The Skin Viewer is offered by the served page only, and the kept copy says where it went.');
