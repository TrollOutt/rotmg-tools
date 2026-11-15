#!/usr/bin/env node
/*
 * Index identifiers that change object between two builds (ROT-B-02).
 *
 * An Index id ("item:Spider Shuriken") is what a favourite, a shared link
 * (#index?open=...), the wiki.json join and the frozen corpora remember. When
 * a name is declared twice, the first declaration met takes the bare id and
 * the others "name#clientId"; which one is met first follows the numbering of
 * the Objects.NNN.xml files, and that numbering follows their content. So a
 * new build can hand a bare id to another object, and everything that kept
 * the id now points at the wrong thing, silently. See INDEX-IDS.md.
 *
 * This check does not fix that. It compares the Index being published with
 * the one before it and fails when an id now names another object, so the
 * change is seen before it ships.
 *
 *     node tools/check-index-ids.js                 # HEAD's index vs the working copy
 *     node tools/check-index-ids.js OLD.json NEW.json
 *
 * An object is told apart by its kind and client type number (the file number
 * is left out: it is the part that moves); objects without a type number
 * (sets, pools, enchantment lists, places) by their kind and client id.
 * ROTMG_ACCEPT_ID_CHANGES=1 turns the failure into a warning, for an update
 * whose id moves were checked by hand.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const INDEX = 'data/Index/index.json';

function identity(record) {
  const type = record.from && record.from[1];
  if (type && type !== '0x0') return record.kind + '|' + type;
  return record.kind + '|' + (record.alias || record.name);
}

/*
 * old, new: arrays of records. Returns the ids that name another object now
 * (reassigned), the ids used twice in one build (duplicates) and, for the
 * record, how many objects simply changed id (renamed) - harmless to the
 * Index itself, but a favourite or link on the old id no longer opens.
 */
function compareIds(oldRecords, newRecords) {
  const duplicates = [];
  const byId = records => {
    const map = new Map();
    for (const one of records) {
      if (map.has(one.id)) duplicates.push(one.id);
      else map.set(one.id, one);
    }
    return map;
  };
  const before = byId(oldRecords);
  const after = byId(newRecords);
  const reassigned = [];
  for (const [id, was] of before) {
    const now = after.get(id);
    if (now && identity(now) !== identity(was)) reassigned.push({ id, before: identity(was), after: identity(now) });
  }
  const idOf = new Map([...before.values()].map(one => [identity(one), one.id]));
  let renamed = 0;
  for (const one of after.values()) {
    const old = idOf.get(identity(one));
    if (old && old !== one.id) renamed++;
  }
  return { reassigned, duplicates, renamed };
}

function readRecords(text, where) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.records)) throw new Error(where + ': no records array');
  return parsed.records;
}

function fromHead() {
  try {
    return execFileSync('git', ['show', 'HEAD:' + INDEX], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return null;
  }
}

function main(argv) {
  let oldText;
  let newText;
  if (argv.length === 2) {
    oldText = fs.readFileSync(argv[0], 'utf8');
    newText = fs.readFileSync(argv[1], 'utf8');
  } else if (argv.length === 0) {
    oldText = fromHead();
    if (oldText == null) {
      console.log('index ids: no committed Index to compare with, skipped');
      return 0;
    }
    newText = fs.readFileSync(path.join(root, INDEX), 'utf8');
    if (newText === oldText) {
      console.log('index ids: the Index is the committed one, nothing to compare');
      return 0;
    }
  } else {
    console.error('usage: node tools/check-index-ids.js [OLD.json NEW.json]');
    return 2;
  }

  const result = compareIds(readRecords(oldText, 'old index'), readRecords(newText, 'new index'));
  for (const id of result.duplicates) console.error('  duplicate id: ' + id);
  for (const one of result.reassigned) console.error(`  ${one.id}: was ${one.before}, now ${one.after}`);
  const accept = process.env.ROTMG_ACCEPT_ID_CHANGES === '1';
  if (result.reassigned.length || result.duplicates.length) {
    console.error(`index ids: ${result.reassigned.length} id(s) now name another object, ${result.duplicates.length} duplicate(s)` +
      (accept ? ' (accepted by ROTMG_ACCEPT_ID_CHANGES)' : '; favourites, shared links and the wiki.json join would follow them. See INDEX-IDS.md.'));
    if (!accept) return 1;
  } else {
    console.log(`index ids: no id names another object (${result.renamed} object(s) changed id)`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { identity, compareIds };
