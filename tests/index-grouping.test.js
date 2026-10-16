'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const vm = require('vm'), crypto = require('crypto'), zlib = require('zlib');
const IndexSearch = require('../web/index-search');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'index-grouping-corpus.json.gz'))));
const plain = parts => Array.from(parts, p => [p.title, p.g?.id ?? null, p.rows.length,
  Array.from(p.rows, r => r.bundle ? ['bundle', r.name, Array.from(r.members, ([n, r]) => [n, r.id])] : r.id)]);
const summary = value => ({ count: value.length,
  sha256: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') });
const references = (parts, records) => {
  for (const p of parts) for (const x of p.rows) {
    for (const r of x.bundle ? x.members.map(m => m[1]) : [x]) assert.strictEqual(r, records.get(r.id));
  }
};

async function run() {
  const source = read('web/index-grouping.js'), sandbox = {};
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.IndexGrouping.createGrouping, 'function');
  assert(!/\b(?:document|window|localStorage|RealmIndex)\b/.test(source));
  assert.equal((read('web/index-browse.js').match(/IndexGrouping\.createGrouping\(/g) || []).length, 1);
  let api;
  for (const archive of [false, true]) {
    api = await require('./index-harness')(IndexSearch, undefined, { archive });
    const search = api.IX.search, cache = new Map();
    api.IX.search = (q, limit) => {
      const key = JSON.stringify([q, limit]);
      if (!cache.has(key)) cache.set(key, search(q, limit));
      return cache.get(key);
    };
    // Captured outside the repository on cfac5cf before extraction. The hashes
    // cover complete ordered titles, section keys, counts, IDs and bundle members.
    // No second implementation of the old grouping algorithm is kept here.
    for (const [s, by, expected] of (archive ? corpus.archiveCases : corpus.cases)) {
      const ctx = api.select({ ...s, tags: new Set(s.tags || []) });
      const before = Array.from(ctx.rows), parts = api.grouped(ctx.rows, ctx, by);
      assert.deepEqual(summary(plain(parts)), corpus.lists[expected], JSON.stringify([s, by]));
      assert.deepEqual(Array.from(ctx.rows), before, 'input order remains unchanged');
      for (const p of parts) if (p.g) assert((ctx.g ? [ctx.g] : [...ctx.d.groups, ctx.d.abilities]).includes(p.g));
      references(parts, api.IX.records);
    }
    for (const [s, expected] of (archive ? corpus.archiveSearches : corpus.searches)) {
      const got = api.select({ ...s, tags: new Set(s.tags || []) });
      assert.deepEqual(summary(plain(got.groups)), corpus.lists[expected], JSON.stringify(s));
      references(got.groups, api.IX.records);
    }
    assert.equal(api.groupingCreations(), 1);
    assert.equal(api.filterCreations(), 1);
    assert.equal(api.creations(), 1);
  }

  const records = corpus.edgeRecords.map(r => ({ ...r }));
  for (const r of records) if (['NaN', 'Infinity', '-Infinity'].includes(r.tier)) r.tier = Number(r.tier);
  api.IX.records = new Map(records.map(r => [r.id, r]));
  api.IX.isSidePortal = r => r.id === 'i';
  function edgeContext(family, mode) {
    const ids = ['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'a'];
    const g = { id: 'edge', title: 'Édge', ids };
    const d = { id: family, groups: [g], sortBy: mode === 'absent-sort' ? undefined : r => r.tier };
    if (mode === 'abilities') d.abilities = { id: 'abilities', title: 'Abilities', ids, kinds: [g] };
    if (mode === 'duplicate-sections') d.groups.push(g);
    const rows = (mode === 'empty' ? [] : ids).map(id => api.IX.records.get(id));
    if (mode === 'reverse') rows.reverse();
    return { rows, ctx: { d, g: null } };
  }
  for (const [family, mode, by, expected, refs] of corpus.edges) {
    const { rows, ctx } = edgeContext(family, mode);
    const get = () => api.grouped(rows, ctx, by);
    if (expected.error) { assert.throws(get, { name: expected.error }); continue; }
    const parts = get();
    assert.deepEqual(plain(parts), expected, [family, mode, by].join('/'));
    assert.deepEqual(Array.from(parts, p => Array.from(p.rows, r => r.bundle
      ? Array.from(r.members, m => records.indexOf(m[1])) : records.indexOf(r))), refs);
    references(parts, api.IX.records);
  }
  for (const [mode, expected] of corpus.failures) {
    const d = { id: 'gear', groups: [{ id: 'edge', title: 'Empty', ids: ['unknown'] }] };
    if (mode === 'missing-groups') delete d.groups;
    if (mode === 'missing-record') {
      const parts = api.grouped([{ id: 'unknown' }], { d }, 'section');
      assert.strictEqual(parts[0].g, d.groups[0]);
      assert.strictEqual(parts[0].rows[0], undefined);
      assert.deepEqual({ missingRows: Array.from(parts[0].rows, r => r === undefined) }, expected);
      continue;
    }
    const get = () => plain(api.grouped(mode === 'empty' ? [] : mode === 'missing-record' ? [{ id: 'unknown' }] : [records[0]],
      { d: mode === 'missing-domain' ? undefined : d }, mode === 'missing-rule' ? 'unknown' : 'section'));
    if (expected.error) assert.throws(get, { name: expected.error }); else assert.deepEqual(get(), expected);
  }
  assert.equal(api.groupingCreations(), 1, 'replacement records and classifiers retain the factory');

  // Change every injected callback after creating the factory, not just its data.
  const a = { id: 'a', name: 'Same' }, b = { id: 'b', name: 'The Same' };
  let calls = 0;
  const deps = { getRecord: () => a, isSidePortal: () => false,
    getGroup: () => { calls++; return { key: () => 'first' }; } };
  const grouping = sandbox.IndexGrouping.createGrouping(deps);
  const section = { id: 's', title: 'Section', ids: ['a', 'a'] };
  const d = { id: 'dungeons', groups: [section] }, ctx = { d };
  let parts = grouping.grouped([a], ctx, 'section');
  assert.strictEqual(parts[0].g, section);
  assert.strictEqual(parts[0].rows[0], a); assert.strictEqual(parts[0].rows[1], a);
  deps.getRecord = () => b;
  assert.strictEqual(grouping.grouped([a], ctx, 'section')[0].rows[0], b);
  deps.isSidePortal = () => true;
  assert.strictEqual(grouping.grouped([a], ctx, 'section')[1].rows[0], a);
  assert.equal(grouping.grouped([b, a, b], ctx, 'custom')[0].title, 'first');
  deps.getGroup = () => { calls++; return { key: r => r.id, last: 'b', order: () => NaN }; };
  parts = grouping.grouped([b, a, b], ctx, 'custom');
  assert.deepEqual(Array.from(parts, p => p.title), ['a', 'b']);
  assert.strictEqual(parts[1].rows[0], b); assert.strictEqual(parts[1].rows[1], b);
  deps.getGroup = () => ({ key: () => '' });
  d.sortBy = r => r === a ? 1 : 0;
  assert.strictEqual(grouping.grouped([a, b], ctx, 'custom')[0].rows[0], b);
  d.sortBy = () => Infinity;
  const tied = grouping.grouped([b, a, b], ctx, 'custom')[0].rows;
  assert.strictEqual(tied[0], b); assert.strictEqual(tied[1], a); assert.strictEqual(tied[2], b);
  section.ids = [];
  deps.isSidePortal = () => false;
  assert.equal(grouping.grouped([a], ctx, 'section').length, 0);
  assert.equal(calls, 2);
  console.log(`Index grouping parity: ${corpus.cases.length + corpus.archiveCases.length} groups, ${corpus.searches.length + corpus.archiveSearches.length} search states, ${corpus.edges.length + corpus.failures.length} edges; identical order, bundles, references and duplicates.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
