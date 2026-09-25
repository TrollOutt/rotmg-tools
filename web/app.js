/*
 * Browser layer for the RotMG enchant calculator.
 *
 * Every probability, weight and cost comes from web/engine.js, which is also
 * exercised by tests/engine.test.js. This file only loads the original data
 * files, keeps the editor state and renders it.
 */
'use strict';

const ROOT = '../data/';
const SUBTYPES = ['SUMMONPOWERED', 'ALIEN', 'NEO_ALIEN'];
const RARITIES = ['uncommon', 'rare', 'legendary', 'divine'];
const SAVE_KEY = 'rotmg-enchant-calculator/v1';
// A view preference, not part of a saved setup: it belongs to the reader,
// not to the item being planned.
// Bumped when the defaults change, so a returning player sees the new ones
// rather than a stored copy of the old.
const FILTER_KEY = 'rotmg-enchant-calculator/filters/2';
const TABS_KEY = 'rotmg-enchant-calculator/tabs/v1';

/*
 * tools/build-standalone.js produces a single HTML file that carries the
 * original data files and every sprite as inline data: URIs, under
 * window.ROTMG_BUNDLE. That build opens straight from the file system, where
 * fetch() is blocked. Without a bundle the app falls back to fetching the
 * files from disk, which is what the local dev server serves.
 */
const BUNDLE = typeof window !== 'undefined' && window.ROTMG_BUNDLE ? window.ROTMG_BUNDLE : null;

const $ = id => document.getElementById(id);
const esc = value => encodeURI(String(value)).replace(/#/g, '%23');
function asset(...parts) {
  if (BUNDLE) {
    const embedded = BUNDLE.assets[parts.join('/')];
    // An asset missing from the bundle must not fall back to a relative path:
    // the <img> onerror handler hides it, which is the intended behaviour.
    return embedded || '';
  }
  return ROOT + parts.map(esc).join('/');
}
const html = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const state = {
  data: null,
  ready: false,
  slots: [1, 2, 3, 4].map(index => ({ index, name: '', locked: false })),
  lastResults: null,
  picker: null,
  tabs: [],
  itemArt: null,   // the index's sheet, and where each item sits on it
  theory: null,
  itemOptimizeGoal: 'dps',
  itemOptimizeSaid: '',
  itemOptimizeBlocked: '',
  itemOptimizeRunning: false,
  updateMade: null,   // when the update the data covers went out
  activeTab: null,
  loadingTab: false,
  lastCardItem: null,
  // Which kinds of artifact the table lists. Tarot only by default: they are
  // the ones you actually find in game.
  /*
   * The two you can go and get are on; the two you cannot are off.
   *
   * Tarot cards drop all year and the Special artifacts drop in their own
   * dungeons, so both are part of an ordinary plan. Engravings come from
   * seasonal events and Premium cards are bought with money, so neither belongs
   * in a default answer to "what should I use" — they stay one click away.
   */
  filters: { tarot: true, special: true, engraving: false, premium: false },
  // Which run is the current one, and the timer that coalesces the next.
  runId: 0,
  calcTimer: 0,
  tabTimer: 0
};

/* ------------------------------------------------------------------ *
 * Formatting                                                          *
 * ------------------------------------------------------------------ */

function count(value) {
  if (!Number.isFinite(value)) return '∞';
  return RealmI18n.number(Math.round(value));
}
function percent(value) {
  if (!(value > 0)) return '0%';
  if (value < 0.0001) return `<${RealmI18n.number(0.0001, { maximumFractionDigits: 4 })}%`;
  return `${RealmI18n.number(value, { maximumSignificantDigits: 4 })}%`;
}
function plural(value, word) { return `${value} ${word}${value === 1 ? '' : 's'}`; }

// Hand control back to the browser between chunks of work. A timer is used
// rather than requestAnimationFrame, which never fires while the tab is hidden
// and would leave a long calculation stuck at "Calculating…".
const yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0));

/*
 * Yield only when the frame budget is spent.
 *
 * The artifact loop used to hand control back after every one of the 25
 * artifacts. That made sense when a single one could take a moment; the whole
 * table now takes about 40 ms, and a browser clamps setTimeout(0) to some
 * milliseconds, so the yielding cost an order of magnitude more than the work
 * and the table took half a second to appear. Yielding on a time budget keeps
 * the interface responsive if the work ever grows, and costs one pause today.
 */
function budgetedYield(budgetMs) {
  let since = performance.now();
  return async () => {
    if (performance.now() - since < budgetMs) return;
    await yieldToUi();
    since = performance.now();
  };
}

/* ------------------------------------------------------------------ *
 * Sprites                                                             *
 * ------------------------------------------------------------------ */

// Enchantment sprites are stored per awakened/unique name, otherwise per
// Label family. Anything unmatched falls back to a neutral placeholder rather
// than a broken image.
function enchantIcon(mod) {
  if (!mod) return null;
  if (mod.tags.has('AWAKENED')) return mod.name;
  if (mod.tags.has('UNIQUE')) return mod.weight === 750 ? 'UNIQUEFROZEN' : 'UNIQUE';
  for (const tag of ['NEO_ALIEN', 'ALIEN', 'SINGLESTAT', 'DUALSTAT', 'PROC', 'REWARDBONUS', 'DAMAGE', 'WEAPONRANGE', 'CASTING', 'MANAREGEN', 'LIFEREGEN', 'DAMAGERESISTANCE', 'DUALREWARDBONUS']) {
    if (mod.tags.has(tag)) return tag;
  }
  return null;
}
function enchantIconHtml(mod, className) {
  const icon = enchantIcon(mod);
  const src = icon ? asset('GUI Files', 'Enchantment Icons', `${icon}.png`) : '';
  return `<img class="${className}${src ? '' : ' missing'}" ${src ? `src="${src}"` : ''} alt="" loading="lazy" onerror="this.classList.add('missing');this.removeAttribute('src')">`;
}
// Group artwork exists only for the names in the Qt file, not for the hundred
// items the wiki mapping adds — those carry their own sprite. Guarding on that
// stops a request firing for a picture that was never shipped.
function itemSpriteName(item) {
  if (!item || !state.data || !state.data.awokenArt.has(item)) return null;
  return state.data.spriteAlias[item] || item;
}

/*
 * Artwork for an item, from the one place the site keeps it.
 *
 * The picture is a rectangle on the index's sheet, cut out of the installed
 * client - which means every page of this site draws the same item the same
 * way, and an item the game added this morning has its picture the moment the
 * index is rebuilt. What used to be here was a folder of downloaded wiki
 * renders that this page read and no other did, so the calculator and the
 * bench disagreed about which items had a picture at all.
 *
 * The awakenable group artwork stays as a second answer: it is one drawing for
 * a whole family, which is not a thing the client has a sprite for.
 */
function itemArtRect(name, awokenKey) {
  const art = state.itemArt && state.itemArt.art;
  if (!art) return null;
  return art[name] || (awokenKey ? art[awokenKey] : null) || null;
}

/*
 * A window onto that sheet, the picture's own shape kept: an eight by eight
 * ring and a sixteen by eight bow are not both squared off into the same box.
 */
function sheetArt(rect, side, className) {
  const [x, y, w, h] = rect;
  const zoom = side / Math.max(w, h);
  const sheet = state.itemArt.sheet;
  return `<span class="${className} sheet-art" style="width:${w * zoom}px;height:${h * zoom}px`
    + `;background-size:${sheet.wide * zoom}px ${sheet.tall * zoom}px`
    + `;background-position:${-x * zoom}px ${-y * zoom}px"></span>`;
}

function itemArt(name, awokenKey, side, className) {
  const rect = itemArtRect(name, awokenKey);
  if (rect) return sheetArt(rect, side, className);
  const group = itemSpriteName(awokenKey || name);
  const src = group ? asset('GUI Files', 'Awakenable Items', `${group}.png`) : '';
  return src ? `<img class="${className}" src="${src}" alt="" loading="lazy" onerror="this.classList.add('missing')">` : '';
}

const hasItemArt = (name, awokenKey) =>
  !!(itemArtRect(name, awokenKey) || itemSpriteName(awokenKey || name));

/* ------------------------------------------------------------------ *
 * What the item itself tells us                                       *
 * ------------------------------------------------------------------ */

/*
 * Two independent sources, merged:
 *   - web/items.js, from the wiki reroll tables, gives slot + dust;
 *   - awakenedItems.txt gives the Awoken enchantment an item unlocks, and
 *     through that enchantment's own labels, the slot and whether the base is
 *     alien.
 * The second covers items the first has never heard of (the AoO sets, the
 * alien reskins), so between them most items resolve. Anything left over is
 * simply filled in by hand, and the interface says which fields it could not
 * work out.
 */
function resolveItem(name) {
  if (!name || !state.data) return null;
  const known = typeof EnchantItems !== 'undefined' ? EnchantItems.lookup(name) : null;

  // Match the awakenable list case-insensitively too.
  let awokenKey = state.data.awakenings.has(name) ? name : null;
  if (!awokenKey) {
    const target = name.trim().toLowerCase();
    for (const key of state.data.awakenings.keys()) if (key.toLowerCase() === target) { awokenKey = key; break; }
  }
  const awoken = awokenKey ? state.data.awakenings.get(awokenKey) : null;
  if (!known && !awoken) return null;

  const resolved = {
    name: known ? known.name : awokenKey,
    awokenKey,
    awoken: awoken || [],
    type: known ? known.type : null,
    dust: known ? known.dust : null,
    tiered: Boolean(known && known.tiered),
    note: known && known.note ? known.note : '',
    // Alien or Neo Alien, straight from the catalogue when the item has one.
    special: known && known.base ? known.base : null,
    source: known ? (awoken ? 'both' : 'wiki') : 'awakened'
  };

  if (awoken && awoken.length) {
    const mod = state.data.byName.get(awoken[0]);
    if (mod) {
      if (!resolved.type) resolved.type = [...mod.itemTags][0] || null;
      // Fallback for an awakenable item the catalogue does not carry: an
      // awakened enchantment tagged ALIEN belongs to an alien base, and the
      // "Neo" reskins use the NEO_ALIEN pool. The catalogue wins when it knows.
      if (!resolved.special && mod.tags.has('ALIEN')) resolved.special = /\bneo\b/i.test(resolved.name) ? 'NEO_ALIEN' : 'ALIEN';
    }
  }
  return resolved;
}

