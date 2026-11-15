#!/usr/bin/env node
/*
 * What an update changes in the published Index data, and whether it is too
 * much to be believed (ROT-B-06).
 *
 * The served JSON files are one line each, so a pull request that drops a
 * third of the records shows as "index.json | 2 +-", like any other. This
 * compares the committed files (HEAD, or the ref in ROTMG_COMPARE_BASE) with
 * the working copy and says, per kind, how many records were added, removed
 * and changed, the RealmEye enrichment counters before and after, and the
 * size of each file. It fails when:
 *   - the records of the Index, or of a kind with 50 records or more, fall
 *     by more than 5 %;
 *   - an enrichment counter (linked records, archive pages, descriptions)
 *     falls by more than 5 %;
 *   - a file of 10 kB or more shrinks or grows by more than 20 %.
 *
 *     node tools/check-data-drift.js             # summary, exit 1 above a limit
 *     node tools/check-data-drift.js --markdown  # the same as a table, for a pull request
 *
 * ROTMG_ACCEPT_DATA_CHANGES=1 reports without failing, for a change checked
 * by hand (a season that really retires content, a new kind of page).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const FILES = ['data/Index/index.json', 'data/Index/search.json', 'data/Index/realmeye-enrichment.json',
  'data/Index/availability.json', 'data/Index/item-art.json', 'data/Index/wiki.json'];
const COUNTERS = ['linkedIndexRecords', 'archivePages', 'recordsWithDescription'];
const LIMITS = { recordDrop: 0.05, kindMinimum: 50, counterDrop: 0.05, sizeChange: 0.2, sizeMinimum: 10 * 1024 };

function parse(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

function byKind(index) {
  const kinds = new Map();
  for (const one of (index && index.records) || []) {
    if (!kinds.has(one.kind)) kinds.set(one.kind, new Map());
    kinds.get(one.kind).set(one.id, JSON.stringify(one));
  }
  return kinds;
}

const drop = (before, after) => (before > 0 ? (before - after) / before : 0);
const percent = share => (Math.round(share * 1000) / 10) + ' %';

/*
 * before, after: { [path]: file text or null }. Returns rows for the report
 * and the problems that make the update unbelievable.
 */
function compareData(before, after) {
  const problems = [];
  const kinds = [];
  const oldKinds = byKind(parse(before['data/Index/index.json']));
  const newKinds = byKind(parse(after['data/Index/index.json']));
  let oldTotal = 0;
  let newTotal = 0;
  for (const kind of [...new Set([...oldKinds.keys(), ...newKinds.keys()])].sort()) {
    const was = oldKinds.get(kind) || new Map();
    const now = newKinds.get(kind) || new Map();
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [id, text] of now) {
      if (!was.has(id)) added++;
      else if (was.get(id) !== text) changed++;
    }
    for (const id of was.keys()) if (!now.has(id)) removed++;
    oldTotal += was.size;
    newTotal += now.size;
    kinds.push({ kind, before: was.size, after: now.size, added, removed, changed });
    if (was.size >= LIMITS.kindMinimum && drop(was.size, now.size) > LIMITS.recordDrop) {
      problems.push(`${kind}: ${was.size} -> ${now.size} records (-${percent(drop(was.size, now.size))})`);
    }
  }
  if (drop(oldTotal, newTotal) > LIMITS.recordDrop) {
    problems.push(`Index: ${oldTotal} -> ${newTotal} records (-${percent(drop(oldTotal, newTotal))})`);
  }

  const counters = [];
  const oldCounts = (parse(before['data/Index/realmeye-enrichment.json']) || {}).counts || {};
  const newCounts = (parse(after['data/Index/realmeye-enrichment.json']) || {}).counts || {};
  for (const name of COUNTERS) {
    const was = Number(oldCounts[name] || 0);
    const now = Number(newCounts[name] || 0);
    counters.push({ name, before: was, after: now });
    if (drop(was, now) > LIMITS.counterDrop) problems.push(`enrichment ${name}: ${was} -> ${now} (-${percent(drop(was, now))})`);
  }

  const sizes = [];
  for (const file of FILES) {
    const was = before[file] == null ? null : Buffer.byteLength(before[file]);
    const now = after[file] == null ? null : Buffer.byteLength(after[file]);
    sizes.push({ file, before: was, after: now });
    if (was != null && was >= LIMITS.sizeMinimum) {
      if (now == null) problems.push(`${file}: removed`);
      else if (Math.abs(now - was) / was > LIMITS.sizeChange) problems.push(`${file}: ${was} -> ${now} bytes (${now > was ? '+' : '-'}${percent(Math.abs(now - was) / was)})`);
    }
  }
  return { kinds, counters, sizes, problems, total: { before: oldTotal, after: newTotal } };
}

function markdown(result) {
  const lines = ['### Variation des données', '', '| kind | avant | après | ajoutés | retirés | modifiés |', '|---|---|---|---|---|---|'];
  for (const one of result.kinds) {
    if (one.added || one.removed || one.changed) lines.push(`| ${one.kind} | ${one.before} | ${one.after} | ${one.added} | ${one.removed} | ${one.changed} |`);
  }
  lines.push(`| **total** | ${result.total.before} | ${result.total.after} | | | |`, '');
  lines.push('| enrichissement | avant | après |', '|---|---|---|');
  for (const one of result.counters) lines.push(`| ${one.name} | ${one.before} | ${one.after} |`);
  lines.push('', '| fichier | octets avant | octets après |', '|---|---|---|');
  for (const one of result.sizes) lines.push(`| ${one.file} | ${one.before ?? '-'} | ${one.after ?? '-'} |`);
  if (result.problems.length) lines.push('', '**Écarts au-delà des seuils :**', '', ...result.problems.map(p => '- ' + p));
  return lines.join('\n');
}

function committed(base, file) {
  try {
    return execFileSync('git', ['show', base + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return null;
  }
}

function main(argv) {
  const base = process.env.ROTMG_COMPARE_BASE || 'HEAD';
  const before = {};
  const after = {};
  let same = true;
  for (const file of FILES) {
    before[file] = committed(base, file);
    after[file] = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null;
    if (before[file] !== after[file]) same = false;
  }
  if (before['data/Index/index.json'] == null) {
    console.log('data drift: no committed Index at ' + base + ', skipped');
    return 0;
  }
  if (same && !argv.includes('--markdown')) {
    console.log('data drift: the Index files are the committed ones, nothing to compare');
    return 0;
  }
  const result = compareData(before, after);
  if (argv.includes('--markdown')) console.log(markdown(result));
  const accept = process.env.ROTMG_ACCEPT_DATA_CHANGES === '1';
  if (result.problems.length) {
    for (const problem of result.problems) console.error('  ' + problem);
    console.error(`data drift: ${result.problems.length} change(s) beyond the limits` + (accept ? ' (accepted by ROTMG_ACCEPT_DATA_CHANGES)' : ''));
    return accept ? 0 : 1;
  }
  if (!argv.includes('--markdown')) console.log(`data drift: within limits (${result.total.before} -> ${result.total.after} records)`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { compareData, markdown, LIMITS };
