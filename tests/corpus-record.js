'use strict';
// Frozen corpora that depend on the published data (ROT-C-03).
//
// fiches-data, index-facets, index-families and index-grouping freeze what the
// code gives on the real Index and RealmEye data. Every data update moved some
// of those cases, and a person had to re-record them by hand before main could
// publish. The cases that only depend on the code (edges, failures, loader
// traces, summaries) are untouched by this file and always strict.
//
// `npm test` is always strict. `npm run corpus:record` re-points only the data
// cases that moved, appends their new values to the shared tables, writes a
// readable list of what moved to tests/corpus-moves.txt, then runs the four
// tests strict on the result. Guards:
// - only data may have changed: nothing outside data/, web/assets/, the
//   corpora and .ai/ may differ from the common base with main, committed or
//   not. A re-record that follows a code change would freeze that change as
//   the new truth. `--force` (or CORPUS_FORCE=1) overrides it, loudly;
// - a corpus never falls under its floor of cases (see each test);
// - if anything fails, the corpora and the summary are restored as they were.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');

const RECORD = process.env.CORPUS_RECORD === '1';
const FORCE = process.env.CORPUS_FORCE === '1';
const root = path.join(__dirname, '..');
const SHOWN = 20;

// What a data update may change. Anything else changed means the code moved.
const dataPath = file => /^(?:data\/|web\/assets\/|tests\/[^/]+-corpus\.json\.gz$|tests\/corpus-moves\.txt$|\.ai\/)/.test(file);

// Not trimmed: a porcelain status line starts with a space.
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The base the code is compared with: CORPUS_BASE, else origin/main, else main.
function baseOf(cwd, wanted = process.env.CORPUS_BASE) {
  for (const ref of wanted ? [wanted] : ['origin/main', 'main']) {
    try { return git(cwd, ['merge-base', 'HEAD', ref]).trim(); } catch (error) { /* try the next one */ }
  }
  throw new Error('corpus:record cannot find the common base with main; set CORPUS_BASE to a commit');
}

// Code files changed since the common base with main, committed or not.
function codeChanges(cwd = root, base) {
  let changed;
  try {
    const from = base || baseOf(cwd);
    const committed = git(cwd, ['diff', '--name-only', from, 'HEAD']).split('\n');
    const working = git(cwd, ['status', '--porcelain', '--untracked-files=no']).split('\n')
      .map(line => line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
    changed = [...new Set([...committed, ...working].filter(Boolean))].sort();
  } catch (error) {
    throw new Error('corpus:record needs git to check that only data changed: ' + error.message);
  }
  return changed.filter(file => !dataPath(file));
}

function guard({ cwd = root, force = FORCE, base, warn = console.warn } = {}) {
  const code = codeChanges(cwd, base);
  if (!code.length) return code;
  const list = code.slice(0, SHOWN).join('\n  ') + (code.length > SHOWN ? `\n  ... and ${code.length - SHOWN} more` : '');
  if (!force) {
    throw new Error('corpus:record refuses: code differs from the common base with main, so a re-record could freeze a regression.\n'
      + 'Re-record on a data-only change, or pass --force after reviewing these files:\n  ' + list);
  }
  warn('WARNING corpus:record --force: code differs from main; every moved case below must be reviewed as a possible regression:\n  ' + list);
  return code;
}

function open(name) {
  const file = path.join(__dirname, name);
  const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  if (RECORD) guard({ warn: () => {} });   // the runner already warned once
  const changes = [];               // [kind, label]
  const repointed = new Set();      // "table:holder-identity:key" re-pointed this run
  const holders = new WeakMap(); let nextHolder = 0;
  const indexes = new Map();        // table name -> Map(JSON -> index)
  const note = (kind, label) => changes.push([kind, label]);
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
      note('moved', (kind || tableName) + ': ' + label);
    },
    // A value stored directly in the corpus.
    value(holder, key, actual, label) {
      if (!RECORD) return assert.deepEqual(actual, holder[key], label);
      if (JSON.stringify(actual) === JSON.stringify(holder[key])) return;
      holder[key] = JSON.parse(JSON.stringify(actual));
      note('modified', label);
    },
    slot,
    // A case set rebuilt from the data: what was added and removed, by name.
    rebuilt(kind, before, after) {
      const was = new Set(before), now = new Set(after);
      for (const id of after) if (!was.has(id)) note('added', kind + ': ' + id);
      for (const id of before) if (!now.has(id)) note('removed', kind + ': ' + id);
    },
    note,
    // Recording or not, a corpus never falls under its floor of cases.
    floor(label, count, minimum) {
      assert(count >= minimum, `${name}: ${label} has ${count} cases, under its floor of ${minimum}; refusing.`);
    },
    // Writes the corpus back only when something changed, and leaves the
    // readable list for the runner.
    save() {
      if (!RECORD) return;
      if (!changes.length) { console.log(`${name}: no data case moved, left as it is.`); return; }
      const counts = {};
      for (const [kind] of changes) counts[kind] = (counts[kind] || 0) + 1;
      const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
      const lines = changes.map(([kind, label]) => `${kind}\t${label}`);
      console.log(`${name}: re-recorded ${changes.length} data cases (${summary}).`);
      for (const line of lines.slice(0, SHOWN)) console.log('  ' + line);
      if (lines.length > SHOWN) console.log(`  ... and ${lines.length - SHOWN} more, listed in tests/corpus-moves.txt`);
      if (process.env.CORPUS_REPORT_DIR) {
        fs.writeFileSync(path.join(process.env.CORPUS_REPORT_DIR, name + '.txt'),
          `## ${name}: ${changes.length} data cases (${summary})\n` + lines.join('\n') + '\n');
      }
      fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(corpus), { level: 9 }));
    }
  };
}

