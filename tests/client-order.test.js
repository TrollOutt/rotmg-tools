'use strict';
// ROT-B-07: a scrape refuses a client older than the published data. Offline.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { publishedClient, olderProblem, checkNotOlder } = require('../tools/client-order.js');

const line = from => '## provenance: ' + JSON.stringify({ built: '2026-11-06T00:00:00Z', from: { kind: 'client', ...from }, tool: 'tools/read-client.js' });
const published = { build: 'b2', date: '2026-11-05' };

assert.deepStrictEqual(publishedClient(line(published) + '\nbuild|b2\n'), published);
assert.strictEqual(publishedClient('build|b2\n'), null);
assert.strictEqual(publishedClient('## provenance: {broken\n'), null);

assert.strictEqual(olderProblem({ build: 'b3', date: '2026-11-12' }, published), '');
assert.strictEqual(olderProblem({ build: 'b2', date: '2026-11-05' }, published), '');
assert.match(olderProblem({ build: 'b1', date: '2026-11-03' }, published), /older than the one the published data comes from/);
assert.strictEqual(olderProblem({ build: 'b1', date: '2026-11-03' }, null), '');
// R5: the published build itself, dated earlier (a copy with an older file time), is accepted.
assert.strictEqual(olderProblem({ build: 'b2', date: '2026-11-04' }, published), '');
// An unknown build dated earlier is still refused.
assert.match(olderProblem({ date: '2026-11-04' }, published), /older/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-order-'));
const snapshot = path.join(dir, 'client-snapshot.txt');
fs.writeFileSync(snapshot, line(published) + '\n');
assert.throws(() => checkNotOlder({ build: 'b1', date: '2026-11-03' }, { snapshot }), /--allow-older/);
assert.match(checkNotOlder({ build: 'b1', date: '2026-11-03' }, { snapshot, allow: true }), /older/);
assert.strictEqual(checkNotOlder({ build: 'b3', date: '2026-11-12' }, { snapshot }), '');
// The committed snapshot is readable, so the guard is live on this repository.
assert.ok(publishedClient(fs.readFileSync(path.join(__dirname, '..', 'data', 'client-snapshot.txt'), 'utf8')));

console.log('client order: ok');
