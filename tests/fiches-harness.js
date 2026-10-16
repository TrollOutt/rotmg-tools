'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

function run({ bundle, answer, shared = null, source = read('web/fiches-c.js'), dataModule = read('web/fiches-data.js') }) {
  const fetched = []; let bigParses = 0; const realParse = JSON.parse;
  const counted = Object.assign(Object.create(Object.getPrototypeOf(JSON)), JSON, { parse(text, ...rest) { if (typeof text === 'string' && text.length > 1000) bigParses++; return realParse.call(JSON, text, ...rest); } });
  const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 0, height: 0 }) });
  const observer = class { observe() {} unobserve() {} disconnect() {} };
  const page = {
    document: { createElement: element, head: { appendChild() {} }, body: element(), documentElement: element(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createTextNode: () => ({}), fonts: { ready: Promise.resolve() } },
    window: { ROTMG_BUNDLE: bundle, ROTMG_SHARED_DATA: shared, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800 },
    fetch(address) { fetched.push(String(address)); if (['assets/index/client-forge.json','assets/index/realmeye-enrichment.json'].includes(String(address))) return answer(String(address)); return Promise.reject(new TypeError('Failed to fetch')); },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    MutationObserver: observer, ResizeObserver: observer, IntersectionObserver: observer,
    JSON: counted, console, Math, Object, Map, Set, WeakMap, WeakSet, Promise, RegExp, String, Number, Array, Date, Boolean, Error, TypeError };
  page.window.document = page.document; page.globalThis = page.window;
  let creations = 0;
  vm.runInNewContext(dataModule, page);
  const create = page.FichesData.createCardData;
  page.FichesData.createCardData = deps => { creations++; return create(deps); };
  assert(source.includes('\n})();'), 'Card harness closure marker moved');
  const instrumented = source.replace('\n})();', '\nwindow.__fiches = { forgeExtra, communityRecords, communityOf, parseSummary, powerOf, pending: () => pending };\n})();');
  vm.runInNewContext(instrumented, page, { filename: 'web/fiches-c.js' });
  return { creations: () => creations, fiches: page.window.__fiches, fetched, bigParses: () => bigParses };
}

module.exports = {run, flush};
