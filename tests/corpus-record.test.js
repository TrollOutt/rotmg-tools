'use strict';
// The guards of `npm run corpus:record` (tests/corpus-record.js), on a
// throwaway git repository and stand-in tests: a re-record refuses to follow a
// code change, committed or not, unless forced (loudly); a failure part-way
// leaves every corpus exactly as it was; a success leaves a readable list.
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { guard, codeChanges, record, dataPath } = require('./corpus-record');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-record-test-'));
const repo = path.join(work, 'repo');
const git = (...args) => execFileSync('git', ['-c', 'user.name=corpus-test', '-c', 'user.email=corpus-test@example.invalid',
  '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + path.join(work, 'no-hooks'), ...args], { cwd: repo, stdio: 'pipe' });
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), text); };
const quiet = { warn: () => {}, log: () => {} };

try {
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  write('data/Index/index.json', '{"v":1}\n');
  write('web/index-grouping.js', 'var title = "Other portals";\n');
  write('tests/x-corpus.json.gz', 'frozen');
  git('add', '.'); git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'auto/update');

  assert(dataPath('data/Index/index.json') && dataPath('web/assets/index/x.json') && dataPath('tests/a-corpus.json.gz'));
  assert(!dataPath('web/index-grouping.js') && !dataPath('tests/corpus-record.js'));

  // A data-only change, committed and not: allowed.
  write('data/Index/index.json', '{"v":2}\n'); git('commit', '-qam', 'data');
  write('data/Index/index.json', '{"v":3}\n');
  assert.deepEqual(guard({ cwd: repo, ...quiet }), [], 'CORPUS-001 a data-only change may be re-recorded');

  // An uncommitted code change: refused.
  write('web/index-grouping.js', 'var title = "Other portal";\n');
  assert.throws(() => guard({ cwd: repo, ...quiet }), /refuses[\s\S]*web\/index-grouping\.js/, 'CORPUS-002 uncommitted code is refused');

  // The simulated regression of the verification, committed: still refused.
  git('commit', '-qam', 'regression');
  assert.deepEqual(codeChanges(repo), ['web/index-grouping.js'], 'CORPUS-003 committed code since the base with main is seen');
  assert.throws(() => guard({ cwd: repo, ...quiet }), /refuses/, 'CORPUS-004 a committed regression is refused');
  assert.throws(() => record({ cwd: repo, tests: [], corpora: [], report: path.join(work, 'moves.txt'), ...quiet }), /refuses/,
    'CORPUS-005 the runner refuses before running anything');

  // --force goes through, and says so.
  const warned = [];
  assert.deepEqual(guard({ cwd: repo, force: true, warn: m => warned.push(m), log() {} }), ['web/index-grouping.js']);
  assert.match(warned.join('\n'), /WARNING[\s\S]*--force[\s\S]*web\/index-grouping\.js/, 'CORPUS-006 a forced re-record warns');

  // A failure part-way: every corpus and the summary are put back byte for byte.
  git('checkout', '-q', 'main');
  const corpora = [path.join(work, 'a-corpus.json.gz'), path.join(work, 'b-corpus.json.gz')];
  const report = path.join(work, 'corpus-moves.txt');
  corpora.forEach((f, i) => fs.writeFileSync(f, Buffer.from([31, 139, i, 7])));
  fs.writeFileSync(report, 'previous list\n');
  const stand = (name, body) => { const f = path.join(work, name); fs.writeFileSync(f, body); return f; };
  const rewrites = stand('rewrites.js', `const fs = require('fs');
if (process.env.CORPUS_RECORD === '1') {
  fs.writeFileSync(${JSON.stringify(corpora[0])}, 'rewritten');
  fs.writeFileSync(require('path').join(process.env.CORPUS_REPORT_DIR, 'a.txt'), '## a: 1 data cases (1 moved)\\nmoved\\tcase 1\\n');
}`);
  const failsCheck = stand('fails-check.js', `if (process.env.CORPUS_RECORD !== '1') process.exit(1);
require('fs').writeFileSync(${JSON.stringify(corpora[1])}, 'rewritten');`);
  const before = [...corpora, report].map(f => fs.readFileSync(f));
  assert.throws(() => record({ cwd: repo, tests: [rewrites, failsCheck], corpora, report, stdio: 'pipe', ...quiet }),
    /fails-check\.js failed while checking the result; the corpora were restored/, 'CORPUS-007 a failed check fails the run');
  assert.deepEqual([...corpora, report].map(f => fs.readFileSync(f)), before, 'CORPUS-008 nothing is left half re-recorded');

  const failsRecord = stand('fails-record.js', 'process.exit(process.env.CORPUS_RECORD === "1" ? 3 : 0);');
  assert.throws(() => record({ cwd: repo, tests: [rewrites, failsRecord], corpora, report, stdio: 'pipe', ...quiet }),
    /failed while recording/, 'CORPUS-009 a failed recording fails the run');
  assert.deepEqual([...corpora, report].map(f => fs.readFileSync(f)), before, 'CORPUS-010 restored after a failed recording too');

  // A success leaves the readable list beside the corpora.
  assert.equal(record({ cwd: repo, tests: [rewrites], corpora, report, stdio: 'pipe', ...quiet }), 1);
  assert.match(fs.readFileSync(report, 'utf8'), /## a: 1 data cases \(1 moved\)\nmoved\tcase 1/, 'CORPUS-011 the moved cases are listed in text');
  assert.equal(fs.readFileSync(corpora[0], 'utf8'), 'rewritten');
  console.log('corpus-record guards: committed and uncommitted code refused, --force warns, failures restore every corpus, moves listed in text.');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