// Everything the item picker can offer: named gear, tiered placeholders and
// every awakenable item, de-duplicated.
function knownItemNames() {
  const names = new Set();
  if (typeof EnchantItems !== 'undefined') for (const name of EnchantItems.index.keys()) names.add(name);
  if (state.data) for (const name of state.data.awakenings.keys()) names.add(name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ *
 * Configuration read from the editor                                  *
 * ------------------------------------------------------------------ */

function filledSlots() { return state.slots.filter(slot => slot.name); }

function cfg() {
  const filled = filledSlots();
  const wanted = filled.filter(slot => !slot.locked).map(slot => slot.name);
  return {
    slots: Number($('rarity').value) || 0,
    type: $('itemType').value,
    dust: $('dustType').value,
    item: $('awakenedItem').value.trim(),
    subtypes: new Set([...document.querySelectorAll('#subtypePanel input:checked')].map(box => box.value)),
    tiers: new Set([...document.querySelectorAll('#tiers input:checked')].map(box => Number(box.value))),
    locks: filled.filter(slot => slot.locked).map(slot => slot.name),
    desired: wanted[0] || '',
    goals: wanted.slice(1)
  };
}


/* ------------------------------------------------------------------ *
 * Optimising the enchantments on one item                             *
 * ------------------------------------------------------------------ */

const ITEM_OPTIMIZER_GOALS = [
  { id: 'dps', say: 'Damage a second' },
  { id: 'stat:hp', say: 'Life' },
  { id: 'stat:mp', say: 'Magic' },
  { id: 'stat:att', say: 'Attack' },
  { id: 'stat:def', say: 'Defence' },
  { id: 'stat:spd', say: 'Speed' },
  { id: 'stat:dex', say: 'Dexterity' },
  { id: 'stat:vit', say: 'Vitality' },
  { id: 'stat:wis', say: 'Wisdom' }
];

const ITEM_OPTIMIZER_OF_STAT = {
  HP: 'hp',
  MAXHP: 'hp',
  MP: 'mp',
  MAXMP: 'mp',
  ATT: 'att',
  DEF: 'def',
  SPD: 'spd',
  DEX: 'dex',
  VIT: 'vit',
  WIS: 'wis'
};

const ITEM_OPTIMIZER_NUMERAL = /\s+(?:[IVX]+|\d+)$/;

const ITEM_OPTIMIZER_ALIASES = new Map([
  ['mana -attacktradeoff', 'mana -attack tradeoff'],
  ['pirates expertise', "pirate's expertise"],
  ['vampric lifeforce', 'vampiric lifeforce']
]);

function itemOptimizerEnchantKey(name) {
  let key = String(name || '')
    .replace(ITEM_OPTIMIZER_NUMERAL, '')
    .trim()
    .toLowerCase();

  return ITEM_OPTIMIZER_ALIASES.get(key) || key;
}

function itemOptimizerWorth(one) {
  if (!one) return 0;

  let value = Object.values(one.worn || {})
    .reduce((sum, n) => sum + Math.abs(Number(n) || 0), 0);

  if (one.mul) {
    value += Object.values(one.mul)
      .reduce((sum, n) => sum + Math.abs((Number(n) || 1) - 1) * 100, 0);
  }

  for (const part of one.rel || []) {
    value += Math.abs(Number(part.pct) || 0) / 2;
  }

  for (const part of one.sub || []) {
    const shot = part.shots && part.shots[0];
    if (shot) value += Math.abs(Number(shot.high || shot.low) || 0) / 4;
  }

  return value;
}

async function loadItemOptimizerTheory() {
  let raw =
    BUNDLE &&
    BUNDLE.sources &&
    BUNDLE.sources.theoryText;

  if (!raw) {
    for (const url of [
      'assets/theory/theorycraft.json',
      '../data/TheoryCraft/theorycraft.json'
    ]) {
      raw = await fetch(url)
        .then(response => response.ok ? response.text() : '')
        .catch(() => '');

      if (raw) break;
    }
  }

  if (!raw) return null;

  try {
    const out = JSON.parse(raw);

    out.byItem = new Map(
      (out.items || []).map(one => [one.name, one])
    );

    out.byCharm = new Map();

    for (const one of out.enchants || []) {
      const key = itemOptimizerEnchantKey(one.name);
      const had = out.byCharm.get(key);

      if (!had || itemOptimizerWorth(one) > itemOptimizerWorth(had)) {
        out.byCharm.set(key, one);
      }
    }

    return out;
  } catch (error) {
    console.error('Item optimizer mechanics could not be loaded:', error);
    return null;
  }
}

let itemOptimizerTheoryPromise = null;

async function ensureItemOptimizerTheory() {
  if (state.theory) return state.theory;
  if (itemOptimizerTheoryPromise) return itemOptimizerTheoryPromise;

  itemOptimizerTheoryPromise = loadItemOptimizerTheory()
    .then(theory => {
      state.theory = theory;
      return theory;
    })
    .finally(() => {
      itemOptimizerTheoryPromise = null;
    });

  return itemOptimizerTheoryPromise;
}

function itemOptimizerCharm(name) {
  if (!state.theory || !state.theory.byCharm) return null;

  return state.theory.byCharm.get(
    itemOptimizerEnchantKey(name)
  ) || null;
}

function itemOptimizerStats(item, names) {
  const out = {
    hp: 0,
    mp: 0,
    att: 0,
    def: 0,
    spd: 0,
    dex: 0,
    vit: 0,
    wis: 0
  };

  const addWorn = worn => {
    for (const tag of Object.keys(worn || {})) {
      const key = ITEM_OPTIMIZER_OF_STAT[tag];
      if (!key) continue;

      out[key] += Number(worn[tag]) || 0;
    }
  };

  addWorn(item && item.worn);

  const charms = names
    .map(itemOptimizerCharm)
    .filter(Boolean);

  for (const charm of charms) {
    addWorn(charm.worn);
  }

  /*
   * Relative enchantments use Bonus Stat. For this page "this item only"
   * means the bonus supplied by the selected item and its enchantments.
   */
  const bonus = Object.assign({}, out);

  const takeRelative = part => {
    const key = ITEM_OPTIMIZER_OF_STAT[part.stat];
    const from = ITEM_OPTIMIZER_OF_STAT[part.of];

    if (!key || !from) return;

    out[key] +=
      (bonus[from] || 0) *
      (Number(part.pct) || 0) /
      100;
  };

  for (const part of (item && item.rel) || []) {
    takeRelative(part);
  }

  for (const charm of charms) {
    for (const part of charm.rel || []) {
      takeRelative(part);
    }
  }

  /*
   * Item shares are applied after relative bonuses, matching TheoryCraft.
   */
  const stood = Object.assign({}, out);

  for (const part of (item && item.share) || []) {
    const key = ITEM_OPTIMIZER_OF_STAT[part.stat];
    const from = ITEM_OPTIMIZER_OF_STAT[part.of];

    if (!key || !from) continue;

    out[key] +=
      (stood[from] || 0) *
      (Number(part.pct) || 0) /
      100;
  }

  return out;
}

function itemOptimizerScale(names) {
  const out = {
    dmg: 1,
    rate: 1,
    life: 1,
    fast: 1
  };

  for (const name of names) {
    const charm = itemOptimizerCharm(name);

    if (!charm || !charm.mul) continue;

    for (const key of Object.keys(out)) {
      if (charm.mul[key] !== undefined) {
        out[key] *= charm.mul[key];
      }
    }
  }

  return out;
}

function itemOptimizerSubs(names) {
  const out = [];

  for (const name of names) {
    const charm = itemOptimizerCharm(name);

    for (const part of (charm && charm.sub) || []) {
      out.push(part);
    }
  }

  return out;
}

const ITEM_OPTIMIZER_SHOTS_AT =
  dex => 1.5 + 6.5 * (dex / 75);

function itemOptimizerLanded(roll, att, def, pierce) {
  const dealt = roll * (0.5 + att / 50);

  if (pierce) return dealt;

  return Math.max(
    dealt * 0.15,
    dealt - def
  );
}

function itemOptimizerBurstCycle(burst, rate, dex) {
  if (!burst || !(burst.many > 1) || !(rate > 0)) {
    return null;
  }

  const quick =
    Math.max(0, Math.min(1, dex / 75));

  const wait =
    burst.wait +
    (burst.rush - burst.wait) * quick;

  const run = burst.many / rate;

  return {
    every: Math.max(run, wait),
    shots: burst.many
  };
}

function itemOptimizerWeaponDps(
  item,
  stats,
  scale,
  extra
) {
  if (!item || !item.shots || !item.shots.length) {
    return 0;
  }

  const by =
    scale || {
      dmg: 1,
      rate: 1,
      life: 1,
      fast: 1
    };

  const swaps =
    (extra || []).filter(one => one.how === 'set');

  const channels = !swaps.length
    ? item.shots.filter(one => one.subattack)
    : [];

  if (channels.length) {
    let dps = 0;
    let firstCycle = null;

    for (const shot of channels) {
      const roll =
        (
          shot.low +
          (
            shot.high === undefined
              ? shot.low
              : shot.high
          )
        ) / 2 * by.dmg;

      const each =
        itemOptimizerLanded(
          roll,
          stats.att,
          0,
          shot.pierce
        );

      const ownRate =
        shot.rate === undefined
          ? (
              item.rate === undefined
                ? 1
                : item.rate
            )
          : shot.rate;

      const rate =
        ITEM_OPTIMIZER_SHOTS_AT(stats.dex) *
        ownRate *
        by.rate;

      const many =
        shot.many ||
        item.many ||
        1;

      const cycle =
        itemOptimizerBurstCycle(
          shot.burst || item.burst,
          rate,
          stats.dex
        );

      if (!firstCycle && cycle) {
        firstCycle = cycle;
      }

      dps += cycle
        ? each * many * cycle.shots / cycle.every
        : each * many * rate;
    }

    let along = 0;

    for (const one of extra || []) {
      if (one.how !== 'add') continue;

      const shot = one.shots && one.shots[0];
      if (!shot) continue;

      const roll =
        (
          shot.low +
          (
            shot.high === undefined
              ? shot.low
              : shot.high
          )
        ) / 2 * by.dmg;

      along +=
        itemOptimizerLanded(
          roll,
          stats.att,
          0,
          shot.pierce
        ) *
        (one.many || 1);
    }

    if (along) {
      const first = channels[0];

      const ownRate =
        first.rate === undefined
          ? (
              item.rate === undefined
                ? 1
                : item.rate
            )
          : first.rate;

      const rate =
        ITEM_OPTIMIZER_SHOTS_AT(stats.dex) *
        ownRate *
        by.rate;

      dps += firstCycle
        ? along * firstCycle.shots / firstCycle.every
        : along * rate;
    }

    return dps;
  }

  const shot =
    swaps.length
      ? swaps[swaps.length - 1].shots[0]
      : item.shots[0];

  const roll =
    (
      shot.low +
      (
        shot.high === undefined
          ? shot.low
          : shot.high
      )
    ) / 2 * by.dmg;

  const each =
    itemOptimizerLanded(
      roll,
      stats.att,
      0,
      shot.pierce
    );

  const rate =
    ITEM_OPTIMIZER_SHOTS_AT(stats.dex) *
    (
      item.rate === undefined
        ? 1
        : item.rate
    ) *
    by.rate;

  const many =
    (
      swaps.length
        ? swaps[swaps.length - 1].many
        : item.many
    ) || 1;

  const cycle =
    itemOptimizerBurstCycle(
      item.burst,
      rate,
      stats.dex
    );

  let along = 0;

  for (const one of extra || []) {
    if (one.how !== 'add') continue;

    const added =
      one.shots && one.shots[0];

    if (!added) continue;

    const middle =
      (
        added.low +
        (
          added.high === undefined
            ? added.low
            : added.high
        )
      ) / 2 * by.dmg;

    along +=
      itemOptimizerLanded(
        middle,
        stats.att,
        0,
        added.pierce
      ) *
      (one.many || 1);
  }

  const perShot =
    each * many + along;

  return cycle
    ? perShot * cycle.shots / cycle.every
    : perShot * rate;
}

const ITEM_OPTIMIZER_REFERENCE_WEAPON = {
  hand: 'weapon',
  rate: 1,
  many: 1,
  shots: [{
    low: 100,
    high: 100,
    fast: 8,
    reach: 7
  }]
};

function itemOptimizerScore(goalId, item, names) {
  const stats =
    itemOptimizerStats(item, names);

  if (goalId.startsWith('stat:')) {
    return stats[goalId.slice(5)] || 0;
  }

  const weapon =
    item &&
    item.hand === 'weapon' &&
    item.shots &&
    item.shots.length
      ? item
      : ITEM_OPTIMIZER_REFERENCE_WEAPON;

  return itemOptimizerWeaponDps(
    weapon,
    {
      att: 75 + (stats.att || 0),
      dex: 75 + (stats.dex || 0)
    },
    itemOptimizerScale(names),
    itemOptimizerSubs(names)
  );
}

function itemOptimizerFits(
  mod,
  lockedNames,
  pickedNames
) {
  const others = [];
  let index = 1;

  for (const name of lockedNames) {
    others.push({
      index: index++,
      name,
      locked: true
    });
  }

  for (const name of pickedNames) {
    others.push({
      index: index++,
      name,
      locked: false
    });
  }

  const slot = {
    index,
    name: mod.name,
    locked: false
  };

  return !conflictWith(
    mod,
    slot,
    others
  );
}

function renderItemOptimizer(config) {
  const card = $('itemOptimizer');
  if (!card) return;

  card.hidden = !config.item;

  if (!config.item) return;

  for (const button of
    $('itemOptimizeGoals')
      .querySelectorAll('[data-item-goal]')) {
    button.classList.toggle(
      'is-on',
      button.dataset.itemGoal ===
        state.itemOptimizeGoal
    );
  }

  const run = $('itemOptimizeRun');
  const hint = $('itemOptimizeHint');

  const visible =
    state.slots.slice(
      0,
      Number(config.slots) || 0
    );

  const openCount =
    visible.filter(slot => !slot.locked).length;

  const lockedCount =
    visible.length - openCount;

  const impossible =
    !config.slots ||
    !config.type ||
    !openCount;

  run.disabled =
    impossible ||
    state.itemOptimizeRunning ||
    Boolean(state.itemOptimizeBlocked);

  run.textContent =
    state.itemOptimizeRunning
      ? (state.theory ? 'Optimizing...' : 'Loading...')
      : state.itemOptimizeBlocked
        ? 'No improvement'
        : 'Optimize';

  hint.classList.remove('warn');

  if (!state.theory) {
    hint.textContent =
      'Build mechanics load only when you press Optimize.';

  } else if (!config.slots) {
    hint.textContent =
      'Choose the rarity first so the optimizer knows how many slots it may fill.';

  } else if (!config.type) {
    hint.textContent =
      'The item type is needed before its enchantments can be optimized.';

  } else if (!openCount) {
    hint.textContent =
      'All ' +
      visible.length +
      ' enchantment slots are marked On item. Unlock at least one slot before optimizing another stat.';
    hint.classList.add('warn');

  } else if (state.itemOptimizeBlocked) {
    hint.textContent =
      state.itemOptimizeBlocked;
    hint.classList.add('warn');

  } else if (state.itemOptimizeGoal === 'dps') {
    hint.textContent =
      'Weapon DPS uses the real weapon. On other gear, DPS measures this item against a neutral 75 ATT / 75 DEX weapon at 0 DEF.';

  } else {
    hint.textContent =
      lockedCount
        ? lockedCount +
          (lockedCount === 1
            ? ' enchantment is'
            : ' enchantments are') +
          ' kept On item. The optimizer may use the other ' +
          openCount +
          (openCount === 1 ? ' slot.' : ' slots.')
        : 'Only this item is optimized. All available slots may be replaced.';
  }

  $('itemOptimizeSaid').textContent =
    state.itemOptimizeSaid || '';
}

function itemOptimizerGoal() {
  return ITEM_OPTIMIZER_GOALS.find(
    one => one.id === state.itemOptimizeGoal
  ) || ITEM_OPTIMIZER_GOALS[0];
}

async function optimizeCurrentItem() {
  const config = cfg();
  const run = $('itemOptimizeRun');

  if (
    !config.item ||
    !config.slots ||
    !config.type
  ) {
    renderItemOptimizer(config);
    return;
  }

  if (!state.theory) {
    state.itemOptimizeRunning = true;
    state.itemOptimizeSaid = 'Loading build mechanics...';
    renderItemOptimizer(config);

    const theory = await ensureItemOptimizerTheory();

    state.itemOptimizeRunning = false;

    if (!theory) {
      state.itemOptimizeSaid =
        'Build mechanics could not be loaded. Try again.';
      renderItemOptimizer(config);
      return;
    }
  }

  const goal = itemOptimizerGoal();
  const item =
    state.theory.byItem.get(config.item) ||
    null;

  const visible =
    state.slots.slice(0, config.slots);

  const lockedSlots =
    visible.filter(
      slot => slot.name && slot.locked
    );

  const openSlots =
    visible.filter(
      slot => !slot.locked
    );

  const lockedNames =
    lockedSlots.map(slot => slot.name);

  if (!openSlots.length) {
    state.itemOptimizeSaid =
      'Every slot is already marked On item.';
    renderItemOptimizer(config);
    return;
  }

  const poolConfig = {
    item: config.item,
    type: config.type,
    slots: config.slots,
    locks: lockedNames,
    subtypes: config.subtypes
  };

  const candidates =
    EnchantEngine
      .rollablePool(
        state.data,
        poolConfig
      )
      .filter(mod =>
        itemOptimizerCharm(mod.name)
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name)
      );

  if (!candidates.length) {
    state.itemOptimizeSaid = '';
    state.itemOptimizeBlocked =
      'No rollable enchantment is compatible with the enchantments marked On item. Unlock one of them, or choose another goal.';

    refresh();
    return;
  }

  state.itemOptimizeBlocked = '';
  state.itemOptimizeRunning = true;
  state.itemOptimizeSaid =
    'Trying enchantment combinations...';
  renderItemOptimizer(config);

  await yieldToUi();

  const score = picked =>
    itemOptimizerScore(
      goal.id,
      item,
      lockedNames.concat(picked)
    );

  const baseScore = score([]);

  let best = {
    picked: [],
    score: baseScore,
    next: 0
  };

  let beam = [best];
  let looked = 1;

  /*
   * LIMIT bounds what survives each beam level, not how much work is needed
   * to build that level. Large real pools can still mean hundreds of
   * thousands of candidate evaluations, so yield on the same frame budget as
   * the calculator without changing which candidates are considered.
   */
  const optimizerBreathe = budgetedYield(12);
  const LIMIT = 1200;
  const EPSILON = 1e-9;

  for (
    let depth = 0;
    depth < openSlots.length;
    depth++
  ) {
    const expanded = [];

    for (const branch of beam) {
      for (
        let at = branch.next;
        at < candidates.length;
        at++
      ) {
        await optimizerBreathe();
        const mod = candidates[at];

        if (
          !itemOptimizerFits(
            mod,
            lockedNames,
            branch.picked
          )
        ) {
          continue;
        }

        const picked =
          branch.picked.concat(mod.name);

        const value = score(picked);
        looked++;

        const next = {
          picked,
          score: Number.isFinite(value)
            ? value
            : -Infinity,
          next: at + 1
        };

        expanded.push(next);

        if (
          next.score >
          best.score + EPSILON
        ) {
          best = next;
        }
      }
    }

    if (!expanded.length) break;

    expanded.sort((a, b) =>
      b.score - a.score ||
      a.picked.length - b.picked.length ||
      a.picked.join('\0')
        .localeCompare(
          b.picked.join('\0')
        )
    );

    beam =
      expanded.slice(0, LIMIT);

    await yieldToUi();
  }

  /*
   * Put the most important result first. The calculator treats the first
   * wanted slot as the headline target for its artifact table and tier picker.
   */
  const ordered =
    best.picked
      .map(name => {
        const without =
          best.picked.filter(
            other => other !== name
          );

        return {
          name,
          loss:
            best.score -
            score(without)
        };
      })
      .sort((a, b) =>
        b.loss - a.loss ||
        a.name.localeCompare(b.name)
      )
      .map(one => one.name);

  for (const slot of openSlots) {
    slot.name = '';
    slot.locked = false;
  }

  ordered.forEach((name, index) => {
    if (openSlots[index]) {
      openSlots[index].name = name;
    }
  });

  state.itemOptimizeRunning = false;

  if (ordered.length) {
    state.itemOptimizeBlocked = '';
    state.itemOptimizeSaid =
      'Selected ' +
      plural(
        ordered.length,
        'enchantment'
      ) +
      ' for ' +
      goal.say +
      ' · ' +
      RealmI18n.number(looked) +
      ' combinations tried.';
  } else {
    state.itemOptimizeSaid = '';

    const remaining =
      openSlots.length;

    const fixed =
      lockedNames.length;

    state.itemOptimizeBlocked =
      'No compatible rollable enchantment improves ' +
      goal.say.toLowerCase() +
      ' in the ' +
      remaining +
      (remaining === 1
        ? ' remaining slot.'
        : ' remaining slots.') +
      (fixed
        ? ' The ' +
          fixed +
          (fixed === 1
            ? ' enchantment marked On item stays fixed; unlock it if you want the optimizer to replace it.'
            : ' enchantments marked On item stay fixed; unlock one if you want the optimizer to replace it.')
        : '');
  }

  refresh();
}

/* ------------------------------------------------------------------ *
 * Which enchantments may be typed into a slot                         *
 * ------------------------------------------------------------------ */

// Item-level eligibility, ignoring what the other slots hold. Alien and Neo
// Alien are equipment families: an enchantment of one only goes on equipment of
// that same family, and no artifact stands in for the item. See
// EnchantEngine.NOTES.alienBase for how this parts company with the Qt source.
function eligibleForItem(mod, config) {
  return EnchantEngine.eligibleForItem(state.data, config, mod);
}

/*
 * Enchantments this item type allows but this item's base family does not.
 *
 * Worth showing rather than silently dropping: someone holding an item of the
 * wrong family would otherwise just find those enchantments missing from the
 * list, with nothing to say why. The catalogue does know each item's family
 * now, so this only comes up when the slot, dust and base were set by hand.
 */
const BASE_LABEL = { ALIEN: 'Alien', NEO_ALIEN: 'Neo Alien', SUMMONPOWERED: 'summon-powered' };

function missingBase(mod, config) {
  return EnchantEngine.missingBase(state.data, config, mod);
}

// Directional rule: `candidate` survives after `prior` when none of the
// candidate's Incompatible Labels appears among the prior's Labels.
function follows(candidate, prior) {
  return EnchantEngine.follows(candidate, prior);
}

/*
 * Can `mod` sit in `slot` given everything else already chosen?
 *  - against a locked slot the candidate must follow it;
 *  - a locked candidate must be followable by the wanted ones;
 *  - two wanted enchantments only need one workable rolling order, which the
 *    build planner then works out.
 */
function conflictWith(mod, slot, others) {
  return EnchantEngine.conflictWith(state.data, mod, slot, others);
}

function candidatesFor(slot, config) {
  const others = state.slots.filter(entry => entry.index !== slot.index);
  return state.data.enchants
    /*
     * The retired ones are not offered. The client keeps Crown, Iron Plating
     * (Legacy), Living Hive (Legacy) and their kind so that an item still
     * carrying one reads correctly, and gives them a weight of nought to say
     * they can never come out of an enchanting again. Listing something
     * nobody can roll among the things you might want is how a list stops
     * being trustworthy.
     */
    .filter(mod => eligibleForItem(mod, config))
    .filter(mod => !conflictWith(mod, slot, others))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ *
 * Rendering: configuration                                            *
 * ------------------------------------------------------------------ */

function labelChips(mod) {
  const blocking = state.data.blockingLabels;
  const tags = [...mod.tags].filter(tag => blocking.has(tag));
  const excludes = [...mod.excludes];
  const parts = [];
  // The two lists very often hold the same words, so each chip is prefixed:
  // "+" for a Label this enchantment brings, "⊘" for one it refuses.
  if (tags.length) parts.push(`<span class="chips" title="Labels this enchantment brings. They remove future candidates that refuse them.">${tags.map(tag => `<i class="chip give"><b>+</b>${html(tag)}</i>`).join('')}</span>`);
  if (excludes.length) parts.push(`<span class="chips" title="Incompatible Labels: this enchantment cannot be rolled once any of these Labels is already on the item.">${excludes.map(tag => `<i class="chip refuse"><b>⊘</b>${html(tag)}</i>`).join('')}</span>`);
  return parts.join('');
}

function renderSlots() {
  const config = cfg();
  const list = $('slotList');
  const visible = config.slots;
  const hint = $('slotHint');
  // Silent unless there is something to say; see the markup.
  hint.hidden = true;
  hint.className = 'note';
  hint.textContent = '';
  list.replaceChildren();

  for (let index = 1; index <= visible; index++) {
    const slot = state.slots[index - 1];
    const mod = state.data.byName.get(slot.name);
    const card = document.createElement('div');
    card.className = `slot-card ${!slot.name ? 'is-empty' : slot.locked ? 'is-locked' : 'is-wanted'}`;
    card.dataset.slot = String(index);

    const stateLabel = !slot.name ? 'Empty' : slot.locked ? 'On the item' : 'Wanted';
    card.innerHTML = `
      <div class="slot-index">${index}</div>
      <div class="slot-body">
        <button class="slot-pick" type="button" data-pick="${index}">
          ${mod ? enchantIconHtml(mod, 'slot-icon') : '<span class="slot-icon empty">+</span>'}
          <span class="slot-text">
            <b>${mod ? html(mod.name) : 'Choose an enchantment'}</b>
            <small>${mod ? html(mod.description) : 'Click to browse everything this item can roll'}</small>
          </span>
        </button>
        ${mod ? `<div class="slot-labels">${labelChips(mod)}</div>` : ''}
      </div>
      <div class="slot-actions">
        <span class="slot-state">${stateLabel}</span>
        <div class="toggle" role="group" aria-label="Slot ${index} state">
          <button type="button" data-mode="wanted" data-slot="${index}" class="${slot.name && !slot.locked ? 'on' : ''}" ${slot.name ? '' : 'disabled'} title="This enchantment is not on the item yet — you want to roll it.">🎯 Wanted</button>
          <button type="button" data-mode="locked" data-slot="${index}" class="${slot.locked ? 'on' : ''}" ${slot.name ? '' : 'disabled'} title="This enchantment is already on the item and you keep it. It removes candidates, costs a slot and doubles every reroll.">🔒 On item</button>
        </div>
        ${slot.name ? `<button type="button" class="ghost-x" data-remove="${index}" aria-label="Clear slot ${index}">×</button>` : ''}
      </div>`;
    list.append(card);
  }

  const locked = config.locks.length;
  const wanted = (config.desired ? 1 : 0) + config.goals.length;
  $('slotSummary').textContent = visible ? `${plural(visible, 'slot')} · ${locked} locked · ${wanted} wanted · ${Math.max(0, visible - locked)} random` : '';
}

function renderSubtypes() {
  const panel = $('subtypePanel');
  const type = $('itemType').value;
  if (!panel.childElementCount) {
    for (const subtype of SUBTYPES) {
      const label = document.createElement('label');
      label.className = 'chip-toggle';
      label.innerHTML = `<input type="checkbox" value="${subtype}"><img src="${asset('GUI Files', 'Item Types', `${subtype}.png`)}" alt="" onerror="this.remove()"><span>${subtype.replace('_', ' ')}</span>`;
      panel.append(label);
    }
  }
  for (const box of panel.querySelectorAll('input')) {
    const allowed = box.value === 'SUMMONPOWERED' ? ['ABILITY', 'ARMOR'].includes(type) : type !== 'ABILITY';
    box.disabled = !allowed;
    if (!allowed) box.checked = false;
    box.closest('label').classList.toggle('disabled', !allowed);
    box.closest('label').classList.toggle('on', box.checked);
  }
}

function renderHeaderIcons(config) {
  // Only touch src when it actually changes: reassigning it on every refresh
  // makes the browser re-request and re-decode the sprite, which flickers.
  const set = (element, src) => {
    if (src) {
      if (element.getAttribute('src') !== src) element.src = src;
      element.style.display = '';
    } else {
      element.removeAttribute('src');
      element.style.display = 'none';
    }
  };
  set($('rarityIcon'), config.slots ? asset('GUI Files', 'Item Rarities', `${RARITIES[config.slots - 1]}_scaled_8x.png`) : '');
  set($('typeIcon'), config.type ? asset('GUI Files', 'Item Types', `${config.type.toLowerCase()}.png`) : '');
  set($('dustIcon'), config.dust ? asset('GUI Files', 'Dust Types', `${config.dust}.png`) : '');
  document.body.dataset.rarity = config.slots ? String(config.slots) : '';

  renderItemCard(config);
}

const TYPE_LABEL = { WEAPON: 'Weapon', ABILITY: 'Ability', ARMOR: 'Armor', RING: 'Ring' };

/*
 * The item's own facts, shown instead of being asked for. The manual controls
 * stay in the page but folded away; they open by themselves whenever the item
 * could not settle something, so an unlisted item is never a dead end.
 */
function renderItemCard(config) {
  const card = $('itemCard');
  const status = $('awakenedStatus');
  const override = $('manualOverride');
  // Only take the panel open or shut when the item itself changed, so a user
  // who opened it to look at something does not have it closed underneath them.
  const itemChanged = state.lastCardItem !== config.item;
  state.lastCardItem = config.item;

  if (!config.item) {
    // Nothing chosen: a single call to action, and none of the fields the
    // item is going to answer for us.
    card.hidden = true;
    $('itemEmpty').hidden = false;
    $('raritySection').hidden = true;
    override.hidden = true;
    status.hidden = true;
    override.classList.remove('needed');
    if (itemChanged) override.open = false;
    return;
  }
  $('itemEmpty').hidden = true;
  $('raritySection').hidden = false;
  override.hidden = false;
  status.hidden = false;

  const resolved = resolveItem(config.item);
  card.hidden = false;

  if (!resolved) {
    card.className = 'item-card unknown';
    card.innerHTML = `
      <div class="item-art"><span class="item-art-fallback">?</span></div>
      <div class="item-facts">
        <b>${html(config.item)}</b>
        <span class="muted">Not in the item list — nothing could be filled in.</span>
      </div>
      <div class="item-actions">
        <button type="button" class="browse" id="changeItem">Change</button>
        <button type="button" class="ghost-x" id="clearItem" aria-label="Remove this item">×</button>
      </div>`;
    status.className = 'note warn';
    status.textContent = 'Unknown item. Set the slot, dust and base by hand below; the calculation itself is unaffected.';
    if (itemChanged) override.open = true;
    override.classList.add('needed');
    return;
  }

  const missing = [];
  if (!resolved.type) missing.push('slot');
  if (!resolved.dust) missing.push('dust');

  const own = itemArt(resolved.name, resolved.awokenKey, 38, 'item-art-pic');
  const typeSrc = resolved.type ? asset('GUI Files', 'Item Types', `${resolved.type.toLowerCase()}.png`) : '';
  const art = own
    || (typeSrc ? `<img class="as-type" src="${typeSrc}" alt="">` : '<span class="item-art-fallback">?</span>');

  const facts = [];
  if (resolved.type) facts.push(`<i class="fact type">${html(TYPE_LABEL[resolved.type] || resolved.type)}</i>`);
  else facts.push('<i class="fact todo">slot unknown</i>');
  if (resolved.dust) facts.push(`<i class="fact dust ${html(resolved.dust.toLowerCase())}">${dustIcon(resolved.dust)}${html(resolved.dust)} dust</i>`);
  else facts.push('<i class="fact todo">dust unknown</i>');
  if (resolved.special) facts.push(`<i class="fact special">${html(resolved.special.replace('_', ' '))}</i>`);
  facts.push(`<i class="fact plain">${resolved.tiered ? 'Tiered' : 'Untiered'}</i>`);

  const awoken = resolved.awoken;
  card.className = `item-card${missing.length ? ' partial' : ''}`;
  card.innerHTML = `
    <div class="item-art">${art}</div>
    <div class="item-facts">
      <b>${html(resolved.name)}</b>
      <span class="fact-row">${facts.join('')}</span>
      <span class="item-awoken">${awoken.length
        ? `Unlocks ${awoken.map(name => `${enchantIconHtml(state.data.byName.get(name), 'awoken-icon')}<b>${html(name)}</b>`).join(', ')} — and no other Awoken enchantment.`
        : 'No Awoken enchantment on this item.'}</span>
      ${resolved.note ? `<span class="muted">${html(resolved.note)}</span>` : ''}
    </div>
    <div class="item-actions">
      <button type="button" class="browse" id="changeItem">Change</button>
      <button type="button" class="ghost-x" id="clearItem" aria-label="Remove this item">×</button>
    </div>`;

  if (missing.length) {
    status.className = 'note warn';
    status.innerHTML = `The wiki's reroll tables do not cover this one yet, so the <b>${missing.join(' and ')}</b> could not be worked out. Set ${missing.length > 1 ? 'them' : 'it'} by hand below.`;
    if (itemChanged) override.open = true;
    override.classList.add('needed');
  } else {
    status.className = 'note good';
    status.textContent = 'Slot, dust and base all come from the item. Only the rarity is left to you.';
    override.classList.remove('needed');
    if (itemChanged) override.open = false;
  }
}

function refresh() {
  if (!state.ready) return;
  renderSubtypes();
  let config = cfg();


  // Drop any slot entry that the current item or the other slots invalidate,
  // and tell the user which ones went, so a silent disappearance never puzzles.
  const dropped = [];
  for (let guard = 0; guard < 8; guard++) {
    config = cfg();
    const broken = state.slots.find(slot => {
      if (!slot.name) return false;
      const mod = state.data.byName.get(slot.name);
      if (!mod) return true;
      if (slot.index > config.slots) return true;
      if (!eligibleForItem(mod, config)) return true;
      return Boolean(conflictWith(mod, slot, state.slots.filter(other => other.index !== slot.index)));
    });
    if (!broken) break;
    dropped.push(broken.name);
    broken.name = '';
    broken.locked = false;
  }

  config = cfg();
  renderHeaderIcons(config);
  renderSlots();
  renderItemOptimizer(config);
  if (dropped.length) {
    const hint = $('slotHint');
    hint.hidden = false;
    hint.className = 'note warn';
    hint.textContent = `Removed from the slots — no longer possible with this configuration: ${dropped.join(', ')}.`;
  }
  renderTiers(config);
  const ready = renderCalculateState(config);
  saveSetup();

  // Every change re-runs the whole table. It costs a few hundred milliseconds
  // at worst, which is less than the round trip to a button and back.
  if (ready) { beginResultSwap(config); scheduleCalculation(); }
  else if (state.lastResults) { state.runId++; clearResults(); }
}

/*
 * Runs are coalesced and versioned. Clicking through slots fires refresh()
 * several times in a row, and a run yields to the interface between artifacts,
 * so without a generation counter an older run could finish last and paint
 * results for a configuration that no longer exists.
 */
function scheduleCalculation() {
  clearTimeout(state.calcTimer);
  state.calcTimer = setTimeout(() => { runCalculation(); }, 90);
}

function renderTiers(config) {
  // One tier selection applies to every tiered enchantment still wanted.
  // Looking only at the first target hid this constraint whenever a later
  // wanted enchantment was tiered.
  const goals = [config.desired, ...config.goals].filter(Boolean);
  const tiered = goals.some(name => {
    const target = state.data.byName.get(name);
    return Boolean(target && target.tags.has('TIERED'));
  });
  $('tiers').hidden = !tiered;
  $('tiers').disabled = !tiered;
}

/*
 * What is still missing before the odds mean anything. Returns the list, so
 * the same answer drives both the hint and whether a run may start.
 */
function whatIsMissing(config) {
  const missing = [];
  // Slot and dust follow from the item, so asking for them before an item is
  // chosen would send the user hunting for controls that are not even shown.
  if (!config.item) missing.push('an item');
  if (!config.slots) missing.push('a rarity');
  if (config.item && !config.type) missing.push('an item type');
  if (config.item && !config.dust) missing.push('a dust type');
  if (!state.data.byName.has(config.desired)) missing.push('at least one wanted enchantment');
  const overloaded = config.locks.length + 1 + config.goals.length > config.slots && state.data.byName.has(config.desired);
  return { missing, overloaded, ready: !missing.length && !overloaded };
}

function renderCalculateState(config) {
  const { missing, overloaded, ready } = whatIsMissing(config);
  const hint = $('calculateHint');
  /*
   * Only the one thing worth interrupting for. Listing what has not been
   * filled in yet is the interface reading its own form back at you, and
   * the form is right there; asking for more slots than the item has is a
   * dead end you cannot see from the slots themselves.
   */
  hint.hidden = !overloaded;
  hint.textContent = overloaded
    ? 'The locked and wanted enchantments together need more slots than the item has.'
    : '';
  hint.className = `note${overloaded ? ' warn' : ''}`;
  return ready;
}

/* ------------------------------------------------------------------ *
 * Enchantment picker                                                  *
 * ------------------------------------------------------------------ */

// Whoever had focus just before the picker opened, so closing it can hand
// focus back instead of dropping it to the document body. A selection
// (unlike Escape/backdrop/close) is usually followed by a synchronous
// rerender that throws the original node away, so alongside the node itself
// we keep a selector built from its id or data-* attributes — stable
// identity a rerender reconstructs — to find its replacement.
let pickerOpener = null;

function cssEscape(value) {
  return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function pickerOpenerLocator(el) {
  if (el.id) return `#${cssEscape(el.id)}`;
  const dataAttrs = [...el.attributes].filter(attr => attr.name.startsWith('data-'));
  if (!dataAttrs.length) return null;
  return el.tagName.toLowerCase() + dataAttrs.map(attr => `[${attr.name}="${cssEscape(attr.value)}"]`).join('');
}

function isFocusable(el) {
  return !!el && document.contains(el) && typeof el.focus === 'function' && !el.disabled && el.offsetParent !== null;
}

function rememberPickerOpener() {
  const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  pickerOpener = el ? { el, locator: pickerOpenerLocator(el) } : null;
}

// Deferred to a microtask: closePicker() is always followed, in the same
// synchronous handler, by whatever the selection does next (refresh(),
// onFieldChange(), a borrowed picker's onPick callback) — those already run
// and settle the DOM before a microtask gets a turn, so this sees the
// rerendered tree rather than racing it.
function restorePickerFocus(saved) {
  if (!saved) return;
  if (isFocusable(saved.el)) { saved.el.focus(); return; }
  if (!saved.locator) return;
  const again = document.querySelector(saved.locator);
  if (isFocusable(again)) again.focus();
}

function pickerFocusable() {
  const root = $('pickerBackdrop').querySelector('.picker');
  if (!root) return [];
  return [...root.querySelectorAll('button, input, [tabindex]')]
    .filter(el => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
}

function trapPickerTab(event) {
  const focusable = pickerFocusable();
  if (!focusable.length) { event.preventDefault(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !focusable.includes(active)) { event.preventDefault(); last.focus(); }
  } else if (active === last || !focusable.includes(active)) {
    event.preventDefault(); first.focus();
  }
}

function openPicker(index) {
  rememberPickerOpener();
  const slot = state.slots[index - 1];
  const config = cfg();
  const candidates = candidatesFor(slot, config);
  const others = state.slots.filter(entry => entry.index !== index);
  const blocked = state.data.enchants
    .filter(mod => eligibleForItem(mod, config))
    .map(mod => ({ mod, conflict: conflictWith(mod, slot, others) }))
    .filter(entry => entry.conflict && entry.conflict.reason !== 'duplicate');

  const wrongBase = state.data.enchants
    .map(mod => ({ mod, missing: missingBase(mod, config) }))
    .filter(entry => entry.missing);

  // Cleared on every open: a filter left on from the last slot would look like
  // an item that can suddenly roll almost nothing.
  state.picker = { index, candidates, blocked, wrongBase, kinds: new Set() };
  renderPickerKinds();
  $('pickerTitle').textContent = `Slot ${index}`;
  $('pickerSub').textContent = `${candidates.length} available · ${blocked.length} removed by the other slots`
    + (wrongBase.length ? ` · ${wrongBase.length} need another base` : '');
  $('pickerSearch').value = '';
  $('pickerSearch').placeholder = 'Search by name, description or label…';
  $('pickerBackdrop').hidden = false;
  renderPickerList('');
  $('pickerSearch').focus();
}

/*
 * Two toggles over the list: Awoken and Unique.
 *
 * Those are the two kinds a player hunts on purpose — one is the item's own
 * enchantment, the other the rare one worth spending a card on — and both are
 * scattered through a list of a hundred stat bonuses. Neither is on to begin
 * with, so the picker still opens on everything the item can roll, and turning
 * both on shows either kind rather than nothing.
 */
function renderPickerKinds() {
  const bar = $('pickerKinds');
  const counts = { AWAKENED: 0, UNIQUE: 0 };
  for (const mod of state.picker.candidates) {
    for (const kind of Object.keys(counts)) if (mod.tags.has(kind)) counts[kind]++;
  }
  for (const button of bar.querySelectorAll('[data-kind]')) {
    const kind = button.dataset.kind;
    const on = state.picker.kinds.has(kind);
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    button.hidden = counts[kind] === 0;
    button.innerHTML = `${kind === 'AWAKENED' ? 'Awoken' : 'Unique'} <b>${counts[kind]}</b>`;
  }
  bar.hidden = !bar.querySelector('[data-kind]:not([hidden])');
}

function togglePickerKind(kind) {
  if (!state.picker) return;
  if (state.picker.kinds.has(kind)) state.picker.kinds.delete(kind);
  else state.picker.kinds.add(kind);
  renderPickerKinds();
  renderPickerList($('pickerSearch').value);
}

function renderPickerList(query) {
  const term = RealmI18n.canonicalSearch(query);
  const kinds = state.picker.kinds;
  const wanted = entry => !kinds.size || [...kinds].some(kind => entry.tags.has(kind));
  const matches = entry => wanted(entry) && (!term
    || entry.name.toLowerCase().includes(term)
    || entry.description.toLowerCase().includes(term)
    || [...entry.tags].some(tag => tag.toLowerCase().includes(term)));
  const shown = state.picker.candidates.filter(matches);
  const hidden = state.picker.blocked.filter(entry => matches(entry.mod));
  const offBase = (state.picker.wrongBase || []).filter(entry => matches(entry.mod));

  const row = mod => `
    <button type="button" class="picker-row" data-name="${html(mod.name)}">
      ${enchantIconHtml(mod, 'picker-icon')}
      <span class="picker-text">
        <b>${html(mod.name)}</b>
        <small>${html(mod.description)}</small>
        <span class="slot-labels">${labelChips(mod)}</span>
      </span>
      <span class="picker-weight" title="Base roll weight before any artifact multiplier">${count(mod.weight)}</span>
    </button>`;

  const reason = conflict => ({
    'after-lock': `blocked by the locked “${conflict.other.name}”`,
    'before-wanted': `“${conflict.other.name}” could not be rolled after it`,
    mutual: `no rolling order works with “${conflict.other.name}”`
  })[conflict.reason] || 'incompatible';

  const baseNames = missing => missing.map(key => BASE_LABEL[key] || key).join(' + ');

  const offBaseHtml = offBase.length ? `
    <div class="picker-section">Needs a different base</div>
    <p class="picker-hint">An enchantment of the Alien or Neo Alien family only goes on
      equipment of that same family. Pick your item by name and its family comes with it;
      if you set the slot by hand instead, tick the base under
      <b>Set the slot, dust and base by hand</b>.</p>
    ` + offBase.map(entry => `
      <div class="picker-row disabled" title="${html(baseNames(entry.missing))} base required">
        ${enchantIconHtml(entry.mod, 'picker-icon')}
        <span class="picker-text"><b>${html(entry.mod.name)}</b><small>${html(baseNames(entry.missing))} base required</small></span>
      </div>`).join('') : '';

  $('pickerList').innerHTML = shown.length || hidden.length || offBase.length
    ? shown.map(row).join('') + (hidden.length
      ? `<div class="picker-section">Removed by the other slots</div>` + hidden.map(entry => `
        <div class="picker-row disabled" title="${html(reason(entry.conflict))}">
          ${enchantIconHtml(entry.mod, 'picker-icon')}
          <span class="picker-text"><b>${html(entry.mod.name)}</b><small>${html(reason(entry.conflict))}</small></span>
        </div>`).join('')
      : '') + offBaseHtml
    : '<div class="picker-empty">Nothing matches that search.</div>';
  $('pickerFooter').textContent = `${shown.length} selectable`;
}

function closePicker() {
  $('pickerBackdrop').hidden = true;
  state.picker = null;
  const saved = pickerOpener;
  pickerOpener = null;
  queueMicrotask(() => restorePickerFocus(saved));
}

/*
 * The same dialogue, lent out.
 *
 * Theory crafting needs exactly this - a searchable list of enchantments with
 * their labels and their weights - and building a second one guaranteed the
 * two would look different within a month. It hands in what may be chosen,
 * what to say at the top, and what to do with the answer.
 */
window.openEnchantPicker = function (options) {
  if (!state.data) return false;
  rememberPickerOpener();
  state.picker = {
    index: 0,
    candidates: options.candidates || [],
    blocked: [],
    wrongBase: [],
    kinds: new Set(),
    pick: options.onPick
  };
  renderPickerKinds();
  $('pickerTitle').textContent = options.title || 'Choose an enchantment';
  $('pickerSub').textContent = options.sub || '';
  $('pickerSearch').value = '';
  $('pickerSearch').placeholder = 'Search by name, description or label…';
  $('pickerBackdrop').hidden = false;
  renderPickerList('');
  $('pickerSearch').focus();
  return true;
};

/* And the dataset it was built from, for anybody who needs the same rules. */
window.enchantRules = () => state.data;

/*
 * A thing handed over from the index to the bench: an item into the slot it
 * belongs in, a class as the class, an enemy as the thing being fought. The
 * bench decides what it can use; anything it cannot is ignored.
 */
window.benchWith = function (said) {
  if (!said || typeof TheoryCraft === 'undefined') return false;
  location.hash = 'theory';
  routeFromHash();
  // The page reads its data on first opening, so the hand-over waits for it.
  const tryIt = (left) => {
    if (typeof TheoryCraft.put === 'function' && TheoryCraft.put(said)) return;
    if (left > 0) setTimeout(() => tryIt(left - 1), 120);
  };
  tryIt(40);
  return true;
};

/*
 * An item handed over from the bench.
 *
 * Somebody who has just been told to put four enchantments on a weapon wants
 * to know what that will cost before they believe it, and that is this page's
 * only question - so the item and what is meant to go on it arrive here
 * rather than being typed in again. What cannot be resolved is dropped rather
 * than guessed: an enchantment this page does not know is one it cannot price.
 */
function handoverSetup(said) {
  const resolved = resolveItem(said.item);
  const slots = (said.slots || [])
    .filter(name => state.data.byName.has(name))
    .slice(0, 4)
    .map(name => ({ name, locked: false }));
  return {
    resolved,
    setup: {
      item: said.item,
      rarity: String(Math.max(slots.length, resolved && resolved.slots ? resolved.slots : 0) || ''),
      type: (resolved && resolved.type) || '',
      dust: (resolved && resolved.dust) || '',
      slots
    }
  };
}

window.enchantThis = function (said) {
  if (!said || !said.item || !state.data) return false;
  applySetup(handoverSetup(said).setup);
  refresh();
  location.hash = 'enchant';
  routeFromHash();
  return true;
};

/*
 * A whole build handed over from the bench: one new tab per item, each built
 * by the same hand-over as a single item and each holding only its own
 * enchantments. The tabs already open are left exactly as they were - this
 * adds, it never overwrites. An item this page cannot place is reported back
 * rather than given a tab it could do nothing with, and does not stop the
 * others.
 */
function tabsForBuild(list, group) {
  const tabs = [], skipped = [];
  const taken = new Set(state.tabs.map(tab => tab.id));
  for (const said of Array.isArray(list) ? list : []) {
    if (!said || !said.item) continue;
    const handed = handoverSetup(said);
    if (!handed.resolved) { skipped.push(said.item); continue; }
    let tab = newTab(handed.setup);
    while (taken.has(tab.id)) tab = newTab(handed.setup);
    taken.add(tab.id);
    /* The four came as one build and stay together as one: a group in the
       tab strip, under the build's own name, closed together or one by one. */
    if (group) tab.group = { id: group.id, label: group.label };
    tabs.push(tab);
  }
  return { tabs, skipped };
}

/* Whether this page can take an item at all - the one answer the bench asks
   before it offers to send anything, so the two never disagree. */
window.enchantCan = name => (state.data ? Boolean(name && resolveItem(name)) : null);

window.enchantBuild = function (list, options) {
  if (!state.data) return null;
  const label = String((options && options.label) || 'Build').slice(0, 60);
  let groupId;
  do groupId = 'g' + Math.random().toString(36).slice(2, 9);
  while (state.tabs.some(tab => tab.group && tab.group.id === groupId));
  const made = tabsForBuild(list, { id: groupId, label });
  if (!made.tabs.length) return { opened: [], skipped: made.skipped };
  saveSetup();                 // bank the tab that was on screen
  state.tabs.push(...made.tabs);
  state.activeTab = made.tabs[0].id;
  state.loadingTab = true;     // stop applySetup's edits from writing back
  applySetup(made.tabs[0].setup);
  state.loadingTab = false;
  clearResults();
  refresh();
  persistTabs();
  renderTabs();
  /* Said on this page, since this is the page that is now on the screen. */
  sayTabNote(made.skipped.length
    ? 'Not sent: the game does not let ' + made.skipped.join(', ') + ' be enchanted.'
    : '');
  location.hash = 'enchant';
  routeFromHash();
  return { opened: made.tabs.map(tab => tab.label), skipped: made.skipped };
};

function sayTabNote(text) {
  const note = $('tabNote');
  if (!note) return;
  note.textContent = text;
  note.hidden = !text;
}

/* ------------------------------------------------------------------ *
 * Item picker                                                         *
 * ------------------------------------------------------------------ */

// Sprite for an item row: its own artwork when we have it, otherwise the icon
// for its slot so the list still reads at a glance.
function itemArtHtml(resolved, name) {
  const own = itemArt(name, resolved && resolved.awokenKey, 26, 'picker-icon');
  if (own) return own;
  if (resolved && resolved.type) {
    const src = asset('GUI Files', 'Item Types', `${resolved.type.toLowerCase()}.png`);
    if (src) return `<img class="picker-icon as-type" src="${src}" alt="" loading="lazy" onerror="this.classList.add('missing')">`;
  }
  return '<span class="picker-icon empty">?</span>';
}

async function openItemPicker() {
  await ensureItemArt();
  rememberPickerOpener();
  const entries = knownItemNames().map(name => ({ name, resolved: resolveItem(name) }));
  state.picker = { kind: 'item', entries };
  // The dialog is shared with the enchantment picker; its two toggles mean
  // nothing here.
  $('pickerKinds').hidden = true;
  $('pickerTitle').textContent = 'Choose your item';
  $('pickerSub').textContent = `${entries.length} items · slot, dust and base come with the choice`;
  $('pickerSearch').value = '';
  $('pickerSearch').placeholder = 'Search by name, slot or dust…';
  $('pickerBackdrop').hidden = false;
  renderItemPickerList('');
  $('pickerSearch').focus();
}

function renderItemPickerList(query) {
  const term = RealmI18n.canonicalSearch(query);
  const matches = entry => {
    if (!term) return true;
    const resolved = entry.resolved;
    return entry.name.toLowerCase().includes(term)
      || (resolved && resolved.type && resolved.type.toLowerCase().includes(term))
      || (resolved && resolved.dust && resolved.dust.toLowerCase().includes(term))
      || (resolved && resolved.awoken || []).some(name => name.toLowerCase().includes(term));
  };
  // Items with their own artwork first: they are the ones worth recognising.
  const shown = state.picker.entries.filter(matches).sort((a, b) => {
    const artA = hasItemArt(a.name, a.resolved && a.resolved.awokenKey) ? 0 : 1;
    const artB = hasItemArt(b.name, b.resolved && b.resolved.awokenKey) ? 0 : 1;
    return artA - artB || a.name.localeCompare(b.name);
  }).slice(0, 400);

  $('pickerList').innerHTML = shown.length ? shown.map(entry => {
    const resolved = entry.resolved;
    const bits = [];
    if (resolved && resolved.type) bits.push(TYPE_LABEL[resolved.type] || resolved.type);
    if (resolved && resolved.dust) bits.push(`${resolved.dust} dust`);
    else bits.push('dust unknown');
    if (resolved && resolved.special) bits.push(resolved.special.replace('_', ' '));
    const awoken = resolved && resolved.awoken && resolved.awoken.length ? ` · unlocks ${html(resolved.awoken[0])}` : '';
    return `<button type="button" class="picker-row" data-item="${html(entry.name)}">
      ${itemArtHtml(resolved, entry.name)}
      <span class="picker-text"><b>${html(entry.name)}</b><small>${html(bits.join(' · '))}${awoken}</small></span>
    </button>`;
  }).join('') : '<div class="picker-empty">Nothing matches that search.</div>';
  $('pickerFooter').textContent = `${shown.length} shown${shown.length === 400 ? ' (refine to see more)' : ''}`;
}

/* ------------------------------------------------------------------ *
 * Results                                                             *
 * ------------------------------------------------------------------ */

function dustIcon(type) {
  if (!type || type === 'na') return '';
  return `<img class="dust-icon" src="${asset('GUI Files', 'Dust Types', `${type}-div2.png`)}" alt="${type} dust">`;
}

/*
 * Artifacts fall into three kinds, plus the baseline.
 *   none     "No Artifact" — always listed, everything else is judged against it
 *   premium  bought with real money: "Premium" in the name
 *   tarot    the ordinary tarot cards, found in game
 *   special  the rest: technologies, cores, cogs, ingots
 */
// How many enchantments the user is hunting: one is a question about which
// artifact, several is a question about what order.
function goalCount(config) {
  return [config.desired, ...config.goals].filter(Boolean).length;
}

/*
 * Which family an artifact belongs to, for the filter above the table.
 *
 * The engraving group comes from the client's own item labels rather than from
 * the name: it marks twenty of the fifty-one, nearly all of them seasonal, and
 * they behave differently enough to be worth separating — most cost no dust at
 * all and every one of them is consumed on every reroll rather than half the
 * time.
 */
function artifactKind(artifact) {
  const name = typeof artifact === 'string' ? artifact : artifact.name;
  const labels = typeof artifact === 'string' ? null : artifact.labels;
  if (name === 'No Artifact') return 'none';
  if (/premium/i.test(name)) return 'premium';
  if (/tarot/i.test(name)) return 'tarot';
  if (labels && labels.has('ENGRAVING')) return 'engraving';
  if (/engraving/i.test(name)) return 'engraving';
  return 'special';
}

const KIND_LABEL = { tarot: 'Tarot', special: 'Special', engraving: 'Engraving', premium: 'Premium' };

/*
 * Artwork exists for the 25 artifacts the original Qt assets covered; the
 * client defines 51. One of the 26 is only a rename — the client calls it
 * Premium Silver Card where the assets are filed under the older name — and
 * the rest simply have no picture here. They are ranked and priced like any
 * other; the icon slot is left empty.
 */
const ARTIFACT_ART_ALIAS = { 'Premium Silver Card': 'Premium Silver Tarot Card' };
const artifactIcon = name =>
  asset('GUI Files', 'Artifact Icons', `${ARTIFACT_ART_ALIAS[name] || name}-div2.png`);

/*
 * Which rows the table lists.
 *
 * Ten is enough: past that the chances are an order of magnitude apart and the
 * rows are scenery. On top of the ten come the ones you need to see whether or
 * not you asked for them — the baseline, the genuinely cheapest artifact, and
 * a Premium good enough to reach the top three. Any of those coming from a
 * group you have not selected is greyed rather than dropped, and clicking it
 * selects that group.
 */
const TABLE_ROWS = 10;

function isAllowedRow(row) {
  const kind = artifactKind(row.artifact);
  return kind === 'none' || state.filters[kind];
}

function tableRows(all) {
  const allowed = all.filter(isAllowedRow);
  const keep = new Set(allowed.slice(0, TABLE_ROWS));

  const baseline = all.find(row => artifactKind(row.artifact) === 'none');
  if (baseline) keep.add(baseline);

  const viable = all.filter(row => row.odds > 0);
  const cheapest = viable.length ? viable.reduce((a, b) => b.dust < a.dust ? b : a) : null;
  if (cheapest) keep.add(cheapest);

  for (const row of all.slice(0, 3)) {
    if (artifactKind(row.artifact) === 'premium') keep.add(row);
  }

  // all is already sorted by chance, so filtering it keeps the order.
  const rows = all.filter(row => keep.has(row));
  const off = new Set(rows.filter(row => !isAllowedRow(row)));

  // When the cheapest is out of reach, the cheapest one you can actually use
  // still deserves to be pointed at.
  const affordable = viable.filter(isAllowedRow);
  const cheapestMine = cheapest && off.has(cheapest) && affordable.length
    ? affordable.reduce((a, b) => b.dust < a.dust ? b : a)
    : null;

  return { rows, off, cheapest, cheapestMine };
}

/*
 * The artifacts you are willing to use. "No Artifact" is always among them:
 * it is the baseline, and a plan that may not decline an artifact is not a
 * plan. With several wanted enchantments this is a constraint on the search,
 * not a filter over an answer already computed.
 */
/*
 * Turning a group on or off. With one goal the table is already computed and
 * only its rows change; with several, the plan has to be searched again over
 * the new set, so the whole calculation runs.
 */
function applyFilterChange() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(state.filters)); } catch (error) { /* private mode */ }
  const config = cfg();
  const auditOpen = !$('auditCard').hidden;
  if (goalCount(config) > 1) runCalculation();
  else if (state.lastResults) { renderResults(state.lastResults, config); renderSummary(state.lastResults, config); }
  // An open explanation follows the selection rather than going stale.
  if (auditOpen && goalCount(config) === 1) showAudit();
}

function toggleKind(kind) {
  state.filters[kind] = !state.filters[kind];
  applyFilterChange();
}

function enableKind(kind) {
  if (state.filters[kind]) return;
  state.filters[kind] = true;
  applyFilterChange();
}

function blacklistedArtifacts() {
  if (!state.artifactBlacklist) state.artifactBlacklist = new Set();
  return state.artifactBlacklist;
}

function allowedArtifacts() {
  const blocked = blacklistedArtifacts();
  return state.data.artifacts.filter(artifact => {
    const kind = artifactKind(artifact);
    return kind === 'none' || (state.filters[kind] && !blocked.has(artifact.name));
  });
}

function artifactFilterHtml() {
  // Keyed off KIND_LABEL so a new family cannot be counted as NaN.
  const counts = {};
  for (const kind of Object.keys(KIND_LABEL)) counts[kind] = 0;
  for (const artifact of state.data.artifacts) {
    const kind = artifactKind(artifact);
    if (kind !== 'none') counts[kind]++;
  }
  const blocked = [...blacklistedArtifacts()].sort((a, b) => a.localeCompare(b));

  return `<div class="filter-chips" role="group" aria-label="Which artifacts you are willing to use">
    <span class="filter-caption">Artifacts</span>
    ${Object.keys(KIND_LABEL).map(kind => `
      <button type="button" class="filter-chip${state.filters[kind] ? ' on' : ''}" data-kind="${kind}"
        aria-pressed="${state.filters[kind]}">${KIND_LABEL[kind]} <b>${counts[kind]}</b></button>`).join('')}
    ${blocked.length ? `
      <span class="filter-caption">Unavailable</span>
      ${blocked.map(name => `
        <button type="button" class="filter-chip" data-artifact-restore="${html(name)}"
          title="Make this artifact available again">↺ ${html(name)}</button>`).join('')}
    ` : ''}
  </div>`;
}

// What the ten-row cut left out, and whether anything better is among it.
function renderHiddenNote(all, shown) {
  const note = $('artifactHidden');
  const hidden = all.filter(row => !shown.includes(row));
  if (!hidden.length) { note.hidden = true; return; }
  const best = hidden.reduce((a, b) => b.odds > a.odds ? b : a);
  note.hidden = false;
  note.className = 'note';
  note.textContent = `${hidden.length} not listed. Best of them: ${best.artifact.name} at ${percent(best.odds)} per reroll`
    + (isAllowedRow(best) ? '.' : ` — a ${KIND_LABEL[artifactKind(best.artifact)]} artifact you have not selected.`);
}

function renderResults(allRows, config) {
  const body = $('results').tBodies[0];
  if (!allRows.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No artifact can roll this target.</td></tr>'; return; }

  const { rows, off, cheapest, cheapestMine } = tableRows(allRows);
  renderHiddenNote(allRows, rows);

  body.replaceChildren(...rows.map(row => {
    const kind = artifactKind(row.artifact);
    const isOff = off.has(row);
    const tr = document.createElement('tr');
    tr.className = [!row.odds ? 'dead' : '', row === cheapest && !isOff ? 'best-cost' : '', isOff ? 'off-group' : ''].filter(Boolean).join(' ');
    if (isOff) {
      tr.dataset.kind = kind;
      tr.title = `${KIND_LABEL[kind]} artifacts are not in your selection — click to add them.`;
    }

    const icon = artifactIcon(row.artifact.name);
    const approx = row.exact === false ? '≈ ' : '';
    const badge = row === cheapest ? '<em class="tag">cheapest</em>'
      : row === cheapestMine ? '<em class="tag">cheapest of yours</em>' : '';
    const groupTag = isOff ? `<em class="tag locked-group">+ ${html(KIND_LABEL[kind])}</em>` : '';

    tr.innerHTML = `
      <td class="artifact-cell"><img class="artifact-icon" src="${icon}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${html(row.artifact.name)}</span>${badge}${groupTag}</td>
      <td class="num" title="${row.exact === false ? `Sampled estimate over ${count(row.samples)} runs — the exact tree exceeded its budget.` : 'Exact weighted-tree calculation.'}">${approx}${percent(row.odds)}</td>
      <td class="num">${row.odds ? count(row.rerolls) : '∞'}</td>
      <td class="num strong">${row.odds ? `${dustIcon(config.dust)}${count(row.dust)}` : '∞'}</td>
      <td class="num muted">${row.artifactDust ? `${dustIcon(row.artifactDustType)}${count(row.artifactDust)}` : '—'}</td>
      <td class="num">${row.odds ? count(row.artifactsUsed) : '∞'}</td>`;
    return tr;
  }));
}

/*
 * What a goal weighs in one draw. A family weighs what its members weigh
 * together: the family itself is never in the pool, so asking for its own id
 * would say nought per cent for a goal that is in fact the easiest of its kind.
 */
function goalWeightIn(pool, name) {
  let total = 0;
  for (const member of EnchantEngine.membersOf(state.data, name)) {
    const mod = state.data.byName.get(member);
    if (mod) total += pool.weights.get(mod.id) || 0;
  }
  return total;
}

function renderSummary(rows, config) {
  const panel = $('summary');
  const goals = [config.desired, ...config.goals].filter(Boolean);
  const multi = goals.length > 1;
  const viable = rows.filter(row => row.odds > 0);

  if (!viable.length && !multi) {
    panel.hidden = false;
    panel.innerHTML = `<div class="summary-title bad">“${html(config.desired)}” cannot be rolled with this configuration.</div><p class="note">Check the locked slots: one of their Labels is probably in the target's Incompatible Labels.</p>`;
    return;
  }

  const rolls = EnchantEngine.rollsRemaining(config);
  // value + what it means, on one line each. Five tiles of nineteen-point type
  // cost two hundred pixels, and with four slots that was enough to push the
  // build plan off the screen — which is the one thing the layout is for.
  const figure = (value, label, hint) =>
    `<span class="figure"${hint ? ` title="${html(hint)}"` : ''}><b>${value}</b><small>${label}</small></span>`;

  let figures;
  if (multi) {
    figures = [
      figure(rolls, `random slot${rolls === 1 ? '' : 's'} per reroll`, `${config.slots} total, ${config.locks.length} locked`),
      figure(goals.length, 'wanted, lock or reroll by outcome'),
      figure(`×${Math.pow(2, config.locks.length)}`, 'dust per reroll', 'Doubles with every lock')
    ].join('');
  } else {
    const bestOdds = viable.reduce((best, row) => row.odds > best.odds ? row : best);
    const bestDust = viable.reduce((best, row) => row.dust < best.dust ? row : best);
    const pool = EnchantEngine.weightedPool(state.data, config, bestDust.artifact);
    const perSlot = pool.total ? goalWeightIn(pool, config.desired) / pool.total * 100 : 0;
    figures = [
      figure(percent(bestOdds.odds), `best per reroll · ${html(bestOdds.artifact.name)}`),
      figure(`${dustIcon(config.dust)}${count(bestDust.dust)}`, `cheapest · ${html(bestDust.artifact.name)}`),
      figure(percent(perSlot), 'on a single slot'),
      figure(rolls, `random slot${rolls === 1 ? '' : 's'} per reroll`, `${config.slots} total, ${config.locks.length} locked`),
      figure(`×${Math.pow(2, config.locks.length)}`, 'dust per reroll', 'Doubles with every lock')
    ].join('');
  }

  const title = multi
    ? `Targets: <b>${goals.map(name => html(name)).join(' + ')}</b>`
    : `Target: ${enchantIconHtml(state.data.byName.get(config.desired), 'inline-icon')} <b>${html(config.desired)}</b>`;

  panel.innerHTML = `
    <div class="summary-head">
      <div class="summary-title">${title}</div>
      <button id="showAudit" type="button" class="secondary">${$('auditCard').hidden ? 'Explain these odds' : 'Hide the explanation'}</button>
      ${artifactFilterHtml()}
    </div>
    <div class="summary-figures">${figures}</div>`;
  revealResultCard(panel);
}

/* ------------------------------------------------------------------ *
 * Audit                                                               *
 * ------------------------------------------------------------------ */

// The button opens and closes it; the × in its header does the same.
function toggleAudit() {
  if ($('auditCard').hidden) showAudit();
  else hideAudit();
}

function hideAudit() {
  $('auditCard').hidden = true;
  const button = $('showAudit');
  if (button) button.textContent = 'Explain these odds';
}

function showAudit() {
  const config = cfg();
  const rows = state.lastResults || [];
  // The explanation must describe an artifact you would actually use, so it
  // follows the same selection the table and the plan follow.
  const viable = rows.filter(row => row.odds > 0 && isAllowedRow(row));
  const artifact = viable.length ? viable.reduce((best, row) => row.dust < best.dust ? row : best).artifact : state.data.byArtifact.get('No Artifact');
  const target = state.data.byName.get(config.desired);
  const card = $('auditCard');
  card.hidden = false;
  $('auditFor').textContent = `worked through with ${artifact.name}`;
  const button = $('showAudit');
  if (button) button.textContent = 'Hide the explanation';

  const pool = EnchantEngine.weightedPool(state.data, config, artifact);
  const targetWeight = goalWeightIn(pool, config.desired);
  if (!targetWeight) {
    $('auditResult').innerHTML = '<p class="note warn">The target is not in the eligible pool for this configuration, so its chance is exactly 0.</p>';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const rolls = EnchantEngine.rollsRemaining(config);
  const exact = EnchantEngine.oddsAny(state.data, config, artifact, [config.desired]);
  const perSlot = targetWeight / pool.total * 100;
  const naive = 100 * (1 - Math.pow(1 - perSlot / 100, rolls));
  const cost = EnchantEngine.costFor(config, exact.odds, artifact, config.dust);

  // What the locks removed, so the pool size is verifiable by hand.
  const unlocked = Object.assign({}, config, { locks: [] });
  const openPool = EnchantEngine.eligiblePool(state.data, unlocked, artifact);
  const present = new Set(pool.mods.map(mod => mod.id));
  const removed = openPool.filter(mod => !present.has(mod.id));
  const labels = [...EnchantEngine.lockedLabels(state.data, config)].filter(label => state.data.blockingLabels.has(label)).sort();

  // Biggest single contributors, so the weighted pool is legible.
  const heaviest = pool.mods.slice().sort((a, b) => pool.weights.get(b.id) - pool.weights.get(a.id)).slice(0, 8);

  $('auditResult').innerHTML = `
    <p class="note">Scenario: <b>${html(config.desired)}</b> on a ${config.slots}-slot ${html(config.type.toLowerCase())} with <b>${html(artifact.name)}</b>${config.item ? ` (${html(config.item)})` : ''}.</p>

    <ol class="audit-steps">
      <li>
        <h3>Build the Eligible Pool</h3>
        <p>Start from the ${openPool.length} enchantments this ${html(config.type.toLowerCase())} can roll${config.item ? ' with the selected item' : ''}, then remove what the ${plural(config.locks.length, 'lock')} forbid.</p>
        <dl>
          <dt>Labels carried by the locks</dt><dd>${labels.length ? `<span class="chips">${labels.map(label => `<i class="chip give">${html(label)}</i>`).join('')}</span>` : '<span class="muted">none</span>'}</dd>
          <dt>Removed by those Labels or already locked</dt><dd>${removed.length}</dd>
          <dt>Remaining candidates</dt><dd><b>${pool.mods.length}</b></dd>
        </dl>
        ${removed.length ? `<details><summary>${removed.length} removed candidates</summary><p class="removed-list">${removed.map(mod => html(mod.name)).join(' · ')}</p></details>` : ''}
      </li>

      <li>
        <h3>Weight the Pool for ${html(artifact.name)}</h3>
        <p>Each candidate keeps its base weight unless the artifact multiplies it. An artifact states several rules and every one that matches applies in turn, so two matching rules compound rather than compete. The result is truncated to an integer, as the game does.</p>
        <dl>
          <dt>Total weight of the pool</dt><dd><b>${count(pool.total)}</b></dd>
          <dt>${html(config.desired)}</dt><dd><b>${count(targetWeight)}</b>${targetWeight !== target.weight ? ` <span class="muted">(base ${count(target.weight)} × ${RealmI18n.number(targetWeight / target.weight, { maximumFractionDigits: 2 })})</span>` : ''}</dd>
        </dl>
        <details><summary>Heaviest candidates in the pool</summary><table class="mini"><tbody>${heaviest.map(mod => `<tr><td>${html(mod.name)}</td><td class="num">${count(pool.weights.get(mod.id))}</td><td class="num muted">${RealmI18n.number(pool.weights.get(mod.id) / pool.total * 100, { maximumFractionDigits: 2 })}%</td></tr>`).join('')}</tbody></table></details>
      </li>

      <li>
        <h3>One Slot</h3>
        <p class="formula">${count(targetWeight)} ÷ ${count(pool.total)} = <b>${percent(perSlot)}</b></p>
      </li>

      <li>
        <h3>${plural(rolls, 'Slot')} in One Reroll</h3>
        <p>The slots are not independent: whatever the first slot rolls adds its Labels, which removes every remaining candidate that refuses them, and the mod itself leaves the pool. The engine enumerates every weighted path.</p>
        <dl>
          <dt>Exact chance over ${plural(rolls, 'slot')}</dt><dd><b>${percent(exact.odds)}</b>${exact.exact === false ? ' <span class="muted">(sampled)</span>' : ''}</dd>
          <dt>Naive 1 − (1 − p)<sup>${rolls}</sup></dt><dd class="muted">${percent(naive)} — ${naive > exact.odds ? 'too optimistic' : 'too pessimistic'}, because the pool shrinks between slots</dd>
          <dt>Tree size</dt><dd class="muted">${count(exact.nodes)} states enumerated</dd>
        </dl>
      </li>

      <li>
        <h3>Turn It Into Dust</h3>
        <p class="formula">
          one reroll = ${count(EnchantEngine.BASE_COSTS[config.slots])} base × 2<sup>${config.locks.length}</sup> = <b>${count(cost.perReroll)}</b> ${html(config.dust)}<br>
          mean rerolls = 100 ÷ ${RealmI18n.number(exact.odds, { maximumSignificantDigits: 4 })} = <b>${count(cost.rerolls)}</b><br>
          expected total = ${count(cost.perReroll)} × ${count(cost.rerolls)}${artifact.cost.dust === config.dust ? ` + ${count(artifact.cost.value * Math.pow(2, config.locks.length))} × ${count(cost.rerolls)}` : ''} = <b>${count(cost.dust)}</b> ${html(config.dust)}
        </p>
        <p class="note">Half of all players finish within ${count(cost.medianRerolls)} rerolls; the mean is higher than the median because the tail is long.${artifact.cost.dust !== 'na' && artifact.cost.dust !== config.dust ? ` This artifact also costs about ${count(cost.artifactDust)} ${html(artifact.cost.dust)} dust, billed separately.` : ''}</p>
      </li>
    </ol>

    <details class="audit-assumptions">
      <summary>Rules and known divergences from the Qt original</summary>
      <ul>
        <li>${html(EnchantEngine.NOTES.incompatibility)}</li>
        <li>${html(EnchantEngine.NOTES.qtDivergence)}</li>
        <li>${html(EnchantEngine.NOTES.duplicateRoll)}</li>
        <li>${html(EnchantEngine.NOTES.artifactsUsed)}</li>
        <li>${html(EnchantEngine.NOTES.plannerPolicy)}</li>
      </ul>
    </details>`;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------------------------------------------ *
 * Build plan                                                          *
 * ------------------------------------------------------------------ */

async function renderBuildPlan(config) {
  const card = $('planCard');
  const output = $('buildPlan');
  const goals = [config.desired, ...config.goals].filter(Boolean);
  if (goals.length < 2) return;

  if (!output.textContent.trim()) output.innerHTML = '<p class="note">Solving the cheapest lock order…</p>';
  await yieldToUi();

  // The plan may only use artifacts you said you would use. Unlike the single
  // target table, this is a constraint on the search: a cheaper order that
  // needs a card you do not have is not an answer.
  const artifacts = allowedArtifacts();
  const plan = EnchantEngine.planGoals(state.data, config, goals, { artifacts });
  if (!plan || !plan.feasible) {
    output.innerHTML = plan && plan.reason === 'slots'
      ? '<p class="note warn">These enchantments need more slots than the item has.</p>'
      : '<p class="note warn">No order can put all of these on the same item. At least one pair is mutually incompatible — open “Explain these odds” and compare their Labels against their Incompatible Labels.</p>';
    return;
  }

  const dust = amount => `${dustIcon(config.dust)}${count(amount)}`;

  const steps = plan.path.map((step, index) => {
    const icon = artifactIcon(step.artifact.name);
    const hasDirectHunt = step.hunt && step.hunt.length;
    const huntNames = hasDirectHunt ? step.hunt : (step.likelyGain || []);

    const tieredHunt = huntNames.some(name => {
      const members = EnchantEngine.membersOf(state.data, name);
      return members.some(member => {
        const mod = state.data.byName.get(member);
        return Boolean(mod && mod.tags.has('TIERED'));
      });
    });

    const tierLabel = [...config.tiers]
      .sort((a, b) => a - b)
      .map(tier => ['I', 'II', 'III', 'IV'][tier - 1])
      .join(', ');

    const tierHint = tieredHunt ? `<small>accepted tier${config.tiers.size === 1 ? '' : 's'} ${tierLabel}</small>` : '';

    const sameDustArtifact = step.artifactCharge > 0
      && step.artifactDustType === config.dust;
    const primaryAttempt = step.perReroll
      + (sameDustArtifact ? step.artifactCharge : 0);

    // Every attempt at this step costs the same and leaves it with the same
    // chance, so the time spent here is geometric: what this step alone is
    // expected to cost, before the next one starts.
    const stepRerolls = 100 / step.progressChance;
    const stepDust = primaryAttempt * stepRerolls;

    // The figure is always the primary dust. An artifact paid in the same dust
    // is folded into it; one paid in another dust is shown beside it, and
    // plainly not counted.
    let artifactCost = '';
    if (step.artifactCharge > 0) {
      artifactCost = sameDustArtifact
        ? `<span class="plan-side">(${count(step.perReroll)} reroll + ${count(step.artifactCharge)} artifact)</span>`
        : `<span class="plan-side">+ ${dustIcon(step.artifactDustType)}${count(step.artifactCharge)} ${html(step.artifactDustType)} artifact, not counted</span>`;
    }

    // Combined wanted-enchantment outcomes are handled by the planner but not
    // listed here: the useful player instruction is what to do when one wanted
    // enchantment appears by itself.
    const simpleDecisions = (step.decisions || [])
      .filter(decision => decision.rolled.length === 1);

    // What you keep carries its sprite, so it is recognised on the item the
    // moment it lands; what you throw back stays plain text.
    const decisionRow = (decision, reroll) => {
      const name = decision.rolled[0];
      const mod = !reroll && state.data.byName.get(name);
      return `
        <div class="plan-action-row">
          <span class="plan-action-name">${mod ? enchantIconHtml(mod, 'inline-icon') : ''}${html(name)}${reroll ? '<i> alone</i>' : ''}</span>
          <span class="plan-action-chance">${percent(decision.chance)}</span>
        </div>`;
    };

    const lockDecisions = simpleDecisions.filter(decision => decision.action === 'lock');
    const rerollDecisions = simpleDecisions.filter(decision => decision.action === 'reroll');
    const lockFinishes = step.locked.length + 1 >= goals.length;

    const policy = `
      <div class="plan-policy">
        <section class="plan-policy-group lock">
          <h4><span aria-hidden="true">✓</span> ${lockFinishes ? 'Lock &amp; finish' : 'Lock &amp; continue'}${tierHint}</h4>
          ${lockDecisions.length
            ? lockDecisions.map(decision => decisionRow(decision, false)).join('')
            : '<div class="plan-action-empty">No single enchantment to lock here</div>'}
        </section>

        <section class="plan-policy-group reroll">
          <h4><span aria-hidden="true">↻</span> Reroll</h4>
          ${rerollDecisions.map(decision => decisionRow(decision, true)).join('')}
          <div class="plan-action-row fallback">
            <span class="plan-action-name">Anything else</span>
          </div>
        </section>
      </div>`;

    return `
      <li>
        <span class="plan-step">${index + 1}</span>

        <div class="plan-head">
          <div class="plan-goal">
            <small>Roll with</small>
            <div class="plan-target">
              <img src="${icon}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
              <span>${html(step.artifact.name)}</span>
              ${artifactKind(step.artifact) !== 'none'
                ? `<button type="button" class="plan-dismiss" data-blacklist-artifact="${html(step.artifact.name)}">I don't have this</button>`
                : ''}
            </div>
          </div>
          <div class="plan-finish">
            <b>${dust(stepDust)}</b>
            <small>expected ${html(config.dust)} for this step · ~${count(stepRerolls)} reroll${Math.round(stepRerolls) === 1 ? '' : 's'}</small>
            <small class="plan-left">${count(step.expectedDustFromHere)} left until the end</small>
          </div>
        </div>

        <div class="plan-meta">
          <span><b>${percent(step.progressChance)}</b> chance of useful progress</span>
          <span><b>${dust(primaryAttempt)}</b> fixed per reroll ${artifactCost}</span>
        </div>

        ${policy}
      </li>`;
  }).join('');


  output.innerHTML = `
    <div class="plan-total">
      <span class="figure strong"><b>${dust(plan.dust)}</b><small>expected ${html(config.dust)} dust for all ${plural(goals.length, 'enchantment')}</small></span>
      <span class="figure"><b>${count(plan.rerolls)}</b><small>rerolls in total</small></span>
    </div>

    <ol class="plan-steps">${steps}</ol>`;
}

/* ------------------------------------------------------------------ *
 * Orchestration                                                       *
 * ------------------------------------------------------------------ */

/*
 * Swapping the artifact table for the build plan.
 *
 * Two rules, both learned by getting them wrong. The cards never share the
 * layout: cross-fading them left one sitting under the other for a sixth of a
 * second, and the column snapped upwards the moment the first was removed —
 * which is what read as abrupt, not the speed. And the leaving card settles
 * backwards while the arriving one rises, so the two halves feel like one
 * movement rather than two cuts.
 *
 * setTimeout rather than requestAnimationFrame throughout: a background tab
 * never paints, so a class removed on the next frame would never be removed at
 * all and the card would come back invisible.
 */
const SWAP_OUT = 300;   // must match the leaving transition in style.css
const SWAP_IN = 420;    // and the entering one
const RESULT_CARDS = ['artifactCard', 'planCard'];

/*
 * While the work area is still stepping aside and back, nothing inside it
 * moves on its own.
 *
 * Switching tabs is one movement: the layout leaves in the direction of
 * travel and the new one arrives. The cards inside were running their own
 * arrival on top of that and landing a beat after it settled — the summary
 * a full three hundred milliseconds late — which is what made changing tabs
 * look like a fault correcting itself rather than a page turning.
 *
 * 190 ms out plus 300 ms in, and a little to spare. Past that window the
 * calculation has genuinely taken a while and a card appearing is news, so it
 * arrives the way it always did.
 */
const TAB_SETTLE_MS = 560;
function midTabSwap() {
  return Date.now() - (state.tabSwappedAt || 0) < TAB_SETTLE_MS;
}

function hideResultCard(card) {
  if (card.hidden) return false;
  clearTimeout(card.swapTimer);
  if (midTabSwap()) {
    card.classList.remove('entering', 'leaving');
    card.hidden = true;
    return false;                      // nothing is leaving, so nothing waits
  }
  card.classList.remove('entering');
  card.classList.add('leaving');
  card.leaveStartedAt = Date.now();
  card.swapTimer = setTimeout(() => {
    card.hidden = true;
    card.classList.remove('leaving');
  }, SWAP_OUT);
  return true;
}

/*
 * Brings a card in once whatever is leaving has finished leaving.
 *
 * Deliberately not tied to the calculation finishing. The plan search can hold
 * the main thread for a second or more, and hanging the reveal off the end of
 * it left the screen with neither card on it for most of that time. The card
 * arrives with its waiting message instead, and fills in when the numbers do.
 */
function scheduleReveal(id) {
  const card = $(id);
  if (!card.hidden && !card.classList.contains('leaving')) return;
  const leaving = RESULT_CARDS.map($).filter(other => other !== card && other.classList.contains('leaving'));
  const wait = leaving.reduce((most, other) =>
    Math.max(most, SWAP_OUT - (Date.now() - (other.leaveStartedAt || 0))), 0);
  clearTimeout(card.revealTimer);
  card.revealTimer = setTimeout(() => {
    for (const other of leaving) {
      clearTimeout(other.swapTimer);
      other.hidden = true;
      other.classList.remove('leaving');
    }
    revealResultCard(card);
  }, Math.max(0, wait));
}

function revealResultCard(card) {
  if (!card.hidden && !card.classList.contains('leaving')) return;
  clearTimeout(card.swapTimer);
  if (midTabSwap()) {
    card.classList.remove('entering', 'leaving');
    card.hidden = false;
    return;
  }
  // The starting state has to be in place before the card enters the layout,
  // or it flashes at full opacity for one frame.
  card.classList.remove('leaving');
  card.classList.add('entering');
  card.hidden = false;
  card.swapTimer = setTimeout(() => card.classList.remove('entering'), 30);
}

// Takes away whatever is not `id`. Bringing `id` in is the caller's business,
// because only the caller knows when its content is ready to be looked at.
function hideOtherResultCards(id) {
  for (const other of RESULT_CARDS) if (other !== id) hideResultCard($(other));
}

/*
 * Starts the swap, if one is due. Called the moment the configuration changes
 * rather than when the calculation starts: waiting for the debounce and the
 * first artifacts meant three quarters of a second passed between the click
 * and anything moving, which is most of what made the change feel abrupt —
 * nothing, nothing, nothing, then everything at once.
 *
 * Idempotent, so calling it again from the calculation costs nothing.
 */
function beginResultSwap(config) {
  const incoming = goalCount(config) > 1 ? 'planCard' : 'artifactCard';
  const card = $(incoming);
  if (!card.hidden && !card.classList.contains('leaving')) return;
  hideOtherResultCards(incoming);
  if (incoming === 'planCard') $('buildPlan').innerHTML = '<p class="note">Solving the cheapest lock order…</p>';
  scheduleReveal(incoming);
}

async function runCalculation() {
  const config = cfg();
  if (!whatIsMissing(config).ready) return;
  const generation = ++state.runId;
  beginResultSwap(config);

  const rows = [];
  const breathe = budgetedYield(12);
  for (let index = 0; index < state.data.artifacts.length; index++) {
    await breathe();
    if (state.runId !== generation) return;          // a newer change won
    rows.push(EnchantEngine.evaluate(state.data, config, state.data.artifacts[index]));
    $('progressBar').style.width = `${(index + 1) / state.data.artifacts.length * 100}%`;
  }
  rows.sort((a, b) => b.odds - a.odds);
  state.lastResults = rows;

  // One wanted enchantment is a question about artifacts; several is a
  // question about order. Showing both at once only made each harder to read.
  const multi = goalCount(config) > 1;
  if (!multi) renderResults(rows, config);
  renderSummary(rows, config);
  $('auditCard').hidden = true;
  await renderBuildPlan(config);
  if (state.runId !== generation) return;

  // No line about how many artifacts were counted or whether the rows are
  // exact: the progress bar already showed the work, and a sampled row says so
  // on the row itself, with a ≈ and the sample count in its tooltip. The pill
  // in the masthead answers the question a player actually has — whether these
  // numbers still match the game.
  $('progressBar').style.width = '0%';
}

// Everything a finished run put on screen, taken back down.


/* ------------------------------------------------------------------ *
 * Wiring                                                              *
 * ------------------------------------------------------------------ */

function bind() {
  document.querySelectorAll('select, input[list]').forEach(element => {
    element.addEventListener('change', () => onFieldChange(element));
    // While typing, only react once the value is a complete item we recognise —
    // that is what makes picking from the suggestion list apply straight away.
    element.addEventListener('input', () => { if (element.id !== 'awakenedItem' || resolveItem(element.value)) onFieldChange(element); });
  });
  document.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => { $(button.dataset.clear).value = ''; refresh(); }));
  $('subtypePanel').addEventListener('change', event => {
    // ALIEN and NEO_ALIEN are mutually exclusive bases.
    if (event.target.checked && event.target.value !== 'SUMMONPOWERED') {
      for (const box of $('subtypePanel').querySelectorAll('input')) if (box !== event.target && box.value !== 'SUMMONPOWERED') box.checked = false;
    }
    refresh();
  });
  $('tiers').addEventListener('change', () => { if (state.lastResults) runCalculation(); });

  $('itemOptimizeGoals').addEventListener('click', event => {
    const goal = event.target.closest('[data-item-goal]');
    if (!goal) return;

    state.itemOptimizeGoal = goal.dataset.itemGoal;
    state.itemOptimizeSaid = '';
    state.itemOptimizeBlocked = '';
    saveSetup();
    renderItemOptimizer(cfg());
  });

  $('itemOptimizeRun').addEventListener('click', () => {
    optimizeCurrentItem();
  });

  $('slotList').addEventListener('click', event => {
    const pick = event.target.closest('[data-pick]');
    if (pick) { openPicker(Number(pick.dataset.pick)); return; }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      state.itemOptimizeSaid = '';
      state.itemOptimizeBlocked = '';
      const slot = state.slots[Number(remove.dataset.remove) - 1];
      slot.name = '';
      slot.locked = false;
      refresh();
      return;
    }
    const mode = event.target.closest('[data-mode]');
    if (mode) {
      state.itemOptimizeSaid = '';
      state.itemOptimizeBlocked = '';
      const slot = state.slots[Number(mode.dataset.slot) - 1];
      const wantLocked = mode.dataset.mode === 'locked';
      if (slot.locked === wantLocked) return;
      const previous = slot.locked;
      slot.locked = wantLocked;
      const mod = state.data.byName.get(slot.name);
      if (mod && conflictWith(mod, slot, state.slots.filter(other => other.index !== slot.index))) slot.locked = previous;
      refresh();
    }
  });

  $('pickerBackdrop').addEventListener('click', event => { if (event.target === $('pickerBackdrop')) closePicker(); });
  $('pickerClose').addEventListener('click', closePicker);
  $('pickerKinds').addEventListener('click', event => {
    const button = event.target.closest('[data-kind]');
    if (button) togglePickerKind(button.dataset.kind);
  });
  $('pickerSearch').addEventListener('input', event => {
    if (state.picker && state.picker.kind === 'item') renderItemPickerList(event.target.value);
    else renderPickerList(event.target.value);
  });
  $('pickerList').addEventListener('click', event => {
    const itemRow = event.target.closest('.picker-row[data-item]');
    if (itemRow) {
      const field = $('awakenedItem');
      field.value = itemRow.dataset.item;
      closePicker();
      onFieldChange(field);
      return;
    }
    const row = event.target.closest('.picker-row[data-name]');
    if (!row) return;
    /*
     * Somebody else may have opened this. The theory crafting page fills the
     * same list with its own candidates and hands in what to do with the
     * answer, so that both pages choose an enchantment through one dialogue
     * rather than two that drift apart.
     */
    if (state.picker.pick) {
      const chose = state.picker.pick;
      closePicker();
      chose(row.dataset.name);
      return;
    }
    const slot = state.slots[state.picker.index - 1];
    state.itemOptimizeSaid = '';
    state.itemOptimizeBlocked = '';
    slot.name = row.dataset.name;
    closePicker();
    refresh();
  });
  document.addEventListener('keydown', event => {
    if ($('pickerBackdrop').hidden) return;
    if (event.key === 'Escape') { closePicker(); return; }
    if (event.key === 'Tab') trapPickerTab(event);
  });

  $('itemEmpty').addEventListener('click', openItemPicker);
  $('itemCard').addEventListener('click', event => {
    if (event.target.closest('#changeItem')) { openItemPicker(); return; }
    if (event.target.closest('#clearItem')) clearItem();
  });
  $('tabBar').addEventListener('click', event => {
    if (event.target.closest('[data-group-menu]')) {
      const swatch = event.target.closest('[data-group-colour]');
      if (swatch) updateGroup(swatch.dataset.group, { colour: swatch.dataset.groupColour });
      return;
    }
    sayTabNote('');
    const fold = event.target.closest('[data-toggle-group]');
    if (fold) { toggleGroup(fold.dataset.toggleGroup); return; }
    const edit = event.target.closest('[data-edit-group]');
    if (edit) {
      state.editingGroup = state.editingGroup === edit.dataset.editGroup ? null : edit.dataset.editGroup;
      renderTabs();
      const field = $('tabBar').querySelector('[data-group-name]');
      if (field) { field.focus(); field.select(); }
      return;
    }
    const group = event.target.closest('[data-close-group]');
    if (group) { event.stopPropagation(); closeGroup(group.dataset.closeGroup); return; }
    const close = event.target.closest('[data-close]');
    if (close) { event.stopPropagation(); closeTab(close.dataset.close); return; }
    if (event.target.closest('#tabAdd')) { addTab(); return; }
    const tab = event.target.closest('[data-tab]');
    if (tab) switchTab(tab.dataset.tab);
  });
  /* The name is kept as it is typed, and the panel shuts on Enter, Escape or
     a click anywhere else. */
  $('tabBar').addEventListener('change', event => {
    const field = event.target.closest('[data-group-name]');
    if (!field) return;
    const label = field.value.trim().slice(0, 60);
    if (label) updateGroup(field.dataset.groupName, { label });
  });
  $('tabBar').addEventListener('keydown', event => {
    const field = event.target.closest('[data-group-name]');
    if (!field || (event.key !== 'Enter' && event.key !== 'Escape')) return;
    event.preventDefault();
    const id = field.dataset.groupName;
    if (event.key === 'Enter') {
      const label = field.value.trim().slice(0, 60);
      if (label) updateGroup(id, { label });
    }
    state.editingGroup = null;
    renderTabs();
    const back = $('tabBar').querySelector('[data-edit-group="' + CSS.escape(id) + '"]');
    if (back) back.focus();
  });
  document.addEventListener('click', event => {
    // A target the strip has just redrawn away was inside it, not outside.
    if (!state.editingGroup || !event.target.isConnected
      || event.target.closest('#tabBar .tab-group')) return;
    state.editingGroup = null;
    renderTabs();
  });
  /*
   * The atlas frame. Shut, it swallows nothing: the map inside it takes no
   * pointer at all, so a click anywhere on it opens it out rather than
   * panning a map the size of a postcard. Open, the map has the pointer and
   * the ways out are the cross, the key, and anywhere off the frame.
   */
  wireSaying();
  keepCornerRoom();

  const globeBox = document.getElementById('globeBox');
  if (globeBox) {
    globeBox.addEventListener('click', () => { if (!globeWide()) setGlobe(true); });
    globeBox.addEventListener('keydown', event => {
      if (globeWide() || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      setGlobe(true);
    });
  }
  watchGlobe();
  const globeBack = document.getElementById('globeBack');
  if (globeBack) globeBack.addEventListener('click', () => setGlobe(false));
  const globeSky = document.getElementById('globeSky');
  if (globeSky) {
    globeSky.addEventListener('click', event => {
      event.stopPropagation();
      tellAtlas({ rotmg: 'clear-sky', on: !skyClear });
    });
  }
  const globeShut = document.getElementById('globeShut');
  if (globeShut) {
    globeShut.addEventListener('click', event => { event.stopPropagation(); shutAtlasIndex(); setGlobe(false); });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && globeWide()) setGlobe(false);
  });
  $('summary').addEventListener('click', event => { if (event.target.id === 'showAudit') toggleAudit(); });
  $('auditClose').addEventListener('click', hideAudit);
  // A greyed row is an invitation: clicking it adds its group to the selection.
  $('results').addEventListener('click', event => {
    const row = event.target.closest('tr.off-group');
    if (row) enableKind(row.dataset.kind);
  });
  $('buildPlan').addEventListener('click', event => {
    const button = event.target.closest('[data-blacklist-artifact]');
    if (!button) return;

    const name = button.dataset.blacklistArtifact;
    if (!name) return;

    blacklistedArtifacts().add(name);
    refresh();
  });

  $('summary').addEventListener('click', event => {
    const restore = event.target.closest('[data-artifact-restore]');
    if (restore) {
      blacklistedArtifacts().delete(restore.dataset.artifactRestore);
      refresh();
      return;
    }

    const chip = event.target.closest('[data-kind]');
    if (!chip) return;
    toggleKind(chip.dataset.kind);
  });

}

/* ------------------------------------------------------------------ *
 * The shared sky behind every tool page                               *
 * ------------------------------------------------------------------ */

// The Atlas paints 460 fixed stars: its fourth-power brightness curve leaves
// most of them close to the threshold and lets the occasional bright point
// carry the field.  Keep the same number and seed here, but paint them once
// into the module host rather than spending a frame loop on page decoration.
const MODULE_STARS = 460;
// Six streaks on an eighteen-second round trip average one crossing every
// three seconds - roughly double the atlas' own meteors on the way in, four
// of them firing every eleven to thirty-seven seconds for about one every
// six. See web/assets/atlas/index.html's STARS/METEORS block for that math;
// it is not reread here, only matched.
const SHOOTING_STARS = 6;
const SHOOTING_CYCLE = 18;

/*
 * The module sky's own rich-star language, built once into the otherwise
 * empty .starfield host so the opacity rules that gate that host - off for
 * the way in, on for every tool page - gate this exactly the same way with
 * no extra wiring. The normal field is a single static, DPR-aware canvas;
 * only the existing occasional meteors still animate as DOM elements.
 */
function buildStarLanguage(host) {
  if (!host || host.dataset.stars) return;
  host.dataset.stars = '1';
  let value = 987654321;
  const random = () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
  const stars = [];
  for (let i = 0; i < MODULE_STARS; i++) {
    const lit = Math.pow(random(), 4);
    stars.push({
      x: random(), y: random(),
      lit: 0.16 + lit * 0.84,
      size: 0.5 + lit * 1.5,
      warm: random()
    });
    // Advance through the Atlas' live-twinkle fields too, so every later
    // point keeps the same fixed-seed position and colour as its sky.
    random();
    random();
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'module-star-canvas';
  host.appendChild(canvas);
  const paintStars = () => {
    const box = canvas.getBoundingClientRect();
    const width = Math.round(box.width), height = Math.round(box.height);
    if (!width || !height) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const star of stars) {
      const ink = star.warm < 0.62 ? '198, 214, 255'
        : star.warm < 0.86 ? '255, 248, 232' : '255, 214, 178';
      ctx.fillStyle = 'rgba(' + ink + ',' + star.lit.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  paintStars();
  // Resize is the only reason the normal field is painted again; this also
  // catches display-DPR changes that browsers report with a resize.
  window.addEventListener('resize', paintStars);
  const pieces = [];
  // Evenly spaced round-robin rather than independently random starts, so
  // six streaks on one cycle length land one every CYCLE/6 seconds instead
  // of clumping and leaving gaps.
  for (let i = 0; i < SHOOTING_STARS; i++) {
    const angle = 18 + random() * 20;
    pieces.push('<i class="shooting-star" style="'
      + `left:${(random() * 90).toFixed(2)}%;top:${(random() * 45).toFixed(2)}%;`
      + `--a:${angle.toFixed(1)}deg;`
      + `animation-duration:${SHOOTING_CYCLE}s;`
      + `animation-delay:-${(i * (SHOOTING_CYCLE / SHOOTING_STARS)).toFixed(2)}s"></i>`);
  }
  host.insertAdjacentHTML('beforeend', pieces.join(''));
}

/*
 * The sky behind the tool pages: the starfield, built once. The drifting
 * realms that used to lie over it - an aurora and a scatter of sprites -
 * are gone rather than paused: the way in stands on the atlas, and a tool
 * page stands on this.
 */
function initStarfield() {
  buildStarLanguage(document.querySelector('.starfield'));
}

/* ------------------------------------------------------------------ *
 * Remembering the setup                                               *
 * ------------------------------------------------------------------ */

/*
 * The whole editor is kept in this browser only. Every access is guarded:
 * storage can be unavailable in a private window, and on some browsers it
 * throws outright for pages opened from the file system.
 */
function captureSetup() {
  return {
    rarity: $('rarity').value,
    type: $('itemType').value,
    dust: $('dustType').value,
    item: $('awakenedItem').value,
    subtypes: [...document.querySelectorAll('#subtypePanel input:checked')].map(box => box.value),
    tiers: [...document.querySelectorAll('#tiers input:checked')].map(box => box.value),
    artifactBlacklist: [...blacklistedArtifacts()],
    optimizeGoal: state.itemOptimizeGoal,
    slots: state.slots.map(slot => ({ name: slot.name, locked: slot.locked }))
  };
}

// Called on every edit: keep the active tab in step with the editor, then
// write the whole set of tabs out.
function saveSetup() {
  if (!state.ready || state.loadingTab) return;
  const tab = state.tabs.find(entry => entry.id === state.activeTab);
  if (!tab) return;
  tab.setup = captureSetup();
  tab.label = labelForSetup(tab.setup);
  persistTabs();
  renderTabs();
}

function applySetup(saved) {
  if (!saved || typeof saved !== 'object') saved = {};
  $('rarity').value = saved.rarity || '';
  $('itemType').value = saved.type || '';
  $('dustType').value = saved.dust || '';
  $('awakenedItem').value = saved.item || '';
  renderSubtypes();
  for (const box of document.querySelectorAll('#subtypePanel input')) box.checked = (saved.subtypes || []).includes(box.value);
  for (const box of document.querySelectorAll('#tiers input')) box.checked = !saved.tiers || saved.tiers.includes(box.value);
  state.artifactBlacklist = new Set(Array.isArray(saved.artifactBlacklist) ? saved.artifactBlacklist : []);
  state.slots.forEach(slot => { slot.name = ''; slot.locked = false; });
  if (Array.isArray(saved.slots)) {
    saved.slots.slice(0, 4).forEach((entry, index) => {
      if (!entry || !state.data.byName.has(entry.name)) return;
      state.slots[index].name = entry.name;
      state.slots[index].locked = Boolean(entry.locked);
    });
  }
  state.lastCardItem = saved.item || '';
  state.itemOptimizeGoal =
    ITEM_OPTIMIZER_GOALS.some(
      one => one.id === saved.optimizeGoal
    )
      ? saved.optimizeGoal
      : 'dps';
  state.itemOptimizeSaid = '';
  // refresh() drops anything the restored combination no longer allows.
}

/* ------------------------------------------------------------------ *
 * Setups, kept side by side like browser tabs                         *
 * ------------------------------------------------------------------ */

/*
 * Each tab is one saved configuration, held in this browser only. Switching
 * tabs writes the current editor into the tab you are leaving and loads the
 * one you are going to, so nothing is ever lost by clicking away.
 */
function labelForSetup(setup) {
  if (setup && setup.item) return setup.item;
  const wanted = (setup && setup.slots || []).filter(slot => slot && slot.name);
  if (wanted.length) return wanted[0].name;
  return 'Empty setup';
}

const newTab = setup => ({ id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, setup: setup || {}, label: labelForSetup(setup) });

function persistTabs() {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: state.tabs, active: state.activeTab }));
  } catch (error) { /* storage unavailable — the app still works, it just forgets */ }
}

