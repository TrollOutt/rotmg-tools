#!/usr/bin/env node
'use strict';

/*
 * Merge the local combat laboratory into the published Realm Atlas without
 * rebuilding its map, tiles, sprites, or simulation.  The output is a small,
 * lazy-loaded companion to atlas.json: the Atlas keeps its existing spatial
 * grid and idle clock, and only asks for this file when creatures are visible.
 *
 *   node tools/import-atlas-combat.js --source C:/path/to/local-site/generated
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const out = path.join(root, 'web', 'assets', 'atlas');
const sourceArg = process.argv.indexOf('--source');
const source = sourceArg >= 0 ? path.resolve(process.argv[sourceArg + 1] || '') : null;
if (!source || !fs.existsSync(path.join(source, 'combat-data.json'))
  || !fs.existsSync(path.join(source, 'observed-behaviors.json'))) {
  console.error('Usage: node tools/import-atlas-combat.js --source <generated laboratory directory>');
  process.exit(1);
}

const atlas = JSON.parse(fs.readFileSync(path.join(out, 'atlas.json'), 'utf8'));
const combat = JSON.parse(fs.readFileSync(path.join(source, 'combat-data.json'), 'utf8'));
const observed = JSON.parse(fs.readFileSync(path.join(source, 'observed-behaviors.json'), 'utf8'));
const atlasTypes = new Set(atlas.zones.flatMap(zone => (zone.lives || []).map(one => String(one.type))));
const spriteOut = path.join(out, 'combat');
fs.mkdirSync(spriteOut, { recursive: true });

const round = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
const clean = value => Object.fromEntries(Object.entries(value).filter(([, one]) => one !== undefined));
const spriteFiles = new Set();

function visualOf(visual) {
  if (!visual || !visual.url) return undefined;
  const file = path.basename(visual.url);
  const from = path.join(source, 'combat-sprites', file);
  if (!fs.existsSync(from)) return undefined;
  spriteFiles.add(file);
  return clean({
    file,
    kind: visual.kind,
    width: visual.width,
    height: visual.height,
    frames: visual.frames,
    padding: visual.padding,
    angle: round(visual.angleCorrection),
    rotation: round(visual.rotation)
  });
}

function shotOf(shot) {
  const motion = shot.motion || {};
  return clean({
    id: shot.id,
    slot: shot.slotId === null ? undefined : Number(shot.slotId),
    hurt: round(shot.hurt),
    low: round(shot.low),
    high: round(shot.high),
    fast: round(shot.fast),
    reach: round(shot.reach),
    life: round((shot.lifetimeMs || 0) / 1000),
    many: Math.max(1, Number(shot.many) || 1),
    fan: round(shot.fan),
    rate: round(shot.rate),
    through: shot.through || undefined,
    pierce: shot.pierce || undefined,
    cover: shot.passesCover || undefined,
    flags: shot.flags && shot.flags.length ? shot.flags : undefined,
    motion: clean({
      acceleration: round(motion.Acceleration && motion.Acceleration / 10),
      accelerationDelay: round(motion.AccelerationDelay && motion.AccelerationDelay / 1000),
      speedClamp: round(motion.SpeedClamp && motion.SpeedClamp / 10),
      amplitude: round(motion.Amplitude),
      frequency: round(motion.Frequency),
      magnitude: round(motion.Magnitude),
      size: round(motion.Size),
      turnRate: round(motion.TurnRate),
      turnDelay: round(motion.TurnRateDelay && motion.TurnRateDelay / 1000),
      turnAcceleration: round(motion.TurnAcceleration),
      turnAccelerationDelay: round(motion.TurnAccelerationDelay && motion.TurnAccelerationDelay / 1000),
      turnClamp: round(motion.TurnClamp),
      turnStop: round(motion.TurnStopTime && motion.TurnStopTime / 1000)
    }),
    visual: visualOf(shot.visual)
  });
}

function segments(clip) {
  if (!clip.discontinuous) return [clip];
  const result = [];
  let start = 0;
  for (let i = 1; i <= clip.points.length; i++) {
    const a = clip.points[i - 1], b = clip.points[i];
    if (b && !b.break && b.t - a.t <= 2 && b.t >= a.t) continue;
    const from = clip.points[start].t, to = b ? a.t : clip.duration;
    const attacks = clip.attacks.filter(one => one.t >= from && one.t <= to)
      .map(one => ({ ...one, t: one.t - from }));
    if (attacks.length) result.push({
      ...clip, id: clip.id + ':' + start, duration: Math.max(0.05, to - from),
      discontinuous: false,
      points: clip.points.slice(start, i).map(one => ({ ...one, t: one.t - from, break: false })),
      attacks
    });
    start = i;
  }
  return result;
}

function clipOf(clip, attacks) {
  const bySlot = new Map(attacks.map(one => [String(one.slot) + '|' + one.id, one]));
  const salvos = clip.attacks.filter(one => bySlot.has(String(one.slot) + '|' + one.projectile));
  if (!salvos.length || !clip.points.length || clip.duration <= 0) return null;
  return {
    id: clip.id,
    duration: round(clip.duration),
    points: clip.points.map(one => [round(one.t), round(one.x), round(one.y)]),
    attacks: salvos.map(one => [round(one.t), one.slot, one.count, round(one.angle),
      round(one.gap), round(one.x), round(one.y), round(one.damage), one.projectile])
  };
}

const enemies = {};
const clips = {};
for (const type of [...atlasTypes].sort((a, b) => Number(a) - Number(b))) {
  const sourceEnemy = combat.enemies[type];
  if (!sourceEnemy) continue;
  const attacks = (sourceEnemy.attacks || []).map(shotOf);
  enemies[type] = { attacks };
  const sourceObserved = observed.types[type];
  if (!sourceObserved) continue;
  const usable = sourceObserved.clips.flatMap(segments).map(one => clipOf(one, attacks)).filter(Boolean);
  if (usable.length) clips[type] = usable;
}

const equipmentByName = new Map();
for (const item of combat.equipment) {
  if (!equipmentByName.has(item.name)) equipmentByName.set(item.name, item);
}
const folk = {};
for (const kind of atlas.folk) {
  const entry = {};
  for (const slot of ['weapon', 'ability']) {
    const item = equipmentByName.get(kind[slot] && kind[slot].name);
    if (item && item.projectiles && item.projectiles.length) entry[slot] = item.projectiles.map(shotOf);
  }
  if (Object.keys(entry).length) folk[kind.name] = entry;
}

function reactorOf(type) {
  const enemy = combat.enemies[type];
  if (!enemy) return undefined;
  return {
    type: enemy.type,
    name: enemy.name,
    hp: enemy.hp,
    def: enemy.def,
    exp: enemy.entity && enemy.entity.exp,
    size: enemy.entity && enemy.entity.size,
    sprite: visualOf(enemy.animation && enemy.animation.render),
    attacks: (enemy.attacks || []).map(shotOf)
  };
}
const reactors = {
  adept: reactorOf(56341),
  veteran: reactorOf(56342)
};

for (const file of spriteFiles) {
  fs.copyFileSync(path.join(source, 'combat-sprites', file), path.join(spriteOut, file));
}

const payload = {
  schema: 1,
  source: 'local live captures plus client projectile declarations',
  enemies,
  folk,
  reactors,
  observed: clips
};
const json = JSON.stringify(payload);
fs.writeFileSync(path.join(out, 'combat.json'), json + '\n');
const digest = crypto.createHash('sha1').update(json).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(out, 'combat-summary.json'), JSON.stringify({
  schema: 1,
  digest,
  enemies: Object.keys(enemies).length,
  observed: Object.keys(clips).length,
  clips: Object.values(clips).reduce((sum, one) => sum + one.length, 0),
  folk: Object.keys(folk).length,
  reactors: Object.values(reactors).filter(Boolean).length,
  attacks: Object.values(enemies).reduce((sum, one) => sum + one.attacks.length, 0),
  sprites: spriteFiles.size,
  bytes: Buffer.byteLength(json)
}, null, 2) + '\n');
console.log('  combat: ' + Object.keys(enemies).length + ' creatures, '
  + Object.keys(clips).length + ' observed, ' + spriteFiles.size + ' projectile sprites');
console.log('  -> ' + path.relative(root, path.join(out, 'combat.json')) + ' ('
  + Math.round(Buffer.byteLength(json) / 1024) + ' KiB, loaded only while watching life)');
