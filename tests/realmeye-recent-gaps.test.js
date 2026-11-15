'use strict';
// ROT-B-04: a page asked for and not fetched stays pending, and a hole in the
// recent-changes list is reported. Offline, on a made-up log.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pending, integrate, gapProblem } = require('../tools/realmeye-recent.js');

const entry = (slug, revision, created) => ({ slug, revision, created, title: slug, comment: '', author: 'someone' });
const log = () => ({
  integratedThrough: null,
  entries: [entry('alpha', 1, '2026-11-10T10:00:00Z'), entry('beta', 4, '2026-11-10T12:00:00Z')]
});

// Integrated: nothing pending, except what could not be fetched.
const done = integrate(log(), '2026-11-10T12:00:00Z');
assert.deepStrictEqual(pending(done), []);
assert.ok(!('retry' in done));
const partly = integrate(log(), '2026-11-10T12:00:00Z', ['beta', 'beta/4']);
assert.deepStrictEqual(pending(partly), ['beta']);
// A later update that fetches it clears it.
assert.deepStrictEqual(pending(integrate(partly, '2026-11-11T00:00:00Z', [])), []);

// Gaps: the list overlaps the log (no gap), starts after it (gap), or is empty (quiet day).
assert.strictEqual(gapProblem(log(), [entry('beta', 4, '2026-11-10T12:00:00Z'), entry('gamma', 2, '2026-11-11T09:00:00Z')]), null);
assert.match(gapProblem(log(), [entry('gamma', 2, '2026-11-12T09:00:00Z')]), /possible gap/);
assert.strictEqual(gapProblem(log(), []), null);
assert.strictEqual(gapProblem({ entries: [] }, [entry('gamma', 2, '2026-11-12T09:00:00Z')]), null);

// The command line used by the update.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmeye-recent-'));
const file = path.join(dir, 'log.json');
const missed = path.join(dir, 'missed.txt');
fs.writeFileSync(file, JSON.stringify(log()));
fs.writeFileSync(missed, 'alpha\r\n\r\n');
const tool = path.join(__dirname, '..', 'tools', 'realmeye-recent.js');
const run = (...args) => spawnSync(process.execPath, [tool, '--log', file, ...args], { encoding: 'utf8' });
assert.strictEqual(run('--integrated-through', '2026-11-10T12:00:00Z', '--not-fetched', missed).status, 0);
assert.strictEqual(run('--pending').stdout.trim(), 'alpha');
// A --not-fetched list that is missing fails, and the log is left as it was.
const before = fs.readFileSync(file, 'utf8');
assert.notStrictEqual(run('--integrated-through', '2026-11-12T00:00:00Z', '--not-fetched', path.join(dir, 'absent.txt')).status, 0);
assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
assert.strictEqual(run('--pending').stdout.trim(), 'alpha');

console.log('realmeye recent gaps: ok');
