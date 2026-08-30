/*
 * The Fame Sweep page.
 *
 * Tick the dungeons you have finished at least once. It works out what that is
 * already worth, what the unfinished collections would add, and which single
 * dungeon pays the most next — which is usually the last one missing from a
 * collection, and worth a hundred times its own completion.
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

  const state = { data: null, done: new Set(), base: 0, search: '' };

  function save() {
    try {
      localStorage.setItem(TICKS_KEY, JSON.stringify([...state.done]));
      localStorage.setItem(BASE_KEY, String(state.base));
    } catch (error) { /* private mode; the page still works, it just forgets */ }
  }

  function load() {
    try {
      const ticks = JSON.parse(localStorage.getItem(TICKS_KEY) || '[]');
      if (Array.isArray(ticks)) state.done = new Set(ticks);
      state.base = Number(localStorage.getItem(BASE_KEY)) || 0;
    } catch (error) { state.done = new Set(); state.base = 0; }
  }

  const figure = (value, label, hint) =>
    `<span class="figure"${hint ? ` title="${html(hint)}"` : ''}><b>${value}</b><small>${html(label)}</small></span>`;

  function renderSummary(view) {
    // The percentages are shown next to the fame they come to, because at a
    // low base a large percentage is worth less than a small flat bonus and
    // the ranking below depends on which.
    $('fameSummary').innerHTML = `
      <div class="summary-figures">
        ${figure(count(view.earnedFame), 'fame earned so far',
          `${count(view.earnedFlat)} flat and ${view.earnedPercent}% of your base fame`)}
        ${figure(count(view.remainingFame), 'still on the table',
          `${count(view.remainingFlat)} flat and ${view.remainingPercent}% of your base fame`)}
        ${figure(`${view.ticked}/${view.dungeons}`, 'dungeons ticked')}
      </div>
      <p class="note">${view.base
        ? `A base of ${count(view.base)} makes the unfinished collections worth ${count(view.remainingFame - view.remainingFlat)} on their own.`
        : 'Type your base fame above and the percentages become fame.'}</p>`;
  }

  function renderNext(view) {
    const best = EnchantFame.nextBest(state.data, state.done, state.base, 5);
    if (!best.length) {
      $('fameNext').innerHTML = '<p class="note">Every dungeon is ticked. There is nothing left to sweep.</p>';
      return;
    }
    $('fameNext').innerHTML = best.map(entry => `
      <button type="button" class="fame-next-row" data-tick="${html(entry.name)}">
        <span class="fame-next-name">${html(entry.name)}</span>
        <span class="fame-next-gain">${count(entry.gain)}<small>fame</small></span>
        ${entry.unlocks.length
          ? `<small class="fame-next-why">finishes ${entry.unlocks.map(u => html(u.name)).join(' and ')}</small>`
          : `<small class="fame-next-why">first completion</small>`}
      </button>`).join('');
  }

  function renderCollections(view) {
    const rows = view.collections.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;      // unfinished first
      return a.missing.length - b.missing.length || b.value - a.value;
    });
    $('fameCollections').innerHTML = rows.map(entry => `
      <div class="fame-collection${entry.done ? ' is-done' : ''}">
        <div class="fame-collection-head">
          <b>${html(entry.name)}</b>
          <span class="fame-collection-worth">${count(entry.absolute)} + ${entry.relative}%${
            view.base ? ` <em>= ${count(entry.value)}</em>` : ''}</span>
        </div>
        <div class="fame-bar"><span style="width:${Math.round(entry.have / entry.wanted.length * 100)}%"></span></div>
        <div class="fame-collection-foot">
          <small>${entry.have}/${entry.wanted.length}</small>
          ${entry.done
            ? '<small class="fame-got">done</small>'
            : `<small class="fame-missing">${entry.missing.slice(0, 4).map(html).join(', ')}${
                entry.missing.length > 4 ? ` and ${entry.missing.length - 4} more` : ''}</small>`}
        </div>
      </div>`).join('');
  }

  function renderDungeons() {
    const term = state.search.trim().toLowerCase();
    const rows = state.data.dungeons.filter(dungeon => !term || dungeon.name.toLowerCase().includes(term));
    $('fameTickedCount').textContent = `${state.done.size} of ${state.data.dungeons.length} ticked`;
    $('fameDungeons').innerHTML = rows.length ? rows.map(dungeon => {
      const on = state.done.has(dungeon.name);
      const first = EnchantFame.firstCompletion(dungeon);
      return `
        <label class="fame-dungeon${on ? ' is-on' : ''}">
          <input type="checkbox" data-dungeon="${html(dungeon.name)}"${on ? ' checked' : ''}>
          <span class="fame-dungeon-name">${html(dungeon.name)}</span>
          <span class="fame-dungeon-first">+${count(first)}</span>
          ${dungeon.collections.length
            ? `<span class="fame-dungeon-tags">${dungeon.collections.length} collection${dungeon.collections.length > 1 ? 's' : ''}</span>`
            : ''}
        </label>`;
    }).join('') : '<p class="note">No dungeon matches that.</p>';
  }

  function render() {
    if (!state.data) return;
    const view = EnchantFame.summarise(state.data, state.done, state.base);
    renderSummary(view);
    renderNext(view);
    renderCollections(view);
    renderDungeons();
  }

  function toggle(name) {
    if (state.done.has(name)) state.done.delete(name); else state.done.add(name);
    save();
    render();
  }

  function init(text) {
    state.data = EnchantFame.parse(text);
    load();
    $('fameBase').value = state.base || '';

    $('fameBase').addEventListener('input', event => {
      state.base = Number(event.target.value) || 0;
      save();
      render();
    });
    $('fameSearch').addEventListener('input', event => {
      state.search = event.target.value;
      renderDungeons();
    });
    $('fameDungeons').addEventListener('change', event => {
      const box = event.target.closest('[data-dungeon]');
      if (box) toggle(box.dataset.dungeon);
    });
    $('fameNext').addEventListener('click', event => {
      const row = event.target.closest('[data-tick]');
      if (row) toggle(row.dataset.tick);
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
