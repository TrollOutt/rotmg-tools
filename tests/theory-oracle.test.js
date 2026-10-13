'use strict';
/*
 * Theory Crafting against sources that are not Theory Crafting.
 *
 * The engine's own tests check it against itself. These check it against what
 * the game does: RealmEye's published worked examples, which give every step of
 * a calculation, and - where the installed client's extraction is present - a
 * calculation made directly from the client's XML.
 */
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const raw = JSON.parse(read('data/TheoryCraft/theorycraft.json'));
const statuses = JSON.parse(read('web/assets/index/status-effects.json'));
const t = require('./theory-harness')({ statusText: JSON.stringify(statuses) }, raw, false);
t.setStatusInfo({ byName: new Map(statuses.effects.map(e => [e.name, e])), immune: new Map(), sheet: statuses.sheet });
const near = (got, want, tolerance, what) => assert(Math.abs(got - want) <= tolerance, `${what}: ${got} is not ${want} (+/- ${tolerance})`);

/* ---------------- life and magic a second ---------------- */
// RealmEye, Character Stats (out of combat) and Highest Stats (in combat; Healing adds 20 to life).
const regen = (vit, wis, from = {}, assume) => t.regenOf({ now: { vit, wis, hp: 700, mp: 400 }, from: { regen: from } }, assume);
near(regen(40, 0).hp.calm, 11.63, 0.01, '40 VIT out of combat');
near(regen(75, 0).hp.calm, 20.05, 0.01, '75 VIT out of combat');
near(regen(0, 50).mp.calm, 6.5, 0.001, '50 WIS out of combat');
near(regen(0, 75).mp.calm, 9.5, 0.001, '75 WIS out of combat');
near(regen(153, 0).hp.combat, 19.41, 0.01, '153 VIT in combat');
near(regen(153, 0, {}, { Healing: true }).hp.combat, 39.41, 0.01, '153 VIT in combat, Healing');
near(regen(0, 135).mp.combat, 8.6, 0.001, '135 WIS in combat');
near(regen(0, 191).mp.combat, 11.96, 0.001, '191 WIS in combat');
// A ring of Transcendent Vitality (+11 VIT) gives 2.64 HP/s, and Transcendent Wisdom (+11 WIS) 1.32 MP/s, out of combat.
near(regen(11, 0).hp.calm - regen(0, 0).hp.calm, 2.64, 0.01, 'Ring of Transcendent Vitality');
near(regen(0, 11).mp.calm - regen(0, 0).mp.calm, 1.32, 0.001, 'Ring of Transcendent Wisdom');
// Enchantments that add regeneration say "doubled while out of combat": the client's figure is the combat one.
assert.equal(regen(0, 0, { flatHP: 10 }).bonus.hp, 10);
near(regen(0, 0, { flatHP: 10 }).hp.calm - regen(0, 0).hp.calm, 20, 1e-9, 'Flat Life Regeneration IV out of combat');
assert.equal(regen(0, 0, { partMP: 0.015 }).bonus.mp, 6, '1.5% of 400 MP');
// Time in combat: 7 seconds less 0.04 for each VIT, never under one.
assert.deepEqual([0, 75, 150, 300].map(v => regen(v, 0).inCombat), [7, 4, 1, 1]);

// And through the engine: the enchantments a build wears reach the figure.
{
  const state = t.fresh('Wizard');
  const flat = raw.enchants.find(e => e.id === 'Flat_Life_Regen_4'), part = raw.enchants.find(e => e.id === 'Percentage_Mana_Regen_4');
  assert(flat && part, 'the regeneration enchantments are in the data');
  const bare = t.regenOf(t.statsOf(state), state.assume);
  state.gear.armor.ench[0] = flat.id; state.gear.ring.ench[0] = part.id;
  t.use(state);
  const worn = t.regenOf(t.statsOf(state), state.assume);
  near(worn.hp.combat - bare.hp.combat, 10, 1e-9, 'a worn Flat Life Regeneration IV');
  near(worn.mp.combat - bare.mp.combat, 0.015 * t.statsOf(state).now.mp, 1e-9, 'a worn Percentage Mana Regeneration IV');
}

