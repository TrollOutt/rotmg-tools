/* Weapon and statistic arithmetic with explicit inputs. Set resolution,
 * catalogue ownership, status modelling and search stay with the caller. */
/**
 * @typedef {{many: number, wait: number, rush: number}} TheoryBurst
 * @typedef {{every: number, shots: number, wait: number, run: number}} TheoryBurstCycle
 * @typedef {Object} TheoryShot
 * @property {number} low
 * @property {number} [high]
 * @property {boolean} [pierce]
 * @property {boolean} [subattack]
 * @property {number} [rate]
 * @property {number} [many]
 * @property {TheoryBurst} [burst]
 * @property {number} [reach]
 * @property {number} [fast]
 * @typedef {{shots?: TheoryShot[], rate?: number, many?: number, burst?: TheoryBurst}} TheoryWeapon
 * @typedef {{how: string, shots: TheoryShot[], many?: number}} TheorySubattack
 * @typedef {{att: number, dex: number}} TheoryWeaponStats
 * @typedef {{dmg: number, rate: number, life: number, fast: number}} TheoryScale
 * @typedef {(roll: number, att: number, def: number, pierce?: boolean) => number} TheoryOnShot
 * @typedef {{onShot?: TheoryOnShot | null, haste?: number}} TheoryWeaponEffects
 * @typedef {Object} TheoryWeaponResult
 * @property {number} each
 * @property {number} rate
 * @property {number} dps
 * @property {number} [many]
 * @property {TheoryBurstCycle | null} [burst]
 * @property {number} [along]
 * @property {number} [reach]
 * @property {number} [fast]
 */
/**
 * @typedef {'hp' | 'mp' | 'att' | 'def' | 'spd' | 'dex' | 'vit' | 'wis'} TheoryStatKey
 * @typedef {Record<string, number>} TheoryStatValues
 * @typedef {Record<TheoryStatKey | `${TheoryStatKey}Top`, number> &
 *   {grow: Partial<Record<TheoryStatKey, number>>}} TheoryClassStats
 * @typedef {{stat: string, of: string, pct: number}} TheoryStatShare
 * @typedef {{worn?: TheoryStatValues, rel?: TheoryStatShare[], share?: TheoryStatShare[]}} TheoryStatItem
 * @typedef {{worn?: TheoryStatValues, rel?: TheoryStatShare[],
 *   mul?: Partial<TheoryScale>, sub?: TheorySubattack[]}} TheoryStatEnchantment
 * @typedef {Record<string, TheoryStatEnchantment | undefined>} TheoryStatEnchantments
 * @typedef {{byClass: Record<string, TheoryClassStats | undefined>,
 *   byItem: Record<string, TheoryStatItem | undefined>, byEnch: TheoryStatEnchantments}} TheoryStatCatalogue
 * @typedef {{name: string | null, ench?: (string | null)[]}} TheoryStatEquipment
 * @typedef {{gear: Record<string, TheoryStatEquipment | null | undefined>}} TheoryEquippedState
 * @typedef {TheoryEquippedState & {klass: string, level: number, maxed?: boolean,
 *   exalt?: boolean, exalts: TheoryStatValues}} TheoryStatState
 * @typedef {{gives: TheoryStatValues}} TheorySetBonus
 * @typedef {{gear: TheoryStatValues, ench: TheoryStatValues, set: TheoryStatValues,
 *   exalt: TheoryStatValues, rel: TheoryStatValues, share: TheoryStatValues,
 *   bonus?: TheoryStatValues}} TheoryStatSources
 * @typedef {{now: TheoryStatValues, base: TheoryStatValues, top: TheoryStatValues,
 *   from: TheoryStatSources}} TheoryStatResult
 * @typedef {{stats: readonly (readonly [TheoryStatKey, ...string[]])[],
 *   hands: readonly (readonly string[])[],
 *   ofStat: Readonly<Record<string, TheoryStatKey | undefined>>}} TheoryStatRules
 */
