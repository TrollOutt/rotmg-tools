/*
 * What the update brought.
 *
 * Two extractions of the client compared object for object by
 * tools/diff-client.js, laid out so the answer to "what is new" is one glance
 * and the answer to "what changed on the thing I use" is one click.
 *
 * The pictures are the client's own, cut from its sheets. Where the client
 * draws a thing moving - a skin, a monster - the frames come out as a strip
 * and are played here as the game plays them: the walk cycle by default, the
 * attack while the pointer is on it.
 */
var WhatsNew = (function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /*
   * The order the drawers are offered in, which is the order they matter.
   * What you can hold comes first, then who you can be, then what you fight
   * and where; the machinery of the update is last and named as such.
   */
  const DRAWERS = [
    ['weapons', 'Weapons'],
    ['abilities', 'Abilities'],
    ['armour', 'Armour'],
    ['rings', 'Rings'],
    ['skins', 'Skins'],
    ['pets', 'Pets'],
    ['equipment', 'Other gear'],
    ['consumables', 'Consumables'],
    ['creatures', 'Creatures'],
    ['places', 'Places'],
    ['backstage', 'Backstage']
  ];
  const STATES = [['added', 'New'], ['changed', 'Changed'], ['gone', 'Gone']];

  let data = null;
  let art = null;                        // bundled data URIs, when standalone
  let drawer = null;
  let state = 'added';
  let query = '';

  const url = file => (art && art[file]) ? art[file] : 'assets/whats-new/' + file;

  /*
   * A picture, and how big to draw it.
   *
   * The client's sprites are eight or sixteen pixels on a side, occasionally
   * more. Rather than force them all to one size and blur half of them, each
   * is scaled by a whole number so the pixels stay square, aiming for about
   * sixty pixels tall.
   */
  function pictureOf(thing) {
    const sprite = thing.sprite;
    if (!sprite) return '<span class="wn-art wn-art-empty" aria-hidden="true"></span>';
    const clips = sprite.clips;
    const rest = clips.walk || clips.stand || clips.attack;
    const busy = clips.attack || clips.walk;
    if (!rest) return '<span class="wn-art wn-art-empty" aria-hidden="true"></span>';

    const scale = Math.max(2, Math.min(8, Math.round(56 / rest.height)));
    const w = rest.tile * scale, h = rest.height * scale;
    const style = [
      'width:' + w + 'px', 'height:' + h + 'px',
      '--wn-rest:url(' + url(rest.file) + ')',
      '--wn-rest-w:' + (rest.tile * rest.frames * scale) + 'px',
      '--wn-rest-steps:' + rest.frames,
      '--wn-rest-time:' + (rest.frames > 1 ? (rest.frames * 0.22).toFixed(2) : '0') + 's'
    ];
    if (busy && busy !== rest) {
      style.push('--wn-busy:url(' + url(busy.file) + ')');
      style.push('--wn-busy-w:' + (busy.tile * busy.frames * scale) + 'px');
      style.push('--wn-busy-steps:' + busy.frames);
      style.push('--wn-busy-time:' + (busy.frames * 0.16).toFixed(2) + 's');
    }
    return '<span class="wn-art' + (rest.frames > 1 ? ' is-moving' : '')
      + (busy && busy !== rest ? ' has-busy' : '') + '" style="' + style.join(';') + '"></span>';
  }

  // A number the way a tooltip would put it, not the way XML does.
  const pretty = value => {
    if (value === true) return 'yes';
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
    return String(value);
  };

  const FIRST = ['damage', 'rate of fire', 'range', 'shots', 'mp cost', 'cooldown',
    'hp', 'defense', 'xp', 'tier', 'power', 'feed power'];

  function factsOf(thing, limit) {
    const facts = thing.facts || {};
    const keys = Object.keys(facts).filter(k => k !== 'class');
    keys.sort((a, b) => {
      const ia = FIRST.indexOf(a), ib = FIRST.indexOf(b);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.localeCompare(b);
    });
    const shown = limit ? keys.slice(0, limit) : keys;
    if (!shown.length) return '';
    return '<dl class="wn-facts">' + shown.map(k =>
      '<div><dt>' + esc(k) + '</dt><dd>' + esc(pretty(facts[k])) + '</dd></div>').join('') + '</dl>';
  }

  /*
   * What moved, old beside new.
   *
   * A number and a rewritten paragraph want different treatment. Struck
   * through and set side by side, two versions of a description fill the card
   * three times over and drown the numbers that are the reason to look. So
   * anything long is given its own block and the old wording is folded away
   * behind a summary, there to open if it is wanted.
   */
  const LONG = 70;
  function movedOf(thing) {
    if (!thing.moved || !thing.moved.length) return '';
    const brief = [], wordy = [];
    for (const m of thing.moved) {
      const size = String(m.was ?? '').length + String(m.now ?? '').length;
      (size > LONG ? wordy : brief).push(m);
    }
    let out = '';
    if (brief.length) {
      out += '<dl class="wn-moved">' + brief.map(m =>
        '<div><dt>' + esc(m.fact) + '</dt>'
        + '<dd><s>' + esc(pretty(m.was)) + '</s> <b>' + esc(pretty(m.now)) + '</b></dd></div>').join('')
        + '</dl>';
    }
    for (const m of wordy) {
      out += '<div class="wn-rewrite">'
        + '<p class="wn-rewrite-now"><b>' + esc(m.fact) + '</b> ' + esc(pretty(m.now)) + '</p>'
        + (m.was ? '<details><summary>was</summary><p>' + esc(pretty(m.was)) + '</p></details>' : '')
        + '</div>';
    }
    return out;
  }

  function cardOf(thing, why) {
    const labels = (thing.labels || []).filter(l => !/^TAB_|^POWERTIER_/.test(l)).slice(0, 5);
    const kind = (thing.facts && thing.facts['class']) || '';
    return '<article class="wn-card' + (why === 'gone' ? ' is-gone' : '') + '">'
      + '<div class="wn-card-top">'
      + pictureOf(thing)
      + '<div class="wn-card-name"><h3>' + esc(thing.id) + '</h3>'
      + (kind ? '<span class="wn-kind">' + esc(kind) + '</span>' : '')
      + '</div></div>'
      + (labels.length ? '<p class="wn-labels">' + labels.map(l =>
        '<span>' + esc(l) + '</span>').join('') + '</p>' : '')
      + (why === 'changed' ? movedOf(thing) : factsOf(thing, 8))
      + (thing.description ? '<p class="wn-desc">' + esc(thing.description) + '</p>' : '')
      + '</article>';
  }

  function countIn(name, why) {
    const d = data.drawers[name];
    return d && d[why] ? d[why].length : 0;
  }

  function render() {
    const chips = DRAWERS.filter(([name]) => data.drawers[name]).map(([name, label]) => {
      const total = countIn(name, 'added') + countIn(name, 'changed') + countIn(name, 'gone');
      return '<button type="button" class="filter-chip' + (name === drawer ? ' is-on' : '')
        + '" data-drawer="' + name + '">' + esc(label)
        + ' <b>' + total + '</b></button>';
    }).join('');
    $('newsDrawers').innerHTML = chips;

    const states = STATES.map(([why, label]) => {
      const n = countIn(drawer, why);
      return '<button type="button" class="filter-chip' + (why === state ? ' is-on' : '')
        + '" data-state="' + why + '"' + (n ? '' : ' disabled') + '>'
        + esc(label) + ' <b>' + n + '</b></button>';
    }).join('');
    $('newsStates').innerHTML = states;

    const list = ((data.drawers[drawer] || {})[state] || []).filter(thing => {
      if (!query) return true;
      const hay = (thing.id + ' ' + (thing.labels || []).join(' ') + ' '
        + (thing.description || '')).toLowerCase();
      return hay.includes(query);
    });

    $('newsGrid').innerHTML = list.length
      ? list.map(thing => cardOf(thing, state)).join('')
      : '<p class="note">Nothing here' + (query ? ' matching “' + esc(query) + '”' : '') + '.</p>';
    $('newsCount').textContent = list.length + (list.length === 1 ? ' entry' : ' entries');
  }

  function pick(name) {
    drawer = name;
    // Land on whichever state actually has something in it, so a drawer with
    // no additions opens on its changes rather than on an empty grid.
    if (!countIn(drawer, state)) {
      state = STATES.map(s => s[0]).find(why => countIn(drawer, why)) || 'added';
    }
    render();
  }

  function show(index, bundled) {
    data = index;
    art = bundled || null;
    const total = data.counts.added + data.counts.changed + data.counts.gone;
    $('newsHead').innerHTML =
      '<strong>' + data.counts.added + '</strong> new, '
      + '<strong>' + data.counts.changed + '</strong> changed, '
      + '<strong>' + data.counts.gone + '</strong> gone'
      + ' <span class="wn-dim">— ' + total + ' objects moved between the two builds'
      + (data.made ? ', read ' + esc(data.made) : '') + '</span>';

    drawer = DRAWERS.map(d => d[0]).find(name => countIn(name, 'added')) || 'weapons';
    pick(drawer);

    $('newsDrawers').addEventListener('click', event => {
      const chip = event.target.closest('[data-drawer]');
      if (chip) pick(chip.dataset.drawer);
    });
    $('newsStates').addEventListener('click', event => {
      const chip = event.target.closest('[data-state]');
      if (chip && !chip.disabled) { state = chip.dataset.state; render(); }
    });
    $('newsSearch').addEventListener('input', event => {
      query = event.target.value.trim().toLowerCase();
      render();
    });
  }

  let started = false;
  function init(bundled) {
    if (started) return;
    started = true;
    if (bundled && bundled.index) { show(bundled.index, bundled.art); return; }
    fetch('assets/whats-new/index.json')
      .then(response => response.json())
      .then(index => show(index, null))
      .catch(() => {
        started = false;
        $('newsHead').innerHTML = '<span class="note warn">No comparison has been made yet. '
          + 'Run <code>node tools/diff-client.js</code>.</span>';
      });
  }

  return { init };
})();