const CORPORA = ['fiches-data', 'index-facets', 'index-families', 'index-grouping'];

// Records, then checks strict; on any failure, puts every file back as it was.
function record({
  tests = CORPORA.map(t => path.join(__dirname, t + '.test.js')),
  corpora = CORPORA.map(t => path.join(__dirname, t + '-corpus.json.gz')),
  report = path.join(__dirname, 'corpus-moves.txt'),
  cwd = root, force = FORCE, base, env = process.env, log = console.log, warn = console.warn, stdio = 'inherit'
} = {}) {
  guard({ cwd, force, base, warn });
  const kept = new Map([...corpora, report].map(f => [f, fs.existsSync(f) ? fs.readFileSync(f) : null]));
  const restore = () => { for (const [f, bytes] of kept) bytes === null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, bytes); };
  const reports = fs.mkdtempSync(path.join(require('os').tmpdir(), 'corpus-record-'));
  try {
    const shared = { ...env, CORPUS_REPORT_DIR: reports, CORPUS_FORCE: force ? '1' : '' };
    for (const [mode, extra] of [['recording', { CORPUS_RECORD: '1' }], ['checking the result', { CORPUS_RECORD: '' }]]) {
      for (const test of tests) {
        const run = spawnSync(process.execPath, [test], { cwd, env: { ...shared, ...extra }, stdio });
        if (run.status !== 0) {
          restore();
          throw new Error(`corpus:record: ${path.basename(test)} failed while ${mode}; the corpora were restored as they were.`);
        }
      }
    }
    const sections = fs.readdirSync(reports).sort().map(f => fs.readFileSync(path.join(reports, f), 'utf8'));
    if (sections.length) {
      fs.writeFileSync(report, '# Data cases re-recorded by `npm run corpus:record`. Review this list with the data diff;\n'
        + '# every line is a case whose frozen value now follows the data.\n'
        + (force ? '# WARNING: recorded with --force while code differed from main.\n' : '') + '\n' + sections.join('\n'));
      log(`corpus:record: the list of re-recorded cases is in ${path.relative(cwd, report)}.`);
    }
    return sections.length;
  } finally {
    fs.rmSync(reports, { recursive: true, force: true });
  }
}

module.exports = { open, RECORD, guard, codeChanges, record, dataPath };

// `npm run corpus:record [-- --force]`
if (require.main === module) {
  try {
    record({ force: FORCE || process.argv.includes('--force') });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
