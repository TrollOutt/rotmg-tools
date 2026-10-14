/*
 * What the Theory Crafting optimiser costs, measured the same way every time.
 *
 *   npm run bench:theory                    nine representative searches
 *   npm run bench:theory -- --full          every class against every goal, once each
 *   npm run bench:theory -- --json out.json also write the result as JSON
 *   npm run bench:theory -- --check out.json  compare the answers with an earlier run
 *   npm run bench:theory -- --reps 11 --warmup 2
 *
 * This is NODE timing of the search itself, on whatever machine runs it. It is
 * not what a visitor feels: in the browser the same search runs in slices of
 * about twelve milliseconds between turns of the event loop, so its total time
 * is longer and the page keeps answering in between. Nothing here measures
 * frames, input latency, parsing or painting. The shape of the answer travels
 * between machines; the milliseconds do not.
 *
 * What is deterministic and what is not:
 *   - the search is. It has no randomness, so the number of candidates it looks
 *     at and the build it settles on are the same on every run, and this script
 *     stops if a repetition ever disagrees with the first one;
 *   - the clock is not. Each search is timed several times after a warm-up and
 *     reported as min, median, p95 and max, so the spread is visible rather
 *     than averaged away. Close other programs, keep the machine on mains
 *     power, and compare runs made in the same conditions.
 *
 * --check is about the answers only (candidates looked at and a digest of the
 * score and the build). It exists so that a change which should not alter what
 * the optimiser finds can prove it; it never compares milliseconds.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

function options(argv) {
  const out = { reps: 7, warmup: 1, full: false, json: null, check: null };
  let repeated = false;
  const need = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(name + ' needs a value');
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--full') out.full = true;
    else if (a === '--reps') { out.reps = Number(need(i++, a)); repeated = true; }
    else if (a === '--warmup') { out.warmup = Number(need(i++, a)); repeated = true; }
    else if (a === '--json') out.json = need(i++, a);
    else if (a === '--check') out.check = need(i++, a);
    else throw new Error('unknown option ' + a);
  }
  if (!Number.isInteger(out.reps) || out.reps < 1) throw new Error('--reps must be a whole number of at least 1');
  if (!Number.isInteger(out.warmup) || out.warmup < 0) throw new Error('--warmup must be a whole number, 0 or more');
  if (out.full && repeated) throw new Error('--full times each search once, so --reps and --warmup do not apply to it');
  return out;
}

let opt;
try { opt = options(process.argv.slice(2)); } catch (err) {
  console.error('bench-theory: ' + err.message);
  console.error('usage: node tools/bench-theory.js [--full] [--reps N] [--warmup N] [--json FILE] [--check FILE]');
  process.exit(2);
}

// Read before anything is timed, so a wrong file name costs nothing.
let earlierRun = null;
if (opt.check) {
  try { earlierRun = JSON.parse(fs.readFileSync(opt.check, 'utf8')); } catch (err) {
    console.error('bench-theory: cannot read ' + path.basename(opt.check) + ' for --check (' + err.code + ')');
    process.exit(2);
  }
  if (!earlierRun || !Array.isArray(earlierRun.results)) {
    console.error('bench-theory: ' + path.basename(opt.check) + ' is not a result file written by --json');
    process.exit(2);
  }
}

const harness = require(path.join(root, 'tests/theory-harness'));
const raw = require(path.join(root, 'data/TheoryCraft/theorycraft.json'));
const read = (...parts) => fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
const theory = harness({
  clientModText: read('Enchantment documents', 'client-enchantments.txt'),
  clientItemText: read('Items', 'client-items.txt'),
  clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt')
}, raw, true);

const clone = value => JSON.parse(JSON.stringify(value));
const now = () => Number(process.hrtime.bigint()) / 1e6;
const digestOf = found => crypto.createHash('sha256')
  .update(JSON.stringify({ score: found.score, state: found.state }))
  .digest('hex').slice(0, 16);
const round = n => Math.round(n * 10) / 10;
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

function cases() {
  if (opt.full) {
    return raw.classes.flatMap(c => theory.GOALS.map(goal => ({ klass: c.name, goal })));
  }
  const goals = ['dps', 'stat:hp', 'stat:dex'].map(id => {
    const goal = theory.GOALS.find(g => g.id === id);
    if (!goal) throw new Error('goal ' + id + ' is no longer in the Theory goals');
    return goal;
  });
  return ['Wizard', 'Archer', 'Warrior'].flatMap(klass => goals.map(goal => ({ klass, goal })));
}

function search(one) {
  const state = clone(theory.fresh(one.klass));
  const start = now();
  const found = theory.optimise(state, one.goal);
  return { ms: now() - start, found };
}

// The full catalogue is a coverage run: one timed search each, no repetitions.
const reps = opt.full ? 1 : opt.reps;
const warmup = opt.full ? 0 : opt.warmup;

const results = [];
for (const one of cases()) {
  for (let i = 0; i < warmup; i++) search(one);
  const times = [];
  let first = null;
  for (let i = 0; i < reps; i++) {
    const { ms, found } = search(one);
    const answer = { looked: found.looked, digest: digestOf(found) };
    if (!first) first = answer;
    else if (answer.looked !== first.looked || answer.digest !== first.digest) {
      throw new Error(`${one.klass}/${one.goal.id}: repetition ${i + 1} found something different from the first - the search is not deterministic`);
    }
    times.push(ms);
  }
  results.push({
    class: one.klass, goal: one.goal.id, looked: first.looked, digest: first.digest,
    ms: { min: round(Math.min(...times)), median: round(quantile(times, 0.5)), p95: round(quantile(times, 0.95)), max: round(Math.max(...times)) }
  });
}

const all = results.map(r => r.ms.median);
const summary = {
  searches: results.length,
  medianOfMedians: round(quantile(all, 0.5)),
  p95OfMedians: round(quantile(all, 0.95)),
  slowest: round(Math.max(...results.map(r => r.ms.max))),
  totalMedianMs: Math.round(all.reduce((a, b) => a + b, 0))
};

function head() {
  let commit = null;
  try {
    commit = require('child_process').execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) { commit = null; }
  return commit;
}

const run = {
  what: 'Theory Crafting optimiser, Node timing of the search only (not browser performance)',
  commit: head(),
  node: process.version,
  platform: `${process.platform} ${os.arch()}`,
  cpu: `${(os.cpus()[0] || {}).model || 'unknown'} x${os.cpus().length}`,
  mode: opt.full ? 'full catalogue, one timed search each' : `representative, ${warmup} warm-up + ${reps} timed`,
  summary,
  results
};

const width = Math.max(...results.map(r => (r.class + '/' + r.goal).length));
console.log(`Theory optimiser - ${run.mode}`);
console.log(`node ${run.node}, ${run.platform}, ${run.cpu}${run.commit ? ', commit ' + run.commit : ''}`);
console.log('Node timing of the search only; this is not browser performance.\n');
console.log('search'.padEnd(width), 'looked', '   min', ' median', '   p95', '   max  (ms)');
for (const r of results) {
  console.log((r.class + '/' + r.goal).padEnd(width), String(r.looked).padStart(6),
    String(r.ms.min).padStart(6), String(r.ms.median).padStart(7), String(r.ms.p95).padStart(6), String(r.ms.max).padStart(6));
}
console.log(`\n${summary.searches} searches: median of medians ${summary.medianOfMedians} ms, p95 ${summary.p95OfMedians} ms, slowest single run ${summary.slowest} ms, sum of medians ${summary.totalMedianMs} ms`);

if (opt.json) {
  fs.writeFileSync(opt.json, JSON.stringify(run, null, 2) + '\n');
  console.log('wrote ' + path.basename(opt.json));
}

if (opt.check) {
  const earlier = new Map(earlierRun.results.map(r => [r.class + '/' + r.goal, r]));
  let compared = 0;
  const differences = [];
  for (const r of results) {
    const was = earlier.get(r.class + '/' + r.goal);
    if (!was) continue;
    compared++;
    if (was.looked !== r.looked) differences.push(`${r.class}/${r.goal}: looked ${was.looked} -> ${r.looked}`);
    if (was.digest !== r.digest) differences.push(`${r.class}/${r.goal}: the score or the build changed`);
  }
  if (!compared) throw new Error('--check: no search in common with that file');
  const mine = new Set(results.map(r => r.class + '/' + r.goal));
  const notRun = [...earlier.keys()].filter(key => !mine.has(key)).length;
  const notThere = results.length - compared;
  const partial = notRun || notThere
    ? ` Partial comparison: ${notThere} of this run's searches are not in that file, and ${notRun} of its searches were not run now.`
    : '';
  if (differences.length) {
    console.error('\nThe optimiser no longer finds what it found before:\n  ' + differences.join('\n  '));
    process.exit(1);
  }
  console.log(`--check: ${compared} searches found exactly what they found before (candidates looked at and the build).${partial}`);
}