function loadTabs() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(TABS_KEY) || 'null'); } catch (error) { stored = null; }
  if (stored && Array.isArray(stored.tabs) && stored.tabs.length) {
    state.tabs = stored.tabs.filter(tab => tab && tab.id);
    state.activeTab = state.tabs.some(tab => tab.id === stored.active) ? stored.active : state.tabs[0].id;
    return;
  }
  // Carry over the single setup saved by earlier versions.
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (error) { legacy = null; }
  state.tabs = [newTab(legacy || {})];
  state.activeTab = state.tabs[0].id;
}

// The filter is a reading preference and survives a reload, but a stored value
// that has gone stale must never switch a kind on that the user did not ask for.
function loadFilters() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); } catch (error) { saved = null; }
  if (!saved) return;
  for (const kind of Object.keys(state.filters)) {
    if (typeof saved[kind] === 'boolean') state.filters[kind] = saved[kind];
  }
}

function renderTabs() {
  const bar = $('tabBar');
  bar.replaceChildren();
  /*
   * A build sent over from Theory Crafting arrives as a group: its tabs stand
   * together in a bracket headed by the build's name, which also closes the
   * lot of them. Groups are runs of neighbours - a tab is only ever added
   * after the others - so each run gets one bracket.
   */
  let into = bar, openGroup = null;
  for (const tab of state.tabs) {
    const group = tab.group && tab.group.id ? tab.group : null;
    if (!group || !openGroup || openGroup !== group.id) {
      into = bar;
      openGroup = null;
      if (group) {
        const members = state.tabs.filter(one => one.group && one.group.id === group.id);
        const colour = GROUP_COLOURS[group.colour] ? group.colour : 'blue';
        const box = document.createElement('div');
        box.className = 'tab-group' + (group.collapsed ? ' is-collapsed' : '')
          + (members.some(one => one.id === state.activeTab) ? ' has-active' : '');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', group.label);
        box.style.setProperty('--g', GROUP_COLOURS[colour]);
        const head = document.createElement('span');
        head.className = 'tab-group-head';
        /* The name is the fold: pressed, the group shuts down to its chip
           and opens again - the way a browser folds a tab group away. */
        head.innerHTML = `<button type="button" class="tab-group-name" data-toggle-group="${html(group.id)}"`
          + ` aria-expanded="${group.collapsed ? 'false' : 'true'}"`
          + ` title="${group.collapsed ? 'Show' : 'Fold away'} the tabs of ${html(group.label)}">`
          + `<span class="tab-group-label">${html(group.label)}</span>`
          + `<span class="tab-group-count">${members.length}</span></button>`
          + `<button type="button" class="tab-group-edit" data-edit-group="${html(group.id)}"`
          + ` aria-expanded="${state.editingGroup === group.id ? 'true' : 'false'}"`
          + ` title="Rename or recolour ${html(group.label)}" aria-label="Rename or recolour ${html(group.label)}">✎</button>`
          + `<span class="tab-group-close" data-close-group="${html(group.id)}" role="button"`
          + ` title="Close every tab of ${html(group.label)}" aria-label="Close every tab of ${html(group.label)}">×</span>`;
        box.append(head);
        if (state.editingGroup === group.id) box.append(groupMenu(group, colour));
        bar.append(box);
        into = box;
        openGroup = group.id;
      }
    }
    if (tab.group && tab.group.collapsed) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab${tab.id === state.activeTab ? ' active' : ''}`;
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === state.activeTab));
    button.title = tab.label;
    button.innerHTML = `<span class="tab-label">${html(tab.label)}</span>${state.tabs.length > 1 ? `<span class="tab-close" data-close="${tab.id}" role="button" aria-label="Close ${html(tab.label)}">×</span>` : ''}`;
    into.append(button);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tab-add';
  add.id = 'tabAdd';
  add.title = 'Start another setup';
  add.setAttribute('aria-label', 'New setup');
  add.append('New');
  bar.append(add);
}

/*
 * Switching tab replaces everything on screen at once, which without a
 * transition is indistinguishable from a glitch. The work area steps aside in
 * the direction of travel — a tab to the right leaves towards the left — and
 * the new setup arrives from the other side.
 *
 * The swap itself is deferred until the old content has gone, for the same
 * reason the artifact table and the build plan never share the layout: two
 * states visible at once is what reads as broken.
 */
const TAB_SWAP_MS = 190;

function switchTab(id) {
  if (id === state.activeTab) return;
  const target = state.tabs.find(tab => tab.id === id);
  if (!target) return;
  if (target.group && target.group.collapsed) {
    for (const tab of state.tabs) if (tab.group && tab.group.id === target.group.id) tab.group.collapsed = false;
  }

  const layout = document.querySelector('.layout');
  const from = state.tabs.findIndex(tab => tab.id === state.activeTab);
  const to = state.tabs.findIndex(tab => tab.id === id);
  layout.style.setProperty('--dir', to > from ? '1' : '-1');

  saveSetup();                 // bank the tab we are leaving
  state.tabSwappedAt = Date.now();
  state.activeTab = id;
  persistTabs();               // the tab strip highlights the new one at once
  renderTabs();

  clearTimeout(state.tabTimer);
  layout.classList.remove('tab-entering');
  layout.classList.add('tab-leaving');
  state.tabTimer = setTimeout(() => {
    state.loadingTab = true;   // stop applySetup's edits from writing back
    applySetup(target.setup);
    state.loadingTab = false;
    clearResults();
    refresh();
    layout.classList.remove('tab-leaving');
    layout.classList.add('tab-entering');
    state.tabTimer = setTimeout(() => layout.classList.remove('tab-entering'), 30);
  }, TAB_SWAP_MS);
}

function addTab() {
  saveSetup();
  const tab = newTab({});
  state.tabs.push(tab);
  state.activeTab = tab.id;
  state.loadingTab = true;
  applySetup({});
  state.loadingTab = false;
  clearResults();
  refresh();
  persistTabs();
  $('awakenedItem').focus();
}

function closeTab(id) {
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index < 0 || state.tabs.length < 2) return;
  const wasActive = state.tabs[index].id === state.activeTab;
  state.tabs.splice(index, 1);
  if (wasActive) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    state.activeTab = next.id;
    state.loadingTab = true;
    applySetup(next.setup);
    state.loadingTab = false;
    clearResults();
  }
  refresh();
  persistTabs();
  renderTabs();
}

/*
 * A group's own colours: the page's accent and five more from the same
 * palette the rest of the site already speaks in, so a group never reads as
 * a warning or a tier it is not.
 */
const GROUP_COLOURS = {
  blue: '#79c5e8', gold: '#ffcb70', green: '#86d98e',
  purple: '#c79bf0', rose: '#ff9c8a', grey: '#9aa4ba'
};

/* The small panel a group is renamed and recoloured in. */
function groupMenu(group, colour) {
  const menu = document.createElement('div');
  menu.className = 'tab-group-menu';
  menu.dataset.groupMenu = group.id;
  menu.innerHTML = `<label class="tab-group-field"><span>Name</span>`
    + `<input type="text" maxlength="60" data-group-name="${html(group.id)}" value="${html(group.label)}"></label>`
    + `<div class="tab-group-swatches" role="group" aria-label="Group colour">`
    + Object.entries(GROUP_COLOURS).map(([name, value]) =>
      `<button type="button" class="tab-group-swatch${name === colour ? ' is-on' : ''}" data-group-colour="${name}"`
      + ` data-group="${html(group.id)}" style="--swatch:${value}" aria-pressed="${name === colour}"`
      + ` title="${name}" aria-label="${name}"></button>`).join('')
    + `</div>`;
  return menu;
}

/* Every tab of a group carries its own copy of the group, so a change is
   written into each of them and kept with the tabs. */
function updateGroup(id, patch) {
  let changed = false;
  for (const tab of state.tabs) {
    if (tab.group && tab.group.id === id) { Object.assign(tab.group, patch); changed = true; }
  }
  if (!changed) return;
  persistTabs();
  renderTabs();
}

/*
 * Folded away, a group is its chip alone. Folding the group the editor is
 * showing moves the editor to the nearest tab outside it, so what is on the
 * screen is never a tab that cannot be seen; with nothing outside it, the
 * group folds and its chip stays lit as the one being worked on.
 */
function toggleGroup(id) {
  const member = state.tabs.find(tab => tab.group && tab.group.id === id);
  if (!member) return;
  const folding = !member.group.collapsed;
  if (folding && member.group && state.tabs.some(tab => tab.id === state.activeTab
    && tab.group && tab.group.id === id)) {
    const at = state.tabs.findIndex(tab => tab.id === state.activeTab);
    const outside = state.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(one => !(one.tab.group && one.tab.group.id === id))
      .sort((a, b) => Math.abs(a.index - at) - Math.abs(b.index - at))[0];
    if (outside) {
      updateGroup(id, { collapsed: true });
      switchTab(outside.tab.id);
      return;
    }
  }
  updateGroup(id, { collapsed: folding });
}

/* Every tab of one sent build at once. The strip is never left empty: if the
   group was all there was, an empty setup takes its place. */
function closeGroup(id) {
  const leaving = state.tabs.filter(tab => tab.group && tab.group.id === id);
  if (!leaving.length) return;
  const wasActive = leaving.some(tab => tab.id === state.activeTab);
  const at = state.tabs.findIndex(tab => tab.group && tab.group.id === id);
  state.tabs = state.tabs.filter(tab => !(tab.group && tab.group.id === id));
  if (!state.tabs.length) state.tabs = [newTab({})];
  if (wasActive) {
    const next = state.tabs[Math.min(at, state.tabs.length - 1)];
    state.activeTab = next.id;
    state.loadingTab = true;
    applySetup(next.setup);
    state.loadingTab = false;
    clearResults();
  }
  refresh();
  persistTabs();
  renderTabs();
}

function clearItem() {
  state.itemOptimizeSaid = '';
  state.itemOptimizeBlocked = '';
  $('awakenedItem').value = '';
  $('rarity').value = '';
  $('itemType').value = '';
  $('dustType').value = '';
  for (const box of document.querySelectorAll('#subtypePanel input')) box.checked = false;
  state.slots.forEach(slot => { slot.name = ''; slot.locked = false; });
  state.lastCardItem = null;
  clearResults();
  refresh();
}

function clearResults() {
  clearTimeout(state.calcTimer);
  state.lastResults = null;
  for (const id of RESULT_CARDS) {
    const card = $(id);
    clearTimeout(card.swapTimer);
    card.classList.remove('entering', 'leaving');
  }
  $('artifactCard').hidden = false;
  $('summary').hidden = true;
  $('planCard').hidden = true;
  $('auditCard').hidden = true;
  $('progressBar').style.width = '0%';
  $('results').tBodies[0].innerHTML = '<tr><td colspan="6" class="empty">Choose an item, a rarity, and what you want on it.</td></tr>';
}

// Wipes every tab, not just the one on screen, and leaves no stored trace.
function resetSetup() {
  state.tabs = [newTab({})];
  state.activeTab = state.tabs[0].id;
  state.loadingTab = true;
  applySetup({});
  state.loadingTab = false;
  clearResults();
  renderTabs();
  refresh();
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(TABS_KEY);
  } catch (error) { /* nothing to clear */ }
}

function onFieldChange(element) {
  state.itemOptimizeSaid = '';
  state.itemOptimizeBlocked = '';
  // Naming the item settles its slot, its dust and its alien base. Whatever
  // could not be worked out is left exactly as the user had it.
  if (element.id === 'awakenedItem') {
    const resolved = resolveItem(element.value);
    // The number of slots belongs to the copy in your hands, not to the item,
    // so carrying it over from the previous item would be a guess. Clear it.
    if (element.value !== state.lastCardItem) $('rarity').value = '';
    if (resolved) {
      state.lastResolved = resolved;
      if (resolved.name && resolved.name !== element.value) element.value = resolved.name;
      // Fill in what the item settles, and clear what it does not: leaving a
      // value from a previous item would look deduced when it is not.
      $('itemType').value = resolved.type || '';
      $('dustType').value = resolved.dust || '';
      for (const box of $('subtypePanel').querySelectorAll('input')) {
        if (box.value === 'SUMMONPOWERED') continue;
        box.checked = resolved.special === box.value;
      }
    } else if (!element.value) {
      state.lastResolved = null;
    }
  }
  refresh();
}


/*
 * One base of item artwork: the index's sheet, and nothing else.
 *
 * There used to be two sets here and neither knew about the other, so a folder
 * of downloaded wiki renders was folded into the pieces the last update
 * shipped, and the join was written out at length because it was fiddly. Both
 * are gone. The index cuts every object out of the installed client onto one
 * sheet; this page reads a name to rectangle projection of it, the bench reads
 * the same, and the picture of an item is the same picture wherever the site
 * draws it. An update needs no work at all: rebuild the index and its items
 * arrive wearing the art the client came with.
 */

/*
 * Reading that index also settles when the update it describes went out,
 * which the status line wants and has no other cheap way to learn. Kept
 * here so that the line costs no fetch of its own.
 */
function newsMadeOn(index) {
  if (!index) return null;
  return (index.notes && index.notes.date) || index.made || null;
}

async function loadUpdateMade() {
  if (BUNDLE) {
    state.updateMade = newsMadeOn((BUNDLE.whatsNew || {}).index);
    return;
  }
  try {
    const news = await fetch('assets/whats-new/index.json').then(response => response.json());
    state.updateMade = newsMadeOn(news);
  } catch (error) {
    /* only the date line loses, and it says nothing rather than a wrong one */
  }
}

let itemArtLoading = null;
function ensureItemArt() {
  if (state.itemArt) return Promise.resolve(state.itemArt);
  if (itemArtLoading) return itemArtLoading;

  // The sheet's address, once, for every picture on the calculator to point at.
  document.documentElement.style.setProperty('--sheet',
    'url(' + ((BUNDLE && BUNDLE.indexSheet) || 'assets/index/sheet.png') + ')');

  if (BUNDLE && BUNDLE.itemArt) {
    state.itemArt = BUNDLE.itemArt;
    return Promise.resolve(state.itemArt);
  }

  itemArtLoading = fetch('assets/index/item-art.json')
    .then(response => response.json())
    .then(art => {
      state.itemArt = art;
      return art;
    })
    .catch(() => null);

  return itemArtLoading;
}


/* ------------------------------------------------------------------ *
 * Which client these numbers came from                                *
 * ------------------------------------------------------------------ *
 * tools/read-client.js reads an installed game client and writes what
 * it found to data/client-changes.txt, newest reading first. All the
 * page takes from it is the head of that first line: when the client
 * was last read, and which build it was. That is the whole of what a
 * player needs — how old these odds are, and against what.
 *
 * There is no friendlier version number to show. DECA ships the client
 * with Unity's application version left empty, so the build id is the
 * only thing that names one build apart from another.
 */
async function readChanges() {
  if (BUNDLE) return BUNDLE.changes || '';
  try {
    const response = await fetch(ROOT + 'client-changes.txt');
    return response.ok ? await response.text() : '';
  } catch (error) {
    return '';   // opened from disk, or never recorded; the line says so
  }
}

// "## 2026-08-23 — build 9476…"
function parseChanges(text) {
  const head = /^##\s*(\S+)\s+—\s+build\s+(\S+)/m.exec(text || '');
  return head ? { date: head[1], build: head[2] } : null;
}

// "2026-08-23" as a player would read it.
function newsDate(iso) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(parts[3])} ${months[Number(parts[2]) - 1]} ${parts[1]}`;
}

/*
 * How old the news is, and how old the numbers are.
 *
 * Two different dates, and the line used to carry only the second of them
 * with a build id after it - so a visitor reading "client of 23 Aug" had
 * no way to tell whether the site knew about the update that shipped on
 * the first of September, and the build id, which is the one thing here
 * that means nothing to anybody, had the most room. The build has gone to
 * the tooltip and the update the data has been brought up to is on the
 * line instead.
 *
 * Both dates rather than the newer of the two, because they are not
 * interchangeable: the update date says which patch the items and the
 * notes cover, the client date says when the enchanting odds themselves
 * were last read out of a client, and showing only the newer would claim
 * the odds are as fresh as the news.
 */
function renderClientNews(reading) {
  const line = $('status');
  const made = state.updateMade;
  if (!reading) {
    line.textContent = made
      ? `Game data · update of ${newsDate(made)}`
      : 'Game data from the enchantment documents';
    line.title = 'No game client has been read against these numbers yet.';
    return;
  }
  /*
   * The update, and only the update. The client reading and its build id
   * are what the numbers were taken from rather than what they are about,
   * and neither means anything to anyone reading the page - so both live in
   * the tooltip, where the one person who wants them can find them.
   */
  line.textContent = made
    ? `Game data · update of ${newsDate(made)}`
    : `Game data · client of ${newsDate(reading.date)}`;
  line.title = (made ? `The items and the notes cover the update of ${newsDate(made)}. ` : '')
    + `The enchanting odds were read from an installed RotMG client of `
    + `${newsDate(reading.date)}, build ${reading.build}.`;
}
async function readSources() {
  if (BUNDLE) return BUNDLE.sources;
  const [clientModText, clientArtifactText, clientItemText, awakenText] = await Promise.all([
    fetch(ROOT + ['Enchantment documents', 'client-enchantments.txt'].map(esc).join('/')).then(response => response.text()),
    fetch(ROOT + ['Artifacts', 'client-artifacts.txt'].map(esc).join('/')).then(response => response.text()),
    fetch(ROOT + ['Items', 'client-items.txt'].map(esc).join('/')).then(response => response.text()),
    fetch(ROOT + ['Awakened Items', 'awakenedItems.txt'].map(esc).join('/')).then(response => response.text())
  ]);
  return { clientModText, clientArtifactText, clientItemText, awakenText };
}

/*
 * When the page is being served (GitHub Pages, a local server), offer the
 * single-file copy sitting next to it so visitors can keep it. Opened from
 * disk there is nothing to offer: the file they have already is that copy.
 */
// GPL-3.0 §5(a) asks a modified work to carry a notice that it was changed and
// "a relevant date". The date comes from the build; it identifies the version,
// not the author — the licence never requires naming yourself.
/*
 * The licence notice, wherever it is still shown. The calculator no longer
 * carries one - the way in does, once, for the whole site.
 */
function renderModifiedDate() {
  const when = BUNDLE && BUNDLE.built ? ` on ${BUNDLE.built}` : '';
  for (const id of ['modifiedOn', 'modifiedOnHome']) {
    const node = document.getElementById(id);
    if (node) node.textContent = when;
  }
}

/*
 * Saying something back.
 *
 * A page like this only hears what is wrong with it if there is a way to say
 * so from inside it, at the moment the thing goes wrong - so the way to say
 * it sits in the corner that belongs to every page, and it takes the page you
 * were on with it rather than asking you to describe where you were.
 *
 * Nothing on this site runs on a server: it is files, served as files, and
 * a page of files cannot send mail. So the letter is handed to a relay that
 * holds the mailbox on its own side - the form posts what you wrote, the
 * relay puts it where it goes - and the address itself is nowhere in this
 * page: not in the markup, not in the script, not in the offline copy.
 */
const SAY_RELAY = 'https://api.web3forms.com/submit';
/*
 * The form's own key. It is meant to be public - Web3Forms says so on the
 * page it hands it out on - because it can do exactly one thing: put a
 * message into the one mailbox it belongs to. It cannot read that mailbox
 * and it cannot send anything in anybody's name.
 */
const SAY_KEY = 'e52c9a8a-0e93-4265-9087-706b9aef1410';
const SAY_PAGE = {
  home: 'the way in', enchant: 'the enchant calculator', theory: 'theory crafting',
  fame: 'fame sweep', news: "what's new"
};
let sayKind = 'Bug';

/*
 * How often one person may write.
 *
 * The relay carries a fixed number of messages a month for nothing, and they
 * are shared by everybody who uses the page - so one impatient hand on the
 * button, or one form left submitting in a loop, spends what everybody else's
 * reports were going to be carried by. A few minutes between messages and a
 * handful a day is more than anybody with something to say needs, and it
 * leaves the month intact.
 *
 * It is kept in the browser, which means it holds for the ordinary case - the
 * same person pressing send again - and not against somebody setting out to
 * get round it. Nothing served as files can do better than that, and the
 * relay counts its own quota on its side regardless.
 */
const SAY_KEEP = 'rotmg-enchant-calculator/say';
const SAY_WAIT = 30 * 60 * 1000;         // between one message and the next
const SAY_MOST = 2;                      // in one day
/*
 * And where a conversation goes instead. Two messages is enough to report
 * anything; a back and forth is a different thing and wants somewhere it can
 * actually happen, which a form that only goes one way is not.
 */
const SAY_REDDIT = 'https://www.reddit.com/user/TrollOutYT/';

function sayLog() {
  try {
    const was = JSON.parse(localStorage.getItem(SAY_KEEP) || 'null');
    if (was && typeof was === 'object') return was;
  } catch (e) { /* a private window, or storage turned off */ }
  return { last: 0, day: '', count: 0 };
}

function sayToday() {
  return new Date().toISOString().slice(0, 10);
}

/* Empty when it may be sent, or the reason it may not. */
function sayHeldBack() {
  const log = sayLog();
  const since = Date.now() - (log.last || 0);
  if (since < SAY_WAIT) {
    const left = Math.ceil((SAY_WAIT - since) / 60000);
    return 'just sent one - you can send another in '
      + (left <= 1 ? 'a minute' : left + ' minutes');
  }
  if (log.day === sayToday() && log.count >= SAY_MOST) {
    return 'that is two today';
  }
  return '';
}

function saySent() {
  const log = sayLog();
  const today = sayToday();
  try {
    localStorage.setItem(SAY_KEEP, JSON.stringify({
      last: Date.now(),
      day: today,
      count: log.day === today ? (log.count || 0) + 1 : 1
    }));
  } catch (e) { /* nothing remembered; the relay still counts its own */ }
}

/* Where the writer was standing, which is half of any report worth having. */
function sayWhere() {
  const page = document.body.dataset.page || 'home';
  return (SAY_PAGE[page] || page) + (globeWide() ? ' · atlas open' : '');
}

function sayTitle() {
  return '[Realm Tools] ' + sayKind + ' — ' + sayWhere();
}

function sayContext() {
  return ['Where: ' + sayWhere(),
    'Build: ' + ((BUNDLE && BUNDLE.built) || 'unknown'),
    'Screen: ' + window.innerWidth + '×' + window.innerHeight,
    'Browser: ' + navigator.userAgent].join('\n');
}

/* What is written under what was written. */
function sayLetter(said, from) {
  return said + '\n\n—\n' + sayContext()
    + (from ? '\nReply to: ' + from : '');
}

/*
 * How much room the corner is taking, told to the rest of the page.
 *
 * The corner floats, so nothing under it knows it is there; the mastheads
 * used to stop short by 172px, which was one button plus another button's
 * width copied out by hand. Three buttons, a label dropped under 760px, a
 * browser with wider default text or a longer word in another language all
 * make that number wrong in one direction or the other.
 *
 * So it is measured instead, whenever the row's own box changes: --corner-w
 * is what the mastheads keep clear, --corner-h is how far down the page it
 * reaches, and corner-wrapped says it has spilled onto a second line and the
 * mastheads should start under it rather than beside it.
 */
function keepCornerRoom() {
  const corner = document.getElementById('corner');
  if (!corner) return;
  const root = document.documentElement;
  const measure = () => {
    const box = corner.getBoundingClientRect();
    root.style.setProperty('--corner-w', Math.ceil(box.width) + 'px');
    root.style.setProperty('--corner-h', Math.ceil(box.height) + 'px');
    // One row is however tall the tallest button standing is; more is a wrap.
    let one = 0;
    for (const button of corner.children) one = Math.max(one, button.getBoundingClientRect().height);
    document.body.classList.toggle('corner-wrapped', one > 0 && box.height > one + 2);
  };
  measure();
  if (window.ResizeObserver) new ResizeObserver(measure).observe(corner);
  else window.addEventListener('resize', measure);
  // Web fonts land after the first paint and change every label's width.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(() => {});
}

function wireSaying() {
  const box = document.getElementById('sayBox');
  const open = document.getElementById('sayOpen');
  const menu = document.getElementById('sayMenu');
  if (!box || !open || !menu) return;
  const ask = document.getElementById('sayAsk');
  const text = document.getElementById('sayText');
  const from = document.getElementById('sayFrom');
  const said = document.getElementById('saySaid');
  const send = document.getElementById('saySend');
  const note = document.getElementById('sayNote');

  note.innerHTML = 'Goes to the one person who makes this - nothing but what '
    + 'you write and the four lines under it. To talk rather than report, '
    + '<a href="' + SAY_REDDIT + '" target="_blank" rel="noopener">u/TrollOutYT</a> '
    + 'on reddit.';

  const done = document.getElementById('sayDone');
  let hideDone = 0;

  const show = on => {
    menu.hidden = !on;
    open.setAttribute('aria-expanded', String(on));
    if (!on) return;
    clearTimeout(hideDone);
    done.hidden = true;
    // Whether there is anything to say about sending, said before they write.
    const held = sayHeldBack();
    said.textContent = held;
    send.disabled = !!held;
    // Blocked is not a dead end: there is a person at the other end of that.
    if (held) said.innerHTML = html(held) + ' — <a href="' + SAY_REDDIT
      + '" target="_blank" rel="noopener">say it on reddit</a>';
    text.focus();
  };
  const askFor = () => {
    ask.textContent = sayKind === 'Bug'
      ? 'What did you do, and what happened instead?'
      : 'What would you like it to do?';
  };

  open.addEventListener('click', event => { event.stopPropagation(); show(menu.hidden); });
  menu.addEventListener('click', event => {
    event.stopPropagation();
    // Its own name for it: the calculator has chips of its own called kinds.
    const pick = event.target.closest('[data-say-kind]');
    if (!pick) return;
    sayKind = pick.dataset.sayKind;
    for (const one of menu.querySelectorAll('[data-say-kind]')) {
      one.classList.toggle('is-on', one === pick);
    }
    askFor();
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !box.contains(event.target)) show(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) show(false);
  });
  askFor();

  menu.addEventListener('submit', async event => {
    event.preventDefault();
    const words = text.value.trim();
    if (!words) { text.focus(); return; }
    if (document.getElementById('sayBot').checked) { show(false); return; }
    const held = sayHeldBack();
    if (held) { said.textContent = held; send.disabled = true; return; }

    send.disabled = true;
    said.textContent = 'sending…';
    try {
      const answer = await fetch(SAY_RELAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: SAY_KEY,
          subject: sayTitle(),
          from_name: 'Realm Tools',
          replyto: from.value.trim() || undefined,
          message: sayLetter(words, from.value.trim())
        })
      });
      const got = await answer.json().catch(() => ({}));
      if (!answer.ok || got.success === false) throw new Error(got.message || 'refused');
      /*
       * Sent, said where the button was and not inside a panel that is about
       * to close: the panel goes, and a line takes its place under the corner
       * for a few seconds. Anything else and the reader is left wondering
       * whether pressing it did anything at all.
       */
      text.value = '';
      from.value = '';
      said.textContent = '';
      saySent();
      show(false);
      done.hidden = false;
      clearTimeout(hideDone);
      hideDone = setTimeout(() => { done.hidden = true; }, 5000);
    } catch (error) {
      /*
       * A relay that is down, or a network that is not there, must not eat
       * what somebody has just taken the trouble to write. Every word of it
       * stays in the box, and the box stays open.
       */
      said.textContent = 'could not send — it is still here, try again';
    } finally {
      send.disabled = false;
    }
  });
}

