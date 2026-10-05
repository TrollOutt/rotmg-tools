#!/usr/bin/env node
'use strict';
/*
 * The status effects, as one catalogue the site can read.
 *
 *   node tools/build-status-effects.js
 *
 * Three sources, each for what only it knows:
 *
 *   data/Items/status-effects.txt  what each effect does, its tone and which of
 *                                  the client's pictures the game draws for it
 *   data/Index/index.json          who grants or inflicts it - the conditions the
 *                                  Index read off every item and creature - and
 *                                  which creatures declare themselves immune
 *   client-data                    the pictures themselves, cut from the client's
 *                                  sheets through its sprite registry
 *
 * Writes web/assets/index/status-effects.json and status-icons.png, beside the
 * other Index card extras. It needs the installed client's extraction for the
 * pictures, so it runs inside `npm run index-extras`, which `npm run scrape`
 * runs after the Index is published.
 *
 * It refuses to run if the client names an effect the catalogue does not
 * describe: an update that brings a new status must bring its line too.
 */
const fs = require('fs');
const path = require('path');
const { readPng, writePng } = require('./png');
const { read } = require('./spritesheet');

const root = path.join(__dirname, '..');
const CATALOGUE = path.join(root, 'data', 'Items', 'status-effects.txt');
const INDEX = path.join(root, 'data', 'Index', 'index.json');
const CLIENT = process.env.ROTMG_CLIENT_DATA || path.join(root, 'client-data');
const OUT = path.join(root, 'web', 'assets', 'index');

/* ---------------- what each effect is ---------------- */
function readCatalogue() {
  const effects = new Map();
  const immune = [];
  for (const raw of fs.readFileSync(CATALOGUE, 'utf8').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('##')) continue;
    const cells = line.split('|');
    if (cells[0] === 'immune') {
      immune.push({ enemy: cells[1], effects: cells[2].split(',').map(x => x.trim()) });
      continue;
    }
    const [name, tone, icon, model, player, enemy] = cells;
    if (!['good', 'bad'].includes(tone)) throw new Error('status-effects.txt: "' + name + '" has no tone');
    effects.set(name, {
      name, tone,
      icon: icon || null,
      model: parseModel(model, name),
      player: player || undefined,
      enemy: enemy || undefined
    });
  }
  return { effects, immune };
}

// "def zero; taken x1.25" -> [{ what: 'def', op: 'zero' }, { what: 'taken', op: 'x', value: 1.25 }]
function parseModel(text, name) {
  if (!text) return undefined;
  return text.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const m = /^(\w+)\s+(?:(zero)|x(-?[\d.]+)|([+-][\d.]+)|([\d.]+))$/.exec(part);
    if (!m) throw new Error('status-effects.txt: cannot read "' + part + '" for ' + name);
    if (m[2]) return { what: m[1], op: 'zero' };
    if (m[3] !== undefined) return { what: m[1], op: 'x', value: Number(m[3]) };
    return { what: m[1], op: '+', value: Number(m[4] !== undefined ? m[4] : m[5]) };
  });
}

/* ---------------- who grants, inflicts and resists it ---------------- */
function readSources(effects, immuneRules) {
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const byId = new Map(index.records.map(r => [r.id, r]));
  const lead = r => (r.folded && byId.get(r.folded)) || r;
  const unknown = new Map();
  const slot = name => {
    const one = effects.get(name);
    if (!one) { unknown.set(name, (unknown.get(name) || 0) + 1); return null; }
    one.inflicts ||= new Map(); one.grants ||= new Map(); one.inflictedBy ||= new Map(); one.immune ||= new Set();
    return one;
  };
  for (const r of index.records) {
    for (const c of r.conditions || []) {
      const one = slot(c.effect);
      if (!one) continue;
      const who = lead(r);
      const duration = c.duration !== undefined ? Number(c.duration) : undefined;
      const entry = { id: who.id, ...(Number.isFinite(duration) ? { duration } : {}),
        ...(c.on && c.on !== 'hit' ? { by: c.on } : {}),
        ...(c.proc && Number(c.proc) < 1 ? { chance: Number(c.proc) } : {}),
        ...(c.bleedDamage || c.amount ? { amount: Number(c.bleedDamage || c.amount) } : {}) };
      const list = c.target === 'player' ? one.inflictedBy
        : c.target === 'enemy' ? one.inflicts : one.grants;
      // One line per thing: the longest duration it states.
      const had = list.get(who.id);
      if (!had || (entry.duration || 0) > (had.duration || 0)) list.set(who.id, entry);
    }
    for (const name of r.immune || []) {
      const one = slot(name);
      if (one) one.immune.add(lead(r).id);
    }
  }
  for (const rule of immuneRules) {
    const r = byId.get('enemy:' + rule.enemy);
    if (!r) throw new Error('status-effects.txt: no enemy "' + rule.enemy + '" in the Index');
    for (const name of rule.effects) { const one = slot(name); if (one) one.immune.add(r.id); }
  }
  if (unknown.size) {
    throw new Error('The client names status effects data/Items/status-effects.txt does not describe: '
      + [...unknown].map(([k, n]) => k + ' (' + n + ')').join(', '));
  }
  return index;
}

