'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const assert = require('assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.resolve(root, file), 'utf8');

// Reach the existing data loaders and browse closure, as the Theory harness does.
// No duplicate search, filtering or sorting implementation lives in this harness.
module.exports = async function (engine, browseSource = read('web/index-browse.js'), { archive = false } = {}) {
  const pageMarker = 'return { start, show, open, card, door, close, data, __test: { createOpenController } };';
  const page = read('web/index-page.js');
  assert(page.includes(pageMarker), 'Index data-loader export marker moved');
  const context = {
    window: {}, module: { exports: {} },
    fetch: async file => {
      const resolved = path.resolve(root, 'web', file);
      return { ok: fs.existsSync(resolved), text: async () => read(resolved) };
    }
  };
  vm.runInNewContext(page.replace(pageMarker, `return {
    async prepare() {
      await load(); await loadStatuses(); await loadEvents();
      await loadRealmEyeArchive(); await loadDungeonDifficulties();
      return { all, slots: all.slots, difficulty: dungeonDifficultyOf, archive: () => ${archive ? 'realmeyeArchive' : 'null'} };
    }
  };`), context);
  const data = await context.module.exports.prepare();
  const marker = 'window.RealmIndexBrowse = { mount };';
  const resultMarker = 'results(box, { d, g, all, rows });';
  assert(browseSource.includes(marker) && browseSource.includes(resultMarker), 'Index browse harness markers moved');
  let captured;
  let creations = 0, filterCreations = 0, groupingCreations = 0;
  const browse = {
    window: {}, document: { getElementById: () => null }, module: { exports: {} }, clearTimeout,
    IndexSearch: { createSearch(deps) { creations++; return engine.createSearch(deps); } },
    IndexFilter: { createFilter(deps) { filterCreations++; return require('../web/index-filter').createFilter(deps); } },
    IndexGrouping: { createGrouping(deps) { groupingCreations++; return require('../web/index-grouping').createGrouping(deps); } },
    capture: value => { captured = value; }
  };
  vm.runInNewContext(browseSource.replace("box.dataset.fam = '';", '').replace('function landing(box) {', 'function landing(box) { capture({ all: [], rows: [] }); return;')
    .replace(resultMarker, 'capture({ d, g, all, rows });')
    .replace(/(const fams = \[...per.keys\(\)\];)\n[\s\S]*?(    const parts = new Map\(\);)/, '$1\n$2')
    .replace('    const ctx = { d: null };', '    capture({ all: hits, rows: shownHits, groups: pending }); return; const ctx = { d: null };')
    .replace(marker, `window.RealmIndexBrowse = {
      IX, grouped, groupsFor,
      configure(data) { D = data; readRecords(); buildDomains(); },
      select(state) {
        for (const k of KEYS) S[k] = '';
        S.tags = new Set(); S.tech = false;
        Object.assign(S, state); mid();
      }
    };`), browse);
  const api = browse.window.RealmIndexBrowse;
  api.configure(data);
  return { ...api, select(state) { api.select(state); return captured; }, groupingCreations: () => groupingCreations, filterCreations: () => filterCreations, creations: () => creations };
};
