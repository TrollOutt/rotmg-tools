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
// Generated HTTP artifacts are checked here, after build-standalone.js writes docs/.
const skinDataTag = '<script src="skin-viewer-data.js"></script>';
const skinAnimationTag = '<script src="skin-viewer-animation.js"></script>';
const skinModuleTag = '<script type="module" src="skins/app.js"></script>';
const servedSkinHtml = served.html;
assert(servedSkinHtml.indexOf(skinAnimationTag) > servedSkinHtml.indexOf(skinDataTag)
  && servedSkinHtml.indexOf(skinAnimationTag) < servedSkinHtml.indexOf(skinModuleTag),
  'HTTP build preserves playback script order');
assert.equal(read('docs/skin-viewer-animation.js'), read('web/skin-viewer-animation.js'),
  'HTTP build serves the exact playback module');
assert(servedSkinHtml.indexOf(skinDataTag) >= 0
  && servedSkinHtml.indexOf(skinDataTag) < servedSkinHtml.indexOf(skinModuleTag),
  'HTTP build preserves catalogue script order');
assert.equal(read('docs/skin-viewer-data.js'), read('web/skin-viewer-data.js'),
  'HTTP build serves the exact catalogue module');
const atlasBuilt = read('web/assets/atlas/index.html');
assert.equal(read('docs/assets/atlas/index.html'), atlasBuilt,
  'HTTP build serves the current generated Atlas page');
console.log('HTTP build: 5 Skin Viewer script order, exact module and Atlas page checks passed.');
const { modulesFor } = require('./home-navigation.test');
for (const [version, skins] of [[served, true], [offline, false]]) {
  const ring = modulesFor(version.html, version.html);
  assert.equal(ring.some(m => m.go === 'skins'), skins,
    'The built home ring must agree with the Skin Viewer page availability');
  assert.equal(ring.some(m => m.walk), skins,
    'Only the served home ring may request the Skin Viewer walking strip');
}
for (const name of ['indexText', 'wikiText', 'theoryText', 'realmLootText', 'clientForgeText']) {
  assert(!served.data.sources[name], name + ' must not increase calculator startup');
  assert(offline.data.sources[name], name + ' missing from the downloadable copy');
}
assert.equal(offline.data.sources.clientForgeText.trim(), read('web/assets/index/client-forge.json').trim());
assert(!served.data.cardFiles && !served.data.cardImages, 'Card extras must stay out of served startup');
assert(offline.data.cardImages['assets/ui/backgrounds/facets.webp'], 'The default Style background must travel with the download');
for (const file of ['assets/index/projectiles.json', 'assets/index/collection-icons.json',
  'assets/realm-monster-animations/index.json', 'assets/realm-biomes/index.json',
  'assets/skins/generated/looks.json', 'assets/skins/generated/skins.json', 'assets/skins/generated/dyes.json']) {
  assert(offline.data.cardFiles[file], file + ': card and browse loaders need an embedded copy');
}
for (const [file, text] of Object.entries(offline.data.cardFiles)) {
  assert.equal(text, read('web/' + file).replace(/\r\n/g, '\n'), file + ': exact card payload');
}
for (const [file, url] of Object.entries(offline.data.cardImages)) {
  assert.deepEqual(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
    fs.readFileSync(path.join(root, 'web', decodeURIComponent(file))), file + ': exact card image');
}
for (const file of ['assets/index/loot-bags.png', 'assets/index/forge-ui.png', 'assets/index/collection-icons.png']) {
  assert(!offline.html.includes('url(' + file + ')'), file + ': card CSS must work from a single file');
}
for (const version of [served, offline]) {
  const cardDataAt = version.html.indexOf('var FichesData =');
  assert(cardDataAt >= 0 && cardDataAt < version.html.indexOf('const cardData = FichesData.createCardData('));
  assert(!version.html.includes('src="fiches-data.js"'), 'Card data module is embedded in both existing builds');
  const resolverAt = version.html.indexOf('var AppData =');
  assert(resolverAt >= 0 && resolverAt < version.html.indexOf('const appData = AppData.createItemResolver('),
    'Calculator data module is inlined before its adapters in both HTML copies');
  assert(!version.html.includes('src="app-data.js"'), 'Built copies never fetch the calculator data module');
  const searchAt = version.html.indexOf('var IndexSearch =');
  const filterAt = version.html.indexOf('var IndexFilter =');
  const groupingAt = version.html.indexOf('var IndexGrouping =');
  const familiesAt = version.html.indexOf('var IndexFamilies =');
  assert(familiesAt > groupingAt && familiesAt < version.html.indexOf('const families = IndexFamilies.createFamilies('));
  assert(!version.html.includes('<script data-lazy-src="index-families.js">'));
  assert(groupingAt > filterAt && groupingAt < version.html.indexOf('const grouped = IndexGrouping.createGrouping('));
  assert(!version.html.includes('<script data-lazy-src="index-grouping.js">'));
  assert(filterAt >= 0 && filterAt < version.html.indexOf('const filterModel = IndexFilter.createFilter('));
  assert(!version.html.includes('<script data-lazy-src="index-filter.js">'));
  const browseAt = version.html.indexOf('IX.search = IndexSearch.createSearch(');
  assert(searchAt >= 0 && browseAt > searchAt,
    'Index search must be inlined before the browse interface in both HTML copies');
  assert(!version.html.includes('<script data-lazy-src="index-search.js">'),
    'Built copies must inline Index search rather than fetch it');
  assert(version.html.includes('var BuildProgression'), 'Progression code missing');
  const engineAt = version.html.indexOf('var TheoryEngine =');
  const uiAt = version.html.indexOf('var TheoryCraft =');
  assert(engineAt >= 0 && uiAt > engineAt,
    'Pure theory engine must be inlined before TheoryCraft in both HTML copies');
  assert(!version.html.includes('<script data-lazy-src="theory-engine.js">'),
    'Built copies must inline the theory engine rather than fetch it');
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
for (const absent of ['skin-viewer-data.js', 'var SkinViewerData =', 'skin-viewer-animation.js', 'var SkinViewerAnimation =', 'skins/app.js', 'data-go="skins"', 'id="skinViewerRoot"']) {
  assert(!offline.html.includes(absent),
    'The downloadable copy must not carry ' + absent + ': it cannot load it from disk');
}
assert(offline.html.includes('home-elsewhere'),
  'The downloadable copy must say where the Skin Viewer went');

console.log('Built scripts compile; download embeds index, theory, wiki and sheets; served startup stays below baseline.');
console.log('The Skin Viewer is offered by the served page only, and the kept copy says where it went.');