function renderOfflineOffer() {
  const note = document.getElementById('offlineCopy');
  if (!note) return;                     // the footer that held it is gone
  if (!BUNDLE || !/^https?:$/.test(location.protocol)) { note.hidden = true; return; }
  note.hidden = false;
  note.innerHTML = '<a href="Realm-Tools.html" download>Download this page</a> to keep it and use it offline — it is one self-contained file.';
}

async function load() {
  try {
    const sources = await readSources();
    state.data = EnchantEngine.buildDataset(sources);
    EnchantItems.loadClient(sources.clientItemText);
    await loadUpdateMade();
    if (document.body.dataset.page === 'enchant') await ensureItemArt();
    renderModifiedDate();
    $('itemEmptyCount').textContent = `Search ${RealmI18n.number(knownItemNames().length)} items — the slot, dust and base come with it`;
    initStarfield();
    renderOfflineOffer();
    state.ready = true;
    renderClientNews(parseChanges(await readChanges()));
    loadFilters();
    loadTabs();
    renderTabs();
    state.loadingTab = true;
    applySetup((state.tabs.find(tab => tab.id === state.activeTab) || {}).setup);
    state.loadingTab = false;
    refresh();
  } catch (error) {
    console.error(error);
    $('status').textContent = location.protocol === 'file:'
      ? 'This copy of index.html needs the local server. Use the single-file build (Realm-Tools.html) to open it straight from disk.'
      : 'Could not read the data files.';
    $('status').classList.add('bad');
  }
}

