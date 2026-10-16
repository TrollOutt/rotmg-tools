'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
// Execute the real calculator adapters, without its DOM initialization.
module.exports = function (state, getItems) {
  const source = read('web/app.js');
  const slice = (from, to) => {
    const a = source.indexOf(from), b = source.indexOf(to, a);
    assert(a >= 0 && b > a, 'Calculator harness marker moved: ' + from);
    return source.slice(a, b);
  };
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
