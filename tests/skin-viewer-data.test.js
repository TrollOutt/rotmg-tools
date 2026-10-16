'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const { graph, decode, run, response, flush } = require('./skin-viewer-harness');
const { createCatalogueData } = require('../web/skin-viewer-data');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('web/skins/app.js'), dataModule = read('web/skin-viewer-data.js');
// Recorded from the unchanged Viewer at d2ed492, outside the repository.
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'skin-viewer-data-corpus.json.gz'))));
function create(input) {
  const actions = input.looks.actions || [], directions = input.looks.directions || [];
  return createCatalogueData({ getLooks: () => input.looks, getActions: () => actions, getDirections: () => directions });
}
function project(api, input) {
  const { skins, undrawn } = api.skinEntries(input.skinCatalogue);
  const dyes = api.dyeEntries(input.dyeCatalogue), classes = api.classEntries(input.classCatalogue);
  return { input, skins, undrawn, dyes, classes, indexBridge: api.indexBridge(skins, dyes), missing: [api.framesOf(null), api.framesOf(undefined)] };
}
function checkAliases(result) {
  const { input, skins, undrawn, dyes, classes, indexBridge } = result;
  for (const one of undrawn) assert(input.skinCatalogue.skins.includes(one));
  for (const skin of skins) {
    const record = input.skinCatalogue.skins.find(one => one.id === skin.indexId);
    if (record.unlockers) assert.strictEqual(skin.unlockers, record.unlockers);
    if (record.sets) assert.strictEqual(skin.sets, record.sets);
    for (const sequence of skin.sequences) for (const frame of sequence.frames) {
      assert.strictEqual(sequence.frames[frame.frame], frame);
      assert(skin.frames.includes(frame), 'Flat and sequenced frames share the same object');
    }
  }
  for (const [name, entry] of Object.entries(indexBridge.skins)) {
    const skin = skins.filter(one => one.id === name).at(-1);
    assert.strictEqual(entry.unlockers, skin.unlockers);
    assert.strictEqual(entry.sets, skin.sets);
    assert.notStrictEqual(entry.target, entry.match);
  }
  for (const dye of dyes) {
    const record = input.dyeCatalogue.dyes.find(one => one.id === dye.indexId), made = input.looks.dyes[record.type];
    if (dye.textile) assert.strictEqual(dye.textile.rect, made.cloth.rect);
    if (dye.icon) assert.strictEqual(dye.icon.rect, made.icon.rect);
  }
  for (let i = 0; i < classes.length; i++) if (classes[i].icon)
    assert.strictEqual(classes[i].icon.rect, input.looks.classes[input.classCatalogue.classes[i].type].rect);
}

