'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
// Test-only access to the existing closure, without moving any production rule.
module.exports = function(sources, raw, withEngine = true) {
  const file = path.join(__dirname, '../web/theorycraft.js');
  const original = fs.readFileSync(file, 'utf8');
  const marker = 'return { start, share, open, put };';
  if (!original.includes(marker)) throw new Error('Theory harness return marker moved');
  const script = original.replace(marker, `return {
    statsOf, setsOn, scaleOf, subOf, landed, weaponRate, abilityRate,
    numbersFor, optimise, scoreOf, aimOf, beatenOnes, enchantsFor, itemsFor, fresh, GOALS,
    configure(raw) {
      data = raw; data.byClass = {}; data.byItem = {}; data.byEnch = {}; data.byBoss = {};
      for (const one of data.classes) data.byClass[one.name] = one;
      for (const one of data.items) data.byItem[one.name] = one;
      for (const one of data.enchants) data.byEnch[one.id] = one;
      for (const one of data.bosses) data.byBoss[one.name] = one;
    }, use(state) { build = state; }
  };`);
  const context = { window: { ROTMG_BUNDLE: { sources } }, module: { exports: {} }, console };
  if (withEngine) context.EnchantEngine = require('../web/engine');
  vm.runInNewContext(script, context, { filename: file });
  const api = context.module.exports;
  api.configure(JSON.parse(JSON.stringify(raw)));
  return api;
};
