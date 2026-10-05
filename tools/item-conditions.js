'use strict';
/*
 * The status effects an object declares, in every shape the client uses.
 *
 * A projectile carries <ConditionEffect duration="3">Curse</ConditionEffect>
 * and puts it on whatever it hits. An ability or a proc names its effect on
 * the activation: ConditionEffectSelf and ConditionEffectAura grant one to the
 * player and the party; EffectBlast, Trap, PoisonGrenade and Lightning put
 * one (or two, "Paralyzed,Curse") on the enemies they reach, as condEffect;
 * ApplyCondition and GenericActivate say it as effect. Reading only the
 * first two shapes missed every Curse of the tiered orbs and every Slowed of
 * the traps.
 *
 * Each entry says what, for how long, and on whom - enemy, self or allies -
 * and keeps the client's other attributes as written. What a status does is
 * not here: that is data/Items/status-effects.txt, because the client never
 * says it.
 */
const attrs = s => Object.fromEntries([...s.matchAll(/([\w]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));

// Effects that name no status a player or an enemy can carry.
const NOT_A_STATUS = new Set(['Nothing', 'Multiplied']);

// Whom an activation's effect lands on, by its verb.
const ON = {
  ConditionEffectSelf: 'self', ClearConditionEffectSelf: 'self', ShurikenAbility: 'self', Sneak: 'self',
  ConditionEffectAura: 'allies', ClearConditionEffectAura: 'allies',
  EffectBlast: 'enemy', Trap: 'enemy', PoisonGrenade: 'enemy', Lightning: 'enemy', ApplyCondition: 'enemy'
};

module.exports = body => {
  const out = [];
  const push = one => { if (one.effect && !NOT_A_STATUS.has(one.effect)) out.push(one); };
  for (const p of body.matchAll(/<Projectile\b([^>]*)>([\s\S]*?)<\/Projectile>/g)) {
    for (const m of p[2].matchAll(/<ConditionEffect\b([^>]*)>([^<]*)<\/ConditionEffect>/g)) {
      // The text is the effect; an effect="" attribute beside it is something else.
      const { effect: _x, ...rest } = attrs(m[1]);
      push({ on: 'hit', projectile: attrs(p[1]).id, effect: m[2].trim(), target: 'enemy', ...rest });
    }
  }
  for (const m of body.matchAll(/<(\w*Activate\w*)\b([^>]*)>\s*(\w+)\s*<\/\1>/g)) {
    const [, trigger, raw, verb] = m;
    const a = attrs(raw);
    if (/^ConditionEffect|^ClearConditionEffect/.test(verb)) {
      push({ on: verb, trigger, ...a, target: ON[verb] || 'self' });
      continue;
    }
    /*
     * Blasts, traps, grenades and lightning: condEffect, possibly a pair, for
     * condDuration. Lightning also leaves aoeEffect where its splash lands.
     */
    if (a.condEffect) {
      // And what makes it last longer: WIS over a floor, or the item's scaling stat.
      const keep = {};
      for (const k of ['proc', 'cooldown', 'wisMin', 'wisPerDuration', 'scalingStat', 'statModScalingMin',
        'statModCondDuration', 'statModTrapCondDuration']) if (a[k] !== undefined) keep[k] = a[k];
      for (const effect of a.condEffect.split(',').map(x => x.trim())) {
        push({ on: verb, trigger, effect, duration: a.condDuration, target: 'enemy', ...keep });
      }
      if (a.aoeEffect && a.aoeEffect !== a.condEffect) {
        push({ on: verb, trigger, effect: a.aoeEffect, duration: a.condDuration, target: 'enemy' });
      }
      continue;
    }
    const effect = a.effect || a.conditionEffect;
    if (!effect) continue;
    // A generic activation says whom with target="enemy"; the rest by their verb.
    const target = a.target === 'enemy' ? 'enemy' : ON[verb] || (verb === 'GenericActivate' ? 'self' : null);
    if (!target) continue;
    const { effect: _e, conditionEffect: _c, ...rest } = a;
    // Some name two at once: "Paralyzed,Curse".
    for (const one of effect.split(',').map(x => x.trim())) push({ on: verb, trigger, effect: one, ...rest, target });
  }
  return out;
};