/* ---------------- damage a second: RealmEye's worked example ---------------- */
// "Highest Damage Per Second": a five-shot bow of 95-139 at a rate of 0.75, ATT 89, DEX 71, with Damaging, Exposed, Curse and Berserk.
{
  const bow = { name: 'RealmEye bow', hand: 'weapon', shots: [{ low: 95, high: 139, many: 5 }], rate: 0.75, many: 5 };
  const fx = t.fxOf({ up: { Damaging: 1, Exposed: 1, Curse: 1, Berserk: 1 }, from: {}, bleed: 0, immune: new Set() });
  const one = t.weaponRate(bow, { att: 89, dex: 71 }, 0, null, null, fx);
  near(one.each, 441.815, 0.01, 'damage of one shot');
  near(one.rate, 7.175, 0.001, 'shots a second');
  near(one.dps, 15850.1, 1, 'damage a second');
  const quick = t.weaponRate({ ...bow, shots: [{ low: 95, high: 140, many: 5 }] }, { att: 131, dex: 144 }, 0, null, null, fx);
  near(quick.dps, 39174.5, 2, 'damage a second with temporary boosts');
}
// DEX 90 is 9.3 shots a second; ATT 96 is a multiplier of 2.42.
near(t.weaponRate({ shots: [{ low: 1000, high: 1000 }], rate: 1 }, { att: 96, dex: 90 }, 0).rate, 9.3, 1e-9, 'DEX 90');
near(t.weaponRate({ shots: [{ low: 1000, high: 1000 }], rate: 1 }, { att: 96, dex: 90 }, 0).each, 2420, 1e-9, 'ATT 96');

/* ---------------- what gear costs and adds (tools/build-gear-effects.js) ---------------- */
const gear = JSON.parse(read('web/assets/index/gear-effects.json'));
t.setGearInfo(new Map(Object.entries(gear.items)));
// What the client states, for the items the audit looked at by hand.
assert.deepEqual(gear.items.Valor.combat, { ATT: -10 });
assert.deepEqual(gear.items.Warmonger.combat, { DEX: -5 });
assert.deepEqual(gear.items['Dusky Catalyst'], { cost: 0.95, combat: { WIS: -10 } });
assert.equal(gear.items['Robe of the Mad Scientist'].cost, 0.85);
assert.deepEqual(gear.items['Fire Blade'].procs, [{ on: 'shoot', proc: 1, cooldown: 3, kind: 'poison', total: 1000, impact: 0, duration: 6 }]);
assert.equal(Object.values(gear.items).filter(x => x.combat).length, 8, 'eight items cost you something in combat');
assert.equal(Object.values(gear.items).filter(x => x.cost).length, 15, 'fifteen items make abilities cheaper');
for (const name of Object.keys(gear.items)) assert(raw.items.some(i => i.name === name), name + ' is an item the bench offers');
{
  // A fight is in combat: Valor's ten attack comes off the shots, while the character's own statistics keep it.
  const valor = raw.items.find(i => i.name === 'Valor');
  const klass = raw.classes.find(c => t.itemsFor(valor.hand, c.name).some(i => i.name === 'Valor'));
  assert(klass, 'some class can wear Valor');
  const state = t.fresh(klass.name);
  state.gear[valor.hand].name = 'Valor';
  t.use(state);
  const stats = t.statsOf(state), fought = t.fightOf(state, stats);
  assert.equal(fought.now.att, Math.max(0, stats.now.att - 10), 'ten attack off in combat');
  assert.equal(stats.now.att, t.statsOf(state).now.att, 'the character keeps its own statistic');
  // The same weapon with the character's own attack, against what the fight uses: the ratio is the two multipliers'.
  const shot = t.numbersFor(state, 0).gun.each;
  const bare = t.weaponRate(raw.items.find(i => i.name === state.gear.weapon.name), stats.now, 0).each;
  near(shot / bare, (0.5 + fought.now.att / 50) / (0.5 + stats.now.att / 50), 1e-9, 'a shot with ten attack less');
}
// An ability discount is a multiplier and several of them multiply.
assert.equal(t.costOf({ gear: { weapon: { name: 'Dusky Catalyst' }, ability: { name: 'Robe of the Mad Scientist' }, armor: {}, ring: {} } }), 0.95 * 0.85);
// A grenade of poison thrown at every shot with a three second cooldown: 1000 every 3 seconds and the wait for a shot.
{
  const state = { gear: { weapon: { name: 'Fire Blade' }, ability: {}, armor: {}, ring: {} } };
  const goes = 1 / (3 + 1 / (1 * 8)), special = t.specialsOf(state, { att: 75, dex: 75 }, 0, 8);
  near(special.low, 1000 * goes, 1e-6, 'Fire Blade grenade a second');
  assert.equal(special.low, special.high, 'poison does not depend on attack');
  near(special.low, 320, 0.5, 'about a tenth of the weapon, as RealmEye\'s 1000 damage every 3 seconds says');
}

