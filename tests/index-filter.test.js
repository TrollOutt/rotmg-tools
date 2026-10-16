'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const vm = require('vm'), crypto = require('crypto'), zlib = require('zlib');
const IndexSearch = require('../web/index-search');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'index-filter-corpus.json.gz'))));
const ids = rows => Array.from(rows, r => r.id);
const digest = xs => crypto.createHash('sha256').update(JSON.stringify(ids(xs))).digest('hex');
const summary = xs => ({ count: xs.length, sha256: digest(xs), first: ids(xs).slice(0, 2), last: ids(xs).slice(-2) });
const state = changes => ({ tier: '', inf: '', gra: '', cls: '', scl: '', home: '', dcls: '', dh: '', tags: new Set(), ...changes });

async function run() {
  const source = read('web/index-filter.js'), sandbox = {};
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.IndexFilter.createFilter, 'function');
  assert(!/\b(?:document|window|localStorage|RealmIndex)\b/.test(source), 'no implicit browser dependencies');
  assert.equal((read('web/index-browse.js').match(/IndexFilter\.createFilter\(/g) || []).length, 1);
  const api = await require('./index-harness')(IndexSearch);
  // The static reference was captured outside the repository on 0b26585 before
  // extraction. Complete ordered ID lists are hashed; no legacy filter copy is kept.
  // Cache only unchanged name ranking across the exhaustive state combinations.
  const originalSearch = api.IX.search, cache = new Map();
  api.IX.search = (q, limit) => {
    const key = JSON.stringify([q, limit]);
    if (!cache.has(key)) cache.set(key, originalSearch(q, limit));
    return cache.get(key);
  };
  for (const [s, all, rows, same] of corpus.cases) {
    const got = api.select({ ...s, tags: new Set(s.tags || []) });
    assert.deepEqual(summary(got.all), corpus.lists[all], JSON.stringify(s) + ': all');
    assert.deepEqual(summary(got.rows), corpus.lists[rows], JSON.stringify(s) + ': rows');
    assert.equal(got.all === got.rows, same, 'unfiltered array identity');
    for (const r of [...got.all, ...got.rows]) assert.strictEqual(r, api.IX.records.get(r.id));
  }
  assert.equal(api.filterCreations(), 1, 'every selection reuses the one adapter factory');
  assert.equal(api.creations(), 1, 'search factory remains shared');

  const records = corpus.edgeRecords.map(r => ({ ...r }));
  for (const r of records) if (['NaN', 'Infinity'].includes(r.tier)) r.tier = Number(r.tier);
  api.IX.records = new Map(records.map(r => [r.id, r])); api.IX.list = records;
  const domain = { id: 'dungeons', ids: records.map(r => r.id), groups: [{ id: 'all', ids: records.map(r => r.id) }] };
  api.IX.domains = [domain]; api.IX.sidePortals = ['dev', 'ut'];
  api.IX.statusOf = new Map(); api.IX.foundIn = new Map();
  for (const [s, all, rows, same] of corpus.edges) {
    if (s.empty) { domain.ids = []; api.IX.sidePortals = []; }
    const got = api.select({ ...s, tags: new Set(s.tags || []) });
    assert.deepEqual(ids(got.all), all); assert.deepEqual(ids(got.rows), rows);
    assert.equal(got.all === got.rows, same);
    for (const r of got.rows) assert.strictEqual(r, api.IX.records.get(r.id));
  }
  assert.equal(api.filterCreations(), 1, 'replacement records and memberships keep the factory');

  // Exercise each live callback independently, then replacements and duplicates.
  let current = records, S = state(), side = [], tags = {}, reads = 0;
  const deps = { getState: () => { reads++; return S; }, getRecord: id => current.find(r => r.id === id),
    getSidePortals: () => side, getTags: () => tags, tierOf: () => '', statusesOf: () => [],
    setClass: () => '', scalesOf: () => [], placeOf: () => null, gaveTo: () => [] };
  const one = sandbox.IndexFilter.createFilter(deps), d = { id: 'dungeons', ids: ['missing'] };
  const select = () => one.select(d, null);
  assert.strictEqual(select().rows[0], records[0]);
  for (const [key, callback, yes, no] of [
    ['tier', 'tierOf', () => 'yes', () => ''],
    ['inf', 'statusesOf', (r, hows) => { assert.deepEqual(Array.from(hows), ['inflicts', 'inflicts on players']); return ['yes']; }, () => []],
    ['gra', 'statusesOf', (r, hows) => { assert.deepEqual(Array.from(hows), ['grants']); return ['yes']; }, () => []],
    ['cls', 'setClass', () => 'yes', () => ''], ['scl', 'scalesOf', () => ['yes'], () => []],
    ['home', 'placeOf', () => ({ id: 'yes' }), () => null],
    ['dcls', 'gaveTo', (r, cls, hand) => { assert.equal(cls, 'yes'); assert.equal(hand, ''); return [r]; }, () => []],
    ['dh', 'gaveTo', (r, cls, hand) => { assert.equal(cls, ''); assert.equal(hand, 'yes'); return [r]; }, () => []]
  ]) {
    S = state({ [key]: 'yes' }); deps[callback] = no; assert.equal(select().rows.length, 0, key);
    deps[callback] = yes; assert.strictEqual(select().rows[0], records[0], key);
    deps[callback] = no;
  }
  S = state({ tags: new Set(['known', 'unknown']) });
  tags = { known: { test: () => false } }; assert.equal(select().rows.length, 0);
  tags = { known: { test: () => true } }; assert.strictEqual(select().rows[0], records[0]);
  S = state({ tech: true }); side = ['missing']; assert.equal(select().rows.length, 2);
  side = []; assert.equal(select().rows.length, 1);
  side = ['missing']; assert.equal(one.select(d, { ids: [] }).rows.length, 0, 'no side portals within a section');
  assert.equal(one.select({ id: 'events', ids: [] }, null).rows.length, 0, 'no technical portals outside dungeons');
  current = [{ id: 'missing', kind: 'item' }];
  assert.strictEqual(select().rows[0], current[0], 'record resolution remains live');
  assert.strictEqual(select().rows[1], current[0], 'duplicate IDs retain duplicate references');
  let calls = 0; deps.getState = () => { calls++; return state(); }; select(); assert.equal(calls, 1);
  assert(reads > 20);
  // Visibility belongs to family construction, not an extra filter here.
  S = state(); deps.getState = () => S;
  current = records; d.ids = ['hidden', 'community', 'unreleased', 'dev'];
  assert.deepEqual(ids(select().rows), d.ids);
  console.log(`Index filter parity: ${corpus.stats.sections} family/section selections, ${corpus.stats.singles} single filters, ${corpus.stats.pairs} combinations, ${corpus.stats.queries} queries; ${corpus.cases.length} real cases and ${corpus.edges.length} edges, identical order and references.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
