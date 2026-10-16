'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../web/fiches-c.js'), 'utf8');
const WHERE = 'assets/index/client-forge.json';
const KEPT_TEXT = fs.readFileSync(path.join(__dirname, '../web/assets/index/client-forge.json'), 'utf8');
const expected = JSON.parse(KEPT_TEXT);
const tail = '})();';
assert(source.trimEnd().endsWith(tail), 'fiches-c.js: the end this test reaches the script through has moved');
// 53a235c adds a second layout; both must use the lazy forge reader from the first.
const instrumented = source.replace('\n' + tail,
  '\nwindow.__fiches = { forgeExtra, powerOf, pending: () => pending };\n' + tail)
  .trimEnd().slice(0, -tail.length) + 'window.__layout = { extra };\n' + tail;
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

async function run({ bundle, answer }) {
  const fetched = []; let bigParses = 0; const realParse = JSON.parse;
  const counted = Object.assign(Object.create(Object.getPrototypeOf(JSON)), JSON, { parse(text, ...rest) { if (typeof text === 'string' && text === KEPT_TEXT) bigParses++; return realParse.call(JSON, text, ...rest); } });
  const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 0, height: 0 }) });
  const observer = class { observe() {} unobserve() {} disconnect() {} };
  const page = {
    document: { createElement: element, head: { appendChild() {} }, body: element(), documentElement: element(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createTextNode: () => ({}), fonts: { ready: Promise.resolve() } },
    window: { ROTMG_BUNDLE: bundle, ROTMG_SHARED_DATA: null, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800 },
    fetch(address) { fetched.push(String(address)); if (String(address) === WHERE) return answer(); return Promise.reject(new TypeError('Failed to fetch')); },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    MutationObserver: observer, ResizeObserver: observer, IntersectionObserver: observer,
    JSON: counted, console, Math, Object, Map, Set, WeakMap, WeakSet, Promise, RegExp, String, Number, Array, Date, Boolean, Error, TypeError };
  page.window.document = page.document; page.globalThis = page.window;
  vm.runInNewContext(instrumented, page, { filename: 'web/fiches-c.js' });
  await flush();
  return { fiches: page.window.__fiches, layout: page.window.__layout, fetched, bigParses: () => bigParses };
}

const plain = value => JSON.parse(JSON.stringify(value));
const forgeRequests = page => page.fetched.filter(address => address === WHERE).length;
const response = data => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const unexpectedFetch = () => { throw new Error('Embedded forge data must not be fetched'); };

function checkKnownValues(records) {
  const teratoma = records.Teratoma;
  assert(teratoma, 'Teratoma must exist in the real data');
  assert.deepEqual(plain({
    feed: teratoma.feed,
    xp: teratoma.xp,
    bag: teratoma.bag,
    dust: teratoma.dust,
    dustAmounts: teratoma.dustAmounts,
    forge: {
      canDismantle: teratoma.forge.canDismantle,
      dismantle: teratoma.forge.dismantle,
      forgefire: teratoma.forge.forgefire
    }
  }), {
    feed: 800,
    xp: 6,
    bag: 8,
    dust: 'redDust',
    dustAmounts: [50, 65, 80, 100],
    forge: {
      canDismantle: true,
      dismantle: { rare: 40, legendary: 15 },
      forgefire: 700
    }
  });

  const husk = records['Stoneborn Husk'];
  assert(husk, 'Stoneborn Husk must exist in the real data');
  assert.deepEqual(plain({
    power: husk.power,
    feed: husk.feed,
    xp: husk.xp,
    bag: husk.bag
  }), { power: 89, feed: 900, xp: 6, bag: 6 });
}

function blueprintOwners(records, blueprint) {
  return Object.entries(records)
    .filter(([, value]) => (value.blueprints || []).includes(blueprint))
    .map(([id]) => id)
    .sort();
}

async function checkEmpty(label, options, requests) {
  const page = await run(options);
  assert.equal(page.fiches.pending(), 0, label + ': all requests must settle');
  assert.equal(forgeRequests(page), requests, label + ': unexpected forge request count');
  assert.equal(page.bigParses(), 0, label + ': the real embedded data must not be decoded');

  const records = page.fiches.forgeExtra();
  assert.deepEqual(plain(records), {}, label + ': forge data must be empty');
  assert.strictEqual(page.fiches.forgeExtra(), records, label + ': empty data must be remembered');
  assert.equal(page.fiches.powerOf({ name: 'Stoneborn Husk' }, { facts: {} }), '');
  assert.equal(page.fiches.pending(), 0, label + ': reading data must not change pending');
}