// Primal Arcana, which RealmEye describes as 8 shots of 300-400 and "2 / 3 more bullets, each dealing 100-120
// (+1 per 2 DEX over 60), cooldown 0.2 / 0, ignoring defense": the orb and the bolts it makes the weapon throw.
{
  const arcana = gear.items['Primal Arcana'].procs;
  assert.equal(arcana.length, 3, 'three bolts');
  for (const p of arcana) assert.deepEqual([p.low, p.high, p.pierce, p.reach, p.by, p.from, p.per, p.shots], [100, 120, true, 8.75, 'DEX', 60, 0.5, 1]);
  assert.deepEqual(arcana.map(p => [p.proc, p.cooldown]), [[1, 0.2], [1, 0.2], [0.33, 0]]);
  const item = raw.items.find(i => i.name === 'Primal Arcana');
  assert.equal(item.cast.shots, 8, 'eight shots of the orb');
  const state = { gear: { weapon: {}, ability: { name: 'Primal Arcana' }, armor: {}, ring: {} } };
  const stats = { att: 75, dex: 78 }, shots = 8.26, bolt = 110 + 0.5 * (78 - 60);
  const want = [[1, 0.2], [1, 0.2], [0.33, 0]].reduce((all, [proc, cooldown]) => all + bolt / (cooldown + 1 / (proc * shots)), 0);
  near(t.specialsOf(state, stats, 0, shots).low, want, 1e-6, 'bolts a second');
  assert.equal(t.specialsOf(state, stats, 1000, shots).low, t.specialsOf(state, stats, 0, shots).low, 'they ignore defense');
}
// A bolt that needs another item is counted only when it is worn: the Interregnum Longbow with its ring.
{
  const longbow = gear.items['Frangible Longbow'].procs, ring = longbow[0].needs.wear[0];
  assert.equal(ring, 'Sunken Fire Opal Ring');
  const plain = { gear: { weapon: { name: 'Frangible Longbow' }, ability: {}, armor: {}, ring: {} } };
  const withRing = { gear: { weapon: { name: 'Frangible Longbow' }, ability: {}, armor: {}, ring: { name: ring } } };
  assert.equal(t.specialsOf(plain, { att: 75, dex: 75 }, 0, 8).list.length, 0, 'nothing without the ring');
  assert(t.specialsOf(withRing, { att: 75, dex: 75 }, 0, 8).high > 0, 'bolts with the ring');
}
// What needs a status: a fight is in combat, and Damaging counts only when the build or the party keeps it up.
{
  const mine = name => ({ gear: { weapon: { name }, ability: {}, armor: {}, ring: {} } });
  assert(t.specialsOf(mine('Flames of Genesis'), { att: 75, dex: 75 }, 0, 8).high > 0, 'needs only combat: counted');
  const kunai = gear.items['Combcutter Kunai'].procs.find(p => p.needs.status.includes('Damaging') && !p.needs.other);
  assert(kunai, 'the Kunai bolt that needs Damaging');
  assert.equal(t.specialsOf(mine('Combcutter Kunai'), { att: 75, dex: 75, vit: 75 }, 0, 8).list.filter(x => x.kind === 'bullets').length, 0, 'without Damaging it does not count');
  assert(t.specialsOf(mine('Combcutter Kunai'), { att: 75, dex: 75, vit: 75 }, 0, 8, { Damaging: 1 }).high > 0, 'with Damaging it does');
}
assert(/function procRows/.test(read('web/fiches-c.js')) && read('web/fiches-c.js').includes('RealmGearEffects'), 'the card says what a piece throws');

/* ---------------- an ability is not raised by attack ---------------- */
// Fire Spray Spell, from its XML: 16 bolts of 20-25, +0.5 damage and +0.0667 bolts for each WIS over 42; 20 magic.
{
  const spell = raw.items.find(i => i.name === 'Fire Spray Spell');
  const at = (att, wis) => t.abilityRate(spell, { att, wis }, 0, null, 100);   // plenty of magic: the cost is not the limit
  near(at(0, 60).each, (20 + 25) / 2 + 0.5 * (60 - 42), 1e-9, 'a bolt at 60 WIS');
  assert.equal(at(0, 60).each, at(75, 60).each, '"Attack does not affect ability damage" (RealmEye, Character Stats)');
  assert.equal(at(75, 60).many, Math.round(16 + 0.0667 * (60 - 42)), 'the bolts a cast throws');
  near(at(75, 42).each, 22.5, 1e-9, 'no scaling at the floor of the stat');
}

