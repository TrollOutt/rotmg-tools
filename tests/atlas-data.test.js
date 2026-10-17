'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const { makeApi, digest, project, journal, graph, decode } = require('./atlas-data-harness');
const { createPanelData } = require('../web/atlas-data');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('tools/atlas-viewer.html'), dataModule = read('web/atlas-data.js');
// Frozen outside the repository from the unmodified Atlas at 5e69490.
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'atlas-data-corpus.json.gz'))));
const options = { source, dataModule };
const knownKeys = ['ids', 'drops', 'pics', 'named'];
(async () => {
  const real = {
    atlas: JSON.parse(read('web/assets/atlas/atlas.json')),
    kin: JSON.parse(read('web/assets/atlas/index.html').match(/^const KIN = (.*);$/m)[1]),
    files: {
      '/atlas/../index/wiki.json': JSON.parse(read('web/assets/index/wiki.json')),
      '/atlas/../../realmeye-data.json': JSON.parse(read('web/realmeye-data.json')),
      '/atlas/../index/item-art.json': JSON.parse(read('web/assets/index/item-art.json'))
    }
  };
  let queries = 0;
  for (const frozen of corpus.cases) {
    const input = frozen.name === 'real' ? real : decode(frozen.input);
    const result = await project(input, options);
    queries += result.queries.length;
    if (frozen.name === 'real') {
      assert.equal(result.queries.length, frozen.queryCount);
      assert.deepStrictEqual(knownKeys.map(k => result.known[k].length), frozen.mapCounts);
      assert.equal(digest(result), frozen.hash, 'Full ordered lookup results and source-reference graph');
      assert.equal(digest(Object.fromEntries(knownKeys.map(k => [k, result.known[k]]))), frozen.expectedMaps);
      assert.deepStrictEqual(graph(result.queries.filter((_, i) => i % 997 === 0)), frozen.samples);
      assert.deepStrictEqual(result.pairs, frozen.pairs);
    } else assert.deepStrictEqual(graph(result), frozen.expected, frozen.name + ' exact values, order and aliases');

    const adapter = makeApi({ ...options, input });
    assert.equal(adapter.creations(), 1, 'One factory at page initialization, before any data request');
    assert.deepStrictEqual(adapter.asked, []);
    await adapter.load();
    const joined = adapter.getKnown();
    assert.equal(await adapter.load(), 1, 'Only the first panel callback runs, including concurrent and later calls');
    assert.strictEqual(adapter.getKnown(), joined, 'Lazy catalogue identity persists');
    assert.equal(adapter.creations(), 1);
    const art = input.files['/atlas/../index/item-art.json'];
    const sourceRects = new Map(Object.entries((art && art.art) || {})
      .map(([name, rect]) => [adapter.knownName(name), rect]));
    for (const [name, rect] of sourceRects)
      assert.strictEqual(joined.pics.get(name), rect, 'No rectangle copy, including duplicate normalized names');
    for (const [name, members] of Object.entries((input.kin && input.kin.groups) || {}))
      assert.strictEqual(adapter.kinOf.group(name), members, 'Group members retain their source identity');

    let current = joined, reads = 0;
    const direct = createPanelData({ getKnown: () => { reads++; return current; }, getKinds: () => input.kin, getAtlas: () => input.atlas });
    const values = Object.values(input.files);
    const projected = direct.projectKnown(values[0], values[1], values[2], () => '/atlas/../index/sheet.png');
    assert.equal(digest(Object.fromEntries(knownKeys.map(k => [k, [...projected[k]]]))),
      digest(Object.fromEntries(knownKeys.map(k => [k, [...joined[k]]]))));
    assert.notStrictEqual(projected, joined);
    const fresh = direct.projectKnown(values[0], values[1], values[2], () => 'new-sheet');
    assert.notStrictEqual(fresh.ids, projected.ids, 'Each projection owns fresh maps');
    for (const [name, list] of projected.drops) assert.notStrictEqual(fresh.drops.get(name), list, 'Drop lists are fresh');
    for (const [name, rect] of projected.pics) assert.strictEqual(fresh.pics.get(name), rect);
    for (const [name, normalized, id, itemId, group, mundane, portal] of result.queries) {
      assert.equal(direct.knownName(name), normalized);
      assert.equal(direct.knownId(name, ['enemy', 'portal', 'item']), id);
      assert.equal(direct.knownId(name, ['item', 'portal', 'enemy']), itemId);
      assert.deepStrictEqual(direct.kinOf.group(name), group);
      assert.equal(direct.kinOf.mundane(name), mundane);
      assert.equal(direct.portalOf(name), portal);
    }
    assert.equal(reads, result.queries.length * 2, 'Current join is read at each call');
    current = null;
    assert.equal(direct.knownId('anything', ['item']), '');
    current = direct.projectKnown({ ids: ['item:Changed'] }, null, null, () => 'live');
    assert.equal(direct.knownId('changed', ['item']), 'item:Changed', 'Replaced joins are visible without another factory');
  }
  assert.deepStrictEqual(graph(await journal(options)), corpus.journals,
    'Seven frozen journals: exact request/reply/json order, concurrency, host payloads, terminal failure and retry calls');

  let kinds = null, atlas = null, kindReads = 0, atlasReads = 0;
  const api = createPanelData({ getKnown: () => null,
    getKinds: () => { kindReads++; return kinds; }, getAtlas: () => { atlasReads++; return atlas; } });
  assert.equal(kindReads + atlasReads, 0, 'No eager reads');
  kinds = { groups: { Eggs: ['first'] }, mundane: ['before'] };
  const members = api.kinOf.group('eggs');
  kinds = { groups: { Eggs: ['second'] }, mundane: ['after'] };
  assert(api.kinOf.mundane('after'), 'Independent caches read their dependency at their own first call');
  members.push('mutated');
  assert.strictEqual(api.kinOf.group('EGGS'), members);
  assert.equal(members.length, 2);
  atlas = { zones: [{ loot: { dungeons: [{ name: 'Gate', art: 'first' }, { name: 'GATE', art: 'last' }] } }] };
  assert.equal(api.portalOf('gate'), 'last');
  atlas = { zones: [] };
  assert.equal(api.portalOf('gate'), 'last', 'Portal cache is intentionally not invalidated');
  assert.equal(atlasReads, 1);
  assert.equal(kindReads, 2);
  const absent = createPanelData({ getKnown: () => null, getKinds: () => null, getAtlas: () => undefined });
  assert.equal(absent.portalOf('gate'), ''); assert.equal(absent.kinOf.group('eggs'), null); assert.equal(absent.kinOf.mundane(''), false);
  assert.deepStrictEqual(decode(corpus.extra.names).map(api.knownName), corpus.extra.normalized);
  assert.deepStrictEqual(corpus.extra.beside.map(b => [b, api.blueprintFor(b, corpus.extra.beside)]), corpus.extra.pairs);
  const shared = [NaN, -0, Infinity], hostGraph = { entries: new Map([['first', shared], ['last', shared]]), members: new Set([shared]) };
  const crossRealm = vm.runInNewContext(`(() => { const shared = [NaN, -0, Infinity];
    return { entries: new Map([['first', shared], ['last', shared]]), members: new Set([shared]) }; })()`);
  assert.deepStrictEqual(graph(crossRealm), graph(hostGraph), 'Graph comparison ignores VM prototypes while preserving Map/Set order and aliases');
  const restored = decode(graph(crossRealm));
  assert.deepStrictEqual([...restored.entries.keys()], ['first', 'last']);
  assert.strictEqual(restored.entries.get('first'), restored.entries.get('last'));
  assert.strictEqual([...restored.members][0], restored.entries.get('first'));
  assert.notDeepStrictEqual(graph(new Map([['a', 1]])), graph(new Map([['b', 1]])), 'Map values cannot disappear into an empty object');
  assert.notDeepStrictEqual(graph(new Set([1, 2])), graph(new Set([2, 1])), 'Set iteration order is checked');
  const pure = { module: { exports: {} } };
  vm.runInNewContext(dataModule, pure);
  assert.equal(typeof pure.module.exports.createPanelData, 'function', 'Module loads without DOM, browser, fetching or canvas globals');
  assert(!/\b(?:document|window|localStorage|fetch)\b/.test(dataModule));
  assert.equal((source.match(/AtlasData\.createPanelData\(/g) || []).length, 1);
  assert(!/\bany\b|@ts-ignore|@ts-expect-error/.test(dataModule));
  console.log(`Atlas data parity: ${queries} lookup cases, complete map hashes, identities, live readers and seven loading journals passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
