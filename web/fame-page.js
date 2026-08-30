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
    focus: null,          // the collection being worked towards, if any
    assets: null          // the standalone build's inlined pictures, if any
  };

  function spriteFor(name) {
    const key = SPRITES + '/' + name + '.png';
    if (state.assets) return state.assets[key] || null;
    return '../data/' + esc(SPRITES).replace(/%2F/g, '/') + '/' + esc(name) + '.png';
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
  function renderTotals(view) {
    const figure = (value, label, hint) =>
      `<span class="figure"${hint ? ` title="${html(hint)}"` : ''}><b>${value}</b><small>${html(label)}</small></span>`;
    $('fameTotals').innerHTML = [
      figure(count(view.earnedFame), 'earned',
        `${count(view.earnedFlat)} flat and ${view.earnedPercent}% of your base fame`),
      figure(count(view.remainingFame), 'still to take',
        `${count(view.remainingFlat)} flat and ${view.remainingPercent}% of your base fame`),
      figure(`${view.ticked}/${view.dungeons}`, 'dungeons')
    ].join('');
  }

  /* ---------------------------------------------------------------- *
   * The collections, one of which you can be going for                *
   * ---------------------------------------------------------------- */
  function renderCollections(view) {
    const rows = view.collections.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.missing.length - b.missing.length || b.value - a.value;
    });
    $('fameCollections').innerHTML = rows.map(entry => `
      <button type="button" class="fame-collection${entry.done ? ' is-done' : ''}${
        state.focus === entry.id ? ' is-focus' : ''}" data-collection="${html(entry.id)}"
        aria-pressed="${state.focus === entry.id}">
        <span class="fame-collection-head">
          <b>${html(entry.name)}</b>
          <span class="fame-collection-worth">${
            view.base ? count(entry.value) : `${count(entry.absolute)} + ${entry.relative}%`}</span>
        </span>
        <span class="fame-bar"><span style="width:${Math.round(entry.have / entry.wanted.length * 100)}%"></span></span>
        <span class="fame-collection-foot">
          <small>${entry.have}/${entry.wanted.length}</small>
          ${entry.done ? '<small class="fame-got">done</small>'
            : `<small class="fame-missing">${entry.missing.length} left</small>`}
        </span>
      </button>`).join('');
  }

  function renderNext(view) {
    const best = EnchantFame.nextBest(state.data, state.done, state.base, 4);
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
    const focus = state.focus ? view.collections.find(entry => entry.id === state.focus) : null;
    const wanted = focus ? new Set(focus.missing) : null;

    let rows = state.data.dungeons.filter(dungeon => !term || dungeon.name.toLowerCase().includes(term));
    if (state.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.sort === 'todo') {
      rows = rows.filter(dungeon => !state.done.has(dungeon.name));
      rows.sort((a, b) => EnchantFame.firstCompletion(b) - EnchantFame.firstCompletion(a));
    } else {
      // By fame: the game's own ranking of how hard a dungeon is, near enough.
      rows.sort((a, b) => EnchantFame.firstCompletion(b) - EnchantFame.firstCompletion(a)
        || a.name.localeCompare(b.name));
    }

    $('fameTickedCount').textContent = focus
      ? `${focus.name}: ${focus.missing.length} to go`
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

  function init(text, assets) {
    state.data = EnchantFame.parse(text);
    state.assets = assets || null;
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
      // Clicking the one you are already going for stops focusing.
      state.focus = state.focus === row.dataset.collection ? null : row.dataset.collection;
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
