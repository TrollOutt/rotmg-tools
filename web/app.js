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
  itemSprites: {},
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
  return Math.round(value).toLocaleString('en-US');
}
function percent(value) {
  if (!(value > 0)) return '0%';
  if (value < 0.0001) return '<0.0001%';
  return `${value.toPrecision(4)}%`;
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
 * Artwork for an item, best source first:
 *   1. the item's own sprite (web/assets/items, see tools/fetch-item-sprites.js)
 *   2. the awakenable group artwork shipped with the Qt build
 * Returns null when we have neither, and the caller falls back to a slot icon.
 */
function itemArtUrl(name, awokenKey) {
  const own = state.itemSprites[name] || (awokenKey ? state.itemSprites[awokenKey] : null);
  if (own) return own;
  const group = itemSpriteName(awokenKey || name);
  return group ? asset('GUI Files', 'Awakenable Items', `${group}.png`) : null;
}

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
 * Which enchantments may be typed into a slot                         *
 * ------------------------------------------------------------------ */

// Item-level eligibility, ignoring what the other slots hold. Alien and Neo
// Alien are equipment families: an enchantment of one only goes on equipment of
// that same family, and no artifact stands in for the item. See
// EnchantEngine.NOTES.alienBase for how this parts company with the Qt source.
function eligibleForItem(mod, config) {
  // Only what the game will actually roll. Every pool the client defines asks
  // for ROLLABLE, including the default one; the handful that are not rollable
  // exist so an artifact can name one outright, and none can be aimed at.
  if (!mod.tags.has('ROLLABLE')) return false;
  if (!config.type || !mod.itemTags.has(config.type)) return false;
  if (mod.excludes.has('AWAKENED') && !(state.data.awakenings.get(config.item) || []).includes(mod.name)) return false;
  for (const requirement of mod.special) if (!config.subtypes.has(requirement)) return false;
  return true;
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
  if (!config.type || !mod.itemTags.has(config.type)) return null;
  if (mod.excludes.has('AWAKENED') && !(state.data.awakenings.get(config.item) || []).includes(mod.name)) return null;
  const missing = [...mod.special].filter(requirement => !config.subtypes.has(requirement));
  return missing.length ? missing : null;
}

// Directional rule: `candidate` survives after `prior` when none of the
// candidate's Incompatible Labels appears among the prior's Labels.
function follows(candidate, prior) {
  for (const label of candidate.excludes) if (prior.tags.has(label)) return false;
  return true;
}

/*
 * Can `mod` sit in `slot` given everything else already chosen?
 *  - against a locked slot the candidate must follow it;
 *  - a locked candidate must be followable by the wanted ones;
 *  - two wanted enchantments only need one workable rolling order, which the
 *    build planner then works out.
 */
function conflictWith(mod, slot, others) {
  for (const other of others) {
    if (other.index === slot.index || !other.name) continue;
    const otherMod = state.data.byName.get(other.name);
    if (!otherMod) continue;
    if (otherMod.name === mod.name) return { other: otherMod, reason: 'duplicate' };
    if (other.locked && !follows(mod, otherMod)) return { other: otherMod, reason: 'after-lock' };
    if (!other.locked && slot.locked && !follows(otherMod, mod)) return { other: otherMod, reason: 'before-wanted' };
    if (!other.locked && !slot.locked && !follows(mod, otherMod) && !follows(otherMod, mod)) return { other: otherMod, reason: 'mutual' };
  }
  return null;
}

function candidatesFor(slot, config) {
  const others = state.slots.filter(entry => entry.index !== slot.index);
  return state.data.enchants
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
  hint.hidden = visible > 0;
  hint.className = 'note';
  hint.textContent = 'Choose a rarity to reveal the enchantment slots.';
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

  const spriteSrc = itemArtUrl(resolved.name, resolved.awokenKey) || '';
  const typeSrc = resolved.type ? asset('GUI Files', 'Item Types', `${resolved.type.toLowerCase()}.png`) : '';
  const art = spriteSrc
    ? `<img src="${spriteSrc}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'item-art-fallback',textContent:'?'}))">`
    : typeSrc ? `<img class="as-type" src="${typeSrc}" alt="">` : '<span class="item-art-fallback">?</span>';

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
  const target = state.data.byName.get(config.desired);
  const tiered = Boolean(target && target.tags.has('TIERED'));
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
  // Nothing to say once it is running on its own and the answer is on screen.
  hint.hidden = ready;
  hint.textContent = overloaded
    ? 'The locked and wanted enchantments together need more slots than the item has.'
    : `Still missing: ${missing.join(', ')}.`;
  hint.className = `note${overloaded ? ' warn' : ''}`;
  return ready;
}

/* ------------------------------------------------------------------ *
 * Enchantment picker                                                  *
 * ------------------------------------------------------------------ */

function openPicker(index) {
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
  const term = query.trim().toLowerCase();
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

function closePicker() { $('pickerBackdrop').hidden = true; state.picker = null; }

/* ------------------------------------------------------------------ *
 * Item picker                                                         *
 * ------------------------------------------------------------------ */

// Sprite for an item row: its own artwork when we have it, otherwise the icon
// for its slot so the list still reads at a glance.
function itemArtHtml(resolved, name) {
  const src = itemArtUrl(name, resolved && resolved.awokenKey);
  if (src) return `<img class="picker-icon" src="${src}" alt="" loading="lazy" onerror="this.classList.add('missing')">`;
  if (resolved && resolved.type) {
    const src = asset('GUI Files', 'Item Types', `${resolved.type.toLowerCase()}.png`);
    if (src) return `<img class="picker-icon as-type" src="${src}" alt="" loading="lazy" onerror="this.classList.add('missing')">`;
  }
  return '<span class="picker-icon empty">?</span>';
}

function openItemPicker() {
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
  const term = query.trim().toLowerCase();
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
    const artA = itemArtUrl(a.name, a.resolved && a.resolved.awokenKey) ? 0 : 1;
    const artB = itemArtUrl(b.name, b.resolved && b.resolved.awokenKey) ? 0 : 1;
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

function allowedArtifacts() {
  return state.data.artifacts.filter(artifact => {
    const kind = artifactKind(artifact);
    return kind === 'none' || state.filters[kind];
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
  return `<div class="filter-chips" role="group" aria-label="Which artifacts you are willing to use">
    <span class="filter-caption">Artifacts</span>
    ${Object.keys(KIND_LABEL).map(kind => `
      <button type="button" class="filter-chip${state.filters[kind] ? ' on' : ''}" data-kind="${kind}"
        aria-pressed="${state.filters[kind]}">${KIND_LABEL[kind]} <b>${counts[kind]}</b></button>`).join('')}
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
      figure(goals.length, 'wanted, locked as they land'),
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
        <h3>Build the eligible pool</h3>
        <p>Start from the ${openPool.length} enchantments this ${html(config.type.toLowerCase())} can roll${config.item ? ' with the selected item' : ''}, then remove what the ${plural(config.locks.length, 'lock')} forbid.</p>
        <dl>
          <dt>Labels carried by the locks</dt><dd>${labels.length ? `<span class="chips">${labels.map(label => `<i class="chip give">${html(label)}</i>`).join('')}</span>` : '<span class="muted">none</span>'}</dd>
          <dt>Removed by those Labels or already locked</dt><dd>${removed.length}</dd>
          <dt>Remaining candidates</dt><dd><b>${pool.mods.length}</b></dd>
        </dl>
        ${removed.length ? `<details><summary>${removed.length} removed candidates</summary><p class="removed-list">${removed.map(mod => html(mod.name)).join(' · ')}</p></details>` : ''}
      </li>

      <li>
        <h3>Weight the pool for ${html(artifact.name)}</h3>
        <p>Each candidate keeps its base weight unless the artifact multiplies it. An artifact states several rules and every one that matches applies in turn, so two matching rules compound rather than compete. The result is truncated to an integer, as the game does.</p>
        <dl>
          <dt>Total weight of the pool</dt><dd><b>${count(pool.total)}</b></dd>
          <dt>${html(config.desired)}</dt><dd><b>${count(targetWeight)}</b>${targetWeight !== target.weight ? ` <span class="muted">(base ${count(target.weight)} × ${(targetWeight / target.weight).toFixed(2)})</span>` : ''}</dd>
        </dl>
        <details><summary>Heaviest candidates in the pool</summary><table class="mini"><tbody>${heaviest.map(mod => `<tr><td>${html(mod.name)}</td><td class="num">${count(pool.weights.get(mod.id))}</td><td class="num muted">${(pool.weights.get(mod.id) / pool.total * 100).toFixed(2)}%</td></tr>`).join('')}</tbody></table></details>
      </li>

      <li>
        <h3>One slot</h3>
        <p class="formula">${count(targetWeight)} ÷ ${count(pool.total)} = <b>${percent(perSlot)}</b></p>
      </li>

      <li>
        <h3>${plural(rolls, 'slot')} in one reroll</h3>
        <p>The slots are not independent: whatever the first slot rolls adds its Labels, which removes every remaining candidate that refuses them, and the mod itself leaves the pool. The engine enumerates every weighted path.</p>
        <dl>
          <dt>Exact chance over ${plural(rolls, 'slot')}</dt><dd><b>${percent(exact.odds)}</b>${exact.exact === false ? ' <span class="muted">(sampled)</span>' : ''}</dd>
          <dt>Naive 1 − (1 − p)<sup>${rolls}</sup></dt><dd class="muted">${percent(naive)} — ${naive > exact.odds ? 'too optimistic' : 'too pessimistic'}, because the pool shrinks between slots</dd>
          <dt>Tree size</dt><dd class="muted">${count(exact.nodes)} states enumerated</dd>
        </dl>
      </li>

      <li>
        <h3>Turn it into dust</h3>
        <p class="formula">
          one reroll = ${count(EnchantEngine.BASE_COSTS[config.slots])} base × 2<sup>${config.locks.length}</sup> = <b>${count(cost.perReroll)}</b> ${html(config.dust)}<br>
          mean rerolls = 100 ÷ ${exact.odds.toPrecision(4)} = <b>${count(cost.rerolls)}</b><br>
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

  const together = EnchantEngine.planSimultaneous(state.data, config, goals, { artifacts });
  const dust = amount => `${dustIcon(config.dust)}${count(amount)}`;

  const steps = plan.path.map((step, index) => {
    const last = index === plan.path.length - 1;
    const icon = artifactIcon(step.artifact.name);

    // What to do when the reroll lands something. Phrased as the instruction it
    // is, rather than as a probability the reader has to interpret.
    const outcome = step.likelyGain && step.likelyGain.length
      ? `<p class="plan-then"><b>When ${step.likelyGain.map(name => html(name)).join(' + ')} turns up</b> — the most likely useful result, ${percent(step.likelyChance)} of rerolls — lock it${last ? ' and you are done.' : ` and move to step ${index + 2}.`}</p>`
      : '';

    const decline = step.declined.length
      ? `<p class="plan-then warn"><b>Do not lock ${step.declined.map(entry => html(entry.name)).join(' or ')}</b> if it comes up alone here (${step.declined.map(entry => percent(entry.chance)).join(', ')} of rerolls). Locking it would double every reroll of the harder hunt for less than it saves. Throw it back and reroll.</p>`
      : '';

    const partial = step.throwsBack
      ? '<p class="plan-then">Some combined results are worth locking only in part — keep what the step is hunting, throw the rest back.</p>'
      : '';

    return `
      <li>
        <div class="plan-head">
          <span class="plan-step">${index + 1}</span>
          <div class="plan-goal">
            <b>Roll for ${step.pending.map(name => html(name)).join(' or ')}</b>
            <small>${step.locked.length ? `${step.locked.map(name => html(name)).join(' + ')} locked by now` : 'nothing locked yet'}</small>
          </div>
        </div>
        <div class="plan-use">
          <img src="${icon}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span>Use <b>${html(step.artifact.name)}</b></span>
        </div>
        <dl class="plan-figures">
          <div><dt>Useful reroll</dt><dd>${percent(step.progressChance)}</dd></div>
          <div><dt>Each reroll</dt><dd>${dust(step.perReroll)}</dd></div>
          <div><dt>Left to finish</dt><dd>${dust(step.expectedDustFromHere)}</dd></div>
        </dl>
        ${outcome}${decline}${partial}
      </li>`;
  }).join('');

  // Two honest ways to read the comparison: one at a time, or hold out for the
  // lot in a single reroll. The second is almost always worse, and saying by
  // how much is more useful than not mentioning it.
  const comparison = together
    ? `<p class="plan-compare">Holding out for all ${goals.length} in a single reroll instead: <b>${dust(together.dust)}</b> at ${percent(together.odds)} per reroll — ${together.dust > plan.dust ? `${count(together.dust - plan.dust)} more` : `${count(plan.dust - together.dust)} less`}.</p>`
    : '';

  output.innerHTML = `
    <div class="plan-total">
      <span class="figure strong"><b>${dust(plan.dust)}</b><small>expected ${html(config.dust)} dust for all ${plural(goals.length, 'enchantment')}</small></span>
      <span class="figure"><b>${count(plan.rerolls)}</b><small>rerolls in total</small></span>
    </div>
    ${comparison}
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

function hideResultCard(card) {
  if (card.hidden) return false;
  clearTimeout(card.swapTimer);
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

  $('slotList').addEventListener('click', event => {
    const pick = event.target.closest('[data-pick]');
    if (pick) { openPicker(Number(pick.dataset.pick)); return; }
    const remove = event.target.closest('[data-remove]');
    if (remove) { const slot = state.slots[Number(remove.dataset.remove) - 1]; slot.name = ''; slot.locked = false; refresh(); return; }
    const mode = event.target.closest('[data-mode]');
    if (mode) {
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
    const slot = state.slots[state.picker.index - 1];
    slot.name = row.dataset.name;
    closePicker();
    refresh();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('pickerBackdrop').hidden) closePicker(); });

  window.addEventListener('resize', handleAmbienceResize);
  $('reset').addEventListener('click', resetSetup);
  $('itemEmpty').addEventListener('click', openItemPicker);
  $('itemCard').addEventListener('click', event => {
    if (event.target.closest('#changeItem')) { openItemPicker(); return; }
    if (event.target.closest('#clearItem')) clearItem();
  });
  $('tabBar').addEventListener('click', event => {
    const close = event.target.closest('[data-close]');
    if (close) { event.stopPropagation(); closeTab(close.dataset.close); return; }
    if (event.target.closest('#tabAdd')) { addTab(); return; }
    const tab = event.target.closest('[data-tab]');
    if (tab) switchTab(tab.dataset.tab);
  });
  $('ambienceToggle').addEventListener('click', () => setAmbience($('ambienceToggle').getAttribute('aria-pressed') !== 'true'));
  $('summary').addEventListener('click', event => { if (event.target.id === 'showAudit') toggleAudit(); });
  $('auditClose').addEventListener('click', hideAudit);
  // A greyed row is an invitation: clicking it adds its group to the selection.
  $('results').addEventListener('click', event => {
    const row = event.target.closest('tr.off-group');
    if (row) enableKind(row.dataset.kind);
  });
  $('summary').addEventListener('click', event => {
    const chip = event.target.closest('[data-kind]');
    if (!chip) return;
    toggleKind(chip.dataset.kind);
  });

}

/* ------------------------------------------------------------------ *
 * Ambience: drifting realms behind the interface                      *
 * ------------------------------------------------------------------ */

/*
 * Each realm is one painting: a colour wash taken from the game's palette,
 * a scatter of the very sprites the calculator already carries, and a vignette.
 * Everything is blurred while it is drawn, so the browser stores a finished
 * bitmap and never has to filter anything again — changing realm is nothing
 * more than two opacities crossing, which the compositor does on the GPU.
 *
 * No new artwork is bundled: it is built from the sprites already embedded.
 */
const REALMS = [
  { name: 'The Realm',       sky: ['#2c5130', '#0e1a13'], glow: '#5ac45a' },
  { name: 'Undead Lair',     sky: ['#3d2758', '#140c1e'], glow: '#ca7aff' },
  { name: 'Ocean Trench',    sky: ['#164257', '#08171f'], glow: '#79c5e8' },
  { name: 'Abyss of Demons', sky: ['#552018', '#1c0a08'], glow: '#ff4542' },
  { name: 'The Shatters',    sky: ['#2a2c4f', '#0d0d1a'], glow: '#8854f0' },
  { name: 'Lost Halls',      sky: ['#443a1e', '#17120a'], glow: '#ffd026' },
  { name: 'The Nexus',       sky: ['#2a2840', '#0d0c15'], glow: '#ffabf2' },
  { name: 'Haunted Cemetery', sky: ['#1e2b26', '#080d0b'], glow: '#8fe07a' }
];

/*
 * Which realm a page sits in.
 *
 * The Nexus is where you choose what to do, so it is the way in. Fame Sweep is
 * about walking into dungeons that kill people, so it sits in the cemetery.
 * The calculator keeps drifting through all of them, which it always did.
 */
const PAGE_REALM = { home: 'The Nexus', fame: 'Haunted Cemetery' };

async function usePool(page) {
  // The Nexus is the room every portal opens into, so the way in gets them
  // too — under its own colours rather than the cemetery's.
  const wanted = (page === 'fame' || page === 'home') ? 'dungeon' : 'enchant';
  if (!ambience.enabled || ambience.pool === wanted) return;
  ambience.pool = wanted;
  const loaded = wanted === 'dungeon' ? await dungeonSprites() : await ambienceSprites();
  if (loaded.length) {
    ambience.sprites = loaded;
    if (ambience.layers && ambience.layers.length) repaintScatter(ambience.index);
  }
}

function pinRealm(page) {
  const wanted = PAGE_REALM[page];
  const index = wanted ? REALMS.findIndex(realm => realm.name === wanted) : -1;
  ambience.pinned = index >= 0 ? index : null;
  if (!ambience.layers || !ambience.layers.length) return;
  if (ambience.pinned !== null && ambience.index !== ambience.pinned) {
    ambience.index = ambience.pinned;
    weightAurora(ambience.index);
    repaintScatter(ambience.index);
    showRealm(ambience.index, false);
  }
}
// The colour mix is re-weighted often and fades slowly, so it reads as a
// continuous drift rather than a slideshow. The sprite scatter underneath is
// repainted far less often, because that one is a real change of picture.
const REALM_INTERVAL = 32 * 1000;
const SCATTER_INTERVAL = 100 * 1000;
const AMBIENCE_KEY = 'rotmg-enchant-calculator/ambience';

const ambience = {
  layers: [], front: 0, sprites: [], blobs: [],
  timer: null, scatterTimer: null,
  index: 0, enabled: true, canBlur: true, started: false, resizeTimer: null, labelTimer: null
};

// The scatter uses the enchantment icons: they are the most varied and the
// most recognisable of the sprites already in memory.
/*
 * What drifts in the background. Enchantment icons on the calculator, dungeon
 * portals on Fame Sweep — the page's own subject, out of focus.
 */
function loadSprites(sources) {
  return Promise.all(sources.map(src => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  }))).then(images => images.filter(Boolean));
}

async function fameSource() {
  if (ambience.fameText) return ambience.fameText;
  const bundled = BUNDLE && BUNDLE.sources && BUNDLE.sources.fameText;
  ambience.fameText = bundled
    || await fetch(ROOT + ['Fame', 'client-fame.txt'].map(esc).join('/'))
      .then(response => response.text()).catch(() => '');
  return ambience.fameText;
}

/*
 * The portals, at the format each one is actually stored in: eleven are
 * animated GIFs and the rest single PNGs. Asking for a .png every time
 * silently dropped exactly the ones worth having behind a moving page.
 */
async function dungeonSprites() {
  const info = await dungeonInfo();
  const sources = [];
  for (const [name, kind] of info) {
    const src = asset('GUI Files', 'Dungeon Icons', name + '.' + kind);
    if (src) sources.push(src);
  }
  return loadSprites(sources);
}

// name -> "gif" or "png", from data/Fame/dungeon-pages.txt.
async function dungeonInfo() {
  if (ambience.dungeonInfo) return ambience.dungeonInfo;
  const bundled = BUNDLE && BUNDLE.sources && BUNDLE.sources.dungeonText;
  const text = bundled
    || await fetch(ROOT + ['Fame', 'dungeon-pages.txt'].map(esc).join('/'))
      .then(response => response.text()).catch(() => '');
  const info = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('##')) continue;
    const parts = line.split('|');
    if (parts[0] && parts[2]) info.set(parts[0], parts[2]);
  }
  ambience.dungeonInfo = info;
  return info;
}

function ambienceSprites() {
  if (!state.data) return Promise.resolve([]);
  const seen = new Set();
  const sources = [];
  for (const mod of state.data.enchants) {
    const icon = enchantIcon(mod);
    if (!icon || seen.has(icon)) continue;
    seen.add(icon);
    const src = asset('GUI Files', 'Enchantment Icons', `${icon}.png`);
    if (src) sources.push(src);
  }
  return Promise.all(sources.map(src => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  }))).then(images => images.filter(Boolean));
}

