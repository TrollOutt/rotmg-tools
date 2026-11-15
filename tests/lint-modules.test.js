'use strict';
// The lint parses every Skin Viewer module, not only its entry point: a syntax
// error in contracts.mjs used to pass npm run lint and break the published page.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { moduleFiles, moduleProblem } = require('../tools/lint.js');

const files = moduleFiles();
for (const name of fs.readdirSync(path.join(__dirname, '..', 'web', 'skins')).filter(f => /\.m?js$/.test(f))) {
  assert.ok(files.includes('web/skins/' + name), 'linted: web/skins/' + name);
}
assert.ok(files.includes('web/skins/contracts.mjs'));
assert.strictEqual(moduleProblem('export const ok = 1;\n'), '');
assert.notStrictEqual(moduleProblem('export const broken = ;\n'), '');

console.log('lint modules: ok');
