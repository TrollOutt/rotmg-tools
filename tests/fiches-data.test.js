'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), crypto = require('crypto');
const { run, flush } = require('./fiches-harness');
const { createCardData } = require('../web/fiches-data');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
// Recorded from the unmodified card closure at this commit, before extraction.
// Output interning only compresses repetitions; these are values, not another implementation.
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fiches-data-corpus.json.gz'))));
const enrichment = JSON.parse(read('web/assets/index/realmeye-enrichment.json'));
const forge = JSON.parse(read('web/assets/index/client-forge.json'));
const plain = v => JSON.parse(JSON.stringify(v, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? { $number: String(value) } : value));
const digest = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const result = (api, r) => {
  try { return plain([api.communityOf(r), api.powerOf(r, api.communityOf(r))]); }
  catch (error) { return { error: error.name }; }
};
const project = r => plain({ id: r.id, name: r.name, clientId: r.clientId, about: r.about, kind: r.kind, hand: r.hand, hidden: r.hidden, communityOnly: r.communityOnly, availability: r.availability });
function direct(sources, extra = {}) {
  const api = createCardData({ getSources: () => sources, fetchCommunity: () => Promise.resolve({}), fetchForge: () => Promise.resolve({}), settled() {}, ...extra });
  api.loadCommunity(); api.loadForge();
  return api;
}

