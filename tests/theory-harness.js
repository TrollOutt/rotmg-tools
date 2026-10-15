'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
// Test-only access to the UI closure, with the arithmetic engine supplied below.
module.exports = function(sources, raw, withEngine = true) {
  const file = path.join(__dirname, '../web/theorycraft.js');
  const original = fs.readFileSync(file, 'utf8');
  const marker = 'return { start, share, open, put };';
  if (!original.includes(marker)) throw new Error('Theory harness return marker moved');
  const script = original.replace(marker, `return {
    statsOf, setsOn, scaleOf, subOf, landed, weaponRate, abilityRate,
    charmNamed, locksOn, rollableEnchantsFor, enchantFitsItem, plainly, enchantKey, worth, NUMERAL,
    setRules(value) { rules = value; },
    numbersFor, optimise, scoreOf, goalsOf, bestAlone, shareOf, sharesOf, aimOf, accessible, beatenOnes, enchantsFor, itemsFor, compatibleItemsFor,
    indexItemAliases, fresh, GOALS, loadStatusInfo, effectsFor, fxOf, durationOf,
    setStatusInfo(value) { statusInfo = value; },
    prepareAccessible, searchItems, handoverFor, buildHandover, gearSignature, alternativesOf, bareOf,
    progression(catalogue, saved) { access = catalogue; profile = saved; beatenSearch.invalidate(); },
    configure(raw) {
      profile = { version: 1, mode: 'best', zones: [] };
      data = raw; data.byClass = {}; data.byItem = {}; data.byEnch = {}; data.byBoss = {};
      for (const one of data.classes) data.byClass[one.name] = one;
      for (const one of data.items) data.byItem[one.name] = one;
      for (const one of data.enchants) data.byEnch[one.id] = one;
      for (const one of data.bosses) data.byBoss[one.name] = one;
    }, use(state) { build = state; }
  };`);
  const context = { window: { ROTMG_BUNDLE: { sources } }, module: { exports: {} }, console,
    TheoryEngine: require('../web/theory-engine'),
    BuildProgression: require('../web/progression') };
  if (withEngine) context.EnchantEngine = require('../web/engine');
  vm.runInNewContext(script, context, { filename: file });
  const api = context.module.exports;
  api.configure(JSON.parse(JSON.stringify(raw)));
  return api;
};
