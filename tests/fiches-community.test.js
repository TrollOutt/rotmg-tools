/*
 * The cards carry what RealmEye says, in the downloadable copy as on the site.
 *
 *   node tests/fiches-community.test.js
 *
 * web/fiches-c.js dresses every Index card with the community's facts and notes,
 * read from realmeye-enrichment.json. The site fetches that file. The downloadable
 * copy opened from disk cannot fetch anything beside it, so the file is carried
 * inside it as text - and the cards used to ask the disk anyway, fail, and go
 * without: about a quarter of the words on a card were missing.
 *
 * The real script is run here against a made-up page: a recording fetch, a bundle
 * that does or does not carry the text, and the few things it touches on loading.
 * Nothing opens a browser; the real page is checked separately, from a file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../web/fiches-c.js'), 'utf8');
const tail = '})();';
assert(source.trimEnd().endsWith(tail), 'fiches-c.js: the end this test reaches the script through has moved');
// 53a235c adds a second layout closure; the data loader still lives in the first.
const instrumented = source.replace('\n' + tail,
  '\nwindow.__fiches = { communityOf, pending: () => pending };\n' + tail);

const ENRICHMENT = {
  records: {
    'item:Test Blade': {
      facts: { power_level: '7', xp_bonus: '12%', feed_power: '350', dismantling_value: '10 / 20', forging_cost: 'Light 100',
        dust_type: 'Fire', loot_bag: 'Brown', effect_s: 'Armor Broken', obtained_through: 'Test Dungeon' },
      presentation: { summary: 'XP Bonus 12% Feed Power 350 Reskin(s) Blade Two Upgrade Blade Three Notes TBA Hits twice. It rings.' }
    },
    'item:Summary Only': {
      presentation: { summary: 'A plain blade. Power Level 5 XP Bonus 8% Feed Power 1,200 Notes Found in tests.' }
    }
  },
  pageIndex: {}
};
const TEXT = JSON.stringify(ENRICHMENT);
const WHERE = 'assets/index/realmeye-enrichment.json';

// The expected values, written out: what a card must say about each record.
const EXPECT = {
  'item:Test Blade': {
    facts: { power: '7', xp: '12%', feed: '350', dismantle: '10 / 20', forge: 'Light 100', dust: 'Fire', bag: 'Brown', effect: 'Armor Broken', got: 'Test Dungeon' },
    notes: 'Hits twice. It rings.', variants: 'Reskin: Blade Two · Upgrade: Blade Three'
  },
  'item:Summary Only': { facts: { xp: '8%', feed: '1,200', power: '5' }, notes: 'Found in tests.', variants: '' }
};
const EMPTY = { facts: {}, notes: '', prose: [], variants: '' };

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

// Run the real script against a page. `bundle` carries the text or not; `answer` is what fetch gives for the file.
async function run({ bundle, answer }) {
  const fetched = [];
  let bigParses = 0;
  const realParse = JSON.parse;
  const counted = Object.assign(Object.create(Object.getPrototypeOf(JSON)), JSON, {
    parse(text, ...rest) { if (typeof text === 'string' && text === TEXT) bigParses++; return realParse.call(JSON, text, ...rest); }
  });
  const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, setAttribute() {},
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 0, height: 0 }) });
  const observer = class { observe() {} unobserve() {} disconnect() {} };
  const page = {
    document: { createElement: element, head: { appendChild() {} }, body: element(), documentElement: element(), getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createTextNode: () => ({}), fonts: { ready: Promise.resolve() } },
    window: { ROTMG_BUNDLE: bundle, ROTMG_SHARED_DATA: null, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800 },
    fetch(address) {
      fetched.push(String(address));
      if (String(address) === WHERE) return answer();
      return Promise.reject(new TypeError('Failed to fetch'));       // everything else is out of reach
    },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    MutationObserver: observer, ResizeObserver: observer, IntersectionObserver: observer,
    JSON: counted, console, Math, Object, Map, Set, WeakMap, WeakSet, Promise, RegExp, String, Number, Array, Date, Boolean, Error, TypeError
  };
  page.window.document = page.document;
  page.globalThis = page.window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/fiches-data.js'), 'utf8'), page, { filename: 'web/fiches-data.js' });
  vm.runInNewContext(instrumented, page, { filename: 'web/fiches-c.js' });
  await flush();
  const fiches = page.window.__fiches;
  return { fiches, fetched, bigParses: () => bigParses, enrichmentFetches: () => fetched.filter(a => a === WHERE).length };
}

const jsonAnswer = () => Promise.resolve({ ok: true, json: () => Promise.resolve(realParseOf(TEXT)) });
const realParseOf = text => JSON.parse(text);
const plain = value => JSON.parse(JSON.stringify(value));   // objects made inside the page come from another realm

(async () => {
let checks = 0;

// 1. The downloadable copy: the text is carried inside, so nothing is fetched and the cards still know it.
{
  const bundle = { sources: { realmeyeEnrichmentText: TEXT } };
  const p = await run({ bundle, answer: () => assert.fail('the enrichment must not be fetched when the copy carries it') });
  assert.equal(p.enrichmentFetches(), 0, 'no request for a file that is already inside the page');
  assert.equal(p.fiches.pending(), 0, 'the cards are not held back waiting for it');
  assert.equal(p.bigParses(), 0, 'and the text is not decoded before a card asks for it');
  for (const [id, want] of Object.entries(EXPECT)) {
    const got = p.fiches.communityOf({ id, about: '' });
    assert.deepEqual(plain(got.facts), want.facts, id + ': the facts the card shows');
    assert.equal(got.notes, want.notes, id + ': the notes');
    assert.equal(got.variants, want.variants, id + ': the reskins and upgrade');
  }
  assert.equal(p.bigParses(), 1, 'the text is decoded once, when the first card asks');
  p.fiches.communityOf({ id: 'item:Test Blade', about: '' });
  p.fiches.communityOf({ id: 'item:nobody', about: '' });
  assert.equal(p.bigParses(), 1, 'and not again for later cards');
  assert.deepEqual(plain(p.fiches.communityOf({ id: 'item:nobody', about: '' })), EMPTY, 'a record the file does not know has nothing to add');
  checks += 11;
}

// 2. The site: the file is fetched once, as before, and the cards say exactly the same.
{
  const p = await run({ bundle: null, answer: jsonAnswer });
  assert.equal(p.enrichmentFetches(), 1, 'the site fetches the file once');
  assert.equal(p.fiches.pending(), 0, 'and the cards are released when it has arrived');
  assert.equal(p.bigParses(), 0, 'the site decodes it through the response, not through JSON.parse on text');
  for (const [id, want] of Object.entries(EXPECT)) {
    const got = p.fiches.communityOf({ id, about: '' });
    assert.deepEqual(plain(got.facts), want.facts, id + ': the same facts as in the downloadable copy');
    assert.equal(got.notes, want.notes, id + ': the same notes');
    assert.equal(got.variants, want.variants, id + ': the same reskins and upgrade');
  }
  checks += 9;
}

// 3. Whatever goes wrong, the cards are released and say nothing about the community.
for (const [name, options] of [
  ['the site cannot fetch the file', { bundle: null, answer: () => Promise.reject(new TypeError('Failed to fetch')) }],
  ['the site gets an error page', { bundle: null, answer: () => Promise.resolve({ ok: false, json: () => Promise.reject(new SyntaxError('Unexpected token <')) }) }],
  ['the copy carries text that is not JSON', { bundle: { sources: { realmeyeEnrichmentText: '<<not json>>' } }, answer: () => assert.fail('no fetch') }],
  ['the copy carries an empty text', { bundle: { sources: { realmeyeEnrichmentText: '' } }, answer: () => Promise.reject(new TypeError('Failed to fetch')) }]
]) {
  const p = await run(options);
  assert.equal(p.fiches.pending(), 0, name + ': the cards are not left hidden');
  assert.deepEqual(plain(p.fiches.communityOf({ id: 'item:Test Blade', about: '' })), EMPTY, name + ': nothing is claimed');
  assert.deepEqual(plain(p.fiches.communityOf({ id: 'item:Test Blade', about: '' })), EMPTY, name + ': and it stays so');
  checks += 3;
}

console.log(`Cards and the community: ${checks} checks - the downloadable copy tells what the site tells, and reads it when a card asks.`);
})().catch(error => { console.error(error); process.exit(1); });
