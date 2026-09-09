/*
 * Theory crafting: what a character would actually be, and what it would do.
 *
 * The whole page is arithmetic on numbers the game chose. A class states its
 * eight statistics - the value it starts on, the value it may never pass, and
 * what one level is worth of each - so a level twenty is not a guess. Every
 * weapon, ability, armour and ring states what it gives you for being worn
 * and the projectile it throws. Every one of the thousand enchantments states
 * its effect as a mutator rather than as prose. All of that is read out of the
 * index by tools/build-theorycraft.js and used here untouched.
 *
 * Four things are NOT in the client, and they are the four formulas that turn
 * a statistic into a rate. They are the ones the game's own players worked out
 * long ago and agree on, and they are written out at the top where they can be
 * argued with rather than buried:
 *
 *     shots a second   1.5 + 6.5 x DEX/75, times the weapon's own rate
 *     tiles a second   4 + 5.6 x SPD/75
 *     life a second    1 + 0.12 x VIT
 *     magic a second   0.5 + 0.06 x WIS
 *
 * And the damage formula, which is the one thing everything here turns on:
 * a shot rolls between its low and high, is raised by the attacker's attack,
 * and is then reduced by the target's armour - but armour may never take more
 * than most of it, so a well armoured thing is hard to kill and not immune.
 *
 *     dealt = roll x (0.5 + ATT/50)
 *     landed = max(dealt x 0.15, dealt - DEF)     unless the shot pierces
 *
 * Exaltations are the game's own rule: five of each statistic, one point each.
 */
