/*
 * Theory crafting: what a character would actually be, and what it would do.
 *
 * The whole page is arithmetic on numbers the game chose. A class states its
 * eight statistics - the value it starts on, the value it may never pass, and
 * what one level is worth of each - so a level twenty is not a guess. Every
 * weapon, ability, armour and ring states what it gives you for being worn
 * and the projectile it throws. Every one of the thousand enchantments states
 * its effect as a mutator rather than as prose. All of that is read out of the
 * installed client by tools/build-theorycraft.js and used here untouched.
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
    const from = { gear: {}, ench: {}, set: {}, exalt: {} };

    /*
     * Sets first, because they are decided by what is worn rather than by
     * any one piece. The client gives a set its pieces and a bonus at two,
     * three and four of them, and the thresholds stack the way the game
     * stacks them: wearing four gets you the two-piece bonus as well.
     */
    {
      const worn = new Set(HANDS.map(h => (state.gear[h[0]] || {}).name).filter(Boolean));
      for (const kit of data.sets || []) {
        let howMany = 0;
        for (const piece of kit.pieces) if (worn.has(piece)) howMany++;
        if (howMany < 2) continue;
        for (const step of Object.keys(kit.steps)) {
          if (Number(step) > howMany) continue;
          for (const tag of Object.keys(kit.steps[step])) {
            const key = OF_STAT[tag] || OF_STAT[tag.replace(/^MAX/, '')];
            if (key) from.set[key] = (from.set[key] || 0) + kit.steps[step][tag];
          }
        }
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
      out[key] = Math.round(out[key] * 10) / 10;
    }
    return { now: out, base, top, from };
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
  function weaponRate(item, stats, def) {
    if (!item || !item.shots || !item.shots.length) return { each: 0, rate: 0, dps: 0 };
    const shot = item.shots[0];
    const roll = (shot.low + (shot.high === undefined ? shot.low : shot.high)) / 2;
    const each = landed(roll, stats.att, def, shot.pierce);
    const rate = SHOTS_AT(stats.dex) * (item.rate === undefined ? 1 : item.rate);
    const many = item.many || 1;
    return { each, rate, many, dps: each * many * rate, reach: shot.reach };
  }

  /*
   * And an ability, which is bounded by magic rather than by dexterity: you
   * may use it as often as the magic comes back, and no oftener.
   */
  function abilityRate(item, stats, def) {
    if (!item || !item.shots || !item.shots.length || !item.mp) {
      return { each: 0, every: 0, dps: 0 };
    }
    const shot = item.shots[0];
    const roll = (shot.low + (shot.high === undefined ? shot.low : shot.high)) / 2;
    const each = landed(roll, stats.att, def, shot.pierce);
    const many = item.many || 1;
    const every = item.mp / MANA_AT(stats.wis);
    return { each, many, every, dps: each * many / every, reach: shot.reach };
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
    const using = state.using || 'both';
    const weapon = data.byItem[(state.gear.weapon || {}).name];
    const ability = data.byItem[(state.gear.ability || {}).name];
    const gun = using === 'spell' ? NONE : weaponRate(weapon, stats.now, def);
    const spell = using === 'gun' ? NONE : abilityRate(ability, stats.now, def);
    return { stats, gun, spell, total: gun.dps + spell.dps };
  }

  /* ---------------- the state of a build ---------------- */

  function fresh(klass) {
    const kind = data.byClass[klass] || data.classes[0];
    const gear = {};
    HANDS.forEach(([hand], i) => {
      const name = kind.kit[i];
      gear[hand] = { name: name || null, slots: 4, ench: [null, null, null, null] };
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
      goal: 'dps',
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
  const worth = one => Object.values(one.worn || {})
    .reduce((n, v) => n + Math.abs(v), 0);

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

  function enchantsFor(itemName, already, at) {
    const item = data.byItem[itemName];
    if (!item) return [];
    const held = rulesFor();
    if (held) {
      const locks = [];
      (already || []).forEach((id, i) => {
        if (i === at || !id) return;
        const one = data.byEnch[id];
        if (one) locks.push(one.name);
      });
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
        if (seen.has(mod.name)) continue;
        seen.add(mod.name);
        const mine = charmNamed(mod.name);
        out.push(mine || { id: 'n:' + mod.name, name: mod.name });
      }
      return out;
    }

    /*
     * And if the calculator is not on the page - somebody opened this file on
     * its own - the client's own labels are the fallback: an enchantment says
     * which labels an item must and must not carry, and which enchantments it
     * will not sit beside.
     */
    const has = labelsOf(item.labels);
    const beside = new Set();
    (already || []).forEach((id, i) => {
      if (i === at || !id) return;
      const one = data.byEnch[id];
      if (one) for (const label of labelsOf(one.labels)) beside.add(label);
    });
    return data.enchants.filter(one => {
      const wants = labelsOf(one.fits);
      if (wants.size) {
        let met = false;
        for (const label of wants) if (has.has(label)) { met = true; break; }
        if (!met) return false;
      }
      for (const label of labelsOf(one.notFits)) if (has.has(label)) return false;
      for (const label of labelsOf(one.notOn)) if (label === itemName) return false;
      for (const label of labelsOf(one.notWith)) if (beside.has(label)) return false;
      return true;
    });
  }

  function itemsFor(hand, klass) {
    const kind = data.byClass[klass];
    const slot = kind && kind.slots[HANDS.findIndex(h => h[0] === hand)];
    return data.items.filter(one => one.hand === hand
      && (slot === undefined || one.slot === slot));
  }

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
const TINT = {
  hp: '#d9534f', mp: '#5b8cd9', att: '#e08a3c', def: '#93a3b5',
  spd: '#d9c23c', dex: '#7fc45a', vit: '#d95fa0', wis: '#9b7fd9'
};

  const GOALS = [
    { group: 'Others', id: 'dps', say: 'Damage a second', tint: '#e08a3c',
      of: n => n.total },
    { group: 'Others', id: 'kill', say: 'Kill it fast', tint: '#f0c274', of: (n, s) => {
      const boss = data.byBoss[s.boss];
      if (!boss || !n.total) return 0;
      return -boss.hp / n.total;
    } },
    { group: 'Others', id: 'shot', say: 'Damage a shot', tint: '#e08a3c',
      of: n => n.gun.each * (n.gun.many || 1) },
    { group: 'Others', id: 'gun', say: 'Weapon only', tint: '#d9534f',
      of: n => n.gun.dps },
    { group: 'Others', id: 'spell', say: 'Ability only', tint: '#5b8cd9',
      of: n => n.spell.dps },
    /*
     * Through armour: what the build still lands on the hardest thing it will
     * ever meet. A weapon that throws many small shots loses most of itself to
     * armour and a heavy one barely notices, so this and plain damage pull in
     * different directions - which is the whole reason the curve is drawn.
     */
    { group: 'Others', id: 'pierce', say: 'Through armour', tint: '#93a3b5', of: (n, s) => {
      const was = s.against;
      s.against = 80;
      const hard = numbersFor(s, 80);
      s.against = was;
      return hard ? hard.total : 0;
    } },
    /*
     * Staying alive, as the game measures it: how much damage you can soak
     * before you die, which is your life multiplied by what armour saves you
     * on an ordinary hit, plus what you heal back while it happens.
     */
    { group: 'Others', id: 'live', say: 'Survival', tint: '#7fc45a', of: n => {
      const s = n.stats.now;
      const soak = 100 / Math.max(15, 100 - s.def);
      return s.hp * soak + HEAL_AT(s.vit) * 20;
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
  function optimise(state, goal, report) {
    const work = JSON.parse(JSON.stringify(state));
    let score = scoreOf(work, goal);
    let looked = 0;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const [hand] of HANDS) {
        if (work.locked[hand]) continue;
        const was = work.gear[hand].name;
        let best = was;
        for (const one of itemsFor(hand, work.klass)) {
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
      for (const [hand] of HANDS) {
        const worn = work.gear[hand];
        if (!worn.name) continue;
        for (let at = 0; at < worn.slots; at++) {
          if (work.locked[hand + ':' + at]) continue;
          const was = worn.ench[at];
          let best = was;
          for (const one of enchantsFor(worn.name, worn.ench, at)) {
            // Only the ones this page can actually count are worth trying.
            if (!one.worn) continue;
            worn.ench[at] = one.id;
            const now = scoreOf(work, goal);
            looked++;
            if (now > score) { score = now; best = one.id; }
          }
          worn.ench[at] = best;
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

  function artFor(name) {
    const bundle = window.ROTMG_BUNDLE;
    if (bundle && bundle.itemSprites && bundle.itemSprites[name]) {
      return bundle.itemSprites[name];
    }
    if (window.ITEM_SPRITE_PATH) return window.ITEM_SPRITE_PATH(name);
    return '';
  }

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

  function itemIcon(name) {
    const src = artFor(name);
    const grade = gradeOf(name);
    return src
      ? '<img class="tc-icon-big ' + grade + '" src="' + esc(src) + '" alt="" loading="lazy">'
      : '<span class="tc-icon-big"></span>';
  }

  function drawSlots() {
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
      }

      /* And its enchantments, as chips rather than as a faint list. */
      const chips = [];
      for (let at = 0; at < worn.slots; at++) {
        const id = worn.ench[at];
        const one = id && data.byEnch[id];
        const held = !!build.locked[hand + ':' + at];
        const said = one && one.worn
          ? '<u>' + Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' ') + '</u>'
          : (one && one.alters ? '<u class="tc-uncounted">changes the shot</u>' : '');
        chips.push('<span class="tc-ench' + (held ? ' is-held' : '')
          + (one ? '' : ' is-empty') + '">'
          + (one ? sheetIcon(one.pic, 18) : '')
          + '<button type="button" class="tc-ench-pick" data-ench="' + hand + ':' + at + '">'
          + (one ? esc(one.name) : '<em>empty</em>') + '</button>'
          + said
          + '<button type="button" class="tc-hold" data-hold="' + hand + ':' + at
          + '" title="keep this one while the calculator works">'
          + (held ? 'kept' : 'keep') + '</button>'
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
        + (bits.length ? '<span class="tc-bits">' + esc(bits.join(' · ')) + '</span>' : '')
        + '</span></button>'
        + '<button type="button" class="tc-hold" data-hold="' + hand
        + '" title="keep this item while the calculator works">'
        + (locked ? 'kept' : 'keep') + '</button>'
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
      const part = Math.max(0, Math.min(1, now / top));
      // Past its ceiling is worth seeing: it can only have come off the gear.
      const over = now > top;
      /*
       * The number, and nothing about how it got there. Where every point
       * came from is arithmetic somebody would have to want; the bar against
       * the ceiling is the thing being read.
       */
      return '<div class="tc-stat is-' + key + (over ? ' is-over' : '')
        + (part >= 1 ? ' is-full' : '') + '" style="--tint:' + TINT[key] + '">'
        + '<i>' + say + '</i>'
        + '<span class="tc-bar"><span style="width:' + (part * 100).toFixed(1) + '%"></span></span>'
        + '<b>' + round(now) + '<u>/' + top + '</u></b>'
        + '</div>';
    }).join('');
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
  function drawSearch() {
    const goal = GOALS.find(one => one.id === build.goal) || GOALS[0];
    const now = scoreOf(build, goal);
    const said = el('tcNow');
    if (said) {
      said.innerHTML = Number.isFinite(now)
        ? '<span class="figure"><b>' + esc(sayGoal(goal, now)) + '</b><small>'
          + esc(goal.say.toLowerCase()) + ' now</small></span>'
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
    const rows = [
      ['damage a second', commas(numbers.total), true],
      ['shots a second', round(numbers.gun.rate)],
      ['each shot', commas(numbers.gun.each)
        + (numbers.gun.many > 1 ? ' x ' + numbers.gun.many : '')]
    ];
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
    on: true, at: 0, dealt: 0, shots: [], cool: 0, spell: 0, swing: 0,
    hp: 0, full: 0, over: 0, last: 0, art: new Map(), bits: [],
    mp: 0, mpFull: 0
  };

  function artOfClass(kind) {
    if (!kind || !kind.art) return null;
    let img = duel.art.get(kind.art.file);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      const bundle = window.ROTMG_BUNDLE;
      // Served, the atlas sits beside the page; bundled, it is a folder the
      // single file cannot carry, so the frame falls back to a plain figure.
      img.src = (bundle && bundle.atlasBase ? bundle.atlasBase : 'assets/atlas/')
        + 'life/' + kind.art.file;
      duel.art.set(kind.art.file, img);
    }
    return img;
  }

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
    duel.cool = 0; duel.spell = 0; duel.swing = 0; duel.over = 0;
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
    const gun = weaponRate(weapon, stats, boss.def);
    const spell = abilityRate(ability, stats, boss.def);

    stepBits(delta);
    if (duel.hp <= 0) return;                 // it is over; nothing else moves
    duel.at += delta;
    if (duel.swing > 0) duel.swing -= delta;

    if (gun.rate > 0) {
      duel.cool -= delta;
      if (duel.cool <= 0) {
        duel.cool += 1 / gun.rate;
        duel.swing = Math.min(0.22, 1 / gun.rate * 0.7);
        for (let n = 0; n < (gun.many || 1); n++) {
          duel.shots.push({
            at: 0, lane: (n - ((gun.many || 1) - 1) / 2) * 0.16,
            hurt: gun.each, mine: true
          });
        }
      }
    }
    /*
     * The magic comes back at the rate wisdom says it does, and a cast is
     * paid for out of what is there. So the first seconds of a fight are the
     * fast ones and the rest is whatever the pool can afford - which is the
     * thing a sustained figure cannot show you.
     */
    const cost = (build.using !== 'gun' && ability && ability.mp) || 0;
    duel.mp = Math.min(duel.mpFull, duel.mp + MANA_AT(stats.wis) * delta);
    if (spell.dps > 0 && cost) {
      duel.spell -= delta;
      if (duel.spell <= 0 && duel.mp >= cost) {
        duel.mp -= cost;
        duel.spell = 0.6;                     // as fast as a hand can cast
        for (let n = 0; n < (spell.many || 1); n++) {
          duel.shots.push({
            at: 0, lane: (n - ((spell.many || 1) - 1) / 2) * 0.16,
            hurt: spell.each, mine: false
          });
        }
      }
    }

    for (let i = duel.shots.length - 1; i >= 0; i--) {
      const one = duel.shots[i];
      // A shot crosses the frame in a fifth of a second, whatever its range.
      one.at += delta * 5;
      if (one.at < 1) continue;
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

    /* The one on the left, in whichever pose it is in. */
    const mine = artOfClass(kind);
    const side = Math.min(58, tall * 0.44);
    if (mine && mine.complete && mine.naturalWidth) {
      const art = kind.art;
      const poses = art.poses || {};
      const list = duel.swing > 0
        ? (poses['0/2'] || poses['0/0'] || [0])
        : (poses['0/0'] || [0]);
      const frame = list[Math.floor(duel.at * 4) % list.length];
      const cell = art.tile, high = art.height;
      pen.drawImage(mine, frame * cell, 0, cell, high,
        22, floor - side * (high / cell), side, side * (high / cell));
    } else {
      pen.fillStyle = '#6f8fbf';
      pen.fillRect(26, floor - side, side * 0.6, side);
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
    const piece = pieceOf(boss && boss.pic);
    const room = Math.min(88, tall * 0.64);
    const longest = piece ? Math.max(piece.w, piece.h) : 1;
    const big = piece ? room * (piece.h / longest) : room;
    const across = piece ? room * (piece.w / longest) : room;
    const bossX = wide - 22 - room / 2 - across / 2;
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
    const struck = duel.hp > 0 && duel.shots.some(s => s.at > 0.86);
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
     * And what is in the air between them: the bolt the weapon actually
     * throws rather than a line standing in for one, and the ability's own
     * projectile where it has one - a Fire Spray bolt is not an Energy Staff
     * missile and should not look like it.
     */
    const weapon = data.byItem[(build.gear.weapon || {}).name];
    const ability = data.byItem[(build.gear.ability || {}).name];
    const boltMine = pieceOf(weapon && weapon.pic);
    const boltSpell = pieceOf(ability && ability.pic);
    const from = 22 + side * 0.8, to = bossX + big * 0.4;
    for (const one of duel.shots) {
      const x = from + (to - from) * Math.min(1, one.at);
      const y = floor - side * 0.55 + one.lane * side;
      const bolt = one.mine ? boltMine : boltSpell;
      if (bolt) {
        // Its own proportions and its own run of frames, spinning as it goes.
        const high = 16 * Math.min(1.5, Math.max(0.7, bolt.size / 100));
        const frame = bolt.frames > 1 ? Math.floor(one.at * 14) % bolt.frames : 0;
        if (drawPiece(pen, bolt, frame, x - high * 0.5, y + high * 0.5, high)) continue;
      }
      pen.strokeStyle = one.mine ? 'rgba(255,238,190,.95)' : 'rgba(140,190,240,.95)';
      pen.lineWidth = 2;
      pen.beginPath();
      pen.moveTo(x - 9, y);
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
      return { id: one.name, name: one.name, says: bits.join(' · '), art: true };
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
      const locks = [];
      worn.ench.forEach((id, i) => {
        if (i === at || !id) return;
        const one = data.byEnch[id];
        if (one) locks.push(one.name);
      });
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
      out.push('<button type="button" class="tc-row" data-choose="' + esc(one.id) + '">'
        + (one.art ? itemIcon(one.id)
          : (one.pic ? sheetIcon(one.pic, 26, 'tc-charm-row') : '<span class="tc-icon-big"></span>'))
        + '<b>' + esc(one.name) + '</b>'
        + '<u>' + esc(one.says || '') + '</u>'
        + (one.counted === false ? '<em class="tc-uncounted">not counted</em>' : '')
        + '</button>');
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
      const art = kind && kind.art;
      if (art) {
        const bundle = window.ROTMG_BUNDLE;
        const base = (bundle && bundle.atlasBase) || 'assets/atlas/';
        const zoom = 40 / art.height;
        const stand = (art.poses && (art.poses['3/0'] || art.poses['0/0']) || [0])[0];
        face.style.backgroundImage = 'url(' + base + 'life/' + art.file + ')';
        face.style.backgroundSize = (art.tile * art.frames * zoom) + 'px '
          + (art.height * zoom) + 'px';
        face.style.backgroundPosition = (-stand * art.tile * zoom) + 'px 0';
        face.hidden = false;
      } else { face.hidden = true; }
    }
    for (const node of el('tcBody').querySelectorAll('[data-set]')) {
      const which = node.dataset.set;
      node.classList.toggle('is-on', !!build[which]);
    }
    for (const node of el('tcBody').querySelectorAll('[data-using]')) {
      node.classList.toggle('is-on', node.dataset.using === (build.using || 'both'));
    }
    for (const node of el('tcGoals').querySelectorAll('[data-goal]')) {
      node.classList.toggle('is-on', node.dataset.goal === build.goal);
    }
    if (build.against === null || build.against === undefined) {
      const boss = data.byBoss[build.boss];
      build.against = boss ? Math.min(100, boss.def) : 0;
    }
    el('tcAgainst').value = build.against;
    el('tcAgainstSay').textContent = build.against + ' armour';
    for (const node of el('tcBosses').querySelectorAll('[data-boss]')) {
      node.classList.toggle('is-on', node.dataset.boss === build.boss);
    }
    const chosenBoss = data.byBoss[build.boss];
    el('tcBossSay').textContent = chosenBoss
      ? chosenBoss.name + ' · ' + commas(chosenBoss.hp) + ' life, '
        + chosenBoss.def + ' armour' : '';
    el('tcName').value = build.name;
    drawTabs();
    drawSearch();
    drawSlots();
    drawStats();
    drawNumbers();
    drawGraph();
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
      + GOALS.filter(one => one.group === name).map(one =>
        '<button type="button" class="tc-goal" data-goal="' + one.id + '"'
        + (one.tint ? ' style="--tint:' + one.tint + '"' : '') + '>'
        + '<i class="tc-dot"></i>' + esc(one.say) + '</button>').join('')
      + '</div>').join('');
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
    el('tcGoals').addEventListener('click', event => {
      const pick = event.target.closest('[data-goal]');
      if (!pick) return;
      build.goal = pick.dataset.goal;
      keep(); paint();
    });
    el('tcAgainst').addEventListener('input', event => {
      build.against = Number(event.target.value) || 0;
      el('tcAgainstSay').textContent = build.against + ' armour';
      drawNumbers(); drawGraph(); keep();
    });
    el('tcBody').addEventListener('click', event => {
      const hand = event.target.closest('[data-using]');
      if (!hand) return;
      build.using = hand.dataset.using;
      keep(); paint();
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
        build.locked[which] = !build.locked[which];
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
      const goal = GOALS.find(one => one.id === build.goal) || GOALS[0];
      const said = el('tcSaid');
      before = JSON.parse(JSON.stringify(build));
      el('tcRun').disabled = true;
      said.textContent = 'trying things...';
      // Off the paint, so the button has time to say it is working.
      setTimeout(() => {
        const was = scoreOf(build, goal);
        const got = optimise(build, goal, null);
        got.state.name = build.name;
        tabs[onTab] = build = got.state;
        keep(); paint();
        el('tcRun').disabled = false;
        const better = was && isFinite(was) && was !== 0
          ? Math.round((got.score / was - 1) * 100) : null;
        /*
         * Where it started, where it got to, and how hard it looked - as
         * figures rather than a sentence. A percentage on its own hides which
         * way it went, and the two numbers are the whole point.
         */
        said.innerHTML = '<span class="figure"><b>' + esc(sayGoal(goal, was))
          + '</b><small>before</small></span>'
          + '<span class="tc-arrow">→</span>'
          + '<span class="figure is-loud"><b>' + esc(sayGoal(goal, got.score))
          + '</b><small>after</small></span>'
          + (better !== null && better !== 0
            ? '<span class="figure"><b>' + (better > 0 ? '+' : '') + better
              + '%</b><small>' + (better > 0 ? 'better' : 'worse') + '</small></span>'
            : '<span>nothing it could swap improved it</span>')
          + '<span class="figure"><b>' + got.looked.toLocaleString('en-US')
          + '</b><small>builds tried</small></span>';
      }, 20);
    });

    addEventListener('resize', () => { if (data && build) drawGraph(); });
  }

  /* ---------------- opening ---------------- */

  let started = false;
  async function start() {
    if (started) return;
    const bundled = window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.sources
      && window.ROTMG_BUNDLE.sources.theoryText;
    let raw = bundled;
    if (!raw) {
      raw = await fetch('../data/TheoryCraft/theorycraft.json')
        .then(r => r.text()).catch(() => '');
    }
    if (!raw) {
      const box = el('tcBody');
      if (box) {
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
    started = true;

    // The sheet's address, once, for every icon on the page to point at.
    {
      const bundle = window.ROTMG_BUNDLE;
      el('tcBody').style.setProperty('--tc-sheet', 'url('
        + ((bundle && bundle.theorySheet) || 'assets/theory/sheet.png') + ')');
      const wrap = el('tcPickerWrap');
      if (wrap) wrap.style.setProperty('--tc-sheet', el('tcBody').style.getPropertyValue('--tc-sheet'));
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
    paint();
    keepPainting();
  }

  return { start };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TheoryCraft;
