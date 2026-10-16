/* Weapon, statistic, set, build numbers, scoring, goals, candidates and optimisation
 * with explicit inputs. Catalogue ownership, status modelling and scheduling stay with the caller. */
/**
 * @typedef {{many: number, wait: number, rush: number}} TheoryBurst
 * @typedef {{every: number, shots: number, wait: number, run: number}} TheoryBurstCycle
 * @typedef {{d: number, radius: number, gap: number}} TheoryStand
 * @typedef {TheoryStand | number | null} TheoryAim
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
 * @typedef {{shots?: TheoryShot[], rate?: number, many?: number, burst?: TheoryBurst, fan?: number}} TheoryWeapon
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
 *   mul?: Partial<TheoryScale>, sub?: TheorySubattack[], heal?: Record<string, number>}} TheoryStatEnchantment
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
 *   regen: TheoryStatValues,
 *   bonus?: TheoryStatValues}} TheoryStatSources
 * @typedef {{now: TheoryStatValues, base: TheoryStatValues, top: TheoryStatValues,
 *   from: TheoryStatSources}} TheoryStatResult
 * @typedef {{stats: readonly (readonly [TheoryStatKey, ...string[]])[],
 *   hands: readonly (readonly string[])[],
 *   ofStat: Readonly<Record<string, TheoryStatKey | undefined>>}} TheoryStatRules
 */
/**
 * @typedef {string} TheorySetPiece
 * @typedef {{name: string, pieces: TheorySetPiece[], steps: Record<string, TheoryStatValues>}} TheorySetKit
 * @typedef {{kit: TheorySetKit, order: number}} TheorySetIndexEntry
 * @typedef {TheorySetIndexEntry & {many: number, ours: boolean}} TheorySetHit
 * @typedef {{name: string, many: number, gives: TheoryStatValues}} TheorySetResult
 * @typedef {Pick<TheoryStatRules, 'hands' | 'ofStat'>} TheorySetRules
 */
/**
 * @typedef {TheoryStatState & {boss?: string, assume?: Record<string, boolean>,
 *   using?: string, damage?: string, range?: string}} TheoryNumbersState
 * @typedef {number} TheoryNumbersDefence
 * @typedef {TheoryStatResult & {now: Record<TheoryStatKey, number>}} TheoryNumbersStats
 * @typedef {TheoryWeapon & {mp?: number, cool?: number,
 *   cast?: {from?: number, stat?: string, dmg?: number, shots?: number, more?: number}}} TheoryNumbersItem
 * @typedef {{byItem: Record<string, TheoryNumbersItem | undefined>}} TheoryNumbersCatalogue
 * @typedef {{up: Record<string, number>, from: Record<string, string>,
 *   bleed: number, immune: Set<string>}} TheoryNumbersEffects
 * @typedef {{each: number, every: number, dps: number, many?: number}} TheoryAbilityResult
 * @typedef {TheoryWeaponResult & TheoryAbilityResult & {many: number}} TheoryInactiveResult
 * @typedef {{low: number, high: number}} TheoryDamagePart
 * @typedef {{hp: number, mp: number}} TheoryGain
 * @typedef {{combat: number, calm: number}} TheoryRegenRate
 * @typedef {{hp: TheoryRegenRate, mp: TheoryRegenRate, bonus: TheoryGain,
 *   healing: number, inCombat: number}} TheoryRegen
 * @typedef {TheoryNumbersStats & {penalty: TheoryStatValues}} TheoryFought
 * @typedef {{boost: TheoryStatValues, gain: TheoryGain, list: unknown[]}} TheoryTemper
 * @typedef {{low: number, high: number, list: unknown[], by: Record<string, TheoryDamagePart>}} TheorySpecial
 * @typedef {{stats: TheoryNumbersStats, gun: TheoryWeaponResult,
 *   spell: TheoryAbilityResult, effects: TheoryNumbersEffects | null,
 *   fought: TheoryFought, regen: TheoryRegen, special: TheorySpecial, temper: TheoryTemper | null,
 *   parts: Record<string, TheoryDamagePart>, bleed: number, total: number, chosen: number}} TheoryNumbersResult
 * @typedef {Object} TheoryNumbersDependencies
 * @property {() => TheoryNumbersCatalogue} getData Read the current catalogue at each lookup.
 * @property {(state: TheoryNumbersState) => TheoryNumbersStats | null} statsOf Includes the caller's set resolution.
 * @property {(state: TheoryNumbersState) => TheoryScale} scaleOf
 * @property {(state: TheoryNumbersState) => TheorySubattack[]} subOf
 * @property {(item: TheoryWeapon | null | undefined, stats: TheoryWeaponStats,
 *   def: number, scale?: TheoryScale | null, extra?: TheorySubattack[] | null,
 *   fx?: TheoryWeaponEffects | null, gap?: TheoryAim) => TheoryWeaponResult} weaponRate
 * @property {(item: TheoryNumbersItem | undefined, stats: TheoryNumbersStats['now'],
 *   def: TheoryNumbersDefence, fx: TheoryWeaponEffects | null, mana?: number,
 *   cost?: number, struck?: number, gap?: TheoryAim) => TheoryAbilityResult} abilityRate
 * @property {(state: TheoryNumbersState, stats: TheoryNumbersStats['now'],
 *   mana?: number, cost?: number) => TheoryNumbersEffects | null} effectsFor
 * @property {(effects: TheoryNumbersEffects | null) => TheoryWeaponEffects | null} fxOf
 * @property {(state: TheoryNumbersState, stats: TheoryNumbersStats) => TheoryFought} fightOf
 * @property {(state: TheoryNumbersState) => number} costOf
 * @property {(stats: TheoryNumbersStats, assume: TheoryNumbersState['assume'], fought: TheoryFought,
 *   gain?: TheoryGain) => TheoryRegen} regenOf
 * @property {(state: TheoryNumbersState) => {gains?: unknown[], boosts?: unknown[]}[]} wornEffects
 * @property {(state: TheoryNumbersState, shots: number, casts: number,
 *   up: Record<string, number> | null) => TheoryTemper} temperOf
 * @property {(state: TheoryNumbersState) => TheoryStand} standOf
 * @property {(state: TheoryNumbersState, stats: TheoryNumbersStats['now'], def: number, shots: number,
 *   up: Record<string, number> | null, casts: number, gap: TheoryStand) => TheorySpecial} specialsOf
 */
/**
 * @typedef {TheoryNumbersState & {boss: string, against: number}} TheoryScoreState
 * @typedef {TheoryNumbersResult} TheoryScoreNumbers
 * @typedef {{id: string, of: (numbers: TheoryScoreNumbers, state: TheoryScoreState) => number}} TheoryScoreGoal
 * @typedef {{byBoss: Record<string, {def: number} | undefined>}} TheoryScoreCatalogue
 * @typedef {{getData: () => TheoryScoreCatalogue,
 *   numbersFor: (state: TheoryScoreState, def: number) => TheoryScoreNumbers | null}} TheoryScoreDependencies
 */
