'use strict';
/*
 * An independent calculation of what a weapon does, made from the client's raw
 * object XML and nothing the engine builds. It exists so the engine can be
 * checked against the game's own files rather than against itself: it shares no
 * code with tools/index-model.js or web/theorycraft.js.
 *
 * It needs client-data/ (the extraction of an installed client), which a
 * checkout of the repository does not have, so callers ask whether it is there.
 */
const fs = require('fs'), path = require('path');

const objects_ = require('../tools/client-objects');
const available = objects_.available;
/* Every <Object> body by its id (shared reader: tools/client-objects.js). */
const load = () => objects_.load().byId;

const { tag } = objects_;
const num = (s, d) => (s === undefined || s === '' || isNaN(Number(s)) ? d : Number(s));
const burstOf = body => {
  const many = num(tag(body, 'BurstCount'), 0);
  return many > 1 ? { many, wait: num(tag(body, 'BurstDelay'), 0), rush: num(tag(body, 'BurstMinDelay'), num(tag(body, 'BurstDelay'), 0)) } : null;
};

/* The shots a weapon's XML declares: one entry per kind of shot, with how many go out each time it fires. */
function channelsOf(body) {
  const projectiles = {};
  for (const m of body.matchAll(/<Projectile(?: id="(\d+)")?[^>]*>([\s\S]*?)<\/Projectile>/g)) {
    const b = m[2], damage = num(tag(b, 'Damage'), 0);
    projectiles[m[1] === undefined ? '0' : m[1]] = { min: num(tag(b, 'MinDamage'), damage), max: num(tag(b, 'MaxDamage'), damage), pierce: /<ArmorPiercing\b/.test(b) };
  }
  const bare = /<ProjectilePattern[\s\S]*?<\/ProjectilePattern>/g;
  const subs = [...body.matchAll(/<Subattack\b([^>]*)>([\s\S]*?)<\/Subattack>/g)].map(m => {
    const id = (/projectileId="(\d+)"/.exec(m[1]) || [])[1] || '0';
    // One pattern is fired each time, in turn: each counts for its share of the cycle.
    const patterns = [...m[2].matchAll(/<ProjectilePattern\b([^>]*)>([\s\S]*?)<\/ProjectilePattern>/g)]
      .map(p => ({ id: (/projectileId="(\d+)"/.exec(p[1]) || [])[1] || id, many: num(tag(p[2], 'NumProjectiles'), 1) }));
    const plain = m[2].replace(bare, '');
    return { id, rate: tag(plain, 'RateOfFire'), many: tag(plain, 'NumProjectiles'), burst: burstOf(m[2]), patterns };
  });
  const top = body.replace(/<Subattack\b[\s\S]*?<\/Subattack>/g, '').replace(/<Projectile\b[\s\S]*?<\/Projectile>/g, '')
    .replace(/<OnPlayerShootActivate[\s\S]*?<\/OnPlayerShootActivate>/g, '').replace(bare, '');
  const rate = num(tag(top, 'RateOfFire'), 1), many = num(tag(top, 'NumProjectiles'), 1), burst = burstOf(top);
  const out = [];
  if (subs.length) {
    for (const s of subs) {
      // A sub-attack that states its own rate uses that one alone (Gaseous Glaive: 130%, not 169%).
      const own = s.rate === undefined ? rate : Number(s.rate), b = s.burst || burst;
      if (s.patterns.length) for (const p of s.patterns) out.push({ shot: projectiles[p.id], many: p.many / s.patterns.length, rate: own, burst: b });
      else out.push({ shot: projectiles[s.id], many: num(s.many, 1), rate: own, burst: b });
    }
  } else out.push({ shot: projectiles['0'] || Object.values(projectiles)[0], many, rate, burst });
  return out.filter(c => c.shot);
}

/* Damage a second from those shots, by the game's formulas. */
function dps(channels, att, dex, def) {
  const fires = 1.5 + 6.5 * dex / 75;
  let total = 0;
  for (const c of channels) {
    const dealt = (c.shot.min + c.shot.max) / 2 * (0.5 + att / 50);
    const land = c.shot.pierce ? dealt : Math.max(dealt * 0.15, dealt - def);
    const rate = fires * c.rate;
    if (c.burst) {
      const wait = c.burst.wait + (c.burst.rush - c.burst.wait) * Math.max(0, Math.min(1, dex / 75));
      total += land * c.many * c.burst.many / Math.max(c.burst.many / rate, wait);
    } else total += land * c.many * rate;
  }
  return total;
}

module.exports = { available, load, channelsOf, dps };