/* ------------------------------------------------------------------ *
 * Which tool you are looking at                                       *
 * ------------------------------------------------------------------ *
 * Four pages behind one address, keyed on the hash so the browser own
 * back button works and a link can point straight at a tool. The
 * enchant calculator loads its data at startup either way — it is a
 * couple of hundred milliseconds and it means the page is ready when
 * you pick it. Fame Sweep loads its own the first time you open it.
 */
/*
 * The atlas has no page of its own any more: it is a frame on the way in,
 * and 'realm' means the way in with that frame opened out.
 */
const PAGES = { home: 'pageHome', enchant: 'pageEnchant', fame: 'pageFame',
  news: 'pageNews', theory: 'pageTheory', index: 'pageIndex', skins: 'pageSkins' };

/*
 * Pointed at the atlas once, and not before the way in has painted.
 *
 * It is a megabyte or two of ground and it is now on the landing page, so
 * it waits for the browser to be idle rather than joining the queue in
 * front of the thing people came for. Opening it out asks for it at once,
 * since by then it is the thing people came for.
 */
let atlasAsked = false;
function pointAtAtlas() {
  if (atlasAsked) return;
  atlasAsked = true;
  const frame = document.getElementById('realmFrame');
  if (!frame || frame.src) return;
  const base = (window.ATLAS_BASE || 'assets/atlas/');
  fetch(base + 'atlas.json', { method: 'HEAD' })
    .then(response => {
      if (!response.ok) throw new Error('no atlas');
      frame.addEventListener('load', () => {
        atlasPace = '';                  // a fresh document knows nothing yet
        paceAtlas();
        tellAtlas({ rotmg: 'settle', frames: 12 });
        /*
         * And with nothing written on it.
         *
         * The atlas prints counts and a hint along its bottom edge, addressed
         * to somebody reading a map. In a panel the height of a letterbox
         * that is four lines across the world, and nobody in front of the
         * front page is reading them. They come back when it is opened out,
         * which is when there is a map to read.
         *
         * No `of` with it: only the writing goes. How the world is framed in
         * the panel is the ordinary fit and stays that way.
         */
        tellAtlas({ rotmg: 'settle', frames: 12 });
        dressAtlas(true);              // it has only just arrived; no glide
      });
      /* In the language the page around it is in. The frame reads the same
         stored preference and would nearly always agree on its own; the one
         case it cannot is a page being shown in a language by its address,
         which the frame's own address knows nothing about. */
      frame.src = base + 'index.html'
        + (window.RealmI18n ? '?lang=' + encodeURIComponent(RealmI18n.locale) : '');
    })
    .catch(() => {
      frame.hidden = true;
      const missing = document.getElementById('realmMissing');
      if (missing) missing.hidden = false;
      /*
       * And with no world, there is nothing to arrange round one.
       *
       * The front page is the modules laid round the realm; without the realm
       * it is five labels round a hole. So the cards come back - which is
       * what the kept copy gets, the ground being a folder of pictures that
       * cannot travel inside a single downloaded page.
       */
      if (typeof Ring !== 'undefined') Ring.set(false, false);
    });
}

/*
 * Open out, or put back - and the map grows with the frame.
 *
 * The frame is taken out of the flow at exactly the rectangle it already
 * occupies, so nothing moves, and then told to be the window instead. The
 * transition is on the four edges, which means a real layout change every
 * frame rather than a stretched picture - and that is the point, because
 * what is inside is a map that has to re-lay itself out to be zoomed rather
 * than magnified. The atlas is told to keep re-fitting for the same half
 * second, so the two move as one and the whole thing reads as a zoom in.
 *
 * It also comes to rest just past the distance Oryx starts at, which the
 * atlas works out for itself: a letterbox panel puts the opening view
 * inside his reach and he ends up most of the picture, which is no use in
 * front of a map somebody is about to read.
 */
const GLOBE_TAKES = 780;                 // milliseconds the frame takes
/*
 * And what the atlas is given to settle into it, counted in its own frames.
 * Rather more than half a second of them, because the frame it is being
 * given is four times the one it had and it will be busy fetching ground
 * for it - a count it draws through cannot be missed the way a deadline can.
 */
const GLOBE_FRAMES = 66;

/*
 * What the atlas is wearing, decided in one place.
 *
 * Three things have an opinion about it - the router, the frame opening out,
 * and the ring - and they were each telling the atlas directly. That is three
 * messages racing on every move between them, and the last one to speak wins
 * whether or not it knew the most: coming home from the opened-out map, the
 * ring asked for its distance and the frame closing behind it then said "no
 * distance", which left the world filling the window with a ring drawn round
 * it. There is no order of those three calls that is right, because none of
 * them knows what the other two are doing.
 *
 * So none of them says anything now. They change the page and call this,
 * which reads the page and says one thing. Calling it twice is harmless,
 * calling it from the wrong place is harmless, and there is nothing to keep
 * in step.
 */
/*
 * How long the world takes to go anywhere the ring sends it, and the one
 * place that number is written.
 *
 * The world, the modules and the writing all make the same journey when the
 * map is opened or shut, and "the same" means starting together and landing
 * together - so the atlas is given the length in milliseconds, the stylesheet
 * is given it as a custom property, and neither can drift from the other.
 */
const TRIP = 1500;

/*
 * And the other two lengths of the same kind, here beside it rather than
 * inside the ring: the way through a module is started in there and finished
 * out here, where "All tools" is caught, so a length declared in the closure
 * was a length half the journey could not read.
 */
const TAKE = 460;                        // ms a chosen module takes to become the window
const CLOSE = 620;                       // ms the dark takes to close on a module, or to open
const WAIT_MOST = 6000;                  // the longest the cover will ever wait for a page
const QUIET = 80;                        // and how long nothing happening means it has arrived

/*
 * How long the cover waits between the two halves of a journey: exactly as
 * long as the page behind it takes, and no longer.
 *
 * There is no length written down for this one, and that is the point. A page
 * that arrives in eighty milliseconds should not be held under a black sheet
 * for four hundred because four hundred was somebody's guess, and the index,
 * which has eleven megabytes of records to read, should not be shown half
 * built for the same reason. So the wait is the page's own work - what it is
 * fetching from this site, the pictures it has asked for, the fonts it is
 * written in - and the cover lifts on the first frame after all of that has
 * gone quiet.
 *
 * Only this site's own fetches count. The visitor counter and the feedback
 * relay are somebody else's machine answering when it feels like it, and a
 * page is not unfinished because a counter somewhere is slow.
 *
 * `WAIT_MOST` is the one length here, and it is a rescue rather than a pace: a
 * page that never finishes must not take the front door with it.
 */
const flying = new Set();
if (typeof window.fetch === 'function' && !window.fetch.watched) {
  const passed = window.fetch.bind(window);
  const watch = (...args) => {
    let mine = true;
    try {
      const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
      mine = url.origin === location.origin;
    } catch (error) { /* a relative path this old browser cannot parse; count it */ }
    if (!mine) return passed(...args);
    const token = { at: performance.now(), expiry: 0 };
    flying.add(token);
    const drop = () => {
      clearTimeout(token.expiry);
      flying.delete(token);
    };
    /*
     * settled() gives up after WAIT_MOST, so a fetch that has not answered by
     * then can no longer affect the cover. Do not retain its tracking token
     * forever if the browser/network leaves the request pending forever.
     */
    token.expiry = setTimeout(drop, WAIT_MOST);
    return passed(...args).then(answer => { drop(); return answer; },
      error => { drop(); throw error; });
  };
  watch.watched = true;
  window.fetch = watch;
}

function settled(done) {
  const began = performance.now();
  let stopped = began, look = 0;
  /* Anything else the page pulls in - the modules a viewer imports, a picture
     a stylesheet asks for - which arrives by no road this can count from the
     near end. It cannot say one is on its way, only that one has just landed,
     which is enough: a page still fetching is a page that keeps landing
     things, and the pause never opens. */
  let ears = null;
  if (window.PerformanceObserver) {
    try {
      ears = new PerformanceObserver(() => { stopped = performance.now(); });
      ears.observe({ type: 'resource', buffered: false });
    } catch (error) { ears = null; }
  }
  const enough = () => { if (ears) ears.disconnect(); done(); };
  const rescue = setTimeout(() => { cancelAnimationFrame(look); enough(); }, WAIT_MOST);
  const again = () => {
    const now = performance.now();
    const here = $(PAGES[document.body.dataset.page] || '');
    const busy = [...flying].some(one => one.at > began - 60)
      || (document.fonts && document.fonts.status === 'loading')
      || (here && [...here.querySelectorAll('img')].some(image => !image.complete));
    /* A pause rather than a frame: pages fetch a thing, read it, and ask for
       the next thing, and the breath between two of those is not the end of
       the work. Long enough to tell a chain from an ending, short enough that
       a page with nothing to fetch is not kept waiting for one. */
    if (busy) stopped = now;
    if (now - stopped < QUIET && now - began < WAIT_MOST) { look = requestAnimationFrame(again); return; }
    clearTimeout(rescue);
    enough();
  };
  look = requestAnimationFrame(again);
}

function dressAtlas(snap, over) {
  /* Opened out to the window it is a map, and a map is read: everything it
     writes belongs to somebody reading one. It is only handed back at the end
     of the journey out, because holding it bare for the movement is what stops
     the atlas snapping its own view forward as the box begins to grow. */
  if (globeWide() && !globeMoving) {
    tellAtlas({ rotmg: 'bare', on: false, snap: false, over });
    return;
  }
  /* Otherwise it is scenery, and the only question is how much of the frame
     the world should fill. The ring knows, because it is drawing a ring round
     it; nobody else does, and null leaves the framing alone. */
  const of = (typeof Ring !== 'undefined' && Ring.is()) ? Ring.worldShare() : null;
  tellAtlas({ rotmg: 'bare', on: true, of, snap: !!snap, over });
}

/*
 * And the one thing the frame says back.
 *
 * Opened out over the front page there is no margin round it to click on, so
 * the sky inside the frame is the margin - which is what everybody reaches
 * for anyway when a thing is open over something else. The frame reports the
 * tap; closing is this page's business, because the frame does not know it
 * was ever opened.
 */
