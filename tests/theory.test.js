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
const targetHelpers = (() => {
  const file = path.join(root, 'web/theorycraft.js');
  const marker = 'return { start, share, open, put };';
  const script = fs.readFileSync(file, 'utf8').replace(marker,
    'return { targetBounds, targetFit, sheetIcon, setTargetTestData: v => { data = v; } };');
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
  assert.ok(/drawPiece\(pen, piece, frameOf\(piece, 0, duel\.at\), bossX, floor, room, true\)/.test(source),
    'the bench must draw its target through the measured window');
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