async function main() {
  const offline = await run({
    bundle: { sources: { clientForgeText: KEPT_TEXT } },
    answer: unexpectedFetch
  });
  assert.equal(forgeRequests(offline), 0, 'The downloadable copy must not fetch forge data');
  assert.equal(offline.fiches.pending(), 0, 'Embedded forge data must settle without decoding');
  assert.equal(offline.bigParses(), 0, 'Forge data must remain text until first use');

  const offlineRecords = offline.fiches.forgeExtra();
  assert.equal(offline.bigParses(), 1, 'First use must decode forge data');
  assert.strictEqual(offline.fiches.forgeExtra(), offlineRecords, 'Decoded data must be remembered');
  assert.equal(offline.bigParses(), 1, 'Further reads must not decode forge data again');
  assert.strictEqual(offline.layout.extra({ clientId: 'Teratoma' }), offlineRecords.Teratoma);
  assert.strictEqual(offline.layout.extra({ name: 'Stoneborn Husk' }), offlineRecords['Stoneborn Husk']);
  assert.equal(offline.bigParses(), 1, 'The new layout shares the same decoded payload');

  const httpBundle = { sources: {} };
  const http = await run({
    bundle: httpBundle,
    answer: () => response(expected)
  });
  assert.equal(forgeRequests(http), 1, 'HTTP must fetch forge data exactly once');
  assert.equal(http.fiches.pending(), 0, 'HTTP forge data must settle');
  assert.equal(http.bigParses(), 0, 'HTTP must not decode embedded forge text');
  assert.equal(Object.prototype.hasOwnProperty.call(httpBundle.sources, 'clientForgeText'), false);

  const httpRecords = http.fiches.forgeExtra();
  assert.strictEqual(http.layout.extra({ clientId: 'Teratoma' }), httpRecords.Teratoma);
  assert.strictEqual(http.fiches.forgeExtra(), httpRecords, 'HTTP data must be remembered');
  checkKnownValues(offlineRecords);
  checkKnownValues(httpRecords);

  const blueprintKeys = Object.keys(expected).sort()
    .filter(id => Array.isArray(expected[id].blueprints) && expected[id].blueprints.length > 0)
    .slice(0, 3);
  assert.equal(blueprintKeys.length, 3, 'The real data must provide three blueprint records');

  for (const id of new Set(['Teratoma', 'Stoneborn Husk', ...blueprintKeys])) {
    assert.deepEqual(plain(offlineRecords[id]), expected[id], id + ': embedded values must match the file');
    assert.deepEqual(plain(httpRecords[id]), expected[id], id + ': HTTP values must match the file');
    assert.deepEqual(plain(offlineRecords[id]), plain(httpRecords[id]), id + ': both paths must agree');
  }

  // Index cards also enumerate records to find items unlocked by a blueprint.
  for (const id of blueprintKeys) {
    const blueprint = expected[id].blueprints[0];
    const owners = blueprintOwners(expected, blueprint);
    assert(owners.includes(id), id + ': the chosen blueprint must unlock this item');
    assert.deepEqual(blueprintOwners(offline.fiches.forgeExtra(), blueprint), owners);
    assert.deepEqual(blueprintOwners(http.fiches.forgeExtra(), blueprint), owners);
  }

  // Exercise the actual function that supplies the displayed power.
  for (const page of [offline, http]) {
    assert.equal(page.fiches.powerOf({ clientId: 'Stoneborn Husk' }, { facts: { power: 'fallback' } }), '89');
    assert.equal(page.fiches.powerOf({ name: 'Stoneborn Husk' }, { facts: { power: 'fallback' } }), '89');
  }
  assert.equal(offline.bigParses(), 1, 'Enumeration and displayed power must reuse decoded data');
  assert.equal(http.bigParses(), 0, 'HTTP reads must not decode embedded data');
  assert.equal(forgeRequests(offline), 0);
  assert.equal(forgeRequests(http), 1);

  await checkEmpty('Invalid embedded JSON', {
    bundle: { sources: { clientForgeText: '{invalid JSON' } },
    answer: unexpectedFetch
  }, 0);

  await checkEmpty('Empty embedded text', {
    bundle: { sources: { clientForgeText: '' } },
    answer: () => response({})
  }, 1);

  await checkEmpty('Rejected fetch without a bundle', {
    bundle: undefined,
    answer: () => Promise.reject(new TypeError('Failed to fetch'))
  }, 1);

  await checkEmpty('Non-JSON response', {
    bundle: { sources: {} },
    answer: () => Promise.resolve({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected HTML'))
    })
  }, 1);

  // The existing HTTP path calls json() without checking the response status.
  await checkEmpty('Non-ok response with a non-JSON body', {
    bundle: { sources: {} },
    answer: () => Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.reject(new SyntaxError('Unexpected HTML'))
    })
  }, 1);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
