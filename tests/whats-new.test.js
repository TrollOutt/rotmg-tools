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
const told = index.crucible.findIndex(c => c.from === index.notes.date);
assert(told >= 0, 'the update the account tells is a Crucible period, so its full record attaches to it');
assert(index.crucible.slice(0, told).every(c => c.from > index.notes.date),
  'a Crucible period newer than the account is one whose client has not been read yet');

assert.strictEqual(index.ritual.name, 'Blood Ritual');
assert(Array.isArray(index.ritual.gear) && Array.isArray(index.ritual.seasons), 'the ritual lists its gear and its seasons');
for (const season of index.ritual.seasons) {
  assert(index.crucible.some(c => c.season === season.season && (c.part || null) === (season.part || null)),
    'a ritual season is one the Crucible knows: ' + season.season);
}

/* ---- cumulative set bonuses, using the page's own renderer ---- */
{
  const vm = require('vm');
  const source = read('web/whats-new.js');
  const marker = '  return { init };';
  assert.strictEqual(source.split(marker).length, 2, 'the renderer test has one export marker');
  const exported = { exports: {} };
  vm.runInNewContext(source.replace(marker,
    '  return { setBlock, setIndex(value) { ix = value; } };'),
  { module: exported, window: { addEventListener() {} }, document: {}, console });
  const news = exported.exports;
  function render(steps, bonusOnly = true) {
    news.setIndex({ all: new Map([['set:Test', { name: 'Test', steps, pieces: ['Piece'] }]]) });
    return news.setBlock('Test', bonusOnly);
  }
  const cells = row => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1]);
  const rows = html => [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].slice(1).map(m => cells(m[1]));
  const positive = render({ 2: { MAXHP: 10, ATT: 2 }, 3: { MAXMP: 5, ATT: 3 }, 4: { MAXHP: 20, DEF: 0 } });
  assert.deepStrictEqual(rows(positive), [
    ['2 pieces', '+10', '', '+2', ''],
    ['3 pieces', '', '+5', '+3', ''],
    ['Full set', '+20', '', '', ''],
    ['Total set bonus', '+30', '+5', '+5', '']
  ], 'HP/MP keys, partial sums and zero cells preserve every ordinary row');
  assert.strictEqual((positive.match(/class="is-total"/g) || []).length, 1);
  assert(positive.indexOf('class="is-total"') > positive.indexOf('Full set'), 'the total is last');
  const negative = render({ 2: { ATT: -2 }, 3: { ATT: -3, DEF: -1 }, 4: { DEF: -4 } }, false);
  assert.deepStrictEqual(rows(negative), [
    ['Two worn', '\u22122', ''], ['Three worn', '\u22123', '\u22121'], ['Four worn', '', '\u22124'], ['In all', '\u22125', '\u22125']
  ]);
  assert(negative.includes('is-price') && negative.includes('Each line adds to the one above it.'));
  assert(!negative.includes('st-things'), 'a price still omits the pieces');
  for (const steps of [{}, { 4: { MAXHP: 10 } }, { 2: { ATT: -2 } }]) {
    assert(!render(steps).includes('is-total'), 'zero or one step has no total');
  }
  assert.deepStrictEqual(rows(render({ 2: { ATT: 2, DEF: null }, 3: { ATT: -2, DEF: 0 } })), [
    ['2 pieces', '+2', ''], ['3 pieces', '\u22122', ''], ['Total set bonus', '', '']
  ], 'cancellation, zero and null values stay blank, as in ordinary cells');
  assert(render({ 2: { ATT: 1 }, 4: { ATT: 2 } }, false).includes('Piece'), 'ordinary pieces remain visible');
  assert(!positive.includes('st-things'), 'bonusOnly still omits the pieces');
  const css = read('web/style.css').replace(/\r\n/g, '\n');
  assert(css.includes('.st-bonus tr.is-total td { border-top: 1px solid rgb(var(--s-lo) / .5); font-weight: 650; padding-top: 6px; }\n'
    + '.st-bonus tr.is-total td:first-child { color: var(--text); }'), 'the total has the requested separator and emphasis');
}

