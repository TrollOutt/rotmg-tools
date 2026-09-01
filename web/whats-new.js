/*
 * What the update brought.
 *
 * Two extractions of the client compared object for object by
 * tools/diff-client.js, plus a hand-written account of why any of it happened,
 * which no client will ever tell you.
 *
 * The shape of the page is a shelf of groups on an invisible grid. Each shows
 * four of what it holds - animated ones first, because a thing that moves says
 * more about itself in a second than a name does. Open one and it takes the
 * shelf over and lists everything it has; click away and the shelf comes back.
 *
 * The pictures are the client's own. Where the client draws a thing moving,
 * the frames come out as a strip and are played as the game plays them: the
 * walk cycle at rest, the attack while the pointer is on it.
 */
var WhatsNew = (function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /*
   * The order the groups sit in, which is the order they matter: what you
   * hold, then what you wear, then who you become, then where you go.
   */
  const GROUPS = [
    ['weapons', 'Weapons', 'What you swing, fire and throw'],
    ['abilities', 'Abilities', 'The second slot'],
    ['armour', 'Armour', 'What keeps you standing'],
    ['rings', 'Rings', 'The quiet numbers'],
    ['skins', 'Skins', 'Who you look like'],
    ['pets', 'Pets', 'What follows you about'],
    ['equipment', 'Other gear', 'Everything else you can carry'],
    ['places', 'Places', 'Doors that were not there before']
  ];

  let data = null;
  let art = null;                        // bundled data URIs, when standalone
  let open = null;

  const url = file => (art && art[file]) ? art[file] : 'assets/whats-new/' + file;
  const bag = name => data.drawers[name] || { added: [], changed: [], gone: [] };
  const everything = name => {
    const d = bag(name);
    return [].concat(
      d.added.map(t => ({ thing: t, why: 'added' })),
      d.changed.map(t => ({ thing: t, why: 'changed' })),
      d.gone.map(t => ({ thing: t, why: 'gone' })));
  };

  /*
   * A picture, sized by whole numbers so the pixels stay square. The client's
   * sprites are eight or sixteen a side; scaling by anything else turns a
   * crisp thing into a smeared one.
   */
  function pictureOf(thing, aim) {
    const sprite = thing.sprite;
    if (!sprite) return '<span class="wn-art wn-art-empty" aria-hidden="true"></span>';
    const clips = sprite.clips;
    const rest = clips.walk || clips.stand || clips.attack;
    const busy = clips.attack || clips.walk;
    if (!rest) return '<span class="wn-art wn-art-empty" aria-hidden="true"></span>';

    const scale = Math.max(2, Math.min(9, Math.round((aim || 56) / rest.height)));
    const style = [
      'width:' + (rest.tile * scale) + 'px',
      'height:' + (rest.height * scale) + 'px',
      '--wn-rest:url(' + url(rest.file) + ')',
      '--wn-rest-w:' + (rest.tile * rest.frames * scale) + 'px',
      '--wn-rest-steps:' + rest.frames,
      '--wn-rest-time:' + (rest.frames * 0.22).toFixed(2) + 's'
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

  const moves = thing => !!(thing.sprite && thing.sprite.clips
    && ((thing.sprite.clips.walk && thing.sprite.clips.walk.frames > 1)
      || (thing.sprite.clips.attack && thing.sprite.clips.attack.frames > 1)));

  /*
   * The four to show on the closed group.
   *
   * Things that move come first, then things with a picture at all, and the
   * rest in the order the client filed them. Four is what fits on one line
   * without the card becoming a list in miniature.
   */
  function fourOf(name) {
    const all = everything(name).filter(e => e.why !== 'gone').map(e => e.thing);
    const ranked = all.slice().sort((a, b) => {
      const am = moves(a) ? 0 : (a.sprite ? 1 : 2);
      const bm = moves(b) ? 0 : (b.sprite ? 1 : 2);
      return am - bm;
    });
    return ranked.slice(0, 4);
  }

  const pretty = value => {
    if (value === true) return 'yes';
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
    return String(value);
  };

  const FIRST = ['damage', 'rate of fire', 'range', 'shots', 'mp cost', 'cooldown',
    'for', 'tier', 'power', 'feed power'];

  // Facts read as a sentence of small pieces, not as a table: a card with six
  // rows of two columns is a spreadsheet, and nobody scans a spreadsheet.
  function factsOf(thing, limit) {
    const facts = thing.facts || {};
    const keys = Object.keys(facts).filter(k => k !== 'class' && k !== 'bag');
    keys.sort((a, b) => {
      const ia = FIRST.indexOf(a), ib = FIRST.indexOf(b);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.localeCompare(b);
    });
    const shown = keys.slice(0, limit || 6);
    if (!shown.length) return '';
    return '<p class="wn-facts">' + shown.map(k =>
      '<span><i>' + esc(k) + '</i> ' + esc(pretty(facts[k])) + '</span>').join('') + '</p>';
  }

  const LONG = 70;
  function movedOf(thing) {
    if (!thing.moved || !thing.moved.length) return '';
    const brief = [], wordy = [];
    for (const m of thing.moved) {
      const size = String(m.was === null ? '' : m.was).length
        + String(m.now === null ? '' : m.now).length;
      (size > LONG ? wordy : brief).push(m);
    }
    let out = '';
    if (brief.length) {
      out += '<p class="wn-facts wn-moved">' + brief.map(m =>
        '<span><i>' + esc(m.fact) + '</i> <s>' + esc(pretty(m.was)) + '</s> '
        + '<b>' + esc(pretty(m.now)) + '</b></span>').join('') + '</p>';
    }
    for (const m of wordy) {
      out += '<p class="wn-rewrite"><i>' + esc(m.fact) + ' rewritten</i> '
        + esc(pretty(m.now)) + '</p>';
    }
    return out;
  }

  const WHY = { added: 'new', changed: 'changed', gone: 'gone' };

  function rowOf(entry) {
    const thing = entry.thing;
    const labels = (thing.labels || []).filter(l =>
      !/^TAB_|^POWERTIER_|^EQUIPMENT$/.test(l)).slice(0, 4);
    return '<li class="wn-row wn-' + entry.why + '">'
      + pictureOf(thing, 44)
      + '<div class="wn-row-body">'
      + '<h4>' + esc(thing.id)
      + '<em class="wn-why wn-why-' + entry.why + '">' + WHY[entry.why] + '</em></h4>'
      + (labels.length ? '<p class="wn-labels">' + labels.map(l =>
        '<span>' + esc(l) + '</span>').join('') + '</p>' : '')
      + (entry.why === 'changed' ? movedOf(thing) : factsOf(thing, 6))
      + (thing.description ? '<p class="wn-desc">' + esc(thing.description) + '</p>' : '')
      + '</div></li>';
  }

  function groupOf(name, label, hint) {
    const d = bag(name);
    const total = d.added.length + d.changed.length + d.gone.length;
    if (!total) return '';
    const isOpen = open === name;
    const parts = [];
    if (d.added.length) parts.push(d.added.length + ' new');
    if (d.changed.length) parts.push(d.changed.length + ' changed');
    if (d.gone.length) parts.push(d.gone.length + ' gone');

    let inner;
    if (isOpen) {
      inner = '<ul class="wn-list">' + everything(name).map(rowOf).join('') + '</ul>';
    } else {
      /*
       * Four boxes of one size, whatever is put in them. A group whose things
       * happen to be drawn sixteen pixels tall should not be twice the height
       * of one whose things are eight: the shelf reads as a shelf only if the
       * tiles are the same, so the picture is centred in a fixed box rather
       * than the box being cut to the picture.
       */
      const four = fourOf(name);
      inner = '<div class="wn-four">' + four.map(t =>
        '<span class="wn-four-one" title="' + esc(t.id) + '">' + pictureOf(t, 40) + '</span>'
      ).join('') + '</div>';
    }
    return '<section class="wn-group' + (isOpen ? ' is-open' : '') + '" data-group="' + name + '"'
      + ' role="button" tabindex="0">'
      + '<header><h3>' + esc(label) + '</h3>'
      + '<p class="wn-tally">' + esc(parts.join(' · ')) + '</p>'
      + '<p class="wn-hint">' + esc(isOpen ? 'click the heading to close' : hint) + '</p>'
      + '</header>'
      + inner + '</section>';
  }

  /*
   * The account of the update as a contents page.
   *
   * Nine sections laid out side by side is a wall of small print that has to
   * be read to be navigated. As a list of headings it can be scanned instead:
   * each line says what it is about in a few words, and opens where it is
   * standing rather than sending you somewhere. Only one is open at a time,
   * because the point is to keep the other eight in view.
   */
  let openNote = -1;
  function notesOf() {
    const notes = data.notes;
    if (!notes) return '';
    return '<section class="wn-notes">'
      + (notes.lede ? '<p class="wn-lede">' + esc(notes.lede) + '</p>' : '')
      + '<div class="wn-contents">' + (notes.parts || []).map((part, i) =>
        '<article class="wn-part' + (openNote === i ? ' is-open' : '') + '" data-note="' + i + '">'
        + '<button type="button" class="wn-part-head">'
        + '<span class="wn-part-mark" aria-hidden="true"></span>'
        + '<span class="wn-part-title">' + esc(part.title) + '</span>'
        + '<span class="wn-part-blurb">' + esc(part.blurb || '') + '</span>'
        + '<span class="wn-part-count">' + part.points.length + '</span>'
        + '</button>'
        + (openNote === i ? '<ul>' + part.points.map(point =>
          '<li>' + esc(point) + '</li>').join('') + '</ul>' : '')
        + '</article>').join('') + '</div>'
      + '</section>';
  }

  /*
   * Where the shelf was when a group was opened.
   *
   * Opening a group replaces the whole shelf, so without this the scroll
   * position means something different afterwards and closing leaves you
   * somewhere you have never been - usually past the end, with the group you
   * came from off the top of the window.
   */
  let wasAt = 0;
  const scroller = () => document.querySelector('#pageNews .news-layout');

  function render(restore) {
    const box = scroller();
    $('newsGroups').innerHTML = GROUPS.map(g => groupOf(g[0], g[1], g[2])).join('');
    $('newsGroups').classList.toggle('has-open', !!open);
    if (!box) return;
    if (restore === 'keep') return;
    box.scrollTop = restore === 'back' ? wasAt : 0;
  }

  function show(index, bundled) {
    data = index;
    art = bundled || null;
    const notes = data.notes || {};

    $('newsTitle').textContent = notes.title || "What's New";
    $('newsHead').innerHTML = (notes.subtitle ? esc(notes.subtitle) : '')
      + (notes.date ? ' <span class="wn-dim">· ' + esc(notes.date) + '</span>' : '');

    // What the two clients actually differ by, said once and plainly.
    const t = data.tally || {};
    const shown = GROUPS.reduce((n, g) => n + (t[g[0]] ? t[g[0]].added : 0), 0);
    const rest = data.counts.added - shown;
    $('newsScale').innerHTML = '<b>' + data.counts.added + '</b> objects added, '
      + '<b>' + data.counts.changed + '</b> changed, <b>' + data.counts.gone + '</b> gone'
      + ' <span class="wn-dim">— ' + shown + ' of them are things you can hold, wear or walk into; '
      + 'the other ' + rest + ' are creatures, consumables and the machinery behind them.</span>';

    $('newsNotes').innerHTML = notesOf();
    render();
  }

  /*
   * Opening and closing.
   *
   * A group opens on a click anywhere in it and closes on a click anywhere
   * that is not in it, which is what a shelf of drawers does. The keyboard
   * gets the same: Enter or Space to open, Escape to close.
   */
  function wire() {
    document.addEventListener('click', event => {
      if (!data) return;
      const page = $('pageNews');
      if (!page || page.hidden) return;
      /*
       * A group is its own switch. Clicking it opens it and clicking its
       * heading again closes it, so there is nothing extra on the card to
       * find and nothing to explain - which is what a close button was.
       */
      const heading = event.target.closest('.wn-group.is-open > header');
      if (heading) { open = null; render('back'); return; }
      const group = event.target.closest('.wn-group');
      if (group && !group.classList.contains('is-open')) {
        const box = scroller();
        wasAt = box ? box.scrollTop : 0;
        open = group.dataset.group;
        render();
        return;
      }
      const note = event.target.closest('[data-note]');
      if (note) {
        const which = Number(note.dataset.note);
        openNote = openNote === which ? -1 : which;
        $('newsNotes').innerHTML = notesOf();
        return;
      }
      if (!group && open) { open = null; render('back'); }
    });
    document.addEventListener('keydown', event => {
      if (!data) return;
      if (event.key === 'Escape' && open) { open = null; render('back'); return; }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const group = event.target.closest && event.target.closest('.wn-group');
      if (group && !group.classList.contains('is-open')) {
        event.preventDefault();
        const box = scroller();
        wasAt = box ? box.scrollTop : 0;
        open = group.dataset.group;
        render();
      }
    });
  }

  let started = false;
  function init(bundled) {
    if (started) return;
    started = true;
    wire();
    if (bundled && bundled.index) { show(bundled.index, bundled.art); return; }
    fetch('assets/whats-new/index.json')
      .then(response => response.json())
      .then(index => show(index, null))
      .catch(() => {
        started = false;
        $('newsScale').innerHTML = '<span class="note warn">No comparison has been made yet. '
          + 'Run <code>node tools/diff-client.js</code>.</span>';
      });
  }

  return { init };
})();
