'use strict';
// Build-only projection. Never read client files or ship the full Index here.
const fs = require('fs');
const path = require('path');

function projectTraining(index) {
  const classes = index.records.filter(r => r.kind === 'class' && !r.hidden?.length && !r.availability)
    .map(r => ({ id: r.id, name: r.name, slots: r.slots.slice(0, 4), stats: r.stats, clientType: r.from?.[1] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const equipment = [], excluded = [], consumables = [];
  const identity = r => ({ id: r.id, name: r.name, clientId: r.clientId || r.alias || r.name,
    clientType: r.from?.[1], sourceFile: index.files[r.from?.[0]], icon: r.art || null });
  for (const r of index.records) {
    if (r.kind !== 'item' || r.twin || r.folded) continue;
    const protection = (r.conditions || []).filter(c => c.effect === 'Invulnerable' && c.target === 'self');
    const boosts = r.statBoosts || [];
    if (!protection.length && !(r.use && (boosts.length || /^StatBoost(Self|Aura)$/.test(r.activate || '')))) continue;
    const base = identity(r);
    if (r.hidden?.length || r.availability) {
      excluded.push({ ...base, reason: [r.availability, ...(r.hidden || [])].filter(Boolean).join('; ') });
      continue;
    }
    if (r.use) {
      const hp = boosts.filter(b => b.attributes?.stat === 'MAXHP');
      const b = hp[0], a = b?.attributes || {};
      const bonus = Number(a.amount), duration = Number(a.duration);
      const allowed = new Set(['stat', 'amount', 'duration', 'channel']);
      let reason = '';
      if (!boosts.length) reason = 'Index lacks structured stat, amount and duration for this stat boost.';
      else if (!hp.length) reason = 'No temporary MAXHP boost (current HP, VIT and other statistics are excluded).';
      else if (b.on !== 'StatBoostSelf') reason = 'Aura recipients are not established by these XML declarations; caster inclusion is unverified.';
      else if (hp.length !== 1 || boosts.length !== 1 || b.otherActivations?.length || r.conditions?.length) reason = 'Additional effects are not modelled by this max-HP-only consumable.';
      else if (b.trigger !== 'Activate' || r.activate !== 'StatBoostSelf' || Object.keys(a).some(k => !allowed.has(k))
        || a.channel !== 'statConsumables') reason = 'Unmodelled activation restriction, relative scaling or stacking channel.';
      else if (!(bonus > 0) || !Number.isFinite(bonus) || !(duration > 0) || !Number.isFinite(duration)
        || !Number.isInteger(duration * 60)) reason = 'Missing finite positive bonus or exact 60 Hz duration.';
      if (reason) excluded.push({ ...base, category: 'consumable', reason });
      else consumables.push({ ...base, bonus, duration, stat: a.stat, trigger: b.trigger, channel: a.channel,
        source: index.statBoostSource || { built: index.built, from: index.from } });
      continue;
    }
    let reason = '';
    const c = protection[0];
    const duration = Number(c.duration), cooldown = Number(c.cooldown ?? r.cool);
    const manual = c.trigger === 'Activate' && r.hand === 'ability';
    const hit = c.trigger === 'OnPlayerHitActivate';
    const allowed = new Set(['effect', 'on', 'target', 'trigger', 'duration', 'cooldown', 'proc', 'hpMinThresholdRelative', 'damageThreshold']);
    if (!['ability', 'armor', 'ring'].includes(r.hand)) reason = 'Only Ability, Armor and Ring swaps are modelled.';
    else if (protection.length !== 1 || Object.keys(c).some(k => !allowed.has(k))) reason = 'Unmodelled activation conditions (shooting, combat status, scaling or another requirement).';
    else if (!(duration > 0) || !Number.isFinite(duration) || !(cooldown > 0) || !Number.isFinite(cooldown)) reason = 'Missing finite duration or cooldown.';
    else if (c.on !== 'ConditionEffectSelf' || (!manual && !hit)) reason = 'Activation trigger is not modelled by this survival simulator.';
    else if (c.proc !== undefined && Number(c.proc) !== 1) reason = 'Random activation probability is not modelled.';
    else if (manual && (!Number.isFinite(r.mp) || r.mp < 0)) reason = 'Missing MP cost.';
    else if (hit && (!(Number(c.hpMinThresholdRelative) > 0) || Number(c.hpMinThresholdRelative) > 1 || !Number.isFinite(Number(c.damageThreshold)))) reason = 'Missing HP or damage threshold.';
    else if (!classes.some(cl => cl.slots.includes(r.slot))) reason = 'No compatible Index class.';
    const item = { ...base, slot: r.slot, hand: r.hand, duration, cooldown, trigger: c.trigger,
      cost: manual ? r.mp : 0, below: hit ? Number(c.hpMinThresholdRelative) : null,
      damageThreshold: hit ? Number(c.damageThreshold) : null, conditions: [c],
      simulation: reason ? null : manual ? 'manual' : 'postHit', reason };
    if (reason) excluded.push(item);
    else equipment.push(item);
  }
  return { built: index.built, from: index.from, tool: 'tools/training-catalog.js',
    thresholdConvention: 'after-damage (historical simulator convention; live-game ordering unverified)',
    classes, equipment, consumables: consumables.sort((a, b) => a.name.localeCompare(b.name)), excluded };
}

function readTrainingCatalog(root) {
  return projectTraining(JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8')));
}
module.exports = { projectTraining, readTrainingCatalog };
