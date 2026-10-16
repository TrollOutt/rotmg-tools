'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const AppData = require('../web/app-data'), engine = require('../web/engine'), items = require('../web/items');
const harness = require('./app-harness');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'app-data-corpus.json.gz'))));
// This corpus was frozen from app.js at the recorded base, before extraction.
// Encode undefined/non-finite values too, rather than losing object properties.
const plain = x => JSON.parse(JSON.stringify(x, (_, v) => v === undefined ? { $undefined: true }
  : typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)) ? { $number: String(v) } : v));
const capture = fn => { try { return { value: plain(fn()) }; } catch (error) { return { error: error.name }; } };
const sources = {
  clientModText: read('data/Enchantment documents/client-enchantments.txt'),
  clientItemText: read('data/Items/client-items.txt'),
  clientArtifactText: read('data/Artifacts/client-artifacts.txt'),
  awakenText: read('data/Awakened Items/awakenedItems.txt')
};
const data = engine.buildDataset(sources);
items.loadClient(sources.clientItemText);
const state = { data };
let catalogue = items;
const api = AppData.createItemResolver({ getData: () => state.data, getItems: () => catalogue });
const adapter = harness(state, () => catalogue);
let cases = 0;
function parity(actual, expected, label) { assert.deepEqual(actual, expected, label); cases++; }
for (const [name, expected] of corpus.resolve) parity(capture(() => api.resolveItem(name)), expected, 'item: ' + name);
for (const [name, expected] of corpus.enchant) parity(capture(() => api.handoverEnchantName(name)), expected, 'enchant: ' + name);
for (const [said, expected] of corpus.handover) parity(capture(() => api.handoverSetup(said)), expected, 'handover: ' + said.item);
parity(plain(api.knownItemNames()), corpus.names, 'ordered, deduplicated picker names');
// App callers retain their names and signatures and share exactly one factory.
for (const [name, expected] of corpus.resolve.filter((_, i) => i % 97 === 0)) {
  assert.deepEqual(capture(() => adapter.resolveItem(name)), expected);
}
for (const [said, expected] of corpus.handover.filter((_, i) => i % 113 === 0)) {
  assert.deepEqual(capture(() => adapter.handoverSetup(said)), expected);
}
for (const [name, expected] of corpus.enchant.filter((_, i) => i % 29 === 0)) {
  assert.deepEqual(capture(() => adapter.handoverEnchantName(name)), expected);
}
assert.deepEqual(plain(adapter.knownItemNames()), corpus.names);
assert.equal(adapter.creations(), 1);

// Fresh results, original awakening arrays, and no memoized names or lookups.
for (const [name, awakening] of data.awakenings) {
  const a = api.resolveItem(name), b = api.resolveItem(name);
  assert.notStrictEqual(a, b);
  assert.strictEqual(a.awoken, awakening);
  assert.strictEqual(b.awoken, awakening);
  assert.strictEqual(adapter.resolveItem(name).awoken, awakening);
}
const wikiOnly = [...items.index.keys()].find(n => !data.awakenings.has(n) && api.resolveItem(n)?.source === 'wiki');
assert.notStrictEqual(api.resolveItem(wikiOnly).awoken, api.resolveItem(wikiOnly).awoken);
assert.notStrictEqual(api.knownItemNames(), api.knownItemNames());
const name = data.byName.keys().next().value;
const repeated = api.handoverSetup({ item: wikiOnly, slots: [name, name, name, name, name] });
assert.equal(repeated.setup.slots.length, 4);
assert(repeated.setup.slots.every(s => s.name === name && s.locked === false));
assert.notStrictEqual(repeated.setup.slots[0], repeated.setup.slots[1]);

