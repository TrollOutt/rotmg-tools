/* Pure weapon arithmetic. Catalogue lookup, status modelling and search stay
 * with the caller; every value used here is supplied in the arguments. */
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

  return { SHOTS_AT, landed, burstCycle, weaponRate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TheoryEngine;
