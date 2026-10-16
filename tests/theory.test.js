'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), vm = require('vm');
const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/TheoryCraft/theorycraft.json'), 'utf8'));
const harness = require('./theory-harness');
const engine = require('../web/engine');
const t = harness({}, raw, false);
// 768c0b5: the adapter now injects live metadata for shots that curve.
assert.deepEqual(JSON.parse(JSON.stringify(t.weaponRate(null, { att: 25, dex: 75 }, 0))),
  require('../web/theory-engine').weaponRate(null, { att: 25, dex: 75 }, 0));
assert.equal(t.landed, require('../web/theory-engine').landed,
  'TheoryCraft must use the extracted shot calculation directly');

// Frozen pre-extraction implementation: preserve comparison and Set insertion order.
{
  function legacy(data) {
  const COUNTS = ['ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS', 'MAXHP', 'MAXMP'];
  const stat = (one, key) => (one && one.worn && one.worn[key]) || 0;
  // Worth more than its own statistics: not comparable, so not dropped.
  const deeper = one => !!(one.set || one.share || one.rel || one.sub || one.mul
    || one.heal || one.alters || one.does || one.cast || one.many || one.burst
    || (one.shots || []).some(shot => shot.subattack));

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

    return beatenOnes;
  }
  const { createBeaten } = require('../web/theory-engine');
  const exact = (got, expected) => {
    assert.deepEqual(Object.keys(got), Object.keys(expected));
    for (const key of ['ench', 'gear']) assert.deepEqual([...got[key]], [...expected[key]]);
  };
  let data = raw, reads = 0;
  const factory = createBeaten(() => { reads++; return data; });
  assert.equal(reads, 0, 'construction stays lazy');
  const result = factory.beatenOnes();
  exact(result, legacy(raw)());
  assert.equal(factory.beatenOnes(), result);
  assert.equal(reads, 2, 'catalogues are read only on first demand');
  data = { items: [], enchants: [] };
  assert.equal(factory.beatenOnes(), result, 'replacement alone keeps the cache');
  factory.invalidate();
  const empty = factory.beatenOnes();
  assert.notEqual(empty, result);
  exact(empty, legacy(data)());
  data = { items: [] };
  factory.invalidate(); exact(factory.beatenOnes(), legacy(data)());
  data = {};
  factory.invalidate();
  assert.throws(() => factory.beatenOnes(), TypeError);
  const old = legacy(data); assert.throws(() => old(), TypeError);
  exact(factory.beatenOnes(), old()); // Original caches the partial result before failing.
  const api = harness({}, raw);
  exact(api.beatenOnes(), result);
  const cached = api.beatenOnes();
  api.configure({ ...raw, items: [], enchants: [] });
  assert.equal(api.beatenOnes(), cached, 'configure does not invalidate');
  api.progression(null, { mode: 'best' });
  assert.notEqual(api.beatenOnes(), cached);
  exact(api.beatenOnes(), empty);
  const lazy = harness({}, raw);
  lazy.configure({ ...raw, items: [], enchants: [] });
  exact(lazy.beatenOnes(), empty);
  console.log('Beaten candidates: exact catalogue order, lazy lifetime and explicit invalidation.');
}

// Frozen fit-index implementation, with the same live accessibility callback.
{
  const HANDS = ['weapon', 'ability', 'armor', 'ring'].map(hand => [hand]);
  function legacy(getData, accessible) {
    let itemsByFit = null;

    function ensureItemSearchIndex() {
      if (itemsByFit) return;

      itemsByFit = new Map();
      for (const one of getData().items) {
        const broad = one.hand + '/*';
        const exact = one.hand + '/' + one.slot;

        if (!itemsByFit.has(broad)) itemsByFit.set(broad, []);
        itemsByFit.get(broad).push(one);

        if (!itemsByFit.has(exact)) itemsByFit.set(exact, []);
        itemsByFit.get(exact).push(one);
      }
    }

    /*
     * Everything that physically fits this class slot, minus the reader's
     * blacklist. This is the manual picker catalogue: progression must not make
     * an existing item disappear when somebody simply wants to inspect it.
     */
    function compatibleItemsFor(hand, klass, state) {
      const kind = getData().byClass[klass];
      const slot = kind && kind.slots[HANDS.findIndex(h => h[0] === hand)];
      const out = (state && state.banned) || {};

      ensureItemSearchIndex();
      const key = hand + '/' + (slot === undefined ? '*' : slot);
      const candidates = itemsByFit.get(key) || [];

      return candidates.filter(one => !out[one.name]);
    }

    /*
     * What an automatic personalised search may actually offer.
     * Best-possible mode makes accessible() true for the full catalogue.
     */
    function itemsFor(hand, klass, state) {
      return compatibleItemsFor(hand, klass, state)
        .filter(one => accessible(one.name));
    }

    return { compatibleItemsFor, itemsFor };
  }
  const { createItemSearch } = require('../web/theory-engine');
  let data = { ...raw, byClass: Object.fromEntries(raw.classes.map(one => [one.name, one])) };
  let allow = () => true;
  const accessible = name => allow(name);
  const factory = createItemSearch({ getData: () => data, hands: HANDS, accessible });
  const old = legacy(() => data, accessible);
  const api = harness({}, raw);
  api.configure(data);
  const same = (got, expected) => {
    assert.equal(got.length, expected.length);
    got.forEach((one, i) => assert.ok(Object.is(one, expected[i]), 'candidate order and item references'));
  };
  let compared = 0;
  for (const klass of [...raw.classes.map(one => one.name), 'missing']) {
    for (const [hand] of [...HANDS, ['missing']]) {
      for (const state of [undefined, null, {}, { banned: Object.fromEntries(raw.items.map((one, i) =>
        [one.name, i % 3 === 0 ? true : i % 3 === 1 ? 0 : 'excluded'])) }]) {
        for (const name of ['compatibleItemsFor', 'itemsFor']) {
          const expected = old[name](hand, klass, state);
          same(factory[name](hand, klass, state), expected);
          same(api[name](hand, klass, state), expected);
          compared++;
        }
      }
    }
  }
  allow = name => name.length % 2 === 0;
  same(factory.itemsFor('weapon', 'Wizard', {}), old.itemsFor('weapon', 'Wizard', {}));
  allow = () => false;
  assert.equal(factory.itemsFor('weapon', 'Wizard', {}).length, 0);
  assert.ok(factory.compatibleItemsFor('weapon', 'Wizard', {}).length > 0);
  api.progression(null, { mode: 'personal' });
  assert.equal(api.itemsFor('weapon', 'Wizard', {}).length, 0);
  api.progression(null, { mode: 'best' });
  same(api.itemsFor('weapon', 'Wizard', {}), factory.compatibleItemsFor('weapon', 'Wizard', {}));
  const state = api.fresh('Wizard');
  state.banned = Object.fromEntries(raw.items.map(one => [one.name, true]));
  api.use(state);
  assert.equal(api.itemsFor('weapon', 'Wizard').length, 0, 'adapter reads the current build');
  api.use({ ...state, banned: {} });
  assert.ok(api.itemsFor('weapon', 'Wizard').length > 0);
  const cached = factory.compatibleItemsFor('weapon', 'missing', {});
  data = { ...data, items: [], byClass: {} };
  same(factory.compatibleItemsFor('weapon', 'Wizard', {}), cached);
  api.configure(data);
  same(api.compatibleItemsFor('weapon', 'missing', {}), cached);

  let reads = 0;
  const fixture = { byClass: {}, get items() { reads++; return raw.items; } };
  const lazy = createItemSearch({ getData: () => fixture, hands: HANDS, accessible });
  assert.equal(reads, 0);
  lazy.compatibleItemsFor('weapon', 'missing', {});
  lazy.itemsFor('ring', 'missing', {});
  lazy.compatibleItemsFor('armor', 'missing', {});
  assert.equal(reads, 1, 'the index is built exactly once across both APIs');
  let current = { items: [], byClass: {} };
  const live = createItemSearch({ getData: () => current, hands: HANDS, accessible });
  current = { items: raw.items, byClass: {} };
  same(live.compatibleItemsFor('weapon', 'missing', {}), cached);
  console.log('Item candidates: ' + compared + ' exact catalogue comparisons, live access and persistent lazy indexes.');
}

// Exercise the statistic seam without browser globals, status data or set rules.
// The corpus below covers the real catalogue; this fixture makes evaluation
// order, rounding, shared references and the caller's cache lifetime explicit.
{
  const stats = ['hp', 'mp', 'att', 'def', 'spd', 'dex', 'vit', 'wis'].map(key => [key]);
  const hands = ['weapon', 'ability', 'armor', 'ring'].map(key => [key]);
  const ofStat = Object.fromEntries(stats.map(([key]) => [key.toUpperCase(), key]));
  ofStat.MAXHP = 'hp'; ofStat.MAXMP = 'mp';
  const calculations = require('../web/theory-engine').createStatistics({ stats, hands, ofStat });
  const kind = { name: 'Fixture', grow: {} };
  for (const [key] of stats) {
    kind[key] = 10; kind[key + 'Top'] = 20; kind.grow[key] = 0.25;
  }
  Object.assign(kind, { hp: 100, hpTop: 101, mp: 50, mpTop: 100 });
  Object.assign(kind.grow, { hp: 0.75, mp: 1.25 });
  const first = { how: 'add', shots: [{ low: 10 }] };
  const second = { how: 'set', shots: [{ low: 20 }] };
  const third = { how: 'add', shots: [{ low: 30 }] };
  const items = [
    { name: 'Sword', worn: { ATT: 4.25, WIS: 3, Unknown: 999 },
      rel: [{ stat: 'ATT', of: 'ATT', pct: 50 }, { stat: 'HP', of: 'WIS', pct: 175 }],
      share: [{ stat: 'HP', of: 'MP', pct: 100 }, { stat: 'MP', of: 'HP', pct: 50 },
        { stat: 'Unknown', of: 'HP', pct: 100 }] },
    { name: 'Orb', worn: { MP: 10 }, share: [{ stat: 'HP', of: 'HP', pct: -50 }] },
    { name: 'Ring', worn: { HP: 20, MAXMP: 5 } }
  ];
  const enchants = [
    { id: 'a', worn: { ATT: 1.5, MP: 2 }, rel: [{ stat: 'ATT', of: 'ATT', pct: 50 }],
      mul: { dmg: 1.1, rate: 0.9, life: 0 }, sub: [first] },
    { id: 'b', worn: { WIS: 1 }, rel: [{ stat: 'HP', of: 'ATT', pct: 16 },
      { stat: 'HP', of: 'Unknown', pct: 100 }],
      mul: { dmg: 0.75, fast: 1.2 }, sub: [second, third] }
  ];
  const catalogue = {
    byClass: { Fixture: kind }, byItem: Object.fromEntries(items.map(one => [one.name, one])),
    byEnch: Object.fromEntries(enchants.map(one => [one.id, one]))
  };
  const bonuses = [{ gives: { att: 2.25, mp: 3 } }, { gives: { att: 1, mp: 4 } }];
  const state = { klass: 'Fixture', level: 3, maxed: false, exalt: true,
    exalts: { hp: 25, mp: 25, att: 5, wis: 5 }, gear: {
      weapon: { name: 'Sword', ench: [null, 'a', 'missing', ''] },
      ability: { name: 'Orb' }, armor: null, ring: { name: 'Ring', ench: ['b'] }
    } };
  const before = JSON.stringify({ state, catalogue, bonuses });
  const got = calculations.statsOf(state, catalogue, bonuses);
  assert.deepEqual(got.base, { hp: 101, mp: 53, att: 11, def: 11, spd: 11, dex: 11, vit: 11, wis: 11 });
  assert.deepEqual(got.from.bonus, { hp: 20, mp: 24, att: 9, def: 0, spd: 0, dex: 0, vit: 0, wis: 4 });
  assert.equal(got.from.rel.att, 9, 'relative bonuses use the same snapshot and exclude exalts');
  assert.equal(got.from.share.mp, 154.44 * 0.5, 'shares use totals before any share applies');
  assert.deepEqual(got.now, { hp: 179.2, mp: 179.2, att: 34, def: 11, spd: 11, dex: 11, vit: 11, wis: 20 });
  assert.deepEqual(Object.keys(got.from), ['gear', 'ench', 'set', 'exalt', 'rel', 'share', 'regen', 'bonus']);
  assert.equal(JSON.stringify({ state, catalogue, bonuses }), before, 'inputs remain untouched');
  assert.notEqual(calculations.statsOf(state, catalogue, bonuses).now, got.now, 'results are not cached');
  assert.equal(calculations.statsOf({ ...state, klass: 'missing' }, catalogue, bonuses), null);
  const capped = calculations.statsOf({ ...state, maxed: true, exalt: false, gear: {} }, catalogue, []);
  assert.deepEqual(capped.now, capped.top, 'maxed bases use class caps without gear or exalts');

  assert.deepEqual(calculations.scaleOf(state, catalogue.byEnch),
    { dmg: 1.1 * 0.75, rate: 0.9, life: 0, fast: 1.2 });
  const parts = calculations.subOf(state, catalogue.byEnch);
  assert.deepEqual(parts, [first, second, third]);
  parts.forEach((part, i) => assert.equal(part, [first, second, third][i], 'subattacks retain catalogue identity'));
  assert.notEqual(calculations.subOf(state, catalogue.byEnch), parts, 'only the list is fresh');
  state.gear.ability.ench = ['a'];
  const repeated = calculations.subOf(state, catalogue.byEnch);
  assert.deepEqual(repeated, [first, first, second, third], 'hand order and duplicates are preserved');
  assert.equal(repeated[0], repeated[1]);
  assert.equal(calculations.scaleOf(state, catalogue.byEnch).dmg, 1.1 * 1.1 * 0.75);
  assert.deepEqual(calculations.scaleOf(state, {}), { dmg: 1, rate: 1, life: 1, fast: 1 });
  assert.deepEqual(calculations.subOf(state, {}), [], 'catalogues are supplied per call');
  catalogue.byEnch.a.mul.dmg = 2;
  assert.equal(calculations.scaleOf(state, catalogue.byEnch).dmg, 2 * 2 * 0.75, 'catalogue changes are read immediately');
  hands.reverse();
  assert.equal(calculations.subOf(state, catalogue.byEnch)[0], second, 'rule tables retain their references');
  hands.reverse();
  delete state.gear.ability.ench;

  const fixture = { classes: [kind], items, enchants, bosses: [], sets: [] };
  const adapter = harness({}, fixture, false);
  assert.equal(adapter.statsOf({ ...state, klass: 'missing' }), null);
  fixture.sets = [{ name: 'Fixture set', pieces: ['Sword', 'Orb'], steps: { 2: { ATT: 3.25, MP: 7 } } }];
  adapter.configure(JSON.parse(JSON.stringify(fixture)));
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(adapter.statsOf(state)), got, 'adapters pass resolved set bonuses to the engine');
  assert.deepEqual(plain(adapter.scaleOf(state)), calculations.scaleOf(state, catalogue.byEnch));
  const adaptedParts = adapter.subOf(state);
  assert.equal(adaptedParts[0], adapter.subOf(state)[0], 'adapter preserves subattack identity across calls');
  assert.deepEqual(plain(adaptedParts), calculations.subOf(state, catalogue.byEnch));
  adapter.configure({ ...fixture, sets: [] });
  assert.deepEqual(plain(adapter.statsOf(state)), got,
    'set indexes stay owned by the UI closure and retain their existing lifetime');
}