const edgeCases = [
  ['missing', null, null], ['empty', { awakenings: new Map(), byName: new Map() }, null], ['partial', {}, null],
  ['fallback', { awakenings: new Map([['Neo Épée', ['alien']], ['Épée', []], ['épée', ['missing']], ['Empty', null], ['Duplicate', ['alien', 'alien']]]),
    byName: new Map([['alien', { tags: new Set(['ALIEN']), itemTags: new Set(['ABILITY', 'WEAPON']) }], ['Oryx’s Rage IV', {}], ['Oryx-Rage II', {}], ['Oryx Rage I', {}], ['Oryx Rage III', {}]]) }, null],
  ['incomplete-known', { awakenings: new Map([['Neo Épée', ['alien']]]), byName: new Map([['alien', { tags: new Set(['ALIEN']), itemTags: new Set() }]]) },
    { index: new Map([['Neo Épée', {}], ['Known', { name: 'Known', type: 'RING', dust: 'Red', tiered: true, note: 'kept', base: 'NEO_ALIEN' }]]), lookup(n) { return this.index.get(n); } }]
];
const edges = [];
for (const [label, d, c] of edgeCases) {
  state.data = d; catalogue = c === null ? undefined : c;
  for (const q of ['', ' ', 'Neo Épée', 'NEO ÉPÉE', ' ÉPÉE ', 'épée', 'Epee', 'Empty', 'Duplicate', 'Known', null, undefined, NaN, Infinity, -Infinity, 0, 1])
    edges.push([label, 'resolve', String(q), capture(() => api.resolveItem(q))]);
  edges.push([label, 'names', '', capture(() => api.knownItemNames())]);
  for (const q of ['', null, undefined, 0, 1, NaN, Infinity, 'oryx rage', 'oryx rage IV', 'oryx rage V', 'Oryx’s Rage IV', 'oryx-rage II', 'ÉPÉE'])
    edges.push([label, 'enchant', String(q), capture(() => api.handoverEnchantName(q))]);
  for (const said of [{ item: '' }, { item: 'Neo Épée', slots: [] }, { item: 'Known', slots: ['oryx rage IV', 'oryx rage V', 'oryx rage', null, 'oryx rage', 'oryx rage'] }, { item: 'Neo Épée', slots: 'invalid' }])
    edges.push([label, 'handover', JSON.stringify(said), capture(() => api.handoverSetup(said))]);
}
parity(edges, corpus.edge, 'missing/partial sources, case, accents, ranks, duplicates, empty and non-finite inputs');
cases += edges.length - 1;

// Dependencies are live, including mid-call replacement by a catalogue lookup.
const old = ['old'], next = ['new'];
state.data = { awakenings: new Map([['Live', old]]), byName: new Map() };
catalogue = undefined;
assert.strictEqual(api.resolveItem('Live').awoken, old);
state.data = { awakenings: new Map([['Live', next]]), byName: new Map() };
assert.strictEqual(api.resolveItem('Live').awoken, next);
assert.strictEqual(adapter.resolveItem('Live').awoken, next);
state.data.awakenings.set('Added', []);
assert.deepEqual(api.knownItemNames(), ['Added', 'Live']);
catalogue = { index: new Map([['Known live', {}]]), lookup: n => ({ name: n, type: 'RING', dust: 'Red' }) };
assert.equal(api.resolveItem('Live').source, 'both');
assert.equal(api.resolveItem('Live').type, 'RING');
assert.deepEqual(api.knownItemNames(), ['Added', 'Known live', 'Live']);
catalogue.index = new Map([['Rebuilt index', {}]]);
assert.deepEqual(adapter.knownItemNames(), ['Added', 'Live', 'Rebuilt index']);
catalogue.lookup = n => { state.data = { awakenings: new Map([['Live', old]]), byName: new Map() }; return { name: n, type: 'WEAPON', dust: 'Green' }; };
assert.strictEqual(api.resolveItem('Live').awoken, old);
state.data.byName = new Map([['New Charm II', {}]]);
assert.equal(api.handoverEnchantName('new-charm II'), 'New Charm II');
state.data.byName = new Map([['New Charm IV', {}]]);
assert.equal(adapter.handoverEnchantName('new-charm'), 'New Charm IV');
assert.equal(adapter.creations(), 1);
// A present but malformed library is not an absent script: keep its failure.
catalogue = null;
assert.throws(() => api.resolveItem('Live'), TypeError);
assert.throws(() => api.knownItemNames(), TypeError);
assert.throws(() => adapter.resolveItem('Live'), TypeError);
assert.throws(() => adapter.knownItemNames(), TypeError);
// Construction itself must neither read dependencies nor touch a browser API.
const isolated = {};
vm.runInNewContext(read('web/app-data.js'), isolated);
let reads = 0;
const independent = isolated.AppData.createItemResolver({ getData() { reads++; return null; }, getItems() { reads++; return undefined; } });
assert.equal(reads, 0);
assert.equal(independent.resolveItem(''), null);
assert.equal(reads, 0);
assert.deepEqual([...independent.knownItemNames()], []);
assert.equal(reads, 2);
console.log(`App data parity: ${cases} frozen cases identical; references, live sources, one factory and DOM independence verified.`);
