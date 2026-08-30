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

  const TICKS_KEY = 'rotmg-enchant-calculator/fame/done';
  const BASE_KEY = 'rotmg-enchant-calculator/fame/base';

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
    } catch (error) { /* private mode; the page works, it just forgets */ }
  }

  function load() {
    try {
      const ticks = JSON.parse(localStorage.getItem(TICKS_KEY) || '[]');
      if (Array.isArray(ticks)) state.done = new Set(ticks);
      state.base = Number(localStorage.getItem(BASE_KEY)) || 0;
    } catch (error) { state.done = new Set(); state.base = 0; }
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
    const row = (label, value, note, className) =>
      `<tr class="${className || ''}"><th>${html(label)}</th>`
      + `<td class="fame-num">${value}</td><td class="fame-note">${note || ''}</td></tr>`;

    const chosen = view.collections.filter(entry => state.focus.has(entry.id));
    const aiming = chosen.length
      ? chosen
      : view.collections.filter(entry => !entry.done && (!entry.seasonal || state.avail.has('seasonal')));

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
      : 'every collection left';

    $('fameTotals').innerHTML =
      row('Base fame', view.base ? count(view.base) : '—', 'what your experience earned')
      + row('Earned from dungeons', count(view.earnedFame),
        `${count(view.earnedFlat)} flat${view.earnedPercent ? ` + ${view.earnedPercent}%` : ''}`)
      + row('Fame now', count(view.total), '', 'is-sum')
      + row(`Finishing ${label}`, count(goal),
        wanted.size ? `${wanted.size} dungeons to go` : 'nothing left to do', 'is-gap')
      + row('You would have', count(view.total + goal), '', 'is-total');
  }

  /* ---------------------------------------------------------------- *
   * The collections, one of which you can be going for                *
   * ---------------------------------------------------------------- */
  function renderCollections(view) {
    const rows = view.collections
      .filter(entry => !entry.seasonal || state.avail.has('seasonal'))
      .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.missing.length - b.missing.length || b.value - a.value;
    });
    // One line each. The progress is the row itself, filled from the left,
    // so thirteen collections fit in the space four used to take.
    $('fameCollections').innerHTML = rows.map(entry => {
      const pct = Math.round(entry.have / entry.wanted.length * 100);
      return `
      <button type="button" class="fame-coll${entry.done ? ' is-done' : ''}${
        state.focus.has(entry.id) ? ' is-focus' : ''}" data-collection="${html(entry.id)}"
        aria-pressed="${state.focus.has(entry.id)}"
        style="--fill:${pct}%"
        title="${html(entry.name)} — ${entry.have} of ${entry.wanted.length} done, worth ${
          count(entry.absolute)} plus ${entry.relative}% of your base fame">
        <span class="fame-coll-name">${html(entry.name)}</span>
        <span class="fame-coll-worth">${
          view.base ? count(entry.value) : `${count(entry.absolute)}+${entry.relative}%`}</span>
        <span class="fame-coll-left">${entry.done ? '✓' : entry.missing.length}</span>
      </button>`;
    }).join('');
  }

  function renderNext(view) {
    const best = EnchantFame.nextBest(state.data, state.done, state.base, 4, state.avail);
    if (!best.length) {
      $('fameNext').innerHTML = '<p class="note">Every dungeon is ticked. There is nothing left to sweep.</p>';
      return;
    }
    $('fameNext').innerHTML = best.map(entry => `
      <button type="button" class="fame-next-row" data-tick="${html(entry.name)}">
        ${tile(entry.name, 'fame-next-icon')}
        <span class="fame-next-name">${html(entry.name)}</span>
        <span class="fame-next-gain">${count(entry.gain)}<small>fame</small></span>
        <small class="fame-next-why">${entry.unlocks.length
          ? `finishes ${entry.unlocks.map(u => html(u.name)).join(' and ')}`
          : 'first completion'}</small>
      </button>`).join('');
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

    $('fameGrid').innerHTML = rows.length ? rows.map(dungeon => {
      const on = state.done.has(dungeon.name);
      const needed = wanted ? wanted.has(dungeon.name) : false;
      const dimmed = wanted && !needed && !on;
      return `
        <button type="button" class="fame-tile${on ? ' is-done' : ''}${needed ? ' is-wanted' : ''}${
          dimmed ? ' is-dim' : ''}" data-dungeon="${html(dungeon.name)}"
          aria-pressed="${on}" title="${html(dungeon.name)}">
          ${tile(dungeon.name, 'fame-tile-art')}
          <span class="fame-tile-name">${html(dungeon.name)}</span>
          <span class="fame-tile-fame">+${count(EnchantFame.firstCompletion(dungeon))}</span>
          ${difficultyOf(dungeon.name)
            ? `<span class="fame-tile-diff" title="The game rates this dungeon ${difficultyOf(dungeon.name)} out of 10">${difficultyOf(dungeon.name)}</span>`
            : ''}
          ${on ? '<span class="fame-tile-check">✓</span>' : ''}
        </button>`;
    }).join('') : '<p class="note">No dungeon matches that.</p>';
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
      // A collection you can no longer see should not still be the focus.
      // A collection you can no longer see should not still be a goal.
      if (state.focus.size && !state.avail.has('seasonal')) {
        for (const entry of EnchantFame.summarise(state.data, state.done, state.base).collections) {
          if (entry.seasonal) state.focus.delete(entry.id);
        }
      }
      render();
    });
    $('fameReset').addEventListener('click', () => {
      state.done = new Set();
      save();
      render();
    });
    render();
  }

  return { init, render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FamePage;
