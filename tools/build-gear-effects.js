#!/usr/bin/env node
'use strict';
/*
 * What gear does that is not a projectile or a statistic, read off the client.
 *
 *   node tools/build-gear-effects.js
 *
 * Three things the engine needs and the Index does not carry:
 *
 *   combat   the penalties an item puts on you while you are in combat
 *            (<OnPlayerShootActivate ... stat="ATT" amount="-10"
 *            requiredConditions="In Combat">StatBoostSelf). Valor takes ten
 *            attack, Warmonger five dexterity, Dusky Catalyst ten wisdom, and a
 *            fight is in combat, so a fight is fought with them.
 *   cost     what a worn item does to the magic an ability costs
 *            (<ActivateOnEquip multiplier="0.95">AbilityUseDiscount).
 *   procs    damage an item adds that no projectile of its own carries: a
 *            grenade of poison, or bolts the game throws when you shoot or when
 *            a shot lands, with the chance and the cooldown the client states,
 *            what each bolt does (read off the object it names: its damage, whether
 *            it ignores defense, how far it goes) and what it takes to be on.
 *
 * Every proc is written down, so a card can say what an item does, and each
 * says what it needs: items worn with it, statuses, a meter, life under a
 * threshold. The engine counts the ones whose condition is the worn gear and
 * leaves the others to be said, not guessed at.
 *
 * Writes web/assets/index/gear-effects.json beside the other Index extras. It
 * needs the installed client's extraction, so it runs inside `npm run
 * index-extras`.
 */
const fs = require('fs');
const path = require('path');
const client = require('./client-objects');

const root = path.join(__dirname, '..');
const INDEX = path.join(root, 'data', 'Index', 'index.json');
const OUT = path.join(root, 'web', 'assets', 'index', 'gear-effects.json');