(async () => {
  let cases = 0;
  const apis = [], adapters = [];
  for (const kept of [true, false]) for (const community of [false, true]) for (const client of [false, true]) {
    const c = community ? enrichment : {}, f = client ? forge : {};
    const sources = kept ? { realmeyeEnrichmentText: JSON.stringify(c), clientForgeText: JSON.stringify(f) } : undefined;
    apis.push(direct(sources, { fetchCommunity: () => Promise.resolve(c), fetchForge: () => Promise.resolve(f) }));
    const page = run({ bundle: sources && { sources }, answer: url => {
      assert(!kept, 'Kept data must not be fetched');
      return Promise.resolve({ json: () => Promise.resolve(url.endsWith('client-forge.json') ? f : c) });
    } });
    assert.equal(page.creations(), 1, 'Both card layouts share one factory');
    assert.equal(page.bigParses(), 0, 'Construction leaves kept text undecoded');
    adapters.push(page.fiches);
  }
  await flush();
  assert.deepEqual(plain(apis[3].forgeExtra()), corpus.forge);
  assert.strictEqual(apis[7].forgeExtra(), forge, 'HTTP keeps the response object');
  assert.strictEqual(apis[7].communityRecords(), enrichment.records, 'HTTP keeps the records object');
  assert.equal(digest(apis[3].communityRecords()), corpus.communityDigest);
  for (const catalogue of corpus.catalogues) {
    const current = await require('./index-harness')(require('../web/index-search'), undefined, { archive: catalogue.archive, loadArchive: catalogue.archive });
    assert.deepEqual(plain(current.IX.list.map(project)), catalogue.rows.map(([r]) => r), 'Real catalogue projection, archive=' + catalogue.archive);
    for (const [r, expected] of catalogue.rows) {
      for (let i = 0; i < apis.length; i++) {
        assert.equal(JSON.stringify(result(apis[i], r)), JSON.stringify(corpus.outputs[expected[i % 4]]), r.id + ': module mode ' + i);
        assert.equal(JSON.stringify(result(adapters[i], r)), JSON.stringify(corpus.outputs[expected[i % 4]]), r.id + ': adapter mode ' + i);
        cases++;
      }
    }
  }
  for (const [r, expected] of corpus.edges) for (let i = 0; i < apis.length; i++) {
    assert.equal(JSON.stringify(result(apis[i], r)), JSON.stringify(corpus.outputs[expected[i % 4]])); cases++;
  }
  for (const [text, about, expected] of corpus.summaries) {
    assert.deepEqual(plain(apis[3].parseSummary(text, about)), expected);
    assert.deepEqual(plain(adapters[3].parseSummary(text, about)), expected);
  }
  // Every forge record and its ordered arrays/duplicates are returned untouched.
  const raw = apis[3].forgeExtra();
  assert.strictEqual(apis[3].forgeExtra(), raw);
  for (const [key, value] of Object.entries(raw)) {
    assert.strictEqual(apis[3].forgeExtra()[key], value);
    if (value.blueprints) assert.strictEqual(apis[3].forgeExtra()[key].blueprints, value.blueprints);
  }
  const r = corpus.catalogues[1].rows.find(([r]) => r.id === 'item:Teratoma')[0];
  const a = apis[3].communityOf(r), b = apis[3].communityOf(r);
  assert.notStrictEqual(a, b); assert.notStrictEqual(a.facts, b.facts); assert.notStrictEqual(a.prose, b.prose);

  // The module can be loaded, instantiated and used without browser globals.
  const context = { module: { exports: {} } };
  for (const key of ['document', 'window', 'localStorage']) Object.defineProperty(context, key, { get() { assert.fail(key + ' accessed'); } });
  vm.runInNewContext(read('web/fiches-data.js'), context);
  const isolated = context.module.exports.createCardData({ getSources: () => ({ clientForgeText: '{}', realmeyeEnrichmentText: '{}' }), settled() {} });
  isolated.loadCommunity(); isolated.loadForge();
  assert.deepEqual(plain(isolated.communityOf({ id: 'missing' })), { facts: {}, notes: '', prose: [], variants: '' });

  // Bundle and reader dependencies are read at each original phase, then kept
  // text remains a snapshot, exactly as the original closure's constants did.
  let sources = { realmeyeEnrichmentText: JSON.stringify({ records: { test: { facts: { power_level: '4' } } } }) };
  const reads = [], calls = [];
  const deps = { getSources: () => { reads.push('community'); return sources; }, fetchCommunity: () => assert.fail('Unexpected fetch'), fetchForge: () => assert.fail('Stale reader'), settled: () => calls.push('settled') };
  const live = createCardData(deps);
  live.loadCommunity();
  sources = {};
  deps.getSources = () => { reads.push('forge'); return sources; };
  const incoming = { Sword: { power: 7, blueprints: ['bp', 'bp'], forge: { needs: [] } } };
  deps.fetchForge = url => { calls.push(url); return Promise.resolve(incoming); };
  live.loadForge(); await flush();
  assert.deepEqual(reads, ['community', 'forge']);
  assert.strictEqual(live.forgeExtra(), incoming);
  assert.equal(live.powerOf({ id: 'test', name: 'Sword' }, live.communityOf({ id: 'test' })), '7');
  assert.equal(live.communityOf({ id: 'test' }).facts.power, '4');
  sources = { clientForgeText: '{bad', realmeyeEnrichmentText: '{bad' };
  assert.strictEqual(live.forgeExtra(), incoming, 'Later bundle replacement does not invalidate parsed data');
  incoming.Sword.power = 8;
  assert.equal(live.powerOf({ name: 'Sword' }, { facts: {} }), '8', 'Read the current object, no result cache');
  for (const power of [0, -1, NaN, Infinity, -Infinity, null, '', '0']) {
    incoming.Sword.power = power;
    assert.equal(live.powerOf({ name: 'Sword' }, { facts: { power: 'fallback' } }), String(power));
  }
  delete incoming.Sword.power;
  assert.equal(live.powerOf({ name: 'Sword' }, { facts: { power: 'fallback' } }), 'fallback');
  assert.equal(live.powerOf({ clientId: 'missing', name: 'Sword' }, { facts: {} }), '', 'Power lookup does not add a name fallback');
  const communityRaw = live.communityRecords();
  communityRaw.test.facts.power_level = '9';
  assert.equal(live.communityOf({ id: 'test', hidden: true, communityOnly: true, availability: 'unreleased' }).facts.power, '9');
  assert.deepEqual(reads, ['community', 'forge'], 'Reads do not reload kept sources');

  // Frozen microtask journals include all eight original pending phases and
  // request order in the real adapter, including JSON/fetch failures.
  for (const expected of corpus.loaderTraces) {
    const { mode } = expected;
    const text = mode === 'kept' ? '{}' : mode === 'invalid' ? '{broken' : mode === 'null' ? 'null' : mode === 'empty' ? '' : undefined;
    const bundle = text !== undefined ? { sources: { realmeyeEnrichmentText: text, clientForgeText: text } } : undefined;
    const answer = () => mode === 'reject' ? Promise.reject(Error('fetch')) : Promise.resolve({ json: () => mode === 'json-reject' ? Promise.reject(Error('json')) : Promise.resolve({}) });
    const page = run({ bundle, answer }); const pending = [page.fiches.pending()];
    for (let i = 0; i < 16; i++) { await Promise.resolve(); pending.push(page.fiches.pending()); }
    await flush();
    const f = page.fiches.forgeExtra(), c = page.fiches.communityRecords();
    assert.deepEqual({ mode, pending, fetched: page.fetched, forge: plain(f), community: plain(c), forgeMemo: page.fiches.forgeExtra() === f, communityMemo: page.fiches.communityRecords() === c }, expected);
    assert.equal(page.creations(), 1);
  }

  // Concurrent reads while both requests are held do not start more requests.
  // A failure is terminal in this reader; a fresh page/factory can load again.
  let resolveCommunity, rejectForge, count = 0, settled = 0;
  const waiting = createCardData({ getSources: () => undefined,
    fetchCommunity: () => { count++; return new Promise(resolve => { resolveCommunity = resolve; }); },
    fetchForge: () => { count++; return new Promise((_, reject) => { rejectForge = reject; }); },
    settled: () => settled++ });
  waiting.loadCommunity(); waiting.loadForge();
  const initial = waiting.forgeExtra();
  assert.notStrictEqual(waiting.communityRecords(), waiting.communityRecords(), 'Pending community fallback is fresh');
  for (let i = 0; i < 10; i++) { waiting.communityOf({ id: 'test' }); assert.strictEqual(waiting.forgeExtra(), initial); }
  assert.equal(count, 2); assert.equal(settled, 0);
  rejectForge(Error('failed')); await flush();
  assert.equal(settled, 1); assert.strictEqual(waiting.forgeExtra(), initial);
  const records = { test: { facts: { power_level: '12' } } };
  resolveCommunity({ records }); await flush();
  assert.strictEqual(waiting.communityRecords(), records);
  assert.equal(settled, 2); assert.equal(count, 2);
  waiting.forgeExtra(); waiting.communityOf({ id: 'test' });
  assert.equal(count, 2, 'No implicit retry after failure');
  const retry = direct(undefined, { fetchForge: () => Promise.resolve(incoming) }); await flush();
  assert.strictEqual(retry.forgeExtra(), incoming, 'Fresh factory can recover from a failed previous page');
  console.log(`Card data parity: ${cases} frozen record/mode cases, module and adapters identical; 11 summaries, 7 loader journals, references, concurrency and live phases.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
