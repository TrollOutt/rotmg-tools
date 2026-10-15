'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), vm = require('vm');
const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/TheoryCraft/theorycraft.json'), 'utf8'));
const harness = require('./theory-harness');
const engine = require('../web/engine');
const t = harness({}, raw, false);
assert.equal(t.weaponRate, require('../web/theory-engine').weaponRate,
  'TheoryCraft must use the extracted weapon calculation directly');
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
  assert.deepEqual(Object.keys(got.from), ['gear', 'ench', 'set', 'exalt', 'rel', 'share', 'bonus']);
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

// Keep the original numbersFor body independent of the extracted implementation.
// Compare every leaf exactly, including non-finite numbers and property order;
// JSON round-tripping would hide NaN, -0 and the immune Set.
{
  const { createNumbers } = require('../web/theory-engine');
  const api = harness({}, raw, false);
  const clone = value => JSON.parse(JSON.stringify(value));
  let data = clone(raw);
  api.configure(data);
  const { statsOf, scaleOf, subOf, weaponRate, abilityRate, effectsFor, fxOf } = api;
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
    const effects = effectsFor(state, stats.now);
    const fx = fxOf(effects);
    const gun = using === 'spell' ? NONE
      : weaponRate(weapon, stats.now, def, scale, subOf(state), fx);
    const spell = using === 'gun' ? NONE : abilityRate(ability, stats.now, def, fx);
    const bleed = effects ? effects.bleed : 0;
    return { stats, gun, spell, effects, bleed, total: gun.dps + spell.dps + bleed };
  }

  const extracted = createNumbers({ getData: () => data,
    statsOf, scaleOf, subOf, weaponRate, abilityRate, effectsFor, fxOf });
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
  assert.strictEqual(bleeding.spell.dps, 0, 'the ability stays inactive even with its status effects');
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

// Frozen goal selection before extraction. Only the closure bindings become
// callbacks; optimisation, scoring and share arithmetic use the existing APIs.
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
  const old = legacy({ ...dependencies, getBuild: () => build });
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
  const live = createGoals(localDeps), prior = legacy({ ...localDeps, getBuild: () => at });
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

// The composition seam preserves call order, object identity and the one
// shared inactive result, without reading globals or introducing a cache.
{
  const { createNumbers } = require('../web/theory-engine');
  const calls = [], state = { gear: { weapon: { name: 'w' }, ability: { name: 'a' } } };
  const stats = { now: { att: 50, dex: 75 } }, scale = {}, subs = [];
  const effects = { bleed: 1 }, fx = {}, gun = { dps: 1e16 };
  const weapon = {}, ability = {};
  let current = { byItem: { get w() { calls.push('weapon'); return weapon; },
    get a() { calls.push('ability'); return ability; } } };
  let valid = true, expectedWeapon = weapon;
  const dependencies = {
    getData() { calls.push('data'); return current; },
    statsOf(s) { calls.push('stats'); assert.strictEqual(s, state); return valid ? stats : null; },
    scaleOf(s) { calls.push('scale'); assert.strictEqual(s, state); return scale; },
    effectsFor(s, now) { calls.push('effects'); assert.strictEqual(s, state);
      assert.strictEqual(now, stats.now); return effects; },
    fxOf(e) { calls.push('fx'); assert.strictEqual(e, effects); return fx; },
    subOf(s) { calls.push('sub'); assert.strictEqual(s, state); return subs; },
    weaponRate(w, now, def, by, extra, f) {
      calls.push('rate');
      assert.strictEqual(w, expectedWeapon); assert.strictEqual(now, stats.now);
      assert.strictEqual(def, -0); assert.strictEqual(by, scale);
      assert.strictEqual(extra, subs); assert.strictEqual(f, fx);
      return gun;
    },
    abilityRate() { assert.fail('the inactive ability must not be evaluated'); }
  };
  const calculations = createNumbers(dependencies);
  assert.deepStrictEqual(calls, [], 'construction does not read data or status');
  const first = calculations.numbersFor(state, -0);
  assert.deepStrictEqual(calls, ['stats', 'data', 'weapon', 'data', 'ability', 'scale', 'effects', 'fx', 'sub', 'rate']);
  assert.strictEqual(first.stats, stats); assert.strictEqual(first.gun, gun);
  assert.strictEqual(first.effects, effects);
  assert.deepStrictEqual(Object.keys(first), ['stats', 'gun', 'spell', 'effects', 'bleed', 'total']);
  assert.deepStrictEqual(Object.keys(first.spell), ['each', 'rate', 'many', 'every', 'dps']);
  first.spell.dps = -1e16;
  calls.length = 0;
  current = { byItem: { w: expectedWeapon = {} } };
  const second = calculations.numbersFor(state, -0);
  assert.strictEqual(second.spell, first.spell, 'inactive result stays shared and mutable');
  assert.strictEqual(second.total, 1, 'addition stays left associative, including the shared spell term');
  assert.notStrictEqual(second, first, 'the composite result remains fresh');
  assert.notStrictEqual(createNumbers(dependencies).numbersFor(state, -0).spell, first.spell,
    'each caller owns its inactive result');
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
      backgroundPosition: '-3528px -4089.75px',
      backgroundSize: '5376px 4478.25px'
    },
    Assassin: {
      backgroundPosition: '-4788px -4089.75px',
      backgroundSize: '5376px 4478.25px'
    },
    Bard: {
      backgroundPosition: '-504px -4131.75px',
      backgroundSize: '5376px 4478.25px'
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
        return EnchantEngine.rollablePool(held, cfg);
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
         * nought to say they can never come out again. The seasonal ones -
         * Warm and Cozy, Glorious, Snowstorm - come out of an engraving held
         * at the time, not out of enchanting, and the client marks the
         * difference with a ROLLABLE label. This page has no artifact in it,
         * so it plans with what a plain enchanting can roll and nothing else.
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
      rollablePool() { trace.push('pool'); return pool; }
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
    rollablePool(rules, config) { poolRules = rules; cfg = config; return pool; }
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
  const expected = engine.rollablePool(shared, cfg).map(mod => ruleName(mod.name)).sort();
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

console.log('TheoryCraft: target windows, fitting, frame stride and real targets check out.');