/* ---------------- abilities that are not bolts, as RealmEye words them ---------------- */
{
  const cast = (name, wis, def = 0) => t.abilityRate(raw.items.find(i => i.name === name), { att: 75, wis }, def, null, 100).hits;
  // Spider Venom: "Impact Damage 100 (+0.8 per WIS over 50)", "Damage Over Time 200 (+5.2 per WIS over 50)"; poison ignores defense.
  near(cast('Spider Venom', 80).total, (100 + 0.8 * 30) + (200 + 5.2 * 30), 1e-9, 'poison and its impact');
  near(cast('Spider Venom', 80, 40).total, Math.max(124 - 40, 124 * 0.15) + 356, 1e-9, 'only the impact is cut by defense');
  // Discharge Scepter: "Damage 120 (+2.5 per WIS over 50)" and "Shockblast Damage 30 (+1.2 per WIS over 50)" for the first target.
  near(cast('Discharge Scepter', 70).total, (120 + 2.5 * 20) + (30 + 1.2 * 20), 1e-9, 'a chain and its shockblast');
  // Hunting Trap: "Damage 65 (+5 per WIS over 34)", "Sticky Bomb Damage 150 (+5 per WIS over 34)".
  near(cast('Hunting Trap', 44).total, (65 + 50) + (150 + 50), 1e-9, 'a trap and its bomb');
  // Healing Tome: "Explodes 2 times ... Damage 160 (+4.8 per WIS over 70)".
  near(cast('Healing Tome', 80).total, 2 * (160 + 4.8 * 10), 1e-9, 'a nova that explodes twice');
  const spider = raw.items.find(i => i.name === 'Spider Venom');
  assert(t.abilityRate(spider, { att: 75, wis: 80 }, 0, null, 100).dps > 0, 'a poison is an ability with a damage a second');
}

