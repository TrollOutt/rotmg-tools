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
  // The picture is filed under the projectile's object id (tools/theory-sprites.js cuts it under "p:" + id).
  const art = /<ObjectId>([^<]+)<\/ObjectId>/.exec(p);
  return { low, high, ...(/<ArmorPiercing\b/.test(p) ? { pierce: true } : {}), ...(reach ? { reach } : {}), ...(art ? { art: 'p:' + art[1].trim() } : {}) };
}

/* The projectile an object we are told to make shoots with (a summoned undead, a rat). */
function shotOfObject(objects, id) {
  const made = objects && objects.byId.get(id);
  const shot = made && /<Projectile\b[^>]*>([\s\S]*?)<\/Projectile>/.exec(made);
  if (!shot) return null;
  const p = shot[1], damage = num(client.tag(p, 'Damage'), 0);
  const low = num(client.tag(p, 'MinDamage'), damage), high = num(client.tag(p, 'MaxDamage'), damage);
  const leech = /<LeechLife\b[^>]*perc="([\d.]+)"/.exec(p);
  return high > 0 ? { low, high, ...(/<ArmorPiercing\b/.test(p) ? { pierce: true } : {}), ...(leech ? { leech: Number(leech[1]) } : {}) } : null;
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
function abilityOf(body, objects) {
  const parts = [];
  for (const m of body.matchAll(/<(Activate|OnSwitchAbilityActivate)\b([^>]*)>([^<]*)<\/\1>/g)) {
    const kind = m[3].trim(), a = client.attributes(m[2]);
    const grows = { by: a.scalingStat || 'WIS', from: num(a.statModScalingMin, 0) };
    // The colour the client draws the effect in, so the fight can draw it the same.
    const tint = /^(?:0x|#)?([0-9a-fA-F]{6})$/.exec(String(a.color || '').trim());
    const color = tint ? { color: '#' + tint[1].toLowerCase() } : {};
    const part = (name, low, high, per, extra) => parts.push({ kind: name, low, high, ...(per ? { per: +per.toFixed(4), ...grows } : {}), ...color, ...extra });
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
      part('nova', num(a.minDamage, 0), Number(a.maxDamage), num(a.statModDamage, 0), { count: num(a.activationCount, 1), radius: num(a.radius, 0) });
    } else if (kind === 'RaiseDead' && a.undeadId) {
      const shot = shotOfObject(objects, a.undeadId);
      if (shot) part('raise', shot.low, shot.high, num(a.statModDamage, 0), { count: num(a.numDead, 1), ...(shot.pierce ? { pierce: true } : {}), ...(shot.leech ? { leech: shot.leech } : {}) });
    } else if (kind === 'SpawnCreep' && a.objectId) {
      const shot = shotOfObject(objects, a.objectId);
      if (shot) part('creep', shot.low, shot.high, num(a.statModDamage, 0), { life: num(a.lifeTime, 0), cost: num(a.summonCost, 0), ...(shot.pierce ? { pierce: true } : {}) });
    } else if (kind === 'VampireBlast' && Number(a.totalDamage) > 0) {
      parts.push({ kind: 'blast', low: Number(a.totalDamage), high: Number(a.totalDamage), per: num(a.wisDamageBase, 0) / 10, by: 'WIS', from: 50, ...color,
        heal: num(a.heal, 0), radius: num(a.radius, 0), ...(num(a.ignoreDef, 0) ? { ignores: num(a.ignoreDef, 0) } : {}), ...(a.minimumMeter ? { meter: Number(a.minimumMeter) } : {}) });
    } else if (kind === 'DetonateHex' && Number(a.baseDamage) > 0) {
      part('hex', Number(a.baseDamage), Number(a.baseDamage), num(a.statModBaseDamage, 0), { stack: num(a.stackDamage, 0), stackPer: num(a.statModStackDamage, 0), share: num(a.stackMultiplier, 0), radius: num(a.radius, 0) });
    } else if (kind === 'Heal' && Number(a.amount) > 0) {
      part('heal', Number(a.amount), Number(a.amount), num(a.statModAmount, 0));
    }
  }
  const seen = new Set();
  return parts.filter(x => { const k = JSON.stringify(x); return seen.has(k) ? false : seen.add(k); });
}

function effectsOf(body, objects, nameOfType, count) {
  const out = {};
  const ability = abilityOf(body, objects);
  if (ability.length) out.ability = ability;
  // A star the Ninja holds and lets go: it costs magic by the second while held and a lump when thrown.
  const end = num(client.tag(body, 'MpEndCost'), 0), held = num(client.tag(body, 'MpCostPerSecond'), 0);
  if (end > 0) out.thrown = { end, ...(held ? { held } : {}) };
  // An ability that raises a statistic of its caster for a while each time it is used.
  for (const m of body.matchAll(/<Activate\b([^>]*)>StatBoostSelf<\/Activate>/g)) {
    const a = client.attributes(m[1]);
    if (STATS.has(a.stat) && Number(a.amount) && num(a.duration, 0) > 0) (out.boosts || (out.boosts = [])).push({ on: 'use', proc: 1, cooldown: 0, stat: a.stat, amount: Number(a.amount), duration: Number(a.duration) });
  }
  for (const m of body.matchAll(/<(OnPlayerShootActivate|OnEnemyHitActivate|OnPlayerAbilityActivate|ActivateOnEquip)\b([^>]*)>([^<]*)<\/\1>/g)) {
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
    if (kind === 'ConditionEffectSelf' && (a.effect === 'Damaging' || a.effect === 'Berserk') && on !== 'OnEnemyHitActivate' && num(a.duration, 0) > 0) {
      // A damage status the piece gives you when you shoot or cast; it multiplies the shots for as long as it is on.
      const needs = needsOf(a, nameOfType);
      (out.statuses || (out.statuses = [])).push({ on: { OnPlayerShootActivate: 'shoot', OnPlayerAbilityActivate: 'ability' }[on], effect: a.effect, duration: Number(a.duration), proc: num(a.proc, 1), cooldown: num(a.cooldown, 0), ...(Object.keys(needs).length ? { needs } : {}) });
      continue;
    }
    if (kind !== 'PoisonGrenade' && kind !== 'BulletCreate' && kind !== 'Magic' && kind !== 'Heal' && kind !== 'StatBoostSelf') continue;
    const needs = needsOf(a, nameOfType);
    const when = { OnPlayerShootActivate: 'shoot', OnEnemyHitActivate: 'hit', OnPlayerAbilityActivate: 'ability' }[on];
    const base = { on: when, proc: num(a.proc, 1), cooldown: num(a.cooldown, 0), ...(Object.keys(needs).length ? { needs } : {}) };
    if (kind === 'Magic' || kind === 'Heal') {
      // Magic or life handed back when it goes off: a share of the regeneration a second.
      if (Number(a.amount) > 0 && on !== 'OnEnemyHitActivate') (out.gains || (out.gains = [])).push({ ...base, give: kind === 'Magic' ? 'mp' : 'hp', amount: Number(a.amount) });
      continue;
    }
    if (kind === 'StatBoostSelf') {
      // A statistic raised for a while each time it goes off (the plain combat penalty above is not one of these).
      if (STATS.has(a.stat) && Number(a.amount) && on !== 'OnEnemyHitActivate') (out.boosts || (out.boosts = [])).push({ ...base, stat: a.stat, amount: Number(a.amount), duration: num(a.duration, 0) });
      continue;
    }
    if (on === 'OnPlayerAbilityActivate' && kind === 'BulletCreate' && !boltOf(a, objects)) continue;
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

/* What it takes for an effect to go off: other things worn with it (named), statuses, and what only the fight knows. */
function needsOf(a, nameOfType) {
  const needs = {};
  const named = list => hexes(list).map(t => nameOfType(t)).filter(Boolean);
  if (a.mustWear) needs.wear = named(a.mustWear);
  if (a.mustWearOR) needs.wearAny = named(a.mustWearOR);
  if (a.mustNotWear || a.mustNotWearOR) needs.notWear = named(a.mustNotWear).concat(named(a.mustNotWearOR));
  const list = text => String(text || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
  if (a.requiredConditions) needs.status = list(a.requiredConditions);
  if (a.requiredConditionsNOR) needs.notStatus = list(a.requiredConditionsNOR);
  const keys = Object.keys(a);
  if (keys.some(k => /^(minimumMeter|meterCost|idMeter|hp[A-Z]|mana[A-Z]|damageThreshold)/.test(k))) {
    needs.other = [(a.minimumMeter || a.idMeter) && 'with its meter full', keys.some(k => /^hp/.test(k)) && 'by how much life you have',
      keys.some(k => /^mana/.test(k)) && 'by how much magic you have'].filter(Boolean);
    if (!needs.other.length) needs.other = ['only in some conditions'];
  }
  return needs;
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
  // Enchantments that make abilities cheaper (<MultiplyMPCost>0.96</MultiplyMPCost>), by id.
  const enchants = {};
  const xml = path.join(root, 'client-data', 'Enchantments.xml');
  if (fs.existsSync(xml)) {
    for (const m of fs.readFileSync(xml, 'utf8').matchAll(/<Enchantment\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Enchantment>/g)) {
      const cost = /<MultiplyMPCost>([\d.]+)<\/MultiplyMPCost>/.exec(m[2]);
      if (cost && Number(cost[1]) > 0) enchants[m[1]] = { mp: Number(cost[1]) };
    }
  }
  // How big each thing worth fighting is, as the distance from its middle to where a shot lands: half its size in tiles
  // (<Size>100</Size> is one tile across), grown by the scale of its custom hitbox where it has one. Shots that
  // fall short of a target are judged against its edge, not its middle.
  const targets = {};
  for (const boss of require('./index-model').project(index).bosses) {
    const body = objects.byId.get(boss.id);
    if (!body) continue;
    const size = num(client.tag(body, 'Size'), 100), hit = /<CustomHitbox\b[^>]*\bscale="([\d.]+)"/.exec(body);
    targets[boss.name] = +(0.5 * (size > 0 ? size : 100) / 100 * (hit ? Number(hit[1]) : 1)).toFixed(3);
  }
  const sorted = Object.fromEntries(Object.entries(items).sort((a, b) => a[0].localeCompare(b[0])));
  const out = { built: index.built, from: index.from, tool: 'tools/build-gear-effects.js', enchants, targets, items: sorted };
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