window.addEventListener('message', event => {
  const frame = document.getElementById('realmFrame');
  if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return;
  const said = event.data;
  if (!said) return;
  /*
   * It has just started and does not yet know how big the world is meant to
   * be. It is told here rather than on the frame's load event, which is the
   * difference between a world that is the right size on its first frame and
   * one drawn at the size of the whole frame and then shrunk into place:
   * `load` waits for every tile of ground, and the atlas paints long before
   * that.
   */
  if (said.rotmg === 'hello') {
    atlasPace = '';                      // a fresh document knows nothing yet
    paceAtlas();
    dressAtlas(true);                    // and no glide: it has only just arrived
    return;
  }
  if (said.rotmg === 'clouds') { dressSkySwitch(said); return; }
  if (said.rotmg === 'panel') { besideAtlasPanel(said); return; }
  /* A thing on the map, asked to be opened in the Index. The id is checked
     by the same route the Index's own links go through. While the atlas is
     open it is shown in a drawer over the atlas's panel rather than by
     leaving the map, so putting it away is back where the reader was. */
  if (said.rotmg === 'index') {
    if (!RealmRoutes.indexHash(said.id)) return;
    if (atlasOpenOut()) { openAtlasIndex(said.id, true); return; }
    if (globeWide()) setGlobe(false);
    window.openIndexRecord(said.id);
    return;
  }
  if (said.rotmg !== 'sky') return;
  if (globeWide()) setGlobe(false);
});

/*
 * The clouds' switch, beside the cross. The atlas says when there is weather
 * to put away and whether it has been, and draws nothing of it itself while
 * it is framed; this draws the client's cloud off the atlas's own sheet,
 * struck through while the sky is full.
 */
let skyClear = false;
function dressSkySwitch(said) {
  const button = document.getElementById('globeSky');
  if (!button) return;
  skyClear = Boolean(said.clear);
  button.hidden = !said.can;
  button.setAttribute('aria-pressed', String(skyClear));
  const says = skyClear ? 'Show the clouds' : 'Hide the clouds';
  button.title = says;
  button.setAttribute('aria-label', says);
  const art = button.querySelector('.globe-sky-art');
  const icon = said.icon;
  if (art && icon && Array.isArray(icon.cut) && Array.isArray(icon.sheet)
    && /^https?:|^file:/.test(String(icon.src))) {
    const k = 44 / icon.cut[2];
    art.style.width = '44px';
    art.style.height = Math.round(icon.cut[3] * k) + 'px';
    art.style.backgroundImage = 'url("' + String(icon.src).replace(/"/g, '%22') + '")';
    art.style.backgroundSize = (icon.sheet[0] * k) + 'px ' + (icon.sheet[1] * k) + 'px';
    art.style.backgroundPosition = (-icon.cut[0] * k) + 'px ' + (-icon.cut[1] * k) + 'px';
  }
  if (art) art.classList.toggle('struck', !skyClear);
}

/*
 * The atlas's panel, as the atlas reports it: open or not, and how wide. The
 * cross and the clouds' switch stand beside it rather than on its heading and
 * its own cross, and the Index drawer takes exactly its place.
 */
function besideAtlasPanel(said) {
  const box = document.getElementById('globeBox');
  if (!box) return;
  const wide = said.open ? Math.max(0, Math.min(4000, Math.round(Number(said.wide) || 0))) : 0;
  box.style.setProperty('--atlas-panel', wide + 'px');
  box.classList.toggle('has-atlas-panel', Boolean(said.open) && wide > 0);
  if (!said.open) shutAtlasIndex();
}

/* Open out over the page: the home ring's map, or the panel opened wide. */
const atlasOpenOut = () => document.body.classList.contains('ring-away') || globeWide();

/*
 * The Index, without leaving the atlas.
 *
 * A drop or a creature in the atlas's panel used to open its Index page,
 * which took the reader off the map - and back from there was the front page,
 * with the zone and its panel gone. Now the Index's own card is drawn in a
 * drawer that stands exactly over the atlas's panel. Links inside it walk on
 * inside it, Back steps back through them to the zone, and the full Index is
 * one button away for anyone who does want to go.
 */
const atlasIndexTrail = [];
let atlasIndexAsk = 0;
async function openAtlasIndex(id, fresh) {
  const drawer = document.getElementById('atlasIndex');
  const card = document.getElementById('atlasIndexCard');
  const wait = document.getElementById('atlasIndexWait');
  if (!drawer || !card) { window.openIndexRecord(id); return; }
  const ask = ++atlasIndexAsk;
  if (fresh) atlasIndexTrail.length = 0;
  drawer.hidden = false;
  if (wait) wait.hidden = false;
  let got = null;
  try {
    await ensureIndexPage();
    got = typeof RealmIndex !== 'undefined' && RealmIndex.card ? await RealmIndex.card(id) : null;
  } catch (error) { console.error(error); }
  if (ask !== atlasIndexAsk) return;           // a later one was asked for meanwhile
  if (wait) wait.hidden = true;
  if (!got) {
    if (!atlasIndexTrail.length) shutAtlasIndex();
    return;
  }
  if (atlasIndexTrail[atlasIndexTrail.length - 1] !== got.id) atlasIndexTrail.push(got.id);
  card.innerHTML = got.html;
  if (got.sheet) card.style.setProperty('--ix-sheet', got.sheet);
  card.scrollTop = 0;
  sayAtlasIndexBack();
}
function sayAtlasIndexBack() {
  const back = document.getElementById('atlasIndexBack');
  if (!back) return;
  const deeper = atlasIndexTrail.length > 1;
  for (const say of back.querySelectorAll('[data-back]')) say.hidden = (say.dataset.back === 'record') !== deeper;
}
function shutAtlasIndex() {
  const drawer = document.getElementById('atlasIndex');
  atlasIndexAsk++;
  atlasIndexTrail.length = 0;
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  const card = document.getElementById('atlasIndexCard');
  if (card) card.innerHTML = '';
}
/* Leaving the atlas for somewhere else the card points at. */
function leaveAtlasFor(go) {
  shutAtlasIndex();
  if (globeWide()) setGlobe(false);
  go();
}
{
  const drawer = document.getElementById('atlasIndex');
  if (drawer) {
    drawer.addEventListener('click', event => {
      event.stopPropagation();             // not a click on the atlas's box
      const here = atlasIndexTrail[atlasIndexTrail.length - 1];
      if (event.target.closest('#atlasIndexBack')) {
        atlasIndexTrail.pop();
        const before = atlasIndexTrail.pop();
        if (before) openAtlasIndex(before, false); else shutAtlasIndex();
        return;
      }
      if (event.target.closest('#atlasIndexFull')) {
        if (here) leaveAtlasFor(() => window.openIndexRecord(here));
        return;
      }
      const open = event.target.closest('[data-open]');
      if (open) { openAtlasIndex(open.dataset.open, false); return; }
      const door = event.target.closest('[data-door]');
      if (door && here && typeof RealmIndex !== 'undefined' && RealmIndex.door) {
        leaveAtlasFor(() => RealmIndex.door(door.dataset.door, here));
        return;
      }
      const skinDoor = event.target.closest('[data-skin-target]');
      if (skinDoor && typeof window.openSkinViewerTarget === 'function') {
        let target = null;
        try { target = JSON.parse(decodeURIComponent(skinDoor.dataset.skinTarget)); }
        catch (error) { console.error('Invalid Skin Viewer target', error); }
        if (target) leaveAtlasFor(() => window.openSkinViewerTarget(target));
      }
    });
    // Its keys are its own: Enter on one of its buttons is not the atlas's
    // box being asked to open, and Escape puts the drawer away, not the atlas.
    drawer.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') shutAtlasIndex();
    });
  }
}

function tellAtlas(what) {
  const frame = document.getElementById('realmFrame');
  if (!frame || !frame.contentWindow) return;
  try { frame.contentWindow.postMessage(what, '*'); }
  catch (error) { /* not loaded yet; it is told again on load */ }
}

/* The rectangle it opens out to: the window, less a margin to click in. */
function globeRoom() {
  const pad = Math.max(18, Math.min(44, Math.round(window.innerHeight * 0.032)));
  return { top: pad, left: pad,
    width: Math.max(120, window.innerWidth - pad * 2),
    height: Math.max(120, window.innerHeight - pad * 2) };
}

function placeGlobe(box, at) {
  box.style.top = at.top + 'px';
  box.style.left = at.left + 'px';
  box.style.width = at.width + 'px';
  box.style.height = at.height + 'px';
}

/*
 * What the atlas in the frame should be spending.
 *
 * It is a whole world - ground, clouds, weather, everything walking about -
 * and it costs the same whether it is the page or a thumbnail in the corner
 * of one. Three states, decided here and nowhere else:
 *
 *   full     it is what is being looked at, opened out over the window
 *   slow     it is the picture on the way in, a few frames a second
 *   still    it is behind another page, scrolled off, or the tab is away
 *
 * Told rather than guessed: the frame is another document and knows none of
 * this - which page is open, where the box has scrolled to, whether anyone
 * is even at the machine.
 */
let atlasPace = '';
function paceAtlas() {
  const box = document.getElementById('globeBox');
  let want = 'still';
  if (!document.hidden && document.body.dataset.page === 'home' && box) {
    /*
     * And full while the frame is on the move, whichever way it is going.
     *
     * The box changes size sixty times a second while it opens or shuts, and
     * the map inside re-fits itself to that box on the frames it draws. At
     * thirty it re-fits on every other one, so half the frames of the
     * movement show the map at the size the box was two frames ago - which is
     * not a slower animation, it is a flickering one. The saving is for a box
     * that is standing still.
     */
    want = (globeWide() || globeMoving) ? 'full' : (globeSeen ? 'slow' : 'still');
  }
  if (want === atlasPace) return;
  atlasPace = want;
  tellAtlas({ rotmg: 'pace', pace: want });
}

let globeSeen = true;
let globeMoving = false;
function watchGlobe() {
  const box = document.getElementById('globeBox');
  if (!box || typeof IntersectionObserver === 'undefined') return;
  new IntersectionObserver(entries => {
    for (const one of entries) globeSeen = one.isIntersecting;
    paceAtlas();
  }, { rootMargin: '80px' }).observe(box);
}
document.addEventListener('visibilitychange', paceAtlas);

let globeSettling = 0;
function setGlobe(open) {
  const box = document.getElementById('globeBox');
  const back = document.getElementById('globeBack');
  const already = globeWide();
  if (box) box.setAttribute('aria-expanded', String(open));
  if (open) pointAtAtlas();
  if (!box) {
    document.body.classList.toggle('globe-wide', open);
    if (back) back.hidden = !open;
    return;
  }
  if (open === already) return;

  /*
   * Opened out from the ring, which is not an opening at all.
   *
   * On that front page the world is already the window: there is one frame,
   * it is the ground the whole page stands on, and what "open the atlas"
   * means there is that the world stops being scenery and becomes a map you
   * can read. Nothing has to grow out of anything. So there is no box to pin,
   * no rectangle to travel, and no shade to lay over the page behind -
   * because there is no page behind. The arrangement stands aside, the map
   * zooms where it already is, and the cross in the corner brings it back.
   */
  if (typeof Ring !== 'undefined' && Ring.wheel()) {
    document.body.classList.toggle('globe-wide', open);
    if (back) back.hidden = true;
    Ring.aside(open);
    paceAtlas();
    tellAtlas({ rotmg: 'settle', frames: GLOBE_FRAMES });
    clearTimeout(globeSettling);
    /*
     * One journey, both ways.
     *
     * The world goes to the fit a map is read at, or comes back to the size
     * the modules were arranged round, and it takes TRIP to do it either way.
     * The modules leave and come back over the same TRIP, on the same curve,
     * so the two are one movement rather than two things happening near each
     * other. Nothing waits for anything: they all start now and they all land
     * at the same moment.
     */
    dressAtlas(false, TRIP);
    return;
  }

  // Where it is now, before anything is changed about it.
  const here = box.getBoundingClientRect();
  box.classList.add('is-moving');
  box.style.position = 'fixed';
  placeGlobe(box, { top: here.top, left: here.left, width: here.width, height: here.height });
  void box.offsetWidth;                  // and let that stand as the start

  document.body.classList.toggle('globe-wide', open);
  if (back) back.hidden = !open;
  /*
   * Shutting the map is not a move through the router - the cross and the
   * margin round it both say so directly - so the arrangement that stood
   * aside for it has to be put back from here. Before the box is told where
   * to go, because where it goes is wherever the stage is by then, and with
   * the ring back the stage is the whole window again.
   */
  if (!open && typeof Ring !== 'undefined') Ring.aside(false);
  if (open) {
    placeGlobe(box, globeRoom());
  } else {
    const stage = document.querySelector('.globe-stage');
    const room = stage ? stage.getBoundingClientRect() : here;
    placeGlobe(box, { top: room.top, left: room.left, width: room.width, height: room.height });
  }

  // Paced before it is told to settle: a still frame cannot settle into
  // anything, since the settling is counted one drawn frame at a time.
  globeMoving = true;
  paceAtlas();
  tellAtlas({ rotmg: 'settle', frames: GLOBE_FRAMES });

  /*
   * Going back in, the writing goes at once: it has no business in a panel
   * and the panel is what this is about to be again. Going out, `globeMoving`
   * is set just above, so this leaves it bare for the whole journey - which
   * is what stops the atlas snapping its view forward as the box grows.
   */
  dressAtlas(false);

  /*
   * And handed back to the layout once it has arrived. Left pinned, it would
   * be a fixed box the size of a hole in a column that has since been
   * resized - so the inline pinning comes off and the stage owns it again.
   *
   * The writing comes back here too, at the end of the journey out rather
   * than the start. Bare is also what stops the atlas snapping its own view
   * onto Oryx's distance the moment the box begins to grow, so holding it for
   * the whole movement is what makes the enlargement start at the size the
   * panel actually was. `snap: false` hands it over without a jump: only the
   * target moves, and by then the view is already at it.
   */
  clearTimeout(globeSettling);
  globeSettling = setTimeout(() => {
    box.classList.remove('is-moving');
    globeMoving = false;
    paceAtlas();
    dressAtlas(false);             // arrived, so a wide frame gets its writing
    if (!globeWide()) {
      box.style.position = '';
      box.style.top = ''; box.style.left = ''; box.style.width = ''; box.style.height = '';
    }
  }, GLOBE_TAKES + 60);
}

/* Opened out, it is the window, so it follows the window - when it was pinned
   there by hand. Opened from the ring it never was: the stylesheet already
   makes it the window, and pinning it here wrote the size the window had at
   the first resize into the box for good, so growing the window afterwards
   left the map in a corner of it with the page's old sky showing beside. */
window.addEventListener('resize', () => {
  const box = document.getElementById('globeBox');
  if (box && globeWide() && box.style.position === 'fixed') placeGlobe(box, globeRoom());
});
const globeWide = () => document.body.classList.contains('globe-wide');
let famePageReady = false;
let famePageLoading = null;

function openFamePage() {
  if (famePageReady) return Promise.resolve(true);
  if (famePageLoading) return famePageLoading;

  famePageLoading = (async () => {
    try {
      const bundled = BUNDLE && BUNDLE.sources;
      const text = bundled && bundled.fameText ? bundled.fameText
        : await fetch(ROOT + ['Fame', 'client-fame.txt'].map(esc).join('/')).then(response => response.text());
      const info = bundled && bundled.dungeonText ? bundled.dungeonText
        : await fetch(ROOT + ['Fame', 'dungeon-pages.txt'].map(esc).join('/')).then(response => response.text());
      const overrides = bundled && bundled.overrideText ? bundled.overrideText
        : await fetch(ROOT + ['Fame', 'availability-overrides.txt'].map(esc).join('/'))
          .then(response => response.text()).catch(() => '');

      await Promise.resolve(
        FamePage.init(text, BUNDLE ? BUNDLE.assets : null, info, overrides)
      );
      famePageReady = true;
      return true;
    } catch (error) {
      console.error(error);
      famePageReady = false;
      $('fameSummary').innerHTML = '<p class="note warn">Could not read the fame bonuses.</p>';
      return false;
    } finally {
      famePageLoading = null;
    }
  })();

  return famePageLoading;
}

/*
 * Not every build has every page.
 *
 * The downloadable copy leaves the Skin Viewer out - it reads seventy-five
 * megabytes of sheets beside the page, which a file opened from disk cannot
 * do - so the build removes its card and its page from that copy. A hash
 * kept from the website would then name a page that is not there, and asking
 * a page that does not exist to hide itself took the whole router down with
 * it. So a page the build left out simply is not a page, and the address
 * falls back to the way in.
 */
/* Which page is already on screen, so that being asked for it again can be
   told apart from arriving at it. */
let shownPage = null;
let pageLoading = Promise.resolve();

let theoryScriptLoading = null;
function ensureTheoryPage() {
  const run = () => {
    if (typeof TheoryCraft === 'undefined') return false;
    if (document.body.dataset.page !== 'theory') return true;
    // TheoryCraft.start() owns the complete first-start promise, through its
    // data loads, wiring and first paint. Keep the black cover attached to it.
    return TheoryCraft.start();
  };

  if (typeof TheoryCraft !== 'undefined') return Promise.resolve(run());

  if (!theoryScriptLoading) {
    const placeholder = document.querySelector('script[data-lazy-src="theorycraft.js"]');
    if (!placeholder) {
      return Promise.reject(new Error('Theory Crafting script placeholder is missing.'));
    }

    theoryScriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = placeholder.dataset.lazySrc;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        theoryScriptLoading = null;
        reject(new Error('Could not load Theory Crafting.'));
      };
      placeholder.before(script);
    });
  }

  return theoryScriptLoading.then(run);
}

let indexScriptLoading = null;
function ensureIndexPage(open) {
  const run = () => {
    if (typeof RealmIndex === 'undefined') return false;
    if (document.body.dataset.page !== 'index') return true;
    // Both APIs expose the whole first-start promise. Keep that promise
    // attached to the navigation so the black cover stays down through
    // parsing, facet construction and the first Index render.
    if (open) return RealmIndex.open(open);
    return RealmIndex.start();
  };

  if (typeof RealmIndex !== 'undefined') return Promise.resolve(run());

  if (!indexScriptLoading) {
    const placeholder = document.querySelector('script[data-lazy-src="index-page.js"]');
    if (!placeholder) {
      return Promise.reject(new Error('Index script placeholder is missing.'));
    }

    indexScriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = placeholder.dataset.lazySrc;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        indexScriptLoading = null;
        reject(new Error('Could not load Index.'));
      };
      placeholder.before(script);
    });
  }

  return indexScriptLoading.then(run);
}

let enchantPageLoading = null;
function ensureEnchantPage() {
  if (enchantPageLoading) return enchantPageLoading;

  enchantPageLoading = Promise.resolve(appLoading)
    .then(() => {
      if (!state.ready) return false;
      if (state.itemArt) return true;
      return ensureItemArt().then(() => {
        if (document.body.dataset.page === 'enchant') refresh();
        return true;
      });
    })
    .finally(() => {
      enchantPageLoading = null;
    });

  return enchantPageLoading;
}

function ensureNewsPage() {
  if (typeof WhatsNew === 'undefined') return Promise.resolve(false);
  if (document.body.dataset.page !== 'news') return Promise.resolve(true);
  return Promise.resolve(WhatsNew.init(BUNDLE && BUNDLE.whatsNew));
}

let skinPageLoading = null;
function ensureSkinPage() {
  const mount = () => {
    if (!window.SkinViewer) return false;
    if (document.body.dataset.page !== 'skins') return true;

    return window.SkinViewer.mount(
      $('skinViewerRoot'),
      { integrated: true }
    ).then(viewer => {
      if (document.body.dataset.page === 'skins') viewer.setActive(true);
      return true;
    });
  };

  if (window.SkinViewer) return Promise.resolve(mount());
  if (skinPageLoading) return skinPageLoading;

  /*
   * app.js is immediately before the Skin Viewer module in index.html.
   * On a direct #skins cold start the parser has therefore not reached that
   * module yet. DOMContentLoaded waits for module scripts, after which mount()
   * either exists and exposes its whole createViewer promise, or the module
   * genuinely failed and navigation is allowed to recover normally.
   */
  if (document.readyState !== 'loading') return Promise.resolve(false);

  skinPageLoading = new Promise((resolve, reject) => {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.SkinViewer) {
        resolve(false);
        return;
      }
      Promise.resolve(mount()).then(resolve, reject);
    }, { once: true });
  }).finally(() => {
    skinPageLoading = null;
  });

  return skinPageLoading;
}

function showPage(name) {
  const wideOpen = name === 'realm';
  const here = key => Boolean(PAGES[key]) && Boolean($(PAGES[key]));
  const page = wideOpen ? 'home' : (here(name) ? name : 'home');
  for (const [key, id] of Object.entries(PAGES)) {
    const node = $(id);
    if (node) node.hidden = key !== page;
  }
  document.body.dataset.page = page;
  // Navigation normally relies on settled() watching fetches and images.
  // A dynamically inserted script is invisible to that watcher until it has
  // finished downloading, so expose its own promise to the black cover.
  pageLoading = Promise.resolve();
  if (page === 'enchant') {
    pageLoading = ensureEnchantPage().catch(error => {
      console.error(error);
      return false;
    });
  }
  if (page === 'fame') {
    pageLoading = openFamePage().catch(error => {
      console.error(error);
      return false;
    });
  }
  // What's New reads its own index the first time it is opened, the same way
  // Fame Sweep does: it is a megabyte of pictures and nobody who came for the
  // calculator should pay for it.
  if (page === 'news') {
    pageLoading = ensureNewsPage().catch(error => {
      console.error(error);
      return false;
    });
  }
  /*
   * And the same for theory crafting, which is most of a megabyte of items,
   * enchantments and things to hit. It reads it once, the first time it is
   * asked for, and nobody who came for the enchanter pays for it.
   */
  if (page === 'theory') {
    pageLoading = ensureTheoryPage().catch(error => {
      console.error(error);
      return false;
    });
  }
  /*
   * And the index, which is three and a half megabytes of records: it is read
   * the first time somebody asks for it and not a moment before, the same way
   * the other two heavy pages are.
   */
  if (page === 'index') {
    pageLoading = ensureIndexPage().catch(error => {
      console.error(error);
      return false;
    });
  }
  if (page === 'skins') {
    pageLoading = ensureSkinPage().catch(error => {
      console.error(error);
      return false;
    });
  } else if (window.SkinViewer) {
    window.SkinViewer.unmount();
  }
  /*
   * The frame is asked for while the browser is idle, and only on the page
   * that holds it. Anything else that was open is put away.
   */
  if (page === 'home') {
    if (window.requestIdleCallback) requestIdleCallback(pointAtAtlas, { timeout: 1500 });
    else setTimeout(pointAtAtlas, 700);
  }
  /*
   * The ring is an arrangement of the home page rather than a page of its
   * own, so coming home puts back whichever of the two you last chose, and
   * opening the atlas out to the window takes it off for as long as that
   * lasts - without forgetting that you wanted it.
   */
  if (typeof Ring !== 'undefined') {
    /* The arrangement is brought up first and stood aside second, in that
       order and every time. Arriving straight at `#realm` - a bookmark, a
       reload with the map open - is a home page that has never been built
       standing in the state that only makes sense once it has: without this
       the ring is still off when the map is asked for, the map finds no
       arrangement to open out of, and falls back on hauling the panel from
       the other front page across the window. */
    if (page !== 'home') Ring.set(false, false);
    else { Ring.wanted(); Ring.aside(wideOpen); }
  }

  setGlobe(wideOpen);
  paceAtlas();
  window.scrollTo(0, 0);

  /*
   * The page that just became visible rises into place rather than cutting in,
   * on the same curve as the cards inside it. It has to be unhidden first for
   * the starting state to take, hence the one-frame delay before releasing it.
   *
   * A page that just became visible, and no other. Opening the atlas out is
   * not an arrival - the page it happens on was already here, and nothing
   * about it changed but what the world in the middle is showing. Replaying
   * the arrival on it was the whole of what looked like a second world being
   * drawn: for a third of a second the page it is on starts at nothing and
   * rises, so the frame that fills the window goes with it, and what is
   * behind the frame - the drifting realms, which are only ever invisible
   * because the world covers them - comes through as if it had been waiting
   * there.
   *
   * And never the ring at all. Its page is the world: ground does not rise
   * into place. Worse, the transform that would lift it makes the page a
   * containing block, and a containing block takes `position: fixed` away
   * from the window - so for as long as the lift lasts, the frame is laid out
   * inside a box the size of the page and the world sits in a rectangle off
   * the middle of the screen. That is the boxed atlas, and it was never a
   * second one.
   */
  const arrived = page !== shownPage;
  shownPage = page;
  const ground = page === 'home' && document.body.dataset.home === 'ring';
  if (!arrived || ground) return;
  for (const node of [$(PAGES[page]), page === 'home' ? $('homeCards') : null]) {
    if (!node) continue;
    clearTimeout(node.arrivalTimer);
    node.classList.remove('page-entering', 'is-fresh');
    void node.offsetWidth;
    node.classList.add(node.id === 'homeCards' ? 'is-fresh' : 'page-entering');
    if (node.id !== 'homeCards') {
      node.arrivalTimer = setTimeout(() => node.classList.remove('page-entering'), 30);
    }
  }
}

function routeFromHash() {
  /*
   * The address may carry more than the page: a build handed over from one
   * tool to another rides behind a question mark, and the page is the part
   * in front of it.
   */
  const route = RealmRoutes.parse(location.hash);
  showPage(route.page);
  if (route.page === 'index' && route.open) {
    pageLoading = ensureIndexPage(route.open).catch(error => {
      console.error(error);
      return false;
    });
  }
  return pageLoading;
}

window.openIndexRecord = async function (id) {
  const hash = RealmRoutes.indexHash(id);
  if (!hash) return false;
  if (location.hash !== '#' + hash) location.hash = hash;
  showPage('index');
  await ensureIndexPage();
  if (typeof RealmIndex === 'undefined') return false;
  return RealmIndex.open(id);
};

window.openSkinViewerTarget = async function (target) {
  if (!target || typeof target !== 'object' || !window.SkinViewer) return false;
  if (location.hash !== '#skins') location.hash = 'skins';
  showPage('skins');
  const viewer = await window.SkinViewer.mount(
    $('skinViewerRoot'),
    { integrated: true }
  );
  viewer.setActive(true);
  return viewer.select(target);
};

document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]');
  if (!go) return;
  event.preventDefault();
  const to = go.dataset.go;
  location.hash = to === 'home' ? '' : to;
  routeFromHash();
});
window.addEventListener('hashchange', routeFromHash);

/*
 * The pictures on the way-in cards, resolved the same way as every other
 * sprite: from disk when the page is served, from the bundle when it is the
 * single-file copy, where "../data" does not exist.
 *
 * Written as something that dresses one node rather than a loop over the
 * page, because the ring builds its own cards long after this file has run
 * and would otherwise have to keep a second copy of the strip arithmetic -
 * and a second copy is the one that goes stale.
 */
function dressArt(image) {
  const path = String(image.dataset.art || '');
  /*
   * Two kinds of picture, told apart by where they are asked for.
   *
   * Nearly all of them are sprites cut out of the client and read from the
   * data folder. One is a frame of a creature, which the site already carries
   * beside itself for What's New - and which the single-file copy does not
   * carry beside anything, because it has no beside: the build reads those
   * frames into the bundle under their own file names, so that is where this
   * looks when there is a bundle to look in.
   */
  let src;
  if (path.startsWith('assets/')) {
    /* Beside the page. Most of those are carried across by the build and can
       simply be asked for; the odd one is a creature's frame that only ever
       travelled inside the bundle, under its own file name, so that is looked
       at first and the path stands as the answer when it is not there. */
    const file = path.slice(path.lastIndexOf('/') + 1);
    const kept = BUNDLE && BUNDLE.whatsNew && BUNDLE.whatsNew.art;
    src = (kept && kept[file]) || path;
  } else {
    const [folder, file] = path.split('/');
    src = folder && file ? asset('GUI Files', folder, file) : '';
  }
  if (!src) { image.remove(); return; }
  /*
   * One picture, or twenty on a strip. The index's book is an animation, so
   * its card holds the strip as a background and walks along it; an image
   * would have to be told the size of one frame, and the card would rather
   * decide its own size.
   */
  if (image.tagName === 'IMG') { image.src = src; return; }
  image.style.backgroundImage = 'url(' + src + ')';
  /*
   * How many frames there are is the strip's own business, not something the
   * stylesheet should be told twice. The cells are square, so the count is the
   * picture's width over its height - and the animation is written out here
   * because steps() cannot be given a custom property.
   */
  const strip = new Image();
  strip.addEventListener('load', () => {
    const many = Math.max(1, Math.round(strip.naturalWidth / strip.naturalHeight));
    image.style.backgroundSize = (many * 100) + '% 100%';
    /*
     * Forward and back rather than round and round, and slowly.
     *
     * The strip is the light coming and going over an open book, so running it
     * one way and jumping back to the start read as a loop of film rather than
     * as a light breathing. Alternating turns the same eight drawings into a
     * rise and a fall, and holds the quiet frame at each end for a beat, which
     * is where the pause belongs. A quarter of a second a frame: any faster
     * and the sparkle flickers instead of glimmering.
     */
    /*
     * Two kinds of strip. A book's pages go forward and back, because the
     * strip is a light moving over it and a light that jumps home is a light
     * blinking. A row of people walking past only ever goes one way: coming
     * back would be the parade reversing into itself.
     */
    image.style.animation = image.classList.contains('is-walk')
      ? 'index-book ' + (many * 0.18).toFixed(2) + 's'
        + ' steps(' + many + ', jump-none) infinite'
      : 'index-book ' + (many * 0.26).toFixed(2) + 's'
        + ' steps(' + many + ', jump-none) infinite alternate,'
        + ' enchanting 4.4s ease-in-out infinite';
  });
  strip.src = src;
}
for (const image of document.querySelectorAll('[data-art]')) dressArt(image);


bind();
const appLoading = load();