/* ---------------- the pictures ---------------- */
function cutIcons(effects) {
  const registry = read(fs.readFileSync(path.join(CLIENT, 'spritesheet.bin')));
  const atlases = new Map(registry.still.map(a => [a.name, new Map(a.sprites.map(s => [s.index, s]))]));
  const sheets = new Map();
  const sheet = name => {
    if (!sheets.has(name)) sheets.set(name, readPng(fs.readFileSync(path.join(CLIENT, 'textures', name + '.png'))));
    return sheets.get(name);
  };
  const wanted = [...new Set([...effects.values()].map(one => one.icon).filter(Boolean))];
  const CELL = 22;                               // the largest picture: a stat change, 22 square
  const COLS = 8;
  const wide = CELL * COLS, tall = CELL * Math.ceil(wanted.length / COLS);
  const pixels = Buffer.alloc(wide * tall * 4);
  const placed = new Map();
  wanted.forEach((key, n) => {
    const [atlas, index] = key.split('#');
    const sprite = atlases.get(atlas) && atlases.get(atlas).get(Number(index));
    if (!sprite) throw new Error('No sprite ' + key + ' in the client registry');
    const from = sheet(sprite.sheet), { x, y, w, h } = sprite.rect;
    const ox = (n % COLS) * CELL, oy = Math.floor(n / COLS) * CELL;
    for (let j = 0; j < h; j++) {
      from.pixels.copy(pixels, ((oy + j) * wide + ox) * 4, ((y + j) * from.width + x) * 4, ((y + j) * from.width + x + w) * 4);
    }
    placed.set(key, [ox, oy, w, h]);
  });
  fs.writeFileSync(path.join(OUT, 'status-icons.png'), writePng(wide, tall, pixels));
  return { wide, tall, placed };
}

function main() {
  const { effects, immune } = readCatalogue();
  const index = readSources(effects, immune);
  const icons = cutIcons(effects);
  const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sorted = map => [...(map || new Map()).values()].sort((a, b) => a.id.localeCompare(b.id));
  const out = {
    built: index.built,
    from: index.from,
    tool: 'tools/build-status-effects.js',
    wiki: 'https://www.realmeye.com/wiki/status-effects',
    sheet: { wide: icons.wide, tall: icons.tall },
    effects: [...effects.values()].sort((a, b) => a.name.localeCompare(b.name)).map(one => ({
      name: one.name,
      tone: one.tone,
      icon: one.icon ? icons.placed.get(one.icon) : undefined,
      model: one.model,
      player: one.player,
      enemy: one.enemy,
      anchor: slug(one.name),
      inflicts: sorted(one.inflicts),
      grants: sorted(one.grants),
      inflictedBy: sorted(one.inflictedBy),
      immune: [...(one.immune || [])].sort()
    }))
  };
  fs.writeFileSync(path.join(OUT, 'status-effects.json'), JSON.stringify(out) + '\n');
  const say = n => n.toLocaleString('en-US');
  const sum = key => out.effects.reduce((t, one) => t + one[key].length, 0);
  console.log('  Status effects: ' + out.effects.length + ' described, '
    + out.effects.filter(one => one.icon).length + ' with the client\'s picture; '
    + say(sum('inflicts')) + ' items inflict one, ' + say(sum('grants')) + ' grant one, '
    + say(sum('inflictedBy')) + ' creatures inflict one, ' + say(sum('immune')) + ' immunities.');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { readCatalogue, parseModel };