/**
 * @typedef {{worn?: TheoryStatValues, set?: unknown, share?: unknown, rel?: unknown,
 *   sub?: unknown, mul?: unknown, heal?: unknown, alters?: unknown, does?: unknown,
 *   cast?: unknown, many?: unknown, burst?: unknown, shots?: TheoryShot[]}} TheoryComparable
 * @typedef {TheoryComparable & {id: string}} TheoryBeatenEnchantment
 * @typedef {TheoryComparable & {name: string, hand: string, slot?: number, mp?: number}} TheoryBeatenItem
 * @typedef {{enchants?: TheoryBeatenEnchantment[], items: TheoryBeatenItem[]}} TheoryBeatenCatalogue
 * @typedef {{ench: Set<string>, gear: Set<string>}} TheoryBeatenResult
 */
/**
 * @typedef {{name: string, hand: string, slot?: number}} TheorySearchItem
 * @typedef {{items: TheorySearchItem[],
 *   byClass: Record<string, {slots: number[]} | undefined>}} TheoryItemSearchCatalogue
 * @typedef {{banned?: Record<string, unknown>}} TheoryItemSearchState
 * @typedef {{getData: () => TheoryItemSearchCatalogue, hands: readonly (readonly string[])[],
 *   accessible: (name: string) => boolean}} TheoryItemSearchDependencies
 */
/**
 * @typedef {TheoryStatEnchantment & {id: string, name: string,
 *   heal?: {flatHP?: number, partHP?: number, flatMP?: number, partMP?: number,
 *     soak?: number}}} TheoryCharm
 * @typedef {import('./engine').Enchantment} TheoryEnchantment
 * @typedef {import('./engine').EnchantDataset} TheoryEnchantRules
 * @typedef {import('./engine').EnchantPoolConfig} TheoryEnchantPoolConfig
 * @typedef {TheoryEnchantment[]} TheoryEnchantPool
 * @typedef {Pick<typeof import('./engine'), 'obtainablePool' | 'subtypesForItem'>} TheoryEnchantEngine
 * @typedef {{enchants: TheoryCharm[], byEnch: Record<string, TheoryCharm | undefined>,
 *   byItem: Record<string, {hand: string} | undefined>}} TheoryEnchantCatalogue
 * @typedef {(string | null | undefined)[]} TheoryEnchantSlots
 * @typedef {TheoryCharm & {roll: number}} TheoryEnchantChoice
 * @typedef {Object} TheoryEnchantDependencies
 * @property {() => TheoryEnchantCatalogue} getData Read each catalogue at the original lookup site.
 * @property {(name: string) => string} plainly
 * @property {(name: string) => string} enchantKey
 * @property {(one: TheoryCharm | undefined) => number} worth
 * @property {RegExp} numeral
 * @property {() => TheoryEnchantEngine} getEngine Resolve only when loaded rules need the engine.
 * @property {() => TheoryEnchantRules | false | null | undefined} rulesFor
 * @property {Readonly<Record<string, string | undefined>>} ofHand
 */
/**
 * @typedef {TheoryScoreState & {goals?: string[], goal?: string,
 *   locked: Record<string, boolean>, share?: Record<string, unknown> | null}} TheoryGoalState
 * @typedef {TheoryScoreGoal & {say: string}} TheoryGoal
 * @typedef {{goal: TheoryGoal, raw: number, part: number}} TheoryGoalShare
 * @typedef {Record<string, number>} TheoryGoalBest
 * @typedef {TheoryGoal & {goals?: TheoryGoal[]}} TheoryGoalResult
 * @typedef {Object} TheoryGoalDependencies
 * @property {() => TheoryGoal[]} getGoals Read the current goal objects, without copying them.
 * @property {() => Record<string, unknown> | null | undefined} getBanned Read the current build's bans for each cache key.
 * @property {(state: TheoryGoalState, goal: TheoryGoal, report: null) => {score: number}} optimise Retains the caller's live progression and catalogue access.
 * @property {(state: TheoryGoalState, goal: TheoryGoal) => number} scoreOf
 * @property {(state: TheoryGoalState) => TheoryGoalShare[]} sharesOf
 */
/**
 * @typedef {{share?: Record<string, unknown> | null}} TheoryShareState
 * @typedef {{goalsOf: (state: TheoryGoalState) => TheoryGoal[]}} TheoryShareDependencies
 */