/* ---- the page, drawn from that file alone ---- */
function element(id) {
  return { id, innerHTML: '', textContent: '', hidden: false, dataset: {}, listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    contains() { return true; }, querySelector() { return null; }, querySelectorAll() { return []; } };
}

async function drawn(pick, tab) {
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
    if (pick !== undefined) {
      const choose = { dataset: { upd: String(pick) }, matches: () => false };
      els.newsApp.listeners.click[0]({ target: { closest: () => choose }, preventDefault() {} });
    }
    if (tab !== undefined) {
      const choose = { dataset: { page: tab }, matches: () => false };
      els.newsApp.listeners.click[0]({ target: { closest: () => choose }, preventDefault() {} });
    }
    return els;
  } finally {
    delete require.cache[modulePath];
    if (oldDocument === undefined) delete global.document;
    else global.document = oldDocument;
  }
}

const latest = index.crucible[0];
/* The notes the newest update is told by: the account of its client, or what was written ahead of a client not read yet. */
const ahead = (index.upcoming || []).find(n => n.date === latest.from);
const notes = ahead || (latest.from === index.notes.date ? index.notes : null);
const ritualOf = c => index.ritual.seasons.some(r => r.season === c.season && (r.part || null) === (c.part || null));
const quiet = index.crucible.findIndex(c => !ritualOf(c));

drawn().then(els => {
  /* The newest update, by default: whatever its client has or has not yet given. */
  const page = els.newsApp.innerHTML;
  assert(page.includes('Overview') && page.includes('Crucible'), "the newest update opens on its overview, with the Crucible");
  assert(els.newsTitle.innerHTML.includes(notes ? notes.title : 'Season ' + latest.season), "the title names the newest update");
  assert.strictEqual(page.includes('Blood Ritual'), ritualOf(latest), "the Blood Ritual is drawn as written, and only for a season that had one");
  assert(els.newsUpd.innerHTML.includes('Latest'), "the selector says which update is the latest");
  if (ahead) assert(page.includes('data-page="summary"') && !page.includes('data-page="weapons"'),
    "an update ahead of its client tells its notes, and has no tables of things it has not read");
  else if (notes) {
    assert(page.includes('Summary'), "the tabs open with the Overview and the Summary");
    for (const word of ['Weapons', 'Abilities', 'Armour', 'Rings', 'Skins', 'Consumables', 'Places']) {
      assert(page.includes('data-page="' + (word === 'Armour' ? 'armour' : word.toLowerCase()) + '"'), 'a tab for ' + word);
    }
    assert(!/data-page="pets"|data-page="equipment"/.test(page), 'pets and "other gear" are not kinds of their own');
  }
  assert(!/next season/i.test(page), "the page never speaks of a season that has not come");
  return drawn(0, 'summary');
}).then(els => {
  /* The notes, read in the Summary. */
  const page = els.newsApp.innerHTML;
  if (notes) assert(page.includes(notes.parts[0].title), "the Summary tells the notes");
  for (const n of index.upcoming || []) for (const file of [].concat(n.images || [], ...n.parts.map(p => p.images || [])).map(i => i.file)) {
    assert(fs.existsSync(path.join(root, 'web/assets/whats-new/upcoming', file)), 'the picture ' + file + ' is kept beside the index');
    assert(fs.existsSync(path.join(root, 'data/Updates/upcoming/images', file)), 'the picture ' + file + ' is kept in data/Updates');
  }
  assert.strictEqual(els.newsApp.listeners.click.length, 1, "one click listener on the page");
  return quiet > 0 ? drawn(quiet) : els;
}).then(els => {
  /* An older update, picked from the selector: a season without a Blood Ritual says nothing about one. */
  const page = els.newsApp.innerHTML;
  if (quiet > 0) {
    assert(!page.includes('Blood Ritual'), "a season without a Blood Ritual says nothing about one");
    assert(!els.newsUpd.innerHTML.includes('Latest'), "an older update is not called the latest");
  }
  console.log("What's New: " + index.crucible.length + ' Crucible periods, the Blood Ritual per season, drawn from the update alone.');
}).catch(error => { console.error(error); process.exit(1); });