var TheoryCraft = (function () {
  'use strict';

  const SHOTS_AT = dex => 1.5 + 6.5 * (dex / 75);
  const PACE_AT = spd => 4 + 5.6 * (spd / 75);
  const HEAL_AT = vit => 1 + 0.12 * vit;
  const MANA_AT = wis => 0.5 + 0.06 * wis;

  const STATS = [
    ['hp', 'Life', 'HP'], ['mp', 'Magic', 'MP'], ['att', 'Attack', 'ATT'],
    ['def', 'Defence', 'DEF'], ['spd', 'Speed', 'SPD'], ['dex', 'Dexterity', 'DEX'],
    ['vit', 'Vitality', 'VIT'], ['wis', 'Wisdom', 'WIS']
  ];
  const OF_STAT = {};
  for (const [key, , tag] of STATS) OF_STAT[tag] = key;
  // Sets say MAXHP and MAXMP where an item says HP and MP.
  OF_STAT.MAXHP = 'hp'; OF_STAT.MAXMP = 'mp';
  const HANDS = [['weapon', 'Weapon'], ['ability', 'Ability'],
    ['armor', 'Armour'], ['ring', 'Ring']];
/*
 * Exaltations. Five of each statistic, and what one is worth depends on the
 * statistic: life and magic go up five at a time, so a fully exalted
 * character carries twenty-five more of each, while the other six go up one
 * at a time for five. Treating all eight alike gave a character twenty
 * points of life it never had.
 *
 * This is the game's own rule and not the client's - the installed files
 * confirm who may exalt and say nothing about what it is worth - so it is
 * written here in the open rather than buried in a table.
 */
const EXALT_EACH = 5;
const EXALT_STEP = { hp: 5, mp: 5 };
const exaltOf = key => EXALT_EACH * (EXALT_STEP[key] || 1);

  let data = null;
  let build = null;
  let tabs = [];
  let onTab = 0;
  let picking = null;                  // which slot a picker is open for

  /* ---------------- the numbers ---------------- */

  /*
   * A character's statistics: where the class starts, plus what the levels
   * add, held under the class's own ceiling - then everything worn, then the
   * exaltations. Gear and exalts go on top of the ceiling, which is how the
   * game does it: the cap is on what levelling and potions can reach.
   */
  /*
   * Which sets are being worn, and what each is paying.
   *
   * The client gives a set its pieces and a bonus at two of them, three and
   * four, and the thresholds stack the way the game stacks them: wearing all
   * four pays the two-piece bonus as well. It is worked out from the whole
   * outfit rather than from any one piece, which is exactly why it is the one
   * thing a search that changes one item at a time can never find.
   */
  let sharedPieces = null;
  function timesListed(name) {
    if (!sharedPieces) {
      sharedPieces = new Map();
      for (const kit of data.sets || []) {
        for (const piece of kit.pieces) {
          sharedPieces.set(piece, (sharedPieces.get(piece) || 0) + 1);
        }
      }
    }
    return sharedPieces.get(name) || 0;
  }

  function setsOn(state) {
    const worn = new Set(HANDS.map(h => (state.gear[h[0]] || {}).name).filter(Boolean));
    const out = [];
    for (const kit of data.sets || []) {
      let howMany = 0, ours = false;
      for (const piece of kit.pieces) {
        if (!worn.has(piece)) continue;
        howMany++;
        // Something that belongs to this set and to no other.
        if (timesListed(piece) === 1) ours = true;
      }
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
      if (howMany < 2 || !ours) continue;
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

  function statsOf(state) {
    const kind = data.byClass[state.klass];
    if (!kind) return null;
    const out = {}, base = {}, top = {};
    for (const [key] of STATS) {
      const ceiling = kind[key + 'Top'];
      const grown = (kind[key] || 0) + (kind.grow[key] || 0) * (state.level - 1);
      // Eight of eight means every potion drunk: the ceiling itself.
      const reached = state.maxed ? ceiling : Math.min(ceiling, grown);
      base[key] = Math.round(reached);
      top[key] = ceiling;
      out[key] = base[key];
    }
    const from = { gear: {}, ench: {}, set: {}, exalt: {}, rel: {}, share: {} };

    // Sets first, because they are decided by what is worn rather than by
    // any one piece.
    for (const kit of setsOn(state)) {
      for (const key of Object.keys(kit.gives)) {
        from.set[key] = (from.set[key] || 0) + kit.gives[key];
      }
    }
    for (const hand of HANDS) {
      const worn = state.gear[hand[0]];
      const item = worn && data.byItem[worn.name];
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
      const bonus = {};
      for (const [key] of STATS) {
        bonus[key] = (from.gear[key] || 0) + (from.ench[key] || 0) + (from.set[key] || 0);
      }
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
        const item = worn && data.byItem[worn.name];
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
      const item = worn && data.byItem[worn.name];
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

  /*
   * What the worn enchantments multiply.
   *
   * Some of them do not add a statistic at all: they scale the weapon. Two
   * per cent of damage, five per cent off the rate of fire, a longer-lived
   * shot. They compound, the way the game compounds them, and they are as
   * much a part of what a build does as an attack bonus is.
   */
  function scaleOf(state) {
    const out = { dmg: 1, rate: 1, life: 1, fast: 1 };
    for (const [hand] of HANDS) {
      const worn = state.gear[hand];
      for (const id of (worn && worn.ench) || []) {
        const one = id && data.byEnch[id];
        if (!one || !one.mul) continue;
        for (const key of Object.keys(out)) {
          if (one.mul[key] !== undefined) out[key] *= one.mul[key];
        }
      }
    }
    return out;
  }

  /* What a shot lands for, against a given armour. */
  function landed(roll, att, def, pierce) {
    const dealt = roll * (0.5 + att / 50);
    if (pierce) return dealt;
    return Math.max(dealt * 0.15, dealt - def);
  }

  /*
   * What a weapon does a second.
   *
   * The average roll, raised by attack, reduced by the target's armour, times
   * how many go at once, times how often they go. Armour bites each shot on
   * its own, which is why many small shots suffer more from it than one big
   * one - and is most of what theory crafting is about.
   */
  /*
   * What the enchantments have done to the shot.
   *
   * Twenty-six of them carry a sub-attack - a projectile of their own that
   * either joins what the weapon throws or replaces it. Buzzing Bullets adds
   * a burst of bees to every shot, Venom Coating swaps the shot out. They are
   * the reason anybody puts an awakened enchantment on a weapon, so they are
   * read from the same place everything else is: the object the client points
   * at, with its own damage, its own count and its own burst.
   */
  function subOf(state) {
    const out = [];
    for (const [hand] of HANDS) {
      const worn = state.gear[hand];
      for (const id of (worn && worn.ench) || []) {
        const one = id && data.byEnch[id];
        for (const part of (one && one.sub) || []) out.push(part);
      }
    }
    return out;
  }

  function weaponRate(item, stats, def, scale, extra) {
    if (!item || !item.shots || !item.shots.length) return { each: 0, rate: 0, dps: 0 };
    const by = scale || { dmg: 1, rate: 1, life: 1, fast: 1 };
    /*
     * A sub-attack that says "set" is the shot now; the weapon's own is gone.
     */
    const swaps = (extra || []).filter(one => one.how === 'set');
    const shot = swaps.length ? swaps[swaps.length - 1].shots[0] : item.shots[0];
    const roll = (shot.low + (shot.high === undefined ? shot.low : shot.high)) / 2
      * by.dmg;
    const each = landed(roll, stats.att, def, shot.pierce);
    const rate = SHOTS_AT(stats.dex) * (item.rate === undefined ? 1 : item.rate)
      * by.rate;
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
    const cycle = item.burst && item.burst.many > 1 ? (() => {
      const b = item.burst;
      const quick = Math.max(0, Math.min(1, stats.dex / 75));
      const wait = b.wait + (b.rush - b.wait) * quick;
      const runs = b.many / rate;
      return { every: runs + wait, shots: b.many, wait, run: runs };
    })() : null;
    /*
     * And one that says "add" throws its own volley alongside, at the same
     * rate the weapon fires, with its own damage and its own count.
     */
    let along = 0;
    for (const one of (extra || [])) {
      if (one.how !== 'add') continue;
      const its = one.shots[0];
      const mid = (its.low + (its.high === undefined ? its.low : its.high)) / 2 * by.dmg;
      along += landed(mid, stats.att, def, its.pierce) * (one.many || 1);
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

  /*
   * And an ability, which is bounded by magic rather than by dexterity: you
   * may use it as often as the magic comes back, and no oftener.
   */
  /*
   * An ability, which fires nothing like a weapon.
   *
   * It does not declare NumProjectiles; it declares an Activate, and that is
   * where the count lives - a Fire Spray throws sixteen bolts and a Cobra
   * Serpentis Scroll eight. Reading only NumProjectiles counted one, which
   * understated every nova on this page by a factor of its own fan.
   *
   * The same line says how wisdom improves it: above a stated floor, each
   * point adds a fraction of a shot and a fraction of the damage. Both
   * fractions are the client's, and a Cobra Scroll at seventy-one wisdom is
   * eighty damage a bolt better for it.
   *
   * And how often is not a choice: it is what the magic pays for, at the rate
   * wisdom brings the magic back.
   */
  function abilityRate(item, stats, def) {
    if (!item || !item.shots || !item.shots.length || !item.mp) {
      return { each: 0, every: 0, dps: 0 };
    }
    const shot = item.shots[0];
    const cast = item.cast || {};
    const over = cast.from === undefined ? 0 : Math.max(0, stats.wis - cast.from);
    const roll = (shot.low + (shot.high === undefined ? shot.low : shot.high)) / 2
      + over * (cast.dmg || 0);
    const each = landed(roll, stats.att, def, shot.pierce);
    const many = Math.max(1, Math.round((cast.shots || item.many || 1)
      + over * (cast.more || 0)));
    /*
     * How often it can really be used, which is two limits and not one.
     *
     * This was the mana alone: how long until you can afford to cast it
     * again. That is a true limit and it is not the only one - the game also
     * makes you wait out the item's own cooldown, and where that is the
     * longer of the two it is the one you feel. Eighty-two items say they
     * have one. An ability that is cheap and slow was counted as firing as
     * fast as the mana came back, which overstated it and everything worked
     * out from it.
     *
     * Whichever wait is longer is the wait. Items whose cooldown the client
     * has not been read for have none here, and those fall back to the mana
     * rule by themselves.
     */
    const afford = item.mp / MANA_AT(stats.wis);
    const every = Math.max(afford, item.cool || 0);
    return { each, many, every, dps: each * many / every, reach: shot.reach,
      held: item.cool && item.cool > afford ? 'cooldown' : 'mana' };
  }

  /*
   * With one hand or with both.
   *
   * A wizard's staff and his spell are two different weapons and a build can
   * be judged on either - the spell is what kills a boss and the staff is
   * what clears a room - so the bench lets you take one away. Everything on
   * the page reads the same choice: the figures, the curve and the fight all
   * count the same hands, or they would be three answers to three questions
   * nobody asked.
   */
  const NONE = { each: 0, rate: 0, many: 1, every: 0, dps: 0 };

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
    const using = 'gun';
    const weapon = data.byItem[(state.gear.weapon || {}).name];
    const ability = data.byItem[(state.gear.ability || {}).name];
    const scale = scaleOf(state);
    const gun = using === 'spell' ? NONE
      : weaponRate(weapon, stats.now, def, scale, subOf(state));
    const spell = using === 'gun' ? NONE : abilityRate(ability, stats.now, def);
    return { stats, gun, spell, total: gun.dps + spell.dps };
  }

  /* ---------------- the state of a build ---------------- */

  /*
   * What a class walks out of the nexus in.
   *
   * The plainest thing that fits each of its four slots: the tier nought
   * weapon, ability and armour, and the tier nought ring - which the client
   * does not hand out at all, so the ring used to start empty and the page
   * opened with a hole in it. Starting from the bottom is also the only
   * honest place for the search to start from, since anything it finds is
   * then something it found rather than something it was given.
   */
  let plainest = null;
  function bottomOf(slot) {
    if (!plainest) {
      plainest = new Map();
      for (const one of data.items) {
        if (one.tier === undefined) continue;      // untiered: never a default
        const had = plainest.get(one.slot);
        if (!had || one.tier < had.tier) plainest.set(one.slot, one);
      }
    }
    const got = plainest.get(slot);
    return got ? got.name : null;
  }

  function fresh(klass) {
    const kind = data.byClass[klass] || data.classes[0];
    const gear = {};
    HANDS.forEach(([hand], i) => {
      const name = bottomOf((kind.slots || [])[i]) || kind.kit[i];
      gear[hand] = {
        name: (name && data.byItem[name]) ? name : null,
        slots: 4, ench: [null, null, null, null]
      };
    });
    const exalts = {};
    for (const [key] of STATS) exalts[key] = exaltOf(key);
    return {
      name: kind.name + ' build',
      klass: kind.name,
      // Always twenty. Nobody theory crafts a level nine.
      level: 20,
      maxed: true,
      exalt: true,
      exalts,
      gear,
      // More than one thing can be asked for at once, and how hard each is
      // pulled is the reader's to set.
      goals: ['dps'],
      share: {},
      pinned: {},
      // Everything the game has, to the top of it.
      scope: 'all',
      using: 'both',
      // Aimed at whatever is being fought, not at a bare target: a build is
      // read against the thing it is meant to kill.
      against: null,
      /*
       * Something worth timing. The list is sorted by hit points and the top
       * of it is a training dummy with ten million of them, which tells you
       * nothing; the first thing the game actually calls a god does.
       */
      /*
       * Something worth timing, and worth looking at. The list is sorted by
       * hit points and the top of it is a training dummy with ten million of
       * them, which tells you nothing; the first god the catalogue has a
       * portrait of both dies in a sensible time and shows its face.
       */
      boss: (data.bosses.find(one => one.pic && one.god && one.hp < 200000)
        || data.bosses.find(one => one.pic)
        || data.bosses[data.bosses.length - 1] || {}).name || null,
      locked: {}
    };
  }

  /* ---------------- which enchantments may go where ---------------- */

  const labelsOf = one => new Set(String(one || '').split(',').map(s => s.trim())
    .filter(Boolean));

  /*
   * Which enchantments may go on a thing, decided by the calculator that was
   * already written to decide it.
   *
   * This page had its own reading of the rules and it was a worse one. The
   * enchant calculator has carried the real ones for months: which pool an
   * item's kind draws from, that an awakened enchantment only goes on the one
   * item it belongs to, that a second enchantment sharing a label with one
   * already on the item cannot be rolled beside it - the whole reason you
   * cannot stack four attack bonuses. Its eligiblePool answers exactly that
   * question, so it is asked rather than second-guessed.
   */
  let rules = null;
  const OF_HAND = { weapon: 'WEAPON', ability: 'ABILITY', armor: 'ARMOR', ring: 'RING' };

  function rulesFor() {
    if (rules !== null) return rules;
    rules = false;
    try {
      const bundle = window.ROTMG_BUNDLE;
      if (typeof EnchantEngine === 'undefined' || !bundle || !bundle.sources) return rules;
      rules = EnchantEngine.buildDataset(bundle.sources);
      if (typeof EnchantItems !== 'undefined' && bundle.sources.clientItemText) {
        EnchantItems.loadClient(bundle.sources.clientItemText);
      }
    } catch (e) { rules = false; }
    return rules;
  }

  /*
   * The client's own record for a name the calculator uses.
   *
   * They do not spell them the same way. The calculator knows "Attack
   * -Defense Tradeoff", which is the thing you ask for; the client files four
   * of them, "Attack -Defense Tradeoff I" through "IV", which are what it
   * rolls. Matching on the exact string found nothing for most of the list,
   * so the numeral is dropped from both ends and the strongest of the four is
   * the one shown - which is the one anybody planning a build means.
   */
  const NUMERAL = /\s+(?:[IVX]+|\d+)$/;
  const plainly = name => String(name).replace(NUMERAL, '').trim().toLowerCase();
  /*
   * How much of an enchantment there is, for choosing between four of the
   * same thing. The client rolls Flat Life Regeneration I through IV under
   * one name to a player, and the strongest is the one anybody planning a
   * build means - so what it heals and what it keeps off you count towards
   * that as much as a statistic does, which they did not, which is why the
   * page kept offering the weakest of every family that raises nothing.
   */
  const worth = one => {
    if (!one) return 0;
    let n = Object.values(one.worn || {}).reduce((sum, v) => sum + Math.abs(v), 0);
    const heal = one.heal;
    if (heal) {
      n += (heal.flatHP || 0) + (heal.partHP || 0) * 400
        + ((heal.flatMP || 0) + (heal.partMP || 0) * 200) * 0.25
        + (heal.soak ? (1 - heal.soak) * 200 : 0);
    }
    if (one.mul) {
      n += Object.values(one.mul).reduce((sum, v) => sum + Math.abs(v - 1) * 100, 0);
    }
    // A share of a bonus is worth what the bonus is; sixteen per cent of a
    // good one beats four flat points, and this only has to rank them.
    for (const part of one.rel || []) n += Math.abs(part.pct) / 2;
    for (const part of one.sub || []) n += (part.shots[0].high || 0) / 4;
    return n;
  };

  let enchByName = null;
  function charmNamed(name) {
    if (!enchByName) {
      enchByName = new Map();
      for (const one of data.enchants) {
        for (const key of [one.name, plainly(one.name)]) {
          const had = enchByName.get(key);
          if (!had || worth(one) > worth(had)) enchByName.set(key, one);
        }
      }
    }
    return enchByName.get(name) || enchByName.get(plainly(name));
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
  function locksOn(held, already, at) {
    const out = [];
    (already || []).forEach((id, i) => {
      if (i === at || !id) return;
      const one = data.byEnch[id];
      if (!one) return;
      const bare = plainly(one.name);
      for (const name of [one.name, one.name.replace(NUMERAL, '').trim()]) {
        if (held.byName && held.byName.get(name)) { out.push(name); return; }
      }
      // Nothing matched by name: hand over whatever the calculator does know
      // that reads the same, rather than nothing at all.
      for (const [name] of held.byName || []) {
        if (plainly(name) === bare) { out.push(name); return; }
      }
    });
    return out;
  }

  function enchantsFor(itemName, already, at) {
    const item = data.byItem[itemName];
    if (!item) return [];
    const held = rulesFor();
    if (held) {
      const locks = locksOn(held, already, at);
      const cfg = {
        item: itemName,
        type: OF_HAND[item.hand] || 'WEAPON',
        slots: (already || []).length || 4,
        locks,
        subtypes: new Set()
      };
      const pool = EnchantEngine.eligiblePool(held, cfg, null);
      const out = [];
      const seen = new Set();
      for (const mod of pool) {
        /*
         * Only what an enchanting will actually put on an item.
         *
         * The calculator's list is the whole list, and the whole list is
         * wider than what a player can roll. The retired ones - Kogbold
         * Spirit (Legacy), Living Hive (Legacy), Crown - are kept so that an
         * item already carrying one still reads, and are given a weight of
         * nought to say they can never come out again. The seasonal ones -
         * Warm and Cozy, Glorious, Snowstorm - come out of an engraving held
         * at the time, not out of enchanting, and the client marks the
         * difference with a ROLLABLE label. This page has no artifact in it,
         * so it plans with what a plain enchanting can roll and nothing else.
         */
        if (!(mod.weight > 0) || !mod.tags || !mod.tags.has('ROLLABLE')) continue;
        if (seen.has(mod.name)) continue;
        seen.add(mod.name);
        const mine = charmNamed(mod.name);
        // How likely it is to come out, kept for the slot that has nothing
        // countable left to put in it.
        out.push(Object.assign({ roll: mod.weight }, mine || { id: 'n:' + mod.name, name: mod.name }));
      }
      return out;
    }

    throw new Error('Enchanting rules are unavailable. Reload the page before planning a build.');
  }

  function itemsFor(hand, klass) {
    const kind = data.byClass[klass];
    const slot = kind && kind.slots[HANDS.findIndex(h => h[0] === hand)];
    /*
     * Minus whatever has been set aside. Half the best answers in this game
     * are things a particular reader will never hold - a white bag from a
     * dungeon they do not run, an exalted drop three hundred hours away - and
     * an answer built out of those is not an answer to their question.
     */
    const out = (build && build.banned) || {};
    return data.items.filter(one => one.hand === hand
      && (slot === undefined || one.slot === slot)
      && !out[one.name]);
  }

  /* ---------------- what the search need not try ---------------- *
   *
   * The search spends its time where the choices are, and the choices are not
   * where they look. Counted on one class: five hundred and forty-two pieces
   * of gear to try against a thousand and sixteen enchantments, which comes
   * out at eight per cent of the work on what you wear and ninety-two on what
   * is rolled onto it.
   *
   * Both lists carry things that cannot win. An enchantment or an item that
   * is worse than another one on every count the page measures, and better on
   * none, will never be chosen however the shares are set - so trying it is
   * work with a known answer.
   *
   * The care is all in "on every count". Two traps, both found by measuring
   * rather than by thinking about it:
   *
   * The tiers of a thing are not a ladder. Attack -Defense Tradeoff IV gives
   * more attack than II and loses more defence for it, which makes it a
   * different bargain and not a better one - of eight hundred and twelve
   * tiered enchantments, four hundred and forty-one are genuinely beaten by
   * their own top tier and a hundred and sixty-eight are trades that have to
   * stay. The same is true of gear: the T2 Spiral Shuriken hits harder than
   * the T10, and the T5 Ice Star carries nine vitality the T10 has not.
   *
   * And anything whose worth is not in its own numbers is left alone
   * entirely. A weak piece can be the second half of a set, a share of
   * another statistic, or an effect the page does not model, and none of
   * those show up in a comparison of what it wears.
   */
  const COUNTS = ['ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS', 'MAXHP', 'MAXMP'];
  const stat = (one, key) => (one && one.worn && one.worn[key]) || 0;
  // Worth more than its own statistics: not comparable, so not dropped.
  const deeper = one => !!(one.set || one.share || one.rel || one.sub || one.mul
    || one.heal || one.alters || one.does || one.cast || one.many || one.burst);

  let beaten = null;
  function beatenOnes() {
    if (beaten) return beaten;
    beaten = { ench: new Set(), gear: new Set() };

    /*
     * Enchantments, within one family: same identifier but for the tier on
     * the end, so the four Attack -Defense Tradeoffs are compared with each
     * other and with nothing else.
     */
    const family = new Map();
    for (const one of data.enchants || []) {
      const stem = String(one.id).replace(/_[1-4]$/, '');
      if (stem === String(one.id)) continue;              // not a tiered one
      if (!family.has(stem)) family.set(stem, []);
      family.get(stem).push(one);
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
    const hurt = one => (one.shots && one.shots[0])
      ? (one.shots[0].low + (one.shots[0].high === undefined
        ? one.shots[0].low : one.shots[0].high)) / 2 : 0;
    const far = one => (one.shots && one.shots[0] && one.shots[0].reach) || 0;
    const shelf = new Map();
    for (const one of data.items) {
      const key = one.hand + '/' + one.slot;
      if (!shelf.has(key)) shelf.set(key, []);
      shelf.get(key).push(one);
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

  /*
   * The same two lists, for the search only.
   *
   * The reader's own picker goes on offering everything: a thing that cannot
   * win a search is still a thing somebody may want to put on and look at,
   * and hiding it would be answering a question nobody asked.
   */
  const searchItems = (hand, klass) =>
    itemsFor(hand, klass).filter(one => !beatenOnes().gear.has(one.name));
  const searchEnchants = (name, already, at) =>
    enchantsFor(name, already, at).filter(one => !beatenOnes().ench.has(one.id));

  /* ---------------- the optimiser ---------------- */

  /*
   * What "better" means, chosen by the reader.
   *
   * Everything here is a single number to push upwards, so a build can be
   * compared with another build without anybody having to weigh two things
   * against each other. Time to kill is inverted, because less of it is
   * better and the search only knows how to climb.
   */
/*
 * A colour for each of the eight, the game's own.
 *
 * Life is red and magic is blue everywhere in that game; attack is the warm
 * one, defence the steel one, and so on down. Carrying the same eight through
 * the bars, the figures and the buttons means the page never has to write
 * "this button raises your attack" - the button is attack-coloured and sits
 * under a heading that says STATS.
 */
/*
 * The eight colours, taken off the game's own banners.
 *
 * Every exaltation banner in the game is the colour of the statistic it is
 * for, and that is the code every player already reads: life is the cyan one,
 * mana the gold one, attack the magenta one, and so on. These are the
 * brightest colour in each banner's sprite, sampled out of the client rather
 * than chosen here - so a row on this page is the colour a player expects
 * before reading the word beside it.
 */
const TINT = {
  hp: '#58cfda', mp: '#f4d24c', att: '#ca46dd', def: '#8b9cb3',
  spd: '#58da6e', dex: '#ff5f2a', vit: '#dd0c32', wis: '#4b9be7'
};

  const GOALS = [
    { group: 'Others', id: 'dps', say: 'Damage a second', tint: '#e08a3c',
      of: n => n.total },
    { group: 'Others', id: 'kill', say: 'Kill it fast', tint: '#f0c274', of: (n, s) => {
      const boss = data.byBoss[s.boss];
      if (!boss || !n.total) return 0;
      return -boss.hp / n.total;
    } },
    ...STATS.map(([key, say]) => ({ group: 'Stats', id: 'stat:' + key, say,
      tint: TINT[key], of: n => n.stats.now[key] }))
  ];

  function scoreOf(state, goal) {
    const boss = data.byBoss[state.boss];
    const def = goal.id === 'kill' && boss ? boss.def : state.against;
    const numbers = numbersFor(state, def);
    if (!numbers) return -Infinity;
    return goal.of(numbers, state);
  }

  /* Which of them are being asked for, with the old single choice honoured. */
  function goalsOf(state) {
    const want = state.goals && state.goals.length
      ? state.goals : [state.goal || 'dps'];
    const out = GOALS.filter(one => want.includes(one.id));
    return out.length ? out : [GOALS[0]];
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
  let ideals = { key: null, best: null };

  function bestAlone(state, list) {
    const key = JSON.stringify([state.klass, state.level, state.boss, state.against,
      state.gear, state.locked, state.exalt, (build && build.banned) || null,
      list.map(one => one.id)]);
    if (ideals.key === key) return ideals.best;
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

  function aimOf(state, goals) {
    const list = goals || goalsOf(state);
    if (list.length === 1) return list[0];
    const parts = new Map(sharesOf(state).map(one => [one.goal.id, one.part]));
    const best = bestAlone(state, list);
    const span = {}, pull = {};
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

  /*
   * How hard each thing asked for is being pulled.
   *
   * Asking for damage and survival at once is not one question, it is a
   * bargain, and where the bargain lands is the reader's to say: seventy
   * damage to thirty survival is a different build from thirty to seventy,
   * and both are reasonable. The numbers are kept raw and read as shares of
   * their own total, so moving one moves what the others are worth without
   * anybody having to make them add up.
   */
  function shareOf(state, id) {
    const want = state.share || {};
    const n = Number(want[id]);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

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

  /*
   * A hundred per cent, split up - never a hundred per cent each.
   *
   * There is only one build to be had, so the shares are one thing divided
   * rather than several dials set on their own: pushing damage up has to push
   * everything else down, and the row has to keep saying a hundred whatever
   * is moved. Everything asked for keeps at least one per cent, so a goal
   * that is on is never silently switched off.
   */
  function heldShare(state, id) {
    return !!(state.pinned && state.pinned[id]);
  }

  function levelShares(state) {
    const list = goalsOf(state).map(one => one.id);
    const was = state.share || {};
    /*
     * A share that is being held stays where it was put; the rest of the
     * hundred is shared out evenly between the others. Somebody who has said
     * "seventy per cent damage" has said it, and adding a third thing to ask
     * for should not quietly take it back.
     */
    const held = list.filter(id => heldShare(state, id));
    const free = list.filter(id => !heldShare(state, id));
    let fixed = 0;
    const share = {};
    for (const id of held) {
      share[id] = Math.max(1, Math.min(100 - free.length, Number(was[id]) || 1));
      fixed += share[id];
    }
    if (!free.length) { state.share = share; return; }
    const room = Math.max(free.length, 100 - fixed);
    const each = Math.floor(room / free.length);
    free.forEach((id, i) => {
      share[id] = each + (i < room - each * free.length ? 1 : 0);
    });
    state.share = share;
  }

  function moveShare(state, id, to) {
    const list = goalsOf(state).map(one => one.id);
    const was = state.share || {};
    /*
     * Only what is not being held moves.
     *
     * Setting one share and then setting a second used to undo the first,
     * since the hundred was taken back off everything equally - which made
     * three of them impossible to aim. A padlock on a share takes it out of
     * the arithmetic: the rest of the hundred is what the others divide.
     */
    const others = list.filter(x => x !== id);
    const held = others.filter(x => heldShare(state, x));
    const free = others.filter(x => !heldShare(state, x));
    const share = {};
    let fixed = 0;
    for (const x of held) {
      share[x] = Math.max(1, Number(was[x]) || 1);
      fixed += share[x];
    }
    const most = 100 - fixed - free.length;
    if (most < 1) {                      // everything else is pinned solid
      share[id] = Math.max(1, 100 - fixed);
      state.share = share;
      return;
    }
    const want = Math.max(1, Math.min(most, Math.round(to)));
    share[id] = want;
    if (!free.length) { state.share = share; return; }
    // What is left goes to the others in the proportion they already stood in.
    const stood = {};
    let sum = 0;
    for (const x of free) { stood[x] = Math.max(1, Number(was[x]) || 1); sum += stood[x]; }
    const room = 100 - fixed - want;
    let given = 0;
    free.forEach((x, i) => {
      const part = i === free.length - 1
        ? room - given
        : Math.max(1, Math.min(room - given - (free.length - 1 - i),
          Math.round(room * stood[x] / sum)));
      share[x] = part;
      given += part;
    });
    state.share = share;
  }

  /*
   * Coordinate ascent: try everything for one slot, keep the best, move to
   * the next, and go round again until a whole pass changes nothing.
   *
   * It is not a proof. There are seven hundred weapons, eight hundred
   * abilities and a thousand enchantments, and the honest number of
   * combinations has thirty digits in it - nobody is searching that. What
   * this finds is a build that cannot be improved by changing any one thing
   * at a time, which is what a person does by hand and is usually the answer.
   * The page says so rather than claiming a best.
   */
  /*
   * The same build every time, whatever is on the page.
   *
   * A search reads the build in front of it, so searching twice searched from
   * two different places and gave two different answers - which makes the
   * button feel like a dice roll rather than an answer. The starting point is
   * now always the same: the plainest thing that fits each slot, with
   * anything kept left exactly as it is.
   */
  function bareOf(state) {
    const out = JSON.parse(JSON.stringify(state));
    HANDS.forEach(([hand], i) => {
      const kind = data.byClass[out.klass];
      const plain = bottomOf((kind && kind.slots || [])[i]);
      const held = out.locked[hand];
      const worn = state.gear[hand] || {};
      /*
       * A held item stays, with the number of slots it actually has - there
       * you are describing the copy in your bag. Anything else is stripped
       * back to the plainest thing that fits, with all four slots, because
       * there the question is what the item could be.
       */
      out.gear[hand] = {
        name: held ? (worn.name || null)
                   : ((plain && data.byItem[plain]) ? plain : null),
        slots: held ? (worn.slots || 4) : 4,
        ench: [0, 1, 2, 3].map(at =>
          out.locked[hand + ':' + at] ? (worn.ench || [])[at] || null : null)
      };
    });
    return out;
  }

  function optimise(state, goal, report) {
    const work = JSON.parse(JSON.stringify(state));
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
    let score = scoreOf(work, goal);
    let looked = 0;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const [hand] of HANDS) {
        if (work.locked[hand]) continue;
        const was = work.gear[hand].name;
        let best = was;
        for (const one of searchItems(hand, work.klass)) {
          work.gear[hand].name = one.name;
          // An enchantment that no longer fits the item cannot be counted.
          const kept = work.gear[hand].ench.slice();
          work.gear[hand].ench = kept.map((id, i) =>
            (id && enchantsFor(one.name, kept, i).some(e => e.id === id)) ? id : null);
          const now = scoreOf(work, goal);
          looked++;
          if (now > score) { score = now; best = one.name; }
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
      for (const kit of data.sets || []) {
        const trial = JSON.parse(JSON.stringify(work));
        let put = 0;
        for (const [hand] of HANDS) {
          if (trial.locked[hand]) continue;
          let best = null, mark = -Infinity;
          const mine = new Set(kit.pieces);
          for (const one of searchItems(hand, trial.klass)) {
            if (!mine.has(one.name)) continue;
            const was = trial.gear[hand].name;
            trial.gear[hand].name = one.name;
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
            (id && enchantsFor(best, kept, i).some(e => e.id === id)) ? id : null);
          put++;
        }
        if (put < 2) continue;
        const now = scoreOf(trial, goal);
        looked++;
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
          let bestWorth = worth(data.byEnch[was]);
          for (const one of searchEnchants(worn.name, worn.ench, at)) {
            // Anything this page can count: a statistic, a scaling of the
            // weapon, or something that keeps you alive. The rest change the
            // shot in ways it does not model.
            if (!one.worn && !one.mul && !one.heal && !one.rel && !one.sub) continue;
            worn.ench[at] = one.id;
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
    return { state: work, score, looked };
  }

  /* ---------------- the page ---------------- */

  const el = id => document.getElementById(id);
  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /*
   * A piece of the one sheet, as a plain element. The sheet is a single
   * picture and every icon on the page is a window onto it, so an
   * enchantment's own picture costs nothing extra to show - and it is the
   * only way anybody tells a thousand enchantments apart at a glance.
   */
  /*
   * A window onto the one sheet.
   *
   * The address of that sheet is written into the page once, as a custom
   * property, and every icon says var(--tc-sheet). Spelling it out per icon
   * put the whole picture - a quarter of a megabyte of base64, in the offline
   * copy - into the markup a thousand times over, which is why opening the
   * enchantment list took a second and a half.
   *
   * The box is the frame's own shape rather than a square. A tall creature in
   * a square window showed the width of its height, which is the frame beside
   * it: that is why several of them appeared to be standing next to a copy of
   * themselves.
   */
  function sheetIcon(key, side, extra) {
    const piece = data.sheet && data.sheet.pics[key];
    if (!piece) return '';
    const zoom = side / Math.max(piece.w, piece.h);
    return '<span class="tc-charm' + (extra ? ' ' + extra : '') + '"'
      + ' style="width:' + (piece.w * zoom) + 'px;height:' + (piece.h * zoom) + 'px'
      + ';background-size:' + (data.sheet.wide * zoom) + 'px '
      + (data.sheet.tall * zoom) + 'px'
      + ';background-position:' + (-piece.x * zoom) + 'px ' + (-piece.y * zoom) + 'px'
      + '"></span>';
  }

  /*
   * The same window, onto the other sheet.
   *
   * Two sheets, because they hold two different things. The theory sheet holds
   * what moves - a bolt in flight, a target in its three poses - and the index
   * sheet holds every object in the game standing still. An item's picture is
   * the index's, and it comes down as a rectangle on the projection, so this
   * page and the calculator draw the same item from the same pixels.
   */
  function indexIcon(rect, side, extra) {
    const sheet = data.iconSheet;
    if (!rect || !sheet) return '';
    const [x, y, w, h] = rect;
    const zoom = side / Math.max(w, h);
    return '<span class="sheet-art' + (extra ? ' ' + extra : '') + '"'
      + ' style="width:' + (w * zoom) + 'px;height:' + (h * zoom) + 'px'
      + ';background-size:' + (sheet.wide * zoom) + 'px ' + (sheet.tall * zoom) + 'px'
      + ';background-position:' + (-x * zoom) + 'px ' + (-y * zoom) + 'px'
      + '"></span>';
  }

  /*
   * What the game would call this thing, so the cell can be framed the way
   * the game frames it. Untiered gear - the drops people actually want - is
   * marked UT in the client's own labels, and the tiered stuff bands the way
   * its dust does: the low ones plain, the middle ones better, the top two
   * the ones worth a white bag.
   */
  function gradeOf(name) {
    const item = data.byItem[name];
    if (!item) return '';
    const labels = (item.labels || '').split(',');
    if (labels.includes('UT')) return 'is-ut';
    if (item.tier === undefined) return '';
    if (item.tier >= 13) return 'is-top';
    if (item.tier >= 10) return 'is-high';
    if (item.tier >= 6) return 'is-mid';
    return 'is-low';
  }

  /*
   * An item's picture, from wherever there is one.
   *
   * The site's own folder of item art comes from the wiki and is always a
   * patch behind the game, so anything the last update added is not in it.
   * Those are cut straight out of the client onto the same sheet the bolts
   * and the targets live on, and the cell reads from there instead.
   */
  function itemIcon(name) {
    const grade = gradeOf(name);
    const item = data.byItem[name];
    const cut = item && item.icon && indexIcon(item.icon, 34, 'tc-icon-big ' + grade);
    return cut || '<span class="tc-icon-big ' + grade + '"></span>';
  }

  /*
   * What a share of the bonus actually comes to.
   *
   * "+12% of bonus MAXMP" is a rule, not an answer: what it gives depends on
   * everything else worn, which is the whole reason to put one on - it grows
   * with the rest of the build. Read on its own it tells you nothing you can
   * weigh against a flat "+65 MAXMP" sitting in the slot beside it.
   *
   * So the rule is followed by what it is worth on the build in front of you,
   * taken from the same bonus the statistics themselves were taken from. Null
   * when there is nothing to read it against, and then only the rule is said.
   */
  function relWorth(part, bonus) {
    const key = OF_STAT[part.stat], of = OF_STAT[part.of];
    if (!key || !of || !bonus) return null;
    const much = (bonus[of] || 0) * part.pct / 100;
    return Math.round(much * 10) / 10;
  }
  /*
   * The number first, and the rule after it.
   *
   * A chip has about twenty characters before it is cut short with an
   * ellipsis, and "+12% of bonus MAXMP = +37 MAXMP" is longer than that - so
   * the answer was the half that got cut, which is the half worth having. Led
   * with, it reads like the flat enchantment in the slot beside it and can be
   * weighed against it at a glance; the rule that produced it follows, and
   * the whole sentence is on the chip's tooltip either way.
   */
  const saysRel = (part, bonus) => {
    const much = relWorth(part, bonus);
    const rule = plus(part.pct) + '% of bonus ' + part.of;
    if (much === null) {
      return rule + (part.of === part.stat ? '' : ' as ' + part.stat);
    }
    return plus(much) + ' ' + part.stat + ' (' + rule + ')';
  };

  /*
   * The padlock.
   *
   * It was a padlock once and became the word "keep", because the padlock of
   * the day was a grey glyph from a font that nobody could see - and a
   * control nobody can see is the same as not having one. The word was
   * readable, and it cost a great deal of room: five of them on every item,
   * four items on the page at once, on a column that has to share the screen
   * with the fight.
   *
   * So it is a padlock again, and the thing that went wrong last time is what
   * this is drawn to avoid. It is drawn rather than borrowed, in the button's
   * own colour, so it lights exactly the way the word did - dim at rest,
   * bright under the cursor, dark on the accent when it is holding. And the
   * shackle is open when the thing is free and shut when it is kept, so the
   * state is said by the shape and does not rest on the colour at all.
   */
  const LOCK = held => '<svg viewBox="0 0 12 12" width="12" height="12"'
    + ' aria-hidden="true" focusable="false">'
    + '<path d="M4.4 5.6V3.9a1.6 1.6 0 0 1 3.2 0'
    + (held ? 'v1.7' : '') + '" fill="none" stroke="currentColor"'
    + ' stroke-width="1.25" stroke-linecap="round"/>'
    + '<rect x="2.6" y="5.4" width="6.8" height="5.2" rx="1.1" fill="currentColor"/>'
    + '</svg>';
  const lockSays = held => (held ? 'Kept - click to let it change' : 'Keep this one');

  function drawSlots() {
    /* The build as it stands, once, so every share on the page is measured
       against the same bonus rather than four slightly different ones. */
    const kit = statsOf(build);
    const bonus = kit && kit.from && kit.from.bonus;
    const box = el('tcGear');
    if (!box) return;
    box.innerHTML = HANDS.map(([hand, say]) => {
      const worn = build.gear[hand];
      const item = data.byItem[worn.name];
      const locked = !!build.locked[hand];

      /*
       * What it is, as the badges the rest of the site uses - the tier, or
       * the fact that it has none, and what it does that is worth a word.
       * The numbers that follow are what it does.
       */
      const marks = [];
      if (item) {
        const labels = (item.labels || '').split(',');
        if (labels.includes('UT')) marks.push(['ut', 'Untiered']);
        else if (item.tier !== undefined) marks.push(['tier', 'Tier ' + item.tier]);
        if (item.set) marks.push(['set', 'Set']);
        const first = item.shots && item.shots[0];
        if (first && first.pierce) marks.push(['pierce', 'Pierces']);
        if (item.mp) marks.push(['mp', item.mp + ' MP']);
      }

      /* What the thing is, in the fewest words that still say it. */
      const bits = [];
      if (item) {
        const gun = item.shots && item.shots[0];
        if (gun) {
          bits.push(gun.low + (gun.high !== gun.low ? '–' + gun.high : '') + ' dmg');
          if (gun.reach) bits.push(gun.reach + ' tiles');
          if (gun.pierce) bits.push('pierces');
        }
        if (item.many > 1) bits.push(item.many + ' shots');
        if (item.rate !== undefined && item.rate !== 1) {
          bits.push(Math.round(item.rate * 100) + '% rate');
        }
        if (item.worn) {
          for (const tag of Object.keys(item.worn)) {
            bits.push(plus(item.worn[tag]) + ' ' + tag);
          }
        }
        // A statistic given as a share of another one, said as the game says
        // it: half your life off, all of your mana on as life.
        for (const part of item.share || []) {
          bits.push(plus(part.pct) + '% of ' + part.of
            + (part.of === part.stat ? '' : ' as ' + part.stat));
        }
        for (const part of item.rel || []) bits.push(saysRel(part, bonus));
        if (item.sb) bits.push('soulbound');
      }

      /* And its enchantments, as chips rather than as a faint list. */
      const chips = [];
      for (let at = 0; at < worn.slots; at++) {
        const id = worn.ench[at];
        const one = id && data.byEnch[id];
        const held = !!build.locked[hand + ':' + at];
        /*
         * Said once, however many parts there are. An enchantment that adds
         * six volleys was reading "adds 50-70 adds 50-70 adds 50-70..." right
         * out of its own chip and off the side of the card, taking the
         * padlock and the way to remove it with it.
         */
        const swaps = one && one.sub ? (() => {
          const set = one.sub.filter(part => part.how === 'set');
          const add = one.sub.filter(part => part.how === 'add');
          const words = [];
          if (set.length) {
            const it = set[set.length - 1];
            words.push('shoots ' + it.shots[0].low + '-' + it.shots[0].high);
          }
          if (add.length) {
            const most = add.reduce((a, b) =>
              (b.shots[0].high || 0) > (a.shots[0].high || 0) ? b : a);
            words.push('adds ' + (add.length > 1 ? add.length + ' x ' : '')
              + most.shots[0].low + '-' + most.shots[0].high);
          }
          return words.join(', ');
        })() : '';
        const shares = one && one.rel
          ? one.rel.map(part => saysRel(part, bonus)).join(' ')
          : '';
        const heals = one && one.heal ? [
          one.heal.flatHP ? '+' + one.heal.flatHP + ' HP/s' : '',
          one.heal.partHP ? '+' + round(one.heal.partHP * 100) + '% HP/s' : '',
          one.heal.flatMP ? '+' + one.heal.flatMP + ' MP/s' : '',
          one.heal.partMP ? '+' + round(one.heal.partMP * 100) + '% MP/s' : '',
          one.heal.soak ? '-' + round((1 - one.heal.soak) * 100) + '% damage taken' : ''
        ].filter(Boolean).join(' ') : '';
        const said = one && one.worn
          ? '<u>' + Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' ') + '</u>'
          : swaps ? '<u>' + esc(swaps) + '</u>'
          : shares ? '<u>' + esc(shares) + '</u>'
          : heals ? '<u>' + esc(heals) + '</u>'
          : (one && one.alters ? '<u class="tc-uncounted">changes the shot</u>' : '');
        // The whole sentence, for the one that has been cut short on the card.
        const whole = one && (swaps || shares || heals
          || (one.worn && Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' ')));
        chips.push('<span class="tc-ench' + (held ? ' is-held' : '')
          + (one ? '' : ' is-empty') + '"'
          + (whole ? ' title="' + esc(one.name + ' — ' + whole) + '"' : '') + '>'
          + (one ? sheetIcon(one.pic, 18) : '')
          + '<button type="button" class="tc-ench-pick" data-ench="' + hand + ':' + at + '">'
          + (one ? esc(one.name) : '<em>empty</em>') + '</button>'
          + said
          + '<button type="button" class="tc-hold tc-lock" data-hold="'
          + hand + ':' + at + '" aria-pressed="' + (held ? 'true' : 'false')
          + '" title="' + lockSays(held) + ' while the calculator works"'
          + ' aria-label="' + lockSays(held) + '">' + LOCK(held) + '</button>'
          + (one ? '<button type="button" class="tc-drop" data-drop="' + hand + ':' + at
            + '" title="take this enchantment off">×</button>' : '')
          + '</span>');
      }
      chips.push('<label class="tc-rarity">slots'
        + '<select data-slots="' + hand + '">'
        + [0, 1, 2, 3, 4].map(n => '<option value="' + n + '"'
          + (n === worn.slots ? ' selected' : '') + '>' + n + '</option>').join('')
        + '</select></label>');

      return '<div class="tc-slot' + (locked ? ' is-held' : '') + '">'
        + '<div class="tc-slot-head">'
        + '<button type="button" class="tc-item-pick" data-item="' + hand + '">'
        + itemIcon(worn.name)
        + '<span class="tc-item-said">'
        + '<span class="tc-item-where">' + say
        + (marks.length ? '<span class="chips">' + marks.map(([kind, said]) =>
          '<i class="chip is-' + kind + '">' + esc(said) + '</i>').join('') + '</span>' : '')
        + '</span>'
        + '<span class="tc-item-name">' + (worn.name ? esc(worn.name) : 'nothing') + '</span>'
        + '</span></button>'
        + (worn.name ? '<button type="button" class="tc-take" data-take="' + hand
          + '" title="Take this item and what is on it to the enchant calculator">'
          + 'enchant</button>' : '')
        + '<button type="button" class="tc-hold tc-lock" data-hold="' + hand
        + '" aria-pressed="' + (locked ? 'true' : 'false')
        + '" title="' + lockSays(locked) + ' while the calculator works"'
        + ' aria-label="' + lockSays(locked) + '">' + LOCK(locked) + '</button>'
        /*
         * What the item does goes under the row rather than in it.
         *
         * It used to sit inside the button that changes the item, which put
         * it in a column ending where the two buttons begin - so it was cut
         * off mid-sentence while the width beneath those buttons sat empty.
         * On its own line it has the whole card and says all of it.
         */
        + (bits.length ? '<span class="tc-bits">' + esc(bits.join(' · ')) + '</span>' : '')
        + '</div>'
        + '<div class="tc-ench-strip">' + chips.join('') + '</div>'
        + '</div>';
    }).join('');
  }

  function drawStats() {
    const box = el('tcStats');
    if (!box) return;
    const got = statsOf(build);
    box.innerHTML = STATS.map(([key, say]) => {
      const now = got.now[key];
      const top = got.top[key] || now || 1;
      /*
       * Two lengths, not one: what the class itself reaches, and what the
       * gear has put on top of it. A single bar answers "is this maxed",
       * which the reader already knows; the question a build asks is which
       * statistics the gear is actually lifting and which it is leaving
       * alone, and that is the difference between the two lengths.
       */
      const base = got.base[key] + (got.from.exalt[key] || 0);
      const given = now - base;
      const most = Math.max(now, top);
      const wasPart = Math.max(0, Math.min(1, base / most));
      const gotPart = Math.max(0, Math.min(1, given / most));
      const over = now > top;
      return '<div class="tc-stat is-' + key + (over ? ' is-over' : '')
        + (given > 0.05 ? ' is-lifted' : given < -0.05 ? ' is-cut' : '')
        + '" style="--tint:' + TINT[key] + '">'
        + '<i>' + say + '</i>'
        + '<span class="tc-bar">'
        + '<span class="tc-bar-was" style="width:' + (wasPart * 100).toFixed(1) + '%"></span>'
        + '<span class="tc-bar-got" style="width:' + (Math.abs(gotPart) * 100).toFixed(1) + '%"></span>'
        + '</span>'
        + '<b>' + round(now) + '<u>/' + top + '</u>'
        + (Math.abs(given) > 0.05
          ? '<em>' + (given > 0 ? '+' : '') + round(given) + '</em>' : '')
        + '</b>'
        + '</div>';
    }).join('') + setsSaid();
  }

  /*
   * And what a set is paying, when one is on.
   *
   * It is the only bonus on the page that comes from the outfit rather than
   * from a piece of it, so there is nowhere else it could be shown: a player
   * looking at two pieces of the Legion Elite Set has no way of telling from
   * the two lines above them that a hundred and twenty life of the total came
   * from wearing them together.
   */
  function setsSaid() {
    const on = setsOn(build);
    if (!on.length) return '';
    return on.map(kit => '<div class="tc-setline"><b>' + esc(kit.name) + '</b>'
      + '<i>' + kit.many + ' pieces</i>'
      + '<span>' + Object.keys(kit.gives)
        .map(key => '<u style="color:' + TINT[key] + '">' + plus(kit.gives[key])
          + ' ' + key.toUpperCase() + '</u>').join('')
      + '</span></div>').join('');
  }

  const plus = n => (n > 0 ? '+' : '') + (Math.round(n * 10) / 10);
  /*
   * A short line, not a paragraph. The ones that raise a statistic say so in
   * three words; the ones that hang an effect off a hit carry a sentence of
   * conditions in the client, and a column of those unread is worse than a
   * column of half-sentences.
   */
  const shortly = words => {
    const one = String(words || '').split('\n')[0].trim();
    return one.length > 44 ? one.slice(0, 43) + '…' : one;
  };
  const round = n => Math.round(n * 10) / 10;
  const commas = n => Math.round(n).toLocaleString('en-US');

  /*
   * What the search is being asked for, and what it is starting from.
   *
   * Pressing a button that rearranges your whole build is easier to do when
   * you can see the number it is aiming at and what that number is now - and
   * when you can put the build back afterwards, which is what turns this from
   * a gamble into a thing worth trying.
   */
  /*
   * The bargain, as a row of sliders - and only when there is a bargain to
   * strike. One thing asked for has nothing to trade against.
   */
  function drawMix() {
    const box = el('tcMix');
    if (!box) return;
    const parts = sharesOf(build);
    box.hidden = parts.length < 2;
    if (box.hidden) { box.innerHTML = ''; return; }
    box.innerHTML = parts.map(one =>
      '<span class="tc-mix-one' + (heldShare(build, one.goal.id) ? ' is-held' : '')
      + '" style="--tint:' + one.goal.tint + '">'
      + '<i>' + esc(one.goal.say) + '</i>'
      + '<input type="range" min="1" max="' + (100 - parts.length + 1)
      + '" value="' + Math.round(one.part * 100)
      + '" data-mix="' + esc(one.goal.id) + '">'
      + '<b>' + Math.round(one.part * 100) + '%</b>'
      + '<button type="button" class="tc-hold" data-pin="' + esc(one.goal.id)
      + '" title="hold this share while the others move">'
      + (heldShare(build, one.goal.id) ? 'held' : 'hold') + '</button>'
      + '</span>').join('');
  }

  /*
   * The same numbers, written into the row that is already there. Used while
   * a slider is being dragged, when replacing the row would end the drag.
   */
  function tuneMix(dragged) {
    const box = el('tcMix');
    if (!box) return;
    for (const one of sharesOf(build)) {
      const bar = box.querySelector('[data-mix="' + one.goal.id + '"]');
      if (!bar) continue;
      const pct = Math.round(one.part * 100);
      if (bar !== dragged) bar.value = String(pct);
      const said = bar.parentElement && bar.parentElement.querySelector('b');
      if (said) said.textContent = pct + '%';
    }
  }

  function drawSearch() {
    const said = el('tcNow');
    if (said) {
      said.innerHTML = goalsOf(build).map(one => {
        const now = scoreOf(build, one);
        return Number.isFinite(now)
          ? '<span class="figure"><b style="color:' + esc(one.tint) + '">'
            + esc(sayGoal(one, now)) + '</b><small>'
            + esc(one.say.toLowerCase()) + ' now</small></span>'
          : '';
      }).join('');
    }
    const aside = el('tcAside');
    if (aside) {
      const names = Object.keys(build.banned || {});
      aside.hidden = !names.length;
      aside.innerHTML = names.length
        ? '<i>Set aside</i>' + names.map(name =>
          '<button type="button" class="tc-aside-one" data-unban="' + esc(name)
          + '" title="Put it back in the running">' + esc(name) + ' ×</button>').join('')
        : '';
    }
    const kept = el('tcKept');
    if (kept) {
      const many = Object.values(build.locked).filter(Boolean).length;
      kept.textContent = many
        ? many + (many === 1 ? ' thing kept' : ' things kept')
        : 'nothing kept - it may change anything';
    }
    const undo = el('tcUndo');
    if (undo) undo.hidden = !before;
  }

  /* A score in the words of the thing it measures. */
  function sayGoal(goal, value) {
    if (!Number.isFinite(value)) return '\u2014';
    if (goal.id === 'kill') return round(-value) + 's';
    if (goal.id && goal.id.indexOf('stat:') === 0) return round(value);
    return commas(value);
  }

  let before = null;

  /*
   * What the bench is not showing you.
   *
   * A hundred and sixteen weapons and abilities throw something that does not
   * travel in a straight line - it weaves, or speeds up, or comes back - and
   * the client states the parameters of that without stating the algorithm.
   * The bench draws a straight line, which is honest arithmetic for the
   * damage and a lie about the flight, so it says which.
   */
  function drawNumbers() {
    const box = el('tcNumbers');
    if (!box) return;
    const stats = statsOf(build).now;
    const at = build.against;
    const numbers = numbersFor(build, at);
    const boss = data.byBoss[build.boss];
    const againstBoss = boss ? numbersFor(build, boss.def) : null;
    const kill = boss && againstBoss && againstBoss.total
      ? boss.hp / againstBoss.total : null;
    /*
     * Four numbers. Everything else this page can work out is on the curve
     * beneath it or in the fight above it, and a wall of figures is what
     * the page looked like before somebody said so.
     */
    /*
     * The middle two describe whichever hand is doing the work. They were the
     * weapon's, always, so turning the weapon off left two noughts sitting
     * there claiming the ability fires nothing - when what it does is throw
     * one big shot every few seconds, which is the interesting half of the
     * comparison.
     */
    const spellOnly = build.using === 'spell';
    const hand = spellOnly ? numbers.spell : numbers.gun;
    const often = spellOnly
      ? (hand.every ? round(1 / hand.every) : 0)
      : round(hand.rate);
    const rows = [
      ['damage a second', commas(numbers.total), true],
      [spellOnly ? 'casts a second' : 'shots a second', often],
      [spellOnly ? 'each cast' : 'each shot', commas(hand.each)
        + (hand.many > 1 ? ' x ' + hand.many : '')]
    ];
    /*
     * And where it fires in runs, what the run is - since the shots a second
     * above is the rate inside the run, and on its own it reads as a weapon
     * that never stops.
     */
    if (!spellOnly && hand.burst) {
      rows.push(['in bursts of', hand.burst.shots
        + ', then ' + round(hand.burst.wait) + 's']);
    }
    if (kill !== null) {
      rows.push([esc(boss.name) + ' dies in', round(kill) + 's', true]);
    }
    /*
     * The same row of figures the enchanter uses for its answer: the number
     * large and set in tabular figures, the words for it small and grey
     * underneath. Four tiles in boxes was this page inventing a treatment the
     * site already had.
     */
    box.innerHTML = rows.map(([say, was, loud]) =>
      '<span class="figure' + (loud ? ' is-loud' : '') + '"><b>' + was
      + '</b><small>' + say + '</small></span>').join('');
  }

  /*
   * Damage a second against every armour a thing might have.
   *
   * This is the picture worth having, because armour does not scale a build
   * down evenly: it takes a flat bite out of every shot, so a weapon that
   * throws many small ones falls off a cliff and one that throws a single
   * heavy one barely notices. Two builds level on a bare target can be
   * ten to one on an armoured one, and no single number shows that.
   */
  function drawGraph() {
    const canvas = el('tcGraph');
    if (!canvas) return;
    const wide = canvas.clientWidth || 520;
    const tall = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(wide * dpr);
    canvas.height = Math.round(tall * dpr);
    const pen = canvas.getContext('2d');
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, wide, tall);

    const MOST = 100;
    const lines = [
      { say: 'weapon', tint: '#e0a13a', of: n => n.gun.dps },
      { say: 'ability', tint: '#6f9fd8', of: n => n.spell.dps },
      { say: 'both', tint: '#8fd08a', of: n => n.total }
    ];
    const points = [];
    let ceiling = 1;
    for (let def = 0; def <= MOST; def++) {
      const n = numbersFor(build, def);
      points.push(n);
      ceiling = Math.max(ceiling, n.total);
    }
    const pad = { l: 52, r: 10, t: 12, b: 26 };
    const x = def => pad.l + (def / MOST) * (wide - pad.l - pad.r);
    const y = v => tall - pad.b - (v / ceiling) * (tall - pad.t - pad.b);

    pen.strokeStyle = 'rgba(255,255,255,.09)';
    pen.fillStyle = 'rgba(255,255,255,.45)';
    pen.font = '11px ui-monospace, monospace';
    pen.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = ceiling * i / 4;
      pen.beginPath();
      pen.moveTo(pad.l, y(v));
      pen.lineTo(wide - pad.r, y(v));
      pen.stroke();
      pen.fillText(commas(v), 4, y(v) + 4);
    }
    for (let def = 0; def <= MOST; def += 20) {
      pen.fillText(String(def), x(def) - 6, tall - 8);
    }
    pen.fillStyle = 'rgba(255,255,255,.35)';
    pen.fillText('enemy armour', wide - pad.r - 82, tall - 8);

    for (const line of lines) {
      pen.strokeStyle = line.tint;
      pen.lineWidth = 2;
      pen.beginPath();
      points.forEach((n, def) => {
        const at = y(line.of(n));
        if (def === 0) pen.moveTo(x(def), at); else pen.lineTo(x(def), at);
      });
      pen.stroke();
    }

    // Where the target being aimed at sits on it.
    const boss = data.byBoss[build.boss];
    for (const mark of [{ at: build.against, say: 'chosen', tint: 'rgba(255,255,255,.5)' },
      boss ? { at: Math.min(MOST, boss.def), say: boss.name, tint: 'rgba(224,161,58,.55)' } : null]) {
      if (!mark) continue;
      pen.strokeStyle = mark.tint;
      pen.lineWidth = 1;
      pen.setLineDash([3, 3]);
      pen.beginPath();
      pen.moveTo(x(mark.at), pad.t);
      pen.lineTo(x(mark.at), tall - pad.b);
      pen.stroke();
      pen.setLineDash([]);
    }

    const key = el('tcKey');
    if (key) {
      key.innerHTML = lines.map(line => '<span><i style="background:' + line.tint
        + '"></i>' + line.say + '</span>').join('');
    }
  }

  /* ---------------- the duel ---------------- */
  /*
   * The build, hitting the thing you chose to hit.
   *
   * Every number on this page is a rate, and a rate is a hard thing to feel.
   * Six hundred a second and thirty-four thousand a second are both just
   * words until you watch the same boss take four hundred seconds and then
   * five. So the frame plays it out: the class stands on the left in the
   * animation the client gives it, throws the shots its weapon actually
   * throws at the rate its dexterity actually gives it, and the target's life
   * comes down by what each one lands for.
   *
   * It is the same arithmetic as the panel beside it, not a second opinion.
   * The damage a shot lands, the number of shots and how often they go are
   * all read from the same functions, so the clock in the corner and the
   * "dies in" line agree by construction rather than by luck.
   */
  const duel = {
    on: true, at: 0, dealt: 0, shots: [], cool: 0, spell: 0, swing: 0, left: 0,
    hp: 0, full: 0, over: 0, last: 0, art: new Map(), bits: [],
    mp: 0, mpFull: 0
  };

  /*
   * One sheet holds every target and every bolt, cut out of the client by
   * tools/theory-sprites.js: four hundred things worth hitting with the whole
   * run of poses the game keeps for them, and the nine hundred projectiles
   * the weapons actually throw. One picture, one index of rectangles.
   */
  function theSheet() {
    let img = duel.art.get('sheet');
    if (!img) {
      const bundle = window.ROTMG_BUNDLE;
      img = new Image();
      img.decoding = 'async';
      img.src = (bundle && bundle.theorySheet) || 'assets/theory/sheet.png';
      duel.art.set('sheet', img);
    }
    return img;
  }

  const pieceOf = key => (key && data.sheet && data.sheet.pics[key]) || null;

  /*
   * Which frame of a thing to show. The registry files them by facing and
   * action - nought standing, one walking, two swinging - so a target that
   * has a swing plays its swing when it is being hit and stands the rest of
   * the time. None of it is animation I wrote.
   */
  function frameOf(piece, doing, clock) {
    if (!piece) return 0;
    const poses = piece.poses;
    if (!poses) return piece.frames > 1 ? Math.floor(clock * 4) % piece.frames : 0;
    const list = poses['0/' + doing] || poses['3/' + doing] || poses['0/0']
      || poses[Object.keys(poses)[0]];
    return list[Math.floor(clock * (doing === 1 ? 6 : 3)) % list.length];
  }

  function drawPiece(pen, piece, frame, x, y, tall) {
    const img = theSheet();
    if (!piece || !img.complete || !img.naturalWidth) return false;
    const wide = tall * (piece.w / piece.h);
    pen.drawImage(img, piece.x + frame * piece.w, piece.y, piece.w, piece.h,
      x, y - tall, wide, tall);
    return true;
  }

  function resetDuel() {
    const boss = data.byBoss[build.boss];
    duel.at = 0; duel.dealt = 0; duel.shots.length = 0;
    duel.cool = 0; duel.spell = 0; duel.swing = 0; duel.over = 0; duel.left = 0;
    duel.full = boss ? boss.hp : 0;
    duel.hp = duel.full;
    duel.bits.length = 0;
    // You walk in with a full pool, which is why the opening is faster than
    // the rest: the first few casts are paid for out of savings.
    const stats = statsOf(build);
    duel.mpFull = stats ? stats.now.mp : 0;
    duel.mp = duel.mpFull;
  }

  /* One frame of it, at whatever rate the browser is painting. */
  function stepDuel(delta) {
    const boss = data.byBoss[build.boss];
    if (!boss) return;
    const stats = statsOf(build).now;
    const weapon = data.byItem[(build.gear.weapon || {}).name];
    const ability = data.byItem[(build.gear.ability || {}).name];
    const gun = weaponRate(weapon, stats, boss.def, scaleOf(build), subOf(build));
    const spell = abilityRate(ability, stats, boss.def);

    stepBits(delta);
    if (duel.hp <= 0) return;                 // it is over; nothing else moves
    duel.at += delta;
    if (duel.swing > 0) duel.swing -= delta;

    if (gun.rate > 0) {
      duel.cool -= delta;
      if (duel.cool <= 0) {
        /*
         * In runs, where the weapon fires in runs. The shots inside one come
         * at the ordinary rate; the pause comes after the last of them.
         */
        if (gun.burst) {
          duel.left = duel.left > 0 ? duel.left - 1 : gun.burst.shots - 1;
          duel.cool += duel.left > 0 ? 1 / gun.rate : gun.burst.wait;
        } else {
          duel.cool += 1 / gun.rate;
        }
        duel.swing = Math.min(0.22, 1 / gun.rate * 0.7);
        loose(weapon, gun, true);
      }
    }
    /*
     * The magic comes back at the rate wisdom says it does, and a cast is
     * paid for out of what is there. So the first seconds of a fight are the
     * fast ones and the rest is whatever the pool can afford - which is the
     * thing a sustained figure cannot show you.
     */
    const cost = 0;                            // the ability is set aside
    duel.mp = Math.min(duel.mpFull, duel.mp + MANA_AT(stats.wis) * delta);
    if (spell.dps > 0 && cost) {
      duel.spell -= delta;
      if (duel.spell <= 0 && duel.mp >= cost) {
        duel.mp -= cost;
        duel.spell = 0.6;                     // as fast as a hand can cast
        loose(ability, spell, false);
      }
    }

    /*
     * Each shot ages at its own rate.
     *
     * The bench used to move every shot across in a fifth of a second, which
     * made a Short Sword and a Sprite Wand look identical and threw away two
     * numbers the client states outright. A shot's flight takes its range
     * divided by its speed - a Short Sword's three and a half tiles at
     * fourteen a second is a quarter of a second, an Energy Staff's eight and
     * a half at eighteen is nearly half of one - and it lands when it arrives.
     * The damage is counted at the impact, not at the shot, so the total on
     * the frame follows what has actually hit.
     */
    for (let i = duel.shots.length - 1; i >= 0; i--) {
      const one = duel.shots[i];
      one.age += delta;
      if (one.age < one.lasts) continue;
      duel.shots.splice(i, 1);
      if (duel.hp <= 0) continue;
      duel.hp -= one.hurt;
      duel.dealt += one.hurt;
      if (duel.hp <= 0) { duel.hp = 0; duel.over = duel.at; blowUp(); }
    }
    /*
     * And once it is down it stays down. The time it took is the answer to
     * the question the frame was asked, and a frame that clears itself two
     * seconds later is one that hides its own answer; the fight starts again
     * when somebody asks it to.
     */
  }

  /*
   * Letting a volley go.
   *
   * Everything a shot needs is settled here and carried with it: the picture
   * it is drawn from, how long it is in the air, the angle it left at. Read
   * back off the current gear while drawing, a shot already in flight would
   * change its face the moment you swapped weapons mid-fight.
   *
   * The angles are the item's own. A weapon states an arc gap in degrees
   * between the shots of a volley; an ability that throws eight or more is a
   * nova and divides the circle. Parallel lanes were a stand-in for both and
   * looked like neither.
   */
  function loose(item, rate, mine) {
    const many = Math.max(1, rate.many || 1);
    const shot = (item && item.shots && item.shots[0]) || {};
    const bolt = pieceOf(item && item.pic);
    const reach = rate.reach || shot.reach || 6;
    const fast = rate.fast || shot.fast || 8;
    const round = many >= 8 && !mine;
    const fan = (item && item.fan !== undefined ? item.fan : 12) * Math.PI / 180;
    for (let n = 0; n < many; n++) {
      const angle = round
        ? (n / many) * Math.PI * 2
        : (many === 1 ? 0 : (n - (many - 1) / 2) * fan);
      duel.shots.push({
        age: 0,
        lasts: Math.max(0.05, reach / fast),
        angle,
        hurt: rate.each,
        mine, bolt,
        spin: bolt && bolt.spin ? bolt.spin : 0,
        tilt: bolt && bolt.tilt ? bolt.tilt : 0,
        /*
         * How it weaves, if it does. The client gives an amplitude in tiles
         * and a frequency, and a volley alternates phase - which is why a
         * staff's two missiles braid around each other instead of flying as
         * one thick line. The sine is the shape the game's own players have
         * always read off those two numbers; the numbers are the client's.
         */
        amp: shot.amp || 0,
        freq: shot.freq || 0,
        phase: (n % 2) ? Math.PI : 0,
        reach
      });
    }
  }

  /*
   * It comes apart when it dies. Watching a life bar reach nought is a fact;
   * watching the thing burst is the same fact and reads as a kill, which is
   * the whole reason this frame is here rather than another row of figures.
   */
  function blowUp() {
    duel.bits.length = 0;
    for (let i = 0; i < 34; i++) {
      const angle = Math.random() * Math.PI * 2;
      const fast = 30 + Math.random() * 130;
      duel.bits.push({
        x: 0, y: 0, vx: Math.cos(angle) * fast, vy: Math.sin(angle) * fast - 40,
        left: 0.5 + Math.random() * 0.5, full: 1
      });
    }
  }

  function stepBits(delta) {
    for (let i = duel.bits.length - 1; i >= 0; i--) {
      const one = duel.bits[i];
      one.x += one.vx * delta;
      one.y += one.vy * delta;
      one.vy += 260 * delta;
      one.left -= delta;
      if (one.left <= 0) duel.bits.splice(i, 1);
    }
  }

  function drawDuel() {
    const canvas = el('tcDuel');
    if (!canvas) return;
    const wide = canvas.clientWidth || 320;
    const tall = canvas.clientHeight || 150;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(wide * dpr)) {
      canvas.width = Math.round(wide * dpr);
      canvas.height = Math.round(tall * dpr);
    }
    const pen = canvas.getContext('2d');
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, wide, tall);
    pen.imageSmoothingEnabled = false;

    const kind = data.byClass[build.klass];
    const boss = data.byBoss[build.boss];
    const floor = tall - 30;

    /*
     * How far apart they stand: the range of the weapon in your hand.
     *
     * The bench used to be a fixed stretch of floor whatever you were
     * holding, which quietly showed a dagger and a bow reaching the same
     * distance and spread a volley across twenty tiles of ground - so the
     * shots of a bow left the top of the frame long before they arrived. A
     * tile is a tile here, thirty pixels of it, and the two of them stand the
     * weapon's own range apart with the pair middled in the frame.
     */
    const kit = statsOf(build);
    const arm = data.byItem[(build.gear.weapon || {}).name];
    const shooting = kit
      ? weaponRate(arm, kit.now, 0, scaleOf(build), subOf(build)) : {};
    const PX_TILE = 30;
    const piece = pieceOf(boss && boss.pic);
    const room = Math.min(88, tall * 0.64);
    const longest = piece ? Math.max(piece.w, piece.h) : 1;
    const big = piece ? room * (piece.h / longest) : room;
    const across = piece ? room * (piece.w / longest) : room;
    const me = pieceOf((kind && kind.pic) || '');
    const side = Math.min(52, tall * 0.4);
    const mine = me ? side * (me.w / Math.max(1, me.h)) : side * 0.6;
    const apart = Math.max(80, Math.min(wide - 40 - mine - across,
      (shooting.reach || 6) * PX_TILE));
    const left = Math.max(14, (wide - (mine + apart + across)) / 2);
    const bossX = left + mine + apart;

    /* The one on the left, in whichever pose it is in. */
    if (me) {
      drawPiece(pen, me, frameOf(me, duel.swing > 0 ? 2 : 0, duel.at),
        left, floor, side);
    } else {
      pen.fillStyle = '#6f8fbf';
      pen.fillRect(left, floor - side, side * 0.6, side);
    }

    /* And the thing being hit, on the right, in its own animation. */
    /*
     * Every target the same size, whatever the client says it is.
     *
     * On the map a declared size matters: a spider says fifty and is half its
     * picture, a god says a hundred and fifty, and the difference is the
     * point. Here it is only noise - this frame is a test bench, and a bench
     * that draws one dummy at twice another makes two builds look different
     * when only the dummy changed. So the longest side of whatever is being
     * hit is always the same number of pixels, and the thing's own
     * proportions are kept inside that: a wide creature stays wide without
     * ending up bigger than a tall one.
     */
    /*
     * It stands still and stays still.
     *
     * Two things were making it jump. Switching to its attack pose whenever a
     * shot landed swapped in a different drawing, often a different size, for
     * a frame at a time - and a random shake on top of that moved it again
     * every time the screen was painted. A thing being shot at should flinch,
     * not teleport, so it keeps its own idle animation throughout and the hit
     * shows as a flash instead.
     */
    const struck = duel.hp > 0 && duel.shots.some(s => s.age > s.lasts * 0.86);
    pen.globalAlpha = duel.hp > 0 ? 1 : 0.22;
    const drew = drawPiece(pen, piece, frameOf(piece, 0, duel.at), bossX, floor, big);
    if (drew && struck) {
      pen.globalAlpha = 0.35;
      pen.fillStyle = '#fff';
      pen.globalCompositeOperation = 'lighter';
      drawPiece(pen, piece, frameOf(piece, 0, duel.at), bossX, floor, big);
      pen.globalCompositeOperation = 'source-over';
    }
    if (!drew) {
      pen.fillStyle = duel.hp > 0 ? '#8a5a5a' : 'rgba(138,90,90,.25)';
      pen.fillRect(bossX, floor - big, big, big);
    }
    pen.globalAlpha = 1;

    /*
     * And what is in the air between them.
     *
     * Everything a shot needs was settled when it was let go and travels with
     * it - its picture, how long it is in the air, the angle it left at - so
     * a shot already in flight keeps its face when the gear underneath it
     * changes.
     *
     * Each is turned once, as a whole bitmap: to the direction it is
     * travelling, plus the eighth-turns of angle correction the client puts
     * on that projectile, plus whatever it has spun in its own lifetime if it
     * is a spinner. Turning the bitmap rather than drawing a line beside it
     * means the black outline the art already carries turns with the colour.
     */
    const from = left + mine * 0.9, to = bossX + across * 0.45;
    const reachAcross = to - from;
    for (const one of duel.shots) {
      const part = Math.max(0, Math.min(1, one.age / one.lasts));
      const along = reachAcross * part;
      /*
       * Across its own line, if it weaves. The offset is perpendicular to the
       * direction of travel, in tiles converted to the width of the bench, so
       * a half-tile amplitude looks like half a tile of the range it covers.
       */
      const sway = one.amp
        ? one.amp * (reachAcross / Math.max(1, one.reach))
          * Math.sin(2 * Math.PI * one.freq * one.age + one.phase)
        : 0;
      const x = from + Math.cos(one.angle) * along - Math.sin(one.angle) * sway;
      const y = floor - side * 0.55 + Math.sin(one.angle) * along
        + Math.cos(one.angle) * sway;
      const bolt = one.bolt;
      if (bolt) {
        /*
         * As big as the client says, at the scale of this floor.
         *
         * The bolt used to be given a height of sixteen pixels and a width
         * from its proportions, which is fine for a round missile and absurd
         * for a blade: the dagger's projectile is eight pixels by one, so
         * sixteen tall made it a hundred and twenty-eight long - a grey bar
         * across the whole bench. A texture is eight pixels to the tile, and
         * a tile here is thirty, so the drawing is simply that, scaled by the
         * size the client gives the projectile.
         */
        const per = (PX_TILE / 8) * Math.min(2, Math.max(0.5, bolt.size / 100));
        const high = Math.max(2, bolt.h * per);
        const wide = high * (bolt.w / bolt.h);
        const frame = bolt.frames > 1
          ? Math.floor(one.age * 14) % bolt.frames : 0;
        const facing = one.angle + one.tilt * Math.PI / 4
          + (one.spin ? (one.age * 1000) / one.spin : 0);
        pen.save();
        pen.translate(x, y);
        pen.rotate(facing);
        const drew = drawPiece(pen, bolt, frame, -wide / 2, high / 2, high);
        pen.restore();
        if (drew) continue;
      }
      pen.strokeStyle = one.mine ? 'rgba(255,238,190,.95)' : 'rgba(140,190,240,.95)';
      pen.lineWidth = 2;
      pen.beginPath();
      pen.moveTo(x - Math.cos(one.angle) * 9, y - Math.sin(one.angle) * 9);
      pen.lineTo(x, y);
      pen.stroke();
    }

    /* The thing's life, and what has been taken off it. */
    const barW = wide - 44;
    const part = duel.full ? Math.max(0, duel.hp / duel.full) : 0;
    pen.fillStyle = 'rgba(255,255,255,.08)';
    round(pen, 22, tall - 20, barW, 7, 3.5); pen.fill();
    pen.fillStyle = part > 0.35 ? '#8fd08a' : '#d4685f';
    round(pen, 22, tall - 20, Math.max(0, barW * part), 7, 3.5); pen.fill();

    /* And the magic left, which is what paces the ability. */
    if (duel.mpFull && build.using !== 'gun') {
      const mine = Math.max(0, Math.min(1, duel.mp / duel.mpFull));
      pen.fillStyle = 'rgba(255,255,255,.07)';
      round(pen, 22, tall - 11, barW, 3, 1.5); pen.fill();
      pen.fillStyle = '#5b8cd9';
      round(pen, 22, tall - 11, Math.max(0, barW * mine), 3, 1.5); pen.fill();
    }

    /* Whatever is left of it, on its way outward. */
    if (duel.bits.length) {
      const middle = bossX + across / 2;
      for (const one of duel.bits) {
        pen.globalAlpha = Math.max(0, one.left / one.full);
        pen.fillStyle = one.left > 0.6 ? '#fff2cf' : '#e0a13a';
        pen.fillRect(middle + one.x, floor - big / 2 + one.y, 3, 3);
      }
      pen.globalAlpha = 1;
    }

    /*
     * Whose number is whose. The life left was drawn at the left edge, under
     * the character, where it read as something about the character - it is
     * the target's, so it is written under the target, and the clock and the
     * running total sit on the other side where the fight is being counted
     * rather than suffered.
     */
    pen.font = '11px ui-monospace, monospace';
    pen.textAlign = 'right';
    pen.fillStyle = 'rgba(255,255,255,.6)';
    pen.fillText(commas(duel.hp) + ' / ' + commas(duel.full), wide - 22, tall - 25);
    /*
     * And what it is wearing, beside what it has left. Every number under
     * this frame is read against that armour - it is subtracted from each
     * shot before anything else happens - so a frame that shows the life and
     * hides the armour shows half of what decides the fight.
     */
    if (boss) {
      pen.fillStyle = 'rgba(255,255,255,.38)';
      pen.fillText(boss.def + ' armour', wide - 22, tall - 37);
    }
    pen.textAlign = 'left';
    pen.fillStyle = 'rgba(255,255,255,.45)';
    pen.fillText(round(duel.at) + 's · ' + commas(duel.dealt) + ' dealt', 22, tall - 25);

    /* And how long it took, said once and said large. */
    if (duel.hp <= 0) {
      pen.textAlign = 'center';
      pen.fillStyle = '#f0c274';
      pen.font = '600 20px ui-monospace, monospace';
      pen.fillText('dead in ' + round(duel.over) + 's', wide / 2, tall * 0.42);
      pen.font = '11px ui-monospace, monospace';
      pen.fillStyle = 'rgba(255,255,255,.45)';
      pen.fillText(commas(duel.dealt) + ' damage', wide / 2, tall * 0.42 + 16);
      pen.textAlign = 'left';
    }
  }

  let painting = false;
  function keepPainting() {
    if (painting) return;
    painting = true;
    let was = performance.now();
    const tick = now => {
      const delta = Math.min(0.05, (now - was) / 1000);
      was = now;
      const open = document.body.dataset.page === 'theory';
      if (open && duel.on && data && build) { stepDuel(delta); drawDuel(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------------- pickers ---------------- */

  function openItems(hand) {
    picking = { kind: 'item', hand };
    const list = itemsFor(hand, build.klass);
    show('Choose a ' + hand, list.map(one => {
      const gun = one.shots && one.shots[0];
      const bits = [];
      if (one.tier !== undefined) bits.push('T' + one.tier);
      if (gun) bits.push(gun.low + '–' + gun.high);
      if (one.many > 1) bits.push('×' + one.many);
      if (one.mp) bits.push(one.mp + ' MP');
      if (one.worn) {
        for (const t of Object.keys(one.worn)) bits.push(plus(one.worn[t]) + ' ' + t);
      }
      for (const part of one.share || []) {
        bits.push(plus(part.pct) + '% of ' + part.of
          + (part.of === part.stat ? '' : ' as ' + part.stat));
      }
      return { id: one.name, name: one.name, says: bits.join(' · '), art: true, ban: true };
    }), 'nothing');
  }

  function openEnchants(hand, at) {
    picking = { kind: 'ench', hand, at };
    const worn = build.gear[hand];
    if (!worn.name) return;

    /*
     * The calculator's own dialogue, where it exists. It already shows an
     * enchantment the way this project shows one - the icon, the sentence,
     * the labels it gives and the labels it refuses, its weight - and two
     * dialogues for the same job would have drifted apart inside a month.
     */
    const held = rulesFor();
    if (held && typeof window.openEnchantPicker === 'function') {
      const item = data.byItem[worn.name];
      const locks = locksOn(held, worn.ench, at);
      const pool = EnchantEngine.eligiblePool(held, {
        item: worn.name,
        type: OF_HAND[item.hand] || 'WEAPON',
        slots: worn.slots,
        locks,
        subtypes: new Set()
      }, null);
      const opened = window.openEnchantPicker({
        title: 'Slot ' + (at + 1) + ' · ' + worn.name,
        sub: pool.length + ' available'
          + (locks.length ? ' · ' + locks.length + ' removed by the other slots' : ''),
        candidates: pool,
        onPick: name => {
          const mine = charmNamed(name);
          build.gear[hand].ench[at] = mine ? mine.id : null;
          picking = null;
          keep();
          paint();
        }
      });
      if (opened) return;
    }

    /*
     * One line per thing, not one per record. The client keeps a separate
     * enchantment for each item an effect can land on, so a picker built
     * straight off the list showed "Adonis' Shot, +3 ATT" a dozen times in a
     * row. Anything that reads the same and does the same is the same as far
     * as a person choosing one is concerned.
     */
    const seen = new Set();
    const list = enchantsFor(worn.name, worn.ench, at).filter(one => {
      const same = one.name + '|' + JSON.stringify(one.worn || 0) + '|' + (one.alters || '');
      if (seen.has(same)) return false;
      seen.add(same);
      return true;
    });
    show('Enchantment for ' + esc(worn.name), list.map(one => ({
      id: one.id,
      pic: one.pic,
      name: one.name,
      says: one.worn
        ? Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' · ')
        : shortly(one.says),
      counted: !!one.worn
    })), 'empty slot');
  }

  function show(title, rows, clearSay) {
    const box = el('tcPicker');
    el('tcPickerTitle').textContent = title;
    el('tcSearch').value = '';
    box.dataset.rows = JSON.stringify(rows);
    paintPicker(rows, clearSay);
    el('tcPickerWrap').hidden = false;
    el('tcSearch').focus();
  }

  function paintPicker(rows, clearSay) {
    const box = el('tcPicker');
    const out = ['<button type="button" class="tc-row" data-choose="">'
      + '<span class="tc-icon-big"></span><b>' + esc(clearSay || 'nothing')
      + '</b></button>'];
    /*
     * A first handful, not the lot. A thousand rows is a second of work
     * before anything appears, and nobody reads past the first screen anyway
     * - the search box is how you get to the rest.
     */
    for (const one of rows.slice(0, 120)) {
      out.push((one.ban
        ? '<span class="tc-row-pair"><button type="button" class="tc-ban" data-ban="'
          + esc(one.id) + '" title="Set this aside - the search will not offer it">'
          + '⊘</button>'
        : '')
        + '<button type="button" class="tc-row" data-choose="' + esc(one.id) + '">'
        + (one.art ? itemIcon(one.id)
          : (one.pic ? sheetIcon(one.pic, 26, 'tc-charm-row') : '<span class="tc-icon-big"></span>'))
        + '<b>' + esc(one.name) + '</b>'
        + '<u>' + esc(one.says || '') + '</u>'
        + (one.counted === false ? '<em class="tc-uncounted">not counted</em>' : '')
        + '</button>' + (one.ban ? '</span>' : ''));
    }
    if (rows.length > 120) {
      out.push('<p class="tc-more">' + (rows.length - 120)
        + ' more — type to narrow it down</p>');
    }
    box.innerHTML = out.join('');
  }

  function shutPicker() { el('tcPickerWrap').hidden = true; picking = null; }

  function chose(id) {
    if (!picking) return;
    if (picking.kind === 'item') {
      const worn = build.gear[picking.hand];
      worn.name = id || null;
      // What no longer fits comes off, rather than being counted anyway.
      worn.ench = worn.ench.map((was, i) =>
        (was && id && enchantsFor(id, worn.ench, i).some(e => e.id === was)) ? was : null);
    } else {
      build.gear[picking.hand].ench[picking.at] = id || null;
    }
    shutPicker();
    keep();
    paint();
  }

  /* ---------------- a build, carried between the tools ---------------- */
  /*
   * A build is a thing you want to show somebody, or take to the other tool,
   * and neither is possible while it lives only in this browser's storage. So
   * it goes in the address: the four items, what is on them, the class, what
   * is being fought, and nothing else - no damage figure, no cost, nothing
   * calculated. Whoever opens the link works it out again from the same
   * declarations, which is the only way two tools can agree.
   *
   * Plain JSON in base64url. Not a secret, not signed, and never executed:
   * every name in it is looked up in the catalogue and dropped if it is not
   * there, so a link from a different build of the site degrades to whatever
   * it can still resolve rather than to an error.
   */
  const SHARE_V = 1;

  function packBuild(state) {
    const gear = HANDS.map(([hand]) => {
      const worn = state.gear[hand] || {};
      if (!worn.name) return null;
      return [worn.name, (worn.ench || []).map(id => {
        const one = id && data.byEnch[id];
        return one ? one.name : null;
      })];
    });
    const say = {
      v: SHARE_V, k: state.klass, g: gear, t: state.boss,
      m: state.maxed ? 1 : 0, e: state.exalt ? 1 : 0
    };
    const raw = JSON.stringify(say);
    // Base64url: an address can carry it, and nothing in it needs escaping.
    return btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unpackBuild(token) {
    let said = null;
    try {
      const raw = decodeURIComponent(escape(atob(
        String(token).replace(/-/g, '+').replace(/_/g, '/'))));
      said = JSON.parse(raw);
    } catch (e) { return null; }
    if (!said || said.v !== SHARE_V || !data.byClass[said.k]) return null;
    const start = fresh(said.k);
    start.maxed = said.m !== 0;
    start.exalt = said.e !== 0;
    if (data.byBoss[said.t]) start.boss = said.t;
    HANDS.forEach(([hand], i) => {
      const one = (said.g || [])[i];
      if (!one || !data.byItem[one[0]]) return;
      start.gear[hand] = {
        name: one[0],
        slots: 4,
        ench: [0, 1, 2, 3].map(at => {
          const name = (one[1] || [])[at];
          const found = name && data.enchants.find(e => e.name === name);
          return found ? found.id : null;
        })
      };
    });
    start.name = data.byClass[said.k].name + ' build';
    return start;
  }

  /* Whatever build the address is carrying, if it is carrying one. */
  function buildFromAddress() {
    const at = String(location.hash || '').indexOf('build=');
    if (at < 0) return null;
    const token = String(location.hash).slice(at + 6).split('&')[0];
    return token ? unpackBuild(token) : null;
  }

  /* ---------------- tabs, kept the way the enchanter keeps them ---------------- */

  const STORE = 'rotmg.theorycraft.v1';

  function keep() {
    tabs[onTab] = build;
    try {
      localStorage.setItem(STORE, JSON.stringify({ tabs, onTab }));
    } catch (e) { /* a private window, or storage turned off */ }
  }

  function recall() {
    try {
      const was = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (was && Array.isArray(was.tabs) && was.tabs.length) {
        tabs = was.tabs;
        onTab = Math.min(was.onTab || 0, tabs.length - 1);
        return true;
      }
    } catch (e) { /* nothing remembered */ }
    return false;
  }

  function drawTabs() {
    const box = el('tcTabs');
    if (!box) return;
    box.innerHTML = tabs.map((one, i) =>
      '<button type="button" role="tab" class="tab' + (i === onTab ? ' is-active' : '')
      + '" data-tab="' + i + '">' + esc(one.name)
      + (tabs.length > 1 ? '<u data-shut="' + i + '">×</u>' : '')
      + '</button>').join('')
      + '<button type="button" class="tab tab-new" data-tab="new">+ New</button>';
  }

  /* ---------------- putting it on the screen ---------------- */

  function paint() {
    const kind = el('tcClass');
    if (kind && kind.value !== build.klass) kind.value = build.klass;
    build.level = 20;
    /*
     * The class, as itself. A name in a dropdown is a word; the sprite the
     * game draws is how anybody knows a Huntress from a Trickster, and it is
     * already cut and sitting in the atlas.
     */
    {
      const kind = data.byClass[build.klass];
      const face = el('tcFace');
      /*
       * One frame of the class, standing.
       *
       * It used to be read out of the realm atlas - a folder built for the
       * map - which put it on a different picture from everything else on
       * this page and left the offline copy, which cannot carry a folder,
       * with no figure at all. It is on the one sheet now, cut to the shape
       * of the drawing rather than to the shape of the rectangle around it.
       */
      const piece = kind && data.sheet && data.sheet.pics[kind.pic];
      if (piece) {
        const stand = (piece.poses
          && (piece.poses['3/0'] || piece.poses['0/0']) || [0])[0];
        const zoom = 42 / Math.max(piece.w, piece.h);
        face.style.width = (piece.w * zoom) + 'px';
        face.style.height = (piece.h * zoom) + 'px';
        face.style.backgroundSize = (data.sheet.wide * zoom) + 'px '
          + (data.sheet.tall * zoom) + 'px';
        face.style.backgroundPosition =
          (-(piece.x + stand * piece.w) * zoom) + 'px '
          + (-piece.y * zoom) + 'px';
        face.hidden = false;
      } else { face.hidden = true; }
    }
    for (const node of el('tcBody').querySelectorAll('[data-set]')) {
      const which = node.dataset.set;
      node.classList.toggle('is-on', !!build[which]);
    }
    for (const node of el('tcBody').querySelectorAll('[data-scope]')) {
      node.classList.toggle('is-on', node.dataset.scope === (build.scope || 'all'));
    }
    const asked = goalsOf(build).map(one => one.id);
    for (const node of el('tcGoals').querySelectorAll('[data-goal]')) {
      node.classList.toggle('is-on', asked.includes(node.dataset.goal));
    }
    // Read against whatever is being fought, since there is no dial any more.
    const aimedAt = data.byBoss[build.boss];
    build.against = aimedAt ? aimedAt.def : 0;
    for (const node of el('tcBosses').querySelectorAll('[data-boss]')) {
      node.classList.toggle('is-on', node.dataset.boss === build.boss);
    }
    const chosenBoss = data.byBoss[build.boss];
    el('tcBossSay').textContent = chosenBoss
      ? chosenBoss.name + ' · ' + commas(chosenBoss.hp) + ' life, '
        + chosenBoss.def + ' armour' : '';
    el('tcName').value = build.name;
    drawTabs();
    drawMix();
    drawSearch();
    drawSlots();
    drawStats();
    drawNumbers();
    resetDuel();
    drawDuel();
  }

  function fillPickers() {
    el('tcClass').innerHTML = data.classes.map(one =>
      '<option value="' + esc(one.name) + '">' + esc(one.name) + '</option>').join('');
    /*
     * You pick a thing to hit by looking at it. Everything here is either an
     * encounter or the boss at the end of a dungeon - the client marks both
     * as a quest - which leaves a list short enough to show as pictures, and
     * a picture is how anybody actually knows which one is the Shatters.
     */
    const targets = data.bosses.slice()
      .filter(one => one.pic).sort((a, b) => a.hp - b.hp);
    el('tcBosses').innerHTML = targets.map(one =>
      '<button type="button" class="tc-boss" data-boss="' + esc(one.name) + '"'
      + ' title="' + esc(one.name) + ' — ' + commas(one.hp) + ' life, '
      + one.def + ' armour">' + sheetIcon(one.pic, 34) + '</button>').join('');
    const groups = [...new Set(GOALS.map(one => one.group))];
    el('tcGoals').innerHTML = groups.map(name =>
      '<div class="tc-goal-row"><i>' + esc(name) + '</i>'
      + '<span>' + GOALS.filter(one => one.group === name).map(one =>
        '<button type="button" class="tc-goal" data-goal="' + one.id + '"'
        + (one.tint ? ' style="--tint:' + one.tint + '"' : '') + '>'
        + '<i class="tc-dot"></i>' + esc(one.say) + '</button>').join('')
      + '</span></div>').join('');
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    el('tcClass').addEventListener('change', event => {
      const was = build.name === (build.klass + ' build');
      build.klass = event.target.value;
      const start = fresh(build.klass);
      build.gear = start.gear;
      if (was) build.name = start.name;
      keep(); paint();
    });

    el('tcBody').addEventListener('click', event => {
      const flip = event.target.closest('[data-set]');
      if (!flip) return;
      build[flip.dataset.set] = !build[flip.dataset.set];
      keep(); paint();
    });
    el('tcBody').addEventListener('click', event => {
      const scope = event.target.closest('[data-scope]');
      if (!scope) return;
      build.scope = scope.dataset.scope;
      keep(); paint();
    });
    /*
     * The other tool, with this item in it.
     *
     * Somebody who has just been told to put four enchantments on a weapon
     * wants to know what that costs before they believe it, and that answer
     * is one page away - so the item and everything on it go there rather
     * than being typed in again.
     */
    el('tcBody').addEventListener('click', event => {
      const take = event.target.closest('[data-take]');
      if (!take) return;
      const worn = build.gear[take.dataset.take];
      if (!worn || !worn.name || typeof window.enchantThis !== 'function') return;
      const held = rulesFor();
      const wanted = [];
      for (const id of worn.ench || []) {
        const one = id && data.byEnch[id];
        if (!one) continue;
        // The calculator knows them by its own spelling; this is the same
        // translation the search uses when it reads what is already on an item.
        const bare = plainly(one.name);
        let name = null;
        for (const key of [one.name, one.name.replace(NUMERAL, '').trim()]) {
          if (held && held.byName && held.byName.get(key)) { name = key; break; }
        }
        if (!name && held) {
          for (const [other] of held.byName) {
            if (plainly(other) === bare) { name = other; break; }
          }
        }
        if (name) wanted.push(name);
      }
      window.enchantThis({ item: worn.name, slots: wanted });
    });

    el('tcBody').addEventListener('click', event => {
      const back = event.target.closest('[data-unban]');
      if (!back) return;
      delete (build.banned || {})[back.dataset.unban];
      keep(); paint();
    });

    el('tcGoals').addEventListener('click', event => {
      const pick = event.target.closest('[data-goal]');
      if (!pick) return;
      /*
       * They add up rather than replacing one another. Nobody builds for one
       * number: it is damage without dying, or a fast kill that still leaves
       * you standing, and the search can be told both. The last one cannot be
       * turned off, because a search with nothing to aim at has nothing to do.
       */
      const want = goalsOf(build).map(one => one.id);
      const at = want.indexOf(pick.dataset.goal);
      if (at < 0) want.push(pick.dataset.goal);
      else if (want.length > 1) want.splice(at, 1);
      build.goals = want;
      delete build.goal;
      /*
       * The split is re-struck whenever the list of things asked for changes:
       * the hundred per cent is shared out evenly again, because a share left
       * over from a goal that is no longer on the list means nothing.
       */
      levelShares(build);
      keep(); paint();
    });


    el('tcMix').addEventListener('click', event => {
      const pin = event.target.closest('[data-pin]');
      if (!pin) return;
      build.pinned = build.pinned || {};
      if (build.pinned[pin.dataset.pin]) delete build.pinned[pin.dataset.pin];
      else build.pinned[pin.dataset.pin] = true;
      keep(); drawMix();
    });

    el('tcMix').addEventListener('input', event => {
      const bar = event.target.closest('[data-mix]');
      if (!bar) return;
      moveShare(build, bar.dataset.mix, Number(bar.value));
      keep();
      /*
       * The others move; the one under the mouse is left alone.
       *
       * Redrawing the whole row on every input replaced the very slider being
       * dragged, so the browser lost the pointer the moment it moved one per
       * cent and the drag had to be started again for every step.
       */
      tuneMix(bar);
    });

    el('tcBosses').addEventListener('click', event => {
      const pick = event.target.closest('[data-boss]');
      if (!pick) return;
      build.boss = pick.dataset.boss;
      // The aim follows the target, unless it has been moved by hand since.
      const boss = data.byBoss[build.boss];
      if (boss) build.against = Math.min(100, boss.def);
      keep(); paint();
    });
    el('tcPause').addEventListener('click', () => {
      duel.on = !duel.on;
      el('tcPause').textContent = duel.on ? 'pause' : 'play';
    });
    el('tcAgain').addEventListener('click', resetDuel);
    const link = el('tcShare');
    if (link) {
      link.addEventListener('click', () => {
        const token = share();
        if (!token) return;
        const at = location.href.split('#')[0] + '#theory?build=' + token;
        const said = word => { link.textContent = word;
          setTimeout(() => { link.textContent = 'copy a link'; }, 2200); };
        /*
         * Written into the address whether or not the clipboard co-operates,
         * so the link is always there to be copied by hand.
         */
        location.hash = 'theory?build=' + token;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(at).then(() => said('copied'), () => said('in the address bar'));
        } else said('in the address bar');
      });
    }

    el('tcName').addEventListener('input', event => {
      build.name = event.target.value; keep(); drawTabs();
    });

    el('tcGear').addEventListener('click', event => {
      const item = event.target.closest('[data-item]');
      if (item) { openItems(item.dataset.item); return; }
      const ench = event.target.closest('[data-ench]');
      if (ench) {
        const [hand, at] = ench.dataset.ench.split(':');
        openEnchants(hand, Number(at));
        return;
      }
      const drop = event.target.closest('[data-drop]');
      if (drop) {
        const [hand, at] = drop.dataset.drop.split(':');
        build.gear[hand].ench[Number(at)] = null;
        delete build.locked[drop.dataset.drop];
        keep(); paint();
        return;
      }
      const hold = event.target.closest('[data-hold]');
      if (hold) {
        const which = hold.dataset.hold;
        const on = !build.locked[which];
        build.locked[which] = on;
        /*
         * An enchantment cannot be kept on an item that is free to change.
         *
         * Keeping a slot and leaving the item open meant the search could
         * swap the item out from under it, and the enchantment kept was one
         * that may not even fit what took its place - so keeping a slot keeps
         * the thing it is in, and letting the item go lets go of everything
         * in it.
         */
        const at = which.indexOf(':');
        if (at > 0 && on) build.locked[which.slice(0, at)] = true;
        if (at < 0 && !on) {
          for (const key of Object.keys(build.locked)) {
            if (key.indexOf(which + ':') === 0) delete build.locked[key];
          }
        }
        keep(); drawSlots();
      }
    });
    el('tcGear').addEventListener('change', event => {
      const slots = event.target.closest('[data-slots]');
      if (!slots) return;
      const worn = build.gear[slots.dataset.slots];
      worn.slots = Number(slots.value) || 0;
      keep(); paint();
    });

    el('tcPicker').addEventListener('click', event => {
      const ban = event.target.closest('[data-ban]');
      if (ban) {
        event.stopPropagation();
        build.banned = build.banned || {};
        build.banned[ban.dataset.ban] = true;
        keep();
        // The row goes with it: the list is what you can still choose from.
        const gone = ban.closest('.tc-row-pair');
        if (gone) gone.remove();
        drawSearch();
        return;
      }
      const row = event.target.closest('[data-choose]');
      if (row) chose(row.dataset.choose);
    });
    el('tcSearch').addEventListener('input', event => {
      const rows = JSON.parse(el('tcPicker').dataset.rows || '[]');
      const want = event.target.value.trim().toLowerCase();
      paintPicker(want
        ? rows.filter(one => (one.name + ' ' + (one.says || '')).toLowerCase().includes(want))
        : rows);
    });
    el('tcPickerShut').addEventListener('click', shutPicker);
    el('tcPickerWrap').addEventListener('click', event => {
      if (event.target === el('tcPickerWrap')) shutPicker();
    });

    el('tcTabs').addEventListener('click', event => {
      const shut = event.target.closest('[data-shut]');
      if (shut) {
        const i = Number(shut.dataset.shut);
        tabs.splice(i, 1);
        if (!tabs.length) tabs = [fresh(data.classes[0].name)];
        onTab = Math.min(onTab, tabs.length - 1);
        build = tabs[onTab];
        keep(); paint();
        return;
      }
      const tab = event.target.closest('[data-tab]');
      if (!tab) return;
      if (tab.dataset.tab === 'new') {
        tabs.push(fresh(build.klass));
        onTab = tabs.length - 1;
      } else {
        onTab = Number(tab.dataset.tab);
      }
      build = tabs[onTab];
      keep(); paint();
    });

    el('tcUndo').addEventListener('click', () => {
      if (!before) return;
      tabs[onTab] = build = before;
      before = null;
      keep(); paint();
      el('tcSaid').textContent = 'put back the way it was';
    });

    el('tcRun').addEventListener('click', () => {
      const wanted = goalsOf(build);
      const said = el('tcSaid');
      before = JSON.parse(JSON.stringify(build));
      el('tcRun').disabled = true;
      said.textContent = 'trying things...';
      // Off the paint, so the button has time to say it is working.
      setTimeout(() => {
        /*
         * Two searches, and the better of them. One from the plainest gear
         * there is, which is the same starting point every time and so gives
         * the same answer every time; one from what is on the page, which can
         * only help. Both are scored on the same scale - read off the plain
         * build, not off whatever the last search left behind - so pressing
         * the button twice cannot wander.
         */
        const plain = bareOf(build);
        const aim = aimOf(plain, wanted);
        const was = wanted.map(one => scoreOf(build, one));
        const fromPlain = optimise(plain, aim, null);
        const fromHere = optimise(build, aim, null);
        const got = fromPlain.score >= fromHere.score ? fromPlain : fromHere;
        got.looked = fromPlain.looked + fromHere.looked;
        got.state.name = build.name;
        tabs[onTab] = build = got.state;
        keep(); paint();
        el('tcRun').disabled = false;
        /*
         * Where each thing asked for started and where it got to. Measured as
         * how far it moved rather than as a ratio: killing a boss scores as
         * negative seconds, so a ratio flipped its sign and reported going
         * from two thousand seconds to eleven as ninety-nine per cent worse.
         *
         * Every goal is reported, including the ones that went down. Asking
         * for damage and survival at once means trading one against the
         * other, and a report that showed only the winner would hide the
         * price.
         */
        said.innerHTML = wanted.map((one, i) => {
          const now = scoreOf(build, one);
          const moved = was[i] && isFinite(was[i]) && was[i] !== 0
            ? Math.round(((now - was[i]) / Math.abs(was[i])) * 100) : null;
          return '<span class="figure"><b style="color:' + esc(one.tint) + '">'
            + esc(sayGoal(one, was[i])) + ' <i class="tc-arrow">→</i> '
            + esc(sayGoal(one, now)) + '</b><small>' + esc(one.say.toLowerCase())
            + (moved ? ' · ' + (moved > 0 ? '+' : '') + moved + '%' : '')
            + '</small></span>';
        }).join('')
          + '<span class="figure"><b>' + got.looked.toLocaleString('en-US')
          + '</b><small>builds tried</small></span>';
      }, 20);
    });


  }

  /* ---------------- opening ---------------- */

  /*
   * Two flags, and the same reason as the index has two. `started` is set
   * after the data is read so a failed load can be asked for again - but that
   * is after an `await`, and a flag set after an await guards nothing during
   * it. The router calls this twice on every arrival, because opening a page
   * from a card sets `location.hash` and then routes, and setting the hash
   * fires `hashchange`, which routes again. Both calls went past the guard and
   * wired every listener twice. `starting` covers the window `started` cannot.
   */
  let started = false;
  let starting = false;
  /*
   * And the page's own markup, kept before anything is written over it.
   *
   * Saying "the data is not here yet" replaces the whole of the body - which
   * is also every element the working page is built out of. Say it once and
   * the pickers, the lists and the boxes this fills in are gone; a later
   * attempt that succeeds then goes looking for them and throws on the first
   * one, leaving the page stuck on a message about a file that is present.
   *
   * A load can fail for a moment and be worth trying again - a server that
   * blinked, a connection that dropped - so the message has to be undoable.
   * The markup is put back before anything is filled in.
   */
  let shell = null;
  async function start() {
    if (started || starting) return;
    starting = true;
    const bundled = window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.sources
      && window.ROTMG_BUNDLE.sources.theoryText;
    let raw = bundled;
    if (!raw) {
      for (const url of ['assets/theory/theorycraft.json', '../data/TheoryCraft/theorycraft.json']) {
        raw = await fetch(url).then(r => r.ok ? r.text() : '').catch(() => '');
        if (raw) break;
      }
    }
    if (!raw) {
      starting = false;                // it may be worth asking again
      const box = el('tcBody');
      if (box) {
        if (shell === null) shell = box.innerHTML;
        box.innerHTML = '<p class="tc-missing">The build data is not here yet. '
          + 'Run <code>node tools/build-theorycraft.js</code>.</p>';
      }
      return;
    }
    data = JSON.parse(raw);
    data.byClass = {}; data.byItem = {}; data.byEnch = {}; data.byBoss = {};
    for (const one of data.classes) data.byClass[one.name] = one;
    for (const one of data.items) data.byItem[one.name] = one;
    for (const one of data.enchants) data.byEnch[one.id] = one;
    for (const one of data.bosses) data.byBoss[one.name] = one;
    if (!rulesFor()) {
      const box = el('tcBody');
      if (box) box.textContent = 'The enchanting data could not be loaded. Reload this page before planning a build.';
      return;
    }
    started = true;
    starting = false;                  // `started` has it from here
    {
      const box = el('tcBody');
      if (shell !== null && box) { box.innerHTML = shell; shell = null; }
    }

    // The sheet's address, once, for every icon on the page to point at.
    {
      const bundle = window.ROTMG_BUNDLE;
      el('tcBody').style.setProperty('--tc-sheet', 'url('
        + ((bundle && bundle.theorySheet) || 'assets/theory/sheet.png') + ')');
      const wrap = el('tcPickerWrap');
      if (wrap) wrap.style.setProperty('--tc-sheet', el('tcBody').style.getPropertyValue('--tc-sheet'));
      /*
       * And the index's sheet, which the item pictures come from. The
       * calculator writes the same address onto the document when it loads;
       * this repeats it so the bench draws its items whether or not the other
       * page ever opened.
       */
      document.documentElement.style.setProperty('--sheet', 'url('
        + ((bundle && bundle.indexSheet) || 'assets/index/sheet.png') + ')');
    }
    fillPickers();
    if (!recall()) tabs = [fresh('Wizard')];
    build = tabs[onTab] || (tabs[0] = fresh('Wizard'));
    // A build kept from an older visit may name a class or item since renamed.
    if (!data.byClass[build.klass]) build = tabs[onTab] = fresh(data.classes[0].name);
    /*
     * A build kept from before knows the old exaltation numbers, which were
     * wrong for life and magic. They are not a choice anybody made, so they
     * are simply brought up to date rather than left to puzzle over.
     */
    for (const one of tabs) {
      one.level = 20;
      one.exalts = one.exalts || {};
      for (const [key] of STATS) one.exalts[key] = exaltOf(key);
    }
    wire();
    /*
     * And a build carried in by the address wins over what was left here
     * last time - somebody following a link came to see that build, not the
     * one they were working on. It arrives as a new tab so it cannot take
     * anybody's work away from them.
     */
    const shared = buildFromAddress();
    if (shared) {
      tabs.push(shared);
      onTab = tabs.length - 1;
      build = shared;
      keep();
    }
    paint();
    keepPainting();
  }

  /*
   * The other tools ask for this by name: a build handed over as a token they
   * can put in an address, and one taken back the same way.
   */
  function share() { return data && build ? packBuild(build) : ''; }
  function open(token) {
    if (!data) return false;
    const got = unpackBuild(token);
    if (!got) return false;
    tabs.push(got);
    onTab = tabs.length - 1;
    build = got;
    keep(); paint();
    return true;
  }

  /*
   * Something handed over from the index.
   *
   * An item goes into the slot the client gives it, a class becomes the
   * class, an enemy becomes the thing being fought - and each of those is
   * checked against this page's own catalogue rather than trusted, since the
   * index holds things this page deliberately does not offer.
   */
  function put(said) {
    if (!data || !build || !said) return false;
    let moved = false;
    if (said.klass && data.byClass[said.klass] && said.klass !== build.klass) {
      const start = fresh(said.klass);
      start.name = start.klass + ' build';
      tabs.push(start);
      onTab = tabs.length - 1;
      build = start;
      moved = true;
    }
    if (said.item && data.byItem[said.item]) {
      const item = data.byItem[said.item];
      const hand = item.hand;
      if (hand && build.gear[hand]) {
        build.gear[hand] = { name: item.name, slots: 4, ench: [null, null, null, null] };
        moved = true;
      }
    }
    if (said.target && data.byBoss[said.target]) { build.boss = said.target; moved = true; }
    if (moved) { keep(); paint(); }
    return moved;
  }

  return { start, share, open, put };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TheoryCraft;
