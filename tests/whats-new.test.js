'use strict';

/*
 * What's New: the data the page reads and the page it draws from it.
 *
 * The update says what came, changed and left; the seasonal modes - the
 * Crucible's every season and the Blood Ritual's - travel beside it in the same
 * file, written from data/Updates. The page must draw from that file alone when
 * the Index cannot be read (the kept copy), and must say nothing about a Blood
 * Ritual a season did not have.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = JSON.parse(read('web/assets/whats-new/index.json'));

/* ---- the data ---- */
assert(Array.isArray(index.crucible) && index.crucible.length > 1, 'the update carries the Crucible\'s seasons');
assert.deepStrictEqual(
  JSON.parse(read('data/Updates/crucible.json')).seasons, index.crucible,
  'the Crucible\'s seasons in the page are the ones in data/Updates'
);
{
  const { built, tool, from, ...kept } = JSON.parse(read('data/Updates/ritual.json'));
  assert(built && tool && from, 'the ritual file carries its provenance');
  assert.deepStrictEqual(kept, index.ritual, 'the Blood Ritual in the page is the one in data/Updates');
}

for (const [i, season] of index.crucible.entries()) {
  const at = 'Crucible period ' + i;
  assert(Number.isInteger(season.season), at + ' has a season');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(season.from) && /^\d{4}-\d{2}-\d{2}$/.test(season.to), at + ' has dates');
  assert(season.from < season.to, at + ' runs forwards');
  assert(Array.isArray(season.stats) && Array.isArray(season.rules) && season.bonuses, at + ' has stats, rules and bonuses');
  for (const stat of season.stats) {
    assert(['HP', 'MP', 'ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS'].includes(stat.stat), at + ' names a stat: ' + stat.stat);
    assert(Number.isFinite(stat.value), at + ' gives ' + stat.stat + ' a value');
  }
  if (i > 0) {
    const later = index.crucible[i - 1];
    assert(season.from <= later.from, at + ' is older than the one before it in the list');
  }
}
assert.strictEqual(index.crucible[0].from, index.notes.date,
  'the newest Crucible period is the update the account tells, so its full record attaches to it');

assert.strictEqual(index.ritual.name, 'Blood Ritual');
assert(Array.isArray(index.ritual.gear) && Array.isArray(index.ritual.seasons), 'the ritual lists its gear and its seasons');
for (const season of index.ritual.seasons) {
  assert(index.crucible.some(c => c.season === season.season && (c.part || null) === (season.part || null)),
    'a ritual season is one the Crucible knows: ' + season.season);
}

/* ---- the page, drawn from that file alone ---- */
function element(id) {
  return { id, innerHTML: '', textContent: '', hidden: false, dataset: {}, listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    querySelector() { return null; }, querySelectorAll() { return []; } };
}

async function drawn() {
  const els = {};
  for (const id of ['newsApp', 'newsTitle', 'newsHead', 'newsUpd', 'pageNews']) els[id] = element(id);
  const oldDocument = global.document;
  global.document = {
    getElementById: id => els[id] || null,
    addEventListener() {},
    activeElement: null
  };
  const modulePath = require.resolve('../web/whats-new.js');
  delete require.cache[modulePath];
  try {
    const news = require(modulePath);
    assert.strictEqual(await news.init({ index, art: null }), true, 'the page starts from the file alone');
    return els;
  } finally {
    delete require.cache[modulePath];
    if (oldDocument === undefined) delete global.document;
    else global.document = oldDocument;
  }
}

drawn().then(els => {
  const page = els.newsApp.innerHTML;
  assert(page.includes('Overview') && page.includes('Summary'), 'the tabs open with the Overview and the Summary');
  for (const word of ['Weapons', 'Abilities', 'Armour', 'Rings', 'Skins', 'Consumables', 'Places']) {
    assert(page.includes('data-page="' + (word === 'Armour' ? 'armour' : word.toLowerCase()) + '"'), 'a tab for ' + word);
  }
  assert(!/data-page="pets"|data-page="equipment"/.test(page), 'pets and "other gear" are not kinds of their own');
  assert(page.includes('Crucible') && page.includes('Blood Ritual'), 'the overview holds both seasonal modes');
  assert(page.includes('Not active this season'), 'a season without a Blood Ritual says so, and nothing more');
  assert(!/next season/i.test(page), 'the page never speaks of a season that has not come');
  assert(els.newsTitle.innerHTML.includes(index.notes.title), 'the title is the update\'s');
  assert(els.newsUpd.innerHTML.includes('Latest'), 'the selector says which update is the latest');
  assert.strictEqual(els.newsApp.listeners.click.length, 1, 'one click listener on the page');
  console.log('What\'s New: ' + index.crucible.length + ' Crucible periods, the Blood Ritual per season, drawn from the update alone.');
}).catch(error => { console.error(error); process.exit(1); });
