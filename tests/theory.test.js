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