// Compare the extracted seam with the pre-extraction implementation.
{
  const hands = ['weapon', 'ability', 'armor', 'ring'].map(key => [key]);
  const ofStat = Object.fromEntries(['hp', 'mp', 'att', 'def', 'spd', 'dex', 'vit', 'wis']
    .map(key => [key.toUpperCase(), key]));
  ofStat.MAXHP = 'hp'; ofStat.MAXMP = 'mp';
  const rules = { hands, ofStat };
  const createSets = require('../web/theory-engine').createSets;
  function legacy(data) {
    const HANDS = hands, OF_STAT = ofStat;
    let sharedPieces = null;
    let setsByPiece = null;

    function ensureSetIndex() {
      if (sharedPieces && setsByPiece) return;

      sharedPieces = new Map();
      setsByPiece = new Map();

      for (const [order, kit] of (data.sets || []).entries()) {
        for (const piece of kit.pieces) {
          sharedPieces.set(piece, (sharedPieces.get(piece) || 0) + 1);
          if (!setsByPiece.has(piece)) setsByPiece.set(piece, []);
          setsByPiece.get(piece).push({ kit, order });
        }
      }
    }

    function timesListed(name) {
      ensureSetIndex();
      return sharedPieces.get(name) || 0;
    }

    function setsOn(state) {
      ensureSetIndex();

      const worn = new Set(HANDS.map(h => (state.gear[h[0]] || {}).name).filter(Boolean));
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
  const plain = value => JSON.parse(JSON.stringify(value));
  const gearFor = names => Object.fromEntries(hands.map(([hand], i) =>
    [hand, names[i] ? { name: names[i] } : null]));
  const original = legacy(raw);
  const extracted = createSets(rules, () => raw.sets);
  const builds = [
    [], ['Harmonious Harp'], ['Harmonious Harp', "Angel's Fanfare"],
    ['Harmonious Harp', "Angel's Fanfare", 'Wings of Sanctity', 'Heavenly Halo'],
    ['Laser Rifle', null, 'Fitted Protective Matrix'],
    ['Laser Rifle', null, 'Fitted Protective Matrix', 'Loaded Core'],
    ['Neo Laser Rifle', null, 'Neo Fitted Protective Matrix', 'Neo Alien Core: Power'],
    ['Harmonious Harp', "Angel's Fanfare", null, 'Loaded Core'],
    ['Loaded Core', 'Laser Rifle', 'Loaded Core'], ['not a piece', null, null, '']
  ];
  const before = JSON.stringify(raw.sets);
  for (const names of builds) {
    const gear = gearFor(names), snapshot = JSON.stringify(gear);
    const got = extracted.setsOn(gear);
    assert.deepEqual(got, original.setsOn({ gear }), `set parity: ${names}`);
    assert.deepEqual(plain(t.setsOn({ gear })), got, 'UI adapter preserves resolved bonuses');
    assert.equal(JSON.stringify(gear), snapshot);
    assert.notEqual(extracted.setsOn(gear), got, 'results remain fresh');
  }
  assert.equal(extracted.timesListed('Harmonious Harp'), 1);
  assert.ok(extracted.timesListed('Laser Rifle') > 1);
  assert.equal(extracted.timesListed('not a piece'), 0);
  assert.deepEqual(extracted.setsOn(gearFor(builds[1])), [], 'one unique piece cannot pay');
  assert.equal(extracted.setsOn(gearFor(builds[2]))[0].many, 2);
  assert.deepEqual(extracted.setsOn(gearFor(builds[4])), [], 'shared alien pieces alone cannot pay');
  assert.deepEqual(extracted.setsOn(gearFor(builds[5])).map(kit => kit.name), ['Loaded Core']);
  assert.equal(JSON.stringify(raw.sets), before);

  // Observe catalogue access and iteration without exposing the private maps.
  for (const first of ['setsOn', 'timesListed']) {
    let reads = 0, builds = 0;
    const kit = { name: 'First', pieces: ['A', 'B'],
      steps: { 2: { MAXATT: 2, Unknown: 99 }, 3: { ATT: 100 } } };
    const kits = [kit, { name: 'Second', pieces: ['C', 'D'], steps: { 2: { ATT: 3 } } }];
    kits.entries = function () { builds++; return Array.prototype.entries.call(this); };
    let current = [];
    const calculations = createSets(rules, () => { reads++; return current; });
    assert.equal(reads, 0, 'factory does not read sets');
    assert.equal(builds, 0, 'factory does not build indexes');
    current = kits;
    if (first === 'setsOn') calculations.setsOn({});
    else assert.equal(calculations.timesListed('A'), 1);
    assert.equal(reads, 1); assert.equal(builds, 1);
    current = [];
    const gear = gearFor(['D', 'C', 'B', 'A']);
    assert.deepEqual(calculations.setsOn(gear), [
      { name: 'First', many: 2, gives: { att: 2 } },
      { name: 'Second', many: 2, gives: { att: 3 } }
    ], 'catalogue order, MAX fallback and threshold survive gear order and catalogue replacement');
    kit.name = 'Renamed'; kit.steps[2].MAXATT = 7;
    const got = calculations.setsOn(gear);
    assert.equal(got[0].name, 'Renamed'); assert.equal(got[0].gives.att, 7,
      'indexes retain original kit and steps references');
    ofStat.MAXATT = 'dex';
    assert.equal(calculations.setsOn(gear)[0].gives.dex, 7, 'stat table is retained by reference');
    delete ofStat.MAXATT;
    assert.equal(calculations.timesListed('A'), 1);
    assert.equal(reads, 1); assert.equal(builds, 1, 'indexes are built only once');
  }
  for (const initial of [undefined, null, []]) {
    let current = initial, reads = 0;
    const calculations = createSets(rules, () => { reads++; return current; });
    assert.deepEqual(calculations.setsOn(gearFor(builds[2])), []);
    current = raw.sets;
    assert.equal(calculations.timesListed('Harmonious Harp'), 0);
    assert.deepEqual(calculations.setsOn(gearFor(builds[2])), []);
    assert.equal(reads, 1, 'even an empty index retains its lifetime');
  }
  const adapter = harness({}, raw, false);
  adapter.configure({ ...raw, sets: [] });
  adapter.configure(raw);
  const state = { gear: gearFor(builds[2]) };
  assert.deepEqual(plain(adapter.setsOn(state)), extracted.setsOn(state.gear),
    'configure before first demand uses the current catalogue');
  adapter.configure({ ...raw, sets: [] });
  adapter.use({ gear: {} });
  assert.deepEqual(plain(adapter.setsOn(state)), extracted.setsOn(state.gear),
    'configure and use do not invalidate existing indexes');
}

// Frozen remote numbersFor (bec9226, 7f146ae, f21eeff, 5a4233f, 6f816f7):
// keep the accepted combat, piece damage and range rules independent of the factory.
// Compare every leaf exactly, including non-finite numbers and property order;
// JSON round-tripping would hide NaN, -0 and the immune Set.
{
  const { createNumbers } = require('../web/theory-engine');
  const api = harness({}, raw, false);
  const clone = value => JSON.parse(JSON.stringify(value));
  let data = clone(raw);
  api.configure(data);
  const { statsOf, scaleOf, subOf, weaponRate, abilityRate, effectsFor, fxOf,
    fightOf, costOf, regenOf, wornEffects, temperOf, standOf, specialsOf } = api;
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
    const piece = (hand, base) => ({ low: base + ((special.by[hand] || {}).low || 0), high: base + ((special.by[hand] || {}).high || 0) });
    const parts = { weapon: piece('weapon', gun.dps + bleed), ability: piece('ability', spell.dps), armor: piece('armor', 0), ring: piece('ring', 0) };
    parts.all = { low: 0, high: 0 };
    for (const hand of ['weapon', 'ability', 'armor', 'ring']) { parts.all.low += parts[hand].low; parts.all.high += parts[hand].high; }
    const total = (using === 'spell' ? 0 : gun.dps) + bleed;
    // The damage the reader asked to count: the weapon's shots, the ability, or every piece worn (at the low end of what is estimated).
    const chosen = state.damage === 'all' ? parts.all.low : state.damage === 'ability' ? parts.ability.low : total;
    return { stats, fought, gun, spell, effects, bleed, regen, special, temper, parts, total, chosen };
  }

  const extracted = createNumbers({ getData: () => data,
    statsOf, scaleOf, subOf, weaponRate, abilityRate, effectsFor, fxOf,
    fightOf, costOf, regenOf, wornEffects, temperOf, standOf, specialsOf });
  function exact(got, expected, why) {
    if (expected === null || typeof expected !== 'object') {
      assert.strictEqual(got, expected, why);
      return;
    }
    assert.ok(got && typeof got === 'object', why);
    if (Object.prototype.toString.call(expected) === '[object Set]') {
      assert.strictEqual(Object.prototype.toString.call(got), '[object Set]', why);
      assert.deepStrictEqual([...got], [...expected], why);
      return;
    }
    assert.deepStrictEqual(Object.keys(got), Object.keys(expected), why + ' key order');
    for (const key of Object.keys(expected)) exact(got[key], expected[key], why + '.' + key);
  }
  const hands = ['weapon', 'ability', 'armor', 'ring'];
  function outfit(klass, names = []) {
    const state = clone(api.fresh(klass));
    names.forEach((name, i) => {
      if (name === undefined) return;
      if (name === null) state.gear[hands[i]] = null;
      else {
        assert.ok(data.byItem[name], name + ' is in the real catalogue');
        state.gear[hands[i]].name = name;
      }
    });
    return state;
  }
  const builds = [
    outfit('Wizard'), outfit('Warrior'),
    outfit('Wizard', [undefined, undefined, 'Wretched Rags', 'Ring of Cubed Wisdom']),
    outfit('Archer', ['Frangible Longbow']),
    outfit('Bard', ['Harmonious Harp', "Angel's Fanfare", 'Wings of Sanctity', 'Heavenly Halo']),
    outfit('Bard', ['Harmonious Harp', "Angel's Fanfare", null, null]),
    outfit('Archer', ['Laser Rifle', undefined, 'Fitted Protective Matrix', null]),
    outfit('Archer', ['Laser Rifle', undefined, 'Fitted Protective Matrix', 'Loaded Core']),
    outfit('Mystic', [undefined, 'Imprisonment Orb', undefined, 'Ring of Cubed Wisdom']),
    outfit('Samurai', ['Blood Siphoning Katana']),
    outfit('Rogue', ['Poison Fang Dagger']),
    outfit('Wizard', [null, null, null, null])
  ];
  builds[0].gear.weapon.ench = ['Damage_Tradeoff_4', 'FireRate_Tradeoff_4'];
  builds[2].level = 7; builds[2].maxed = false; builds[2].exalt = false;
  builds[10].gear.weapon.ench = ['AWAKENED_POISON_FANG_DAGGER'];
  const stinger = outfit('Rogue', ["Queen's Stinger"]);
  stinger.gear.weapon.ench = ['BUZZING_BULLETS_STINGER'];
  builds.push(stinger);
  for (const state of builds) for (const worn of Object.values(state.gear)) {
    for (const id of (worn && worn.ench) || []) if (id) assert.ok(data.byEnch[id], id);
  }
  const unknown = { ...builds[0], klass: 'not a class' };
  builds.push(unknown);
  assert.ok(api.setsOn(builds[4]).length > 0, 'four-piece set fixture pays');
  assert.ok(api.setsOn(builds[5]).length > 0, 'two-piece set fixture pays');
  assert.strictEqual(api.setsOn(builds[6]).length, 0, 'shared alien pieces alone do not pay');
  assert.ok(api.setsOn(builds[7]).some(kit => kit.name === 'Loaded Core'));

  const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'web/assets/index/status-effects.json'), 'utf8'));
  const info = { byName: new Map(catalogue.effects.map(one => [one.name, one])), immune: new Map() };
  for (const one of catalogue.effects) for (const id of one.immune || []) {
    const name = id.replace(/^enemy:/, '');
    if (!info.immune.has(name)) info.immune.set(name, new Set());
    info.immune.get(name).add(one.name);
  }
  let compared = 0;
  for (const status of [null, info]) {
    api.setStatusInfo(status);
    for (const [i, state] of builds.entries()) {
      state.boss = i % 2 ? 'Void Entity' : data.bosses.find(b => b.name !== 'Void Entity').name;
      state.assume = i % 2 ? {} : { Damaging: true, Berserk: true, Curse: true,
        'Armor Broken': true, Exposed: true };
      for (const using of ['gun', 'spell', 'both']) for (const def of [0, 40, 500, -20]) {
        state.using = using;
        const before = JSON.stringify(state);
        const expected = numbersFor(state, def);
        exact(extracted.numbersFor(state, def), expected, 'factory ' + i + '/' + using + '/' + def);
        exact(api.numbersFor(state, def), expected, 'adapter ' + i + '/' + using + '/' + def);
        assert.strictEqual(JSON.stringify(state), before, 'numbers do not mutate the build');
        compared++;
      }
    }
  }
  assert.strictEqual(compared, 336);
  assert.strictEqual(api.numbersFor(unknown, 0), null);
  const bleeding = api.numbersFor(builds[9], 40);
  assert.ok(bleeding.bleed > 0, 'the weapon fixture contributes bleeding');
  // f21eeff: the ability is evaluated separately; the default total still counts the weapon.
  assert.strictEqual(bleeding.total, bleeding.gun.dps + bleeding.bleed);
  assert.strictEqual(bleeding.parts.ability.low, bleeding.spell.dps);
  api.setStatusInfo(null);
  assert.strictEqual(api.numbersFor(builds[9], 40).effects, null, 'status can be removed after construction');
  api.setStatusInfo(info);
  assert.ok(api.numbersFor(builds[9], 40).effects, 'status can be restored after construction');

  // Reconfiguration must reach both catalogue lookups and the live callbacks,
  // while set indexes keep the lifetime already covered above.
  const before = api.numbersFor(builds[0], 40);
  const replacement = clone(raw);
  const name = builds[0].gear.weapon.name;
  replacement.items.find(one => one.name === name).shots[0].low += 13;
  replacement.classes.find(one => one.name === 'Wizard').attTop += 7;
  data = replacement;
  api.configure(data);
  exact(api.numbersFor(builds[0], 40), numbersFor(builds[0], 40), 'reconfigured adapter');
  exact(extracted.numbersFor(builds[0], 40), numbersFor(builds[0], 40), 'reconfigured factory');
  assert.notStrictEqual(api.numbersFor(builds[0], 40).total, before.total);
  console.log('Build numbers: 336 exact legacy comparisons through factory and adapter, live catalogues and status.');
}

// Keep the old scoring body independent of the factory and compare every goal
// with Object.is: serialization would hide NaN and infinities.
{
  const { createScore } = require('../web/theory-engine');
  const api = harness({}, raw, false);
  let data = JSON.parse(JSON.stringify(raw));
  api.configure(data);
  function legacy(state, goal) {
    const boss = data.byBoss[state.boss];
    const def = goal.id === 'kill' && boss ? boss.def : state.against;
    const numbers = api.numbersFor(state, def);
    if (!numbers) return -Infinity;
    return goal.of(numbers, state);
  }
  const score = createScore({ getData: () => data, numbersFor: api.numbersFor });
  const builds = ['Wizard', 'Warrior', 'Archer', 'Bard'].map(klass =>
    JSON.parse(JSON.stringify(api.fresh(klass))));
  builds[0].gear.weapon.ench = ['Damage_Tradeoff_4', 'FireRate_Tradeoff_4'];
  builds[1].maxed = false; builds[1].level = 7;
  builds[2].gear.weapon.name = 'Frangible Longbow';
  builds[3].gear.weapon.name = 'Harmonious Harp';
  builds.push({ ...builds[0], klass: 'not a class' });
  const empty = JSON.parse(JSON.stringify(builds[0]));
  for (const hand of Object.keys(empty.gear)) empty.gear[hand] = null;
  builds.push(empty);
  let compared = 0;
  for (const state of builds) for (const boss of [data.bosses[0].name, '', 'unknown boss']) {
    state.boss = boss;
    for (const def of [null, 0, 40, 500]) {
      state.against = def;
      for (const goal of api.GOALS) {
        const expected = legacy(state, goal);
        assert.ok(Object.is(score(state, goal), expected), 'factory parity: ' + goal.id);
        assert.ok(Object.is(api.scoreOf(state, goal), expected), 'adapter parity: ' + goal.id);
        compared++;
      }
    }
  }
  const state = builds[0], kill = api.GOALS.find(goal => goal.id === 'kill');
  state.boss = data.bosses[0].name;
  const before = score(state, kill);
  assert.ok(Number.isFinite(before) && before < 0);
  data = JSON.parse(JSON.stringify(raw));
  const boss = data.bosses.find(one => one.name === state.boss);
  boss.def = 0; boss.hp *= 3;
  api.configure(data);
  assert.ok(!Object.is(score(state, kill), before), 'replacement boss catalogue changes kill score');
  assert.ok(Object.is(score(state, kill), legacy(state, kill)), 'factory uses replacement defence');
  assert.ok(Object.is(api.scoreOf(state, kill), legacy(state, kill)), 'adapter uses replacement defence');
  console.log('Build scores: ' + compared + ' exact legacy comparisons through factory and adapter, live bosses.');
}

// Frozen share arithmetic before extraction, including repeated value coercion.
function legacyShares(goalsOf) {
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
  return { shareOf, sharesOf };
}

{
  const theory = require('../web/theory-engine');
  const api = harness({}, raw, false);
  const prior = legacyShares(api.goalsOf);
  const factory = theory.createShares({ goalsOf: api.goalsOf });
  let compared = 0;
  function same(got, expected) {
    assert.equal(got.length, expected.length);
    got.forEach((one, i) => {
      assert.deepEqual(Object.keys(one), Object.keys(expected[i]));
      for (const key of ['goal', 'raw', 'part']) {
        assert.ok(Object.is(one[key], expected[i][key]), 'exact share ' + key);
      }
      compared++;
    });
  }
  const selections = [{ goals: undefined, goal: undefined }, { goals: [] }, { goals: [], goal: 'stat:hp' },
    { goal: 'unknown' }, { goals: ['unknown'] }, { goals: ['stat:hp'] },
    { goals: ['stat:hp', 'dps', 'unknown', 'dps', 'stat:dex'] }];
  const values = [undefined, null, {}, { dps: 70, 'stat:hp': 30, 'stat:dex': 0.1 },
    { dps: 0, 'stat:hp': -2, 'stat:dex': NaN },
    { dps: null, 'stat:hp': undefined, 'stat:dex': '2.7' },
    { dps: Infinity, 'stat:hp': -Infinity, 'stat:dex': false },
    { dps: Number.MAX_VALUE, 'stat:hp': Number.MAX_VALUE, 'stat:dex': Number.MIN_VALUE }];
  for (const selection of selections) for (const share of values) {
    const state = { ...api.fresh('Wizard'), ...selection, share,
      pinned: { dps: true, 'stat:hp': true } };
    for (const name of ['dps', 'stat:hp', 'stat:dex', 'unknown']) {
      for (const subject of [factory, api]) {
        assert.ok(Object.is(subject.shareOf(state, name), prior.shareOf(state, name)));
      }
    }
    same(factory.sharesOf(state), prior.sharesOf(state));
    same(api.sharesOf(state), prior.sharesOf(state));
  }
  const empty = { get pinned() { throw new Error('shares must not read UI pins'); } };
  same(api.sharesOf(empty), prior.sharesOf(empty));
  same(factory.sharesOf(empty), prior.sharesOf(empty));
  // A live selector can return an empty or replaced list, preserving identities.
  let list = api.GOALS.slice(0, 2);
  const live = theory.createShares({ goalsOf: () => list });
  const old = legacyShares(() => list);
  for (const next of [list, [], [api.GOALS[3], api.GOALS[0]]]) {
    list = next;
    same(live.sharesOf({}), old.sharesOf({}));
  }
  // Getters and coercion observe every read in the original order.
  function observed(run, sequence) {
    const calls = [];
    let at = 0;
    const state = { get share() {
      calls.push('share');
      return new Proxy({}, { get(_target, id) {
        calls.push(id);
        return { valueOf() { calls.push('number'); return sequence[at++ % sequence.length]; } };
      } });
    } };
    const result = run(state);
    return { calls, result };
  }
  list = api.GOALS.slice(0, 2);
  const sequence = [1e16, 0.1, 7, 3, 11, 5];
  const got = observed(live.sharesOf, sequence), expected = observed(old.sharesOf, sequence);
  same(got.result, expected.result);
  assert.deepEqual(got.calls, expected.calls);
  assert.equal(got.calls.length, 18, 'three share reads and coercions per goal');
  // Construction and adapter identities remain stable across repeated calls.
  const original = theory.createShares;
  let made, constructions = 0;
  theory.createShares = dependencies => { constructions++; return made = original(dependencies); };
  let bound;
  try { bound = harness({}, raw, false); }
  finally { theory.createShares = original; }
  for (let i = 0; i < 100; i++) bound.sharesOf({ goals: ['dps', 'stat:hp'] });
  assert.equal(constructions, 1);
  assert.strictEqual(bound.shareOf, made.shareOf);
  assert.strictEqual(bound.sharesOf, made.sharesOf);
  console.log('Goal shares: ' + compared + ' exact legacy rows, live goals, repeated reads and adapter identity.');
}