const STATS = new Set(['ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS', 'MAXHP', 'MAXMP']);
// An attribute that says "only when" and that the worn gear cannot answer: a status, a meter, life under a threshold.
const OTHER_CONDITION = /^(requiredCond|minimumMeter|meterCost|idMeter|hp[A-Z]|damageThreshold)/;
const num = (s, d) => (s === undefined || s === '' || isNaN(Number(s)) ? d : Number(s));
const hexes = text => String(text || '').split(/[;,]/).map(x => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

/* What a bolt the game throws is: the damage of the projectile of the object it names. */
function boltOf(a, objects) {
  const made = objects.byType.get(Number(a.type));
  const shot = made && /<Projectile\b[^>]*>([\s\S]*?)<\/Projectile>/.exec(made.body);
  if (!shot) return null;
  const p = shot[1], damage = num(client.tag(p, 'Damage'), 0);
  const low = num(client.tag(p, 'MinDamage'), damage), high = num(client.tag(p, 'MaxDamage'), damage);
  if (!(high > 0)) return null;
  // The speed it flies at is the clamp when it is made to slow down at once (-2147483648 is "as much as it takes").
  const speed = num(client.tag(p, 'Speed'), 0), clamp = num(client.tag(p, 'SpeedClamp'), 0), slows = num(client.tag(p, 'Acceleration'), 0) < 0 && num(client.tag(p, 'AccelerationDelay'), 0) === 0;
  const flies = (clamp && slows ? Math.min(speed, clamp) : speed) / 10;
  const reach = Math.round(flies * num(client.tag(p, 'LifetimeMS'), 0) / 1000 * 100) / 100;
  return { low, high, ...(/<ArmorPiercing\b/.test(p) ? { pierce: true } : {}), ...(reach ? { reach } : {}) };
}

/*
 * What an ability does besides throw bolts, as parts that are each a base and what a stat adds above a floor.
 * The client states the scaling in its own units, which are not the same from one verb to the next; each is
 * brought to damage per point of the stat, the way RealmEye prints it (checked against every page it has):
 *   Lightning   wisDamageBase/10 a point for the chain, statModDamage/10 for its shockblast
 *   Trap        statModTrapDamage and statModBombDamage a point
 *   Poison      (statModDamage - statModImpactDamage)/10 for the poison, statModImpactDamage/10 for the impact
 *   Nova        statModDamage a point, each time it explodes
 */
function abilityOf(body) {
  const parts = [];
  for (const m of body.matchAll(/<Activate\b([^>]*)>([^<]*)<\/Activate>/g)) {
    const kind = m[2].trim(), a = client.attributes(m[1]);
    const grows = { by: a.scalingStat || 'WIS', from: num(a.statModScalingMin, 0) };
    const part = (name, low, high, per, extra) => parts.push({ kind: name, low, high, ...(per ? { per: +per.toFixed(4), ...grows } : {}), ...extra });
    if (kind === 'Lightning' && Number(a.totalDamage) > 0) {
      part('lightning', Number(a.totalDamage), Number(a.totalDamage), num(a.wisDamageBase, 0) / 10, { targets: num(a.maxTargets, 1), falls: num(a.decrDamage, 0) });
      if (Number(a.aoeDamage) > 0) part('shockblast', Number(a.aoeDamage), Number(a.aoeDamage), num(a.statModDamage, 0) / 10, { pierce: a.aoeArmorPierce === 'true', count: num(a.aoeActivationCount, 1) });
    } else if (kind === 'Trap' && Number(a.totalDamage) > 0) {
      part('trap', Number(a.totalDamage), Number(a.totalDamage), num(a.statModTrapDamage, 0));
      if (Number(a.bombDamage) > 0) part('bomb', Number(a.bombDamage), Number(a.bombDamage), num(a.statModBombDamage, 0), { count: num(a.bombTriggerCount, 1) });
    } else if (kind === 'PoisonGrenade' && Number(a.totalDamage) > 0) {
      const impact = num(a.impactDamage, 0), total = Number(a.totalDamage), grow = num(a.statModDamage, 0), grow0 = num(a.statModImpactDamage, 0);
      if (impact) part('impact', impact, impact, grow0 / 10);
      part('poison', total - impact, total - impact, (grow - grow0) / 10, { pierce: true, duration: num(a.duration, 0) });
    } else if (kind === 'DamageNova' && Number(a.maxDamage) > 0) {
      part('nova', num(a.minDamage, 0), Number(a.maxDamage), num(a.statModDamage, 0), { count: num(a.activationCount, 1) });
    }
  }
  return parts;
}

function effectsOf(body, objects, nameOfType, count) {
  const out = {};
  const ability = abilityOf(body);
  if (ability.length) out.ability = ability;
  for (const m of body.matchAll(/<(OnPlayerShootActivate|OnEnemyHitActivate|ActivateOnEquip)\b([^>]*)>([^<]*)<\/\1>/g)) {
    const on = m[1], kind = m[3].trim(), a = client.attributes(m[2]);
    if (on === 'ActivateOnEquip') {
      if (kind === 'AbilityUseDiscount' && Number(a.multiplier) > 0) out.cost = (out.cost || 1) * Number(a.multiplier);
      continue;
    }
    if (kind === 'StatBoostSelf' && a.requiredConditions === 'In Combat' && STATS.has(a.stat)) {
      // Only the plain combat penalty; one that also needs life under a threshold is another thing.
      if (Object.keys(a).some(k => OTHER_CONDITION.test(k) && k !== 'requiredConditions')) { count.other++; continue; }
      (out.combat || (out.combat = {}))[a.stat] = (out.combat[a.stat] || 0) + Number(a.amount);
      continue;
    }
    if (kind !== 'PoisonGrenade' && kind !== 'BulletCreate') continue;
    // What it takes: other things worn with it (named here), or something this file cannot know.
    const needs = {};
    const named = list => hexes(list).map(t => nameOfType(t)).filter(Boolean);
    if (a.mustWear) needs.wear = named(a.mustWear);
    if (a.mustWearOR) needs.wearAny = named(a.mustWearOR);
    if (a.mustNotWear || a.mustNotWearOR) needs.notWear = named(a.mustNotWear).concat(named(a.mustNotWearOR));
    // Statuses the character must have (or not have) are said by name; a meter or life left is only said.
    const list = text => String(text || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
    if (a.requiredConditions) needs.status = list(a.requiredConditions);
    if (a.requiredConditionsNOR) needs.notStatus = list(a.requiredConditionsNOR);
    if (Object.keys(a).some(k => /^(minimumMeter|meterCost|idMeter|hp[A-Z]|damageThreshold)/.test(k))) {
      needs.other = [(a.minimumMeter || a.idMeter) && 'with its meter full', Object.keys(a).some(k => /^hp/.test(k)) && 'by how much life you have'].filter(Boolean);
      if (!needs.other.length) needs.other = ['only in some conditions'];
    }
    const base = { on: on === 'OnPlayerShootActivate' ? 'shoot' : 'hit', proc: num(a.proc, 1), cooldown: num(a.cooldown, 0),
      ...(Object.keys(needs).length ? { needs } : {}) };
    if (kind === 'PoisonGrenade') {
      if (!(Number(a.totalDamage) > 0)) continue;
      (out.procs || (out.procs = [])).push({ ...base, kind: 'poison', total: Number(a.totalDamage), impact: num(a.impactDamage, 0), duration: num(a.duration, 0) });
    } else {
      const bolt = boltOf(a, objects);
      if (!bolt) { count.noProjectile++; continue; }
      (out.procs || (out.procs = [])).push({ ...base, kind: 'bullets', shots: num(a.numShots, 1), ...bolt,
        ...(Number(a.statModDamage) ? { by: a.scalingStat, from: num(a.statModScalingMin, 0), per: Number(a.statModDamage) } : {}) });
    }
  }
  return out;
}

function main() {
  if (!client.available()) throw new Error('No client-data/: extract the installed client first (npm run extract-client-data).');
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const objects = client.load();
  // A hexadecimal type to the name the Index and the bench know the item by.
  const byClientId = new Map(index.records.filter(r => r.kind === 'item' && r.bench).map(r => [r.clientId || r.alias || r.name, r.name]));
  const nameOfType = type => { const o = objects.byType.get(type); return o && (byClientId.get(o.id) || null); };
  const count = { items: 0, other: 0, noProjectile: 0, missing: 0 };
  const items = {};
  for (const r of index.records) {
    if (r.kind !== 'item' || !r.bench) continue;
    const body = objects.byId.get(r.clientId) || objects.byId.get(r.alias) || objects.byId.get(r.name);
    if (!body) { count.missing++; continue; }
    const found = effectsOf(body, objects, nameOfType, count);
    if (Object.keys(found).length) { items[r.name] = found; count.items++; }
  }
  const sorted = Object.fromEntries(Object.entries(items).sort((a, b) => a[0].localeCompare(b[0])));
  const out = { built: index.built, from: index.from, tool: 'tools/build-gear-effects.js', items: sorted };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  const sum = key => Object.values(sorted).filter(x => x[key]).length;
  const procs = Object.values(sorted).flatMap(x => x.procs || []);
  console.log('  Gear effects: ' + count.items + ' items; ' + sum('combat') + ' with a combat penalty, ' + sum('cost')
    + ' with an ability discount, ' + sum('procs') + ' with a proc (' + procs.length + ', of which ' + procs.filter(p => p.needs && p.needs.other).length
    + ' need a meter or life left, ' + procs.filter(p => p.needs && (p.needs.wear || p.needs.wearAny || p.needs.notWear)).length + ' depend on what else is worn).');
  if (count.other) console.log('  (' + count.other + ' combat penalties that also depend on life left out)');
  if (count.missing) console.log('  (' + count.missing + ' bench items have no object in the client files)');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { effectsOf, abilityOf };
