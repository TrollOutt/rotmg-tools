/*
 * The visitor counter counts the published site and nothing else.
 *
 *   node tests/visit-counter.test.js
 *
 * The counter is an immediately-invoked function inside web/app.js and inside
 * the Atlas template, so it is cut out of the source and run against a made-up
 * page: a location, a recording fetch and the few things it touches. Nothing
 * here opens a browser or reaches the real Abacus service.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function counterOf(file) {
  const source = read(file);
  const start = source.indexOf('(function countVisitors() {');
  assert(start >= 0, file + ': the visitor counter is not where this test looks for it');
  const end = source.indexOf('\n})();', start);
  assert(end > start, file + ': the end of the visitor counter was not found');
  return source.slice(start, end + '\n})();'.length);
}

// What the counter does on a page at `url`, as the requests it makes.
function run(code, url, { bare = false, counted = null } = {}) {
  const at = new URL(url);
  const asked = [], timers = [], stored = {};
  if (counted) stored['atlas-counted'] = counted;
  const page = {
    location: { protocol: at.protocol, hostname: at.hostname, pathname: at.pathname, href: at.href },
    fetch(address) {
      asked.push(String(address));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: 7 }) });
    },
    document: {
      hidden: false,
      getElementById: () => ({ hidden: true, textContent: '' }),
      addEventListener() {}
    },
    localStorage: {
      getItem: key => (key in stored ? stored[key] : null),
      setItem: (key, value) => { stored[key] = String(value); }
    },
    RealmI18n: { number: n => String(n) },
    setInterval: (fn, ms) => { timers.push(ms); return timers.length; },
    bare,
    Date,
    console
  };
  vm.runInNewContext(code, page);
  return { asked, timers, stored };
}

const published = 'https://trolloutt.github.io/rotmg-tools/';
const elsewhere = [
  'http://localhost:5173/',
  'http://localhost:8001/web/',
  'http://127.0.0.1:8001/web/',
  'http://[::1]:8001/web/',
  'http://app.localhost:3000/rotmg-tools/',
  'http://192.168.1.20:8080/rotmg-tools/',
  'http://10.0.0.4:4173/rotmg-tools/',
  'file:///C:/Users/someone/Downloads/Realm-Tools.html',
  'file:///home/someone/Realm-Tools.html',
  // The right host with something else about it.
  'http://trolloutt.github.io/rotmg-tools/',
  'https://trolloutt.github.io/',
  'https://trolloutt.github.io/other-project/',
  'https://trolloutt.github.io/rotmg-tools',
  'https://trolloutt.github.io.example.com/rotmg-tools/',
  'https://example.com/trolloutt.github.io/rotmg-tools/',
  'https://other.github.io/rotmg-tools/'
];

const pages = {
  'web/app.js': counterOf('web/app.js'),
  'tools/atlas-viewer.html': counterOf('tools/atlas-viewer.html'),
  // The page that is actually served is built from the template above.
  'web/assets/atlas/index.html': counterOf('web/assets/atlas/index.html')
};

let checks = 0;
for (const [file, code] of Object.entries(pages)) {
  for (const url of elsewhere) {
    const seen = run(code, url);
    assert.deepEqual(seen.asked, [], `${file} on ${url}: no request may leave a page that is not the published site`);
    assert.deepEqual(seen.timers, [], `${file} on ${url}: no heartbeat may start`);
    assert.deepEqual(seen.stored, {}, `${file} on ${url}: nothing is remembered about a visit that was not counted`);
    checks += 3;
  }

  // On the published site the counter behaves as it always did.
  const first = run(code, published);
  assert(first.asked.length > 0 && first.asked.every(a => a.startsWith('https://abacus.jasoncameron.dev/')),
    `${file}: on the published site the counter talks to Abacus and to nothing else`);
  const hits = first.asked.filter(a => a.includes('/hit/rotmg-realm-atlas/'));
  assert(hits.some(a => a.endsWith('/all')), `${file}: the first visit of a day is added to the total`);
  assert(hits.some(a => /\/d\d{8}$/.test(a)), `${file}: and to the day`);
  assert(hits.some(a => /\/m\d{12}$/.test(a)), `${file}: and the minute is marked for "here now"`);
  assert(first.asked.some(a => a.includes('/get/rotmg-realm-atlas/m')), `${file}: the minute just gone is read`);
  assert.deepEqual(first.timers, [20000], `${file}: the heartbeat runs every twenty seconds`);
  assert.match(first.stored['atlas-counted'], /^\d{4}-\d{2}-\d{2}$/, `${file}: the day is remembered`);

  // The same browser coming back the same day is read, not counted again.
  const today = first.stored['atlas-counted'];
  const again = run(code, published, { counted: today });
  assert(!again.asked.some(a => a.includes('/hit/rotmg-realm-atlas/all') || /\/hit\/rotmg-realm-atlas\/d\d{8}$/.test(a)),
    `${file}: a second visit on the same day does not add to the total or the day`);
  assert(again.asked.some(a => a.includes('/get/rotmg-realm-atlas/all')), `${file}: it still reads the total`);

  // Anywhere under the project path counts, the Atlas frame included.
  const deep = run(code, published + 'assets/atlas/index.html');
  assert(deep.asked.length > 0, `${file}: a page below the project path is counted`);
  checks += 9;
}

// Framed in the site, the Atlas leaves the counting to the page around it.
for (const file of ['tools/atlas-viewer.html', 'web/assets/atlas/index.html']) {
  const framed = run(pages[file], published, { bare: true });
  assert.deepEqual(framed.asked, [], `${file}: an embedded Atlas does not count a second time`);
  checks++;
}

// The two Atlas files must carry the same condition, so a rebuild cannot drop it.
for (const file of ['web/app.js', 'tools/atlas-viewer.html', 'web/assets/atlas/index.html']) {
  const source = read(file);
  assert(source.includes("location.hostname === 'trolloutt.github.io'")
    && source.includes("location.pathname.startsWith('/rotmg-tools/')")
    && source.includes("location.protocol === 'https:'"), file + ': the production condition is missing');
  checks++;
}

// The three counters above are the only places that may talk to Abacus. A
// fourth would count visits from anywhere and this test would never see it.
const allowed = new Set(['web/app.js', 'tools/atlas-viewer.html', 'web/assets/atlas/index.html']);
const callers = [];
(function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = directory + '/' + entry.name;
    if (entry.isDirectory()) { walk(relative); continue; }
    if (!/\.(?:js|mjs|html)$/.test(entry.name)) continue;
    if (/abacus/i.test(read(relative))) callers.push(relative);
  }
})('web');
(function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = directory + '/' + entry.name;
    if (entry.isDirectory()) { if (entry.name !== '__pycache__') walk(relative); continue; }
    if (/\.(?:js|mjs|html)$/.test(entry.name) && /abacus/i.test(read(relative))) callers.push(relative);
  }
})('tools');
assert.deepEqual(callers.sort(), [...allowed].sort(),
  'only the three guarded counters may name Abacus; found: ' + callers.join(', '));
checks++;

console.log(`Visitor counter: ${checks} checks - counted only on the published site, never locally or from a file.`);
