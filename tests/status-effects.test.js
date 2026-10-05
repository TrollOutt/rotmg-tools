'use strict';
/*
 * The status effects: the catalogue, its join with the Index, and what the
 * damage model does with them.
 */
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const { readCatalogue, parseModel } = require('../tools/build-status-effects');
const catalogue = JSON.parse(read('web/assets/index/status-effects.json'));
const index = JSON.parse(read('data/Index/index.json'));
const byId = new Map(index.records.map(r => [r.id, r]));
const byName = new Map(catalogue.effects.map(e => [e.name, e]));

/* ---------------- the catalogue ---------------- */
assert.deepEqual(parseModel('def zero; taken x1.25; def -20; bleed 20', 'test'), [
  { what: 'def', op: 'zero' }, { what: 'taken', op: 'x', value: 1.25 },
  { what: 'def', op: '+', value: -20 }, { what: 'bleed', op: '+', value: 20 }]);
assert.throws(() => parseModel('def times two', 'test'), /cannot read/);

const { effects } = readCatalogue();
assert.equal(effects.size, catalogue.effects.length, 'the served catalogue holds every described effect');
for (const [name, one] of effects) {
  assert(['good', 'bad'].includes(one.tone), name + ' has a tone');
  if (one.icon) {
    const [x, y, w, h] = byName.get(name).icon;
    assert(x >= 0 && y >= 0 && x + w <= catalogue.sheet.wide && y + h <= catalogue.sheet.tall, name + ' icon is on the sheet');
  }
}
// The four the damage model reads, with the wiki's figures.
const model = (name, what) => (byName.get(name).model || []).find(m => m.what === what);
assert.deepEqual(model('Curse', 'taken'), { what: 'taken', op: 'x', value: 1.25 });
assert.deepEqual(model('Exposed', 'def'), { what: 'def', op: '+', value: -20 });
assert.deepEqual(model('Armor Broken', 'def'), { what: 'def', op: 'zero' });
assert.deepEqual(model('Damaging', 'damage'), { what: 'damage', op: 'x', value: 1.25 });
assert.deepEqual(model('Berserk', 'rate'), { what: 'rate', op: 'x', value: 1.25 });

/* ---------------- in step with the Index ---------------- */
// Every effect any record names is described, and every source is a record.
const lead = r => (r.folded && byId.get(r.folded)) || r;
const named = new Map();
for (const r of index.records) {
  for (const c of r.conditions || []) {
    assert(byName.has(c.effect), r.id + ' names "' + c.effect + '", which the catalogue does not describe');
    const key = c.effect + '|' + (c.target === 'player' ? 'inflictedBy' : c.target === 'enemy' ? 'inflicts' : 'grants');
    (named.get(key) || named.set(key, new Set()).get(key)).add(lead(r).id);
  }
}
for (const e of catalogue.effects) {
  for (const key of ['inflicts', 'grants', 'inflictedBy']) {
    const ids = new Set(e[key].map(x => x.id));
    for (const id of ids) assert(byId.has(id), e.name + ' ' + key + ' ' + id + ' is an Index record');
    assert.deepEqual([...ids].sort(), [...(named.get(e.name + '|' + key) || [])].sort(),
      e.name + ' ' + key + ' matches the Index; run npm run index-extras');
  }
  for (const id of e.immune) assert(byId.has(id), e.name + ' immune ' + id + ' is an Index record');
}
// Shapes that were missed once: the tiered orbs' Curse, a trap's Slowed, the shields' Armor Broken.
const sources = (effect, key) => new Set(byName.get(effect)[key].map(x => (byId.get(x.id) || {}).name));
assert(sources('Curse', 'inflicts').has('Imprisonment Orb'), 'the tiered orbs curse');
assert(sources('Armor Broken', 'inflicts').has('Shield of Ogmur'), 'Ogmur breaks armour');
assert([...sources('Slowed', 'inflicts')].some(n => /Trap/.test(n || '')), 'a trap slows');
assert(sources('Berserk', 'grants').size > 10, 'Berserk is granted by many things');
assert(byName.get('Stunned').immune.length > 100, 'bosses declare stun immunity');
assert(byName.get('Curse').immune.includes('enemy:Void Entity'), 'the Void Entity resists Curse');

