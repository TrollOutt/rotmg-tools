/* Port supplied in the user archive, derived from Mxple/TPGsim. Adapted for Realm Tools. */
var PatienceEngine = (function () {
'use strict';
/** @param {import('./types').Room} room */
function createEngine(room) {
// Full port of the TPGsim GameMaker logic for the browser version (solo / group / rails, hard mode,
// camera rotation, goal at 1800 / 2400 frames). Pure logic, no drawing.


/** @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// collision masks relative to the instance origin (GameMaker: x + (bbox - origin) * scale)
const PLAYER = [-2, -2, 3, 4];                                   // s_player 7x8, bbox 1..5 x 2..7, origin 3,4
const GHOST = [-3, -4, 4, 4];                                    // s_player_ghost 7x8, full bbox, origin 3,4
const ARROW = [(3 - 5) * .9, (2 - 4) * .9, (7 + 1 - 5) * .9, (6 + 1 - 4) * .9];
const SPIKE = [(5 - 9) * .72, (3 - 5) * .72, (10 + 1 - 9) * .72, (8 + 1 - 5) * .72];
const FOG_HB = [-72, -72, 72, 72];                               // s_fog_hb 18x18 scaled x8, origin 9,9

const WALLS = room.walls.map(([x, y, sx, sy]) => {
  const w = 8 * sx, h = 8 * sy;
  return [Math.min(x, x + w), Math.min(y, y + h), Math.max(x, x + w), Math.max(y, y + h)];
});
const WATER = room.water.map(([x, y, sx, sy]) => [x, y, x + 8 * sx, y + 8 * sy]);

/** @param {number} x @param {number} y */
function facingOf(x, y) {
  if (x >= 40 && x <= 232) return y === 24 ? 270 : 90;
  return x === 16 ? 0 : 180;
}
const TENDRILS = room.tendrils.map(([x, y]) => ({ x, y, f: facingOf(x, y), anim: 0 }));
/** @type {Record<string, number>} */
const SHADE_IDS = { '72,200': 1, '208,200': 0, '208,64': 3, '72,64': 2 };

const SEC = 60;
/** @type {Record<string, import('./types').Item>} */
const ITEMS = {
  matrix: { slot: 'armor', name: 'Magic Protective Matrix', tag: 'UT · Alien Gear', hp: 0, def: 10, spd: 0,
    eff: { below: .5, invuln: 1.4 * SEC, cd: 180 * SEC }, text: 'Below 50% HP, taking a hit grants 1.4 s invulnerability (Dazed is not simulated). Cooldown 180 s.' },
  rags: { slot: 'armor', name: 'Wretched Rags', tag: 'Divine UT', hp: 485, def: 10, spd: 0, eff: null,
    text: 'Archive approximation: +485 max HP (1245 equipped, 760 without). Configure the bonus for your character.' },
  amulet: { slot: 'ring', name: 'Amulet of Restoration', tag: 'Rare UT', hp: 11, def: 0, spd: 0,
    eff: { below: .2, invuln: 2 * SEC, heal: 120, cd: 1800 * SEC }, text: 'Below 20% HP, taking a hit grants 2 s invulnerability and heals 120 HP. Cooldown 1800 s.' },
  circlet: { slot: 'ring', name: 'Nightmatter Circlet', tag: 'Divine ST', hp: 120, def: 2, spd: 2,
    eff: { below: .5, heal: 300, cd: 180 * SEC }, text: 'Below 50% HP, taking a hit heals 300 HP. Cooldown 180 s.' },
  blood: { slot: 'nild', name: 'Blood Nildrop', tag: 'Consumable', hp: 150, def: 0, spd: 0, eff: null,
    text: '+150 max HP for 300 s; removes Bleeding and Curse. Current HP does not increase.' },
};
for (const k in ITEMS) ITEMS[k].id = k;
/** @param {number} x @param {number} y @param {number[]} m @param {number[]} r */
function hitRect(x, y, m, r) {
  return x + m[0] < r[2] && x + m[2] > r[0] && y + m[1] < r[3] && y + m[3] > r[1];
}
/** @param {number[][]} list @param {number} x @param {number} y @param {number[]} m */
function meets(list, x, y, m) { for (const w of list) if (hitRect(x, y, m, w)) return true; return false; }

const RAD = Math.PI / 180;
/** @param {number} a @param {number} b @param {number} amt */
const approach = (a, b, amt) => a + Math.max(-amt, Math.min(amt, b - a));
/** @param {number} a @param {number} b */
const gmmod = (a, b) => a - b * Math.trunc(a / b);

class Game {
  // o: {hp, def, spd, lvl, hard, mode: 'solo'|'group'|'rails', rspeed}
  /** @param {number} seed @param {Partial<import('./types').Options>} o */
  constructor(seed, o = {}) {
    /** @type {import('./types').Options} */
    this.o = Object.assign({ hp: 1450, def: 43, spd: 57, lvl: 5, hard: false, mode: 'solo', rspeed: 0, loseAt: 0, dmgMult: 1, maxHits: 0 }, o);
    this.rand = rng(seed);
    this.goal = (this.o.chases || (this.o.hard ? 4 : 3)) * 600; // one chase + one rest = 600 frames
    this.walk = 8 * (4 + 5.6 * (this.o.spd / 75)) / 60;
    this.px = 141; this.py = 200;
    // special gear: {armor:{id,mode,at,hp}, ring:{...}, nild:{id,mode,at}}; mode = off | start | auto | manual, at = % of current max HP
    this.gear = this.o.gear || {};
    this.cur = this.o.cur || {};                    // what is worn at the start: {armor:{id,hp}, ring:{id,hp}} (the menu HP already includes it)
    /** @type {Record<string, boolean>} */
    this.eq = { armor: false, ring: false, nild: false };   // special pieces that replaced the worn ones
    /** @type {Record<string, number>} */
    this.cdItem = {}; this.clipped = 0;
    this.invuln = 0; this.blocked = 0; this.healed = 0; this.events = /** @type {{f:number, text:string}[]} */ ([]);
    this.maxHp = this.o.hp; this.def = this.o.def; this.spdStat = this.o.spd;
    this.hp = this.o.hp; this.bleed = 0; this.curse = 0; this.flash = 0;
    this.facing = 0; this.vel = 0; this.animIdx = 0;
    this.rotation = 0; this.offset = false;
    this.ghosts = this.o.mode === 'group'
      ? [[72, 133, 270], [139, 64, 180], [208, 131, 90]].map(([x, y, a]) => ({ x, y, angle: a, facing: 0, vel: 0, anim: 0 }))
      : [];
    this.frames = 0; this.step = 0;
    this.shoot_delay = 60; this.reset_delay = 300; this.current_shot = 0;
    this.shades = room.shades.map(([x, y]) => ({
      x, y, ogx: x, ogy: y, tx: x, ty: y, state: 'RESET', id: SHADE_IDS[x + ',' + y], resets: 0, anim: 0,
    }));
    /** @type {import('./types').Projectile[]} */
    this.projs = [];
    this.alarmP = 1; this.alarmT = 40;
    /** @type {string | null} */
    this.lost = null; this.hits = 0;
    this.ended = false; this.victory = false; this.over = false; this.endedAt = -1;
    this.dmg = { blueArrow: 0, redArrow: 0, blueSpike: 0, redSpike: 0, bleed: 0, curse: 0 };
    /** @type {[number, string, number][]} */
    this.hitLog = [];
    this.dmgBase = this.o.hard ? 20 : 0;
    for (const t of TENDRILS) t.anim = [0, 2, 4, 6][Math.floor(this.rand() * 4)];
    let any = false;
    for (const slot of ['nild', 'armor', 'ring']) { const c = this.gear[slot]; if (c && c.id && c.mode === 'start') { this.equip(slot, true); any = true; } }
    if (any) this.hp = this.maxHp;                  // put on before the run: full HP at the new max
  }
  /** @param {string} slot */
  itemOf(slot) { const c = this.gear[slot]; return c && c.id && ITEMS[c.id] ? Object.assign({}, ITEMS[c.id], c.hp !== undefined ? { hp: c.hp } : {}) : null; }
  /** @param {string} slot */
  curOf(slot) { const c = this.cur[slot]; return c && c.id && ITEMS[c.id] ? Object.assign({}, ITEMS[c.id], c.hp !== undefined ? { hp: c.hp } : {}) : null; }
  /** @param {string} slot */
  worn(slot) { return this.eq[slot] ? this.itemOf(slot) : this.curOf(slot); }       // the piece really on the character
  /** @param {string} slot */
  cdOf(slot) { const it = this.worn(slot); return it && it.eff ? (this.cdItem[/** @type {string} */ (it.id)] || 0) : 0; }
  /** @param {Record<string, boolean>} eq */
  statsFor(eq) {
    let hp = this.o.hp, def = this.o.def, spd = this.o.spd;
    for (const slot of ['armor', 'ring']) if (eq[slot]) {
      const cu = this.curOf(slot), it = /** @type {import('./types').Item} */ (this.itemOf(slot));
      if (cu) { hp -= cu.hp; def -= cu.def; spd -= cu.spd; }       // the worn piece comes off ...
      hp += it.hp; def += it.def; spd += it.spd;                    // ... the special one goes on
    }
    if (eq.nild) { const it = /** @type {import('./types').Item} */ (this.itemOf('nild')); hp += it.hp; def += it.def; spd += it.spd; }
    return { hp: Math.max(1, hp), def, spd };
  }
  recalc() {
    const st = this.statsFor(this.eq);
    this.maxHp = st.hp; this.def = st.def; this.spdStat = st.spd;
    this.walk = 8 * (4 + 5.6 * (st.spd / 75)) / 60;
  }
  // max HP after pressing the key for this slot (put on, or put the worn piece back)
  /** @param {string} slot */
  previewMax(slot) { const eq = Object.assign({}, this.eq); eq[slot] = !eq[slot]; return this.statsFor(eq).hp; }
  /** @param {string} text */
  log(text) { this.events.push({ f: this.frames, text }); }
  // max HP moves, current HP never goes up; when the max drops below the current HP the excess is lost
  clip() { const lost = Math.max(0, this.hp - this.maxHp); this.clipped += lost; this.hp = Math.min(this.hp, this.maxHp); return lost; }
  /** @param {string} slot @param {boolean} atStart */
  equip(slot, atStart) {
    const it = this.itemOf(slot);
    if (!it || this.eq[slot] || this.ended) return false;
    const before = this.maxHp;
    this.eq[slot] = true; this.recalc();
    if (slot === 'nild') { this.bleed = 0; this.curse = 0; }
    if (atStart) return true;
    const lost = this.clip();
    const cu = slot === 'nild' ? null : this.curOf(slot);
    this.log((slot === 'nild' ? 'drank ' : 'equipped ') + it.name + (cu ? ' replacing ' + cu.name : '') + ' · max HP ' + before + ' → ' + this.maxHp + ' (HP ' + Math.max(0, Math.round(this.hp)) + ')' + (lost > 0.5 ? ' · ' + Math.round(lost) + ' HP lost to cap' : ''));
    return true;
  }
  /** @param {string} slot */
  unequip(slot) {
    if (slot === 'nild' || !this.eq[slot] || this.ended) return false;
    const it = /** @type {import('./types').Item} */ (this.itemOf(slot)), before = this.maxHp;
    this.eq[slot] = false; this.recalc();
    const lost = this.clip(), cu = this.curOf(slot);
    this.log('restored ' + (cu ? cu.name : 'the base item') + ' replacing ' + it.name + ' · max HP ' + before + ' → ' + this.maxHp + (lost > 0.5 ? ' · ' + Math.round(lost) + ' HP lost to cap' : ''));
    return true;
  }
  /** @param {string} slot */
  useSlot(slot) { return this.eq[slot] && slot !== 'nild' ? this.unequip(slot) : this.equip(slot, false); }
  // automatic rules, in the order that matters: consumable first (it raises the ceiling), then armor, then ring
  autoGear() {
    for (const slot of ['nild', 'armor', 'ring']) {
      const c = this.gear[slot];
      if (!c || !c.id || c.mode !== 'auto' || this.eq[slot] || this.hp < 0 || this.hp > this.maxHp * c.at / 100) continue;
      if (c.waitCur) { const cu = this.curOf(slot); if (cu && cu.eff && !(this.cdItem[/** @type {string} */ (cu.id)] > 0)) continue; }   // let the worn piece do its job first
      this.equip(slot, false);
    }
  }
  // on taking a (non-lethal) hit: the worn pieces that react below a % of max HP
  procs() {
    for (const slot of ['armor', 'ring']) {
      const it = this.worn(slot);
      if (!it || !it.eff || (this.cdItem[/** @type {string} */ (it.id)] || 0) > 0 || this.hp < 0) continue;
      if (this.hp / this.maxHp >= it.eff.below) continue;
      this.cdItem[/** @type {string} */ (it.id)] = it.eff.cd;
      const parts = [];
      if (it.eff.invuln) { this.invuln = Math.max(this.invuln, it.eff.invuln); parts.push('invulnerable ' + (it.eff.invuln / SEC).toFixed(1).replace('.', ',') + ' s'); }
      if (it.eff.heal) { const h = Math.min(it.eff.heal, this.maxHp - this.hp); this.hp += h; this.healed += h; parts.push('+' + Math.round(h) + ' HP'); }
      this.log(it.name + ' : ' + parts.join(', ') + ' (at ' + Math.round(this.hp / this.maxHp * 100) + ' % HP)');
    }
  }
  /** @param {number} n */
  irandom(n) { return Math.floor(this.rand() * (n + 1)); }
  /** @param {number} a @param {number} b */
  irange(a, b) { return a + this.irandom(b - a); }
  /** @param {number} a @param {number} b */
  rr(a, b) { return a + (b - a) * this.rand(); }

  /** @param {{x:number, y:number, f:number}} t @param {number} color */
  shootTendril(t, color) {
    const speed = [0.3, 0.45, 0.6][this.irandom(2)];
    const blue = color === 0;
    this.projs.push({
      x: t.x, y: t.y, dir: t.f, vx: speed * Math.cos(t.f * RAD), vy: -speed * Math.sin(t.f * RAD),
      life: 600, kind: blue ? 'ab' : 'ar', dmg: (blue ? 45 : 20) + this.dmgBase, m: ARROW, hit: false,
    });
  }

  // hd, vd in -1..1 (D-A, S-W), rot = rotate key (E - Q)
  /** @param {number} hd @param {number} vd @param {number} rotKey @param {import('./types').Control} ctl */
  tick(hd, vd, rotKey = 0, ctl = {}) {
    this.step++;
    // ---- camera (o_camera Step_2 runs late in the frame in GM; order is irrelevant for gameplay except movement uses last rotation)
    const rotUsed = this.rotation;
    this.rotation += [2, 3, 4][this.o.rspeed] * rotKey;
    if (ctl.resetRot || ctl.resetAll) this.rotation = 0;
    if (ctl.offset) this.offset = !this.offset;
    // ---- countdown before the phase starts: the player and the camera are free, everything else waits
    if (ctl.pre) {
      this.movePlayer(hd, vd, rotUsed);
      for (const gh of this.ghosts) this.moveGhost(gh, hd, vd, rotUsed);
      return;
    }
    for (const k in this.cdItem) if (this.cdItem[k] > 0) this.cdItem[k]--;
    if (this.invuln > 0) this.invuln--;
    this.autoGear();
    // ---- alarms (nothing new is launched once the phase is won)
    if (!this.over) this.alarmT--;
    if (this.alarmT === 0 && !this.over) {
      this.alarmT = 37;
      for (const t of TENDRILS) {
        const d = (t.f + 180) * RAD;
        this.projs.push({ x: t.x, y: t.y, dir: t.f + 180, vx: 0.6 * Math.cos(d), vy: -0.6 * Math.sin(d), life: 260, kind: 'ab', dmg: 45, m: ARROW, hit: false });
      }
    }
    if (!this.over) this.alarmP--;
    if (this.alarmP === 0 && !this.over) {
      const add = 31 - 3 * this.o.lvl;
      this.alarmP = this.irange(5 + add, 20 + add);
      const color = this.rand() < 0.5 ? 0 : 1; // floor(current_time) mod 2, identical for a whole salvo
      const n = this.irandom(10 + this.o.lvl);
      for (let i = 0; i < n; i++) this.shootTendril(TENDRILS[this.irandom(TENDRILS.length - 1)], color);
    }
    // ---- patience step
    if (!this.over && this.shoot_delay <= 0) {
      const blue = this.current_shot % 2 === 0;
      for (const s of this.shades) {
        for (let i = 0; i < 16; i++) {
          const d = i * 22.5 * RAD;
          this.projs.push({ x: s.x, y: s.y, dir: i * 22.5, vx: 0.5 * Math.cos(d), vy: -0.5 * Math.sin(d), life: 260, kind: blue ? 'sb' : 'sr', dmg: (blue ? 70 : 100) + this.dmgBase, m: SPIKE, hit: false });
        }
      }
      this.current_shot++;
      this.shoot_delay = 180;
    }
    if (!this.over) {
      if (this.reset_delay === 300) for (const s of this.shades) { s.state = 'RESET'; s.resets++; }
      if (this.reset_delay === 0) { for (const s of this.shades) s.state = 'CHASE'; this.reset_delay = 600; }
      this.shoot_delay--; this.reset_delay--;
    }
    if (!this.ended) this.frames++;
    // goal reached: the phase is over (nothing new is launched, the shades stop). The ring that is already
    // in the air still has to run its course; the run is won once no live spike is left.
    if (!this.over && this.frames >= this.goal && this.shoot_delay > 0) { this.over = true; for (const s of this.shades) s.state = 'DONE'; }
    // ---- player step
    if (this.hp < 0 || this.lost) {
      if (!this.ended) { this.ended = true; this.endedAt = this.frames; }
    } else {
      this.movePlayer(hd, vd, rotUsed);
      if (this.bleed > 0) {
        this.bleed = Math.max(0, this.bleed - 1);
        if (this.hp > 1 && !this.invuln) { this.hp -= 0.3 * this.o.dmgMult; this.dmg.bleed += 0.3 * this.o.dmgMult; }
      }
      this.curse = Math.max(0, this.curse - 1);
      this.flash = Math.max(0, this.flash - 1);
    }
    for (const gh of this.ghosts) this.moveGhost(gh, hd, vd, rotUsed);
    // ---- shades
    if (!this.over) for (const s of this.shades) this.moveShade(s);
    // ---- projectiles
    const out = [];
    for (const p of this.projs) {
      p.life--;
      if (p.life < 0) continue;
      p.x += p.vx; p.y += p.vy;
      if (p.x < -30 || p.x > 310 || p.y < -30 || p.y > 310) continue;
      if (!p.hit && !this.ended && this.hp >= 0 && hitRect(p.x, p.y, p.m, [this.px + PLAYER[0], this.py + PLAYER[1], this.px + PLAYER[2], this.py + PLAYER[3]])) this.onHit(p);
      let dead = false;
      for (const w of WALLS) if (hitRect(p.x, p.y, p.m, w)) { dead = true; break; }
      if (!dead) out.push(p);
    }
    this.projs = out;
    this.hp = Math.max(-1, this.hp);
    if (!this.ended && this.o.loseAt > 0 && this.hp <= this.maxHp * this.o.loseAt) this.lose('hp');
    if (this.over && !this.ended && this.hp >= 0 && !out.some(p => p.kind[0] === 's' && !p.hit)) { this.victory = true; this.ended = true; this.endedAt = this.frames; }
    // animations
    for (const s of this.shades) s.anim = (s.anim + 6 / 60) % 4;
    for (const t of TENDRILS) t.anim = (t.anim + 6 / 60) % 7;
  }
  /** @param {import('./types').Projectile} p */
  onHit(p) {
    p.hit = true;
    if (this.invuln > 0) { this.blocked++; return; }
    const mult = this.o.dmgMult;
    const cm = Math.max(1, 1.25 * Math.sign(this.curse));
    const extra = (cm - 1);
    let d;
    if (p.kind === 'ar') { this.bleed = 180; d = p.dmg * mult * cm; this.dmg.redArrow += p.dmg * mult; this.dmg.curse += extra * p.dmg * mult; }
    else if (p.kind === 'ab') { d = p.dmg * mult * cm; this.dmg.blueArrow += p.dmg * mult; this.dmg.curse += extra * p.dmg * mult; }
    else if (p.kind === 'sb') { d = p.dmg * mult + cm; this.dmg.blueSpike += p.dmg * mult; this.dmg.curse += extra * p.dmg * mult; } // the source adds instead of multiplying
    else {
      const base = Math.max(p.dmg - this.def, p.dmg / 10) * mult;
      d = base * cm; this.dmg.redSpike += base; this.dmg.curse += extra * base; this.curse = 180;
    }
    this.hp -= d;
    this.flash = 4;
    this.hits++;
    this.hitLog.push([this.frames, p.kind, Math.round(d)]);
    this.procs();
    if (this.o.maxHits > 0 && this.hits >= this.o.maxHits) this.lose('hits');
  }
  /** @param {string} reason */
  lose(reason) {
    if (this.ended) return;
    this.lost = reason; this.ended = true; this.endedAt = this.frames;
  }
  /** @param {number} x @param {number} y @param {number[]} mask @param {number} hd @param {number} vd @param {number} rot @param {number} angleAdd @param {boolean} slowInWater */
  moveVec(x, y, mask, hd, vd, rot, angleAdd, slowInWater) {
    let vel = (hd || vd) ? this.walk : 0;
    const wasd = Math.atan2(-vd, hd) / RAD;               // point_direction(0,0,hd,vd)
    const dir = (hd || vd) ? (wasd - rot + angleAdd) * RAD : 0;
    if (slowInWater && meets(WATER, x, y, mask)) vel /= 3;
    const hsp = vel * Math.cos(dir), vsp = -vel * Math.sin(dir);
    return { hsp, vsp, vel, x, y };
  }
  /** @param {import('./types').Motion} st @param {number[]} mask */
  stepAxes(st, mask) {
    let { x, y, hsp, vsp } = st;
    const wall = (/** @type {number} */ xx, /** @type {number} */ yy) => meets(WALLS, xx, yy, mask);
    let rem = Math.abs(hsp);
    const xl = gmmod(hsp, 1);
    const n = Math.floor(rem);
    for (let i = 0; i < n; i++) {
      rem = approach(rem, 0, 1);
      if (wall(x + Math.sign(hsp), y)) { rem = 0; break; }
      x += Math.sign(hsp); rem -= 1;
    }
    if (!wall(x + Math.sign(hsp), y)) x += xl;
    rem = Math.abs(vsp);
    const yl = gmmod(vsp, 1);
    const m = Math.floor(rem);
    for (let i = 0; i < m; i++) {
      rem = approach(rem, 0, 1);
      if (wall(x, y + Math.sign(vsp))) { rem = 0; break; }
      rem -= 1; y += Math.sign(vsp);
    }
    if (!wall(x, y + Math.sign(vsp) * rem)) y += yl;
    return [x, y];
  }
  /** @param {number} hd @param {number} vd @param {number} rot */
  movePlayer(hd, vd, rot) {
    let water = meets(WATER, this.px, this.py, PLAYER);
    const st = this.moveVec(this.px, this.py, PLAYER, hd, vd, rot, 0, true);
    if (water && !this.invuln) this.hp -= 2 * this.o.dmgMult;
    [this.px, this.py] = this.stepAxes(st, PLAYER);
    this.vel = st.vel;
    if (hd || vd) this.facing = Math.floor((((Math.atan2(-vd, hd) / RAD) % 360) + 360) % 360 / 90);
  }
  /** @param {import('./types').Ghost} gh @param {number} hd @param {number} vd @param {number} rot */
  moveGhost(gh, hd, vd, rot) {
    const st = this.moveVec(gh.x, gh.y, GHOST, hd, vd, rot, gh.angle, true);
    [gh.x, gh.y] = this.stepAxes(st, GHOST);
    gh.vel = st.vel;
    if (hd || vd) gh.facing = Math.floor((((Math.atan2(-vd, hd) / RAD) % 360) + 360) % 360 / 90);
  }
  /** @param {import('./types').Shade} s */
  moveShade(s) {
    const chase = 8 * 1.8 / 60, back = 8 * 2.5 / 60;
    const mv = (/** @type {number} */ spd) => {
      const dir = Math.atan2(-(s.ty - s.y), s.tx - s.x);
      s.x += spd * Math.cos(dir);
      const dir2 = Math.atan2(-(s.ty - s.y), s.tx - s.x);
      s.y += -spd * Math.sin(dir2);
    };
    if (this.o.mode !== 'rails') {
      if (s.state === 'CHASE') {
        s.tx = this.px; s.ty = this.py;
        const l = s.x - 5, r = s.x + 6, t = s.y - 8, b = s.y + 5;
        const dx = Math.max(l - s.tx, 0, s.tx - r), dy = Math.max(t - s.ty, 0, s.ty - b);
        if (Math.hypot(dx, dy) < 100) mv(chase);
      } else this.resetMove(s, back, mv);
    } else {
      if (s.state === 'CHASE') {
        if (this.frames % 30 === 0) {
          const odd = s.resets % 2 === 1;
          if (s.id === 2) { if (odd) { s.tx = s.x + 20; s.ty = this.rr(s.y - 10, s.y + 10); } else { s.tx = this.rr(s.x - 10, s.x + 10); s.ty = s.y + 20; } }
          else if (s.id === 3) { if (odd) { s.tx = this.rr(s.x - 10, s.x + 10); s.ty = s.y + 20; } else { s.tx = s.x - 20; s.ty = this.rr(s.y - 10, s.y + 10); } }
          else if (s.id === 1) { if (odd) { s.tx = this.rr(s.x - 10, s.x + 10); s.ty = s.y - 20; } else { s.tx = s.x + 20; s.ty = this.rr(s.y - 10, s.y + 10); } }
          else if (s.id === 0) { if (odd) { s.tx = s.x - 20; s.ty = this.rr(s.y - 10, s.y + 10); } else { s.tx = this.rr(s.x - 10, s.x + 10); s.ty = s.y - 20; } }
        }
        mv(chase);
      } else this.resetMove(s, back, mv);
    }
  }
  /** @param {import('./types').Shade} s @param {number} back @param {(speed:number)=>void} mv */
  resetMove(s, back, mv) {
    s.tx = s.ogx; s.ty = s.ogy; mv(back);
    if (Math.abs(s.tx - s.x) < 2) s.x = s.tx;
    if (Math.abs(s.ty - s.y) < 2) s.y = s.ty;
  }
  totalLost() { return this.o.hp - Math.max(this.hp, 0); }
}

return {Game, ITEMS, TENDRILS, FOG_HB, hitRect, rng};
}
return {createEngine};
})();
if (typeof module !== 'undefined') module.exports = PatienceEngine;