/* ---------------- every weapon against the client's own XML ---------------- */
const oracle = require('./theory-oracle');
if (!oracle.available()) {
  console.log('Theory oracle: RealmEye examples and regeneration hold; the weapon check against the client XML is skipped (no client-data/ here).');
} else {
  const index = JSON.parse(read('data/Index/index.json'));
  const byName = new Map(index.records.filter(r => r.kind === 'item' && !r.folded).map(r => [r.name, r]));
  const objects = oracle.load();
  const points = [[0, 0, 0], [50, 50, 20], [75, 75, 50], [100, 150, 100], [75, 75, 5], [60, 40, 200]];
  let compared = 0;
  const off = [];
  for (const item of raw.items) {
    if (item.hand !== 'weapon' || !item.shots || !item.shots.length) continue;
    const record = byName.get(item.name);
    const body = record && (objects.get(record.clientId) || objects.get(record.alias) || objects.get(record.name));
    if (!body) continue;                      // an engine-only variant such as "(SB)"
    const channels = oracle.channelsOf(body);
    if (!channels.length) continue;
    compared++;
    for (const [att, dex, def] of points) {
      const mine = oracle.dps(channels, att, dex, def), theirs = t.weaponRate(item, { att, dex }, def, null, null, null).dps;
      if (Math.abs(mine - theirs) > 0.002 * Math.max(1, mine)) { off.push(`${item.name} at ATT ${att} DEX ${dex} DEF ${def}: client ${mine.toFixed(1)}, engine ${theirs.toFixed(1)}`); break; }
    }
  }
  assert(compared > 500, `the check should reach most weapons, it reached ${compared}`);
  assert.deepEqual(off, [], 'weapons whose damage a second the engine does not reproduce from the client:\n' + off.join('\n'));

  /*
   * Whole builds. A class, its four pieces, a level, exaltations or not: the
   * engine's damage a second and life and magic a second against a calculation
   * that reads the client's XML for the weapon and for what the worn gear costs
   * in combat, and applies the game's formulas to the result. The statistics
   * the two share are the engine's own (they were checked piece by piece
   * against the client's classes, items and sets), so what is tested here is
   * how they are put together.
   */
  t.setStatusInfo(null);                       // no status effects: the oracle does not model them
  let seed = 20261012;
  const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = list => list[Math.floor(next() * list.length)];
  const STAT = { ATT: 'att', DEF: 'def', SPD: 'spd', DEX: 'dex', VIT: 'vit', WIS: 'wis', MAXHP: 'hp', MAXMP: 'mp' };
  const body = name => { const r = byName.get(name); return r && (objects.get(r.clientId) || objects.get(r.alias) || objects.get(r.name)); };
  // What the client says a worn piece costs in combat: a flat penalty on a stat, with nothing else conditioning it.
  const penalties = names => {
    const out = {};
    for (const name of names) {
      const xml = name && body(name);
      for (const m of (xml || '').matchAll(/<OnPlayerShootActivate\b([^>]*)>StatBoostSelf<\/OnPlayerShootActivate>/g)) {
        const a = Object.fromEntries([...m[1].matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
        if (a.requiredConditions === 'In Combat' && STAT[a.stat] && !Object.keys(a).some(k => /^(hp[A-Z]|mustWear|minimumMeter)/.test(k))) out[STAT[a.stat]] = (out[STAT[a.stat]] || 0) + Number(a.amount);
      }
    }
    return out;
  };
  let builds = 0;
  const wrong = [];
  // One build, against the oracle: false when it cannot be judged (a weapon the client files do not describe).
  const check = (state, def) => {
    t.use(state);
    const weapon = raw.items.find(i => i.name === state.gear.weapon.name);
    const xml = weapon && body(weapon.name);
    const channels = xml ? oracle.channelsOf(xml) : [];
    if (!channels.length) return false;
    const stats = t.statsOf(state), fight = { ...stats.now };
    const worn = ['weapon', 'ability', 'armor', 'ring'].map(h => state.gear[h].name);
    for (const [key, amount] of Object.entries(penalties(worn))) fight[key] = Math.max(0, fight[key] + amount);
    const ours = t.numbersFor(state, def);
    const mine = oracle.dps(channels, fight.att, fight.dex, def);
    const hp = (2 + 0.2407 * fight.vit) / 2, mp = 0.5 + 0.06 * fight.wis;
    const problems = [];
    if (Math.abs(ours.gun.dps - mine) > 0.002 * Math.max(1, mine)) problems.push(`damage a second ${ours.gun.dps.toFixed(1)} versus ${mine.toFixed(1)}`);
    if (Math.abs(ours.regen.hp.combat - hp) > 1e-6) problems.push(`life a second in combat ${ours.regen.hp.combat} versus ${hp}`);
    if (Math.abs(ours.regen.mp.combat - mp) > 1e-6) problems.push(`magic a second in combat ${ours.regen.mp.combat} versus ${mp}`);
    if (Math.abs(ours.regen.hp.calm - (2 + 0.2407 * stats.now.vit)) > 1e-6) problems.push('life a second out of combat');
    if (Math.abs(ours.regen.mp.calm - (0.5 + 0.12 * stats.now.wis)) > 1e-6) problems.push('magic a second out of combat');
    builds++;
    if (problems.length) wrong.push(`${state.klass} level ${state.level} with ${worn.join(' / ')} against DEF ${def}: ${problems.join('; ')}`);
    return true;
  };
  for (let n = 0; n < 400; n++) {
    const klass = pick(raw.classes);
    const state = t.fresh(klass.name);
    state.maxed = next() < 0.6; state.exalt = next() < 0.6; state.level = state.maxed ? 20 : 1 + Math.floor(next() * 20);
    for (const hand of ['weapon', 'ability', 'armor', 'ring']) {
      const pool = t.itemsFor(hand, klass.name);
      if (pool.length) state.gear[hand].name = pick(pool).name;
    }
    check(state, pick([0, 15, 40, 100]));
  }
  // And each piece that costs you in combat, worn: the random builds seldom reach the eight.
  let costly = 0;
  for (const [name, effects] of Object.entries(gear.items)) {
    if (!effects.combat) continue;
    const item = raw.items.find(i => i.name === name);
    const klass = raw.classes.find(c => t.itemsFor(item.hand, c.name).some(i => i.name === name));
    assert(klass, name + ' can be worn by some class');
    const state = t.fresh(klass.name);
    state.gear[item.hand].name = name;
    if (check(state, 0)) costly++;
    assert.notDeepEqual(penalties([name]), {}, name + ' costs something in combat in the client XML');
  }
  assert(costly >= 5, 'the pieces that cost you in combat were judged, ' + costly);
  assert(builds > 300, `the build check should reach most builds, it reached ${builds}`);
  assert.deepEqual(wrong, [], 'builds the engine does not reproduce:\n' + wrong.slice(0, 15).join('\n'));
  console.log(`Theory oracle: ${compared} weapons reproduced from the client XML at six stat points, and ${builds} whole builds (class, level, exaltation, four pieces) in damage, life and magic a second; RealmEye's worked examples hold.`);
}