var TheoryEngine = (function () {
  'use strict';

  /** @param {number} dex @returns {number} */
  const SHOTS_AT = dex => 1.5 + 6.5 * (dex / 75);

  /* What a shot lands for, against a given armour. */
  /**
   * @param {number} roll @param {number} att @param {number} def
   * @param {boolean} [pierce] @param {TheoryWeaponEffects | null} [fx]
   * @returns {number}
   */
  function landed(roll, att, def, pierce, fx) {
    if (fx && fx.onShot) return fx.onShot(roll, att, def, pierce);
    const dealt = roll * (0.5 + att / 50);
    if (pierce) return dealt;
    return Math.max(dealt * 0.15, dealt - def);
  }

  /*
   * A burst has two clocks.
   *
   * Its volleys consume their budget at the ordinary attack cadence, while
   * BurstDelay -> BurstMinDelay is a cooldown measured from the START of the
   * burst. The next burst can begin when both clocks have finished.
   */
  /**
   * @param {TheoryBurst | null | undefined} burst
   * @param {number} rate @param {number} dex
   * @returns {TheoryBurstCycle | null}
   */
  function burstCycle(burst, rate, dex) {
    if (!burst || !(burst.many > 1) || !(rate > 0)) return null;

    const quick = Math.max(0, Math.min(1, dex / 75));
    const wait = burst.wait + (burst.rush - burst.wait) * quick;
    const run = burst.many / rate;

    return {
      every: Math.max(run, wait),
      shots: burst.many,
      wait,
      run
    };
  }

  /**
   * @param {TheoryWeapon | null | undefined} item
   * @param {TheoryWeaponStats} stats @param {number} def
   * @param {TheoryScale | null} [scale]
   * @param {TheorySubattack[] | null} [extra]
   * @param {TheoryWeaponEffects | null} [fx]
   * @returns {TheoryWeaponResult}
   */
  function weaponRate(item, stats, def, scale, extra, fx) {
    if (!item || !item.shots || !item.shots.length) return { each: 0, rate: 0, dps: 0 };
    const by = scale || { dmg: 1, rate: 1, life: 1, fast: 1 };
    // Berserk, when it is up: the weapon fires that much faster.
    const haste = (fx && fx.haste) || 1;
    /*
     * A sub-attack that says "set" is the shot now; the weapon's own is gone.
     */
    const swaps = (extra || []).filter(one => one.how === 'set');

    /*
     * Some weapons are made from several Subattack channels rather than one
     * top-level projectile. Each channel has its own projectile, rate and
     * burst. They fire together and their damage must be added.
     */
    const channels = !swaps.length
      ? item.shots.filter(one => one.subattack)
      : [];

    if (channels.length) {
      let dps = 0;
      let totalRate = 0;
      let totalMany = 0;
      let totalEach = 0;
      let burst = null;
      let reach = 0;
      let fast = 0;

      for (const shot of channels) {
        const roll = (shot.low + (shot.high === undefined ? shot.low : shot.high)) / 2
          * by.dmg;
        const each = landed(roll, stats.att, def, shot.pierce, fx);
        const ownRate = shot.rate === undefined
          ? (item.rate === undefined ? 1 : item.rate)
          : shot.rate;

        const rate = SHOTS_AT(stats.dex)
          * ownRate
          * by.rate * haste;

        const many = shot.many || item.many || 1;
        const cycle = burstCycle(
          shot.burst || item.burst,
          rate,
          stats.dex
        );

        dps += cycle
          ? each * many * cycle.shots / cycle.every
          : each * many * rate;

        totalRate += rate * many;
        totalMany += many;
        totalEach += each * many;

        if (!burst && cycle) burst = cycle;
        reach = Math.max(reach, (shot.reach || 0) * by.life * by.fast);
        fast = Math.max(fast, (shot.fast || 8) * by.fast);
      }

      /*
       * Added enchantment volleys still happen once for the weapon firing
       * event. Use the first real channel as that trigger.
       */
      let along = 0;
      for (const one of (extra || [])) {
        if (one.how !== 'add') continue;
        const its = one.shots[0];
        const mid = (its.low + (its.high === undefined ? its.low : its.high)) / 2
          * by.dmg;
        along += landed(mid, stats.att, def, its.pierce, fx) * (one.many || 1);
      }

      if (along && channels.length) {
        const first = channels[0];
        const triggerOwnRate = first.rate === undefined
          ? (item.rate === undefined ? 1 : item.rate)
          : first.rate;

        const triggerRate = SHOTS_AT(stats.dex)
          * triggerOwnRate
          * by.rate * haste;

        if (burst) dps += along * burst.shots / burst.every;
        else dps += along * triggerRate;
      }

      return {
        each: totalMany ? totalEach / totalMany : 0,
        rate: totalMany ? totalRate / totalMany : 0,
        many: totalMany || 1,
        dps,
        burst,
        along,
        reach,
        fast
      };
    }

    const shot = swaps.length ? swaps[swaps.length - 1].shots[0] : item.shots[0];
    const roll = (shot.low + (shot.high === undefined ? shot.low : shot.high)) / 2
      * by.dmg;
    const each = landed(roll, stats.att, def, shot.pierce, fx);
    const rate = SHOTS_AT(stats.dex) * (item.rate === undefined ? 1 : item.rate)
      * by.rate * haste;
    const many = (swaps.length ? swaps[swaps.length - 1].many : item.many) || 1;
    /*
     * A burst weapon does not fire steadily.
     *
     * It looses a run of shots at the usual rate and then stands still for a
     * moment - four from a longbow, five from the S.T.A.F.F. - and the pause
     * is the shorter the more dexterity there is, between the two ends the
     * client states. So the honest figure is the whole cycle: the run takes
     * as long as the shots in it, the pause follows, and what a second is
     * worth is the damage of the run divided by both together. Counting only
     * the run, which is what a page that has not read the burst does, credits
     * these weapons with about twice what they do.
     */
    const cycle = burstCycle(item.burst, rate, stats.dex);
    /*
     * And one that says "add" throws its own volley alongside, at the same
     * rate the weapon fires, with its own damage and its own count.
     */
    let along = 0;
    for (const one of (extra || [])) {
      if (one.how !== 'add') continue;
      const its = one.shots[0];
      const mid = (its.low + (its.high === undefined ? its.low : its.high)) / 2 * by.dmg;
      along += landed(mid, stats.att, def, its.pierce, fx) * (one.many || 1);
    }
    const perShot = each * many + along;
    const dps = cycle
      ? perShot * cycle.shots / cycle.every
      : perShot * rate;
    return {
      each, rate, many, dps, burst: cycle, along,
      reach: (shot.reach || 0) * by.life * by.fast,
      fast: (shot.fast || 8) * by.fast
    };
  }

  /**
   * Capture only the caller's rule tables, by reference. Build state,
   * catalogues and resolved bonuses are supplied anew on every call.
   * @param {TheoryStatRules} rules
   * @returns {{statsOf: (state: TheoryStatState, data: TheoryStatCatalogue, setBonuses: readonly TheorySetBonus[]) => TheoryStatResult | null,
   *   scaleOf: (state: TheoryEquippedState, byEnch: TheoryStatEnchantments) => TheoryScale,
   *   subOf: (state: TheoryEquippedState, byEnch: TheoryStatEnchantments) => TheorySubattack[]}}
   */
  function createStatistics(rules) {
    const { stats: STATS, hands: HANDS, ofStat: OF_STAT } = rules;

    /**
     * Add resolved set bonuses in their original order; set lookup and its
     * indexes belong to the caller. No catalogue or result is retained.
     * @param {TheoryStatState} state @param {TheoryStatCatalogue} data
     * @param {readonly TheorySetBonus[]} setBonuses
     * @returns {TheoryStatResult | null}
     */
    function statsOf(state, data, setBonuses) {
      const kind = data.byClass[state.klass];
      if (!kind) return null;
      /** @type {TheoryStatValues} */
      const out = {};
      /** @type {TheoryStatValues} */
      const base = {};
      /** @type {TheoryStatValues} */
      const top = {};
      for (const [key] of STATS) {
        const ceiling = kind[`${key}Top`];
        const grown = (kind[key] || 0) + (kind.grow[key] || 0) * (state.level - 1);
        // Eight of eight means every potion drunk: the ceiling itself.
        const reached = state.maxed ? ceiling : Math.min(ceiling, grown);
        base[key] = Math.round(reached);
        top[key] = ceiling;
        out[key] = base[key];
      }
      /** @type {TheoryStatSources} */
      const from = { gear: {}, ench: {}, set: {}, exalt: {}, rel: {}, share: {} };

      // Sets first, because they are decided by what is worn rather than by
      // any one piece.
      for (const kit of setBonuses) {
        for (const key of Object.keys(kit.gives)) {
          from.set[key] = (from.set[key] || 0) + kit.gives[key];
        }
      }
      for (const hand of HANDS) {
        const worn = state.gear[hand[0]];
        const item = worn && data.byItem[String(worn.name)];
        if (item && item.worn) {
          for (const tag of Object.keys(item.worn)) {
            const key = OF_STAT[tag];
            if (key) from.gear[key] = (from.gear[key] || 0) + item.worn[tag];
          }
        }
        for (const id of (worn && worn.ench) || []) {
          const spell = id && data.byEnch[id];
          if (!spell || !spell.worn) continue;
          for (const tag of Object.keys(spell.worn)) {
            const key = OF_STAT[tag];
            if (key) from.ench[key] = (from.ench[key] || 0) + spell.worn[tag];
          }
        }
      }
      for (const [key] of STATS) {
        from.exalt[key] = state.exalt ? (state.exalts[key] || 0) : 0;
        out[key] = base[key] + (from.gear[key] || 0) + (from.ench[key] || 0)
          + (from.set[key] || 0) + from.exalt[key];
      }

      /*
       * Then the enchantments that take a share of what the gear gives.
       *
       * "Increases Attack by 16% of Bonus Attack" - the bonus, not the total:
       * what the four items, their enchantments and any set have added, with
       * the class's own statistic and the exaltations left out of it. Worth
       * nothing on a bare character and a great deal on a good one, which is
       * why every build worth the name is full of them.
       *
       * They are taken from the bonus as it stood before any of them applied,
       * so two cannot feed on each other.
       */
      {
        /** @type {TheoryStatValues} */
        const bonus = {};
        for (const [key] of STATS) {
          bonus[key] = (from.gear[key] || 0) + (from.ench[key] || 0) + (from.set[key] || 0);
        }
        /** @param {TheoryStatShare} part @returns {void} */
        const takes = part => {
          const key = OF_STAT[part.stat], of = OF_STAT[part.of];
          if (!key || !of) return;
          const much = bonus[of] * part.pct / 100;
          from.rel[key] = (from.rel[key] || 0) + much;
          out[key] += much;
        };
        for (const hand of HANDS) {
          const worn = state.gear[hand[0]];
          // A few items are built the same way: the Ring of Cubed Wisdom is a
          // hundred and seventy-five per cent of your bonus wisdom as life.
          const item = worn && data.byItem[String(worn.name)];
          for (const part of (item && item.rel) || []) takes(part);
          for (const id of (worn && worn.ench) || []) {
            const one = id && data.byEnch[id];
            for (const part of (one && one.rel) || []) takes(part);
          }
        }
        /* Kept, so the page can say what a share came to without working the
           bonus out a second time and drifting from the sum that counted. */
        from.bonus = bonus;
      }

      /*
       * And last, the ones given as a share of another statistic.
       *
       * The Wretched Rags do not add life: they take half of it away and give
       * back all of your mana as life, which on a wizard with nine hundred mana
       * is eight hundred and fifty. They are read after everything else,
       * because a share is a share of the whole - what the class has, what is
       * worn and what the exaltations added - and taken from the totals as they
       * stood before any share was applied, so two of them cannot feed on each
       * other.
       */
      const stood = Object.assign({}, out);
      for (const hand of HANDS) {
        const worn = state.gear[hand[0]];
        const item = worn && data.byItem[String(worn.name)];
        for (const part of (item && item.share) || []) {
          const key = OF_STAT[part.stat], of = OF_STAT[part.of];
          if (!key || !of) continue;
          const much = stood[of] * part.pct / 100;
          from.share[key] = (from.share[key] || 0) + much;
          out[key] += much;
        }
      }

      for (const [key] of STATS) out[key] = Math.round(out[key] * 10) / 10;
      return { now: out, base, top, from };
    }

    /**
     * @param {TheoryEquippedState} state @param {TheoryStatEnchantments} byEnch
     * @returns {TheoryScale}
     */
    function scaleOf(state, byEnch) {
      const out = { dmg: 1, rate: 1, life: 1, fast: 1 };
      for (const [hand] of HANDS) {
        const worn = state.gear[hand];
        for (const id of (worn && worn.ench) || []) {
          const one = id && byEnch[id];
          if (!one || !one.mul) continue;
          for (const key of /** @type {(keyof TheoryScale)[]} */ (Object.keys(out))) {
            if (one.mul[key] !== undefined) out[key] *= one.mul[key];
          }
        }
      }
      return out;
    }

    /**
     * Return a fresh list containing the original catalogue objects.
     * @param {TheoryEquippedState} state @param {TheoryStatEnchantments} byEnch
     * @returns {TheorySubattack[]}
     */
    function subOf(state, byEnch) {
      const out = [];
      for (const [hand] of HANDS) {
        const worn = state.gear[hand];
        for (const id of (worn && worn.ench) || []) {
          const one = id && byEnch[id];
          for (const part of (one && one.sub) || []) out.push(part);
        }
      }
      return out;
    }

    return { statsOf, scaleOf, subOf };
  }

  return { SHOTS_AT, landed, burstCycle, weaponRate, createStatistics };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TheoryEngine;
