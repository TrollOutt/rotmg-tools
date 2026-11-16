'use strict';
/*
 * What's New never loses an update it published.
 *
 *     node tests/whats-new-archive.test.js
 *
 * Season 31 Part 1 was lost once: the next scrape replaced the whole folder.
 * Since then the update a scrape replaces is frozen under
 * web/assets/whats-new/archive/<date>/ (tools/whats-new-archive.js). This
 * checks that every frozen update is whole, that the latest index lists them
 * all, and that none of them changed since the base it is compared with
 * (ROTMG_COMPARE_BASE, else HEAD): a frozen update is never rewritten.
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const archive = require('../tools/whats-new-archive');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'web', 'assets', 'whats-new');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const listed = archive.list(dir);

/* Every frozen update is whole: its document, filed under its own date, and every picture it names. */
for (const entry of listed) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, entry.path), 'utf8'));
  assert.equal(doc.notes && doc.notes.date, entry.date, entry.path + ': filed under the date its notes carry');
  assert(doc.drawers && Object.keys(doc.drawers).length, entry.path + ': keeps what the update brought');
  for (const key of ['crucible', 'ritual', 'upcoming']) assert(!(key in doc), entry.path + ': ' + key + ' is the latest index\'s, not frozen');
  for (const file of archive.filesOf(doc)) {
    assert(file.startsWith(archive.ARCHIVE + '/' + entry.date + '/'), entry.path + ': ' + file + ' lies in its own folder');
    assert(fs.existsSync(path.join(dir, file)), entry.path + ': the picture ' + file + ' is kept');
  }
}

/* The latest index lists them all, and is not itself one of them. */
assert.deepEqual(index.archive, listed, 'web/assets/whats-new/index.json lists every frozen update');
assert(!listed.some(entry => entry.date === (index.notes && index.notes.date)), 'the latest update is not frozen yet');
assert(listed.some(entry => entry.date === '2026-10-06'), 'Season 31 Part 1 is kept');

/* A frozen update is never written again: freeze() refuses its folder. */
{
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-archive-'));
  const doc = { notes: { date: '2030-01-01', title: 'T' }, drawers: { weapons: { added: [{ id: 'X', sprite: { clips: { stand: { file: 'x.png' } } } }] } }, crucible: [] };
  fs.writeFileSync(path.join(scratch, 'x.png'), 'png');
  const to = archive.freeze(doc, scratch, scratch);
  const frozen = JSON.parse(fs.readFileSync(path.join(to, 'index.json'), 'utf8'));
  assert.equal(frozen.drawers.weapons.added[0].sprite.clips.stand.file, 'archive/2030-01-01/x.png', 'pictures move under the frozen folder');
  assert(!('crucible' in frozen), 'the season list is not frozen');
  assert.throws(() => archive.freeze(doc, scratch, scratch), /already frozen/, 'a frozen folder is not written again');
  assert.throws(() => archive.freeze({ notes: { date: '2030-02-01' }, drawers: { a: { added: [{ sprite: { clips: { s: { file: 'gone.png' } } } }] } } }, scratch, scratch),
    /pictures missing/, 'an update is not frozen without its pictures');
  fs.rmSync(scratch, { recursive: true, force: true });
}

/* And none changed since the base: compared file by file with what git holds there. */
const base = process.env.ROTMG_COMPARE_BASE || 'HEAD';
let compared = 0;
let held = [];
try {
  held = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'web/assets/whats-new/' + archive.ARCHIVE], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch (error) { held = []; }
for (const file of held) {
  const now = path.join(root, file);
  assert(fs.existsSync(now), file + ' was frozen at ' + base + ' and must not be deleted');
  const then = execFileSync('git', ['show', base + ':' + file], { cwd: root, maxBuffer: 1 << 26 });
  assert(fs.readFileSync(now).equals(then), file + ' was frozen at ' + base + ' and must not change');
  compared++;
}

console.log("What's New archive: " + listed.length + ' frozen update(s), every picture kept, '
  + compared + ' file(s) unchanged since ' + base + '.');