/* --------------------------------------------------------------------
 * How many people are here.
 *
 * Three numbers: how many have ever come, how many came today, and how many
 * are on the site at this moment.
 *
 * The site is a folder of files on a static host, so nothing of ours runs
 * when somebody opens it and nothing of ours can count. The numbers come from
 * Abacus, which keeps a tally under a name and hands it back. It is told the
 * name and nothing else, and if it is away or blocked the line never appears.
 *
 * The first two are counted once a day per browser, because the question is
 * how many people came and not how many times somebody pressed reload.
 *
 * The third has no business being possible with a plain counter, and is done
 * like this: every open page adds one to a tally named after the current
 * minute, once a minute, for as long as it is the tab being looked at. A
 * minute that has finished therefore holds one mark per page that was open
 * during it, which is as close to "how many are here" as anything gets
 * without a server. The minute just gone is read rather than the one running,
 * because the one running is still filling up. A page nobody is looking at
 * stops marking, and drops out of the count within the minute.
 * ------------------------------------------------------------------ */
(function countVisitors() {
  const ABACUS = 'https://abacus.jasoncameron.dev/rotmg-realm-atlas/';
  const put = (into, n) => {
    const cell = document.getElementById(into);
    if (cell) cell.textContent = RealmI18n.number(n);
    const box = document.getElementById('seen');
    if (box) box.hidden = false;
  };
  const ask = (verb, key, into) => fetch('https://abacus.jasoncameron.dev/'
    + verb + '/rotmg-realm-atlas/' + key)
    .then(r => (r.ok ? r.json() : null))
    .then(said => { if (said && typeof said.value === 'number' && into) put(into, said.value); })
    .catch(() => { /* offline, blocked, or away: say nothing */ });

  const day = new Date().toISOString().slice(0, 10);
  let counted = null;
  try { counted = localStorage.getItem('atlas-counted'); } catch (no) { counted = null; }
  const first = counted !== day;
  if (first) { try { localStorage.setItem('atlas-counted', day); } catch (no) { /* private */ } }
  const verb = first ? 'hit' : 'get';
  ask(verb, 'all', 'seenAll');
  ask(verb, 'd' + day.replace(/-/g, ''), 'seenToday');

  // And the minute-by-minute mark that makes "here now" possible.
  const minuteName = when => 'm' + new Date(when).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  let marked = '';
  /*
   * The minute just gone is the honest number - it has finished filling, so
   * it holds one mark per page that was open during it. But a minute nobody
   * marked was never created and the service answers 404 for a name it has
   * never seen, so when that happens the minute now running is read instead.
   * It is still filling and will read low for a moment; it is never nothing,
   * because this page has just marked it.
   */
  const readHere = key => fetch('https://abacus.jasoncameron.dev/get/rotmg-realm-atlas/' + key)
    .then(r => (r.ok ? r.json() : null))
    .then(said => (said && typeof said.value === 'number' ? said.value : null))
    .catch(() => null);

  function tick() {
    if (document.hidden) return;
    const now = Date.now();
    const mine = minuteName(now);
    if (mine !== marked) { marked = mine; ask('hit', mine, null); }
    readHere(minuteName(now - 60000))
      .then(n => (n === null ? readHere(mine) : n))
      .then(n => { if (n !== null) put('seenNow', n); });
  }
  tick();
  setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})();

/* ---------------- the ring home ---------------- *
 *
 * The other front page: the modules laid round the realm rather than under
 * it. The same ways in as the cards and the same atlas behind them - it is an
 * arrangement, not a second copy of anything - and it is a switch rather than
 * a replacement, because it is prettier than the cards and harder to read,
 * and an arrival should get the readable one.
 *
 * ---- what decides what ----
 *
 * One chain, and nothing outside it gets a say:
 *
 *   the window decides how big the world is drawn;
 *   the world decides where the modules stand and how big they are;
 *   the modules decide whether this arrangement is possible at all.
 *
 * So the world is the only thing measured against the window, and everything
 * else is measured in worlds. A module is a horizontal band whose inner end
 * is an arc concentric with the world - the same curve, standing off it, so
 * it reads as something laid round the world rather than a shape that
 * happens to be near one. The band is only as long as its own contents: a
 * picture, a name, a line and, when it opens, a description. Not to the edge
 * of the window, because a band with empty room in it is a band that would
 * have given up on a narrower window for no reason, and how narrow a window
 * this arrangement survives is exactly the question the last link in the
 * chain answers.
 *
 * When the world has been squeezed to where a module can no longer show its
 * picture and its writing properly, there is no arrangement left to make and
 * the same modules become a plain column of cards with no world behind them.
 * That is also what a machine with no cursor gets, since the whole of the
 * movement is a band opening under one.
 *
 * ---- the movement ----
 *
 * A band under the cursor opens: out towards the edge of the window, in over
 * the world - its arc keeps its size and slides, so the curve stays the
 * world's curve - and sideways until the gap to its neighbour is a hairline.
 * Its leading end stops being a wall and becomes haze, so the world can be
 * seen through what is crossing it. Everything else steps back: the other
 * bands off towards their own edges and dimmed, the world under a veil.
 * Coming to the world instead puts all of them out and brings it forward.
 *
 * Nothing in here runs until the switch is thrown for the first time.
 */
/*
 * `var`, and on purpose. The router runs long before this line does, and it
 * asks whether the ring is there with `typeof` - which answers "undefined"
 * for a var that has not been reached yet and throws for a const, because a
 * const is in its temporal dead zone until its own line executes. The guard
 * has to be able to run before the thing it guards exists.
 */
