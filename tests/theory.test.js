'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), vm = require('vm');
const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/TheoryCraft/theorycraft.json'), 'utf8'));
const harness = require('./theory-harness');
const engine = require('../web/engine');
const t = harness({}, raw, false);
const portraitHelpers = (() => {
  const file = path.join(root, 'web/theorycraft.js');
  const marker = 'return { start, share, open, put };';
  const script = fs.readFileSync(file, 'utf8').replace(marker,
    'return { facePortrait, faceStyle };');
  const context = { window: {}, module: { exports: {} }, console,
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
      backgroundPosition: '-4410px -3260.25px',
      backgroundSize: '5376px 3617.25px'
    },
    Assassin: {
      backgroundPosition: '-1008px -3302.25px',
      backgroundSize: '5376px 3617.25px'
    },
    Bard: {
      backgroundPosition: '-2016px -3302.25px',
      backgroundSize: '5376px 3617.25px'
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
