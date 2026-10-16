#!/usr/bin/env node
'use strict';
/*
 * The realm's seasonal events, as one catalogue the site can read: which
 * creatures each brings out, and at what mark of the realm's score.
 *
 *   node tools/build-realm-events.js
 *
 * Two sources, each for what only it knows:
 *
 *   data/Items/realm-events.txt  the events and the score marks the community has
 *                                written down. The client does not say them: the
 *                                server watches the realm's score.
 *   client-data                  which aliens belong to which invasion wave, and
 *                                in which biomes: the client declares that on
 *                                each alien (SpawnIfGlobalTag).
 *   data/Index/index.json        who the creatures are, so each line is joined
 *                                to the Index card of the same creature.
 *
 * Writes web/assets/index/realm-events.json, beside the other Index card
 * extras, and runs inside `npm run index-extras`.
 *
 * It refuses to run on a line that names an Index id the Index has not got, a
 * score that is not a percentage in order, or an alien wave that holds a
 * creature the Index does not know: an update that moves them must move the
 * catalogue too.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CATALOGUE = path.join(root, 'data', 'Items', 'realm-events.txt');
const INDEX = path.join(root, 'data', 'Index', 'index.json');
const CLIENT = process.env.ROTMG_CLIENT_DATA || path.join(root, 'client-data');
const OUT = path.join(root, 'web', 'assets', 'index', 'realm-events.json');

const WIKI = 'https://www.realmeye.com/wiki/';
const title = slug => slug.replace(/-s-/g, "'s ").replace(/-/g, ' ').replace(/(^|\s)(\w)/g, (m, a, c) => a + c.toUpperCase());

// "special-event-quest-monsters" -> a RealmEye page; "notes:motmg-season31-part1" -> this project's own update notes.
function sourceOf(token) {
  if (token.startsWith('notes:')) {
    const m = /season(\d+)-part(\d+)/.exec(token);
    return { label: m ? 'Season ' + m[1] + ', part ' + m[2] + ' notes' : 'Update notes' };
  }
  return { label: title(token), url: WIKI + token };
}

// "15,50,85" -> [15, 50, 85]; "?" -> '?'; "" -> undefined.
function parseScores(text, where) {
  const t = String(text || '').trim();
  if (!t) return undefined;
  if (t === '?') return '?';
  const marks = t.split(',').map(x => Number(x.trim()));
  if (!marks.every((n, i) => Number.isFinite(n) && n >= 0 && n <= 100 && (i === 0 || n > marks[i - 1]))) {
    throw new Error('realm-events.txt: the scores "' + t + '" for ' + where + ' are not percentages in order');
  }
  return marks;
}

function readCatalogue() {
  const events = new Map();
  for (const raw of fs.readFileSync(CATALOGUE, 'utf8').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('##')) continue;
    const cells = line.split('|').map(x => x.trim());
    if (cells[0] === 'event') {
      const [, id, name, when, begins, summary, art, sources] = cells;
      if (events.has(id)) throw new Error('realm-events.txt: the event "' + id + '" is written twice');
      events.set(id, {
        id, name, when, summary, art: art || undefined,
        begins: begins && /^\d+$/.test(begins) ? Number(begins) : undefined,
        sources: (sources || '').split(',').map(x => x.trim()).filter(Boolean),
        spawns: []
      });
    } else if (cells[0] === 'at') {
      const [, id, who, scores, where, note, sources] = cells;
      const event = events.get(id);
      if (!event) throw new Error('realm-events.txt: a line for the event "' + id + '", which is not declared above it');
      event.spawns.push({
        who, at: parseScores(scores, who + ' in ' + id), where: where || undefined, note: note || undefined,
        sources: (sources || '').split(',').map(x => x.trim()).filter(Boolean)
      });
    } else {
      throw new Error('realm-events.txt: cannot read the line "' + line.slice(0, 60) + '"');
    }
  }
  return events;
}

/* ---------------- the Index, to join each creature to its card ---------------- */
function indexOf() {
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const byId = new Map(index.records.map(r => [r.id, r]));
  const lead = r => (r.folded && byId.get(r.folded)) || r;
  const byName = new Map();
  for (const r of index.records) {
    if (r.kind !== 'enemy' || r.folded) continue;
    const key = String(r.name).toLowerCase();
    if (!byName.has(key)) byName.set(key, r);
  }
  return { index, byId, lead, byName };
}

