'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { sourceSlice } = require('./source-slice');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
// Execute the real calculator adapters, without its DOM initialization.
module.exports = function (state, getItems, source = read('web/app.js')) {
  const slice = sourceSlice(source, 'web/app.js');
  let creations = 0;
  const context = { state, module: { exports: {} }, AppData: {
    createItemResolver(deps) { creations++; return require('../web/app-data').createItemResolver(deps); }
  } };
  Object.defineProperty(context, 'EnchantItems', { get: getItems });
  vm.runInNewContext(slice('const appData = AppData.createItemResolver(', '/* ------------------------------------------------------------------ *\n * Configuration')
    + slice('function handoverSetup(said)', '/*\n * One item handed over')
    + '\nmodule.exports = { resolveItem, knownItemNames, handoverSetup, handoverEnchantName };', context);
  return { ...context.module.exports, creations: () => creations };
};

// Run the real restoration, persistence and tab-transition functions together.
module.exports.storage = function (initial = {}, options = {}) {
  const slice = sourceSlice(options.source || read('web/app.js'), 'web/app.js');
  const calls = [], values = new Map(Object.entries(initial)), timers = [];
  const fields = Object.fromEntries(['rarity', 'itemType', 'dustType', 'awakenedItem']
    .map(id => [id, { value: '' }]));
  const subtypes = ['SUMMONPOWERED', 'ALIEN', 'NEO_ALIEN'].map(value => ({ value, checked: false }));
  const tiers = ['1', '2', '3'].map(value => ({ value, checked: false }));
  const state = { ready: true, loadingTab: false, tabs: [], activeTab: null,
    slots: [1, 2, 3, 4].map(index => ({ index, name: '', locked: false })),
    data: { byName: new Map([['Known', {}]]) }, filters: { tarot: true, engraving: false },
    itemOptimizeGoal: 'dps' };
  const context = { state, module: { exports: {} },
    SAVE_KEY: 'rotmg-enchant-calculator/v1', TABS_KEY: 'rotmg-enchant-calculator/tabs/v1',
    FILTER_KEY: 'rotmg-enchant-calculator/filters/2',
    ITEM_OPTIMIZER_GOALS: [{ id: 'dps' }, { id: 'stat:hp' }],
    Date: { now: () => 123456 }, Math: Object.assign(Object.create(Math), { random: () => .5 }),
    $: id => fields[id] || null,
    document: {
      querySelector: () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {} } }),
      querySelectorAll: query => {
        const boxes = query.startsWith('#tiers') ? tiers : subtypes;
        return query.endsWith(':checked') ? boxes.filter(box => box.checked) : boxes;
      }
    },
    renderSubtypes() {}, renderTabs() {}, clearResults() {},
    blacklistedArtifacts: () => state.artifactBlacklist || new Set(),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
    localStorage: {
      getItem(key) {
        calls.push(['get', key]);
        if (options.read) return options.read(key, values);
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        calls.push(['set', key, value]);
        if (options.write) options.write(key, value, values);
        else values.set(key, value);
      },
      removeItem(key) { calls.push(['remove', key]); values.delete(key); }
    }
  };
  // refresh's calculation/rendering is out of scope here; retain its real save
  // boundary. The HTTP checks exercise the full refresh with the real DOM.
  context.refresh = () => context.module.exports.saveSetup();
  vm.runInNewContext(slice('function captureSetup()', 'function renderTabs()')
    + slice('const TAB_SWAP_MS = 190;', 'function addTab()')
    + slice('function resetSetup()', 'function onFieldChange(element)')
    + '\nmodule.exports = { loadTabs, loadFilters, applySetup, captureSetup, saveSetup, persistTabs, resumeTabSaving, resetSetup, switchTab, newTab };', context);
  return { ...context.module.exports, state, values, calls, fields, subtypes, tiers, timers,
    refresh: context.refresh,
    restore() {
      context.module.exports.loadFilters(); context.module.exports.loadTabs();
      state.loadingTab = true;
      context.module.exports.applySetup(state.tabs.find(tab => tab.id === state.activeTab).setup);
      state.loadingTab = false; context.refresh();
    } };
};
