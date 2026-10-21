/*
 * The Pet Fame Calculator's arithmetic: pure, no page in it.
 *
 * Feeding: every item's feed power goes to every unlocked ability at once.
 * Each ability spends it on its own curve (step L→L+1 = base·1.08^(L−1),
 * base 20 / 400÷13 / 200÷3), so the first climbs fastest and the third
 * slowest, and an ability at its cap simply stops. That model reproduces
 * RealmEye's tables (data/Pets/realmeye-pets.json).
 *
 * Effects: RealmEye's mapped values at levels 1, 30, 50, 70, 90, 100 where
 * the wiki has them; elsewhere the client's PetBehavior min → max, spread by
 * the shape the mapped abilities share for that curve name.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PetFameEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const RARITY = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Divine'];
  const CAP = [30, 50, 70, 90, 100];
  const UNLOCK = [0, 1, 3];                   // rarity at which slot 1, 2, 3 opens
  const FEED = [{ fame: 15, gold: 5 }, { fame: 50, gold: 12 }, { fame: 175, gold: 30 }, { fame: 625, gold: 60 }, { fame: 1750, gold: 150 }];
  const FUSE = [{ fame: 525, gold: 100 }, { fame: 1750, gold: 240 }, { fame: 7000, gold: 600 }, { fame: 26250, gold: 1800 }];
  const YARD = [null, { fame: 525, gold: 150 }, { fame: 3500, gold: 400 }, { fame: 43750, gold: 1200 }, { fame: 87500, gold: 2000 }];
  const BASE = [20, 400 / 13, 200 / 3];
  const COLOR = ['#c9c2d4', '#5ac45a', '#168cc7', '#ca7aff', '#ffd026'];
  const SLOT_COLOR = ['#ffcb70', '#79c5e8', '#e98bd8'];
  const AT = [1, 30, 50, 70, 90, 100];

  const step = (n, l) => BASE[n] * Math.pow(1.08, l - 1);
  const rarityOfLevel = l => CAP.findIndex(c => l <= c);
  const unlocked = r => UNLOCK.filter(u => r >= u).length;

  /* ---------------- effects ---------------- */
  const SHAPE = {
    exp_incr: [0, .05, .1625, .375, .7375, 1],   // Heal / Magic Heal amount, Electric damage, Decoy duration all fit it
    linear: AT.map(l => (l - 1) / 99),
    dim: [0, .687, .816, .893, .953, 1],         // Heal delay
    exp_decr: [0, .625, .833, .917, .958, 1]     // Attack delay
  };
  const span = (a, b, shape) => SHAPE[shape].map(f => a + (b - a) * f);
  // [label, unit, values at AT, mapped on RealmEye?, digits]
  const EFFECT = {
    'Heal': { fx: 'heal', group: 'Support', stats: [['Heals', 'HP', [10, 14, 23, 40, 69, 90], 1, 0], ['Every', 's', [10, 3.82, 2.66, 1.96, 1.42, 1], 1, 2]], per: 'HP' },
    'Magic Heal': { fx: 'mana', group: 'Support', stats: [['Restores', 'MP', [1, 3, 8, 17, 33, 45], 1, 0], ['Every', 's', [10, 3.82, 2.66, 1.96, 1.42, 1], 1, 2]], per: 'MP' },
    'Attack Close': { fx: 'shoot', range: 4.5, group: 'Attack', stats: [['Damage', '', [7, 17, 39, 80, 130, 200], 1, 0], ['Every', 's', [5, 2, 1, .6, .4, .2], 1, 2], ['Range', 'tiles', [4.5, 4.5, 4.5, 4.5, 4.5, 4.5], 1, 2]], per: 'dmg' },
    'Attack Mid': { fx: 'shoot', range: 6.75, group: 'Attack', stats: [['Damage', '', [5, 12, 25, 60, 121, 150], 1, 0], ['Every', 's', [5, 2, 1, .6, .4, .2], 1, 2], ['Range', 'tiles', [6.75, 6.75, 6.75, 6.75, 6.75, 6.75], 1, 2]], per: 'dmg' },
    'Attack Far': { fx: 'shoot', range: 9, group: 'Attack', stats: [['Damage', '', [3, 8, 19, 40, 76, 100], 1, 0], ['Every', 's', [5, 2, 1, .6, .4, .2], 1, 2], ['Range', 'tiles', [9, 9, 9, 9, 9, 9], 1, 0]], per: 'dmg' },
    'Electric': { fx: 'zap', group: 'Attack', stats: [['Damage', '', span(5, 300, 'exp_incr'), 1, 0], ['Zaps every', 's', span(1, .2, 'dim'), 0, 2], ['Paralyze', '%', span(0, 20, 'linear'), 0, 0], ['for', 's', [.4, 1, 1.5, 2, 3, 4], 1, 1], ['Reach', 'tiles', span(.35, 2, 'linear'), 0, 2]], per: 'dmg' },
    'Decoy': { fx: 'decoy', group: 'Defence', stats: [['Lures for', 's', [3, 3.15, 3.75, 4.8, 6.7, 8], 1, 1], ['Radius', 'tiles', [3, 6, 9, 10, 11, 12], 1, 0], ['Cooldown', 's', [10.67, 5.6, 4.95, 4.3, 3.7, 3], 1, 1]], per: 's' },
    'Savage': { fx: 'savage', group: 'Movement', stats: [['Charges up to', 'tiles', span(2.5, 8, 'dim'), 0, 1], ['Every', 's', span(8, .8, 'exp_incr'), 0, 1]], per: 'tiles' },
    'Rising Fury': { fx: 'fury', group: 'Attack', stats: [['Blast up to', '', span(100, 1500, 'exp_incr'), 0, 0], ['Full charge in', 's', span(5, 2, 'linear'), 0, 1], ['Radius', 'tiles', span(3, 8, 'exp_incr'), 0, 1], ['Cooldown', 's', span(3.6, .2, 'exp_decr'), 0, 1]], per: 'dmg' }
  };
  const ABILITIES = Object.keys(EFFECT);
  function at(values, level) {
    for (let i = 1; i < AT.length; i++) if (level <= AT[i]) {
      const t = (level - AT[i - 1]) / (AT[i] - AT[i - 1]);
      return values[i - 1] + (values[i] - values[i - 1]) * t;
    }
    return values[values.length - 1];
  }
  function effect(name, level) {
    return EFFECT[name].stats.map(([label, unit, values, mapped, digits]) => ({ label, unit, mapped, value: at(values, level), digits }));
  }

  /* ---------------- the road ---------------- */
  /*
   * From `levels` at rarity r to Divine. Before each fusion the pet is fed
   * until the first `upTo` open abilities (1, 2 or 3) are at the cap; the second pet is assumed to match it, so a fusion keeps the levels
   * and lifts the cap. Returns one segment per rarity with the feed power it
   * takes and a sampler of levels inside it.
   */
  function road(r, levels, upTo) {
    const segs = [];
    let lv = levels.slice();
    for (let k = 0; k < 5; k++) {
      if (k < r) { segs.push(null); continue; }
      const open = unlocked(k);
      const start = lv.map((l, n) => (n < open ? Math.max(1, l) : 0));
      const need = start.map((l, n) => (n >= open || n >= upTo ? 0 : fpTo(n, l, CAP[k])));
      const fp = Math.max(0, ...need);
      const end = start.map((l, n) => (n < open ? levelAfter(n, l, fp, CAP[k]) : 0));
      segs.push({ k, start, end, fp, need, open });
      lv = end;
    }
    return segs;
  }
  function fpTo(n, from, to) { let s = 0; for (let l = from; l < to; l++) s += step(n, l); return s; }
  function levelAfter(n, from, fp, cap) {
    let l = from;
    while (l < cap && fp >= step(n, l)) { fp -= step(n, l); l++; }
    return l + (l < cap ? fp / step(n, l) : 0);           // fractional, for drawing
  }

  /* ---------------- food ---------------- */
  // Feed power per fame, or per gold with the shop price added to the fee.
  function value(food, r, pay) {
    if (pay === 'fame') return food.fp / FEED[r].fame;
    return food.gold ? food.fp / (FEED[r].gold + food.gold) : null;
  }

  const fmt = n => Math.round(n).toLocaleString('en-US');
  const short = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : fmt(n);
  const num = (v, d) => (d ? v.toFixed(d).replace(/\.?0+$/, '') : Math.round(v).toString());

  return { RARITY, CAP, UNLOCK, FEED, FUSE, YARD, COLOR, SLOT_COLOR, ABILITIES, EFFECT, step, rarityOfLevel, unlocked, effect, road, fpTo, levelAfter, value, fmt, short, num };
});
