'use strict';
/*
 * What's New keeps every update it has published.
 *
 * web/assets/whats-new/index.json is the latest update, rewritten by
 * tools/diff-client.js on each scrape. When a scrape brings the next update,
 * the one it replaces is frozen first into archive/<its date>/: its own
 * index.json (the account, the counts, the drawers) and the pictures it
 * draws, under paths of their own. A frozen update is never written again:
 * freeze() refuses a folder that exists, and tests/whats-new-archive.test.js
 * fails if a committed one changes. Season 31 Part 1 was lost once, when Part 2
 * replaced the folder whole; this is what keeps that from happening again.
 */
const fs = require('fs');
const path = require('path');

const ARCHIVE = 'archive';
// What belongs to the update itself; the season list, the rituals and the
// announcements still to come are read from the latest index, always.
const OWN = ['made', 'notes', 'before', 'counts', 'tally', 'drawers'];

/* Every picture file an update document names, relative to its folder. */
function filesOf(doc) {
  const files = new Set();
  for (const drawer of Object.values(doc.drawers || {})) {
    for (const why of ['added', 'changed', 'gone']) {
      for (const thing of drawer[why] || []) {
        for (const clip of Object.values((thing.sprite && thing.sprite.clips) || {})) if (clip.file) files.add(clip.file);
      }
    }
  }
  for (const part of (doc.notes && doc.notes.parts) || []) for (const image of part.images || []) if (image.file) files.add(image.file);
  return [...files];
}

/* The same document with every picture path moved under prefix/. */
function relocate(doc, prefix) {
  const out = JSON.parse(JSON.stringify(doc));
  for (const drawer of Object.values(out.drawers || {})) {
    for (const why of ['added', 'changed', 'gone']) {
      for (const thing of drawer[why] || []) {
        for (const clip of Object.values((thing.sprite && thing.sprite.clips) || {})) if (clip.file) clip.file = prefix + '/' + clip.file;
      }
    }
  }
  for (const part of (out.notes && out.notes.parts) || []) for (const image of part.images || []) if (image.file) image.file = prefix + '/' + image.file;
  return out;
}

/*
 * Freeze one update: doc is its index.json, from the folder its pictures are
 * in, into whatsNewDir/archive/<notes.date>/. Returns the folder, or null when
 * the update has no date to file it under. Never overwrites.
 */
function freeze(doc, from, whatsNewDir) {
  const date = doc && doc.notes && doc.notes.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const to = path.join(whatsNewDir, ARCHIVE, date);
  if (fs.existsSync(to)) throw new Error('What\'s New: ' + path.relative(whatsNewDir, to) + ' is already frozen; refusing to write it again');
  const prefix = ARCHIVE + '/' + date;
  const missing = filesOf(doc).filter(file => !fs.existsSync(path.join(from, file)));
  if (missing.length) throw new Error('What\'s New: cannot freeze ' + date + ', pictures missing: ' + missing.slice(0, 5).join(', '));
  fs.mkdirSync(to, { recursive: true });
  for (const file of filesOf(doc)) fs.copyFileSync(path.join(from, file), path.join(to, file));
  const own = Object.fromEntries(OWN.filter(key => doc[key] !== undefined).map(key => [key, doc[key]]));
  fs.writeFileSync(path.join(to, 'index.json'), JSON.stringify(relocate(own, prefix), null, 1) + '\n');
  return to;
}

/* The frozen updates, newest first, as the latest index lists them. */
function list(whatsNewDir) {
  const dir = path.join(whatsNewDir, ARCHIVE);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse().map(date => {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, date, 'index.json'), 'utf8'));
    return { date, title: (doc.notes && doc.notes.title) || '', path: ARCHIVE + '/' + date + '/index.json' };
  });
}

module.exports = { ARCHIVE, freeze, list, filesOf, relocate };