(async () => {
  let skinCount = 0, frameCount = 0, dyeCount = 0, classCount = 0;
  for (const frozen of corpus.cases) {
    const input = decode(frozen.input), api = create(input), result = project(api, input);
    assert.deepStrictEqual(graph(result), frozen.expected, 'Exact values, property order and reference graph');
    checkAliases(result);
    const page = run({ source, dataModule, input, answer: key => Promise.resolve(response(key, input)) });
    assert.equal(page.creations(), 0, 'Factory is not created before catalogues load');
    const mounting = page.api.mount(page.host), concurrent = page.api.mount(page.host);
    assert.strictEqual(mounting, concurrent);
    const adapted = await mounting;
    assert.strictEqual(await concurrent, adapted);
    assert.strictEqual(await page.api.mount(page.host), adapted, 'Revisit reuses its projected catalogue');
    assert.equal(page.creations(), 1, 'One data factory per mounted viewer, shared across projections');
    const { skins, undrawn, dyes, classes, indexBridge } = adapted;
    assert.deepStrictEqual(graph({ input, skins, undrawn, dyes, classes, indexBridge,
      missing: [api.framesOf(null), api.framesOf(undefined)] }), frozen.expected, 'Real adapters reproduce frozen outputs');
    skinCount += input.skinCatalogue.skins.length; dyeCount += input.dyeCatalogue.dyes.length;
    classCount += input.classCatalogue.classes.length;
    frameCount += Object.values(input.looks.skins).reduce((n, g) => n + g.frames.length, 0);
    const again = api.skinEntries(input.skinCatalogue);
    assert.notStrictEqual(again.skins, result.skins, 'Projection has no result cache');
    if (result.skins.length) {
      assert.notStrictEqual(again.skins[0], result.skins[0]);
      assert.notStrictEqual(again.skins[0].frames[0], result.skins[0].frames[0]);
    }
    assert.notStrictEqual(api.framesOf(null).frames, api.framesOf(null).frames);
  }

  // Import and execution need no browser globals, canvas, network, or storage.
  const isolated = {};
  vm.runInNewContext(dataModule, isolated);
  const empty = decode(corpus.cases[2].input);
  const noDOM = decode(corpus.cases[1].input);
  const independent = isolated.SkinViewerData.createCatalogueData({ getLooks: () => noDOM.looks,
    getActions: () => noDOM.looks.actions || [], getDirections: () => noDOM.looks.directions || [] });
  assert.deepStrictEqual(graph(project(independent, noDOM)), corpus.cases[1].expected);
  for (const name of ['document', 'window', 'localStorage', 'canvas', 'fetch']) assert(!(name in isolated));

  // Dependency methods and the values they supply can both change after creation.
  const input = decode(corpus.cases[1].input), reads = [];
  let looks = input.looks, actions = looks.actions, directions = looks.directions;
  const deps = { getLooks: () => { reads.push('looks'); return looks; },
    getActions: () => { reads.push('actions'); return actions; },
    getDirections: () => { reads.push('directions'); return directions; } };
  const live = createCatalogueData(deps);
  assert.deepStrictEqual(reads, [], 'Construction performs no reads, loading, or projection');
  const geometry = { frames: [[0, 0, 0, -0, 0, 8, 8, -1, -1]] };
  assert.equal(live.framesOf(geometry).frames[0].action, 'idle');
  actions[0] = 'changed'; assert.equal(live.framesOf(geometry).frames[0].action, 'changed');
  actions = ['replacement']; directions = ['new direction'];
  assert.equal(live.framesOf(geometry).frames[0].action, 'replacement');
  deps.getActions = () => ['method replacement']; deps.getDirections = () => ['method direction'];
  const changed = live.framesOf(geometry).frames[0];
  assert.equal(changed.action, 'method replacement'); assert.equal(changed.direction, 'method direction');
  assert(Object.is(changed.rect.x, -0));
  looks = empty.looks;
  assert.equal(live.skinEntries(input.skinCatalogue).skins.length, 0);
  assert.equal(live.dyeEntries(input.dyeCatalogue).length, 0);
  assert(live.classEntries(input.classCatalogue).every(one => one.icon === null));
  deps.getLooks = () => input.looks;
  assert.equal(live.skinEntries(input.skinCatalogue).skins.length, 4);
  assert.equal(live.dyeEntries(input.dyeCatalogue).length, 4);
  const firstClass = live.classEntries(input.classCatalogue)[0];
  input.looks.classes['0x1'].rect.x = 99;
  assert.strictEqual(live.classEntries(input.classCatalogue)[0].icon.rect, firstClass.icon.rect);
  assert.equal(firstClass.icon.rect.x, 99);
  for (const frozen of corpus.errors) assert.throws(() => live.framesOf(decode(frozen.input)), { name: frozen.name });

  // Exact request phases from the original adapter, including concurrency,
  // optional failure and a fresh mount after required catalogue failure.
  for (const expected of corpus.loaders) {
    const input = decode(corpus.cases[0].input), { mode } = expected;
    let fail = mode === 'required-failure';
    const page = run({ source, dataModule, input, answer: (key, held) => {
      if (mode === 'held' && !key.endsWith('view.html')) return new Promise(resolve => held.push(() => resolve(response(key, input))));
      if (fail && key.endsWith('/looks.json')) return Promise.reject(Error('reference failure'));
      if (mode === 'optional-failure' && ['combat.json', 'things.json', 'things.bin', 'projectiles.json'].some(t => key.endsWith(t)))
        return Promise.reject(Error('optional'));
      return Promise.resolve(response(key, input));
    } });
    const first = page.api.mount(page.host), second = page.api.mount(page.host);
    assert.strictEqual(first, second); first.catch(() => {});
    const journal = []; await flush(); journal.push([...page.calls]);
    if (mode === 'held') assert.equal(page.creations(), 0, 'Pending data does not initialize projections');
    while (page.pending.length) { page.pending.splice(0).forEach(release => release()); await flush(); journal.push([...page.calls]); }
    let result;
    try { result = await first; assert.strictEqual(result, await second); }
    catch (error) { result = error.message; }
    const callsAfter = [...page.calls];
    if (fail) {
      assert.equal(page.creations(), 0, 'Failed required load never creates data factory');
      fail = false; await page.api.mount(page.host); journal.push([...page.calls]);
    } else assert.strictEqual(await page.api.mount(page.host), result);
    assert.equal(page.creations(), 1);
    assert.deepStrictEqual({ mode, journal, callsAfter, calls: [...page.calls], failure: typeof result === 'string' ? result : null }, expected);
  }
  console.log(`Skin Viewer data parity: ${skinCount} skins, ${frameCount} frames, ${dyeCount} dyes, ${classCount} classes; direct and adapted graphs identical. Live dependencies, references, no cache, DOM independence and 3 loading journals verified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