function paintRealm(canvas, realm, seed) {
  const width = canvas.width, height = canvas.height;
  const ctx = canvas.getContext('2d');
  // A fixed seed per realm keeps a given realm looking like itself between
  // repaints, instead of reshuffling on every resize.
  let value = seed >>> 0;
  const random = () => ((value = (1664525 * value + 1013904223) >>> 0) / 4294967296);

  ctx.clearRect(0, 0, width, height);
  const sky = ctx.createLinearGradient(0, 0, width * 0.3, height);
  sky.addColorStop(0, realm.sky[0]);
  sky.addColorStop(1, realm.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // A couple of broad light pools, so the wash is not flat.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const x = width * (0.15 + random() * 0.7);
    const y = height * (0.1 + random() * 0.6);
    const r = Math.min(width, height) * (0.3 + random() * 0.35);
    const pool = ctx.createRadialGradient(x, y, 0, x, y, r);
    pool.addColorStop(0, `${realm.glow}7a`);
    pool.addColorStop(1, `${realm.glow}00`);
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = 'source-over';

  if (ambience.sprites.length) {
    if (ambience.canBlur) ctx.filter = 'blur(5px)';
    ctx.globalAlpha = 0.5;
    const count = 34;
    for (let i = 0; i < count; i++) {
      const sprite = ambience.sprites[Math.floor(random() * ambience.sprites.length)];
      const size = Math.min(width, height) * (0.07 + random() * 0.16);
      const x = random() * width - size / 2;
      const y = random() * height - size / 2;
      ctx.save();
      ctx.translate(x + size / 2, y + size / 2);
      ctx.rotate((random() - 0.5) * 0.7);
      ctx.globalAlpha = 0.34 + random() * 0.5;
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  // Darken the edges so the panels always sit on something quiet.
  const vignette = ctx.createRadialGradient(width / 2, height * 0.35, 0, width / 2, height * 0.5, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, 'rgba(13,12,19,0)');
  vignette.addColorStop(1, 'rgba(13,12,19,0.42)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

// One drifting blob per realm colour. They never stop moving; only their
// weights change, so the colour field is always somewhere between two realms
// rather than sitting on one.
function buildAurora(host) {
  const aurora = document.createElement('div');
  aurora.className = 'aurora';
  const paths = ['float-a', 'float-b', 'float-c', 'float-d'];
  ambience.blobs = REALMS.map((realm, index) => {
    const blob = document.createElement('span');
    blob.style.setProperty('--c', realm.glow);
    blob.style.left = `${(index * 137) % 70}%`;
    blob.style.top = `${(index * 89) % 60}%`;
    // Mismatched periods, so the combination never lands the same way twice.
    blob.style.animation = `${paths[index % paths.length]} ${34 + index * 9}s ease-in-out ${-index * 7}s infinite`;
    aurora.append(blob);
    return blob;
  });
  host.append(aurora);
}

// Weight the blobs around the current realm: its own colour leads, the two
// next to it stay faintly lit, everything else fades out.
function weightAurora(index) {
  const total = REALMS.length;
  ambience.blobs.forEach((blob, i) => {
    let distance = Math.abs(i - index);
    distance = Math.min(distance, total - distance);
    const opacity = distance === 0 ? 1 : distance === 1 ? 0.5 : distance === 2 ? 0.18 : 0;
    blob.style.opacity = String(opacity);
  });
}

function showRealm(index, announce) {
  const realm = REALMS[index % REALMS.length];
  weightAurora(index % REALMS.length);
  if (announce) {
    const label = $('realmName');
    label.textContent = realm.name;
    label.classList.add('show');
    clearTimeout(ambience.labelTimer);
    ambience.labelTimer = setTimeout(() => label.classList.remove('show'), 7000);
  }
}

// The sprite scatter is a genuine change of picture, so it cross-fades.
function scatterDom(seed) {
  let value = seed >>> 0;
  const random = () => ((value = (1664525 * value + 1013904223) >>> 0) / 4294967296);
  const pieces = [];
  for (let i = 0; i < 26; i++) {
    const sprite = ambience.sprites[Math.floor(random() * ambience.sprites.length)];
    if (!sprite || !sprite.src) continue;
    const size = 7 + random() * 16;
    pieces.push(`<img src="${sprite.src}" alt="" style="`
      + `left:${(random() * 104 - 2).toFixed(2)}%;top:${(random() * 104 - 2).toFixed(2)}%;`
      + `width:${size.toFixed(2)}vmin;opacity:${(0.3 + random() * 0.45).toFixed(2)};`
      + `transform:rotate(${((random() - 0.5) * 40).toFixed(1)}deg);`
      + `animation-duration:${(60 + random() * 90).toFixed(0)}s;`
      + `animation-delay:-${(random() * 90).toFixed(0)}s">`);
  }
  ambience.dom.innerHTML = pieces.join('');
}

function repaintScatter(index) {
  if (ambience.pool === 'dungeon' && ambience.dom) {
    ambience.dom.hidden = false;
    for (const canvas of ambience.layers) canvas.classList.remove('on');
    scatterDom((index + 1) * 2654435761);
    return;
  }
  if (ambience.dom) { ambience.dom.hidden = true; ambience.dom.innerHTML = ''; }
  const back = ambience.layers[1 - ambience.front];
  paintRealm(back, REALMS[index % REALMS.length], (index + 1) * 2654435761);
  back.classList.add('on', 'drift');
  ambience.layers[ambience.front].classList.remove('on');
  ambience.front = 1 - ambience.front;
}

function startAmbience() {
  const host = $('ambience');
  // Half resolution: the whole thing is blurred, so nobody can tell, and it
  // keeps the paint cheap on a laptop.
  const width = Math.min(1280, Math.round(window.innerWidth * 0.6)) || 960;
  const height = Math.min(800, Math.round(window.innerHeight * 0.6)) || 600;
  host.replaceChildren();
  ambience.layers = [0, 1].map(() => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    host.append(canvas);
    return canvas;
  });
  const probe = ambience.layers[0].getContext('2d');
  ambience.canBlur = typeof probe.filter === 'string';
  host.classList.toggle('css-blur', !ambience.canBlur);
  /*
   * A layer of real elements beside the canvases.
   *
   * A canvas draws the first frame of an animated portal and nothing after, so
   * the moving ones would sit still. These are ordinary images, blurred and
   * drifting by stylesheet, and they animate because the browser animates them.
   */
  ambience.dom = document.createElement('div');
  ambience.dom.className = 'ambience-dom';
  host.append(ambience.dom);
  buildAurora(host);

  ambience.front = 1;
  repaintScatter(ambience.index);
  weightAurora(ambience.index % REALMS.length);
  showRealm(ambience.index, false);
  ambience.started = true;

  clearInterval(ambience.timer);
  clearInterval(ambience.scatterTimer);
  ambience.timer = setInterval(() => {
    if (!ambience.enabled) return;
    if (ambience.pinned !== null && ambience.pinned !== undefined) return;
    ambience.index = (ambience.index + 1) % REALMS.length;
    showRealm(ambience.index, true);
  }, REALM_INTERVAL);
  ambience.scatterTimer = setInterval(() => {
    if (!ambience.enabled) return;
    if (ambience.pinned !== null && ambience.pinned !== undefined) return;
    repaintScatter(ambience.index);
  }, SCATTER_INTERVAL);
}

// A canvas stretched by CSS distorts when the window changes shape.
// object-fit keeps it honest while dragging; this repaints at the new size
// once the dragging stops, so the resolution matches again.
function handleAmbienceResize() {
  clearTimeout(ambience.resizeTimer);
  ambience.resizeTimer = setTimeout(() => {
    if (!ambience.enabled || !ambience.started) return;
    startAmbience();
  }, 250);
}

function setAmbience(enabled) {
  ambience.enabled = enabled;
  $('ambience').hidden = !enabled;
  $('ambienceToggle').setAttribute('aria-pressed', String(enabled));
  try { localStorage.setItem(AMBIENCE_KEY, enabled ? 'on' : 'off'); } catch (error) { /* not essential */ }
  if (enabled && !ambience.started) startAmbience();
}

async function initAmbience() {
  let enabled = true;
  try { enabled = localStorage.getItem(AMBIENCE_KEY) !== 'off'; } catch (error) { /* default on */ }
  $('ambienceToggle').setAttribute('aria-pressed', String(enabled));
  ambience.enabled = enabled;
  $('ambience').hidden = !enabled;
  if (!enabled) return;
  // Start on a random realm so two visitors do not see the same one.
  ambience.index = ambience.pinned !== null && ambience.pinned !== undefined
    ? ambience.pinned
    : Math.floor(Math.random() * REALMS.length);
  // Whichever set the page already asked for. Routing happens before the data
  // is read, so this runs second and must not undo the choice it made.
  if (!ambience.pool) ambience.pool = 'enchant';
  ambience.sprites = ambience.pool === 'dungeon'
    ? await dungeonSprites()
    : await ambienceSprites();
  startAmbience();
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
  state.slots.forEach(slot => { slot.name = ''; slot.locked = false; });
  if (Array.isArray(saved.slots)) {
    saved.slots.slice(0, 4).forEach((entry, index) => {
      if (!entry || !state.data.byName.has(entry.name)) return;
      state.slots[index].name = entry.name;
      state.slots[index].locked = Boolean(entry.locked);
    });
  }
  state.lastCardItem = saved.item || '';
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
  for (const tab of state.tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab${tab.id === state.activeTab ? ' active' : ''}`;
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === state.activeTab));
    button.title = tab.label;
    button.innerHTML = `<span class="tab-label">${html(tab.label)}</span>${state.tabs.length > 1 ? `<span class="tab-close" data-close="${tab.id}" role="button" aria-label="Close ${html(tab.label)}">×</span>` : ''}`;
    bar.append(button);
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

  const layout = document.querySelector('.layout');
  const from = state.tabs.findIndex(tab => tab.id === state.activeTab);
  const to = state.tabs.findIndex(tab => tab.id === id);
  layout.style.setProperty('--dir', to > from ? '1' : '-1');

  saveSetup();                 // bank the tab we are leaving
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

function clearItem() {
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


async function loadItemSprites() {
  if (BUNDLE) return BUNDLE.itemSprites || {};
  try {
    const index = await fetch('assets/items/index.json').then(response => response.json());
    const map = {};
    for (const [name, file] of Object.entries(index)) map[name] = 'assets/items/' + encodeURIComponent(file);
    return map;
  } catch (error) {
    return {};   // sprites are decoration; the calculator does not need them
  }
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

function renderClientNews(reading) {
  const line = $('status');
  if (!reading) {
    line.textContent = 'Game data from the enchantment documents';
    line.title = 'No game client has been read against these numbers yet.';
    return;
  }
  line.textContent = `Game data · client of ${newsDate(reading.date)} · build ${reading.build.slice(0, 8)}`;
  line.title = `Read from an installed RotMG client, build ${reading.build}.`;
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
function renderModifiedDate() {
  $('modifiedOn').textContent = BUNDLE && BUNDLE.built ? ` on ${BUNDLE.built}` : '';
}

function renderOfflineOffer() {
  const note = $('offlineCopy');
  if (!BUNDLE || !/^https?:$/.test(location.protocol)) { note.hidden = true; return; }
  note.hidden = false;
  note.innerHTML = '<a href="RotMG-Enchant-Calculator.html" download>Download this page</a> to keep it and use it offline — it is one self-contained file.';
}

async function load() {
  try {
    const sources = await readSources();
    state.data = EnchantEngine.buildDataset(sources);
    EnchantItems.loadClient(sources.clientItemText);
    state.itemSprites = await loadItemSprites();
    renderModifiedDate();
    $('itemEmptyCount').textContent = `Search ${knownItemNames().length.toLocaleString('en-US')} items — the slot, dust and base come with it`;
    initAmbience();
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
      ? 'This copy of index.html needs the local server. Use the single-file build (RotMG-Enchant-Calculator.html) to open it straight from disk.'
      : 'Could not read the original data files. Start the local server from the repository root (npm run dev).';
    $('status').classList.add('bad');
  }
}

/* ------------------------------------------------------------------ *
 * Which tool you are looking at                                       *
 * ------------------------------------------------------------------ *
 * Three pages behind one address, keyed on the hash so the browser own
 * back button works and a link can point straight at a tool. The
 * enchant calculator loads its data at startup either way — it is a
 * couple of hundred milliseconds and it means the page is ready when
 * you pick it. Fame Sweep loads its own the first time you open it.
 */
const PAGES = { home: 'pageHome', enchant: 'pageEnchant', fame: 'pageFame' };
let famePageReady = false;

async function openFamePage() {
  if (famePageReady) return;
  famePageReady = true;
  try {
    const bundled = BUNDLE && BUNDLE.sources;
    const text = bundled && bundled.fameText ? bundled.fameText
      : await fetch(ROOT + ['Fame', 'client-fame.txt'].map(esc).join('/')).then(response => response.text());
    const info = bundled && bundled.dungeonText ? bundled.dungeonText
      : await fetch(ROOT + ['Fame', 'dungeon-pages.txt'].map(esc).join('/')).then(response => response.text());
    const overrides = bundled && bundled.overrideText ? bundled.overrideText
      : await fetch(ROOT + ['Fame', 'availability-overrides.txt'].map(esc).join('/'))
        .then(response => response.text()).catch(() => '');
    // The standalone build carries the portal pictures inlined; served from
    // the repository they are read from disk like every other sprite.
    // Kept so the background can scatter the same portals the page shows.
    ambience.fameText = text;
    FamePage.init(text, BUNDLE ? BUNDLE.assets : null, info, overrides);
    usePool('fame');
  } catch (error) {
    console.error(error);
    famePageReady = false;
    $('fameSummary').innerHTML = '<p class="note warn">Could not read the fame bonuses.</p>';
  }
}

function showPage(name) {
  const page = PAGES[name] ? name : 'home';
  for (const [key, id] of Object.entries(PAGES)) $(id).hidden = key !== page;
  document.body.dataset.page = page;
  pinRealm(page);
  usePool(page);
  if (page === 'fame') openFamePage();
  window.scrollTo(0, 0);
}

function routeFromHash() {
  showPage(String(location.hash || '').replace(new RegExp('^#\\/?'), ''));
}

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
 */
for (const image of document.querySelectorAll('[data-art]')) {
  const [folder, file] = image.dataset.art.split('/');
  const src = asset('GUI Files', folder, file);
  if (src) image.src = src; else image.remove();
}

bind();
routeFromHash();
load();
