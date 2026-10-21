'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

// Run the real ring catalogue against the pages in each HTML document.
function modulesFor(app, html) {
  const pages = app.match(/const PAGES = \{[\s\S]*?\};/);
  const start = app.indexOf('const MODULES = [');
  const end = app.indexOf('const NS = ', start);
  assert(pages && start >= 0 && end > start, 'Home navigation declarations are extractable');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  return vm.runInNewContext(pages[0] + '\n' + app.slice(start, end) + '\nMODULES', {
    document: { getElementById: id => ids.has(id) ? { id } : null },
    RealmI18n: { t: key => key }
  });
}
module.exports = { modulesFor };

if (require.main === module) {
  const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  const destinations = markup => Array.from(modulesFor(app, markup), m => m.go).filter(Boolean);
  assert.deepEqual(destinations(html), ['enchant', 'theory', 'fame', 'index', 'skins', 'pets']);
  const kept = html.replace('id="pageSkins"', 'id="omittedSkinPage"');
  assert.deepEqual(destinations(kept), ['enchant', 'theory', 'fame', 'index', 'pets'],
    'A kept HTML must not recreate a link to the omitted Skin Viewer');
  assert(!modulesFor(app, kept).some(m => m.walk),
    'The omitted viewer must not request its external walking strip');
  assert(!modulesFor(app, html).some(m => m.soon),
    'Every module on the way in leads somewhere: the Pet Fame Calculator took the last placeholder');
  console.log('Home navigation: only pages present in the document are offered.');
}
