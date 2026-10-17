'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const vm = require('vm'), crypto = require('crypto'), zlib = require('zlib');
const IndexSearch = require('../web/index-search');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'index-facets-corpus.json.gz'))));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const summary = rows => [rows.length, digest(Array.from(rows, r => r.id))];
const options = value => Object.fromEntries(Object.entries(value).map(([key, entries]) => [key,
  key === 'tags' ? Array.from(entries, ([k, t]) => [k, t.say, Array.from(t.fams)]) : Array.from(entries, e => Array.from(e))]));
const state = changes => ({ tier: '', inf: '', gra: '', cls: '', scl: '', home: '', dcls: '', dh: '', tags: new Set(), ...changes });

async function run() {
  const source = read('web/index-filter.js'), sandbox = {};
  vm.runInNewContext(source, sandbox);
  assert.deepEqual(Object.keys(sandbox.IndexFilter), ['createFilter']);
  assert(!/\b(?:document|window|localStorage|RealmIndex)\b/.test(source));
  assert.equal((read('web/index-browse.js').match(/IndexFilter\.createFilter\(/g) || []).length, 1);
  let api;
  for (const archive of [false, true]) {
    api = await require('./index-harness')(IndexSearch, undefined, { archive, loadArchive: archive });
    const search = api.IX.search, cache = new Map();
    api.IX.search = (q, n) => {
      const key = JSON.stringify([q, n]);
      if (!cache.has(key)) cache.set(key, search(q, n));
      return cache.get(key);
    };
    // Captured outside the repository on f6bc1bf before changing the adapter.
    // Option values/counts are explicit; hashes cover complete ordered results
    // and groups. No second implementation of the original counters is kept.
    for (const [loaded, s, expected] of corpus.cases) {
      if (loaded !== archive) continue;
      const ctx = api.select({ ...s, tags: new Set(s.tags || []) });
      const before = Array.from(ctx.all);
      const facets = ctx.d ? api.facetOptions(ctx.d, ctx.all) : null;
      const groups = ctx.d ? Array.from(api.groupsFor(ctx.d.id, ctx.g), by => [by, digest(api.grouped(ctx.rows, ctx, by)
        .map(p => [p.title, p.g?.id || null, Array.from(p.rows, r => r.bundle
          ? ['bundle', r.name, Array.from(r.members, ([n, r]) => [n, r.id])] : r.id)]))])
        : ctx.groups ? digest(ctx.groups.map(p => [p.title, p.g?.id || null, Array.from(p.rows, r => r.id)])) : null;
      assert.deepEqual([facets && options(facets), summary(ctx.all), summary(ctx.rows), ctx.all === ctx.rows, groups],
        corpus.values[expected], JSON.stringify([archive, s]));
      assert.deepEqual(Array.from(ctx.all), before, 'preparing options never reorders the selection');
      for (const r of [...ctx.all, ...ctx.rows]) assert.strictEqual(r, api.IX.records.get(r.id));
      if (facets) for (const [key, tag] of facets.tags) assert.strictEqual(tag, api.filterDependencies().getTags()[key]);
    }
    assert.equal(api.filterCreations(), 1, 'selection and options share the same factory');
    assert.equal(api.creations(), 1);
    assert.equal(api.familyCreations(), 1);
    assert.equal(api.groupingCreations(), 1);
  }

  api = await require('./index-harness')(IndexSearch);
  const records = corpus.edgeRecords.map(r => ({ ...r }));
  for (const r of records) if (['NaN', 'Infinity'].includes(r.tier)) r.tier = Number(r.tier);
  api.IX.records = new Map(records.map(r => [r.id, r])); api.IX.list = records;
  api.IX.domains = [{ id: 'classes', ids: ['class:a', 'class:b'], groups: [] }];
  api.IX.statusOf = new Map([
    ['plain', [{ how: 'inflicts', name: 'Quiet' }, { how: 'inflicts on players', name: 'Quiet' }, { how: 'grants', name: 'Healing' }]],
    ['ut', [{ how: 'inflicts', name: 'Slow' }, { how: 'grants', name: 'Healing' }]]
  ]);
  for (const [family, mode, expected] of corpus.edges) {
    let rows = mode === 'empty' ? [] : records;
    if (mode === 'duplicate') rows = [...rows, records[0], records[1]];
    api.select({ tags: new Set(mode === 'selected-missing' ? ['shiny', 'unknown'] : []),
      dh: mode === 'selected-missing' ? 'unknown' : '', dcls: mode === 'selected-missing' ? 'unknown' : '' });
    api.IX.foundIn = mode === 'missing-home' ? new Map([['plain', new Set(['absent'])]])
      : new Map([['plain', new Set(['p'])], ['ut', new Set(['q'])]]);
    if (expected.error) assert.throws(() => api.facetOptions({ id: family }, rows), { name: expected.error });
    else assert.deepEqual(options(api.facetOptions({ id: family }, rows)), expected, [family, mode].join('/'));
  }
  for (const [mode, expected] of corpus.failures) {
    if (mode === 'absent-class') api.IX.domains[0].ids = ['missing'];
    assert.throws(() => api.facetOptions(mode === 'absent-domain' ? null : { id: mode === 'absent-class' ? 'dungeons' : 'events' },
      mode === 'absent-rows' ? null : mode === 'absent-record' ? [undefined] : []), { name: expected.error });
  }

  // Replace callbacks and state on the very same factory: no snapshots/caches.
  let S = state(), tags = {}, classes = [], hands = [], places = new Map(), reads = 0;
  const a = { id: 'a', name: 'Zulu' }, b = { id: 'b', name: 'Alpha' };
  const deps = { getState: () => { reads++; return S; }, getRecord: id => places.get(id), getTags: () => tags,
    getClasses: () => classes, getHands: () => hands, rankOfPlace: () => 0,
    tierOf: () => '', statusesOf: () => [], setClass: () => '', scalesOf: () => [], placeOf: () => null, gaveTo: () => [] };
  const model = sandbox.IndexFilter.createFilter(deps);
  const prepare = (id = 'gear', rows = [a, a, b]) => model.options({ id }, rows);
  assert.equal(prepare().tiers.size, 0);
  deps.tierOf = r => r.id;
  assert.deepEqual(Array.from(prepare().tiers, e => Array.from(e)), [['a', 2], ['b', 1]]);
  deps.statusesOf = (r, hows) => hows[0] === 'grants' ? ['Healing'] : ['Quiet', 'Quiet'];
  assert.deepEqual(Array.from(prepare().inflicted, e => Array.from(e)), [['Quiet', 6]]);
  assert.deepEqual(Array.from(prepare().granted, e => Array.from(e)), [['Healing', 3]]);
  deps.scalesOf = () => ['WIS', 'WIS']; assert.equal(prepare().scaled.get('WIS'), 6);
  deps.setClass = r => r.id; assert.equal(prepare('sets').classes.get('a'), 2);
  places = new Map([['a', a], ['b', b]]); deps.placeOf = r => r;
  assert.deepEqual(Array.from(prepare('enemies').homesOrdered, e => Array.from(e)), [['b', 1], ['a', 2]], 'name tie break');
  deps.rankOfPlace = p => p === a ? -1 : 0;
  assert.equal(prepare('enemies').homesOrdered[0][0], 'a');
  places = new Map([['a', { id: 'a', name: 'A' }], ['b', b]]); deps.rankOfPlace = () => 0;
  assert.equal(prepare('enemies').homesOrdered[0][0], 'a', 'record resolution remains live');
  tags = { sb: { say: 'Soulbound', fams: ['gear'], test: () => false } };
  assert.equal(prepare().tags.length, 0);
  S = state({ tags: new Set(['sb']) }); assert.strictEqual(prepare().tags[0][1], tags.sb);
  tags = { shiny: { say: 'Shiny', fams: ['gear'], test: () => true } };
  assert.strictEqual(prepare().tags[0][1], tags.shiny);
  assert.equal(prepare('events').tags.length, 0);
  classes = [a, b]; hands = ['weapon', 'ring']; S = state({ dcls: 'chosen', dh: 'ring' });
  const calls = [];
  deps.gaveTo = (r, cls, hand) => { calls.push([r, cls, hand]); return cls === 'a' || hand === 'weapon' ? [r] : []; };
  const got = prepare('dungeons');
  assert.deepEqual(Array.from(got.dungeonClasses, e => Array.from(e)), [['a', 3]]);
  assert.deepEqual(Array.from(got.handsLeft, e => Array.from(e)), [['weapon', 3]]);
  assert.deepEqual(calls.map(([r, cls, hand]) => [r.id, cls, hand]),
    ['a', 'b'].flatMap(cls => ['a', 'a', 'b'].map(id => [id, cls, 'ring']))
      .concat(['weapon', 'ring'].flatMap(hand => ['a', 'a', 'b'].map(id => [id, 'chosen', hand]))));
  assert.strictEqual(calls[0][0], a, 'classifiers receive original references');
  classes = []; hands = []; deps.gaveTo = () => { throw Error('must not be called'); };
  assert.equal(prepare('dungeons').dungeonClasses.length, 0); assert.equal(prepare('dungeons').handsLeft.length, 0);
  let perCall = 0; deps.getState = () => { perCall++; return state(); }; prepare(); assert.equal(perCall, 1);
  assert(reads > 15);
  console.log(`Index facet parity: ${corpus.cases.length} real states with/without archive, ${corpus.edges.length} edges and ${corpus.failures.length} historical failures; identical options, counts, order, results and references.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
