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
  const EXALT_MOST = 5;

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

  function numbersFor(state, def) {
    const stats = statsOf(state);
    if (!stats) return null;
    const weapon = data.byItem[(state.gear.weapon || {}).name];
    const ability = data.byItem[(state.gear.ability || {}).name];
    const gun = weaponRate(weapon, stats.now, def);
    const spell = abilityRate(ability, stats.now, def);
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
    for (const [key] of STATS) exalts[key] = EXALT_MOST;
    return {
      name: kind.name + ' build',
      klass: kind.name,
      level: 20,
      maxed: true,
      exalt: true,
      exalts,
      gear,
      against: 0,
      /*
       * Something worth timing. The list is sorted by hit points and the top
       * of it is a training dummy with ten million of them, which tells you
       * nothing; the first thing the game actually calls a god does.
       */
      boss: (data.bosses.find(one => one.god && one.hp < 200000)
        || data.bosses[data.bosses.length - 1] || {}).name || null,
      locked: {}
    };
  }

  /* ---------------- which enchantments may go where ---------------- */

  const labelsOf = one => new Set(String(one || '').split(',').map(s => s.trim())
    .filter(Boolean));

  /*
   * The client states this as labels rather than as a list of items: an
   * enchantment says which labels an item must carry, which it must not, and
   * which other enchantments it will not sit beside. So the test is set
   * arithmetic and nothing has to be hand-listed.
   */
  function enchantsFor(itemName, already, at) {
    const item = data.byItem[itemName];
    if (!item) return [];
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
  const GOALS = [
    { id: 'dps', say: 'damage a second, both hands', of: n => n.total },
    { id: 'gun', say: 'damage a second, weapon only', of: n => n.gun.dps },
    { id: 'spell', say: 'damage a second, ability only', of: n => n.spell.dps },
    { id: 'burst', say: 'damage over five seconds', of: n => n.total * 5 },
    { id: 'kill', say: 'how fast the chosen boss dies', of: (n, s) => {
      const boss = data.byBoss[s.boss];
      if (!boss || !n.total) return 0;
      return -boss.hp / n.total;
    } },
    ...STATS.map(([key, say]) => ({ id: 'stat:' + key, say: say + ', as high as it goes',
      of: n => n.stats.now[key] }))
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

  function itemIcon(name) {
    const src = artFor(name);
    return src
      ? '<img class="tc-icon" src="' + esc(src) + '" alt="" loading="lazy">'
      : '<span class="tc-icon"></span>';
  }

  function drawSlots() {
    const box = el('tcGear');
    if (!box) return;
    box.innerHTML = HANDS.map(([hand, say]) => {
      const worn = build.gear[hand];
      const item = data.byItem[worn.name];
      const locked = !!build.locked[hand];
      const bits = [];
      if (item) {
        if (item.tier !== undefined) bits.push('T' + item.tier);
        const gun = item.shots && item.shots[0];
        if (gun) {
          bits.push(gun.low + (gun.high !== gun.low ? '–' + gun.high : '') + ' dmg');
          if (gun.reach) bits.push(gun.reach + ' tiles');
        }
        if (item.many > 1) bits.push(item.many + ' shots');
        if (item.rate !== undefined && item.rate !== 1) {
          bits.push(Math.round(item.rate * 100) + '% rate');
        }
        if (item.mp) bits.push(item.mp + ' MP');
        if (item.worn) {
          for (const tag of Object.keys(item.worn)) {
            bits.push((item.worn[tag] > 0 ? '+' : '') + item.worn[tag] + ' ' + tag);
          }
        }
      }
      const rows = [];
      for (let at = 0; at < worn.slots; at++) {
        const id = worn.ench[at];
        const one = id && data.byEnch[id];
        const held = !!build.locked[hand + ':' + at];
        rows.push('<div class="tc-ench' + (held ? ' is-held' : '') + '">'
          + '<button type="button" class="tc-ench-pick" data-ench="' + hand + ':' + at + '">'
          + (one ? esc(one.name) : '<em>empty slot</em>') + '</button>'
          + (one && one.worn
            ? '<u>' + Object.keys(one.worn).map(t =>
              (one.worn[t] > 0 ? '+' : '') + one.worn[t] + ' ' + t).join(' ') + '</u>'
            : (one && one.alters ? '<u class="tc-uncounted">changes the shot</u>' : ''))
          + '<button type="button" class="tc-hold" data-hold="' + hand + ':' + at
          + '" title="keep this one while the calculator works">'
          + (held ? '◉' : '○') + '</button>'
          + '</div>');
      }
      return '<div class="tc-slot' + (locked ? ' is-held' : '') + '">'
        + '<div class="tc-slot-head">'
        + '<i>' + say + '</i>'
        + '<button type="button" class="tc-item-pick" data-item="' + hand + '">'
        + itemIcon(worn.name) + '<b>' + (worn.name ? esc(worn.name) : 'nothing') + '</b>'
        + '</button>'
        + '<button type="button" class="tc-hold" data-hold="' + hand
        + '" title="keep this item while the calculator works">'
        + (locked ? '◉' : '○') + '</button>'
        + '</div>'
        + (bits.length ? '<p class="tc-bits">' + esc(bits.join(' · ')) + '</p>' : '')
        + '<label class="tc-rarity">enchantment slots'
        + '<select data-slots="' + hand + '">'
        + [0, 1, 2, 3, 4].map(n => '<option value="' + n + '"'
          + (n === worn.slots ? ' selected' : '') + '>' + n + '</option>').join('')
        + '</select></label>'
        + rows.join('')
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
      const part = Math.max(0, Math.min(1, now / Math.max(top, now)));
      const extra = [];
      if (got.from.gear[key]) extra.push('gear ' + plus(got.from.gear[key]));
      if (got.from.ench[key]) extra.push('enchant ' + plus(got.from.ench[key]));
      if (got.from.set[key]) extra.push('set ' + plus(got.from.set[key]));
      if (got.from.exalt[key]) extra.push('exalt ' + plus(got.from.exalt[key]));
      return '<div class="tc-stat">'
        + '<i>' + say + '</i>'
        + '<span class="tc-bar"><span style="width:' + (part * 100).toFixed(1) + '%"></span></span>'
        + '<b>' + round(now) + '</b>'
        + '<u>of ' + top + '</u>'
        + (extra.length ? '<em>' + esc(extra.join(', ')) + '</em>' : '')
        + '</div>';
    }).join('');
  }

  const plus = n => (n > 0 ? '+' : '') + (Math.round(n * 10) / 10);
  const round = n => Math.round(n * 10) / 10;
  const commas = n => Math.round(n).toLocaleString('en-US');

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
    const rows = [
      ['shooting', round(numbers.gun.rate) + ' a second'],
      ['each shot', commas(numbers.gun.each) + (numbers.gun.many > 1
        ? ' × ' + numbers.gun.many : '')],
      ['weapon', commas(numbers.gun.dps) + ' a second'],
      ['ability', numbers.spell.dps
        ? commas(numbers.spell.dps) + ' a second, every ' + round(numbers.spell.every) + 's'
        : '—'],
      ['both hands', commas(numbers.total) + ' a second'],
      ['moving', round(PACE_AT(stats.spd)) + ' tiles a second'],
      ['life back', round(HEAL_AT(stats.vit)) + ' a second'],
      ['magic back', round(MANA_AT(stats.wis)) + ' a second']
    ];
    if (kill !== null) {
      rows.push([esc(boss.name), commas(boss.hp) + ' life, ' + boss.def + ' armour']);
      rows.push(['dies in', round(kill) + ' seconds']);
    }
    box.innerHTML = rows.map(([say, was]) =>
      '<span><i>' + say + '</i><b>' + was + '</b></span>').join('');
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
    const list = enchantsFor(worn.name, worn.ench, at);
    show('Enchantment for ' + esc(worn.name), list.map(one => ({
      id: one.id,
      name: one.name,
      says: one.worn
        ? Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' · ')
        : (one.says || '').split('\n')[0],
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
      + '<span class="tc-icon"></span><b>' + esc(clearSay || 'nothing') + '</b></button>'];
    for (const one of rows.slice(0, 400)) {
      out.push('<button type="button" class="tc-row" data-choose="' + esc(one.id) + '">'
        + (one.art ? itemIcon(one.id) : '<span class="tc-icon"></span>')
        + '<b>' + esc(one.name) + '</b>'
        + '<u>' + esc(one.says || '') + '</u>'
        + (one.counted === false ? '<em class="tc-uncounted">not counted</em>' : '')
        + '</button>');
    }
    if (rows.length > 400) {
      out.push('<p class="tc-more">' + (rows.length - 400)
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
      '<button type="button" class="tc-tab' + (i === onTab ? ' is-on' : '')
      + '" data-tab="' + i + '">' + esc(one.name)
      + (tabs.length > 1 ? '<u data-shut="' + i + '">×</u>' : '')
      + '</button>').join('')
      + '<button type="button" class="tc-tab tc-tab-new" data-tab="new">+</button>';
  }

  /* ---------------- putting it on the screen ---------------- */

  function paint() {
    const kind = el('tcClass');
    if (kind && kind.value !== build.klass) kind.value = build.klass;
    el('tcLevel').value = build.level;
    el('tcMaxed').checked = build.maxed;
    el('tcExalt').checked = build.exalt;
    el('tcAgainst').value = build.against;
    el('tcAgainstSay').textContent = build.against + ' armour';
    const boss = el('tcBoss');
    if (boss && boss.value !== String(build.boss)) boss.value = build.boss || '';
    el('tcName').value = build.name;
    drawTabs();
    drawSlots();
    drawStats();
    drawNumbers();
    drawGraph();
  }

  function fillPickers() {
    el('tcClass').innerHTML = data.classes.map(one =>
      '<option value="' + esc(one.name) + '">' + esc(one.name) + '</option>').join('');
    el('tcBoss').innerHTML = data.bosses.map(one =>
      '<option value="' + esc(one.name) + '">' + esc(one.name) + ' · '
      + commas(one.hp) + ' life, ' + one.def + ' armour</option>').join('');
    el('tcGoal').innerHTML = GOALS.map(one =>
      '<option value="' + one.id + '">' + esc(one.say) + '</option>').join('');
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
    el('tcLevel').addEventListener('input', event => {
      build.level = Math.max(1, Math.min(20, Number(event.target.value) || 1));
      keep(); paint();
    });
    for (const [id, key] of [['tcMaxed', 'maxed'], ['tcExalt', 'exalt']]) {
      el(id).addEventListener('change', event => {
        build[key] = event.target.checked; keep(); paint();
      });
    }
    el('tcAgainst').addEventListener('input', event => {
      build.against = Number(event.target.value) || 0;
      el('tcAgainstSay').textContent = build.against + ' armour';
      drawNumbers(); drawGraph(); keep();
    });
    el('tcBoss').addEventListener('change', event => {
      build.boss = event.target.value; keep(); drawNumbers(); drawGraph();
    });
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

    el('tcRun').addEventListener('click', () => {
      const goal = GOALS.find(one => one.id === el('tcGoal').value) || GOALS[0];
      const said = el('tcSaid');
      said.textContent = 'working…';
      // Off the paint, so the button has time to say it is working.
      setTimeout(() => {
        const was = scoreOf(build, goal);
        const got = optimise(build, goal, null);
        got.state.name = build.name;
        tabs[onTab] = build = got.state;
        keep(); paint();
        const better = was && isFinite(was) && was !== 0
          ? Math.round((got.score / was - 1) * 100) : null;
        said.textContent = got.looked.toLocaleString('en-US')
          + ' builds tried, one thing at a time'
          + (better !== null ? ' · ' + (better >= 0 ? '+' : '') + better + '%' : '')
          + ' · nothing left that one swap improves';
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

    fillPickers();
    if (!recall()) tabs = [fresh('Wizard')];
    build = tabs[onTab] || (tabs[0] = fresh('Wizard'));
    // A build kept from an older visit may name a class or item since renamed.
    if (!data.byClass[build.klass]) build = tabs[onTab] = fresh(data.classes[0].name);
    wire();
    paint();
  }

  return { start };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TheoryCraft;