/**
 * @typedef {(string | null)[]} TheoryOptimiserSlots
 * @typedef {{name: string | null, slots: number, ench: TheoryOptimiserSlots}} TheoryOptimiserEquipment
 * @typedef {TheoryScoreState & {gear: Record<string, TheoryOptimiserEquipment>,
 *   locked: Record<string, boolean>, scope?: string}} TheoryOptimiserState
 * @typedef {TheorySearchItem & {tier?: number}} TheoryOptimiserCandidate
 * @typedef {TheoryEnchantChoice & {labels?: string}} TheoryOptimiserEnchantCandidate
 * @typedef {{key: string, score: number, gear: Record<string, string>}} TheoryOptimiserOffer
 * @typedef {Map<string, TheoryOptimiserOffer>} TheoryOptimiserGather
 * @typedef {(pass: number, looked: number, score: number) => void} TheoryOptimiserReport
 * @typedef {{state: TheoryOptimiserState, score: number, looked: number}} TheoryOptimiserResult
 * @typedef {{byItem: Record<string, {tier?: number} | undefined>,
 *   byEnch: Record<string, TheoryCharm | undefined>, sets?: {pieces: string[]}[]}} TheoryOptimiserCatalogue
 * @typedef {Object} TheoryOptimiserDependencies
 * @property {() => {mode: string} | null | undefined} getProfile Read only when the generator first advances.
 * @property {() => unknown} getAccess Read only for a personal profile at the original guard.
 * @property {() => TheoryOptimiserCatalogue} getData Read the catalogue at every original lookup site.
 * @property {readonly (readonly string[])[]} hands
 * @property {number} gatherKeep
 * @property {(a: TheoryOptimiserOffer, b: TheoryOptimiserOffer) => number} byScoreThenSignature
 * @property {(state: TheoryOptimiserState) => string} gearSignature
 * @property {(state: TheoryOptimiserState) => TheoryOptimiserState} prepareSearchable Retains live catalogue, progression and search filters.
 * @property {(hand: string, klass: string, state: TheoryOptimiserState) => TheoryOptimiserCandidate[]} searchItems
 * @property {(name: string, already: TheoryOptimiserSlots, at: number) => TheoryOptimiserEnchantCandidate[]} searchEnchants
 * @property {(name: string, already: TheoryOptimiserSlots, at: number) => boolean} enchantFitsItem
 * @property {(one: TheoryCharm | undefined) => number} worth
 * @property {(state: TheoryOptimiserState, goal: TheoryScoreGoal) => number} scoreOf
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

  // A shot that flies this far reaches a target this far off (a shot whose reach the client does not give is not held back).
  // Accepts the distance to cover, or the whole stand.
  /** @param {number | undefined} reach @param {TheoryAim} [aim] @returns {boolean} */
  const reaches = (reach, aim) => {
    const gap = aim && typeof aim === 'object' ? aim.gap : aim;
    return !(gap !== undefined && gap !== null && gap > 0) || reach === undefined || reach >= gap;
  };
  /*
   * A volley is not a wall: its shots leave at angles, and one aimed at the middle of a target that is far off may
   * pass either side of it. Of `many` shots, those whose line is no more than the target's radius from its middle when
   * it gets there (distance times the tangent of the angle) hit; a round volley is spread over the whole circle, a
   * fanned one by the arc gap between neighbours. Standing on the target, or with no stand given, every shot hits.
   */
  /** @param {number} many @param {number | undefined} fan @param {boolean} round
   * @param {TheoryAim} [aim] @returns {number} */
  function fanHits(many, fan, round, aim) {
    if (!aim || typeof aim !== 'object' || !(aim.d > 0) || !(many > 1)) return many;
    let hit = 0;
    for (let i = 0; i < many; i++) {
      let angle = round ? (i / many) * 2 * Math.PI : (i - (many - 1) / 2) * (fan || 12) * Math.PI / 180;
      angle = Math.abs(((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (angle < Math.PI / 2 && aim.d * Math.tan(angle) <= aim.radius) hit++;
    }
    return hit;
  }

  /**
   * @param {TheoryWeapon | null | undefined} item
   * @param {TheoryWeaponStats} stats @param {number} def
   * @param {TheoryScale | null} [scale]
   * @param {TheorySubattack[] | null} [extra]
   * @param {TheoryWeaponEffects | null} [fx]
   * @param {TheoryAim} [gap] @param {boolean} [curves]
   * @returns {TheoryWeaponResult}
   */
  function weaponRate(item, stats, def, scale, extra, fx, gap, curves) {
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
        if (!reaches(shot.reach === undefined ? undefined : shot.reach * by.life * by.fast, gap)) continue;
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
        if (!reaches(its.reach === undefined ? undefined : its.reach * by.life * by.fast, gap)) continue;
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
      if (!reaches(its.reach === undefined ? undefined : its.reach * by.life * by.fast, gap)) continue;
      const mid = (its.low + (its.high === undefined ? its.low : its.high)) / 2 * by.dmg;
      along += landed(mid, stats.att, def, its.pierce, fx) * (one.many || 1);
    }
    // Out of reach of the target, the weapon's own shot does nothing.
    const near = reaches(shot.reach === undefined ? undefined : shot.reach * by.life * by.fast, gap);
    const perShot = (near ? each * (curves ? many : fanHits(many, item.fan, false, gap)) : 0) + along;
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
      const from = { gear: {}, ench: {}, set: {}, exalt: {}, rel: {}, share: {}, regen: {} };

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
          if (!spell) continue;
          // Regeneration the enchantment adds on top of what VIT and WIS bring (see regenOf).
          for (const kind of ['flatHP', 'flatMP', 'partHP', 'partMP']) {
            if (spell.heal && spell.heal[kind]) from.regen[kind] = (from.regen[kind] || 0) + spell.heal[kind];
          }
          if (!spell.worn) continue;
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

  /**
   * Own indexes for one caller lifetime. Read the current catalogue only on
   * the first request, retaining kit and rule-table references thereafter.
   * @param {TheorySetRules} rules
   * @param {() => TheorySetKit[] | null | undefined} getSets
   * @returns {{setsOn: (gear: TheoryEquippedState['gear']) => TheorySetResult[],
   *   timesListed: (piece: TheorySetPiece) => number}}
   */
  function createSets(rules, getSets) {
    const { hands: HANDS, ofStat: OF_STAT } = rules;
    /** @type {Map<TheorySetPiece, number> | null} */
    let sharedPieces = null;
    /** @type {Map<TheorySetPiece, TheorySetIndexEntry[]> | null} */
    let setsByPiece = null;

    /** @returns {{sharedPieces: Map<TheorySetPiece, number>, setsByPiece: Map<TheorySetPiece, TheorySetIndexEntry[]>}} */
    function ensureSetIndex() {
      if (sharedPieces && setsByPiece) return { sharedPieces, setsByPiece };

      sharedPieces = new Map();
      setsByPiece = new Map();

      for (const [order, kit] of (getSets() || []).entries()) {
        for (const piece of kit.pieces) {
          sharedPieces.set(piece, (sharedPieces.get(piece) || 0) + 1);
          let entries = setsByPiece.get(piece);
          if (!entries) setsByPiece.set(piece, entries = []);
          entries.push({ kit, order });
        }
      }
      return { sharedPieces, setsByPiece };
    }

    /** @param {TheorySetPiece} name @returns {number} */
    function timesListed(name) {
      const { sharedPieces } = ensureSetIndex();
      return sharedPieces.get(name) || 0;
    }

    /** @param {TheoryEquippedState['gear']} gear @returns {TheorySetResult[]} */
    function setsOn(gear) {
      const { setsByPiece } = ensureSetIndex();

      const worn = new Set(HANDS.map(h => (gear[h[0]] || {}).name).filter(/** @returns {name is string} */ (name) => Boolean(name)));
      /** @type {Map<TheorySetKit, TheorySetHit>} */
      const hits = new Map();

      /*
       * Only sets containing something actually worn can possibly pay.
       * Record their hit count while walking the four equipped pieces instead
       * of walking every piece of every set for every optimiser score.
       */
      for (const piece of worn) {
        for (const { kit, order } of setsByPiece.get(piece) || []) {
          let hit = hits.get(kit);
          if (!hit) {
            hit = { kit, order, many: 0, ours: false };
            hits.set(kit, hit);
          }
          hit.many++;
          // Something that belongs to this set and to no other.
          if (timesListed(piece) === 1) hit.ours = true;
        }
      }

      const out = [];
      const active = Array.from(hits.values()).sort((a, b) => a.order - b.order);

      for (const hit of active) {
        const kit = hit.kit;
        const howMany = hit.many;
        /*
         * A set pays only when something you are wearing is its own.
         *
         * The alien sets list the same three dozen weapons and the same nine
         * suits of armour as each other, and differ only in the core that goes
         * on the finger - so an alien weapon and an alien suit, counted
         * plainly, satisfied two pieces of thirteen different sets at once and
         * handed over all thirteen bonuses. What separates them is the piece
         * that appears in one list and nowhere else.
         */
        if (howMany < 2 || !hit.ours) continue;
        /** @type {TheoryStatValues} */
        const gives = {};
        for (const step of Object.keys(kit.steps)) {
          if (Number(step) > howMany) continue;
          for (const tag of Object.keys(kit.steps[step])) {
            const key = OF_STAT[tag] || OF_STAT[tag.replace(/^MAX/, '')];
            if (key) gives[key] = (gives[key] || 0) + kit.steps[step][tag];
          }
        }
        if (Object.keys(gives).length) out.push({ name: kit.name, many: howMany, gives });
      }
      return out;
    }

    return { setsOn, timesListed };
  }

  /**
   * Compose one build's numbers without owning catalogue, status or search
   * caches. The callbacks retain their live data/status access and lifetime.
   * Only the inactive-hand result is shared, once per caller as before.
   * @param {TheoryNumbersDependencies} dependencies
   * @returns {{numbersFor: (state: TheoryNumbersState, def: TheoryNumbersDefence) => TheoryNumbersResult | null}}
   */
  function createNumbers(dependencies) {
    const { getData, statsOf, scaleOf, subOf, weaponRate, abilityRate, effectsFor, fxOf,
      fightOf, costOf, regenOf, wornEffects, temperOf, standOf, specialsOf } = dependencies;
    /** @type {TheoryInactiveResult} */
    const NONE = { each: 0, rate: 0, many: 1, every: 0, dps: 0 };

    /**
     * @param {TheoryNumbersState} state @param {TheoryNumbersDefence} def
     * @returns {TheoryNumbersResult | null}
     */
    function numbersFor(state, def) {
      const stats = statsOf(state);
      if (!stats) return null;
      /*
       * The weapon, and only the weapon.
       *
       * An ability is a different question with different arithmetic - what it
       * costs, how the pool pays for it, whether it lands where you are or
       * where you are aiming - and answering both at once was making a mess of
       * each. The ability side is set aside until the weapon side is right; the
       * seam is here, not deleted.
       */
      const using = /** @type {'gun' | 'spell'} */ ('gun');
      const weapon = getData().byItem[String((state.gear.weapon || {}).name)];
      const ability = getData().byItem[String((state.gear.ability || {}).name)];
      const scale = scaleOf(state);
      // The status effects the build keeps up, its own and the party's it assumes.
      // A fight is in combat: what the worn gear costs you then (see fightOf) counts here.
      let fought = fightOf(state, stats);
      const cost = costOf(state);
      let regen = regenOf(stats, state.assume, fought);
      // Gear that hands out magic, life or a raised statistic when you shoot or cast (rare, so only then is it worked out).
      let temper = null;
      if (wornEffects(state).some(one => one.gains || one.boosts)) {
        const up0 = effectsFor(state, fought.now, regen.mp.combat, cost);
        const gun0 = weaponRate(weapon, fought.now, def, scale, subOf(state), null);
        const cast0 = abilityRate(ability, fought.now, def, null, regen.mp.combat, cost);
        temper = temperOf(state, gun0.rate || 0, cast0.every ? 1 / cast0.every : 0, up0 && up0.up);
        const now = { ...fought.now };
        for (const key of Object.keys(temper.boost)) now[key] = Math.max(0, (now[key] || 0) + temper.boost[key]);
        fought = { ...fought, now };
        regen = regenOf(stats, state.assume, fought, temper.gain);
      }
      const effects = effectsFor(state, fought.now, regen.mp.combat, cost);
      const fx = fxOf(effects);
      const gap = standOf(state);
      const gun = using === 'spell' ? NONE
        : weaponRate(weapon, fought.now, def, scale, subOf(state), fx, gap);
      // The ability is worked out, but kept apart from the total: see the note above on what the page judges a build by.
      const spell = abilityRate(ability, fought.now, def, fx, regen.mp.combat, cost, gun.each > 0 ? gun.dps / gun.each : 0, gap);
      const bleed = effects ? effects.bleed : 0;
      const special = specialsOf(state, fought.now, def, gun.rate, effects && effects.up, spell.every > 0 ? 1 / spell.every : 0, gap);
      // Where the damage a second comes from: each worn piece's own shots and what they set off, and all of it together.
      /** @param {string} hand @param {number} base @returns {TheoryDamagePart} */
      const piece = (hand, base) => ({ low: base + ((special.by[hand] || {}).low || 0), high: base + ((special.by[hand] || {}).high || 0) });
      /** @type {Record<string, TheoryDamagePart>} */
      const parts = { weapon: piece('weapon', gun.dps + bleed), ability: piece('ability', spell.dps), armor: piece('armor', 0), ring: piece('ring', 0) };
      parts.all = { low: 0, high: 0 };
      for (const hand of ['weapon', 'ability', 'armor', 'ring']) { parts.all.low += parts[hand].low; parts.all.high += parts[hand].high; }
      const total = (using === 'spell' ? 0 : gun.dps) + bleed;
      // The damage the reader asked to count: the weapon's shots, the ability, or every piece worn (at the low end of what is estimated).
      const chosen = state.damage === 'all' ? parts.all.low : state.damage === 'ability' ? parts.ability.low : total;
      return { stats, fought, gun, spell, effects, bleed, regen, special, temper, parts, total, chosen };
    }

    return { numbersFor };
  }

  /**
   * Create the score function once, retaining live boss catalogue access.
   * @param {TheoryScoreDependencies} dependencies
   * @returns {(state: TheoryScoreState, goal: TheoryScoreGoal) => number}
   */
  function createScore(dependencies) {
    const { getData, numbersFor } = dependencies;

    /** @param {TheoryScoreState} state @param {TheoryScoreGoal} goal @returns {number} */
    function scoreOf(state, goal) {
      const boss = getData().byBoss[state.boss];
      const def = goal.id === 'kill' && boss ? boss.def : state.against;
      const numbers = numbersFor(state, def);
      if (!numbers) return -Infinity;
      return goal.of(numbers, state);
    }

    return scoreOf;
  }

  /**
   * Create raw and relative shares once. The callback resolves goal selection
   * only when called, allowing the goal factory to receive sharesOf in turn.
   * @param {TheoryShareDependencies} dependencies
   * @returns {{shareOf: (state: TheoryShareState, id: string) => number,
   *   sharesOf: (state: TheoryGoalState) => TheoryGoalShare[]}}
   */
  function createShares({ goalsOf }) {
    /** @param {TheoryShareState} state @param {string} id @returns {number} */
    function shareOf(state, id) {
      const want = state.share || {};
      const n = Number(want[id]);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }

    /** @param {TheoryGoalState} state @returns {TheoryGoalShare[]} */
    function sharesOf(state) {
      const list = goalsOf(state);
      let all = 0;
      for (const one of list) all += shareOf(state, one.id);
      return list.map(one => ({
        goal: one,
        raw: shareOf(state, one.id),
        part: all > 0 ? shareOf(state, one.id) / all : 1 / list.length
      }));
    }

    return { shareOf, sharesOf };
  }

  /**
   * Create goal selection and its one-entry ideal cache once. As before, only
   * the serialized key invalidates it; profile/catalogue replacement alone does not.
   * @param {TheoryGoalDependencies} dependencies
   * @returns {{goalsOf: (state: TheoryGoalState) => TheoryGoal[],
   *   bestAlone: (state: TheoryGoalState, list: TheoryGoal[]) => TheoryGoalBest,
   *   aimOf: (state: TheoryGoalState, goals?: TheoryGoal[] | null) => TheoryGoalResult}}
   */
  function createGoals({ getGoals, getBanned, optimise, scoreOf, sharesOf }) {
    /* Which of them are being asked for, with the old single choice honoured. */
    /** @param {TheoryGoalState} state @returns {TheoryGoal[]} */
    function goalsOf(state) {
      const want = state.goals && state.goals.length
        ? state.goals : [state.goal || 'dps'];
      const out = getGoals().filter(one => want.includes(one.id));
      return out.length ? out : [getGoals()[0]];
    }

    /*
     * Asking for more than one thing at once.
     *
     * Damage is in the thousands, survival in seconds and dexterity in dozens,
     * so they cannot be added as they stand. Each is measured against what the
     * build already has of it, which turns every one of them into the same kind
     * of number, and against the best that thing could reach on its own, which
     * is what makes the shares mean something.
     *
     * What this is NOT any more is a weighted sum of those numbers, and the
     * reason is worth setting down because the sum looks obviously right.
     *
     * Maximising a weighted sum over a set of things you either wear or do not
     * always lands on a corner of the set. Move the slider and the answer does
     * not slide with it: it sits still, sits still, and then jumps. Worse, any
     * build that is a fair compromise but not a corner can never be chosen at
     * any setting whatever. That is not a tuning problem, it is what the sum is.
     *
     * Measured on this game's rings, against damage and life: the four that are
     * worth wearing at all are Decades Chronicle, Collector's Monocle,
     * Chrysalis of Eternity and Overclocking Amulet. The sum reaches three of
     * them. Collector's Monocle - eight points of damage for a hundred and
     * forty of life, a perfectly reasonable middle - lies just inside the line
     * between its neighbours, and no share the reader can set will ever pick
     * it. What the reader sees instead is the jump: one per cent of the slider
     * turning a hundred and twenty life into two points of damage.
     *
     * So the shares are read as tolerances rather than as weights. Each goal
     * knows how far it is from the best it could have been, alone; that
     * shortfall is multiplied by the share; and the build chosen is the one
     * whose worst weighted shortfall is smallest. Asking for little of
     * something is then a statement that it is allowed to fall behind, which is
     * what anybody moving that slider means. The whole of the frontier can be
     * reached this way, corners and middles alike - all four rings, in the same
     * measurement.
     *
     * The small sum on the end is a tiebreak. Judging only by the worst goal
     * leaves builds that are equal at their worst and unequal everywhere else
     * looking identical, so what is left over settles it.
     */
    const AUGMENT = 1e-3;

    /*
     * The best each goal could reach alone, worked out once and kept.
     *
     * It costs a search per goal, which is real money: with two goals it took
     * the whole thing from eleven seconds to twenty-seven the first time it was
     * measured. But none of it depends on where the slider is - the best damage
     * a build could possibly do is the same number whether the reader is asking
     * for a tenth of it or all of it - and moving the slider is exactly what
     * this change was made for. So it is remembered against everything that
     * does change the answer, and a reader sweeping the slider pays for it
     * once rather than on every press.
     */
    /** @type {{key: null, best: null} | {key: string, best: TheoryGoalBest}} */
    let ideals = { key: null, best: null };

    /** @param {TheoryGoalState} state @param {TheoryGoal[]} list @returns {TheoryGoalBest} */
    function bestAlone(state, list) {
      const key = JSON.stringify([state.klass, state.level, state.boss, state.against,
        state.gear, state.locked, state.exalt, getBanned() || null,
        state.range, state.damage,
        list.map(one => one.id)]);
      if (ideals.key === key) return ideals.best;
      /** @type {TheoryGoalBest} */
      const best = {};
      for (const one of list) {
        const alone = optimise(state, one, null);
        const was = scoreOf(state, one);
        best[one.id] = Number.isFinite(alone.score) ? alone.score
          : (Number.isFinite(was) ? was : 0);
      }
      ideals = { key, best };
      return best;
    }

    /**
     * @param {TheoryGoalState} state @param {TheoryGoal[] | null} [goals]
     * @returns {TheoryGoalResult}
     */
    function aimOf(state, goals) {
      const list = goals || goalsOf(state);
      if (list.length === 1) return list[0];
      const parts = new Map(sharesOf(state).map(one => [one.goal.id, one.part]));
      const best = bestAlone(state, list);
      /** @type {Record<string, number>} */
      const span = {};
      /** @type {Record<string, number>} */
      const pull = {};
      for (const one of list) {
        const was = scoreOf(state, one);
        const from = Number.isFinite(was) ? was : 0;
        /*
         * A shortfall is measured against the room the goal has, not against
         * where it started.
         *
         * Dividing by the starting value looks like the same thing and is not.
         * A bare build of this class does ninety-one damage a second and can be
         * taken to seventy-three thousand, which is eight hundred times over;
         * its life goes from seven hundred and thirty to eighteen hundred,
         * which is two and a half times. Read that way the damage shortfall is
         * always the larger number by a factor of three hundred, so damage is
         * always the worst goal and always wins, and the slider does nothing at
         * all - which is what it did when this was first written.
         *
         * Against the room instead, both run from one at the starting build to
         * nought at the best that goal can do. Then a share is a share of
         * something, and moving it moves the answer.
         */
        const reach = Math.abs(best[one.id] - from);
        span[one.id] = reach > 1e-9 ? reach : 1;
        // Never nought: a goal that is on is never silently switched off.
        pull[one.id] = Math.max(1e-6, parts.get(one.id) || 1 / list.length);
      }
      return {
        id: list.map(one => one.id).join('+'),
        say: list.map(one => one.say.toLowerCase()).join(' and '),
        goals: list,
        of: (numbers, at) => {
          let worst = -Infinity, rest = 0;
          for (const one of list) {
            const short = (best[one.id] - one.of(numbers, at)) / span[one.id];
            rest -= short;
            const felt = pull[one.id] * short;
            if (felt > worst) worst = felt;
          }
          return -worst + AUGMENT * rest;
        }
      };
    }

    return { goalsOf, bestAlone, aimOf };
  }

  /**
   * Retain the caller's lazy cache lifetime, including explicit profile invalidation.
   * @param {() => TheoryBeatenCatalogue} getData
   */
  function createBeaten(getData) {
    const COUNTS = ['ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS', 'MAXHP', 'MAXMP'];
    /** @param {TheoryComparable} one @param {string} key @returns {number} */
    const stat = (one, key) => (one && one.worn && one.worn[key]) || 0;
    // Worth more than its own statistics: not comparable, so not dropped.
    /** @param {TheoryComparable} one @returns {boolean} */
    const deeper = one => !!(one.set || one.share || one.rel || one.sub || one.mul
      || one.heal || one.alters || one.does || one.cast || one.many || one.burst
      || (one.shots || []).some(shot => shot.subattack));

    /** @type {TheoryBeatenResult | null} */
    let beaten = null;
    /** @returns {TheoryBeatenResult} */
    function beatenOnes() {
      if (beaten) return beaten;
      beaten = { ench: new Set(), gear: new Set() };

      /*
       * Enchantments, within one family: same identifier but for the tier on
       * the end, so the four Attack -Defense Tradeoffs are compared with each
       * other and with nothing else.
       */
      /** @type {Map<string, TheoryBeatenEnchantment[]>} */
      const family = new Map();
      for (const one of getData().enchants || []) {
        const stem = String(one.id).replace(/_[1-4]$/, '');
        if (stem === String(one.id)) continue;              // not a tiered one
        if (!family.has(stem)) family.set(stem, []);
        family.get(stem)?.push(one);
      }
      for (const kin of family.values()) {
        if (kin.length < 2) continue;
        for (const one of kin) {
          if (deeper(one)) continue;
          if (kin.some(other => other !== one && !deeper(other)
            && COUNTS.every(key => stat(other, key) >= stat(one, key))
            && COUNTS.some(key => stat(other, key) > stat(one, key)))) {
            beaten.ench.add(one.id);
          }
        }
      }

      /* Gear, within one hand and one slot, on its statistics and its shot. */
      /** @param {TheoryBeatenItem} one @returns {number} */
      const hurt = one => (one.shots && one.shots[0])
        ? (one.shots[0].low + (one.shots[0].high === undefined
          ? one.shots[0].low : one.shots[0].high)) / 2 : 0;
      /** @param {TheoryBeatenItem} one @returns {number} */
      const far = one => (one.shots && one.shots[0] && one.shots[0].reach) || 0;
      /** @type {Map<string, TheoryBeatenItem[]>} */
      const shelf = new Map();
      for (const one of getData().items) {
        const key = one.hand + '/' + one.slot;
        if (!shelf.has(key)) shelf.set(key, []);
        shelf.get(key)?.push(one);
      }
      for (const kin of shelf.values()) {
        for (const one of kin) {
          if (deeper(one)) continue;
          if (kin.some(other => other !== one && !deeper(other)
            && COUNTS.every(key => stat(other, key) >= stat(one, key))
            && hurt(other) >= hurt(one) && far(other) >= far(one)
            && (other.mp || 0) <= (one.mp || 0)
            && (COUNTS.some(key => stat(other, key) > stat(one, key))
              || hurt(other) > hurt(one)))) {
            beaten.gear.add(one.name);
          }
        }
      }
      return beaten;
    }
    return { beatenOnes, invalidate() { beaten = null; } };
  }

  /**
   * Build the fit index once on first demand; catalogue replacement keeps it alive.
   * @param {TheoryItemSearchDependencies} dependencies
   */
  function createItemSearch({ getData, hands, accessible }) {
    /** @type {Map<string, TheorySearchItem[]> | null} */
    let itemsByFit = null;

    function ensureItemSearchIndex() {
      if (itemsByFit) return;

      itemsByFit = new Map();
      for (const one of getData().items) {
        const broad = one.hand + '/*';
        const exact = one.hand + '/' + one.slot;

        if (!itemsByFit.has(broad)) itemsByFit.set(broad, []);
        itemsByFit.get(broad)?.push(one);

        if (!itemsByFit.has(exact)) itemsByFit.set(exact, []);
        itemsByFit.get(exact)?.push(one);
      }
    }

    /*
     * Everything that physically fits this class slot, minus the reader's
     * blacklist. This is the manual picker catalogue: progression must not make
     * an existing item disappear when somebody simply wants to inspect it.
     */
    /**
     * @param {string} hand @param {string} klass
     * @param {TheoryItemSearchState | null | undefined} state
     * @returns {TheorySearchItem[]}
     */
    function compatibleItemsFor(hand, klass, state) {
      const kind = getData().byClass[klass];
      const slot = kind && kind.slots[hands.findIndex(h => h[0] === hand)];
      const out = (state && state.banned) || {};

      ensureItemSearchIndex();
      const key = hand + '/' + (slot === undefined ? '*' : slot);
      const candidates = itemsByFit?.get(key) || [];

      return candidates.filter(one => !out[one.name]);
    }

    /*
     * What an automatic personalised search may actually offer.
     * Best-possible mode makes accessible() true for the full catalogue.
     */
    /**
     * @param {string} hand @param {string} klass
     * @param {TheoryItemSearchState | null | undefined} state
     * @returns {TheorySearchItem[]}
     */
    function itemsFor(hand, klass, state) {
      return compatibleItemsFor(hand, klass, state)
        .filter(one => accessible(one.name));
    }
    return { compatibleItemsFor, itemsFor };
  }

  /**
   * Keep both name caches for the caller's lifetime, building the index on first demand.
   * Catalogue replacement alone did not invalidate them in the page or its harness.
   * @param {TheoryEnchantDependencies} dependencies
   */
  function createEnchants({ getData, plainly, enchantKey, worth, numeral, getEngine, rulesFor, ofHand }) {
    /** @type {Map<string, TheoryCharm> | null} */
    let enchByName = null;
    /** @type {Map<string, TheoryCharm | undefined>} */
    const charmByQuery = new Map();
    /** @param {string} name @returns {TheoryCharm | undefined} */
    function charmNamed(name) {
      if (charmByQuery.has(name)) return charmByQuery.get(name);
      if (!enchByName) {
        enchByName = new Map();
        for (const one of getData().enchants) {
          for (const key of [one.name, plainly(one.name), enchantKey(one.name)]) {
            const had = enchByName.get(key);
            if (!had || worth(one) > worth(had)) enchByName.set(key, one);
          }
        }
      }
      const found = enchByName.get(name)
        || enchByName.get(plainly(name))
        || enchByName.get(enchantKey(name));
      charmByQuery.set(name, found);
      return found;
    }

    /*
     * What is already on the item, in names the calculator recognises.
     *
     * It files "Wisdom -Defense Tradeoff", the thing you ask for; the client
     * files four of them, I through IV, which are what it rolls. Handing over
     * the client's spelling meant the calculator looked up the name, found
     * nothing, and so believed the item was bare - which is how the optimiser
     * came to put four copies of the same tradeoff on one weapon.
     */
    /** @param {Partial<Pick<TheoryEnchantRules, 'byName'>>} held
     * @param {TheoryEnchantSlots | null | undefined} already @param {number} at
     * @returns {string[]} */
    function locksOn(held, already, at) {
      /** @type {string[]} */
      const out = [];
      (already || []).forEach((id, i) => {
        if (i === at || !id) return;
        const one = getData().byEnch[id];
        if (!one) return;
        const bare = enchantKey(one.name);
        for (const name of [one.name, one.name.replace(numeral, '').trim()]) {
          if (held.byName && held.byName.get(name)) { out.push(name); return; }
        }
        // Nothing matched exactly: cross the raw-client/canonical-name boundary
        // before deciding that the calculator does not know this enchantment.
        for (const [name] of held.byName || []) {
          if (enchantKey(name) === bare) { out.push(name); return; }
        }
      });
      return out;
    }

    /** @param {string} itemName
     * @param {TheoryEnchantSlots | null | undefined} already @param {number} at
     * @returns {TheoryEnchantPool} */
    function rollableEnchantsFor(itemName, already, at) {
      const item = getData().byItem[itemName];
      if (!item) return [];
      const held = rulesFor();
      if (held) {
        const locks = locksOn(held, already, at);
        /** @type {TheoryEnchantPoolConfig} */
        const cfg = {
          item: itemName,
          type: ofHand[item.hand] || 'WEAPON',
          slots: (already || []).length || 4,
          locks,
          subtypes: getEngine().subtypesForItem(held, itemName)
        };
        return getEngine().obtainablePool(held, cfg);
      }

      throw new Error('Enchanting rules are unavailable. Reload the page before planning a build.');
    }

    /** @param {string} itemName
     * @param {TheoryEnchantSlots | null | undefined} already @param {number} at
     * @returns {TheoryEnchantChoice[]} */
    function enchantsFor(itemName, already, at) {
      const pool = rollableEnchantsFor(itemName, already, at);
      /** @type {TheoryEnchantChoice[]} */
      const out = [];
      /** @type {Set<string>} */
      const seen = new Set();
      for (const mod of pool) {
        /*
         * Only what an enchanting will actually put on an item.
         *
         * The calculator's list is the whole list, and the whole list is
         * wider than what a player can roll. The retired ones - Kogbold
         * Spirit (Legacy), Living Hive (Legacy), Crown - are kept so that an
         * item already carrying one still reads, and are given a weight of
         * nought to say they can never come out again. The ones only an
         * engraving gives - Retrowinds Weapon, Hydroshock, Snowstorm - are
         * kept: a player holding the engraving wears them, and the picker
         * and the gear card name the engraving each one takes.
         */
        if (seen.has(mod.name)) continue;
        seen.add(mod.name);
        const mine = charmNamed(mod.name);
        // How likely it is to come out, kept for the slot that has nothing
        // countable left to put in it.
        out.push(Object.assign(
          { roll: mod.weight },
          mine || { id: 'n:' + mod.name },
          { name: mod.name }
        ));
      }
      return out;
    }

    /** @param {string} itemName @param {TheoryEnchantSlots} already @param {number} at
     * @returns {boolean} */
    function enchantFitsItem(itemName, already, at) {
      const wanted = already[at];
      return rollableEnchantsFor(itemName, already, at).some(mod => {
        const mine = charmNamed(mod.name);
        return (mine ? mine.id : 'n:' + mod.name) === wanted;
      });
    }
    return { charmNamed, locksOn, rollableEnchantsFor, enchantsFor, enchantFitsItem };
  }

  /**
   * Bind once; compatibility, candidates, offers and tiers belong to each search.
   * @param {TheoryOptimiserDependencies} dependencies
   */
  function createOptimiser({ getProfile, getAccess, getData, hands: HANDS,
    gatherKeep: GATHER_KEEP, byScoreThenSignature, gearSignature, prepareSearchable,
    searchItems, searchEnchants, enchantFitsItem, worth, scoreOf }) {
    /**
     * @param {TheoryOptimiserState} state @param {TheoryScoreGoal} goal
     * @param {TheoryOptimiserReport | null} [report]
     * @param {TheoryOptimiserGather} [gather]
     * @returns {Generator<void, TheoryOptimiserResult, unknown>}
     */
    function* optimiseSteps(state, goal, report, gather) {
      if (!getProfile() || (/** @type {{mode: string}} */ (getProfile()).mode === 'personal' && !getAccess())) throw new Error('Set up your progression before crafting.');
      const work = prepareSearchable(state);
      // Cache compatibility only for this search, including the full slot state.
      /** @type {Map<string, boolean>} */
      const enchantFitCache = new Map();
      /** @param {string} itemName @param {TheoryOptimiserSlots} already @param {number} at */
      const enchantFits = (itemName, already, at) => {
        const key = JSON.stringify([itemName, already, at]);
        if (!enchantFitCache.has(key)) {
          enchantFitCache.set(key,
            enchantFitsItem(itemName, already, at));
        }
        return /** @type {boolean} */ (enchantFitCache.get(key));
      };
      // Eligibility stays fixed during this search; rebuild on the next call.
      /** @type {Map<string, TheoryOptimiserCandidate[]>} */
      const candidatesByHand = new Map();
      /** @param {string} hand */
      const candidatesForHand = hand => {
        if (!candidatesByHand.has(hand)) {
          candidatesByHand.set(hand, searchItems(hand, work.klass, work));
        }
        return /** @type {TheoryOptimiserCandidate[]} */ (candidatesByHand.get(hand));
      };
      /*
       * Each padlock holds the one thing it is on.
       *
       * It used to be that holding an item held everything on it too, on the
       * argument that leaving the weapon alone and rearranging all four of its
       * enchantments is not what anybody means by keeping something. That reads
       * well and is wrong twice over.
       *
       * It is wrong about the page, which puts five padlocks on every item -
       * one on the item and one on each of its four slots - and says "keep this
       * item" on the first of them. If the first held the other four there
       * would be no reason for them to exist, and pressing it would do
       * something the button does not say.
       *
       * And it is wrong about the question people bring. Keeping a weapon is
       * usually how you say "this is the one I own"; what you want to know next
       * is what to roll on it. Held whole, an item you own and have not
       * enchanted yet comes back exactly as empty as it went in, and the search
       * quietly refuses to answer the thing you asked.
       *
       * So a padlock on the item fixes the item, a padlock on a slot fixes that
       * slot, and to hold the lot you press all five. What is not kept is
       * assumed to have all four slots, since there you are planning rather
       * than describing - but a kept item keeps the count it really has.
       */
      for (const [hand] of HANDS) {
        const held = work.locked[hand];
        if (!held) work.gear[hand].slots = 4;
        const many = Math.max(0, work.gear[hand].slots || 0);
        while (work.gear[hand].ench.length < many) work.gear[hand].ench.push(null);
        /*
         * And every slot that is not being kept starts empty.
         *
         * A search that begins from what is already there can only add and
         * swap, never take away - so an enchantment left over from an earlier
         * question stayed for the next one, and a build asked for damage came
         * back still wearing the mana regeneration it was given while somebody
         * was asking about survival. Everything is worked out again from
         * nothing; what is kept is kept, and the rest has to earn its place.
         */
        for (let at = 0; at < many; at++) {
          if (!work.locked[hand + ':' + at]) work.gear[hand].ench[at] = null;
        }
      }
      yield;
      let score = scoreOf(work, goal);
      let looked = 0;
      /*
       * A gear set the search has just scored, kept if it is one somebody
       * could actually wear: all four slots filled, every free slot with
       * something this search was allowed to offer there - so whatever the
       * page later proposes has been through the same progression, blacklist
       * and filters as the answer itself - and every kept slot as it is.
       * Nothing is scored for it; the number is the one the search just made.
       */
      /** @type {Map<string, Set<string>>} */
      const offered = new Map();
      /** @param {string} hand @param {string} name */
      const offers = (hand, name) => {
        if (!offered.has(hand)) offered.set(hand, new Set(candidatesForHand(hand).map(item => item.name)));
        return /** @type {Set<string>} */ (offered.get(hand)).has(name);
      };
      /*
       * And never a lower tier than the slot can have. An alternative is
       * another way to play, not the same way a tier worse: a T5 ring where the
       * T6 one is on offer is only a downgrade that happens to spell a new
       * signature. A tiered item is noted only at the best tier this search
       * may offer in its slot; untiered and set pieces carry no tier and are
       * judged on their score like anything else.
       */
      /** @type {Map<string, number>} */
      const bestTier = new Map();
      /** @param {string} hand */
      const topTier = hand => {
        if (!bestTier.has(hand)) {
          let most = -Infinity;
          for (const item of candidatesForHand(hand)) if (Number.isFinite(item.tier)) most = Math.max(most, /** @type {number} */ (item.tier));
          bestTier.set(hand, most);
        }
        return /** @type {number} */ (bestTier.get(hand));
      };
      /** @param {TheoryOptimiserState} one @param {number} value */
      const note = (one, value) => {
        if (!gather || !Number.isFinite(value)) return;
        /** @type {Record<string, string>} */
        const names = {};
        for (const [hand] of HANDS) {
          const name = one.gear[hand].name;
          if (!name) return;
          if (!one.locked[hand] && !offers(hand, name)) return;
          const item = getData().byItem[name];
          if (!one.locked[hand] && item && Number.isFinite(item.tier) && /** @type {number} */ (item.tier) < topTier(hand)) return;
          names[hand] = name;
        }
        const key = gearSignature(one);
        const had = gather.get(key);
        if (had && had.score >= value) return;
        gather.set(key, { key, score: value, gear: names });
        if (gather.size > GATHER_KEEP * 2) {
          const kept = [...gather.values()].sort(byScoreThenSignature).slice(0, GATHER_KEEP);
          gather.clear();
          for (const one of kept) gather.set(one.key, one);
        }
      };
      note(work, score);
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const [hand] of HANDS) {
          if (work.locked[hand]) continue;
          const was = work.gear[hand].name;
          let best = was;
          for (const one of candidatesForHand(hand)) {
            work.gear[hand].name = one.name;
            // An enchantment that no longer fits the item cannot be counted.
            const kept = work.gear[hand].ench.slice();
            work.gear[hand].ench = kept.map((id, i) =>
              (id && enchantFits(one.name, kept, i)) ? id : null);
            yield;
            const now = scoreOf(work, goal);
            looked++;
            note(work, now);
            /*
             * A stat goal often cannot see whole equipment slots. Life, for
             * example, gives an ordinary staff the same score as the starter
             * staff. Keep improving the tier when two tiered items tie so a
             * reachable T10 weapon is not reported as T0 merely because neither
             * changes Life. Untiered gear still has to win on the requested
             * goal, so this tie-break cannot replace a useful UT arbitrarily.
             */
            const current = getData().byItem[/** @type {string} */ (best)];
            const tierTie = Math.abs(now - score) <= 1e-9
              && Number.isFinite(one.tier) && Number.isFinite(current && current.tier)
              && /** @type {number} */ (one.tier) > /** @type {{tier: number}} */ (current).tier;
            if (now > score + 1e-9 || tierTie) {
              score = Math.max(score, now);
              best = one.name;
            }
            work.gear[hand].ench = kept;
          }
          work.gear[hand].name = best;
          if (best !== was) moved = true;
        }
        /*
         * And whole sets, which no single swap can ever reach.
         *
         * A set pays nothing until two of its pieces are on at once, so every
         * step towards one is a step downhill and a search that changes one
         * thing at a time turns back at the first of them. Each set is
         * therefore tried whole: the best piece it has for every hand that is
         * free, put on together, kept only if the lot of them beats what was
         * there.
         */
        for (const kit of getData().sets || []) {
          /** @type {TheoryOptimiserState} */
          const trial = JSON.parse(JSON.stringify(work));
          let put = 0;
          for (const [hand] of HANDS) {
            if (trial.locked[hand]) continue;
            let best = null, mark = -Infinity;
            const mine = new Set(kit.pieces);
            for (const one of candidatesForHand(hand)) {
              if (!mine.has(one.name)) continue;
              const was = trial.gear[hand].name;
              trial.gear[hand].name = one.name;
              yield;
              const now = scoreOf(trial, goal);
              looked++;
              if (now > mark) { mark = now; best = one.name; }
              trial.gear[hand].name = was;
            }
            if (!best) continue;
            trial.gear[hand].name = best;
            // An enchantment that no longer fits the item cannot be counted.
            const kept = trial.gear[hand].ench.slice();
            trial.gear[hand].ench = kept.map((id, i) =>
              (id && enchantFits(best, kept, i)) ? id : null);
            put++;
          }
          if (put < 2) continue;
          yield;
          const now = scoreOf(trial, goal);
          looked++;
          note(trial, now);
          if (now <= score) continue;
          score = now;
          for (const [hand] of HANDS) {
            if (work.locked[hand]) continue;
            work.gear[hand] = trial.gear[hand];
          }
          moved = true;
        }

        /*
         * Sometimes the question is only which gear to wear. An enchanted
         * answer is no use to somebody deciding what to hunt for first, so the
         * search can be told to leave the enchantments exactly as they are and
         * change nothing but the four items.
         */
        for (const [hand] of HANDS) {
          if (work.scope === 'gear') break;
          const worn = work.gear[hand];
          /* Held or not: the padlock on the item holds the item, and the slots
             on it answer to their own. */
          if (!worn.name) continue;
          for (let at = 0; at < worn.slots; at++) {
            if (work.locked[hand + ':' + at]) continue;
            const was = worn.ench[at];
            /*
             * An empty slot is worth filling even by something that changes
             * nothing this goal can see. Insisting on a strict improvement left
             * slots empty whenever every remaining candidate was neutral - and
             * the game's own rules make that common, since two statistics on
             * one item block the rest of the statistics from ever joining them.
             * Between two that score the same, the bigger one wins, so a slot
             * that has to be filled with something is filled with the best
             * something rather than the first one out of the pool.
             */
            /*
             * Whether an empty slot has to be filled at all.
             *
             * Asked to fill them, the search puts the best thing the rules
             * still allow in every slot, and once two statistics are on an item
             * the game allows only effects - so the answer comes back wearing
             * mana regeneration on a build that never casts. Asked for only
             * what helps, it leaves a slot empty rather than write down
             * something that does nothing for the question.
             */
            const fills = work.scope !== 'helps';
            let best = was;
            let bestScore = score;
            let bestWorth = worth(getData().byEnch[/** @type {string} */ (was)]);
            for (const one of searchEnchants(worn.name, worn.ench, at)) {
              // Anything this page can count: a statistic, a scaling of the
              // weapon, or something that keeps you alive. The rest change the
              // shot in ways it does not model.
              if (!one.worn && !one.mul && !one.heal && !one.rel && !one.sub) continue;
              worn.ench[at] = one.id;
              yield;
              const now = scoreOf(work, goal);
              looked++;
              const mine = worth(one);
              const better = now > bestScore + 1e-9;
              const evens = fills && !was
                && Math.abs(now - bestScore) <= 1e-9 && mine > bestWorth;
              if (better || evens) {
                bestScore = Math.max(bestScore, now);
                best = one.id;
                bestWorth = mine;
              }
            }
            /*
             * And if nothing this page can count is allowed here, the slot is
             * still a slot. Two statistics on one item bar every other
             * statistic from joining them, so the last slots of a piece of
             * armour are often a choice between effects the page does not
             * model and nothing at all - and nothing at all is the one answer
             * that is certainly wrong, since the game will put something there.
             * The likeliest roll takes it, and the page says plainly that it is
             * not counting what it does.
             */
            if (!best && fills) {
              let common = null;
              for (const one of searchEnchants(worn.name, worn.ench, at)) {
                // Loot and dust bonuses are rolled for the bag, not for the
                // fight, so they are the last thing to put in a fighting slot.
                const spoils = (one.labels || '').includes('REWARD');
                const mineIs = (spoils ? 0 : 1e9) + (one.roll || 0);
                const hisIs = common
                  ? ((common.labels || '').includes('REWARD') ? 0 : 1e9) + (common.roll || 0)
                  : -1;
                if (mineIs > hisIs) common = one;
              }
              if (common) best = common.id;
            }
            worn.ench[at] = best;
            score = bestScore;
            if (best !== was) moved = true;
          }
        }
        if (report) report(pass + 1, looked, score);
        if (!moved) break;
      }
      // The answer itself, enchanted, is the best this gear set has shown.
      note(work, score);
      return { state: work, score, looked };
    }

    return { optimiseSteps };
  }

  return { SHOTS_AT, landed, burstCycle, reaches, fanHits, weaponRate, createStatistics, createSets, createNumbers, createScore, createOptimiser, createShares, createGoals, createBeaten, createItemSearch, createEnchants };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TheoryEngine;
