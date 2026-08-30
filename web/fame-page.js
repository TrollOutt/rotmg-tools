/*
 * The Fame Sweep page.
 *
 * A grid of dungeon portals you click to tick off, and a list of collections
 * you can click to say which one you are going for — the grid then lights up
 * exactly the dungeons that collection still wants, and dims the rest.
 *
 * The point of picking one is that the last dungeon missing from a collection
 * is worth the whole collection. Wine Cellar on its own is 100 fame; as the
 * twelfth of Tunnel Rat it is nearly four thousand.
 *
 * The calculation lives in fame.js; this file is only what you see.
 */
var FamePage = (function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const html = value => String(value).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const count = value => Math.round(Number(value) || 0).toLocaleString('en-US');

  /*
   * Put markup in a panel, and let its contents rise into place only when they
   * are genuinely new.
   *
   * Every click re-renders all four panels, so animating on each paint would
   * make the whole page flinch each time a dungeon is ticked. The signature is
   * whatever the caller decides makes this panel a different panel: the list
   * of names for the grid, the numbers themselves for the totals. Same
   * signature, no animation — the markup is simply replaced.
   */
  const painted = new Map();
  function paint(id, markup, signature) {
    const node = $(id);
    const last = painted.get(id);
    // Identical markup is not written at all. Replacing it costs nothing on
    // paper and everything in practice: the portal GIFs start over and the
    // panel blinks, which is the flicker without even the animation.
    if (last && last.signature === signature && last.markup === markup) return;
    node.innerHTML = markup;
    painted.set(id, { markup, signature });
    if (last && last.signature === signature) return;
    node.classList.remove('is-fresh');
    void node.offsetWidth;                  // so the animation restarts
    node.classList.add('is-fresh');
  }
  const alreadyShowing = (id, signature) => {
    const last = painted.get(id);
    return Boolean(last) && last.signature === signature;
  };

  /*
   * Shrink the tiles until the whole grid fits, rather than making someone
   * scroll a list of seventy-six things to find one.
   *
   * Everything about a tile comes off --tile, so this only has to find the
   * largest value that fits and set it. Binary search over eight steps: each
   * one costs a layout, which is why it runs when the grid is rebuilt and on
   * a resize, not on every tick. If even the smallest will not fit — a short
   * window with every dungeon showing — the grid scrolls as it used to, which
   * is better than tiles too small to read.
   */
  // The size these were drawn to be looked at. Filling every last pixel of a
  // tall window is not worth a grid of tiles larger than that.
  const TILE_MAX = 104;
  const TILE_MIN = 54;
  function fitGrid() {
    const grid = $('fameGrid');
    if (!grid.firstElementChild) return;
    // On a wide screen the grid is given the height left in its column, and
    // clientHeight is that height whatever is in it. Where it is capped
    // instead — a short window, a narrow one — the cap is the room there is.
    const room = Math.max(grid.clientHeight, parseFloat(getComputedStyle(grid).maxHeight) || 0);
    if (!room) return;

    // Measured with the overflow off, for browsers that do not reserve the
    // scrollbar gutter: a bar that comes and goes narrows the box, and the
    // search would be chasing a layout that moves when it is measured.
    grid.style.overflowY = 'hidden';
    const fits = size => {
      grid.style.setProperty('--tile', size + 'px');
      return grid.scrollHeight <= room + 1;
    };

    let best = TILE_MAX;
    if (!fits(TILE_MAX)) {
      best = TILE_MIN;
      let low = TILE_MIN, high = TILE_MAX;
      for (let step = 0; step < 8; step++) {
        const mid = (low + high) / 2;
        if (fits(mid)) { best = mid; low = mid; } else high = mid;
      }
    }
    grid.style.setProperty('--tile', best + 'px');
    grid.style.overflowY = '';
  }

  /*
   * Whether a collection is worth showing at all.
   *
   * It is if you could finish it with the dungeons currently in view. One
   * seasonal dungeon still outstanding is enough to put a collection out of
   * reach while seasonal content is hidden, however ordinary the other
   * eleven are — and turning the chip back on brings it back. A finished one
   * always stays: there is nothing left to be blocked by.
   */
  const reachable = entry => entry.done || entry.needs.every(kind => state.avail.has(kind));

  const TICKS_KEY = 'rotmg-enchant-calculator/fame/done';
  const BASE_KEY = 'rotmg-enchant-calculator/fame/base';
  const SKIP_KEY = 'rotmg-enchant-calculator/fame/skipped';

  // Where the portal pictures live. Three of the seventy-six are not drawn on
  // the page they come from, and those tiles carry the name alone.
  const SPRITES = 'GUI Files/Dungeon Icons';
  const esc = value => encodeURIComponent(String(value)).replace(/'/g, '%27');

  const state = {
    data: null,
    done: new Set(),
    base: 0,
    search: '',
    sort: 'fame',
    focus: new Set(),     // the collections being worked towards, if any
    // Dungeons the player has said they are not doing. Not ticked — refusing
    // one earns nothing — just never offered under "do this next" again.
    skipped: new Set(),
    // Which dungeons count. Only the ones in the realm all year, to begin
    // with: the seasonal and event ones cannot be planned for, and eleven of
    // the event ones are in no collection at all.
    avail: new Set(['standard']),
    assets: null,         // the standalone build's inlined pictures, if any
    info: new Map()       // difficulty and picture format, per dungeon
  };

  // The portal is a GIF where the game draws it moving, a PNG otherwise; which
  // is which comes from data/Fame/dungeon-pages.txt rather than being guessed.
  function spriteFor(name) {
    const kind = (state.info.get(name) || {}).picture || 'png';
    const key = SPRITES + '/' + name + '.' + kind;
    if (state.assets) return state.assets[key] || null;
    return '../data/' + esc(SPRITES).replace(/%2F/g, '/') + '/' + esc(name) + '.' + kind;
  }

  function difficultyOf(name) {
    const entry = state.info.get(name);
    return entry && entry.difficulty ? entry.difficulty : null;
  }

  function save() {
    try {
      localStorage.setItem(TICKS_KEY, JSON.stringify([...state.done]));
      localStorage.setItem(BASE_KEY, String(state.base));
      localStorage.setItem(SKIP_KEY, JSON.stringify([...state.skipped]));
    } catch (error) { /* private mode; the page works, it just forgets */ }
  }

  function load() {
    try {
      const ticks = JSON.parse(localStorage.getItem(TICKS_KEY) || '[]');
      if (Array.isArray(ticks)) state.done = new Set(ticks);
      const skipped = JSON.parse(localStorage.getItem(SKIP_KEY) || '[]');
      if (Array.isArray(skipped)) state.skipped = new Set(skipped);
      state.base = Number(localStorage.getItem(BASE_KEY)) || 0;
    } catch (error) { state.done = new Set(); state.skipped = new Set(); state.base = 0; }
  }

  /* ---------------------------------------------------------------- *
   * The running total, along the top                                  *
   * ---------------------------------------------------------------- */
  /*
   * The sum, read down the way a sum is read.
   *
   * The last line is what the collections you picked would bring, not what
   * sweeping all seventy-six would: nobody plans to do everything, and a
   * total that assumes it is a number you cannot act on. With nothing
   * picked it falls back to every collection you can currently see.
   */
  function renderTotals(view) {
    let index = 0;
    const row = (label, value, note, className) =>
      `<tr class="${className || ''}" style="--i:${index++}"><th>${html(label)}</th>`
      + `<td class="fame-num">${value}</td><td class="fame-note">${note || ''}</td></tr>`;

    const chosen = view.collections.filter(entry => state.focus.has(entry.id));
    const aiming = chosen.length
      ? chosen
      : view.collections.filter(entry => !entry.done && reachable(entry));

    // What finishing them costs and pays: the collections themselves, plus
    // the first completion of every dungeon they still want.
    const wanted = new Set(aiming.flatMap(entry => entry.missing));
    let goal = 0;
    for (const entry of aiming) if (!entry.done) goal += entry.value;
    for (const name of wanted) {
      const dungeon = state.data.byName.get(name);
      if (dungeon) goal += EnchantFame.firstCompletion(dungeon);
    }

    const label = chosen.length === 1 ? chosen[0].name
      : chosen.length ? `the ${chosen.length} you picked`
      : aiming.length ? 'every collection left'
      : 'a collection';

    // The sum runs again whenever a figure in it moves, which is the one
    // thing a running total is for.
    paint('fameTotals',
      row('Base fame', view.base ? count(view.base) : '—', 'what your experience earned')
      + row('Maxed 8/8', count(view.maxedFame),
        `${count(view.maxed.flat)} flat + ${view.maxed.percent}%`)
      + row('Earned from dungeons', count(view.earnedFame),
        `${count(view.earnedFlat)} flat${view.earnedPercent ? ` + ${view.earnedPercent}%` : ''}`)
      + row('Fame now', count(view.total), '', 'is-sum')
      + row(`Finishing ${label}`, count(goal),
        wanted.size ? `${wanted.size} dungeons to go`
        : aiming.length ? 'nothing left to do'
        : 'none is in reach of what is showing', 'is-gap')
      + row('You would have', count(view.total + goal), '', 'is-total'),
      [view.base, view.earnedFame, view.total, label, goal, wanted.size].join('|'));
  }

  /* ---------------------------------------------------------------- *
   * The collections, one of which you can be going for                *
   * ---------------------------------------------------------------- */
  function renderCollections(view) {
    const rows = view.collections.filter(reachable);

    /*
     * This list holds still. Nothing you do on this page rebuilds it.
     *
     * It is keyed on which collections are in it, not on the order they are
     * in, so ticking a dungeon — which changes how many each one is missing,
     * and would otherwise re-sort the whole column under the cursor — only
     * moves the numbers and the bars on the rows already there. The order is
     * decided once, when the list is built: on the first paint, and again
     * only when the set changes, which is the seasonal or event chips.
     *
     * A collection finished mid-session therefore stays where it is rather
     * than dropping to the bottom. It greys out and takes a tick, which says
     * the same thing without moving anything you were about to click.
     */
    const signature = rows.map(entry => entry.id).sort().join('|');
    const list = $('fameCollections');
    if (rows.length && alreadyShowing('fameCollections', signature)) {
      const byId = new Map(rows.map(entry => [entry.id, entry]));
      for (const row of list.children) {
        const entry = byId.get(row.dataset.collection);
        if (!entry) continue;
        row.classList.toggle('is-done', entry.done);
        row.classList.toggle('is-focus', state.focus.has(entry.id));
        row.setAttribute('aria-pressed', String(state.focus.has(entry.id)));
        row.style.setProperty('--fill', Math.round(entry.have / entry.wanted.length * 100) + '%');
        row.lastElementChild.textContent = entry.done ? '✓' : entry.missing.length;
      }
      return;
    }

    if (!rows.length) {
      // Every collection wants something that is not showing. Saying so beats
      // an empty panel under an invitation to click one of them.
      paint('fameCollections',
        '<p class="note">No collection can be finished with only these dungeons showing.</p>',
        signature);
      return;
    }

    // Sorted only here, where the list is actually being built: what is
    // nearly finished first, what is finished last.
    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.missing.length - b.missing.length || b.value - a.value;
    });

    // One line each. The progress is the row itself, filled from the left,
    // so thirteen collections fit in the space four used to take.
    paint('fameCollections', rows.map((entry, index) => {
      const pct = Math.round(entry.have / entry.wanted.length * 100);
      return `
      <button type="button" class="fame-coll${entry.done ? ' is-done' : ''}${
        state.focus.has(entry.id) ? ' is-focus' : ''}" data-collection="${html(entry.id)}"
        aria-pressed="${state.focus.has(entry.id)}"
        style="--fill:${pct}%; --i:${index}"
        title="${html(entry.name)} — ${entry.have} of ${entry.wanted.length} done, worth ${
          count(entry.absolute)} plus ${entry.relative}% of your base fame">
        <span class="fame-coll-name">${html(entry.name)}</span>
        <span class="fame-coll-worth">${count(entry.absolute)}<small>+${entry.relative}%</small></span>
        <span class="fame-coll-left">${entry.done ? '✓' : entry.missing.length}</span>
      </button>`;
    }).join(''), signature);
  }

  function renderNext(view) {
    const best = EnchantFame.nextBest(state.data, state.done, state.base, 4, state.avail, state.skipped);

    /*
     * The ones set aside. A dungeon nobody intends to run is worse than
     * useless at the top of a list of what to run next, so it can be taken
     * off — and put back, because the reason was probably "not tonight".
     */
    const aside = state.skipped.size
      ? `<button type="button" class="fame-next-restore" data-restore="all">${
        state.skipped.size} set aside — put ${state.skipped.size === 1 ? 'it' : 'them'} back</button>`
      : '';

    if (!best.length) {
      paint('fameNext', `<p class="note">${state.skipped.size
        ? 'Nothing left that you have not set aside.'
        : 'Every dungeon is ticked. There is nothing left to sweep.'}</p>${aside}`,
      'none' + state.skipped.size);
      return;
    }
    /*
     * The fame shown is the dungeon's own first completion — the Scout bonus,
     * the one number the game pays you on the way out. What earns a dungeon
     * its place in this list is said in words underneath instead, because it
     * is a claim on collections not finished yet rather than fame in hand.
     */
    const names = list => list.slice(0, 2).map(entry => html(entry.name)).join(' and ')
      + (list.length > 2 ? ` +${list.length - 2} more` : '');

    // Advice that has changed is worth a second look, so this one plays
    // whenever the four names are not the four that were there before.
    // A row is two controls, not one: the dungeon itself, and the small refusal
    // beside it. Nested buttons are not allowed, hence the wrapper.
    paint('fameNext', best.map((entry, index) => `
      <div class="fame-next-row" style="--i:${index}">
        <button type="button" class="fame-next-pick" data-tick="${html(entry.name)}">
          ${tile(entry.name, 'fame-next-icon')}
          <span class="fame-next-name">${html(entry.name)}</span>
          <span class="fame-next-gain">${count(entry.first)}<small>fame</small></span>
          <small class="fame-next-why">${entry.unlocks.length
            ? `finishes ${names(entry.unlocks)}`
            : entry.towards.length ? `counts towards ${names(entry.towards)}`
            : 'in no collection'}</small>
        </button>
        <button type="button" class="fame-next-skip" data-skip="${html(entry.name)}"
          title="Not this one — take it off the list" aria-label="Take ${html(entry.name)} off the list">✕</button>
      </div>`).join('') + aside,
      // Sorted, not in the order shown: ticking a dungeon somewhere else in
      // the realm shuffles what these four are worth relative to each other,
      // and the same four in a different order is not new advice. The list
      // plays when one of them leaves it and another takes its place.
      best.map(entry => entry.name).sort().join('|') + '#' + state.skipped.size);
  }

  /* ---------------------------------------------------------------- *
   * The grid                                                          *
   * ---------------------------------------------------------------- */
  // Three of the seventy-six are not drawn on the page the pictures come from.
  // On failure the image is swapped for a transparent pixel so the tile keeps
  // its shape and shows a plain block rather than the browser's broken glyph.
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  function tile(name, className) {
    const src = spriteFor(name);
    if (!src) return `<span class="${className} no-art"></span>`;
    return `<img class="${className}" src="${src}" alt="" loading="lazy"`
      + ` onerror="this.classList.add('no-art');this.src='${BLANK}'">`;
  }

  function renderGrid(view) {
    const term = state.search.trim().toLowerCase();
    // Several collections can be the goal at once; the grid lights up
    // everything any of them still wants.
    const chosen = view.collections.filter(entry => state.focus.has(entry.id));
    const wanted = chosen.length ? new Set(chosen.flatMap(entry => entry.missing)) : null;

    let rows = state.data.dungeons
      .filter(dungeon => state.avail.has(dungeon.availability))
      .filter(dungeon => !term || dungeon.name.toLowerCase().includes(term));
    if (state.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.sort === 'hard') {
      // The game's own rating, 1 to 10, off each dungeon's wiki page. Easiest
      // first, because that is the order you would actually do them in.
      rows.sort((a, b) => (difficultyOf(a.name) || 99) - (difficultyOf(b.name) || 99)
        || a.name.localeCompare(b.name));
    }
    else if (state.sort === 'todo') {
      rows = rows.filter(dungeon => !state.done.has(dungeon.name));
      rows.sort((a, b) => EnchantFame.firstCompletion(b) - EnchantFame.firstCompletion(a));
    } else {
      // By fame: the game's own ranking of how hard a dungeon is, near enough.
      rows.sort((a, b) => EnchantFame.firstCompletion(b) - EnchantFame.firstCompletion(a)
        || a.name.localeCompare(b.name));
    }

    $('fameTickedCount').textContent = chosen.length
      ? `${wanted.size} to go for ${chosen.length === 1 ? chosen[0].name : chosen.length + ' collections'}`
      : `${state.done.size} of ${state.data.dungeons.length} ticked`;

    /*
     * Picking a collection does not rebuild the grid.
     *
     * The same dungeons in the same order means only the highlight moved, and
     * rewriting sixty-three tiles to move a highlight throws away the elements
     * the browser was about to transition — the glow cannot fade in on
     * something that did not exist a moment ago. So the classes are moved on
     * the tiles that are already there, and the grid is only rebuilt when its
     * contents genuinely change: a search, a sort, a different availability.
     */
    const signature = rows.map(dungeon => dungeon.name).join('|');
    const grid = $('fameGrid');
    if (rows.length && alreadyShowing('fameGrid', signature)) {
      for (const tile of grid.children) {
        const name = tile.dataset.dungeon;
        if (!name) continue;
        const on = state.done.has(name);
        const needed = wanted ? wanted.has(name) : false;
        tile.classList.toggle('is-done', on);
        tile.classList.toggle('is-wanted', needed);
        tile.classList.toggle('is-dim', Boolean(wanted) && !needed && !on);
        tile.setAttribute('aria-pressed', String(on));
      }
      return;
    }

    paint('fameGrid', rows.length ? rows.map((dungeon, index) => {
      const on = state.done.has(dungeon.name);
      const needed = wanted ? wanted.has(dungeon.name) : false;
      const dimmed = wanted && !needed && !on;
      return `
        <button type="button" class="fame-tile${on ? ' is-done' : ''}${needed ? ' is-wanted' : ''}${
          dimmed ? ' is-dim' : ''}" data-dungeon="${html(dungeon.name)}" style="--i:${index}"
          aria-pressed="${on}" title="${html(dungeon.name)} — ${
            count(EnchantFame.firstCompletion(dungeon))} fame the first time${difficultyOf(dungeon.name)
            ? `, rated ${difficultyOf(dungeon.name)} out of 10` : ''}">
          ${tile(dungeon.name, 'fame-tile-art')}
          <span class="fame-tile-name">${html(dungeon.name)}</span>
          <span class="fame-tile-check">✓</span>
        </button>`;
    }).join('') : '<p class="note">No dungeon matches that.</p>', signature);
    fitGrid();
  }

  function render() {
    if (!state.data) return;
    const view = EnchantFame.summarise(state.data, state.done, state.base);
    renderTotals(view);
    renderCollections(view);
    renderNext(view);
    renderGrid(view);
  }

  function toggle(name) {
    if (state.done.has(name)) state.done.delete(name); else state.done.add(name);
    save();
    render();
  }

  function init(text, assets, dungeonInfo, overrides) {
    state.data = EnchantFame.parse(text, overrides);
    state.assets = assets || null;
    for (const raw of String(dungeonInfo || '').replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const [name, difficulty, picture] = line.split('|');
      state.info.set(name, { difficulty: Number(difficulty) || 0, picture: picture || 'png' });
    }
    load();
    $('fameBase').value = state.base || '';

    $('fameBase').addEventListener('input', event => {
      state.base = Number(event.target.value) || 0;
      save();
      render();
    });
    $('fameSearch').addEventListener('input', event => {
      state.search = event.target.value;
      render();
    });
    $('fameGrid').addEventListener('click', event => {
      const tile = event.target.closest('[data-dungeon]');
      if (tile) toggle(tile.dataset.dungeon);
    });
    $('fameNext').addEventListener('click', event => {
      if (event.target.closest('[data-restore]')) {
        state.skipped.clear();
        save();
        render();
        return;
      }
      const refused = event.target.closest('[data-skip]');
      if (refused) {
        state.skipped.add(refused.dataset.skip);
        save();
        render();
        return;
      }
      const row = event.target.closest('[data-tick]');
      if (row) toggle(row.dataset.tick);
    });
    $('fameCollections').addEventListener('click', event => {
      const row = event.target.closest('[data-collection]');
      if (!row) return;
      // Clicking one you are already going for drops it.
      const id = row.dataset.collection;
      if (state.focus.has(id)) state.focus.delete(id); else state.focus.add(id);
      render();
    });
    document.querySelector('.fame-sort').addEventListener('click', event => {
      const button = event.target.closest('[data-sort]');
      if (!button) return;
      state.sort = button.dataset.sort;
      for (const chip of document.querySelectorAll('.fame-sort [data-sort]')) {
        chip.classList.toggle('on', chip === button);
      }
      render();
    });
    document.querySelector('.fame-avail').addEventListener('click', event => {
      const button = event.target.closest('[data-avail]');
      if (!button) return;
      const kind = button.dataset.avail;
      // Never all off: an empty grid is a broken page, not a filter.
      if (state.avail.has(kind) && state.avail.size > 1) state.avail.delete(kind);
      else state.avail.add(kind);
      button.classList.toggle('on', state.avail.has(kind));
      // A collection you could no longer finish should not still be a goal.
      if (state.focus.size) {
        for (const entry of EnchantFame.summarise(state.data, state.done, state.base).collections) {
          if (!reachable(entry)) state.focus.delete(entry.id);
        }
      }
      render();
    });
    // The box changes size with the window, so the fit has to be found again.
    let resizeWait = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeWait);
      resizeWait = requestAnimationFrame(fitGrid);
    });

    $('fameReset').addEventListener('click', () => {
      state.done = new Set();
      // The dungeons set aside go too. Leaving them would be state the page
      // no longer shows anywhere, quietly shortening the suggestions.
      state.skipped = new Set();
      save();
      render();
    });
    render();
  }

  return { init, render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FamePage;