var Ring = (() => {

/*
 * The arrangement, in worlds.
 *
 * CLEAR is small on purpose. The arc is the world's own curve and it is meant
 * to be read as lying on it, so it stands off by a fourteenth of a radius and
 * no more - twenty-odd pixels of daylight at any size anybody will see this
 * at. Everything that follows is paid for by that: an arc that hugs the world
 * is barely taller than the world, and three bands have to nest inside that
 * height rather than stack past it.
 *
 * REACH is the one number that is not a taste. A band's inner end is an arc,
 * and an arc of radius r says nothing at all about a height further than r
 * from its middle; past about nine tenths of the way the curve is so nearly
 * flat that the band's corner sweeps most of the way across the window. So
 * nine tenths of the arc is the whole of the height there is to stand bands
 * in, and it is a bound rather than a plan: a band is as tall as what is
 * written in it, three of them sit SPREAD of their own heights apart, and if
 * that will not go inside the bound they close up until it does.
 *
 * They used to divide that height between them instead, which is what a band
 * that runs the width of the window wants - it is a shelf, and a shelf is as
 * tall as the wall. These are not shelves. A band a hundred tall with two
 * hundred of air in it is a module that gave up on a shorter window for the
 * sake of nothing at all.
 */
const CLEAR = .09;                       // how near the arc comes to the world
const REACH = .86;                       // and how much of it a band may stand in
const OVER = -.9;                        // where its near edge goes, open
const FADE_REST = .08, FADE_OPEN = .6;   // how deep the haze runs, in worlds
const SPREAD = 1.15;                     // how far apart the bands sit, in bands
const PUSH = .32;                        // how far they stand off when it wakes
const ASIDE = .35;                       // and the share of that a neighbour steps
const GROW = .16;                        // how much bigger the world is drawn then
const ROWS = 3;

/*
 * And the module's own box, in pixels at its natural size.
 *
 * A band is this wide and no wider: two margins, a picture, a gap and a
 * column for the writing. SAY is not a taste either - it is what the longest
 * line any module leads with measures at the size it is set in, which is why
 * it is an odd number. The description is not in it and does not have to be,
 * because the band it belongs to is wider by then.
 *
 * The picture is deliberately the smaller half of this. It is a thumbnail
 * standing beside a name, not an illustration with a caption, and every
 * pixel it is given is a pixel of window the arrangement needs before it
 * will fit - which is to say, a window it gives up on for a bigger picture.
 *
 * K is what turns the box into something measured in worlds after all - the
 * scale the whole module is drawn at, which follows the world up and down
 * between two limits. Below K_MIN the writing stops being writing; above
 * K_MAX a front page starts looking like a poster.
 */
const ART = 60, SAY = 212, PAD_IN = 13, GAP_IN = 12, PAD_Y = 17;
const BAND = PAD_IN * 2 + ART + GAP_IN + SAY;
const R_NAT = 164;                       // the world this box is natural beside
const K_MIN = .85, K_MAX = 1.7;
const SAY_OPEN = .45;                    // share of the room an open band gains

/* What the world is allowed to be. R_OF_H is the proportion it looks right
   at; the rest are the sizes past which something else breaks. R_LEAST is
   the whole of the last link in the chain: under it a row is shorter than
   the block that has to stand in it, and there is no arrangement left to
   make. */
const R_OF_H = .225, R_MOST = 280, R_LEAST = 140;

/*
 * Six places, five of them taken.
 *
 * `side` is which half of the window a band lies in and `row` which of the
 * three it is, so the arrangement is declared rather than counted out - and
 * the empty place, bottom right, is empty because nothing has asked for it
 * yet. A sixth module is a sixth entry here and nothing else: the geometry
 * has always drawn three rows a side.
 */
const MODULES = [
  { side: -1, row: 0, go: 'enchant', name: 'Enchant Calculator',
    line: 'What an enchantment really costs.',
    detail: 'Describe the item you hold, mark what you want on it, and compare '
          + 'every artifact and every order to roll them in.',
    art: 'Page Art/Enchanting.png' },
  { side: -1, row: 1, go: 'theory', name: 'Theory Crafting',
    line: 'What a build would actually do.',
    detail: 'Dress a class in anything the game has, enchant every slot, and '
          + "watch the damage move as the enemy's armour rises.",
    art: 'Page Art/Forge.png' },
  { side: -1, row: 2, go: 'fame', name: 'Fame Sweep',
    line: 'Which dungeons are worth the trip.',
    detail: 'Tick off what you have finished and it works out what the '
          + 'collection bonuses have paid, and where to go next.',
    art: "Dungeon Icons/Oryx's Sanctuary.gif" },
  { side: 1, row: 0, go: 'index', name: 'Index',
    line: 'Everything the game has, in one place.',
    detail: RealmI18n.t('home.index.detail'),
    art: 'Page Art/Index.png', film: true },
  { side: 1, row: 1, go: 'skins', name: 'Skin Viewer',
    line: 'Client skins, dyes and real animations.',
    detail: 'Browse every client skin, combine clothing and accessory dyes, '
          + 'save favourites, and inspect them on the real Realm Atlas.',
    /* A parade rather than a rack: thirteen of them walking past one after
       another, cut out of the viewer's own sheet by tools/build-ring-walk.js.
       What the page does is show people wearing the game's clothes, and a
       still of the clothes was a picture of the wrong half of that. */
    art: 'assets/skins/generated/walk.png', film: true, walk: true },
  /*
   * And the sixth place, which is taken by something that is not built yet.
   *
   * It stands in the arrangement because that is what it will be, and it is
   * greyed and takes no cursor because it is not that yet. A module that will
   * exist is a better thing to put in a hole than a hole, and a greyed one
   * that cannot be pressed says what it is without a word of explanation.
   */
  { side: 1, row: 2, soon: true, name: 'Pet Fame Calculator',
    line: 'What feeding a pet really costs.',
    detail: 'Work out what a feed is worth at each rank, what carrying a pet '
          + 'to the next one takes, and which food is the cheapest way there.',
    art: 'assets/whats-new/fancy-turtle-pet-skin-stand.png' }
];

const NS = 'http://www.w3.org/2000/svg';
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const el = (name, into, attrs) => {
  const node = document.createElementNS(NS, name);
  for (const k in (attrs || {})) node.setAttribute(k, attrs[k]);
  if (into) into.append(node);
  return node;
};

/* The margin the whole arrangement keeps off the window. */
const edgeFor = W => clamp(Math.round(W * .02), 20, 48);

/*
 * How big the world is drawn in a window of this size - the first link in
 * the chain, and the only measurement the window is asked for.
 *
 * Four answers, and the smallest wins. The proportion it looks right at; the
 * size past which it stops being a world and becomes a wall; the height,
 * which has to hold a stack of rows nine tenths of an arc tall; and the
 * width, which has to hold the arc's stand-off and a module's box beside it
 * on each side. The width is the awkward one, because the box grows with the
 * world it is beside - so the two are solved together, and then again at
 * each end where the box has stopped growing and the world has not.
 */
function worldFor(W, H) {
  const edge = edgeFor(W);
  /* Three bands, SPREAD apart, and a band is a picture and two margins tall -
     `(ART + 2*PAD_Y) * k`, with k the world over R_NAT, which is what turns a
     height back into a world. */
  const byH = (H - 2 * edge) / (2 * SPREAD + 1) * R_NAT / (ART + 2 * PAD_Y);
  const half = W / 2 - edge;
  const lin = half / ((1 + CLEAR) + BAND / R_NAT);
  const byW = lin < R_NAT * K_MIN ? (half - BAND * K_MIN) / (1 + CLEAR)
            : lin > R_NAT * K_MAX ? (half - BAND * K_MAX) / (1 + CLEAR)
            : lin;
  return Math.min(R_OF_H * H, R_MOST, byH, byW);
}

/*
 * When the arrangement is not on offer at all.
 *
 * Two questions and no breakpoints. Can this machine hover? - because the
 * whole of the movement is a band opening under a cursor, and `hover: none`
 * is how a browser answers that. And is there a world big enough to arrange
 * anything around? - which is the size question asked of the arrangement
 * itself rather than of the window, so it is answered by the same arithmetic
 * that lays the thing out and cannot drift from it. A pixel width written in
 * the stylesheet would be a guess at this answer, kept in a second place.
 */
let hoverless = null;
function noHover() {
  if (!hoverless && window.matchMedia) hoverless = window.matchMedia('(hover: none)');
  return hoverless ? hoverless.matches : false;
}
function narrow() {
  return noHover() || worldFor(window.innerWidth, window.innerHeight) < R_LEAST;
}

let parts = null, stage = null, wheel = null, core = null, glow = null, shade = null;
let waves = null, coming = 0;
let planetOn = false, run = 0, on = false, geo = null, openAt = null, stood = false;

/*
 * Which of them is forward, and what that means for the rest.
 *
 * One band coming forward is also every other thing on the page going back,
 * or the one in front is simply brighter than its neighbours rather than
 * being the only thing being read. So the others step off towards their own
 * edge - a third of the distance they take when the world wakes, which is
 * the same movement said more quietly - and they lose most of their light.
 *
 * All of that is one class on the body and nothing else. Stepping aside, the
 * longer step when the world wakes, and leaving altogether when the map takes
 * the window are three lengths of the same movement, so they are three
 * lengths written in one place, eased by the stylesheet, and the frame loop
 * has only the shape of a band left to draw. It also means the writing, which
 * is html and could never have been moved by the drawing, travels with the
 * band it belongs to instead of being faded out where it stood.
 *
 * Said from the state rather than by each band telling its neighbours,
 * because the cursor crosses from one band straight into the next and two of
 * them would be giving orders about the same frame.
 */
function spread() {
  document.body.classList.toggle('ring-open', !planetOn && !!openAt);
}

/*
 * The whole arrangement, worked out once a resize and read by everything.
 *
 * In pixels rather than in a box of a hundred units, because the arrangement
 * is the window now and not a square drawn in the middle of one: a viewBox
 * that is the window's own size means the numbers the drawing uses and the
 * numbers the writing is placed by are the same numbers, and neither has to
 * be converted into the other to be laid over it.
 */
function measure() {
  const W = Math.max(320, window.innerWidth), H = Math.max(320, window.innerHeight);
  const edge = edgeFor(W);
  const R = Math.max(60, worldFor(W, H));
  const k = clamp(R / R_NAT, K_MIN, K_MAX);
  const Ri = R * (1 + CLEAR);
  const cx = W / 2, cy = H / 2;
  /* How tall the writing is, which the picture decides - a name and its line
     together are shorter than the thumbnail beside them at every scale - and
     how tall the band is, which is that and its air. Both of them scale with
     the world and neither has a fixed part, because a fixed part is a thing
     that stops shrinking when the world does: the gap between two bands is
     what is left of the arc once three of them have stood in it, and it would
     be eaten from both ends on a small window and gape on a large one. */
  const block = ART * k;
  const h = block + 2 * PAD_Y * k;
  /* And how far apart they stand, which is now simply a share of how tall
     they are: the arc used to decide it, by being the only height there was,
     and what it decided was an even gap on one window and a chasm on the
     next. A band is the thing that has a size here; the air between two of
     them is a fraction of that and nothing else. */
  const step = h * SPREAD;

  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    const mid = cy + (i - 1) * step;
    /* How far an open band grows is not settled here - it is whatever the
       writing that comes out of it needs, which only the browser can say, so
       each band measures its own in `place`. */
    const row = { mid, y0: mid - h / 2, y1: mid + h / 2 };
    /* Where the writing comes nearest the world is where the arc crowds it
       most, and so where the band has to stop to be a rectangle for the whole
       height of what is standing in it. The writing, not the band: a band's
       own top and bottom are air, and measuring to them would cost every one
       of them the width of a curve nothing is written in.

       `hold` is that distance out from the middle - which for the middle band
       is the whole arc, since it straddles the world's own line. */
    const dy = clamp(cy, mid - block / 2, mid + block / 2) - cy;
    row.near = cy + dy;
    row.hold = Math.sqrt(Math.max(1, Ri * Ri - dy * dy));
    rows.push(row);
  }
  /*
   * And one outer end for all three.
   *
   * Each band could start where its own writing runs out, and then no two of
   * them would begin at the same place: the middle row is crowded hardest by
   * the arc, so it would reach further out than the other two and the side of
   * the arrangement would be ragged. They all start where the hungriest of
   * them has to - which is the middle row, always - and the two outer rows
   * spend what that gives them on their own writing rather than on air.
   */
  geo = { W, H, cx, cy, R, Ri, k, edge, rows,
    band: BAND * k, pad: PAD_IN * k, out: Ri + BAND * k,
    /* Where the arc's near edge lands when the band is the whole window: past
       the far side of it, in the same units the other two clearances are in,
       so growing into the page is the same movement as opening over the
       world and not a second mechanism beside it. */
    whole: -(1 + (cx + 60) / R) };
  return geo;
}

/*
 * The middle of a band's inner arc, for a given clearance.
 *
 * The arc is always the world's own curve, stood off by CLEAR; what moves is
 * where its middle sits. At rest that is the middle of the world and the two
 * are concentric. Slid across, the band carries the same curve over the
 * world - which is what an open one does, and why `clear` may be negative:
 * it is where the near edge of the arc lands, in worlds, out from the
 * world's own edge.
 */
/*
 * How much bigger the world is being drawn than it is laid out, eased.
 *
 * The world comes forward under the cursor, and a band whose end was worked
 * out for the world at rest is then a band the world has grown into: near the
 * top and bottom of a band the world gains more width than the band steps
 * aside, and the two meet. Everything about a band's inner end is a distance
 * from the middle of the world, so scaling all of them by what the world is
 * doing is the whole of following it - the arc keeps its clearance, in worlds,
 * whatever size a world happens to be.
 */
let grown = 1;

const bowAt = (side, clear, w) =>
  geo.cx - side * (w === undefined ? grown : w) * (geo.Ri - geo.R * (1 + clear));

/*
 * And where that arc stands at a given height, on the band's own side.
 *
 * Past REACH of the way up it, the height is clamped rather than the answer:
 * an arc that near its own pole is turning so fast that another few pixels of
 * height would sweep the end of the band most of the way across the window,
 * and at the pole itself it says nothing at all. So the end is the world's
 * curve while the curve still means something and a straight line above and
 * below that - which is the only part of a band that ever reaches past the
 * arc, and the reason a band may now be any height it likes.
 */
const inner = (side, y, bow, w) => {
  const Ri = geo.Ri * (w === undefined ? grown : w);
  const dy = Math.min(Math.abs(y - geo.cy), REACH * Ri);
  return bow + side * Math.sqrt(Math.max(0, Ri * Ri - dy * dy));
};

function build() {
  stage = document.getElementById('ringStage');
  wheel = document.getElementById('ringWheel');
  core = document.getElementById('ringCore');
  if (!stage || !wheel || !core) return false;
  const defs = wheel.querySelector('defs');
  glow = wheel.querySelector('#ringGlow');
  measure();
  parts = [];

  /* The world going back, which is a patch of dark over it and nothing more.
     First into the drawing, so every band stands in front of it - including
     the one that has come forward over the top of the world. */
  shade = el('circle', wheel, { class: 'ring-shade' });

  /*
   * And what the world does when the cursor arrives at it: three rings
   * leaving its edge, one after another, the way rings leave a drop.
   *
   * Drawn rather than lit, because a glow that pulses is a thing blinking at
   * you and rings going outward are a thing that has been touched. They are
   * held still - the animation is paused - until the cursor is actually on
   * the world, so a front page nobody is pointing at is a front page with
   * nothing running on it.
   */
  const rings = el('g', wheel, { class: 'ring-ripple' });
  waves = [];
  for (let i = 0; i < 3; i++) {
    waves.push(el('circle', rings, { class: 'ring-wave',
      style: 'animation-delay:' + (i * 1.14).toFixed(2) + 's' }));
  }

  for (const m of MODULES) {
    /* The whole band, from one state object, so every piece of it is drawn
       from the same numbers on the same frame. `out` is how far the outer end
       stands from the middle; `bow` is where the arc's middle has got to. */
    const now = { bow: 0, y0: 0, y1: 0, out: 0 };
    const row = () => geo.rows[m.row];
    const outer = () => geo.cx + m.side * now.out;
    const sweep = m.side < 0 ? 0 : 1;

    /* The inner end, from the top corner down to the bottom one: a straight
       drop where the arc has run out, then the arc, then another drop. Down
       the near side of the world and bulging away from it - anticlockwise on
       the left of the page and clockwise on the right, which is the whole
       difference between an end that hugs the world and one that swallows it.
       Never half a turn, so the large-arc flag is always nought. */
    const top = () => inner(m.side, now.y0, now.bow);
    const foot = () => inner(m.side, now.y1, now.bow);
    const bow = () => {
      const Ri = geo.Ri * grown;
      const lim = REACH * Ri;
      const a = geo.cy - lim, b = geo.cy + lim;
      const t0 = clamp(now.y0, a, b), t1 = clamp(now.y1, a, b);
      let d = '';
      if (now.y0 < t0) d += ' L ' + inner(m.side, t0, now.bow) + ' ' + t0;
      if (t0 < t1) d += ' A ' + Ri + ' ' + Ri + ' 0 0 ' + sweep
        + ' ' + inner(m.side, t1, now.bow) + ' ' + t1;
      if (now.y1 > t1) d += ' L ' + foot() + ' ' + now.y1;
      return d;
    };

    const lipPath = () => 'M ' + top() + ' ' + now.y0 + bow();
    const face = () => 'M ' + outer() + ' ' + now.y0
      + ' L ' + top() + ' ' + now.y0 + bow()
      + ' L ' + outer() + ' ' + now.y1 + ' Z';
    const capPath = () => 'M ' + outer() + ' ' + now.y0 + ' L ' + outer() + ' ' + now.y1;
    /* The two long edges: each runs from the outer end to the arc along the
       height it started at, and stays on it however far the band is drawn. */
    const edges = () => 'M ' + outer() + ' ' + now.y0 + ' L ' + top() + ' ' + now.y0
      + ' M ' + outer() + ' ' + now.y1 + ' L ' + foot() + ' ' + now.y1;

    /*
     * The dissolve.
     *
     * An open band is drawn over the world rather than up to it, and a band
     * that simply lay across the world would hide the thing it is arranged
     * around. What opens instead is a band whose leading end stops being
     * there: one radial gradient about the middle of the band's own arc,
     * clear at that arc and solid a little way back from it, used as a mask.
     * At rest the fade is a sliver and the arc reads as an edge; open, the
     * leading end is haze and the world can be seen through what crosses it.
     *
     * About the arc's middle rather than the world's, so the haze follows the
     * end of the band wherever the arc has been slid to - which is the only
     * centre that stays true when the band is standing over the world.
     *
     * It is hung on the group only while the band is actually opening, and
     * taken off the moment it is shut. A mask is not a cheap attribute: it
     * puts the group in an offscreen buffer the size of the mask and rebuilds
     * that whenever anything inside it changes, and five of them standing
     * over a canvas that is painting a turning world is most of what this
     * costs. Shut, none of them exist - which is the state all five are in
     * for the whole of the other movement, the one where the world comes
     * forward.
     */
    const at = m.go;
    const grad = el('radialGradient', defs, { id: 'ringFade-' + at,
      gradientUnits: 'userSpaceOnUse' });
    const melt = el('stop', grad, { offset: 0, 'stop-color': '#fff' });
    const firm = el('stop', grad, { offset: 1, 'stop-color': '#fff' });
    const veil = el('mask', defs, { id: 'ringMask-' + at, maskUnits: 'userSpaceOnUse' });
    const sheet = el('rect', veil, { fill: 'url(#ringFade-' + at + ')' });

    /*
     * Two groups, one inside the other, because a band does two unrelated
     * things with the same property. The outer one drifts, slowly and for
     * ever; the inner one steps aside, stands off and leaves. One element
     * has one `transform`, and a transition and an animation on it would be
     * two answers to the same question - so they are given one each.
     */
    const drift = el('g', wheel, { class: 'ring-drift',
      style: 'animation-delay:' + (-3.1 * MODULES.indexOf(m)).toFixed(1) + 's' });
    const g = el('g', drift, { class: 'ring-seg ' + (m.side < 0 ? 'left' : 'right')
      + (m.soon ? ' is-soon' : '') });
    /* The light a band sits in, which is the same outline blurred and laid
       under it. One path, and the blur is a filter on the path rather than on
       the group: what has to be held offscreen is then a soft line and not the
       whole band with its picture and its writing in it. */
    const lift = el('path', g, { class: 'lift', filter: 'url(#ringBlur)' });
    const back = el('path', g, { class: 'back' });  // dims the sky it stands on
    const skin = el('path', g, { class: 'face' });  // and the light on top of it
    const lip = el('path', g, { class: 'lip' });    // the arc, against the world
    const cap = el('path', g, { class: 'cap' });    // the outer end, the one that goes
    const side = el('path', g, { class: 'end' });   // and the two long edges

    /*
     * The writing, and the picture with it.
     *
     * Plain HTML laid over the drawing rather than put inside it. It is a
     * name, a line and a paragraph beside a picture, which is a thing the
     * browser already knows how to set; a foreignObject would be the same
     * thing spelled so that it cannot be styled from the stylesheet with
     * everything else, and would have to be measured in the drawing's units
     * besides.
     *
     * A button, because in the narrow arrangement this block is the whole of
     * the card and there is nothing else to press. That also gives the wide
     * arrangement something a keyboard can reach: the band itself is a
     * drawing and takes no focus, so the block takes it and opens the band
     * from there. `data-go` is read by the page's own handler, so where a
     * module leads is written down once.
     */
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ring-item ' + (m.side < 0 ? 'left' : 'right')
      + (m.soon ? ' is-soon' : '');
    /* No destination and no focus for one that is not built: `data-go` is
       what the page's own handler reads, so leaving it off is the whole of
       not being able to go there. */
    if (m.soon) item.disabled = true; else item.dataset.go = m.go;
    /* And the writing drifts on the same clock as the band it belongs to,
       from its own wrapper for the same reason. */
    item.innerHTML = '<span class="ring-float" style="animation-delay:'
      + (-3.1 * MODULES.indexOf(m)).toFixed(1) + 's">'
      + '<span class="ring-art"></span>'
      + '<span class="ring-copy"><span class="t"></span>'
      + '<span class="s"></span><span class="d"></span></span></span>';
    const art = document.createElement(m.film ? 'span' : 'img');
    art.className = 'ring-art-pic' + (m.film ? ' is-film' : '')
      + (m.walk ? ' is-walk' : '');
    art.dataset.art = m.art;
    if (!m.film) art.alt = '';
    item.querySelector('.ring-art').append(art);
    dressArt(art);
    item.querySelector('.t').textContent = m.name;
    if (m.soon) item.querySelector('.t').insertAdjacentHTML('beforeend', '<i>soon</i>');
    item.querySelector('.s').textContent = m.line;
    item.querySelector('.d').textContent = m.detail;
    stage.append(item);

    /* Writing an attribute marks it dirty whether or not it says anything
       new, and most frames of most bands say nothing new. */
    const put = (node, name, value) => {
      const said = String(value);
      if (node.getAttribute(name) !== said) node.setAttribute(name, said);
    };

    let open = 0, wantOpen = 0;          // 0 shut, 1 under the cursor
    let grow = 0;                        // px it gains above and below, open
    let veiled = false;

    function draw() {
      const r = row();
      now.bow = bowAt(m.side, mix(CLEAR, OVER, open));
      now.y0 = r.y0 - grow * open;
      now.y1 = r.y1 + grow * open;
      /* Shut, every band on a side starts on the same line, one box further
         out than the arc crowds the middle row. Open, it steps out by a
         margin and no more: everything it actually gains is inward, over the
         world, and running the outer end to the edge of the window was taking
         room for the sake of taking it. */
      now.out = mix(geo.out, geo.out + geo.pad * 1.6, open);

      const shape = face();
      put(lift, 'd', shape);
      put(back, 'd', shape);
      put(skin, 'd', shape);
      put(lip, 'd', lipPath());
      put(cap, 'd', capPath());
      put(cap, 'opacity', Math.max(0, 1 - open * 1.7).toFixed(3));
      put(side, 'd', edges());

      const wants = open > 0.002;
      if (wants !== veiled) {
        veiled = wants;
        if (wants) g.setAttribute('mask', 'url(#ringMask-' + at + ')');
        else g.removeAttribute('mask');
      }
      if (wants) {
        /* How deep the haze runs is measured in worlds: what it has to cover
           is the world the leading end is crossing. The gradient's own reach
           is whatever puts the far corner of the band inside it, since past
           the last stop a gradient is the last stop and the band would be
           solid out there anyway. */
        const fade = geo.R * mix(FADE_REST, FADE_OPEN, open);
        const far = Math.hypot(outer() - now.bow, geo.H);
        put(grad, 'cx', now.bow.toFixed(2));
        put(grad, 'cy', geo.cy);
        put(grad, 'r', far.toFixed(2));
        put(melt, 'offset', (geo.Ri / far).toFixed(4));
        put(melt, 'stop-opacity', (1 - open * .88).toFixed(3));
        put(firm, 'offset', ((geo.Ri + fade) / far).toFixed(4));
      }
    }

    /*
     * Where the writing stands, which is decided once a resize and not once a
     * frame: the band comes to the writing, the writing stays where it was.
     *
     * The block is the band less its two margins, and the band is the block
     * plus them - the same box said from either end, which is what keeps a
     * module exactly as long as it needs to be. Two widths, because an open
     * band has crossed the world and a paragraph set to the shut width would
     * be a narrow column standing in the middle of it. Not all of what it
     * gains: the leading end is haze, and writing carried out into the haze
     * is writing set on nothing.
     *
     * Handed to the stylesheet as custom properties rather than as `left` and
     * `width`, because in the narrow arrangement this block is a card in a
     * column and must not be carrying a position from the wide one.
     */
    function place() {
      const r = row();
      /* Laid out for the world at rest, whatever the world is doing now. */
      const shut = inner(m.side, r.near, bowAt(m.side, CLEAR, 1), 1);
      const over = inner(m.side, r.near, bowAt(m.side, OVER, 1), 1);
      /* The block is what is left of the band once its two margins and the
         curve at its inner end are taken out - so the two outer rows, which
         the arc crowds less, are wider here than the middle one. */
      const wide = Math.max(120, geo.out - r.hold - geo.pad * 2);
      const off = geo.cx - geo.out + geo.pad;
      item.style.setProperty('--x', Math.round(off) + 'px');
      item.style.setProperty('--y', Math.round((r.y0 + r.y1) / 2) + 'px');
      item.style.setProperty('--w', Math.round(wide) + 'px');
      item.style.setProperty('--w2',
        Math.round(wide + Math.abs(over - shut) * SAY_OPEN) + 'px');

      /*
       * And how tall this band has to be when it opens.
       *
       * Not a guess, and not a number in a stylesheet: the description runs
       * to three lines in one module and two in another, and which it is
       * depends on the width the band has by then - which depends on the
       * world, which depends on the window. So a block is made to stand in
       * its open state off the side of the page and asked how tall it came
       * out. It costs one layout a resize, and it is the only thing that can
       * promise a band is never shorter than what is written in it.
       *
       * A copy, and not the block itself. Asking an element for its height is
       * asking the browser to work the page out there and then, which settles
       * the style it has at that moment - so opening the real block, however
       * briefly, gives it a state to transition back out of, and every drag
       * of the window edge flashed five descriptions on and faded them off
       * again. A copy has nothing to go back to: it is born open and thrown
       * away, and it is never drawn.
       */
      const ghost = item.cloneNode(true);
      ghost.classList.add('is-sizing');
      ghost.classList.remove('on');
      stage.append(ghost);
      const tall = ghost.offsetHeight;
      ghost.remove();
      /* The band's own, not the row's. Two bands share a row - one each side -
         and their descriptions run to different lengths, so a figure kept on
         the row was whichever of the two was worked out second, and the other
         one opened into a band too short for it. */
      grow = Math.max(0, (tall + 2 * PAD_Y * geo.k - (r.y1 - r.y0)) / 2);

      /* The mask's own box, which is what the browser has to find room for
         offscreen, so it is the window and a hair rather than anything
         generous: nothing masked ever reaches outside it. */
      for (const node of [veil, sheet]) {
        node.setAttribute('x', -40); node.setAttribute('y', -40);
        node.setAttribute('width', geo.W + 80); node.setAttribute('height', geo.H + 80);
      }
    }

    const lit = yes => {
      g.classList.toggle('on', yes);
      item.classList.toggle('on', yes);
    };
    const want = yes => {
      if (planetOn && yes) return;
      wantOpen = yes ? 1 : 0;
      lit(yes);
      nudge();                           // the shape of it is drawn, not styled
      if (yes) openAt = m.go; else if (openAt === m.go) openAt = null;
      spread();
    };

    parts.push({
      go: m.go, draw, place,
      still: () => Math.abs(wantOpen - open) < .003,
      ease: delta => { open += (wantOpen - open) * closes(.075, delta); },
      land: () => { open = wantOpen; },
      shut: () => { wantOpen = 0; lit(false); },
      /*
       * The band's own outline at any point between where it sits and the
       * whole window, asked for without disturbing what it is currently
       * doing. It is what the sheet that covers the page is cut from: the
       * cover starts as this band exactly, so there is no moment where one
       * shape is swapped for another.
       */
      /* The middle of the box this module occupies, which is where the dark
         closes on the way back. Worked out rather than measured, because by
         then the arrangement has been put away and has no rectangle left. */
      spot: () => ({ x: geo.cx + m.side * (geo.out + row().hold) / 2, y: row().mid }),
      shape: at => {
        const r = row(), keep = Object.assign({}, now);
        now.bow = bowAt(m.side, mix(CLEAR, geo.whole, at));
        now.y0 = mix(r.y0, -24, at);
        now.y1 = mix(r.y1, geo.H + 24, at);
        now.out = mix(geo.out, geo.cx + 60, at);
        const d = face();
        Object.assign(now, keep);
        return d;
      }
    });

    if (m.soon) continue;             // nothing to open, and nowhere to go
    /*
     * The writing is what answers the cursor, not the band it stands in.
     *
     * A band is most of a quarter of the window and nearly all of it is the
     * dark it is drawn on: crossing that corner on the way to somewhere else
     * opened a module, which is a page that reacts to being walked over. What
     * is actually being offered is a name, a line and a picture, so that is
     * the thing with the listeners on it - and it is a button, so this is
     * also what a keyboard was already reaching for.
     */
    item.addEventListener('pointerenter', () => want(true));
    item.addEventListener('pointerleave', () => want(false));
    /*
     * Chosen, rather than followed.
     *
     * A link takes you off the page the instant it is pressed, which on a
     * page that is an arrangement of places reads as the arrangement being
     * thrown away. What happens instead is that the one that was pressed
     * becomes the window - it is already the right shape, it only has to
     * grow - and the page it leads to comes up behind it once it has. The
     * stopped propagation is what keeps the page's own handler for `data-go`
     * from doing it the plain way underneath.
     */
    item.addEventListener('click', event => {
      if (narrow() || !on) return;       // the column follows its links plainly
      event.preventDefault();
      event.stopPropagation();
      chose(m.go);
    });
    /* Reached by keyboard, the band opens the same way, so what is described
       is what is lit. Only in the wide arrangement: in the column the block
       is an ordinary card and there is no band behind it to open. */
    item.addEventListener('focus', () => { if (!narrow()) want(true); });
    item.addEventListener('blur', () => { if (!narrow()) want(false); });
  }
  return true;
}

/*
 * One clock for all of them.
 *
 * Five loops would mean five callbacks, five style recalculations and five
 * chances for the browser to lay the page out again inside a single frame -
 * for a movement that is almost always all of them moving together.
 */
/*
 * How far to close the remaining distance this frame.
 *
 * Counted in seconds, not in frames. It was a flat fraction per frame, which
 * is the same movement only while the frame rate is - and the two moments a
 * page is least likely to be at sixty are the moment it has just loaded and
 * the moment a map has just put itself away. Those are exactly the moments
 * somebody notices: the first band they opened crept, the next one snapped,
 * and nothing in the page had changed between them.
 *
 * `tau` is the time the distance would take to close to a third of itself, so
 * a movement is the same length of time on any machine and simply drawn with
 * fewer pictures on a slow one.
 */
let ticked = 0;
const closes = (tau, delta) => 1 - Math.exp(-delta / tau);

function tick(now) {
  const delta = ticked ? Math.min(.1, (now - ticked) / 1000) : 1 / 60;
  ticked = now;
  /* The world's own size is one value for all of them - it belongs to the
     world, not to any band - so it is eased here and read by every draw. */
  let moving = false;
  const want = planetOn ? 1 + GROW : 1;
  if (Math.abs(want - grown) < .0008) grown = want;
  else { grown += (want - grown) * closes(.095, delta); moving = true; }
  for (const one of parts) {
    if (one.still()) one.land(); else { one.ease(delta); moving = true; }
    one.draw();
  }
  run = moving ? requestAnimationFrame(tick) : 0;
  if (!run) ticked = 0;                  // and the next one starts its own clock
}
function nudge() { if (!run && parts) { ticked = 0; run = requestAnimationFrame(tick); } }

/*
 * The world.
 *
 * How big it is drawn is not the atlas's business to guess: it is the middle
 * of an arrangement drawn on top of it, and everything else on the page has
 * been measured out from it. So the page works out the fraction of the
 * window the world should fill and says so - every time the arrangement is
 * measured, and every time the cursor arrives at it or leaves. The atlas
 * eases there on its own, which is what makes coming closer a movement
 * rather than a jump.
 */
let told = null;

/* Also where the world's own patch is sized, since the two are the same
   number and reading it here is what keeps them the same. Nothing at all in
   the narrow arrangement, where there is no world: `null` hands the framing
   back to the ordinary fit. */
function worldShare() {
  if (!stage || narrow()) return null;
  if (!geo) measure();
  const across = geo.R * 2 * (1 + (planetOn ? GROW : 0));
  /* On the body rather than the stage, because the world's size is also what
     places the bell above it, and the bell is page furniture standing outside
     the arrangement. */
  document.body.style.setProperty('--core', Math.round(across) + 'px');
  /* And the most room the world ever takes: the dark arc the bands stand off
     at, or the world itself come forward under the cursor, whichever reaches
     further. The name and the bell above it are sized against this rather
     than against the world of the moment, so they never move while it
     breathes and it never grows up into them. */
  document.body.style.setProperty('--core-room',
    Math.round(Math.max(geo.Ri * 2, geo.R * 2 * (1 + GROW))) + 'px');
  return across / Math.min(window.innerWidth, window.innerHeight);
}

function tellAtlasSize(snap) {
  if (!on || !stage) return;
  const of = worldShare();
  if (!snap && told !== null && of !== null && Math.abs(of - told) < 0.002) return;
  told = of;
  dressAtlas(snap);
}

/*
 * Laying it out, which is the whole of what a resize costs.
 *
 * Which arrangement the window can have is settled first, because in the
 * narrow one there is nothing to measure and nothing to draw. Otherwise the
 * window is measured, the writing is put where the measurement says, and
 * every band is drawn once at whatever it was already doing. Nothing here
 * starts a frame loop: a window being dragged is asking the browser for a
 * great deal already, and the bands are not moving on their own account
 * while it is.
 */
function fit() {
  if (!on || !stage) return;
  const wide = !narrow();
  /* Left alone while the map has the window: this would otherwise hand the
     column its layout mid-flight, and the column has no world behind it. */
  if (!stood) document.body.dataset.ring = wide ? 'wheel' : 'list';
  if (!wide) {
    told = null;
    rest();
    dressAtlas(false);
    paceAtlas();
    return;
  }
  measure();
  wheel.setAttribute('viewBox', '0 0 ' + geo.W + ' ' + geo.H);
  /* Measured and drawn even while the map has the window, so that shutting it
     hands back an arrangement that already fits - but not shown, which is the
     one thing standing aside means. */
  /* The one number the stylesheet needs out of all this: how big a module is
     drawn, which is how big its picture and its writing are. */
  stage.style.setProperty('--k', geo.k.toFixed(4));
  /* The one length the stylesheet and the atlas both move over. On the body,
     because the name and the bell are outside the stage and wait on it too. */
  document.body.style.setProperty('--trip', TRIP + 'ms');
  /* The three lengths of the one sideways movement: a neighbour stepping
     back, all of them standing off the world it has woken, and all of them
     leaving the window to the map. Written here because they are worked out
     from the world, and read by the stylesheet because that is what eases
     them. */
  stage.style.setProperty('--push', Math.round(geo.R * PUSH) + 'px');
  stage.style.setProperty('--aside', Math.round(geo.R * PUSH * ASIDE) + 'px');
  stage.style.setProperty('--flee', Math.round(geo.cx + geo.Ri + 80) + 'px');
  /* And how far the arc itself comes out when the world wakes, which is not
     the same as how far the band steps aside: the outer end moves by the one
     and the inner end by both, so what a band really does when the world
     comes forward is get shorter by this. */
  stage.style.setProperty('--swell', Math.round(geo.Ri * GROW) + 'px');
  if (glow) {
    glow.setAttribute('cx', geo.cx);
    glow.setAttribute('cy', geo.cy);
    glow.setAttribute('r', Math.round(geo.R * 2.8));
  }
  if (shade) {
    shade.setAttribute('cx', geo.cx);
    shade.setAttribute('cy', geo.cy);
    shade.setAttribute('r', Math.round(geo.R * 1.03));
  }
  /* The rings start at the edge the world has when it is the one being
     looked at, since that is the only time they are ever seen. */
  if (waves) for (const wave of waves) {
    wave.setAttribute('cx', geo.cx);
    wave.setAttribute('cy', geo.cy);
    wave.setAttribute('r', Math.round(geo.R * (1 + GROW)));
  }
  pointAtAtlas();                        // there is a world to show again
  for (const one of parts) { one.place(); one.draw(); }
  tellAtlasSize(true);
  paceAtlas();
}

/*
 * Going through a module, and coming back out of it.
 *
 * The module that was pressed becomes the page - it is already the right
 * shape, it only has to grow - and what it grows into is a sheet over the
 * whole window. The page is changed behind that sheet and given a moment to
 * put itself together before anybody sees it, which is the point of the whole
 * thing: the wait for a page is spent watching something rather than watching
 * a page arrive in pieces.
 *
 * The sheet is its own drawing on top of everything, not the band itself.
 * The band is one shape among six inside the arrangement, with the writing of
 * all six laid over it - so a band growing could never cover its neighbours'
 * names, whatever it did, because they are in front of it. What covers a page
 * has to be in front of the page.
 *
 * Cut from the band's own outline at the moment it is pressed, so there is no
 * frame where one shape is exchanged for another: it starts as that module,
 * exactly, and ends as the window.
 */
let went = '', cover = null, coverPath = null, coverRun = 0;
let shutFade = null, shutRect = null;
/* The last fifth of the shutter's radius is its edge rather than its rim: the
   dark arrives as a gradient, not as a circle drawn round the page. */
const SOFT = .8;

function sheet() {
  if (cover) return cover;
  cover = document.createElementNS(NS, 'svg');
  cover.setAttribute('class', 'ring-sheet');
  cover.setAttribute('aria-hidden', 'true');
  /*
   * The shutter: a circle of daylight in the middle of the dark, which closes.
   * It is a mask rather than a second shape, so what shuts is the cover
   * itself and there is never a moment with two sheets to keep in step.
   * Beyond its radius a radial gradient is its last stop, so the whole of the
   * window outside the circle is covered without anything being drawn there.
   */
  const spare = el('defs', cover, {});
  shutFade = el('radialGradient', spare, { id: 'ringShut', gradientUnits: 'userSpaceOnUse' });
  el('stop', shutFade, { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0 });
  el('stop', shutFade, { offset: SOFT, 'stop-color': '#fff', 'stop-opacity': 0 });
  el('stop', shutFade, { offset: 1, 'stop-color': '#fff', 'stop-opacity': 1 });
  const veil = el('mask', spare, { id: 'ringShutMask', maskUnits: 'userSpaceOnUse' });
  shutRect = el('rect', veil, { fill: 'url(#ringShut)' });
  coverPath = el('path', cover, {});
  document.body.append(cover);
  return cover;
}

/*
 * Draws the cover at `at` - 0 is the band it came from, 1 is the window - and
 * fills it in as it goes. It is see-through at the start because at the start
 * it is lying exactly on the band it was cut from, and a second copy of a
 * band drawn over the band is a thing nobody should be able to notice.
 */
function paint(one, at) {
  const box = sheet();
  box.setAttribute('viewBox', '0 0 ' + geo.W + ' ' + geo.H);
  coverPath.setAttribute('d', one.shape(at));
  coverPath.setAttribute('fill-opacity', Math.min(1, at * 2.2).toFixed(3));
  coverPath.setAttribute('stroke-opacity', (Math.max(0, 1 - at * 1.6) * .5).toFixed(3));
  box.style.opacity = '1';
}

function walk(one, from, to, over, done) {
  cancelAnimationFrame(coverRun);
  const began = performance.now();
  const step = now => {
    const t = Math.min(1, (now - began) / over);
    const e = t * t * (3 - 2 * t);
    paint(one, from + (to - from) * e);
    if (t < 1) coverRun = requestAnimationFrame(step); else if (done) done();
  };
  coverRun = requestAnimationFrame(step);
}

function chose(go) {
  const one = parts && parts.find(part => part.go === go);
  if (!one) { location.hash = go; routeFromHash(); return; }
  went = go;
  walk(one, 0, 1, TAKE, () => {
    /* Covered. The page is changed where it cannot be seen doing it, and the
       cover stays down until that page is actually there - however long that
       takes - before opening again out of the module it grew from. */
    location.hash = go;
    const ready = routeFromHash();
    // Keep the cover fully shut while a lazy page script itself is arriving.
    // Once it has run, settled() takes over and waits for the fetches/images
    // that page started before the cover opens again.
    Promise.resolve(ready).finally(() => {
      settled(() => veil(go, 1, 0, shed));
    });
  });
}

/*
 * And back out, which is the same journey with the same two halves: the dark
 * closes on the module's place, the arrangement is put back underneath it
 * while there is nothing to see, and the cover shrinks away into the module
 * it will be standing in.
 */
function grew(go) {
  went = '';
  settled(() => {
    /* Found now rather than then: the window may have been resized behind the
       cover, in which case the arrangement underneath is a new one and the
       band this came from is a band that no longer exists. */
    const one = parts && parts.find(part => part.go === go);
    if (!one) { shed(); return; }
    walk(one, 1, 0, TAKE, shed);
  });
}

function shed() {
  if (!cover) return;
  cover.remove();
  cover = null; coverPath = null; shutFade = null; shutRect = null;
  // Deferred page work can now run without stealing frames from the reveal.
  window.dispatchEvent(new Event('rotmgtransitionend'));
}

/*
 * The dark closing on the place a module stands, or opening out of it.
 *
 * Not a flat fade, which darkens everywhere at once and says nothing about
 * where you are going or where you have been. This shuts from the far corners
 * inwards, and the last lit thing on the screen is the spot the module stood
 * in; opening, the first thing lit is the same spot. Both journeys therefore
 * begin and end in the one place, and the eye is already there when the page
 * arrives.
 *
 * `from` and `to` are 0 for a clear window and 1 for a covered one.
 */
function veil(go, from, to, done) {
  const one = parts && parts.find(part => part.go === go);
  const W = window.innerWidth, H = window.innerHeight;
  const box = sheet();
  cancelAnimationFrame(coverRun);
  box.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  coverPath.setAttribute('d', 'M -60 -60 H ' + (W + 60) + ' V ' + (H + 60) + ' H -60 Z');
  coverPath.setAttribute('fill-opacity', 1);
  coverPath.setAttribute('stroke-opacity', 0);
  box.style.transition = 'none';
  /* Nothing to close on - no arrangement was standing when this page was
     opened - so the plain fade, which is what the shutter improves on and not
     what it replaces. */
  if (!one || !geo) {
    coverPath.removeAttribute('mask');
    box.style.opacity = from >= .5 ? '1' : '0';
    void box.offsetWidth;
    box.style.transition = 'opacity ' + CLOSE + 'ms ease';
    box.style.opacity = to >= .5 ? '1' : '0';
    setTimeout(done, CLOSE);
    return;
  }
  box.style.opacity = '1';

  const spot = one.spot();
  const at = { x: clamp(spot.x, 0, W), y: clamp(spot.y, 0, H) };
  /* Wide enough that the whole window is inside the shutter's clear middle
     when it is open, edge and all - otherwise the first frame of a fade is
     already grey in the far corner, which is a flinch rather than a fade. */
  const far = (Math.max(Math.hypot(at.x, at.y), Math.hypot(W - at.x, at.y),
    Math.hypot(at.x, H - at.y), Math.hypot(W - at.x, H - at.y)) + 40) / SOFT;
  shutFade.setAttribute('cx', at.x);
  shutFade.setAttribute('cy', at.y);
  shutRect.setAttribute('x', -60); shutRect.setAttribute('y', -60);
  shutRect.setAttribute('width', W + 120); shutRect.setAttribute('height', H + 120);
  coverPath.setAttribute('mask', 'url(#ringShutMask)');

  const began = performance.now();
  const step = now => {
    const t = Math.min(1, (now - began) / CLOSE);
    const e = t * t * (3 - 2 * t);
    const shut = from + (to - from) * e;
    shutFade.setAttribute('r', Math.max(.01, far * (1 - shut)).toFixed(2));
    if (t < 1) { coverRun = requestAnimationFrame(step); return; }
    /* Covered, so the mask has nothing left to say and is taken off before
       whatever comes next draws on the sheet. Clear, and it is the sheet that
       has nothing left to say: it is hidden on this frame rather than a frame
       later, because a frame of an unmasked sheet is a black window. */
    if (to >= .5) coverPath.removeAttribute('mask');
    else box.style.opacity = '0';
    if (done) done();
  };
  shutFade.setAttribute('r', (far * (1 - from)).toFixed(2));
  coverRun = requestAnimationFrame(step);
}

/* Kept under its old name because the way out of a module calls it from
   outside: the dark arriving is the same thing whichever door it is at. */
function blanket(go, done) { veil(go, 0, 1, done); }

/* The world is not a module, so clicking it does what clicking it does on the
   other front page: opens the atlas out to the whole window. The arrangement
   stands down while that lasts and is put back when you come home.

   Named rather than written where it is attached, because the switch can be
   thrown any number of times and the browser only drops a duplicate listener
   if it is the same function - which a fresh arrow written at the point of
   attachment never is. */
function wide() { location.hash = 'realm'; routeFromHash(); }

/*
 * Standing down while the atlas has the window, without taking the
 * arrangement off the body.
 *
 * This is not the switch being turned off, and the difference is the whole of
 * how the atlas opens out from here. In this arrangement the world is already
 * drawn over the whole window: opening it out is a change in what it is
 * showing, not in where it is. Taking the ring's layout off first - which is
 * what turning the switch off does - hands the frame back to the panel it
 * occupies on the other front page, and the journey out then starts from a
 * picture of that page, for the length of one frame, before growing out of
 * it. What is left on the body instead is the ring's own framing, so the
 * world is where it already was and only the writing round it goes.
 *
 * The column has no world to open out, so there it really is the switch.
 */
function aside(yes) {
  if (!on) return;
  if (yes && narrow()) { set(false, false); return; }
  /* Coming back only counts if it was actually away. Every arrival at the
     front page passes through here, and marking them all as returns from the
     map gave each of them the map's own length for a second and a half - so
     the first band opened after walking back out of a module crept. */
  const returning = !yes && stood;
  stood = yes;
  /* A class rather than another value of `data-ring`, so that everything the
     wide arrangement is laid out by stays true while it leaves: a band that
     has stopped being placed cannot glide anywhere. */
  document.body.classList.toggle('ring-away', yes);
  if (!yes) document.body.dataset.ring = narrow() ? 'list' : 'wheel';
  /* Coming back is slower than going, and waits a beat: what it is coming
     back over is a map putting itself away, and arriving on top of that would
     be two things moving at once with neither of them finished. */
  clearTimeout(coming);
  document.body.classList.toggle('ring-coming', returning);
  /* Dropped the moment the return has landed and not a breath later: while it
     is on, every band carries the journey's own length, so a module opened in
     the meantime stepped its neighbours aside over a second and a half. */
  if (returning) coming = setTimeout(() => document.body.classList.remove('ring-coming'), TRIP + 80);
  if (yes) rest();
}

function wake() {
  if (narrow()) return;
  planetOn = true;
  openAt = null;
  document.body.classList.add('ring-near');
  for (const one of parts) one.shut();
  nudge();                               // and the world begins to come forward
  spread();
  tellAtlasSize(false);
}
function rest() {
  planetOn = false;
  openAt = null;
  document.body.classList.remove('ring-near');
  if (parts) for (const one of parts) one.shut();
  nudge();
  spread();
  tellAtlasSize(false);
}

/*
 * `remember` is what separates a choice from a detour. Throwing the switch is
 * a choice and is kept; being taken off it - because the atlas was opened out
 * to the window, or because you went to a module - is a detour, and coming
 * home afterwards should put you back where you were.
 */
function set(want, remember) {
  if (want && !parts && !build()) return;
  const change = want !== on;
  on = want;
  /*
   * Written every time, not only on a change. The whole of the layout hangs
   * off these two attributes - the cards hidden, the atlas promoted from a
   * panel to the page, the corner row moved, and which of the two
   * arrangements the window is having - so if either ever drifted from `on`,
   * what you would get is the ordinary front page wearing half of this one.
   * Setting them again when they already say the right thing costs nothing
   * and takes that whole class of breakage away.
   */
  stood = false;
  document.body.dataset.home = on ? 'ring' : 'cards';
  document.body.dataset.ring = on ? (narrow() ? 'list' : 'wheel') : '';
  const stageBox = document.getElementById('ringStage');
  if (stageBox) stageBox.hidden = !on;
  const knob = document.getElementById('ringWay');
  if (knob) knob.setAttribute('aria-pressed', String(on));
  if (!change) return;
  document.body.classList.remove('ring-away');
  if (remember !== false) {
    try { localStorage.setItem('rotmg-home', on ? 'ring' : 'cards'); } catch (e) {}
  }

  if (on) {
    core.addEventListener('pointerenter', wake);
    core.addEventListener('pointerleave', rest);
    core.addEventListener('click', wide);
    /* A window dragged across the size where the arrangement gives way is not
       a resize the stylesheet can answer on its own: the atlas has to be put
       away or brought back with it. Same for a machine that gains or loses a
       cursor, which is a tablet being docked. */
    window.addEventListener('resize', fit);
    if (hoverless && hoverless.addEventListener) hoverless.addEventListener('change', fit);
    fit();
  } else {
    rest();
    window.removeEventListener('resize', fit);
    if (hoverless && hoverless.removeEventListener) hoverless.removeEventListener('change', fit);
    core.removeEventListener('pointerenter', wake);
    core.removeEventListener('pointerleave', rest);
    core.removeEventListener('click', wide);
    told = null;
    dressAtlas(want);                  // and one voice says what that means
    paceAtlas();
  }
}

/* What was chosen, last time anybody chose. */
function stored() {
  try { return localStorage.getItem('rotmg-home') === 'ring'; } catch (e) { return false; }
}

return {
  set,
  aside,
  /* What was gone through last, and the two halves of the way back into it. */
  went: () => went,
  blanket,
  grew,
  is: () => on,
  worldShare,
  wheel: () => on && !narrow(),
  /*
   * The front page, and not one of two.
   *
   * The cards and the switch that used to choose between them are still in
   * the file: they are what a copy with no ground beside it falls back on,
   * since the world is a folder of pictures and a folder cannot be carried
   * inside a single downloaded page. `pointAtAtlas` puts them back if the
   * ground turns out not to be there. Nothing else reaches them.
   *
   * What this settles is the thing that could not be had both ways: one
   * front page means one world, in one frame, and opening it out is that
   * frame changing what it shows rather than a second one arriving over the
   * first.
   */
  wanted: () => set(true, false),
  /* The atlas is loaded lazily and may arrive after the switch was thrown, so
     the size is said again once it is there. */
  greet: () => { told = null; tellAtlasSize(true); },
  fit
};
})();

/*
 * The switch, and what it remembers.
 *
 * A choice about which front page you want is a choice you make once, so it
 * is kept - but only for this browser, and the cards are still what an
 * arrival with nothing stored gets.
 */
{
  const knob = document.getElementById('ringWay');
  if (knob) knob.addEventListener('click', () => Ring.set(!Ring.is(), true));
}

/*
 * And the way back out of a module.
 *
 * "All tools" is the same journey read backwards, so it is taken the same
 * way: the page goes first, and only once it has is the arrangement put back
 * with the band it came out of standing at the size of the window, shrinking
 * into its place. Caught before the page's own handler for `data-go`, which
 * would otherwise have cut straight to it.
 */
document.addEventListener('click', event => {
  /* Not `Ring.is()`: the arrangement is off while a module has the page, and
     what says we came out of one is that a band was left standing open. */
  const back = event.target.closest('[data-go="home"]');
  if (!back || !Ring.went()) return;
  if (document.body.dataset.page === 'home') return;
  event.preventDefault();
  event.stopPropagation();
  const from = Ring.went();
  Ring.blanket(from, () => {
    location.hash = '';
    routeFromHash();
    Ring.grew(from);
  });
}, true);

/*
 * And the first route, from here rather than from the middle of the file.
 *
 * `var Ring` is hoisted but not assigned until the line above has run, so a
 * route taken any earlier asks `typeof Ring` and is told "undefined" - and
 * every guard in this file that offers the ring a say then quietly skips it.
 * That is survivable for a page that opens on the modules, which get built a
 * moment later anyway, and not at all for one that opens on the atlas: the
 * map goes looking for a front page that has not been made yet and settles
 * for the other one's panel, pinned across a window it does not fit.
 *
 * Nothing else here minds waiting. `load` is asynchronous and reads no part
 * of the page, and `bind` only attaches listeners to things that are already
 * in the document.
 *
 * And it never opens on the map.
 *
 * `#realm` is not a page somebody went to, it is the front page with the
 * world opened out on it - and shutting it does not take the address back,
 * because shutting it is not a move through the router. So the address is
 * left on the map long after the map has gone, and a reload on it dropped
 * you into a map with the arrangement standing aside behind it, which reads
 * as the page having failed to load. The front page is where a fresh page
 * starts, every time; the address is put straight on the way so that a
 * second reload says the same thing as the first.
 */
if (RealmRoutes.parse(location.hash).page === 'realm') {
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch (error) { /* a file:// copy, which may refuse - the route below still holds */ }
  showPage('home');
} else {
  routeFromHash();
}