// Frozen goal selection before extraction. Only the closure bindings become
// callbacks; real catalogue comparisons use the frozen share arithmetic above.
{
  function legacy({ getGoals, getBuild, optimise, scoreOf, sharesOf }) {
    function goalsOf(state) {
      const want = state.goals && state.goals.length
        ? state.goals : [state.goal || 'dps'];
      const out = getGoals().filter(one => want.includes(one.id));
      return out.length ? out : [getGoals()[0]];
    }

    const AUGMENT = 1e-3;

    let ideals = { key: null, best: null };

    function bestAlone(state, list) {
      const build = getBuild();
      const key = JSON.stringify([state.klass, state.level, state.boss, state.against,
        state.gear, state.locked, state.exalt, (build && build.banned) || null,
        // 6f816f7/5a4233f: range and counted damage now change the ideals.
        state.range, state.damage,
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
  const { createGoals } = require('../web/theory-engine');
  const clone = value => JSON.parse(JSON.stringify(value));
  const sameList = (got, expected) => {
    assert.deepEqual(Array.from(got, one => one.id), Array.from(expected, one => one.id));
    got.forEach((one, i) => assert.ok(Object.is(one, expected[i]), 'goal references and order'));
  };
  const sameBest = (got, expected) => {
    assert.deepEqual(Object.keys(got), Object.keys(expected));
    for (const id of Object.keys(expected)) assert.ok(Object.is(got[id], expected[id]), id);
  };
  let compared = 0;
  const sameAim = (got, expected, samples) => {
    assert.deepEqual(Object.keys(got), Object.keys(expected));
    assert.equal(got.id, expected.id); assert.equal(got.say, expected.say);
    if (expected.goals) sameList(got.goals, expected.goals);
    else assert.ok(Object.is(got, expected), 'a single goal is the original GOALS object');
    for (const [numbers, state] of samples) {
      assert.ok(Object.is(got.of(numbers, state), expected.of(numbers, state)), 'exact aim score: ' + got.id);
      compared++;
    }
  };
  const api = harness({}, raw, false);
  let data = clone(raw), build = null;
  api.configure(data);
  const dependencies = { getGoals: () => api.GOALS, getBanned: () => (build && build.banned) || null,
    optimise: api.optimise, scoreOf: api.scoreOf, sharesOf: api.sharesOf };
  const factory = createGoals(dependencies);
  const old = legacy({ ...dependencies, getBuild: () => build,
    sharesOf: legacyShares(api.goalsOf).sharesOf });
  const choices = [{}, { goals: [] }, { goals: [], goal: 'stat:hp' }, { goal: 'kill' },
    { goals: ['unavailable'], goal: 'stat:hp' }, { goals: ['stat:hp', 'dps', 'dps', 'unavailable'] },
    { goals: ['stat:dex', 'kill', 'stat:hp'] }];
  for (const klass of ['Wizard', 'Warrior', 'Archer', 'Bard']) {
    const state = clone(api.fresh(klass));
    state.scope = 'gear'; state.against = 40;
    // Keep real catalogue searches small while still optimising the ring slot.
    for (const hand of Object.keys(state.gear)) state.locked[hand] = hand !== 'ring';
    if (klass === 'Warrior') { state.maxed = false; state.level = 7; }
    const samples = [state, { ...state, exalt: false }, { ...state, maxed: false, level: 3 }]
      .map(at => [api.numbersFor(at, 40), at]);
    for (const boss of [data.bosses[0].name, 'unknown boss']) {
      state.boss = boss;
      for (const choice of choices) {
        delete state.goals; delete state.goal; Object.assign(state, choice);
        build = state; api.use(build);
        const list = old.goalsOf(state);
        sameList(factory.goalsOf(state), list); sameList(api.goalsOf(state), list);
        const expected = old.bestAlone(state, list);
        sameBest(factory.bestAlone(state, list), expected); sameBest(api.bestAlone(state, list), expected);
        for (const share of [{}, { dps: 90, 'stat:hp': 10, kill: 1, 'stat:dex': 3 },
          { dps: '0', 'stat:hp': Infinity, kill: -2, 'stat:dex': '9' }]) {
          state.share = share;
          const aim = old.aimOf(state);
          sameAim(factory.aimOf(state), aim, samples); sameAim(api.aimOf(state), aim, samples);
        }
      }
    }
    for (const list of [[], [api.GOALS[2], api.GOALS[0]], [api.GOALS[0]]]) {
      const aim = old.aimOf(state, list);
      for (const target of [factory, api]) {
        const got = target.aimOf(state, list);
        sameAim(got, aim, samples);
        if (list.length !== 1) assert.ok(Object.is(got.goals, list), 'explicit list is retained');
        if (!list.length) assert.ok(Object.is(got.of(samples[0][0], state), Infinity));
      }
    }
  }

  // The kill closure keeps reading the live catalogue even when its ideal is cached.
  const state = clone(api.fresh('Wizard'));
  state.scope = 'gear'; state.goals = ['kill', 'stat:hp']; state.boss = data.bosses[0].name;
  for (const hand of Object.keys(state.gear)) state.locked[hand] = true;
  build = state; api.use(build);
  const list = api.goalsOf(state), cached = api.bestAlone(state, list);
  sameBest(factory.bestAlone(state, list), cached); sameBest(old.bestAlone(state, list), cached);
  const aimBefore = api.aimOf(state), valueBefore = api.scoreOf(state, aimBefore);
  data = clone(raw); data.bosses.find(one => one.name === state.boss).hp *= 3;
  api.configure(data);
  assert.ok(Object.is(api.bestAlone(state, list), cached), 'catalogue replacement does not invalidate ideals');
  assert.ok(!Object.is(api.scoreOf(state, aimBefore), valueBefore), 'captured goals still read live boss data');
  for (const target of [factory, api]) sameAim(target.aimOf(state), old.aimOf(state), [[api.numbersFor(state, 40), state]]);
  build = { banned: { changed: true } }; api.use(build);
  const after = api.bestAlone(state, list);
  assert.notStrictEqual(after, cached, 'current build bans invalidate even when state is a different object');
  sameBest(after, old.bestAlone(state, list)); sameBest(factory.bestAlone(state, list), after);
  console.log('Goals: ' + compared + ' exact catalogue aim comparisons, goal identity, order and live bosses.');

  // Changing the profile and access catalogue affects eligibility at the existing
  // optimiser boundary. As before it does not, by itself, invalidate ideals.
  const P = require('../web/progression');
  const items = ['Energy Staff', 'Comet Staff', 'Staff of the Cosmic Whole']
    .map(name => raw.items.find(one => one.name === name));
  assert.ok(items.every(Boolean));
  const records = [{ id: 'portal:Goal cave', kind: 'portal', name: 'Goal cave' },
    { id: 'enemy:Goal boss', kind: 'enemy', name: 'Goal boss' },
    ...items.map(one => ({ id: 'item:' + one.name, kind: 'item', name: one.name }))];
  const access = P.catalogue({ records, views: { theory: { items: records.slice(2).map(one => one.id) } } },
    { ids: records.map(one => one.id),
      pages: records.map(one => [one.name.toLowerCase().replace(/ /g, '-'), one.name]),
      page: records.map((_, i) => [i, i]), spawn: [],
      dungeon: [[0, 1]], drop: [[1, 4]] }, items);
  const local = harness({}, { ...raw, items, enchants: [], sets: [] }, false);
  const at = clone(local.fresh('Wizard')); at.scope = 'gear'; at.goals = ['dps', 'stat:hp'];
  const ids = local.goalsOf(at);
  local.use(at); local.progression(access, { mode: 'personal', zones: [] });
  const localDeps = { getGoals: () => local.GOALS, getBanned: () => null,
    optimise: local.optimise, scoreOf: local.scoreOf, sharesOf: local.sharesOf };
  const live = createGoals(localDeps), prior = legacy({ ...localDeps, getBuild: () => at,
    sharesOf: legacyShares(local.goalsOf).sharesOf });
  const start = local.bestAlone(at, ids);
  const startLive = live.bestAlone(at, ids), startPrior = prior.bestAlone(at, ids);
  sameBest(startLive, startPrior); sameBest(start, startPrior);
  assert.equal(local.accessible(items[2].name), false);
  local.progression(access, { mode: 'personal', zones: ['dungeon:goal-cave'] });
  assert.equal(local.accessible(items[2].name), true, 'profile is live');
  assert.strictEqual(local.bestAlone(at, ids), start, 'profile updates do not clear ideals');
  assert.strictEqual(live.bestAlone(at, ids), startLive);
  assert.strictEqual(prior.bestAlone(at, ids), startPrior);
  // A key change forces fresh searches against the new profile.
  at.against = 41;
  const reachable = local.bestAlone(at, ids);
  sameBest(reachable, prior.bestAlone(at, ids)); sameBest(live.bestAlone(at, ids), reachable);
  assert.ok(reachable.dps > start.dps, 'newly reachable staff enters the optimisation');
  local.progression(null, { mode: 'personal', zones: ['dungeon:goal-cave'] });
  assert.equal(local.accessible(items[2].name), false, 'access catalogue is live');
  assert.strictEqual(local.bestAlone(at, ids), reachable, 'access replacement alone preserves ideals');
  at.against = 42;
  for (const target of [local, live, prior]) assert.throws(() => target.bestAlone(at, ids), /Set up your progression/);
  local.progression(access, { mode: 'personal', zones: [] });
  sameBest(local.bestAlone(at, ids), prior.bestAlone(at, ids));

  // Instrument the seam: cache hits perform no scoring or searching; misses
  // always optimise then score once per list entry, even for finite optima.
  let goals = api.GOALS.slice(0, 3), bans = null, searches = 0;
  const calls = [];
  let optimum = 11, was = 7;
  const atState = clone(state), numbers = { total: 3, stats: { now: { hp: 20 } } };
  const probeDeps = { getGoals() { calls.push('goals'); return goals; },
    getBanned() { calls.push('banned'); return bans; },
    optimise(s, one, report) { assert.strictEqual(s, atState); assert.strictEqual(report, null);
      calls.push('optimise:' + one.id); searches++; return { score: optimum }; },
    scoreOf(s, one) { assert.strictEqual(s, atState); calls.push('score:' + one.id); return was; },
    sharesOf(s) { assert.strictEqual(s, atState); calls.push('shares');
      return goals.map((goal, i) => ({ goal, raw: i, part: i === 0 ? 0 : i === 1 ? -1 : NaN })); } };
  const probe = createGoals(probeDeps), original = legacy({ ...probeDeps, getBuild: () => ({ banned: bans }) });
  assert.deepEqual(calls, [], 'construction stays lazy');
  const pair = goals.slice(0, 2);
  const first = probe.bestAlone(atState, pair);
  assert.deepEqual(calls, ['banned', 'optimise:dps', 'score:dps', 'optimise:kill', 'score:kill']);
  assert.equal(searches, 2); calls.length = 0;
  assert.strictEqual(probe.bestAlone(atState, pair), first); assert.deepEqual(calls, ['banned']);
  atState.share = { dps: 99 }; atState.exalts.hp++; atState.maxed = !atState.maxed;
  assert.strictEqual(probe.bestAlone(atState, pair), first, 'shares, maxed and exalts remain outside the original key');
  bans = { excluded: true };
  assert.notStrictEqual(probe.bestAlone(atState, pair), first);
  const second = probe.bestAlone(atState, pair);
  bans.excluded = false;
  assert.notStrictEqual(probe.bestAlone(atState, pair), second, 'in-place ban edits are observed');
  for (const change of [() => atState.klass += '!', () => atState.level++, () => atState.boss += '!',
    () => atState.against++, () => atState.gear.weapon.name += '!', () => atState.locked.weapon = false,
    () => atState.range = 'long', () => atState.damage = 'ability',
    () => atState.exalt = !atState.exalt, () => pair.reverse()]) {
    const before = searches; change(); probe.bestAlone(atState, pair);
    assert.equal(searches - before, pair.length, 'each serialized field invalidates');
  }
  const beforeEmpty = searches, empty = probe.bestAlone(atState, []);
  assert.deepEqual(Object.keys(empty), []); assert.equal(searches, beforeEmpty);
  assert.strictEqual(probe.bestAlone(atState, []), empty);
  const beforeEviction = searches; probe.bestAlone(atState, pair);
  assert.equal(searches - beforeEviction, pair.length, 'cache retains only one key');
  // Every finite/non-finite fallback, signed zero, near-zero margin and pull floor.
  for (optimum of [NaN, Infinity, -Infinity, -0, 7, 7 + 1e-10, 7 + 1e-8, 1e16]) {
    for (was of [NaN, Infinity, -Infinity, -0, 7]) {
      atState.level++;
      sameBest(probe.bestAlone(atState, pair), original.bestAlone(atState, pair));
      const got = probe.aimOf(atState, goals), expected = original.aimOf(atState, goals);
      sameAim(got, expected, [[numbers, atState]]);
      assert.strictEqual(got.goals, goals);
    }
  }
  atState.level++; calls.length = 0;
  probe.aimOf(atState, pair);
  assert.deepEqual(calls, ['shares', 'banned',
    ...pair.flatMap(one => ['optimise:' + one.id, 'score:' + one.id]),
    ...pair.map(one => 'score:' + one.id)], 'aim reads shares before searching and measuring margins');
  calls.length = 0; probe.aimOf(atState, pair);
  assert.deepEqual(calls, ['shares', 'banned', ...pair.map(one => 'score:' + one.id)],
    'a cached aim still remeasures shares and starting scores');
  calls.length = 0;
  assert.ok(Object.is(probe.aimOf(atState, []).of(numbers, atState), Infinity));
  assert.deepEqual(calls, ['shares', 'banned'], 'empty aim keeps its original dependency order');
  calls.length = 0;
  assert.strictEqual(probe.aimOf(atState, [goals[0]]), goals[0]);
  assert.deepEqual(calls, [], 'single goal does not read shares, bans or scores');
  goals = [api.GOALS[3], api.GOALS[2]]; atState.goals = ['unavailable'];
  assert.strictEqual(probe.goalsOf(atState)[0], goals[0], 'fallback reads replacement GOALS');
  atState.goals = ['stat:hp', 'stat:mp'];
  sameList(probe.goalsOf(atState), original.goalsOf(atState));
  sameList(probe.goalsOf(atState), goals);
  // The composite closes over the supplied list and passes evaluation arguments
  // through unchanged, with one goal evaluation at a time in list order.
  const evaluated = [];
  goals = [0, 1].map(i => ({ id: 'probe:' + i, say: 'Probe ' + i, of(n, s) {
    assert.strictEqual(n, numbers); assert.strictEqual(s, atState); evaluated.push(i); return i ? Infinity : NaN;
  } }));
  atState.level++; was = NaN; optimum = Infinity;
  const composite = probe.aimOf(atState, goals);
  assert.ok(Object.is(composite.of(numbers, atState), NaN)); assert.deepEqual(evaluated, [0, 1]);
  console.log('Goal cache: exact non-finite fallbacks, call order, hits, key changes, eviction and live progression.');
}

// Bind each extracted function once, without a per-call adapter allocation.
{
  const theory = require('../web/theory-engine'), original = theory.createGoals;
  let made, constructions = 0;
  theory.createGoals = dependencies => { constructions++; return made = original(dependencies); };
  let api;
  try { api = harness({}, raw, false); }
  finally { theory.createGoals = original; }
  const state = api.fresh('Wizard');
  for (let i = 0; i < 100; i++) assert.strictEqual(api.aimOf(state), api.GOALS[0]);
  for (const name of ['goalsOf', 'bestAlone', 'aimOf']) assert.strictEqual(api[name], made[name]);
  assert.equal(constructions, 1);
}

// One function per factory, no per-score wrapper or result allocation; preserve
// lookup order, references, falsy exits and non-finite callback results.
{
  const theory = require('../web/theory-engine');
  const calls = [], state = { boss: 'boss', against: 40 }, numbers = { total: 7 };
  let result = numbers, expectedDef = 0;
  const catalogue = { byBoss: { get boss() { calls.push('boss'); return { def: 0 }; } } };
  const score = theory.createScore({
    getData() { calls.push('data'); return catalogue; },
    numbersFor(s, def) {
      calls.push('numbers'); assert.strictEqual(s, state);
      assert.ok(Object.is(def, expectedDef)); return result;
    }
  });
  assert.deepStrictEqual(calls, [], 'construction does not read data');
  let value = NaN;
  const goal = { get id() { calls.push('goal'); return 'kill'; }, of(n, s) {
    calls.push('of'); assert.strictEqual(n, numbers); assert.strictEqual(s, state); return value;
  } };
  for (value of [NaN, Infinity, -Infinity, -0, 7]) {
    calls.length = 0;
    assert.ok(Object.is(score(state, goal), value));
    assert.deepStrictEqual(calls, ['data', 'boss', 'goal', 'numbers', 'of']);
  }
  for (result of [null, undefined, false, 0, NaN, '']) {
    calls.length = 0;
    assert.ok(Object.is(score(state, goal), -Infinity));
    assert.deepStrictEqual(calls, ['data', 'boss', 'goal', 'numbers']);
  }
  result = numbers; expectedDef = 40;
  assert.ok(Object.is(score(state, { id: 'dps', of: () => NaN }), NaN));

  const original = theory.createScore;
  let constructions = 0, created;
  theory.createScore = dependencies => { constructions++; return created = original(dependencies); };
  let api;
  try { api = harness({}, raw, false); }
  finally { theory.createScore = original; }
  assert.strictEqual(api.scoreOf, created, 'adapter binds the created function directly');
  const build = api.fresh('Wizard'), dps = api.GOALS.find(one => one.id === 'dps');
  const expected = api.scoreOf(build, dps);
  for (let i = 0; i < 1000; i++) assert.ok(Object.is(api.scoreOf(build, dps), expected));
  assert.strictEqual(api.scoreOf, created, 'repeated calls retain function identity');
  assert.strictEqual(constructions, 1, 'factory is constructed only once');
}

// bec9226/f21eeff/5a4233f: composition now evaluates both hands, regeneration
// and piece damage. Dependencies remain explicit and live, with no eager reads.
{
  const { createNumbers } = require('../web/theory-engine');
  const calls = [], state = { damage: 'all', gear: { weapon: { name: 'w' }, ability: { name: 'a' } } };
  const stats = { now: { att: 50, dex: 75 } }, scale = {}, subs = [];
  const fought = { ...stats, penalty: {} }, regen = { mp: { combat: 7 } }, stand = { d: 0, radius: 1, gap: 0 };
  const effects = { bleed: 1, up: {} }, fx = {}, gun = { each: 10, rate: 5, dps: 100 };
  const weapon = {}, ability = {};
  let current = { byItem: { get w() { calls.push('weapon'); return weapon; },
    get a() { calls.push('ability'); return ability; } } };
  let valid = true, expectedWeapon = weapon;
  const dependencies = {
    getData() { calls.push('data'); return current; },
    statsOf(s) { calls.push('stats'); assert.strictEqual(s, state); return valid ? stats : null; },
    scaleOf(s) { calls.push('scale'); assert.strictEqual(s, state); return scale; },
    fightOf(s, own) { calls.push('fight'); assert.strictEqual(s, state); assert.strictEqual(own, stats); return fought; },
    costOf(s) { calls.push('cost'); assert.strictEqual(s, state); return 0.8; },
    regenOf(own, assume, hot) { calls.push('regen'); assert.strictEqual(own, stats); assert.strictEqual(hot, fought); return regen; },
    wornEffects(s) { calls.push('worn'); assert.strictEqual(s, state); return []; },
    temperOf() { assert.fail('no gains or boosts to evaluate'); },
    standOf(s) { calls.push('stand'); assert.strictEqual(s, state); return stand; },
    effectsFor(s, now, mana, cost) { calls.push('effects'); assert.strictEqual(s, state);
      assert.strictEqual(now, stats.now); assert.equal(mana, 7); assert.equal(cost, 0.8); return effects; },
    fxOf(e) { calls.push('fx'); assert.strictEqual(e, effects); return fx; },
    subOf(s) { calls.push('sub'); assert.strictEqual(s, state); return subs; },
    weaponRate(w, now, def, by, extra, f, aim) {
      calls.push('rate');
      assert.strictEqual(w, expectedWeapon); assert.strictEqual(now, stats.now);
      assert.strictEqual(def, -0); assert.strictEqual(by, scale);
      assert.strictEqual(extra, subs); assert.strictEqual(f, fx); assert.strictEqual(aim, stand);
      return gun;
    },
    abilityRate(a, now, def, f, mana, cost, struck, aim) {
      calls.push('spell'); assert.strictEqual(a, current.byItem.a); assert.strictEqual(now, stats.now);
      assert.strictEqual(def, -0); assert.strictEqual(f, fx); assert.equal(mana, 7); assert.equal(cost, 0.8);
      assert.equal(struck, 10); assert.strictEqual(aim, stand);
      return { each: 20, every: 2, dps: 10 };
    },
    specialsOf(s, now, def, shots, up, casts, aim) {
      calls.push('special'); assert.strictEqual(s, state); assert.strictEqual(now, stats.now);
      assert.strictEqual(def, -0); assert.equal(shots, 5); assert.strictEqual(up, effects.up);
      assert.equal(casts, 0.5); assert.strictEqual(aim, stand);
      return { low: 4, high: 8, list: [], by: { ring: { low: 4, high: 8 } } };
    }
  };
  const calculations = createNumbers(dependencies);
  assert.deepStrictEqual(calls, [], 'construction does not read data or status');
  const first = calculations.numbersFor(state, -0);
  assert.deepStrictEqual(calls, ['stats', 'data', 'weapon', 'data', 'ability', 'scale', 'fight', 'cost', 'regen',
    'worn', 'effects', 'fx', 'stand', 'sub', 'rate', 'spell', 'ability', 'special']);
  assert.strictEqual(first.stats, stats); assert.strictEqual(first.fought, fought); assert.strictEqual(first.gun, gun);
  assert.strictEqual(first.effects, effects); assert.strictEqual(first.regen, regen);
  assert.deepStrictEqual(Object.keys(first), ['stats', 'fought', 'gun', 'spell', 'effects', 'bleed', 'regen', 'special', 'temper', 'parts', 'total', 'chosen']);
  assert.equal(first.total, 101); assert.equal(first.chosen, 115); assert.equal(first.parts.all.high, 119);
  calls.length = 0;
  current = { byItem: { w: expectedWeapon = {} } };
  const second = calculations.numbersFor(state, -0);
  assert.notStrictEqual(second.spell, first.spell, 'ability is evaluated on every request');
  assert.notStrictEqual(second, first, 'the composite result remains fresh');
  calls.length = 0; valid = false;
  assert.strictEqual(calculations.numbersFor(state, -0), null);
  assert.deepStrictEqual(calls, ['stats'], 'unknown class exits before catalogue or status access');
}

const portraitHelpers = (() => {
  const file = path.join(root, 'web/theorycraft.js');
  const marker = 'return { start, share, open, put };';
  const script = fs.readFileSync(file, 'utf8').replace(marker,
    'return { facePortrait, faceStyle };');
  const context = { window: {}, module: { exports: {} }, console,
    TheoryEngine: require('../web/theory-engine'),
    BuildProgression: require('../web/progression') };
  vm.runInNewContext(script, context, { filename: file });
  return context.module.exports;
})();
const iconHelpers = (() => {
  const file = path.join(root, 'web/theorycraft.js');
  const marker = 'return { start, share, open, put };';
  const script = fs.readFileSync(file, 'utf8').replace(marker,
    'return { itemIcon, indexIcon, gradeOf, setIconTestData: v => { data = v; } };');
  const context = { window: {}, module: { exports: {} }, console,
    TheoryEngine: require('../web/theory-engine'),
    BuildProgression: require('../web/progression') };
  vm.runInNewContext(script, context, { filename: file });
  return context.module.exports;
})();
const targetHelpers = (() => {
  const file = path.join(root, 'web/theorycraft.js');
  const marker = 'return { start, share, open, put };';
  const script = fs.readFileSync(file, 'utf8').replace(marker,
    'return { targetBounds, targetFit, sheetIcon, setTargetTestData: v => { data = v; } };');
  const context = { window: {}, module: { exports: {} }, console,
    TheoryEngine: require('../web/theory-engine'),
    BuildProgression: require('../web/progression') };
  vm.runInNewContext(script, context, { filename: file });
  return context.module.exports;
})();

/*
 * Static class portraits show the leading square of the standing frame.
 * Wide source frames must retain their source stride while exposing only the
 * body-width window; centring the crop would select different pixels.
 */
{
  const checks = {
    Archer: {
      backgroundPosition: '-4830px -4089.75px',
      backgroundSize: '5376px 4504.5px'
    },
    Assassin: {
      backgroundPosition: '-1008px -4131.75px',
      backgroundSize: '5376px 4504.5px'
    },
    Bard: {
      backgroundPosition: '-2016px -4131.75px',
      backgroundSize: '5376px 4504.5px'
    }
  };

  for (const [name, expected] of Object.entries(checks)) {
    const kind = raw.classes.find(one => one.name === name);
    const portrait = portraitHelpers.facePortrait(kind, raw.sheet);
    const style = portraitHelpers.faceStyle(portrait, raw.sheet);
    assert(portrait, `${name} needs a static class portrait`);
    assert.equal(style.width, '42px');
    assert.equal(style.height, '42px');
    assert.equal(style.backgroundPosition, expected.backgroundPosition);
    assert.equal(style.backgroundSize, expected.backgroundSize);
  }

  for (const kind of raw.classes) {
    const piece = raw.sheet.pics[kind.pic];
    const portrait = portraitHelpers.facePortrait(kind, raw.sheet);
    const style = portraitHelpers.faceStyle(portrait, raw.sheet);
    const stand = (piece.poses['3/0'] || piece.poses['0/0'] || [0])[0];

    assert(portrait, `${kind.name} needs a static class portrait`);
    assert.equal(portrait.bodyW, Math.min(piece.w, piece.h),
      `${kind.name} portrait window must be square`);
    assert.equal(portrait.zoom, 42 / piece.h,
      `${kind.name} portrait zoom must use source height`);
    assert.equal(portrait.pad, 0,
      `${kind.name} portrait must begin at the frame leading edge`);
    assert.equal(portrait.x, piece.x + stand * piece.w,
      `${kind.name} portrait must use the full frame stride`);
    assert.equal(style.backgroundPosition,
      (-(piece.x + stand * piece.w) * (42 / piece.h)) + 'px '
      + (-piece.y * (42 / piece.h)) + 'px',
      `${kind.name} portrait must not apply a centred horizontal offset`);
  }
}

for (const klass of raw.classes) {
  t.use(t.fresh(klass.name));
  const names = new Set(t.itemsFor('ring', klass.name).map(r => r.name));
  for (const suffix of ['Nile', 'Pyramid', 'Sphinx']) assert(names.has('Venerable Ring of the ' + suffix), klass.name + ' picker is missing ' + suffix);
}
assert.throws(() => t.enchantsFor(raw.items[0].name, [], 0), /Enchanting rules are unavailable/);

const read = (...parts) => fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
const sources = {
  clientModText: read('Enchantment documents', 'client-enchantments.txt'),
  clientItemText: read('Items', 'client-items.txt'),
  clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt')
};
const shared = engine.buildDataset(sources);
const ruled = harness(sources, raw, true);
const theoryItems = new Set(raw.items.map(item => item.name));
const choose = predicate => [...shared.itemsByName.values()].find(item => theoryItems.has(item.name) && predicate(item));
const samples = [
  ['ordinary', choose(item => item.type && !item.base && !shared.awakenings.has(item.name))],
  ['Awakened', choose(item => item.type && shared.awakenings.has(item.name))],
  ['Alien', choose(item => item.type && item.base === 'ALIEN')],
  ['Neo Alien', choose(item => item.type && item.base === 'NEO_ALIEN')]
];

// Frozen enchantment implementation from ffba5e4, including spelling and ranking helpers.
{
  function legacy(getData, rulesFor, EnchantEngine) {
    const OF_HAND = { weapon: 'WEAPON', ability: 'ABILITY', armor: 'ARMOR', ring: 'RING' };
    const NUMERAL = /\s+(?:[IVX]+|\d+)$/;
    const plainly = name => String(name).replace(NUMERAL, '').trim().toLowerCase();

    const ENCHANT_NAME_ALIASES = new Map([
      ['mana -attacktradeoff', 'mana -attack tradeoff'],
      ['pirates expertise', "pirate's expertise"],
      ['vampric lifeforce', 'vampiric lifeforce']
    ]);

    const enchantKey = name => {
      const bare = plainly(name);
      return ENCHANT_NAME_ALIASES.get(bare) || bare;
    };
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
    const charmByQuery = new Map();
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
    function locksOn(held, already, at) {
      const out = [];
      (already || []).forEach((id, i) => {
        if (i === at || !id) return;
        const one = getData().byEnch[id];
        if (!one) return;
        const bare = enchantKey(one.name);
        for (const name of [one.name, one.name.replace(NUMERAL, '').trim()]) {
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

    function rollableEnchantsFor(itemName, already, at) {
      const item = getData().byItem[itemName];
      if (!item) return [];
      const held = rulesFor();
      if (held) {
        const locks = locksOn(held, already, at);
        const cfg = {
          item: itemName,
          type: OF_HAND[item.hand] || 'WEAPON',
          slots: (already || []).length || 4,
          locks,
          subtypes: EnchantEngine.subtypesForItem(held, itemName)
        };
        return EnchantEngine.obtainablePool(held, cfg);
      }

      throw new Error('Enchanting rules are unavailable. Reload the page before planning a build.');
    }

    function enchantsFor(itemName, already, at) {
      const pool = rollableEnchantsFor(itemName, already, at);
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

    function enchantFitsItem(itemName, already, at) {
      const wanted = already[at];
      return rollableEnchantsFor(itemName, already, at).some(mod => {
        const mine = charmNamed(mod.name);
        return (mine ? mine.id : 'n:' + mod.name) === wanted;
      });
    }
    return { charmNamed, locksOn, rollableEnchantsFor, enchantsFor, enchantFitsItem };
  }
  const { createEnchants } = require('../web/theory-engine');
  const api = harness(sources, raw);
  let data = { ...raw };
  api.configure(data); api.setRules(shared);
  let held = shared;
  const dependencies = {
    getData: () => data, rulesFor: () => held, getEngine: () => engine,
    plainly: api.plainly, enchantKey: api.enchantKey, worth: api.worth,
    numeral: api.NUMERAL,
    ofHand: { weapon: 'WEAPON', ability: 'ABILITY', armor: 'ARMOR', ring: 'RING' }
  };
  const factory = createEnchants(dependencies);
  const old = legacy(() => data, () => held, engine);
  function exact(got, expected) {
    if (expected === null || typeof expected !== 'object') {
      assert.ok(Object.is(got, expected), 'exact primitive parity'); return;
    }
    assert.deepEqual(Object.keys(got), Object.keys(expected), 'property and element order');
    for (const key of Object.keys(expected)) exact(got[key], expected[key]);
  }
  const queries = [...raw.enchants.flatMap(one => [one.name,
    one.name.replace(/\s+(?:[IVX]+|\d+)$/, ''), one.name.toUpperCase()]),
    ...shared.enchants.map(one => one.name), 'unknown enchantment', '',
    'Mana -AttackTradeoff IV', 'Pirates Expertise', "Pirate's Expertise", 'Vampric Lifeforce'];
  for (const name of queries) {
    const expected = old.charmNamed(name);
    assert.ok(Object.is(factory.charmNamed(name), expected), 'factory charm reference: ' + name);
    assert.ok(Object.is(api.charmNamed(name), expected), 'adapter charm reference: ' + name);
  }
  // Several classes and all four hands, plus each special client pool family.
  const items = new Set();
  for (const klass of ['Wizard', 'Archer', 'Warrior', 'Necromancer', 'Ninja']) {
    for (const hand of ['weapon', 'ability', 'armor', 'ring']) {
      const item = api.compatibleItemsFor(hand, klass, {}).find(one =>
        old.rollableEnchantsFor(one.name, [], 0).length);
      assert.ok(item, klass + '/' + hand + ' has a rollable sample');
      items.add(item.name);
    }
  }
  for (const [, item] of samples) items.add(item.name);
  items.add('unknown item');
  let compared = 0, fits = 0, misses = 0;
  for (const itemName of items) {
    const pool = old.enchantsFor(itemName, [], 0);
    const ids = pool.slice(0, 4).map(one => one.id);
    const scenarios = [undefined, null, [], [null, '', null, null],
      [ids[0], null, 'unknown id', ''], ids, ['unknown id'], [null, ...ids]];
    for (const already of scenarios) {
      for (const at of [-1, 0, 1, 4, 99]) {
        for (const name of ['locksOn', 'rollableEnchantsFor', 'enchantsFor', 'enchantFitsItem']) {
          const args = name === 'locksOn' ? [held, already, at]
            : [itemName, name === 'enchantFitsItem' ? already || [] : already, at];
          const expected = old[name](...args);
          const got = factory[name](...args);
          const adapted = api[name](...args);
          exact(got, expected); exact(adapted, expected);
          if (name === 'rollableEnchantsFor') {
            for (const result of [got, adapted]) result.forEach((one, i) =>
              assert.ok(Object.is(one, expected[i]), 'engine pool references'));
          }
          if (name === 'enchantFitsItem') expected ? fits++ : misses++;
          compared++;
        }
      }
    }
    const first = factory.enchantsFor(itemName, [], 0);
    const next = factory.enchantsFor(itemName, [], 0);
    first.forEach((one, i) => {
      assert.notEqual(one, next[i], 'each choice is a new object');
      const mine = factory.charmNamed(one.name);
      if (mine) {
        assert.notEqual(one, mine, 'the charm is copied');
        for (const key of Object.keys(mine).filter(key => key !== 'name' && key !== 'roll')) {
          assert.ok(Object.is(one[key], mine[key]), 'shallow charm member references: ' + key);
        }
      }
    });
  }
  assert.ok(fits > 0 && misses > 0, 'both fit outcomes are exercised');
  // Each translation branch, first-match ordering, ignored ids and excluded slot.
  for (const one of raw.enchants) {
    const bare = one.name.replace(api.NUMERAL, '').trim();
    const canonical = shared.enchants.find(mod => api.enchantKey(mod.name) === api.enchantKey(one.name));
    const maps = [shared.byName, new Map([[one.name, one], [bare, one]]),
      new Map([[bare, one]]), canonical && new Map([[canonical.name.toUpperCase(), canonical],
        [canonical.name.toLowerCase(), canonical]]), undefined].filter(value => value !== false);
    for (const byName of maps) {
      const rules = { byName };
      for (const at of [0, 1, -1]) {
        const args = [rules, [one.id, one.id, '', null, 'unknown id'], at];
        exact(factory.locksOn(...args), old.locksOn(...args));
        exact(api.locksOn(...args), old.locksOn(...args));
      }
    }
  }
  // Missing rules are checked after item lookup, at every call, with the exact message.
  const unavailable = 'Enchanting rules are unavailable. Reload the page before planning a build.';
  const known = [...items][0];
  for (const missing of [false, null, undefined]) {
    held = missing;
    const missingApi = harness({}, raw, false);
    missingApi.configure(data); missingApi.setRules(missing);
    for (const target of [factory, missingApi, old]) {
      for (const name of ['rollableEnchantsFor', 'enchantsFor', 'enchantFitsItem']) {
        assert.throws(() => target[name](known, [], 0), error => error.message === unavailable);
        exact(target[name]('unknown item', [], 0), name === 'enchantFitsItem' ? false : []);
      }
    }
  }
  held = { ...shared, byName: new Map(shared.byName) }; api.setRules(held);
  exact(factory.enchantsFor(known, [], 0), old.enchantsFor(known, [], 0));
  exact(api.enchantsFor(known, [], 0), old.enchantsFor(known, [], 0));

  // Replacement preserves both existing name caches, but item/id lookups stay live.
  const remembered = factory.charmNamed(raw.enchants[0].name);
  const newCharm = { id: 'new charm', name: 'New Charm IV', worn: { ATT: 50 } };
  data = { ...raw, items: [], enchants: [newCharm] };
  api.configure(data);
  for (const target of [factory, api, old]) {
    assert.ok(Object.is(target.charmNamed(raw.enchants[0].name), remembered));
    assert.equal(target.charmNamed(newCharm.name), undefined, 'configure does not invalidate name caches');
    exact(target.rollableEnchantsFor(known, [], 0), []);
    exact(target.locksOn({ byName: new Map([['New Charm', newCharm]]) }, [newCharm.id], -1), ['New Charm']);
    exact(target.locksOn(shared, [remembered.id], -1), []);
  }
  const lazyApi = harness(sources, raw);
  lazyApi.configure(data);
  assert.ok(Object.is(lazyApi.charmNamed('New Charm'), newCharm), 'configure before first demand is live');
  const lazyFactory = createEnchants(dependencies);
  data = { ...data, enchants: [remembered] };
  assert.ok(Object.is(lazyFactory.charmNamed(remembered.name), remembered));

  // Observe the actual Maps: a cached undefined remains present and returns before helpers.
  const maps = [];
  class ObservedMap extends Map { constructor(...args) { super(...args); maps.push(this); } }
  const context = { module: { exports: {} }, Map: ObservedMap };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'web/theory-engine.js'), 'utf8'), context);
  let reads = 0, calls = 0;
  const fixture = { get enchants() { reads++; return raw.enchants; },
    byEnch: { [remembered.id]: remembered }, byItem: { [known]: { hand: 'weapon' } } };
  const observed = context.module.exports.createEnchants({ ...dependencies, getData: () => fixture,
    plainly(name) { calls++; return api.plainly(name); },
    enchantKey(name) { calls++; return api.enchantKey(name); } });
  assert.equal(reads, 0); assert.equal(maps.length, 1);
  observed.locksOn(shared, [remembered.id], -1);
  observed.rollableEnchantsFor(known, [], 0);
  assert.equal(reads, 0); assert.equal(maps.length, 1, 'locks and pools do not build the name index');
  assert.equal(observed.charmNamed('missing query'), undefined);
  assert.equal(maps.length, 2); assert.equal(reads, 1);
  assert.ok(maps[0].has('missing query')); assert.equal(maps[0].get('missing query'), undefined);
  const before = calls;
  assert.equal(observed.charmNamed('missing query'), undefined);
  assert.equal(calls, before, 'negative cache bypasses all name helpers');
  for (const name of queries) observed.charmNamed(name);
  assert.equal(reads, 1); assert.equal(maps.length, 2, 'both Maps are constructed once');

  // Preserve lookup timing, including per-id catalogue reads and absent-item short circuits.
  function probe(create) {
    const trace = [];
    const liveData = {
      get byItem() { trace.push('item'); return { [known]: { hand: 'weapon' } }; },
      get byEnch() { trace.push('enchant'); return { [remembered.id]: remembered }; }
    };
    const pool = [], subtypes = new Set();
    const injectedEngine = {
      subtypesForItem() { trace.push('subtypes'); return subtypes; },
      obtainablePool() { trace.push('pool'); return pool; }
    };
    const rulesFor = () => { trace.push('rules'); return shared; };
    const getData = () => { trace.push('data'); return liveData; };
    const target = create({ ...dependencies, getData, rulesFor, getEngine: () => injectedEngine });
    assert.equal(target.rollableEnchantsFor(known,
      [remembered.id, null, 'unknown id', remembered.id], 0), pool);
    assert.deepEqual(trace, ['data', 'item', 'rules', 'data', 'enchant', 'data', 'enchant', 'subtypes', 'pool']);
    trace.length = 0;
    exact(target.rollableEnchantsFor('unknown item', [], 0), []);
    assert.deepEqual(trace, ['data', 'item']);
  }
  probe(deps => legacy(deps.getData, deps.rulesFor, deps.getEngine())); probe(createEnchants);

  // Ties keep the first charm; an exact tier takes precedence over stronger bare matches.
  const ties = [{ id: 'first', name: 'Tie I', worn: { ATT: 1 } },
    { id: 'second', name: 'Tie II', worn: { ATT: 1 } },
    { id: 'strong', name: 'Tie III', worn: { ATT: 2 } }];
  const tieFactory = createEnchants({ ...dependencies, getData: () => ({ enchants: ties.slice(0, 2) }) });
  assert.equal(tieFactory.charmNamed('Tie'), ties[0]);
  const ranked = createEnchants({ ...dependencies, getData: () => ({ enchants: ties }) });
  assert.equal(ranked.charmNamed('Tie I'), ties[0]); assert.equal(ranked.charmNamed('Tie'), ties[2]);

  // Duplicate engine names keep the first weight. Synthetic ids and shared charm fields survive.
  const mod = shared.enchants.find(one => old.charmNamed(one.name));
  const synthetic = { ...mod, name: 'No Client Charm', weight: -0 };
  const pool = [mod, { ...mod, weight: 999 }, synthetic, { ...synthetic, weight: 1 }];
  let cfg, subtypeRules, poolRules;
  const subtypes = new Set(['fixture']);
  const injected = {
    subtypesForItem(rules, item) { subtypeRules = rules; assert.equal(item, known); return subtypes; },
    obtainablePool(rules, config) { poolRules = rules; cfg = config; return pool; }
  };
  const snapshot = { ...raw, byItem: { [known]: { hand: 'unknown hand' } } };
  const injectedDeps = { ...dependencies, getData: () => snapshot, getEngine: () => injected, rulesFor: () => shared };
  const duplicate = createEnchants(injectedDeps);
  const expected = legacy(() => snapshot, () => shared, injected).enchantsFor(known, [], 0);
  exact(duplicate.enchantsFor(known, [], 0), expected);
  assert.equal(expected.length, 2); assert.ok(Object.is(expected[1].roll, -0));
  assert.deepEqual(Object.keys(expected[1]), ['roll', 'id', 'name']);
  assert.deepEqual(Object.keys(cfg), ['item', 'type', 'slots', 'locks', 'subtypes']);
  assert.equal(cfg.type, 'WEAPON'); assert.equal(cfg.slots, 4); assert.equal(cfg.subtypes, subtypes);
  assert.equal(subtypeRules, shared); assert.equal(poolRules, shared);
  duplicate.rollableEnchantsFor(known, [null], -1); assert.equal(cfg.slots, 1);
  assert.equal(duplicate.enchantFitsItem(known, ['n:No Client Charm'], 0), true);
  assert.equal(duplicate.enchantFitsItem(known, ['n:wrong'], 0), false);
  console.log('Enchantments: ' + queries.length + ' charm queries and ' + compared
    + ' exact legacy comparisons, references, negative caches and live lookups.');
}

// TheoryCraft projects a tiered enchantment to the strongest concrete tier
// (for example "Attack Bonus IV"), while EnchantEngine exposes the player-facing
// family name ("Attack Bonus"). Compare the rule identity, not that presentation.
const ruleName = name => String(name).replace(/\s+(?:[IVX]+|\d+)$/, '').trim().toLowerCase();

for (const [label, item] of samples) {
  assert(item, `No ${label} item is shared by the client catalogue and TheoryCraft projection`);
  const cfg = { item: item.name, type: item.type, slots: 4, locks: [],
    subtypes: engine.subtypesForItem(shared, item.name) };
  const expected = engine.obtainablePool(shared, cfg).map(mod => ruleName(mod.name)).sort();
  const actual = [...ruled.enchantsFor(item.name, [], 0)].map(mod => ruleName(mod.name)).sort();
  assert.equal(actual.length, expected.length,
    `${label} TheoryCraft pool size diverges from EnchantEngine for ${item.name}`);
  assert.deepStrictEqual(actual, expected,
    `${label} TheoryCraft rule identities diverge from EnchantEngine for ${item.name}`);
}


/*
 * A build that cannot deal damage must never beat a build that can kill.
 * Kill scores are negative elapsed seconds, so zero DPS must be -Infinity,
 * not zero.
 */
{
  const zero = ruled.fresh('Archer');
  zero.gear.weapon = {
    name: null,
    slots: 4,
    ench: [null, null, null, null]
  };

  const kill = ruled.GOALS.find(one => one.id === 'kill');
  assert(kill, 'Kill it fast goal is missing');

  assert.equal(
    ruled.scoreOf(zero, kill),
    -Infinity,
    'zero DPS must be the worst possible Kill it fast score'
  );
}


/*
 * Frangible Longbow is built from Subattack channels. Projectile 0 is
 * invisible zero-damage machinery; the three real channels all use
 * projectile 1 and must remain separate because their rates differ.
 */
{
  const frangible = raw.items.find(one => one.name === 'Frangible Longbow');

  assert(frangible, 'Frangible Longbow is missing from TheoryCraft');

  assert.equal(
    frangible.shots.length,
    3,
    'Frangible Longbow must expose its three offensive Subattack channels'
  );

  for (const shot of frangible.shots) {
    assert.equal(shot.low, 105);
    assert.equal(shot.high, 125);
    assert.equal(shot.projectile, '1');
    assert.equal(shot.subattack, true);
  }

  assert.deepStrictEqual(
    frangible.shots.map(one => one.rate).sort(),
    [0.92, 0.96, 1],
    'Frangible Longbow must preserve the three Subattack rates'
  );
}


/*
 * A multi-channel Subattack weapon cannot be judged by shots[0] alone.
 * It must stay available to the real optimiser rather than being removed by
 * the simple dominated-gear prefilter.
 */
{
  const beaten = ruled.beatenOnes();

  assert(
    !beaten.gear.has('Frangible Longbow'),
    'Frangible Longbow must not be pruned as dominated gear'
  );
}

console.log('All class pickers include the three Venerable rings; shared enchant pools match TheoryCraft for ordinary, Awakened, Alien and Neo Alien items; missing rules fail explicitly.');

/*
 * Regression: the shared enchanting engine exposes the corrected public
 * spelling "Vampiric Lifeforce", while the raw client record historically
 * says "Vampric Lifeforce". Picking it must resolve to the real TheoryCraft
 * enchantment rather than the synthetic n:<name> fallback.
 */
{
  const pickerSources = {
    clientModText: fs.readFileSync(
      path.join(root, 'data/Enchantment documents/client-enchantments.txt'),
      'utf8'
    ),
    clientItemText: fs.readFileSync(
      path.join(root, 'data/Items/client-items.txt'),
      'utf8'
    ),
    clientArtifactText: fs.readFileSync(
      path.join(root, 'data/Artifacts/client-artifacts.txt'),
      'utf8'
    ),
    awakenText: fs.readFileSync(
      path.join(root, 'data/Awakened Items/awakenedItems.txt'),
      'utf8'
    )
  };

  const pickerTheory = harness(pickerSources, raw, true);
  const pool = pickerTheory.enchantsFor(
    'Candy-Coated Armor',
    [null, null, null, null],
    0
  );

  const vamp = pool.find(one =>
    /vampiric|vampric/i.test(String(one.name || ''))
  );

  assert(vamp, 'Candy-Coated Armor picker is missing Vampiric Lifeforce');
  assert.equal(
    vamp.id,
    'VAMPRIC_LIFEFORCE',
    'TheoryCraft resolves Vampiric Lifeforce to the real client enchantment ID'
  );
  assert.equal(
    vamp.name,
    'Vampiric Lifeforce',
    'TheoryCraft preserves the canonical EnchantEngine spelling in the picker'
  );
  assert(
    !String(vamp.id).startsWith('n:'),
    'Vampiric Lifeforce must never fall back to a synthetic TheoryCraft ID'
  );
}


/*
 * Regression: BurstDelay/BurstMinDelay is the burst start-to-start cooldown,
 * not an extra pause added after consuming the burst shots.
 *
 * Frangible has three offensive channels of four shots. At 75 DEX their
 * firing runs finish before the 0.8 s minimum burst cooldown, so the whole
 * burst repeats every 0.8 s.
 */
{
  const frangible = raw.items.find(
    one => one.name === 'Frangible Longbow'
  );

  assert(
    frangible,
    'Frangible Longbow is missing from TheoryCraft'
  );

  const result = ruled.weaponRate(
    frangible,
    { att: 75, dex: 75 },
    75,
    { dmg: 1, rate: 1, life: 1, fast: 1 },
    []
  );

  assert(
    Math.abs(result.burst.every - 0.8) < 1e-9,
    'Frangible burst cadence must use the cooldown from burst start'
  );

  assert(
    Math.abs(result.dps - 2325) < 1e-9,
    'Frangible must deal 2325 DPS at 75 ATT / 75 DEX / 75 DEF'
  );
}

/*
 * Synthetic guard for the burst formula itself.
 *
 * 100 damage, 75 DEX => 8 attacks/s. Four attacks take 0.5 s, while the
 * minimum burst cooldown is 0.8 s. The next burst therefore starts at 0.8 s,
 * not 1.3 s.
 */
{
  const item = {
    rate: 1,
    many: 1,
    burst: {
      many: 4,
      wait: 1.8,
      rush: 0.8
    },
    shots: [{
      low: 100,
      high: 100
    }]
  };

  const result = ruled.weaponRate(
    item,
    { att: 25, dex: 75 },
    0,
    { dmg: 1, rate: 1, life: 1, fast: 1 },
    []
  );

  assert(
    Math.abs(result.burst.every - 0.8) < 1e-9,
    'burst cycle must be max(firing run, cooldown)'
  );

  assert(
    Math.abs(result.dps - 500) < 1e-9,
    'four 100-damage shots every 0.8 s must equal 500 DPS'
  );
}


/*
 * Theory search gear-family filters must stay independent.
 *
 * Sets are their own search family even when the individual piece is
 * untiered. Untiered means non-set gear without a tier. Missing flags are
 * the backwards-compatible default: both families included.
 */
{
  const hands = [
    'weapon',
    'ability',
    'armor',
    'ring'
  ];

  function findCase(predicate) {
    for (const klass of raw.classes) {
      const state = ruled.fresh(klass.name);

      for (const hand of hands) {
        const list =
          ruled.searchItems(
            hand,
            klass.name,
            state
          );

        const item =
          list.find(predicate);

        if (item) {
          return {
            state,
            klass: klass.name,
            hand,
            item
          };
        }
      }
    }

    return null;
  }

  const setCase =
    findCase(one => !!one.set);

  assert(
    setCase,
    'TheoryCraft needs at least one searchable set item for the filter regression'
  );

  setCase.state.searchSets = false;

  assert(
    !ruled.searchItems(
      setCase.hand,
      setCase.klass,
      setCase.state
    ).some(one => one.set),
    'disabling Sets must remove every set item from optimizer candidates'
  );

  setCase.state.searchSets = true;
  setCase.state.searchUntiered = false;

  assert(
    ruled.searchItems(
      setCase.hand,
      setCase.klass,
      setCase.state
    ).some(one => one.name === setCase.item.name),
    'Sets must remain available when only Untiered is disabled'
  );


  const untieredCase =
    findCase(one =>
      !one.set &&
      one.tier === undefined
    );

  assert(
    untieredCase,
    'TheoryCraft needs at least one searchable non-set untiered item for the filter regression'
  );

  untieredCase.state.searchUntiered = false;

  assert(
    !ruled.searchItems(
      untieredCase.hand,
      untieredCase.klass,
      untieredCase.state
    ).some(one =>
      !one.set &&
      one.tier === undefined
    ),
    'disabling Untiered must remove non-set untiered optimizer candidates'
  );

  untieredCase.state.searchUntiered = true;
  untieredCase.state.searchSets = false;

  assert(
    ruled.searchItems(
      untieredCase.hand,
      untieredCase.klass,
      untieredCase.state
    ).some(one =>
      one.name === untieredCase.item.name
    ),
    'Untiered must remain available when only Sets is disabled'
  );


  const legacy =
    ruled.fresh(untieredCase.klass);

  delete legacy.searchSets;
  delete legacy.searchUntiered;

  assert(
    ruled.searchItems(
      untieredCase.hand,
      untieredCase.klass,
      legacy
    ).some(one =>
      one.name === untieredCase.item.name
    ),
    'missing search filter flags must mean included for old saved builds'
  );
}


/*
 * Regression: the gear frame (`.tc-icon-big`, fixed size, border, grade
 * class) must stay a separate outer element from the index-sheet sprite it
 * holds. They used to be the same span - itemIcon's inline width/height/
 * background-position sat directly on `.tc-icon-big` - so a sprite narrower
 * or taller than its bounding box shrank the frame itself instead of just
 * being a smaller picture inside a frame that stayed put.
 *
 * Every item icon actually cut from the index in this fixture is an 8x8 or
 * 16x16 square (the client draws one inventory tile per item), so there is
 * no naturally occurring non-square item to source narrow/wide/tall cases
 * from. The shape cases below reuse a real sheet anchor position from an
 * actual item icon and vary only width/height, to prove the frame/sprite
 * split - and the shared coordinate math - holds for any aspect ratio.
 */
{
  const anchorItem = raw.items.find(one => one.icon);
  assert(anchorItem, 'TheoryCraft fixture needs at least one item with an index icon');
  const [ax, ay] = anchorItem.icon;

  const byItem = {};
  for (const one of raw.items) byItem[one.name] = one;

  const shapes = {
    square: anchorItem.icon,
    wide: [ax, ay, 34, 10],
    tall: [ax, ay, 10, 34],
    narrow: [ax, ay, 6, 34]
  };

  for (const [shape, icon] of Object.entries(shapes)) {
    const name = 'Gear Fit Test — ' + shape;
    byItem[name] = { name, icon };
    iconHelpers.setIconTestData({ byItem, iconSheet: raw.iconSheet });

    const html = iconHelpers.itemIcon(name);
    const inner = iconHelpers.indexIcon(icon, 34, '');
    const [, , w, h] = icon;
    const zoom = 34 / Math.max(w, h);

    assert.equal(
      html,
      '<span class="tc-icon-big ">' + inner + '</span>',
      `${shape} icon must be a fixed outer frame wrapping the sized sprite, nothing more`
    );

    const openTag = html.match(/^<span[^>]*>/)[0];
    assert(
      !openTag.includes('style='),
      `${shape} icon frame must own no inline coordinates - only the inner sprite is positioned`
    );

    assert(
      inner.includes('width:' + (w * zoom) + 'px;height:' + (h * zoom) + 'px'),
      `${shape} icon sprite must keep the source aspect ratio when fit to the 34px side`
    );
    assert(
      inner.includes('background-position:' + (-ax * zoom) + 'px ' + (-ay * zoom) + 'px'),
      `${shape} icon sprite must keep its sheet coordinates unchanged`
    );
  }

  // The real production path: an actual item's icon, end to end.
  iconHelpers.setIconTestData({ byItem, iconSheet: raw.iconSheet });
  const grade = iconHelpers.gradeOf(anchorItem.name);
  const html = iconHelpers.itemIcon(anchorItem.name);
  assert.equal(
    html,
    '<span class="tc-icon-big ' + grade + '">'
      + iconHelpers.indexIcon(anchorItem.icon, 34, '') + '</span>',
    'a real item must render as the fixed grade-bordered frame wrapping its sheet sprite'
  );
}

/*
 * What a target draws, and how that fits the room it is given.
 *
 * A target's rectangle carries the reach of its swing, so a wide, mostly
 * empty cell used to shrink the creature inside it. The generator measures
 * the pixels once and writes the window beside the rectangle; nothing about
 * the packing moves, and the frames still step by the full declared width.
 */
{
  const { visibleBounds, cellAlphaBounds } = require('../tools/theory-sprites');

  // A filled rectangle of alpha, painted straight into a synthetic buffer.
  const paint = (width, height, rects) => {
    const buf = Buffer.alloc(width * height * 4);
    for (const r of rects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) buf[(y * width + x) * 4 + 3] = 255;
      }
    }
    return buf;
  };

  // 1. A fully filled cell measures as the whole cell.
  {
    const buf = paint(16, 16, [{ x: 0, y: 0, w: 16, h: 16 }]);
    assert.deepEqual(cellAlphaBounds(buf, 16, { x: 0, y: 0, w: 16, h: 16 }),
      { x: 0, y: 0, w: 16, h: 16 }, 'a full cell must measure as its own rectangle');
  }

  // 2 and 3. A small drawing inside a wide, mostly transparent cell measures
  // as the drawing, and keeps where it sits in the cell.
  {
    const buf = paint(64, 14, [{ x: 25, y: 0, w: 14, h: 14 }]);
    assert.deepEqual(cellAlphaBounds(buf, 64, { x: 0, y: 0, w: 64, h: 14 }),
      { x: 25, y: 0, w: 14, h: 14 }, 'a padded cell must measure its drawing, not its padding');
    const off = paint(64, 14, [{ x: 2, y: 3, w: 8, h: 6 }]);
    assert.deepEqual(cellAlphaBounds(off, 64, { x: 0, y: 0, w: 64, h: 14 }),
      { x: 2, y: 3, w: 8, h: 6 }, 'an off-centre drawing must keep its place in the cell');
  }

  // 4, 5. The run is measured as one union: every frame counts, and a blank
  // frame in the middle of a run must not throw the union away.
  {
    const stride = 32;
    const wide = stride * 3;
    const buf = paint(wide, 32, [
      { x: 4, y: 4, w: 10, h: 10 },
      { x: stride + 8, y: 2, w: 6, h: 6 },
      { x: stride * 2 + 1, y: 20, w: 5, h: 5 }
    ]);
    const cells = [0, 1, 2].map(i => ({ x: i * stride, y: 0, w: stride, h: 32 }));
    assert.deepEqual(visibleBounds(buf, wide, cells),
      { x: 1, y: 2, w: 13, h: 23 },
      'the union must span every frame of the run, in cell-relative coordinates');
    const holed = [0, 1, 2].map(i => ({ x: i * stride, y: 0, w: stride, h: 32 }));
    const withBlank = paint(wide, 32, [
      { x: 4, y: 4, w: 10, h: 10 },
      { x: stride * 2 + 6, y: 6, w: 4, h: 4 }
    ]);
    assert.deepEqual(visibleBounds(withBlank, wide, holed),
      { x: 4, y: 4, w: 10, h: 10 },
      'a blank frame must not destroy the union of the frames that do draw');
  }

  // 6. A piece that draws nothing falls back to its cell, and must not throw.
  {
    const empty = Buffer.alloc(64 * 14 * 4);
    assert.equal(cellAlphaBounds(empty, 64, { x: 0, y: 0, w: 64, h: 14 }), null,
      'a transparent cell has no drawing to measure');
    assert.equal(visibleBounds(empty, 64, [{ x: 0, y: 0, w: 64, h: 14 }]), null,
      'a transparent run must report nothing rather than a broken rectangle');
  }

  // Fitting: the room goes to the longest side of what is drawn.
  const { targetBounds, targetFit, sheetIcon } = targetHelpers;
  {
    const cell = { x: 0, y: 0, w: 64, h: 14 };
    const target = Object.assign({}, cell, { visible: { x: 27, y: 0, w: 14, h: 14 } });
    const fit = targetFit(target, 34);
    assert.equal(fit.width, 34, 'a square drawing must fill the room across');
    assert.equal(fit.height, 34, 'a square drawing must fill the room down');
    const seen = targetBounds(target);
    assert.ok(seen.x === 27 && seen.y === 0 && seen.w === 14 && seen.h === 14,
      'fitting must use the measured window');

    const wide = Object.assign({}, cell, { visible: { x: 0, y: 0, w: 64, h: 14 } });
    const wideFit = targetFit(wide, 34);
    assert.equal(wideFit.width, 34, 'a wide drawing fills the room across');
    assert.ok(wideFit.height < 34 && wideFit.height > 0, 'and keeps its own proportions');
    assert.equal(wideFit.width / wideFit.height, 64 / 14, 'and its own aspect ratio');

    // A piece with no measured window is its own rectangle, exactly as before.
    const plain = { x: 0, y: 0, w: 16, h: 16 };
    const plainSeen = targetBounds(plain);
    assert.ok(plainSeen.x === 0 && plainSeen.y === 0 && plainSeen.w === 16 && plainSeen.h === 16,
      'a piece with no window must keep its rectangle');
    assert.equal(targetFit(plain, 34).width, 34, 'and fit that rectangle as it always did');
  }

  // The picker's window must sit on the drawing inside the cell.
  {
    targetHelpers.setTargetTestData({
      sheet: { wide: 1024, tall: 689, pics: {
        't:padded': { x: 100, y: 50, w: 64, h: 14, frames: 2,
          visible: { x: 27, y: 0, w: 14, h: 14 } }
      } }
    });
    const html = sheetIcon('t:padded', 34);
    const zoom = 34 / 14;
    assert.ok(html.includes('width:34px;height:34px'),
      'a padded target must fill the picker room with the creature, not the cell');
    assert.ok(html.includes('background-position:' + (-(100 + 27) * zoom) + 'px '
      + (-(50 + 0) * zoom) + 'px'),
      'the window must be moved onto the drawing inside the cell');
  }
}

/*
 * The real targets, measured from the shipped sheet metadata.
 */
{
  const pics = raw.sheet.pics;
  const targets = [
    't:SpecPen Soulwarden Murcian',
    't:NMR Boss Veteran',
    't:KSW Factory Control Core',
    't:New Grand Sphinx'
  ];
  let trimmed = 0;
  for (const key of targets) {
    const piece = pics[key];
    assert.ok(piece, key + ' must exist on the theory sheet');
    if (!piece.visible) continue;
    trimmed++;
    const v = piece.visible;
    assert.ok(v.x >= 0 && v.y >= 0 && v.w > 0 && v.h > 0, key + ' must measure a real window');
    assert.ok(v.x + v.w <= piece.w, key + ' must measure inside its own cell across');
    assert.ok(v.y + v.h <= piece.h, key + ' must measure inside its own cell down');
    assert.ok(v.w < piece.w || v.h < piece.h, key + ' must actually trim something');
  }
  assert.ok(trimmed >= 3,
    'the padded targets must carry a measured window rather than the whole cell');

  // The worst offender: a sixty-four wide cell holding a fourteen wide thing.
  const core = pics['t:KSW Factory Control Core'].visible;
  assert.equal(core.w, 14, 'the factory core draws fourteen pixels across, not sixty-four');
  assert.ok(core.x > 0, 'and it sits well inside its cell, which is why it looked tiny');

  // Every window stays inside its cell, on every target on the sheet.
  for (const [key, piece] of Object.entries(pics)) {
    if (!piece.visible) continue;
    const v = piece.visible;
    assert.ok(v.x >= 0 && v.y >= 0 && v.w > 0 && v.h > 0
      && v.x + v.w <= piece.w && v.y + v.h <= piece.h,
    key + ' must have a sane measured window');
  }
}

/*
 * The renderer's own wiring: the frames still step by the declared width, and
 * a target is drawn through its measured window.
 */
{
  const source = fs.readFileSync(path.join(root, 'web/theorycraft.js'), 'utf8');
  assert.ok(/piece\.x \+ frame \* piece\.w \+ box\.bounds\.x/.test(source),
    'the source window must step by the declared cell width and then move onto the drawing');
  assert.ok(!/frame \* box\.bounds\.w|frame \* fit\.bounds\.w/.test(source),
    'the stride must never be the visible width');
  assert.ok(
    /const targetRun = piece \? targetFrames\(piece\) : null/.test(source),
    'the bench must choose the same target animation run as the picker'
  );
  assert.ok(
    /drawPiece\(pen, piece, targetFrame\(piece, duel\.at\), bossX, floor, room, targetRun\)/.test(source),
    'the bench must draw its animated target through that run\'s measured window'
  );
}

/*
 * The layout: who, then what is fought on the left and what fights it on the
 * right. What is guarded is the arrangement a reader relies on - every item
 * keeps its enchantments under it, and the alternative never shows a build
 * the search did not make - not how many pixels any of it is.
 */
{
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const body = page.slice(page.indexOf('<main class="tc-layout" id="tcBody"'), page.indexOf('id="tcPickerWrap"'));
  const order = ['tc-char', 'tc-target', 'tc-main', 'tc-gear-card', 'id="tcAlts"', 'tc-fight', 'tc-optimize']
    .map(token => body.indexOf(token));
  assert.ok(order.every(at => at > 0) && order.every((at, i) => i === 0 || at > order[i - 1]),
    'the theory page must read character, target, then gear (with its alternatives), fight and search');
  for (const id of ['tcClass', 'tcName', 'tcStats', 'tcBosses', 'tcBossSay', 'tcGear', 'tcTakeAll', 'tcDuel', 'tcGoals', 'tcRun'])
    assert.ok(body.includes('id="' + id + '"'), 'the theory layout must keep #' + id);
  const theorySource = fs.readFileSync(path.join(__dirname, '..', 'web', 'theorycraft.js'), 'utf8');
  const slot = theorySource.slice(theorySource.indexOf("return '<div class=\"tc-slot'"), theorySource.indexOf('function drawStats()'));
  assert.ok(slot.indexOf('tc-slot-head') > 0 && slot.indexOf('tc-ench-strip') > slot.indexOf('tc-slot-head'),
    'each slot must draw its enchantments inside itself, under its own item');
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'style.css'), 'utf8');
  assert.ok(/grid-template-areas: "char char" "target main";/.test(css),
    'on a desktop the target must stand left of the gear, under the character band');
  assert.ok(/\.tc-gear-card \.tc-gear \{\s*display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(css),
    'the four slots must stand side by side');
  assert.ok(css.includes('@container (max-width: 759px)') && css.includes('@media (max-width: 900px) {\n  .tc-layout {'),
    'the gear must only fold to two by two in a narrow column, and the target only move above it below 900px');
  assert.ok(/#tcBody \.tc-target \{\s*align-self: stretch; contain: size;/.test(css),
    'the target column must take the height of the column beside it, never set it');
  assert.ok(theorySource.includes('function fitTargets()') && theorySource.includes('new ResizeObserver(() => fitTargets())')
    && !/function fitTargets\(\)[\s\S]{0,2000}requestAnimationFrame/.test(theorySource),
    'the target grid must be fitted to its box on resize only, with no frame loop');
  assert.ok(body.indexOf('id="tcProgress"') > body.indexOf('tc-char') && body.indexOf('id="tcProgress"') < body.indexOf('tc-target'),
    'the progression switch must stand in the character band');
  const foot = body.slice(body.indexOf('class="tc-gear-foot"'), body.indexOf('id="tcTakeAll"'));
  assert.ok(foot.includes('id="tcAlts"') && /id="tcAlts"[^>]*hidden/.test(foot),
    "the alternatives live on the gear's last line, hidden until there are some");
  assert.ok(theorySource.includes("'<span class=\"tc-alts-label\"") && theorySource.includes('list.map((one, i) =>'),
    'every alternative is drawn on the one line, none behind arrows');
  assert.ok(theorySource.includes('data-index-open="item:') && theorySource.includes('data-index-open="\' + esc(zone.index)')
    && theorySource.includes('window.openIndexRecord(open.dataset.indexOpen)'),
    'an item and the places it drops in each open their Index page through the checked route');
  assert.ok(/\.tc-target \.tc-bosses \{[^}]*overflow: hidden;/.test(css) && css.includes('.tc-target .tc-bosses.is-overfull { overflow-y: auto; }'),
    'the target grid shows no scrollbar unless even its smallest cells cannot fit');
  assert.ok(!/No alternative build yet|class="tc-alt"/.test(body + theorySource),
    'no empty placeholder stands in for alternatives that do not exist');
  assert.ok(!/#tcBody\.tc-layout \{[^}]*overflow-y: auto/.test(css),
    'the theory page must not be a box that scrolls inside the page');
}

/*
 * What a sigil or an ability fires is not gear. The client files those shots
 * as Equipment - the SpecPen shots as rings, the Sigil projectiles as heavy
 * armour, the Wedding Dress Explosion as a quiver - and every one of them
 * reached the manual picker of every class it fits until the bench dropped
 * PROC-labelled and tooltip-less records. They stay in the Index with a
 * reason that says what they are.
 */
{
  const helper = /^(SpecPen (OA|Quiver) Shot|Sigil .*Projectile|Wedding Dress Explosion$)/;
  assert.deepEqual(raw.items.filter(one => helper.test(one.name)
    || (one.labels || '').split(',').includes('PROC')).map(one => one.name), [],
    'no shot another item fires may be on the bench');
  for (const klass of raw.classes.map(one => one.name)) {
    for (const hand of ['weapon', 'ability', 'armor', 'ring']) {
      const offered = [...t.compatibleItemsFor(hand, klass, {})].map(one => one.name).filter(name => helper.test(name));
      assert.deepEqual(offered, [], klass + ' ' + hand + ' picker offers what another item fires');
    }
  }
  const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8')).records;
  for (const name of ['SpecPen OA Shot 1', 'SpecPen OA Shot 2', 'SpecPen Quiver Shot',
    'Sigil Wolf Sub Projectile', 'Sigil UT1 Projectile - Shark', 'Wedding Dress Explosion']) {
    const record = index.find(one => one.id === 'item:' + name);
    assert.ok(record, name + ' must stay in the Index');
    assert.ok(!record.bench, name + ' must not be on the bench');
    assert.equal(record.benchWhy, 'what another item fires, not gear anybody wears', name + ': bench reason');
  }
}

console.log('TheoryCraft: target windows, fitting, frame stride and real targets check out.');

// Frozen from the unextracted remote engine at 89f5adb after its intentional rule changes.
// Unchanged error cases retain the b34ce04 baseline. Each trace hashes the ordered snapshot
// of work.gear, work.locked and the caller's gather at EVERY yield. The full
// per-yield baseline lives outside the repository; no old optimiser is retained.
async function optimiserParity() {
  const theory = require('../web/theory-engine');
  const crypto = require('crypto');
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const clone = value => JSON.parse(JSON.stringify(value));
  const sources = Object.fromEntries([
    ['clientModText', 'Enchantment documents/client-enchantments.txt'],
    ['clientItemText', 'Items/client-items.txt'],
    ['clientArtifactText', 'Artifacts/client-artifacts.txt'],
    ['awakenText', 'Awakened Items/awakenedItems.txt']
  ].map(([key, file]) => [key, fs.readFileSync(path.join(root, 'data', file), 'utf8')]));
  // Compare numbers without rounding/coercion, including NaN, infinities and -0.
  function exact(got, expected) {
    if (typeof expected === 'number') { assert.ok(Object.is(got, expected)); return; }
    if (!expected || typeof expected !== 'object') { assert.strictEqual(got, expected); return; }
    assert.equal(typeof got, 'object'); assert.notEqual(got, null);
    assert.equal(Array.isArray(got), Array.isArray(expected));
    assert.deepStrictEqual(Object.keys(got), Object.keys(expected));
    for (const key of Object.keys(expected)) exact(got[key], expected[key]);
  }
  const frozen = [
    // 74c748a: compatible engraving pools; 59fdc85/74c748a: exclude rarity swatches and fired helpers.
    // Recorded independently from unextracted origin/main (89f5adb), including every yield and ordered gather.
    {
      spec: {"klass":"Wizard","goal":"dps","gather":true,"report":true},
      final: {"state":{"name":"Wizard build","klass":"Wizard","level":20,"maxed":true,"exalt":true,"exalts":{"hp":25,"mp":25,"att":5,"def":5,"spd":5,"dex":5,"vit":5,"wis":5},"gear":{"weapon":{"name":"Ferryman's Scythe","slots":4,"ench":["VALENTINES_APHRODITE_SHOT_DAGGER","Attack_Mana_Tradeoff_4","Attack_To_Dexterity_Bonus_4","OnShoot_Attack_Bonus_1"]},"ability":{"name":"Cobra Serpentis Scroll","slots":4,"ench":["Attack_Mana_Tradeoff_4","SHAITANS_MIGHT","Flat_Mana_Regen_4","MP_Cost_Reduction_1"]},"armor":{"name":"Diplomatic Robe","slots":4,"ench":["Attack_To_Dexterity_Bonus_4","Attack_Mana_Tradeoff_4","Damage_Resistance_4","Flat_Life_Regen_4"]},"ring":{"name":"Overclocking Amulet","slots":4,"ench":["Attack_Mana_Tradeoff_4","Attack_To_Dexterity_Bonus_4","Flat_Life_Regen_4","KOGBOLD_SPIRIT"]}},"goals":["dps"],"share":{},"pinned":{},"scope":"all","using":"both","against":null,"assume":{},"boss":"Marble Colossus","locked":{}},"score":20784.10752,"looked":3436},
      yielded: 3437,
      traceDigest: "37de93708626c607036df68affffb818c762c03870fcd59c227de20bd944d934",
      gather: [["Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Overclocking Amulet","score":20784.10752,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Rusted Mechanism",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Rusted Mechanism","score":20784.10752,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Diplomatic Robe","ring":"Rusted Mechanism"}}],["Ferryman's Scythe␟Recurring Terror Spell␟Diplomatic Robe␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Recurring Terror Spell␟Diplomatic Robe␟Overclocking Amulet","score":20784.10752,"gear":{"weapon":"Ferryman's Scythe","ability":"Recurring Terror Spell","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Chrysalis of Eternity",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Chrysalis of Eternity","score":20399.057448000003,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Diplomatic Robe","ring":"Chrysalis of Eternity"}}],["Ferryman's Scythe␟Esben's Vows␟Diplomatic Robe␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Esben's Vows␟Diplomatic Robe␟Overclocking Amulet","score":20200.716597600003,"gear":{"weapon":"Ferryman's Scythe","ability":"Esben's Vows","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Amulet of Transcendent Attack",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Amulet of Transcendent Attack","score":20198.811599999997,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Diplomatic Robe","ring":"Amulet of Transcendent Attack"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Ring of Transcendent Attack",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Ring of Transcendent Attack","score":20198.811599999997,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Diplomatic Robe","ring":"Ring of Transcendent Attack"}}],["Ferryman's Scythe␟Unstable Firework␟Diplomatic Robe␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Unstable Firework␟Diplomatic Robe␟Overclocking Amulet","score":20170.369296000004,"gear":{"weapon":"Ferryman's Scythe","ability":"Unstable Firework","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Executioner's Garb␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Executioner's Garb␟Overclocking Amulet","score":20163.25872,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Executioner's Garb","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Toga Picta␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Toga Picta␟Overclocking Amulet","score":20163.25872,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Toga Picta","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Penetrating Blast Spell␟Diplomatic Robe␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Penetrating Blast Spell␟Diplomatic Robe␟Overclocking Amulet","score":20163.25872,"gear":{"weapon":"Ferryman's Scythe","ability":"Penetrating Blast Spell","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟1-Bit Robe␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟1-Bit Robe␟Overclocking Amulet","score":20109.770208,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"1-Bit Robe","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Astronomer's Gown␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Astronomer's Gown␟Overclocking Amulet","score":20109.770208,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Astronomer's Gown","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Magical Lodestone",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Magical Lodestone","score":20017.456536,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Diplomatic Robe","ring":"Magical Lodestone"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Esben's Wedding Ring",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Diplomatic Robe␟Esben's Wedding Ring","score":19989.438744,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Diplomatic Robe","ring":"Esben's Wedding Ring"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Boudoir Robe␟Overclocking Amulet",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Boudoir Robe␟Overclocking Amulet","score":19941.875712000005,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Boudoir Robe","ring":"Overclocking Amulet"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Darkness Overcoat␟Void Mask",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Darkness Overcoat␟Void Mask","score":18335.734559999997,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Darkness Overcoat","ring":"Void Mask"}}],["Bloody Pitch Fork Staff␟Cobra Serpentis Scroll␟Curse Binding Robes␟Spike Headband",{"key":"Bloody Pitch Fork Staff␟Cobra Serpentis Scroll␟Curse Binding Robes␟Spike Headband","score":4915.872,"gear":{"weapon":"Bloody Pitch Fork Staff","ability":"Cobra Serpentis Scroll","armor":"Curse Binding Robes","ring":"Spike Headband"}}],["Ferryman's Scythe␟Cobra Serpentis Scroll␟Ritualistic Pa'u␟Tiki Pendant",{"key":"Ferryman's Scythe␟Cobra Serpentis Scroll␟Ritualistic Pa'u␟Tiki Pendant","score":19289.630712000002,"gear":{"weapon":"Ferryman's Scythe","ability":"Cobra Serpentis Scroll","armor":"Ritualistic Pa'u","ring":"Tiki Pendant"}}],["Gloves of Love␟Cobra Serpentis Scroll␟Boudoir Robe␟Essence of Enlightened Love",{"key":"Gloves of Love␟Cobra Serpentis Scroll␟Boudoir Robe␟Essence of Enlightened Love","score":5930.971119999999,"gear":{"weapon":"Gloves of Love","ability":"Cobra Serpentis Scroll","armor":"Boudoir Robe","ring":"Essence of Enlightened Love"}}],["Spring Rose␟Cobra Serpentis Scroll␟Floral Corset␟Rose Brooch",{"key":"Spring Rose␟Cobra Serpentis Scroll␟Floral Corset␟Rose Brooch","score":4551,"gear":{"weapon":"Spring Rose","ability":"Cobra Serpentis Scroll","armor":"Floral Corset","ring":"Rose Brooch"}}],["Staff of Rich History␟Cobra Serpentis Scroll␟Traditional Blouse␟Bronze Pocketwatch",{"key":"Staff of Rich History␟Cobra Serpentis Scroll␟Traditional Blouse␟Bronze Pocketwatch","score":7297.92,"gear":{"weapon":"Staff of Rich History","ability":"Cobra Serpentis Scroll","armor":"Traditional Blouse","ring":"Bronze Pocketwatch"}}],["Sweettreats Staff␟Cobra Serpentis Scroll␟Red Riding Dress␟Sweettreats Ring",{"key":"Sweettreats Staff␟Cobra Serpentis Scroll␟Red Riding Dress␟Sweettreats Ring","score":5416.618666666667,"gear":{"weapon":"Sweettreats Staff","ability":"Cobra Serpentis Scroll","armor":"Red Riding Dress","ring":"Sweettreats Ring"}}]],
      prunes: 38,
      reports: [{"at":1979,"args":[1,1978,20784.10752],"gear":"d8f29d5a3ef39fd6e2a9882bc89d137a8eff8958f1c1a347b114fb321ff8a6ec","gatherDigest":"8333f9f13537aca4c8a69fa12b1196ee97b2e744c53e23b5d2f25c5d00aa3b53"},{"at":3437,"args":[2,3436,20784.10752],"gear":"d8f29d5a3ef39fd6e2a9882bc89d137a8eff8958f1c1a347b114fb321ff8a6ec","gatherDigest":"4b87cd1479261ad6ba3620d21b824d3937e52df5ebdb46e4484d63bc7ed0acf8"}],
    },
    // 74c748a: compatible engraving pools; 59fdc85/74c748a: exclude rarity swatches and fired helpers.
    // Recorded independently from unextracted origin/main (89f5adb), including every yield and ordered gather.
    {
      spec: {"klass":"Archer","goal":"kill","gather":true,"report":true,"banned":true},
      final: {"state":{"name":"Archer build","klass":"Archer","level":20,"maxed":true,"exalt":true,"exalts":{"hp":25,"mp":25,"att":5,"def":5,"spd":5,"dex":5,"vit":5,"wis":5},"gear":{"weapon":{"name":"Makakoyumi","slots":4,"ench":["OVERWHEMLING_STRIKES","Dexterity_Mana_Tradeoff_4","Dexterity_To_Attack_Bonus_4","Proj_Lifetime_Bonus_4"]},"ability":{"name":"Quiver of the Autumn King","slots":4,"ench":["Dexterity_Mana_Tradeoff_4","PIRATES_EXPERTISE","Flat_Mana_Regen_4","MP_Cost_Reduction_1"]},"armor":{"name":"Daopao","slots":4,"ench":["Relative_Dexterity_Bonus_4","Dexterity_Mana_Tradeoff_4","Damage_Resistance_4","Flat_Life_Regen_4"]},"ring":{"name":"Overclocking Amulet","slots":4,"ench":["Dexterity_To_Attack_Bonus_4","Dexterity_Mana_Tradeoff_4","Flat_Life_Regen_4","KOGBOLD_SPIRIT"]}},"goals":["dps"],"share":{},"pinned":{},"scope":"all","using":"both","against":null,"assume":{},"boss":"Marble Colossus","locked":{},"banned":{"weapon":["Warmonger","Warmonger (Rehearsal)","Water Pistol"],"ability":["Sinister Syringes","Snow Critters","Spinal Quiver"],"armor":["Wedding Dress","Withered Poncho","Wraith's Brigandine"],"ring":["Winter Boots","Witch's Brooch","Yokai Amulet"]}},"score":-17.95342580514521,"looked":4898},
      yielded: 4899,
      traceDigest: "3642592967f24441cfbc555e5394a58cbd0eb80199c41a1004e68ea0458019cf",
      gather: [["Makakoyumi␟Quiver of the Autumn King␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Quiver of the Autumn King␟Daopao␟Overclocking Amulet","score":-17.95342580514521,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Quiver of the Autumn King␟Daopao␟Rusted Mechanism",{"key":"Makakoyumi␟Quiver of the Autumn King␟Daopao␟Rusted Mechanism","score":-17.95342580514521,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Rusted Mechanism"}}],["Makakoyumi␟Quiver of the Autumn King␟Hirejou Tenne␟Overclocking Amulet",{"key":"Makakoyumi␟Quiver of the Autumn King␟Hirejou Tenne␟Overclocking Amulet","score":-17.95342580514521,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Hirejou Tenne","ring":"Overclocking Amulet"}}],["Makakoyumi␟Brine Quiver␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Brine Quiver␟Daopao␟Overclocking Amulet","score":-18.177375277006906,"gear":{"weapon":"Makakoyumi","ability":"Brine Quiver","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Coalbearing Quiver␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Coalbearing Quiver␟Daopao␟Overclocking Amulet","score":-18.177375277006906,"gear":{"weapon":"Makakoyumi","ability":"Coalbearing Quiver","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Hydroflow Quiver␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Hydroflow Quiver␟Daopao␟Overclocking Amulet","score":-18.177375277006906,"gear":{"weapon":"Makakoyumi","ability":"Hydroflow Quiver","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Legion Elite Quiver␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Legion Elite Quiver␟Daopao␟Overclocking Amulet","score":-18.177375277006906,"gear":{"weapon":"Makakoyumi","ability":"Legion Elite Quiver","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Quiver of the Autumn King␟Daopao␟Chrysalis of Eternity",{"key":"Makakoyumi␟Quiver of the Autumn King␟Daopao␟Chrysalis of Eternity","score":-18.313930373636527,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Chrysalis of Eternity"}}],["Makakoyumi␟Beehemoth Quiver␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Beehemoth Quiver␟Daopao␟Overclocking Amulet","score":-18.36007119333637,"gear":{"weapon":"Makakoyumi","ability":"Beehemoth Quiver","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Freezing Quiver␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Freezing Quiver␟Daopao␟Overclocking Amulet","score":-18.36007119333637,"gear":{"weapon":"Makakoyumi","ability":"Freezing Quiver","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Sinister Syringes␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Sinister Syringes␟Daopao␟Overclocking Amulet","score":-18.37111733756475,"gear":{"weapon":"Makakoyumi","ability":"Sinister Syringes","armor":"Daopao","ring":"Overclocking Amulet"}}],["Bolt Thrower␟Quiver of the Autumn King␟Daopao␟Overclocking Amulet",{"key":"Bolt Thrower␟Quiver of the Autumn King␟Daopao␟Overclocking Amulet","score":-18.404213030641795,"gear":{"weapon":"Bolt Thrower","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Quiver of the Autumn King␟Daopao␟Amulet of Transcendent Dexterity",{"key":"Makakoyumi␟Quiver of the Autumn King␟Daopao␟Amulet of Transcendent Dexterity","score":-18.449415263927992,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Amulet of Transcendent Dexterity"}}],["Makakoyumi␟Quiver of the Autumn King␟Daopao␟Ring of Transcendent Dexterity",{"key":"Makakoyumi␟Quiver of the Autumn King␟Daopao␟Ring of Transcendent Dexterity","score":-18.449415263927992,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Ring of Transcendent Dexterity"}}],["Makakoyumi␟Double Vision Darts␟Daopao␟Overclocking Amulet",{"key":"Makakoyumi␟Double Vision Darts␟Daopao␟Overclocking Amulet","score":-18.581821710201552,"gear":{"weapon":"Makakoyumi","ability":"Double Vision Darts","armor":"Daopao","ring":"Overclocking Amulet"}}],["Makakoyumi␟Quiver of the Autumn King␟Centaur's Shielding␟Overclocking Amulet",{"key":"Makakoyumi␟Quiver of the Autumn King␟Centaur's Shielding␟Overclocking Amulet","score":-18.593289567676848,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Centaur's Shielding","ring":"Overclocking Amulet"}}],["Aspirant's Bow␟Quiver of the Autumn King␟Aspirant's Hide␟Ring of the Swiftblade",{"key":"Aspirant's Bow␟Quiver of the Autumn King␟Aspirant's Hide␟Ring of the Swiftblade","score":-34.55203328672276,"gear":{"weapon":"Aspirant's Bow","ability":"Quiver of the Autumn King","armor":"Aspirant's Hide","ring":"Ring of the Swiftblade"}}],["Makakoyumi␟Quiver of the Autumn King␟Gravetender's Vest␟Jewel of Vengeance",{"key":"Makakoyumi␟Quiver of the Autumn King␟Gravetender's Vest␟Jewel of Vengeance","score":-21.388547836370293,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Gravetender's Vest","ring":"Jewel of Vengeance"}}],["Electric Guitar␟Quiver of the Autumn King␟Daopao␟Pointy Tail",{"key":"Electric Guitar␟Quiver of the Autumn King␟Daopao␟Pointy Tail","score":-32.250133535030194,"gear":{"weapon":"Electric Guitar","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Pointy Tail"}}],["Makakoyumi␟Quiver of the Autumn King␟Daopao␟Mala Beads",{"key":"Makakoyumi␟Quiver of the Autumn King␟Daopao␟Mala Beads","score":-20.25075708525251,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Mala Beads"}}],["Makakoyumi␟Quiver of the Autumn King␟Chocolate Armor␟Sweetener Ring",{"key":"Makakoyumi␟Quiver of the Autumn King␟Chocolate Armor␟Sweetener Ring","score":-23.633886631786748,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Chocolate Armor","ring":"Sweetener Ring"}}],["Spring Wonder Bow␟Fresh Breeze Quiver␟Painted Eggshell Armor␟Painted Egg Amulet",{"key":"Spring Wonder Bow␟Fresh Breeze Quiver␟Painted Eggshell Armor␟Painted Egg Amulet","score":-36.80685059617819,"gear":{"weapon":"Spring Wonder Bow","ability":"Fresh Breeze Quiver","armor":"Painted Eggshell Armor","ring":"Painted Egg Amulet"}}],["Firestarter␟Quiver of the Autumn King␟Daopao␟Tiki Pendant",{"key":"Firestarter␟Quiver of the Autumn King␟Daopao␟Tiki Pendant","score":-29.038820616755903,"gear":{"weapon":"Firestarter","ability":"Quiver of the Autumn King","armor":"Daopao","ring":"Tiki Pendant"}}],["Frostbite Mittens␟Snow Critters␟Blizzard Jacket␟Magical Winter Scarf",{"key":"Frostbite Mittens␟Snow Critters␟Blizzard Jacket␟Magical Winter Scarf","score":-39.01921306051101,"gear":{"weapon":"Frostbite Mittens","ability":"Snow Critters","armor":"Blizzard Jacket","ring":"Magical Winter Scarf"}}],["Makakoyumi␟Quiver of the Autumn King␟Reaper's Shroud␟Soul Necklace",{"key":"Makakoyumi␟Quiver of the Autumn King␟Reaper's Shroud␟Soul Necklace","score":-22.947533365811218,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Reaper's Shroud","ring":"Soul Necklace"}}],["Makakoyumi␟Quiver of the Autumn King␟Mechpilot's Jerkin␟Pressure Gauge Band",{"key":"Makakoyumi␟Quiver of the Autumn King␟Mechpilot's Jerkin␟Pressure Gauge Band","score":-23.63732771825654,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Mechpilot's Jerkin","ring":"Pressure Gauge Band"}}],["Makakoyumi␟Quiver of the Autumn King␟Mossy Guard␟Willow Sprout",{"key":"Makakoyumi␟Quiver of the Autumn King␟Mossy Guard␟Willow Sprout","score":-22.754863735982735,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Mossy Guard","ring":"Willow Sprout"}}],["Makakoyumi␟Quiver of the Autumn King␟Sprite's Dream␟Infinite Bands",{"key":"Makakoyumi␟Quiver of the Autumn King␟Sprite's Dream␟Infinite Bands","score":-24.82603867672211,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Sprite's Dream","ring":"Infinite Bands"}}],["Sweettreats Bow␟Quiver of the Autumn King␟Haori of the Wind␟Sweettreats Ring",{"key":"Sweettreats Bow␟Quiver of the Autumn King␟Haori of the Wind␟Sweettreats Ring","score":-34.76378878387254,"gear":{"weapon":"Sweettreats Bow","ability":"Quiver of the Autumn King","armor":"Haori of the Wind","ring":"Sweettreats Ring"}}],["Makakoyumi␟Quiver of the Autumn King␟Primal Padding␟Storied Fossil",{"key":"Makakoyumi␟Quiver of the Autumn King␟Primal Padding␟Storied Fossil","score":-23.63732771825654,"gear":{"weapon":"Makakoyumi","ability":"Quiver of the Autumn King","armor":"Primal Padding","ring":"Storied Fossil"}}]],
      prunes: 61,
      reports: [{"at":1987,"args":[1,1986,-17.96301566325253],"gear":"8969eeb6695a9d6ecbd8d8c04b42a0bf8071bd59646218b72e9b3ae311f488c5","gatherDigest":"907dbc9c3f7239f963f967367d6bfb5f575770915be4a61c578aa70a016b1dd1"},{"at":3443,"args":[2,3442,-17.95342580514521],"gear":"24c8cbc9b2ac363d7e94320f8a2e9da127a40f0c19cb12c066a6e7625efebf88","gatherDigest":"4ef0f311eac2f2b1d3e57f671c8435a4e5beed58bd0051dded03fc0cff40641b"},{"at":4899,"args":[3,4898,-17.95342580514521],"gear":"24c8cbc9b2ac363d7e94320f8a2e9da127a40f0c19cb12c066a6e7625efebf88","gatherDigest":"8deb37f888c27eb3a1f1dc724485d3e4b36ea0f5717980e623485fecbebd0a8f"}],
    },
    // 74c748a: compatible engraving pools; 59fdc85/74c748a: exclude rarity swatches and fired helpers.
    // Recorded independently from unextracted origin/main (89f5adb), including every yield and ordered gather.
    {
      spec: {"klass":"Warrior","goal":"stat:hp","scope":"gear"},
      final: {"state":{"name":"Warrior build","klass":"Warrior","level":20,"maxed":true,"exalt":true,"exalts":{"hp":25,"mp":25,"att":5,"def":5,"spd":5,"dex":5,"vit":5,"wis":5},"gear":{"weapon":{"name":"Venerable Ancient Stone Sword","slots":4,"ench":[null,null,null,null]},"ability":{"name":"Helm of the Tribune","slots":4,"ench":[null,null,null,null]},"armor":{"name":"Breastplate of New Life","slots":4,"ench":[null,null,null,null]},"ring":{"name":"Decades Chronicle","slots":4,"ench":[null,null,null,null]}},"goals":["dps"],"share":{},"pinned":{},"scope":"gear","using":"both","against":null,"assume":{},"boss":"Marble Colossus","locked":{}},"score":1215,"looked":2046},
      yielded: 2047,
      traceDigest: "2008ae61819666967415ba1c5012ae95015ca9db8c3e5deca3d7ccb0e4715f73",
      gather: [],
      prunes: 0,
      reports: [],
    },
    // 74c748a: compatible engraving pools; 59fdc85/74c748a: exclude rarity swatches and fired helpers.
    // Recorded independently from unextracted origin/main (89f5adb), including every yield and ordered gather.
    {
      spec: {"klass":"Ninja","goal":"stat:dex","scope":"helps","locks":true,"gather":true,"report":true},
      final: {"state":{"name":"Ninja build","klass":"Ninja","level":20,"maxed":true,"exalt":true,"exalts":{"hp":25,"mp":25,"att":5,"def":5,"spd":5,"dex":5,"vit":5,"wis":5},"gear":{"weapon":{"name":"Cloudstrike Tachi","slots":2,"ench":["ASCENSION_OF_GEB","Relative_Dexterity_Bonus_4"]},"ability":{"name":"Eternal Star","slots":4,"ench":["Dexterity_Attack_Tradeoff_4","PIRATES_EXPERTISE",null,null]},"armor":{"name":"Venerable Coral Silk Armor","slots":4,"ench":["Dexterity_Attack_Tradeoff_4","PIRATES_EXPERTISE",null,null]},"ring":{"name":"Faded Heart Scarab","slots":4,"ench":["Dexterity_Attack_Tradeoff_4","Relative_Dexterity_Bonus_4",null,null]}},"goals":["dps"],"share":{},"pinned":{},"scope":"helps","using":"both","against":null,"assume":{},"boss":"Marble Colossus","locked":{"weapon":true,"weapon:0":true}},"score":159.8,"looked":3777},
      yielded: 3778,
      traceDigest: "9dad2980223ebddd012053a58ba483b14e5457e59cf3067cdcd68faf617b4019",
      gather: [["Cloudstrike Tachi␟Eternal Star␟Venerable Coral Silk Armor␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Venerable Coral Silk Armor␟Faded Heart Scarab","score":159.8,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Venerable Coral Silk Armor","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Star of Enlightenment␟Venerable Coral Silk Armor␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Star of Enlightenment␟Venerable Coral Silk Armor␟Faded Heart Scarab","score":159.8,"gear":{"weapon":"Cloudstrike Tachi","ability":"Star of Enlightenment","armor":"Venerable Coral Silk Armor","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Bachelor's Tuxedo␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Bachelor's Tuxedo␟Faded Heart Scarab","score":156.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Bachelor's Tuxedo","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Coral Silk Armor␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Coral Silk Armor␟Faded Heart Scarab","score":156.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Coral Silk Armor","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Cupid's Garments␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Cupid's Garments␟Faded Heart Scarab","score":156.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Cupid's Garments","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Daopao␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Daopao␟Faded Heart Scarab","score":156.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Daopao","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Hirejou Tenne␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Hirejou Tenne␟Faded Heart Scarab","score":156.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Hirejou Tenne","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Hollyhock Hide␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Hollyhock Hide␟Faded Heart Scarab","score":156.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Hollyhock Hide","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Metal-plated Corset␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Metal-plated Corset␟Faded Heart Scarab","score":156.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Metal-plated Corset","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Centaur's Shielding␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Centaur's Shielding␟Faded Heart Scarab","score":154.8,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Centaur's Shielding","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Leviathan Armor␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Leviathan Armor␟Faded Heart Scarab","score":154.8,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Leviathan Armor","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Squadron Sheathing␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Squadron Sheathing␟Faded Heart Scarab","score":154.8,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Squadron Sheathing","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Eggshell Carapace␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Eggshell Carapace␟Faded Heart Scarab","score":153.2,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Eggshell Carapace","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Legion Elite Leather Armor␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Legion Elite Leather Armor␟Faded Heart Scarab","score":153.2,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Legion Elite Leather Armor","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Light Syndicate Attire␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Eternal Star␟Light Syndicate Attire␟Faded Heart Scarab","score":153.2,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Light Syndicate Attire","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Ballistic Star␟Venerable Coral Silk Armor␟Faded Heart Scarab",{"key":"Cloudstrike Tachi␟Ballistic Star␟Venerable Coral Silk Armor␟Faded Heart Scarab","score":151.5,"gear":{"weapon":"Cloudstrike Tachi","ability":"Ballistic Star","armor":"Venerable Coral Silk Armor","ring":"Faded Heart Scarab"}}],["Cloudstrike Tachi␟Eternal Star␟Blizzard Jacket␟Magical Winter Scarf",{"key":"Cloudstrike Tachi␟Eternal Star␟Blizzard Jacket␟Magical Winter Scarf","score":114.6,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Blizzard Jacket","ring":"Magical Winter Scarf"}}],["Cloudstrike Tachi␟Eternal Star␟Reaper's Shroud␟Soul Necklace",{"key":"Cloudstrike Tachi␟Eternal Star␟Reaper's Shroud␟Soul Necklace","score":118.6,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Reaper's Shroud","ring":"Soul Necklace"}}],["Cloudstrike Tachi␟Eternal Star␟Mechpilot's Jerkin␟Pressure Gauge Band",{"key":"Cloudstrike Tachi␟Eternal Star␟Mechpilot's Jerkin␟Pressure Gauge Band","score":119.9,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Mechpilot's Jerkin","ring":"Pressure Gauge Band"}}],["Cloudstrike Tachi␟Eternal Star␟Mossy Guard␟Willow Sprout",{"key":"Cloudstrike Tachi␟Eternal Star␟Mossy Guard␟Willow Sprout","score":123.8,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Mossy Guard","ring":"Willow Sprout"}}],["Cloudstrike Tachi␟Eternal Star␟Sprite's Dream␟Infinite Bands",{"key":"Cloudstrike Tachi␟Eternal Star␟Sprite's Dream␟Infinite Bands","score":114.6,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Sprite's Dream","ring":"Infinite Bands"}}],["Cloudstrike Tachi␟Eternal Star␟Bachelor's Tuxedo␟Sweettreats Ring",{"key":"Cloudstrike Tachi␟Eternal Star␟Bachelor's Tuxedo␟Sweettreats Ring","score":134.4,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Bachelor's Tuxedo","ring":"Sweettreats Ring"}}],["Cloudstrike Tachi␟Eternal Star␟Primal Padding␟Storied Fossil",{"key":"Cloudstrike Tachi␟Eternal Star␟Primal Padding␟Storied Fossil","score":119.9,"gear":{"weapon":"Cloudstrike Tachi","ability":"Eternal Star","armor":"Primal Padding","ring":"Storied Fossil"}}]],
      prunes: 51,
      reports: [{"at":1427,"args":[1,1426,157.8],"gear":"0e87ee5959419c050148e6845644fbf322910b93f747dcc44307ea8a52c49b8d","gatherDigest":"2c8d7d4483a9fab75d3b09b0b90ac6b8d3740fc8f92306eb123acbd800eaa600"},{"at":2605,"args":[2,2604,159.8],"gear":"1b86140d56f7c9c720e837de5578e08c2a191d22134a00ba2c216614e24bd2eb","gatherDigest":"ed3d9f820da6bc2b5884677cb80f93e577c815d08ba5d1527fa369ba85bd290b"},{"at":3778,"args":[3,3777,159.8],"gear":"1b86140d56f7c9c720e837de5578e08c2a191d22134a00ba2c216614e24bd2eb","gatherDigest":"5319376ddca843cd6779bb9c8a7b5f4d81567bbb26334d94a7ca1bcc35c3ec8a"}],
    },
    // 74c748a: compatible engraving pools; 59fdc85/74c748a: exclude rarity swatches and fired helpers.
    // Recorded independently from unextracted origin/main (89f5adb), including every yield and ordered gather.
    {
      spec: {"klass":"Wizard","goal":"stat:hp","personal":true,"gather":true,"report":true},
      final: {"state":{"name":"Wizard build","klass":"Wizard","level":20,"maxed":true,"exalt":true,"exalts":{"hp":25,"mp":25,"att":5,"def":5,"spd":5,"dex":5,"vit":5,"wis":5},"gear":{"weapon":{"name":"Spellblade of Decimation","slots":4,"ench":["Life_Mana_Tradeoff_4","VAMPRIC_LIFEFORCE","Damage_Tradeoff_4","Proj_Lifetime_Bonus_4"]},"ability":{"name":"Burning Retribution Spell","slots":4,"ench":["Life_Mana_Tradeoff_4","VAMPRIC_LIFEFORCE","Flat_Mana_Regen_4","MP_Cost_Reduction_1"]},"armor":{"name":"Robe of the Illusionist","slots":4,"ench":["Relative_Life_Bonus_4","Life_Mana_Tradeoff_4","Damage_Resistance_4","Flat_Life_Regen_4"]},"ring":{"name":"Ring of Transcendent Health","slots":4,"ench":["Relative_Life_Bonus_4","Life_Mana_Tradeoff_4","Flat_Life_Regen_4","Flat_Mana_Regen_4"]}},"goals":["dps"],"share":{},"pinned":{},"scope":"all","using":"both","against":null,"assume":{},"boss":"Marble Colossus","locked":{}},"score":1270.6,"looked":1938},
      yielded: 1939,
      traceDigest: "835883b6b47d3b231ba38e5a5dee3351d0b60e924f246767d92407c29534aca6",
      gather: [["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Attack",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Attack","score":1134.2,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Attack"}}],["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Defense",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Defense","score":1134.2,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Defense"}}],["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Dexterity",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Dexterity","score":1134.2,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Dexterity"}}],["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Health",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Health","score":1270.6,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Health"}}],["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Magic",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Magic","score":1134.2,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Magic"}}],["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Speed",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Speed","score":1134.2,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Speed"}}],["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Vitality",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Vitality","score":1134.2,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Vitality"}}],["Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Wisdom",{"key":"Spellblade of Decimation␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Wisdom","score":1134.2,"gear":{"weapon":"Spellblade of Decimation","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Wisdom"}}],["Staff of Destruction␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Health",{"key":"Staff of Destruction␟Burning Retribution Spell␟Robe of the Illusionist␟Ring of Transcendent Health","score":1270.6,"gear":{"weapon":"Staff of Destruction","ability":"Burning Retribution Spell","armor":"Robe of the Illusionist","ring":"Ring of Transcendent Health"}}]],
      prunes: 0,
      reports: [{"at":1167,"args":[1,1166,1270.6],"gear":"4778fde6cdd909fcab2abc534ea103d5b0190376d99621940d3e9553c46a56fc","gatherDigest":"4684c38cbe13bcd2835e28d089a10506cb504eeb590726de8490f05cce797a35"},{"at":1939,"args":[2,1938,1270.6],"gear":"4778fde6cdd909fcab2abc534ea103d5b0190376d99621940d3e9553c46a56fc","gatherDigest":"2ca0e80f112ac0a35cf0c274980f2fe2c08a73f526832d7431f324b2adcf5c0e"}],
    },
    // 74c748a: compatible engraving pools; 59fdc85/74c748a: exclude rarity swatches and fired helpers.
    // Recorded independently from unextracted origin/main (89f5adb), including every yield and ordered gather.
    {
      spec: {"klass":"Priest","goal":"unknown","scope":"gear","gather":true,"report":true},
      final: {"state":{"name":"Priest build","klass":"Priest","level":20,"maxed":true,"exalt":true,"exalts":{"hp":25,"mp":25,"att":5,"def":5,"spd":5,"dex":5,"vit":5,"wis":5},"gear":{"weapon":{"name":"Earthen Ward","slots":4,"ench":[null,null,null,null]},"ability":{"name":"Tome of Holy Furor","slots":4,"ench":[null,null,null,null]},"armor":{"name":"Diplomatic Robe","slots":4,"ench":[null,null,null,null]},"ring":{"name":"Overclocking Amulet","slots":4,"ench":[null,null,null,null]}},"goals":["dps"],"share":{},"pinned":{},"scope":"gear","using":"both","against":null,"assume":{},"boss":"Marble Colossus","locked":{}},"score":7639.703999999999,"looked":1488},
      yielded: 1489,
      traceDigest: "80d0e1a52bd38c1d8be92110caf0002e57abed4604ba2618cff377f98a3cb168",
      gather: [["Earthen Ward␟Tome of Holy Furor␟Diplomatic Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Diplomatic Robe␟Overclocking Amulet","score":7639.703999999999,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Diplomatic Robe␟Rusted Mechanism",{"key":"Earthen Ward␟Tome of Holy Furor␟Diplomatic Robe␟Rusted Mechanism","score":7639.703999999999,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Diplomatic Robe","ring":"Rusted Mechanism"}}],["Earthen Ward␟Tome of the Dragon␟Diplomatic Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of the Dragon␟Diplomatic Robe␟Overclocking Amulet","score":7639.703999999999,"gear":{"weapon":"Earthen Ward","ability":"Tome of the Dragon","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of the Mushroom Tribes␟Diplomatic Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of the Mushroom Tribes␟Diplomatic Robe␟Overclocking Amulet","score":7639.703999999999,"gear":{"weapon":"Earthen Ward","ability":"Tome of the Mushroom Tribes","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Sweet Desire Wand␟Tome of Holy Furor␟Diplomatic Robe␟Overclocking Amulet",{"key":"Sweet Desire Wand␟Tome of Holy Furor␟Diplomatic Robe␟Overclocking Amulet","score":7639.703999999999,"gear":{"weapon":"Sweet Desire Wand","ability":"Tome of Holy Furor","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Red Riding Dress␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Red Riding Dress␟Overclocking Amulet","score":7614.378000000001,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Red Riding Dress","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Boudoir Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Boudoir Robe␟Overclocking Amulet","score":7538.508,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Boudoir Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Ragged Robes␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Ragged Robes␟Overclocking Amulet","score":7538.508,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Ragged Robes","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Diplomatic Robe␟Chrysalis of Eternity",{"key":"Earthen Ward␟Tome of Holy Furor␟Diplomatic Robe␟Chrysalis of Eternity","score":7493.472,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Diplomatic Robe","ring":"Chrysalis of Eternity"}}],["Earthen Ward␟Ceremonial Merlot␟Diplomatic Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Ceremonial Merlot␟Diplomatic Robe␟Overclocking Amulet","score":7480.728000000001,"gear":{"weapon":"Earthen Ward","ability":"Ceremonial Merlot","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Exorcism␟Diplomatic Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Exorcism␟Diplomatic Robe␟Overclocking Amulet","score":7480.728000000001,"gear":{"weapon":"Earthen Ward","ability":"Tome of Exorcism","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Pain␟Diplomatic Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Pain␟Diplomatic Robe␟Overclocking Amulet","score":7480.728000000001,"gear":{"weapon":"Earthen Ward","ability":"Tome of Pain","armor":"Diplomatic Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Darkness Overcoat␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Darkness Overcoat␟Overclocking Amulet","score":7469.7660000000005,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Darkness Overcoat","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Doctor's Overcoat␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Doctor's Overcoat␟Overclocking Amulet","score":7469.7660000000005,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Doctor's Overcoat","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Anointed Robe␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Anointed Robe␟Overclocking Amulet","score":7459.397999999998,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Anointed Robe","ring":"Overclocking Amulet"}}],["Earthen Ward␟Tome of Holy Furor␟Garb of the Ordained␟Overclocking Amulet",{"key":"Earthen Ward␟Tome of Holy Furor␟Garb of the Ordained␟Overclocking Amulet","score":7459.397999999998,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Garb of the Ordained","ring":"Overclocking Amulet"}}],["Pulsating Wand␟Tome of Holy Furor␟Diplomatic Robe␟Willow Sprout",{"key":"Pulsating Wand␟Tome of Holy Furor␟Diplomatic Robe␟Willow Sprout","score":2125.2000000000003,"gear":{"weapon":"Pulsating Wand","ability":"Tome of Holy Furor","armor":"Diplomatic Robe","ring":"Willow Sprout"}}],["Dimensional Union␟Tome of Holy Furor␟Diplomatic Robe␟Infinite Bands",{"key":"Dimensional Union␟Tome of Holy Furor␟Diplomatic Robe␟Infinite Bands","score":1302.98,"gear":{"weapon":"Dimensional Union","ability":"Tome of Holy Furor","armor":"Diplomatic Robe","ring":"Infinite Bands"}}],["Earthen Ward␟Tome of Holy Furor␟Traditional Blouse␟Bronze Pocketwatch",{"key":"Earthen Ward␟Tome of Holy Furor␟Traditional Blouse␟Bronze Pocketwatch","score":6327.00288,"gear":{"weapon":"Earthen Ward","ability":"Tome of Holy Furor","armor":"Traditional Blouse","ring":"Bronze Pocketwatch"}}],["Sweettreats Wand␟Tome of Holy Furor␟Red Riding Dress␟Sweettreats Ring",{"key":"Sweettreats Wand␟Tome of Holy Furor␟Red Riding Dress␟Sweettreats Ring","score":3763.5370666666668,"gear":{"weapon":"Sweettreats Wand","ability":"Tome of Holy Furor","armor":"Red Riding Dress","ring":"Sweettreats Ring"}}],["Aeonic Talon␟Tome of Holy Furor␟Diplomatic Robe␟Storied Fossil",{"key":"Aeonic Talon␟Tome of Holy Furor␟Diplomatic Robe␟Storied Fossil","score":4307.679999999999,"gear":{"weapon":"Aeonic Talon","ability":"Tome of Holy Furor","armor":"Diplomatic Robe","ring":"Storied Fossil"}}]],
      prunes: 38,
      reports: [{"at":745,"args":[1,744,7639.703999999999],"gear":"3f4293da57c97fdf150cfd5df035f56d29ec0f40edffa6da573b9079800796df","gatherDigest":"df292c6fe6a42825756156a26436b87f46e480645084626390508cb2c80d90ec"},{"at":1489,"args":[2,1488,7639.703999999999],"gear":"3f4293da57c97fdf150cfd5df035f56d29ec0f40edffa6da573b9079800796df","gatherDigest":"38b9dcac0387ec36c2ef263883d51248085919872e488954f5f7726d884361cf"}],
    },
    {
      spec: {"klass":"Wizard","goal":"dps","error":"profile"},
      final: null,
      error: "Set up your progression before crafting.",
      yielded: 0,
      traceDigest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      gather: [],
      prunes: 0,
      reports: [],
    },
    {
      spec: {"klass":"Wizard","goal":"dps","error":"access"},
      final: null,
      error: "Set up your progression before crafting.",
      yielded: 0,
      traceDigest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      gather: [],
      prunes: 0,
      reports: [],
    },
    {
      spec: {"klass":"Wizard","goal":"dps","error":"data"},
      final: null,
      error: "Cannot read properties of null (reading 'byItem')",
      yielded: 0,
      traceDigest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      gather: [],
      prunes: 0,
      reports: [],
    },
    {
      spec: {"klass":"Wizard","goal":"dps","error":"goal"},
      final: null,
      error: "Cannot read properties of undefined (reading 'id')",
      yielded: 1,
      traceDigest: "c6ffa9c4e34607494cb0c19c6df901e0c84c48480b512ef3f0da4794bf5ef768",
      gather: [],
      prunes: 0,
      reports: [],
    },
  ];
  function fixture(api, spec) {
    api.configure(clone(raw));
  const state = api.fresh(spec.klass);
  if (spec.scope) state.scope = spec.scope;
  if (spec.banned) {
    state.banned = {};
    for (const hand of ['weapon','ability','armor','ring']) {
      state.banned[hand] = api.searchItems(hand,state.klass,state).slice(-3).map(one => one.name);
    }
  }
  if (spec.locks) {
    const item = api.searchItems('weapon',state.klass,state).find(one => one.name !== state.gear.weapon.name);
    state.gear.weapon = {name:item.name, slots:2, ench:[null,null]};
    const charm = api.enchantsFor(item.name, [], 0).find(one => one.id);
    state.gear.weapon.ench[0] = charm.id;
    state.locked.weapon = true; state.locked['weapon:0'] = true;
  }
  if (spec.personal) {
    // Real client gear, with a deterministic progression catalogue containing tiered loot.
    const items = raw.items.filter(one => one.tier !== undefined && one.tier <= 7);
    api.progression({zones:[{id:'fixture',kind:'dungeon'}], starter:new Set(),
      sources:new Map(items.map(one => [one.name,new Set(['fixture'])]))},
      {mode:'personal',zones:['fixture'],biomeRanks:[]});
  }
  api.use(state);
  const goal = spec.error === 'goal' ? undefined : api.goalsOf({goal:spec.goal})[0];
  if (spec.error === 'profile') api.progression(null,null);
  if (spec.error === 'access') api.progression(null,{mode:'personal'});
  if (spec.error === 'data') api.setData(null);
  return {state,goal};
}
  class Gather extends Map {
    prunes = 0;
    peak = 0;
    set(key, value) { super.set(key, value); this.peak = Math.max(this.peak, this.size); return this; }
    clear() { this.prunes++; super.clear(); }
  }
  function observed() {
    let work, made, constructions = 0;
    const original = theory.createOptimiser;
    theory.createOptimiser = deps => {
      constructions++;
      const prepare = deps.prepareSearchable;
      return made = original({...deps, prepareSearchable(state) { work = prepare(state); return work; }});
    };
    let api;
    try { api = harness(sources, raw, true); }
    finally { theory.createOptimiser = original; }
    assert.strictEqual(api.optimiseSteps, made.optimiseSteps);
    assert.equal(constructions, 1, 'one factory per UI closure');
    return {api, work: () => work};
  }
  const original = theory.createOptimiser;
  let constructions = 0, made;
  theory.createOptimiser = deps => { constructions++; return made = original(deps); };
  try {
    const api = harness(sources, raw, true), state = api.fresh('Wizard');
    state.scope = 'gear';
    for (const hand of ['weapon', 'ability', 'armor', 'ring']) state.locked[hand] = true;
    for (let i = 0; i < 2; i++) {
      api.optimise(state, api.GOALS[0]);
      await api.optimiseAsync(state, api.GOALS[0]);
    }
    assert.equal(constructions, 1, 'both drivers reuse the original factory');
    assert.strictEqual(api.optimiseSteps, made.optimiseSteps);
  } finally { theory.createOptimiser = original; }
  let pruned = 0;
  for (const expected of frozen) {
    const {spec} = expected;
    const probe = observed(), api = probe.api;
    const {state, goal} = fixture(api, spec), before = clone(state);
    const gather = spec.gather ? new Gather() : undefined;
    const trace = [], reports = [];
    let yielded = 0, final = null, error;
    const report = spec.report ? (...args) => reports.push({at:yielded,args,
      gear:digest(probe.work().gear),gatherDigest:digest([...gather || []])}) : undefined;
    // Merely constructing the generator neither reads the guard nor prepares work.
    const steps = api.optimiseSteps(state, goal, report, gather);
    assert.strictEqual(probe.work(), undefined);
    try {
      for (;;) {
        const step = steps.next();
        if (step.done) { final = step.value; break; }
        assert.strictEqual(step.value, undefined);
        yielded++;
        trace.push({gear:digest(probe.work().gear),locked:digest(probe.work().locked),
          gather:digest([...gather || []]),size:gather ? gather.size : 0});
      }
    } catch (one) { error = one.message; }
    exact(final, expected.final); exact(error, expected.error);
    exact(yielded, expected.yielded); exact(digest(trace), expected.traceDigest);
    exact(reports, expected.reports); exact([...gather || []], expected.gather);
    exact(state, before);
    if (final) assert.strictEqual(final.state, probe.work(), 'return the mutated work itself');
    if (gather) {
      exact(gather.prunes, expected.prunes); pruned += gather.prunes;
      assert.ok(gather.peak <= 33); assert.ok(gather.size <= 32);
    }
    // Both drivers consume the same lazy generator and return its final value.
    // Repeat in the same closure to catch caches accidentally shared by searches.
    for (const [method, hasReport, hasGather] of [
      ['optimise', spec.report, spec.gather],
      ['optimiseAsync', spec.report, spec.gather],
      ...(!spec.error ? [['optimise', false, true], ['optimiseAsync', true, false]] : [])
    ]) {
      const input = fixture(api, spec), offered = hasGather ? new Gather() : undefined;
      const called = [];
      let got = null, failure;
      try { got = await api[method](input.state, input.goal,
        hasReport ? (...args) => called.push(args) : undefined, offered); }
      catch (one) { failure = one.message; }
      exact(got, expected.final); exact(failure, expected.error);
      if (hasReport && spec.report) exact(called, expected.reports.map(one => one.args));
      else if (!hasReport) exact(called, []);
      if (hasGather && spec.gather) exact([...offered], expected.gather);
      else if (!hasGather) exact([...offered || []], []);
    }
  }
  assert.ok(pruned > 0, 'real searches exceed GATHER_KEEP * 2 and prune in place');
  console.log('Optimiser: 10 frozen legacy cases, every yield, reports, ordered gather and both drivers match exactly.');
}
// The factory keeps the guard lazy and every mutable dependency live; all four
// search caches are owned by a generator, including overlapping generators.
{
  const {createOptimiser} = require('../web/theory-engine');
  const clone = value => JSON.parse(JSON.stringify(value));
  const calls = [];
  let profile = null, access = null, catalogue, work;
  let candidates = [{name:'a',hand:'weapon',tier:0},{name:'b',hand:'weapon',tier:1}];
  let fits = true;
  const state = {klass:'fixture',gear:{weapon:{name:'a',slots:1,ench:['held']}},
    locked:{'weapon:0':true},scope:'gear'};
  const goal = {id:'fixture'};
  const data = () => ({byItem:Object.fromEntries(candidates.map(one => [one.name,one])),byEnch:{},sets:[]});
  catalogue = data();
  const deps = {
    getProfile() {calls.push('profile');return profile;},
    getAccess() {calls.push('access');return access;},
    getData() {calls.push('data');return catalogue;},
    hands:[['weapon']],gatherKeep:16,
    byScoreThenSignature:(a,b)=>(b.score-a.score)||(a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    gearSignature:s=>s.gear.weapon.name,
    prepareSearchable(s) {calls.push('prepare');return work = clone(s);},
    searchItems(hand,klass,s) {
      calls.push('items'); assert.equal(hand,'weapon');assert.equal(klass,'fixture');
      assert.strictEqual(s,work);return candidates;
    },
    searchEnchants() {throw new Error('gear scope never searches enchants');},
    enchantFitsItem(name,already,at) {
      calls.push('fit:'+name);assert.deepEqual(already,['held',null,null,null]);assert.equal(at,0);return fits;
    },
    worth() {throw new Error('gear scope never ranks enchants');},
    scoreOf(s,g) {
      calls.push('score');assert.strictEqual(g,goal);
      return s.gear.weapon.name === 'a' ? 0 : 1;
    }
  };
  const optimiser = createOptimiser(deps);
  assert.deepEqual(calls,[], 'construction reads no live dependency');
  const absent = optimiser.optimiseSteps(state,goal);
  assert.deepEqual(calls,[]);
  assert.throws(()=>absent.next(), {message:'Set up your progression before crafting.'});
  assert.deepEqual(calls,['profile']);
  calls.length=0; profile={mode:'personal'};
  const personal = optimiser.optimiseSteps(state,goal);
  assert.deepEqual(calls,[]);
  assert.throws(()=>personal.next(), {message:'Set up your progression before crafting.'});
  assert.deepEqual(calls,['profile','profile','access']);
  calls.length=0;
  const accessible=optimiser.optimiseSteps(state,goal);
  access={}; // Access becomes available after generator construction.
  assert.deepEqual(accessible.next(),{value:undefined,done:false});
  assert.deepEqual(calls,['profile','profile','access','prepare']);
  accessible.return();
  calls.length=0;
  const lazy = optimiser.optimiseSteps(state,goal);
  profile={mode:'best'}; // Changed after construction, before the first next().
  assert.deepEqual(lazy.next(),{value:undefined,done:false});
  assert.deepEqual(calls,['profile','profile','prepare']);
  profile=null; // The guard is never moved to a wrapper or re-run at a yield.
  let step;
  do {step=lazy.next();} while (!step.done);
  assert.equal(step.value.score,1);
  assert.strictEqual(step.value.state,work);
  assert.equal(calls.filter(one=>one==='profile').length,2);
  assert.equal(calls.filter(one=>one==='items').length,1);
  assert.deepEqual(calls.filter(one=>one.startsWith('fit:')),['fit:a','fit:b']);

  function run(gather = new Map()) {
    calls.length=0; profile={mode:'best'};
    const steps = optimiser.optimiseSteps(state,goal,null,gather);
    let result;
    do {result=steps.next();} while (!result.done);
    assert.equal(calls.filter(one=>one==='items').length,1,'candidate list is reused only inside this search');
    assert.deepEqual(calls.filter(one=>one.startsWith('fit:')),candidates.map(one=>'fit:'+one.name));
    return {result:result.value,gather};
  }
  const first=run();
  assert.deepEqual([...first.gather.keys()],['b']); // a is below this search's best tier.
  candidates=[{name:'a',hand:'weapon',tier:0},{name:'c',hand:'weapon',tier:0}];
  catalogue=data(); fits=false;
  const second=run();
  assert.deepEqual([...second.gather.keys()],['a','c'], 'offered names and best tiers are rebuilt');
  assert.equal(second.result.state.gear.weapon.name,'c');
  assert.notStrictEqual(first.result.state,second.result.state);
  assert.equal(first.result.state.gear.weapon.name,'b');
  assert.deepEqual(state.gear.weapon.ench,['held'],'input and held slots survive');
  const remembered=[...second.gather.values()];
  const third=run(second.gather);
  assert.strictEqual(third.gather,second.gather,'the caller retains its Map');
  [...third.gather.values()].forEach((one,i)=>assert.strictEqual(one,remembered[i],
    'an equal score retains the original offer and gear references'));

  // Interleave two active generators; neither may reuse the other's caches.
  calls.length=0;
  const left=optimiser.optimiseSteps(state,goal), right=optimiser.optimiseSteps(state,goal);
  left.next(); const leftWork=work; right.next(); const rightWork=work;
  assert.notStrictEqual(leftWork,rightWork);
  // searchItems asserts against the appropriate work in this synthetic adapter.
  let l, r;
  do {work=leftWork;l=left.next();work=rightWork;r=right.next();} while (!l.done || !r.done);
  assert.notStrictEqual(l.value.state,r.value.state);
  assert.equal(calls.filter(one=>one==='items').length,2);
  assert.equal(calls.filter(one=>one.startsWith('fit:')).length,4);

  // A live catalogue replacement between yields is read at the next old site.
  profile={mode:'best'}; calls.length=0;
  const live=optimiser.optimiseSteps(state,goal);
  live.next(); // Initial normalisation, no score yet.
  live.next(); // First candidate, no score yet.
  catalogue={get byItem(){throw new Error('replacement catalogue');}};
  assert.throws(()=>live.next(),{message:'replacement catalogue'});

  // Non-finite scores retain Object.is semantics and never enter gather.
  for (const value of [-Infinity,Infinity,NaN,-0]) {
    const reports=[],gather=new Map();
    const kept={...clone(state),locked:{weapon:true,'weapon:0':true}};
    const single=createOptimiser({...deps,getData:()=>({byItem:{},byEnch:{},sets:[]}),
      scoreOf:()=>value});
    const steps=single.optimiseSteps(kept,goal,(...args)=>reports.push(args),gather);
    assert.deepEqual(steps.next(),{value:undefined,done:false});
    const result=steps.next();
    assert.equal(result.done,true);assert.ok(Object.is(result.value.score,value));
    assert.deepEqual(reports,[[1,0,value]]);
    assert.equal(gather.size,Number.isFinite(value) ? 1 : 0);
  }
}
optimiserParity().catch(error => { console.error(error); process.exitCode = 1; });
