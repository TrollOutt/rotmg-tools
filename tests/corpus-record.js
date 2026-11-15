'use strict';
// Frozen corpora that depend on the published data (ROT-C-03).
//
// fiches-data, index-facets, index-families and index-grouping freeze what the
// code gives on the real Index and RealmEye data. Every data update moved some
// of those cases, and a person had to re-record them by hand before main could
// publish. The cases that only depend on the code (edges, failures, loader
// traces, summaries) are untouched by this file and always strict.
//
// `npm test` is always strict. `npm run corpus:record` (CORPUS_RECORD=1)
// re-points only the data cases that moved, appends their new values to the
// shared tables, prints how many moved, and writes the corpus back. It refuses
// to run while code is changed in the working tree: a re-record is only
// meaningful when the code is the reviewed code and only the data moved, so
// the data update and its re-recorded corpora land in the same reviewable
// pull request.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { execFileSync } = require('child_process');

const RECORD = process.env.CORPUS_RECORD === '1';
const root = path.join(__dirname, '..');

// What a data update may change. Anything else changed means the code moved.
const dataPath = file => /^(?:data\/|web\/assets\/|tests\/[^/]+-corpus\.json\.gz$|\.ai\/)/.test(file);

function guard() {
  let changed;
  try {
    changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter(Boolean).map(line => line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
  } catch (error) {
    throw new Error('corpus:record needs git to check that only data changed: ' + error.message);
  }
  const code = changed.filter(file => !dataPath(file));
  if (code.length) {
    throw new Error('corpus:record refuses to run while code is changed; commit or stash it first:\n  ' + code.join('\n  '));
  }
}

function open(name) {
  const file = path.join(__dirname, name);
  const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  if (RECORD) guard();
  const moved = new Map();          // label -> count
  const repointed = new Set();      // "table:holder-identity:key" re-pointed this run
  const holders = new WeakMap(); let nextHolder = 0;
  const indexes = new Map();        // table name -> Map(JSON -> index)
  const note = label => moved.set(label, (moved.get(label) || 0) + 1);
  const idOf = holder => { if (!holders.has(holder)) holders.set(holder, ++nextHolder); return holders.get(holder); };

  function slot(tableName, value) {
    const table = corpus[tableName];
    if (!indexes.has(tableName)) indexes.set(tableName, new Map(table.map((v, i) => [JSON.stringify(v), i])));
    const index = indexes.get(tableName), key = JSON.stringify(value);
    if (!index.has(key)) { index.set(key, table.length); table.push(JSON.parse(key)); }
    return index.get(key);
  }

  return {
    corpus,
    recording: RECORD,
    // holder[key] points into corpus[tableName]. Strict unless recording; when
    // recording, a moved case is re-pointed once per run, so a second mode or
    // adapter reading the same pointer must agree with the first.
    pointer(tableName, holder, key, actual, label, kind, eq = assert.deepEqual) {
      const expected = corpus[tableName][holder[key]];
      if (!RECORD) return eq(actual, expected, label);
      if (JSON.stringify(actual) === JSON.stringify(expected)) return;
      const once = tableName + ':' + idOf(holder) + ':' + key;
      if (repointed.has(once)) return eq(actual, expected, label + ' (modes disagree)');
      repointed.add(once);
      holder[key] = slot(tableName, actual);
      note(kind || tableName);
    },
    // A value stored directly in the corpus.
    value(holder, key, actual, label) {
      if (!RECORD) return assert.deepEqual(actual, holder[key], label);
      if (JSON.stringify(actual) === JSON.stringify(holder[key])) return;
      holder[key] = JSON.parse(JSON.stringify(actual));
      note(label);
    },
    slot,
    moved: note,
    // Writes the corpus back only when something moved.
    save() {
      if (!RECORD) return;
      const total = [...moved.values()].reduce((a, b) => a + b, 0);
      if (!total) { console.log(`${name}: no data case moved, left as it is.`); return; }
      fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(corpus), { level: 9 }));
      console.log(`${name}: re-recorded ${total} moved data cases (${[...moved].map(([k, n]) => k + ' ' + n).join(', ')}). Review the diff with the data it follows.`);
    }
  };
}

module.exports = { open, RECORD };

// `npm run corpus:record`: re-record the four data corpora, then run them strict.
if (require.main === module) {
  const { spawnSync } = require('child_process');
  const tests = ['fiches-data', 'index-facets', 'index-families', 'index-grouping'].map(t => path.join(__dirname, t + '.test.js'));
  for (const [mode, env] of [['record', { ...process.env, CORPUS_RECORD: '1' }], ['check', { ...process.env, CORPUS_RECORD: '' }]]) {
    for (const test of tests) {
      const run = spawnSync(process.execPath, [test], { env, stdio: 'inherit' });
      if (run.status !== 0) { console.error(`corpus:record: ${path.basename(test)} failed while ${mode === 'record' ? 'recording' : 'checking the result'}.`); process.exit(run.status || 1); }
    }
  }
}