// An Index id, or a plain name joined to the creature of that name when there is one.
function join(who, here, where) {
  if (/^[a-z]+:/.test(who)) {
    const r = here.byId.get(who);
    if (!r) throw new Error('realm-events.txt: no Index record "' + who + '" (' + where + ')');
    const lead = here.lead(r);
    return { id: lead.id, name: lead.said || lead.name };
  }
  const r = here.byName.get(who.toLowerCase());
  return r ? { id: r.id, name: r.said || r.name } : { id: null, name: who };
}

/* ---------------- the invasion's waves, from the client ---------------- */
const PLACE = name => name.replace(/([a-z])([A-Z])/g, '$1 $2');
function readWaves(here) {
  if (!fs.existsSync(CLIENT)) return null;
  const waves = new Map();
  for (const file of fs.readdirSync(CLIENT).filter(f => /^Objects\.\d+\.xml$/.test(f))) {
    const text = fs.readFileSync(path.join(CLIENT, file), 'utf8');
    if (!text.includes('AIInvasion')) continue;
    for (const m of text.matchAll(/<Object type="[^"]*" id="([^"]*)">([\s\S]*?)<\/Object>/g)) {
      const tag = /<SpawnIfGlobalTag>AIInvasion(Adept|Veteran)Wave(\d+)<\/SpawnIfGlobalTag>/.exec(m[2]);
      if (!tag) continue;
      const shown = (/<DisplayId>([^<]*)<\/DisplayId>/.exec(m[2]) || [])[1] || m[1];
      const r = here.byName.get(shown.toLowerCase());
      if (!r) throw new Error('The client puts "' + shown + '" in an Alien Invasion wave and the Index has no creature of that name');
      const key = tag[1] + tag[2];
      const wave = waves.get(key) || waves.set(key, { tier: tag[1], wave: Number(tag[2]), enemies: [], terrain: new Set() }).get(key);
      wave.enemies.push({ id: r.id, name: r.said || r.name, hp: Number((/<MaxHitPoints>(\d+)</.exec(m[2]) || [])[1]) || undefined });
      for (const t of ((/<Terrain>([^<]*)</.exec(m[2]) || [])[1] || '').split(',').filter(Boolean)) wave.terrain.add(PLACE(t));
    }
  }
  return [...waves.values()]
    .sort((a, b) => (a.tier === b.tier ? a.wave - b.wave : a.tier === 'Adept' ? -1 : 1))
    .map(w => ({ ...w, terrain: [...w.terrain] }));
}

function build() {
  const events = readCatalogue();
  const here = indexOf();
  const out = [];
  for (const e of events.values()) {
    const art = e.art ? join(e.art, here, e.id + ' picture').id : undefined;
    const one = {
      id: e.id, name: e.name, when: e.when, begins: e.begins, summary: e.summary, art,
      sources: e.sources.map(sourceOf),
      spawns: e.spawns.map(s => {
        const who = join(s.who, here, e.id);
        return { id: who.id, name: who.name, at: s.at, where: s.where, note: s.note, sources: s.sources.map(sourceOf) };
      })
    };
    if (e.id === 'alien-invasion') {
      const waves = readWaves(here);
      if (waves) one.waves = waves;
    }
    out.push(one);
  }
  const written = {
    built: here.index.built, from: here.index.from, tool: 'tools/build-realm-events.js',
    events: out
  };
  // The alien waves are read from the client; without it the last copy keeps its own.
  if (!out.some(e => e.waves) && fs.existsSync(OUT)) {
    const had = JSON.parse(fs.readFileSync(OUT, 'utf8')).events.find(e => e.id === 'alien-invasion');
    const now = written.events.find(e => e.id === 'alien-invasion');
    if (had && had.waves && now) now.waves = had.waves;
  }
  return written;
}

function main() {
  const written = build();
  fs.writeFileSync(OUT, JSON.stringify(written) + '\n');
  const spawns = written.events.reduce((t, e) => t + e.spawns.length, 0);
  const joined = written.events.reduce((t, e) => t + e.spawns.filter(s => s.id).length, 0);
  const waves = (written.events.find(e => e.waves) || { waves: [] }).waves;
  console.log('  Realm events: ' + written.events.length + ' events, ' + spawns + ' creatures ('
    + joined + ' joined to the Index), ' + waves.length + ' alien waves from the client.');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { readCatalogue, parseScores, sourceOf, build };
