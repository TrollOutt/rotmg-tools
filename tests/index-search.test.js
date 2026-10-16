'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const vm = require('vm'), crypto = require('crypto');
const IndexSearch = require('../web/index-search');
const corpus = JSON.parse(require('zlib').gunzipSync(fs.readFileSync(path.join(__dirname, 'index-search-corpus.json.gz'))));
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ids = rows => Array.from(rows, r => r.id);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const summary = value => ({ sha256: digest(value), count: value.length,
  first: value[0] || null, last: value[value.length - 1] || null });

// Captured outside the repository from e6caa51 before extraction. The small
// dictionary stores every search ID/score/length; catalogue-wide grouping and
// filter digests cover all ordered IDs without duplicating the entire Index.
async function run() {
  const sandbox = {};
  vm.runInNewContext(read('web/index-search.js'), sandbox);
  assert.equal(typeof sandbox.IndexSearch.createSearch, 'function', 'classic script runs without browser globals');
  assert(!/\b(?:document|window|localStorage|performance|RealmIndex)\b/.test(read('web/index-search.js')),
    'the search module has no implicit UI dependencies');
  assert.equal((read('web/index-browse.js').match(/IndexSearch\.createSearch\(/g) || []).length, 1);

  const api = await require('./index-harness')(IndexSearch);
  const deps = { getRecords: () => api.IX.list, isTechnical: r => api.IX.isTechnical(r),
    kindSay: r => api.IX.kindSay(r), isGear: r => api.IX.isGear(r) };
  const search = IndexSearch.createSearch(deps);
  let pages = 0;
  for (const [q, rows] of corpus.search) {
    const expected = rows.map(([i, score, length]) => [corpus.ids[i], score, length]);
    const ranked = search.rank(q).slice(0, 800);
    assert.deepEqual(ranked.map(([score, length, r]) => [r.id, score, length]), expected, q);
    for (const limit of [0, 1, 20, 60, 240, 360, 800]) {
      const wanted = expected.slice(0, limit).map(row => row[0]);
      assert.deepEqual(ids(search.search(q, limit)), wanted, q + ': factory page ' + limit);
      assert.deepEqual(ids(api.IX.search(q, limit)), wanted, q + ': adapter page ' + limit);
      pages++;
    }
    assert.deepEqual(ids(api.IX.search(q)), expected.slice(0, 60).map(row => row[0]), q + ': default limit');
    for (const [, , r] of ranked) assert(Object.is(r, api.IX.records.get(r.id)), 'original record reference');
  }
  for (const [f, s, by, expected] of corpus.browse) {
    const ctx = api.select({ f, s });
    const parts = Array.from(api.grouped(ctx.rows, ctx, by), p => [p.title,
      Array.from(p.rows, r => r.bundle ? Array.from(r.members, x => x[1].id) : r.id)]);
    const actual = summary(parts);
    for (const k of ['first', 'last']) if (actual[k]) actual[k] = [actual[k][0], actual[k][1].slice(0, 2)];
    assert.deepEqual(actual, expected, [f, s, by].join('/'));
  }
  for (const [state, expected] of corpus.filters) {
    const ctx = api.select({ ...state, tags: new Set(state.tags) });
    assert.deepEqual(summary(ids(ctx.rows)), expected, JSON.stringify(state));
  }
  assert.equal(api.creations(), 1, 'all searches and selections reuse one factory');
  const adapted = { id: 'live-adapter', kind: 'enemy', name: 'Same' };
  api.IX.list = [adapted];
  api.IX.isTechnical = () => false; api.IX.kindSay = () => 'Boss';
  assert(Object.is(api.IX.search('same')[0], adapted), 'adapter reads a replacement list');
  api.IX.isTechnical = () => true;
  assert(Object.is(api.IX.search('same')[0], adapted), 'adapter keeps its factory across classifier replacement');
  assert.equal(api.creations(), 1);

  const records = corpus.edges.records.map(r => ({ ...r }));
  Object.assign(records.find(r => r.id === 'nonfinite'), { slot: NaN, tier: Infinity });
  const edgeDeps = { getRecords: () => records, isTechnical: r => r.id === 'technical',
    kindSay: r => r.id === 'boss' ? 'Boss' : 'Enemy', isGear: r => r.slot !== undefined };
  const edges = IndexSearch.createSearch(edgeDeps);
  for (const c of corpus.edges.cases) {
    if (c.error) {
      assert.throws(() => edges.search(c.q), { name: c.error }, 'preserve legacy failure: ' + c.q);
      continue;
    }
    assert.deepEqual(edges.rank(c.q).map(([score, length, r]) => [r.id, score, length]), c.rows, c.q);
    for (const limit of [-Infinity, -1, -0, NaN, Infinity, 1.5]) {
      assert.deepEqual(ids(edges.search(c.q, limit)), c.rows.slice(0, limit).map(r => r[0]));
    }
    for (const r of edges.search(c.q, Infinity)) assert(Object.is(r, records.find(x => x.id === r.id)));
  }
  for (const [flag, expected] of corpus.numericFlags) {
    const record = { id: 'numeric', kind: 'item', name: 'Same', dev: Number(flag) };
    const numeric = IndexSearch.createSearch({ ...edgeDeps, getRecords: () => [record], isGear: () => true });
    assert.deepEqual(numeric.rank('same').map(([score, length, r]) => [r.id, score, length]), expected, flag);
  }
  // Every classifier and replacement catalogue remains live after creation.
  const enemy = { id: 'enemy', name: 'Same', kind: 'enemy' };
  let current = [enemy], reads = 0;
  const live = { getRecords: () => { reads++; return current; }, isTechnical: () => false,
    kindSay: () => 'Enemy', isGear: () => false };
  const one = sandbox.IndexSearch.createSearch(live);
  assert.equal(one.rank('same')[0][0], 3);
  live.kindSay = () => 'Boss'; assert.equal(one.rank('same')[0][0], 1);
  live.isTechnical = () => true; assert.equal(one.rank('same')[0][0], 6);
  current = [{ id: 'gear', name: 'Same', kind: 'item' }];
  live.isTechnical = () => false; live.isGear = () => true;
  assert.equal(one.rank('same')[0][0], 1);
  assert(Object.is(one.search('same')[0], current[0]));
  current = []; assert.deepEqual(Array.from(one.search('same')), []);
  assert.equal(reads, 6); one.search(' '); assert.equal(reads, 6, 'empty query reads no catalogue');

  // The old WeakMap deliberately keeps normalized words for a mutated object;
  // a replacement object has its own words. Keep this cache lifetime unchanged.
  const named = { id: 'cache', kind: 'item', name: 'Mad Javelin' };
  current = [named]; assert.equal(one.search('javlin').length, 1);
  named.name = 'Other'; assert.equal(one.search('javlin').length, 1);
  current = [{ ...named }]; assert.equal(one.search('javlin').length, 0);
  const tied = [{ id: 'first', kind: 'item', name: 'Same' }, { id: 'second', kind: 'item', name: 'Same' }];
  current = tied; assert.deepEqual(Array.from(one.search('same'), r => r.id), ['first', 'second']);
  current = tied.slice().reverse(); assert.deepEqual(Array.from(one.search('same'), r => r.id), ['second', 'first']);

  // Fuzzy rescue happens only below twenty direct hits, including at the tie boundary.
  current = Array.from({ length: 19 }, (_, i) => ({ id: String(i), kind: 'item', name: 'javlin' }));
  current.push({ id: 'fuzzy', kind: 'item', name: 'Javelin' });
  assert.equal(one.search('javlin', Infinity).length, 20);
  current.unshift({ id: 'twentieth', kind: 'item', name: 'javlin' });
  assert.equal(one.search('javlin', Infinity).some(r => r.id === 'fuzzy'), false);
  console.log(`Index search parity: ${corpus.search.length} queries, ${pages} limits, ${corpus.browse.length} groupings, ${corpus.filters.length} filters, ${corpus.edges.cases.length} edge cases; exact scores, order and references.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
