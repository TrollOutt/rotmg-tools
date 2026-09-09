'use strict';
// Observed client shapes: projectile ConditionEffect(duration), and activation
// ConditionEffectSelf/Aura(effect, duration, range...). Values stay literal;
// status-effects.txt remains the separate authority on what a status does.
module.exports = body => {
  const out = [];
  const attrs = s => Object.fromEntries([...s.matchAll(/([\w]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  for (const p of body.matchAll(/<Projectile\b([^>]*)>([\s\S]*?)<\/Projectile>/g)) {
    for (const m of p[2].matchAll(/<ConditionEffect\b([^>]*)>([^<]*)<\/ConditionEffect>/g)) {
      out.push({ on: 'hit', projectile: attrs(p[1]).id, effect: m[2].trim(), ...attrs(m[1]) });
    }
  }
  for (const m of body.matchAll(/<(\w*Activate\w*)\b([^>]*)>\s*(ConditionEffect\w*)\s*<\/\1>/g)) {
    out.push({ on: m[3], trigger: m[1], ...attrs(m[2]) });
  }
  return out;
};
