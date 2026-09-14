/*
 * The Skin Viewer's catalogues, written the way a browser reads them.
 *
 *   node tools/compact-skins-data.js
 *
 * They arrived pretty-printed: two spaces of indent and a newline for every
 * one of the 28,936 frames, which is half the file. Nobody reads them - they
 * are fetched whole by web/skins/app.js before the viewer draws anything, so
 * every one of those spaces is paid for twice, once by the visitor waiting
 * for the module to open and once by the repository carrying a new copy of
 * the whole file each time the game changes.
 *
 * Whitespace only. The parsed value is identical before and after, and the
 * script refuses to write if it is not - so running it twice does nothing,
 * and running it on a freshly generated catalogue is safe.
 *
 * Note: unlike every other data file here, these four are not produced by
 * `npm run scrape` - no generator for them exists in this repository yet, so
 * they cannot currently be rebuilt when the game updates.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const root = path.join(__dirname, '..');
const HERE = path.join(root, 'web', 'assets', 'skins', 'generated');
const FILES = ['skins.json', 'dyes.json', 'index-links.json', 'classes.json'];

let saved = 0;
for (const name of FILES) {
  const file = path.join(HERE, name);
  if (!fs.existsSync(file)) {
    console.error(`${name} is not there; nothing was written.`);
    process.exit(1);
  }
  const before = fs.readFileSync(file, 'utf8');
  const value = JSON.parse(before);
  const after = JSON.stringify(value);

  // The whole point: the same value, fewer bytes. Prove it rather than trust it.
  assert.deepEqual(JSON.parse(after), value, `${name}: the value changed`);

  if (after.length >= before.length) {
    console.log(`  ${name.padEnd(18)} already compact`);
    continue;
  }
  fs.writeFileSync(file, after);
  saved += before.length - after.length;
  console.log(`  ${name.padEnd(18)} ${(before.length / 1048576).toFixed(2)} MB`
    + ` -> ${(after.length / 1048576).toFixed(2)} MB`);
}

console.log(saved
  ? `\n  ${(saved / 1048576).toFixed(1)} MB less to fetch before the viewer opens.\n`
  : '\n  Nothing to do.\n');