/* ---------------- the damage model ---------------- */
const raw = JSON.parse(read('data/TheoryCraft/theorycraft.json'));
const t = require('./theory-harness')({ statusText: JSON.stringify(catalogue) }, raw, false);
const info = { byName, immune: new Map(), sheet: catalogue.sheet };
for (const e of catalogue.effects) for (const id of e.immune) {
  const n = id.replace(/^enemy:/, '');
  (info.immune.get(n) || info.immune.set(n, new Set()).get(n)).add(e.name);
}
t.setStatusInfo(info);
const fx = up => t.fxOf({ up, from: {}, bleed: 0, immune: new Set() });
const near = (a, b, why) => assert(Math.abs(a - b) < 1e-9, why + ': ' + a + ' vs ' + b);
const base = t.landed(100, 50, 30, false);                       // 100 x 1.5 - 30 = 120
near(base, 120, 'the plain shot');
near(t.landed(100, 50, 30, false, fx({ Curse: 1 })), 150, 'Curse adds a quarter after armour');
near(t.landed(100, 50, 30, false, fx({ 'Armor Broken': 1 })), 150, 'Armor Broken removes positive defence');
near(t.landed(100, 50, 30, false, fx({ Exposed: 1 })), 140, 'Exposed takes twenty off defence');
near(t.landed(100, 50, 30, true, fx({ Exposed: 1 })), 170, 'Exposed adds twenty even to armour-piercing shots');
near(t.landed(100, 50, 30, false, fx({ 'Armor Broken': 1, Exposed: 1 })), 170, 'broken then exposed is defence -20');
near(t.landed(100, 50, 30, false, fx({ Damaging: 1 })), 157.5, 'Damaging multiplies before armour');
near(t.landed(100, 50, 30, false, fx({ Curse: 0.5 })), 135, 'half the time cursed is half the gain');
near(t.landed(100, 50, 30, false, fx({ Damaging: 1, 'Armor Broken': 1, Exposed: 1, Curse: 1 })), (187.5 + 20) * 1.25, 'all four');
near(fx({ Berserk: 1 }).haste, 1.25, 'Berserk fires a quarter faster');
assert.equal(fx({}).onShot, null, 'nothing up, nothing changed');

// An orb's Curse lasts longer with WIS: 2.5 s, plus a second per 20 WIS over 50.
const orb = raw.items.find(i => i.name === 'Imprisonment Orb');
const curse = orb.conditions.find(c => c.effect === 'Curse');
near(t.durationOf(curse, { wis: 50 }), 2.5, 'no WIS over the floor');
near(t.durationOf(curse, { wis: 90 }), 4.5, 'forty over the floor is two seconds more');

// A Mystic with that orb keeps Curse up for the share of every cast it lasts.
const build = t.fresh('Mystic');
build.gear.ability.name = 'Imprisonment Orb';
build.boss = raw.bosses.find(b => b.name !== 'Void Entity').name;
const stats = t.statsOf(build).now;
const every = Math.max(orb.mp / (0.5 + 0.06 * stats.wis), orb.cool || 0);
const orbEffects = t.effectsFor(build, stats);
near(orbEffects.up.Curse, Math.min(1, t.durationOf(curse, stats) / every), 'the orb\'s Curse uptime');
assert.equal(orbEffects.from.Curse, 'ability');

// The party's Curse, assumed, is up all the time; the Void Entity shrugs it off.
build.assume = { Curse: true, 'Armor Broken': true };
assert.equal(t.effectsFor(build, stats).up.Curse, 1);
build.boss = 'Void Entity';
const there = t.effectsFor(build, stats);
assert.equal(there.up.Curse, undefined, 'immune to Curse');
assert.equal(there.up['Armor Broken'], undefined, 'immune to Armor Broken');
assert.equal(there.from.Curse, 'immune');

// And the figures follow: the same build does more with a cursed target.
build.boss = raw.bosses.find(b => b.name !== 'Void Entity').name;
build.assume = {};
const plain = t.numbersFor(build, 40).total;
build.assume = { Curse: true };
assert(t.numbersFor(build, 40).total > plain, 'Curse raises damage a second');

console.log('Status effects: ' + catalogue.effects.length + ' described, in step with the Index; '
  + 'Curse, Armor Broken, Exposed, Damaging, Berserk and uptimes model as the wiki says.');
