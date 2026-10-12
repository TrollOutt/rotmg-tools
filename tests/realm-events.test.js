'use strict';
/*
 * The seasonal events: the catalogue of who comes out at what mark of the
 * realm's score, its join with the Index, the invasion waves the client
 * declares, and the pages that show them.
 */
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const { readCatalogue, parseScores, sourceOf, build } = require('../tools/build-realm-events');
const served = JSON.parse(read('web/assets/index/realm-events.json'));
const index = JSON.parse(read('data/Index/index.json'));
const byId = new Map(index.records.map(r => [r.id, r]));

/* ---------------- the marks ---------------- */
assert.deepEqual(parseScores('15, 50,85', 't'), [15, 50, 85]);
assert.equal(parseScores('?', 't'), '?');
assert.equal(parseScores('', 't'), undefined);
for (const bad of ['50,15', '0,101', '15,15', 'half']) {
  assert.throws(() => parseScores(bad, 't'), /not percentages in order/, bad + ' is not a list of marks');
}
assert.deepEqual(sourceOf('the-gardener'), { label: 'The Gardener', url: 'https://www.realmeye.com/wiki/the-gardener' });
assert.equal(sourceOf("notes:motmg-season31-part1").url, undefined, 'our own notes are not a link');

/* ---------------- the catalogue, and what the site is served ---------------- */
const events = readCatalogue();
assert.equal(served.events.length, events.size, 'every event is served; run npm run index-extras');
assert.deepEqual(JSON.parse(JSON.stringify(build())), served, 'the served file is what the catalogue and the Index give; run npm run index-extras');
for (const e of served.events) {
  assert(e.name && e.when && e.summary, e.id + ' says what it is');
  assert(e.sources.length, e.id + ' says where it is written');
  assert(e.spawns.length, e.id + ' brings someone out');
  if (e.begins !== undefined) assert(e.begins >= 0 && e.begins <= 100, e.id + ' begins at a percentage');
  if (e.art) assert(byId.has(e.art), e.id + ' is pictured by an Index record');
  for (const s of e.spawns) {
    if (s.id) assert(byId.has(s.id) && !byId.get(s.id).folded, e.id + ' ' + s.name + ' is a lead Index record');
    if (Array.isArray(s.at)) assert(s.at.every((m, i) => m >= 0 && m <= 100 && (!i || m > s.at[i - 1])), e.id + ' ' + s.name + ' marks are in order');
    assert(s.at === undefined || s.at === '?' || Array.isArray(s.at), e.id + ' ' + s.name + ' marks have a shape');
    assert(s.sources.length, e.id + ' ' + s.name + ' says where it is written');
  }
}

/* ---------------- the figures the update notes give ---------------- */
const at = (event, who) => served.events.find(e => e.id === event).spawns.find(s => s.name === who);
assert.deepEqual(at('halloween', 'Totalia the Malevolent').at, [15, 50, 85]);
assert.deepEqual(at('halloween', 'Zombie Horde').at, [40, 60, 80]);
assert.deepEqual(at('christmas', 'Jotunn').at, [75]);
assert.deepEqual(at('valentines', 'The Gardener').at, [33, 66]);
assert.equal(served.events.find(e => e.id === 'alien-invasion').begins, 15, 'invasions may begin at 15% (2026 release notes)');

/* ---------------- the invasion's waves come from the client ---------------- */
const invasion = served.events.find(e => e.id === 'alien-invasion');
assert.equal(invasion.waves.length, 6, 'three Adept waves and three Veteran waves');
assert.deepEqual(invasion.waves.map(w => w.tier + w.wave), ['Adept1', 'Adept2', 'Adept3', 'Veteran1', 'Veteran2', 'Veteran3']);
const inWaves = new Set(invasion.waves.flatMap(w => w.enemies.map(x => x.id)));
for (const id of inWaves) assert(byId.has(id), id + ' is an Index record');
// An update that brings a new alien must put it in a wave: the Index labels the invasion's aliens.
const labelled = index.records.filter(r => r.kind === 'enemy' && !r.folded && (r.labels || []).some(l => /^ALIEN_INVASION_(ADEPT|VETERAN)$/.test(l))
  && r.hp && /^Alien /.test(r.name) && !/Reactor|UFO|Bomb|Spawner|Generator/.test(r.name));
for (const r of labelled) assert(inWaves.has(r.id), r.id + ' is labelled as an invasion alien and is in no wave');

/* ---------------- the pages that show them ---------------- */
const page = read('web/index-page.js'), browse = read('web/index-browse.js'), fiches = read('web/fiches-c.js');
assert(/async function loadEvents\(\)/.test(page) && page.includes("'event:' + event.id") && /loadStatuses\(\), loadEvents\(\)/.test(page),
  'the Index page creates an event record for each event');
assert(browse.includes("domain('events', 'Events'") && /const ORDER = \[[^\]]*'events'/.test(browse), 'the Index has an Events family');
assert(browse.includes('function eventCards(rows, d)') && /if \(d\.id === 'events'\) \{[^}]*eventCards\(rows, d\)/.test(browse)
  && read('web/style.css').includes('.ixb-evgrid'), 'the Events family shows each event as a card, as the overview does its families');
assert(/^    event\(r, root, blocks\) \{/m.test(fiches) && fiches.includes('function sheetEvent') && fiches.includes('function eventDossier'),
  'an event has its own card, in both layouts');
assert(read('tools/build-standalone.js').includes('eventsText'), 'the kept copy carries the events');
assert(JSON.parse(read('package.json')).scripts['index-extras'].includes('build-realm-events'), 'npm run index-extras rebuilds the events');

console.log('Realm events: ' + served.events.length + ' events, '
  + served.events.reduce((t, e) => t + e.spawns.length, 0) + ' creatures with their marks, '
  + invasion.waves.length + ' invasion waves read from the client, in step with the Index.');
