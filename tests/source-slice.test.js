'use strict';
const assert = require('assert/strict'), vm = require('vm');
const { normalizeSource, sourceSlice } = require('./source-slice');
const harness = require('./app-harness');
const from = 'function handoverSetup(said)', to = '/*\n * One item handed over';
const source = 'const appData = AppData.createItemResolver({});\n'
  + 'const resolveItem = name => name; const knownItemNames = () => [];\n'
  + '/* ------------------------------------------------------------------ *\n * Configuration */\n'
  + 'function handoverSetup(said) { return resolveItem(said.item); }\n'
  + 'function handoverEnchantName(name) { return name; }\n' + to + ' */';
const crlf = source.replace(/\n/g, '\r\n');
assert.equal(sourceSlice(source, 'fixture.js')(from, to), sourceSlice(crlf, 'fixture.js')(from, to));
for (const text of [source, crlf]) {
  const api = harness({}, () => undefined, text);
  assert.equal(api.handoverSetup({ item: 'Known' }), 'Known');
  assert.equal(api.creations(), 1);
}
// Escaped CR/LF string content survives normalization and execution unchanged.
const escaped = '"a\\r\\nb"';
assert.equal(vm.runInNewContext(normalizeSource(escaped + '\r\n')), 'a\r\nb');
assert.throws(() => harness({}, () => undefined, source.replace(from, 'function renamed(said)')),
  { message: 'web/app.js: missing source marker "function handoverSetup(said)"' });
assert.throws(() => harness({}, () => undefined, source + '\n' + from),
  { message: 'web/app.js: ambiguous source marker "function handoverSetup(said)"' });
assert.throws(() => sourceSlice(source, 'fixture.js')('absent', to), /fixture\.js: missing source marker "absent"/);
assert.throws(() => sourceSlice(source.replace(to, ''), 'fixture.js')(from, to), /missing source marker/);
assert.throws(() => sourceSlice(source + '\n' + to, 'fixture.js')(from, to), /ambiguous source marker/);
assert.throws(() => sourceSlice(source, 'fixture.js')(to, from), /fixture\.js: reversed source markers/);
// Instrumentation must preserve a real behavior change so strict parity fails.
const changed = harness({}, () => undefined, source.replace('name => name', 'name => null'));
assert.throws(() => assert.equal(changed.handoverSetup({ item: 'Known' }), 'Known'), { code: 'ERR_ASSERTION' });
console.log('Source harness: LF = CRLF; missing, ambiguous, reversed markers and changed behavior detected.');
