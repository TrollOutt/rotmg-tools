/*
 * The index: the page that knows what exists.
 *
 * The three tools each read the client and each keep what they need, so when
 * something is missing from one of them there has been nowhere to ask whether
 * it exists at all. This is that place. Everything the client declares in the
 * families the site deals in is here - including what every tool hides - with
 * where it was declared and, where a tool hides it, why.
 *
 * It is also how the tools reach each other: a record knows what it belongs
 * to, what belongs to it, and which page can do something with it.
 */
'use strict';

const RealmIndex = (function () {
  let all = null;                    // every record, by id
  let light = null;                  // the light list: [id, name, kind, alias, hidden]
  let started = false;
  let showing = null;                // the record on screen
  let kindWanted = '';               // the category chip that is down

  const el = id => document.getElementById(id);

  /*
   * A window onto the one sheet, at whatever size is asked for, with the
   * picture's own shape kept: a creature sixteen wide and eight tall is not
   * squared off into a box.
   */
  function art(one, side) {
    if (!one || !one.art || !all.sheet) return '';
    const [x, y, w, h] = one.art;
    const zoom = side / Math.max(w, h);
    return '<span class="ix-art" style="width:' + (w * zoom) + 'px;height:' + (h * zoom)
      + 'px;background-size:' + (all.sheet.wide * zoom) + 'px ' + (all.sheet.tall * zoom)
      + 'px;background-position:' + (-x * zoom) + 'px ' + (-y * zoom) + 'px"></span>';
  }

  /* The room a picture takes in a row, whether or not there is one to show. */
  function artCell(one, side) {
    return '<span class="ix-cell" style="width:' + side + 'px;height:' + side + 'px">'
      + art(one, side) + '</span>';
  }
  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /*
   * The seven families, in the order somebody looks for them rather than
   * alphabetically: what you hold, who you are, what you fight, where you go,
   * and the three that decide what goes on your gear.
   */
  const KINDS = [
    ['item', 'Gear'], ['class', 'Classes'], ['enemy', 'Enemies'],
    ['place', 'Places'], ['set', 'Sets'], ['enchant', 'Enchantments'],
    ['pool', 'Pools']
  ];
  const KIND_SAY = Object.fromEntries(KINDS);

  /* ---------------- reading it in ---------------- */
  async function load() {
    if (all) return true;
    const bundle = window.ROTMG_BUNDLE;
    /*
     * Carried inside the file you download to keep, and fetched by the served
     * page - which is the one difference between the two copies, and it is
     * three and a half megabytes that most visitors never need.
     */
    let raw = bundle && bundle.sources && bundle.sources.indexText;
    if (!raw) {
      raw = await fetch('assets/index/index.json').then(r => r.text())
        .catch(() => fetch('../data/Index/index.json').then(r => r.text()).catch(() => ''));
    }
    if (!raw) return false;
    const said = JSON.parse(raw);
    all = new Map();
    for (const one of said.records) all.set(one.id, one);
    light = said.records.map(one => [one.id, one.name, one.kind, one.alias || '',
      one.hidden ? 1 : 0]);
    /*
     * Both ends of every link, so a record can be asked what points at it
     * without walking the whole index. The file carries each link once.
     */
    for (const one of said.records) {
      one.outLinks = one.out || [];
      one.inLinks = one.in || [];
    }
    /*
     * One sheet holds every picture, cut from the client by
     * tools/index-sprites.js, and each record carries its rectangle in it.
     * The client's own art is the only art that settles which of three things
     * called Doom Bow is the one in your hand.
     */
    all.sheet = said.sheet;
    all.files = said.files || [];
    all.built = said.built;
    all.count = said.records.length;
    return true;
  }

  /* ---------------- searching ---------------- */
  /*
   * Name first, then the client's own working name, and nothing clever: a
   * reader typing "doom" wants Doom Bow before Doombringer Shield, and a
   * reader typing "3ArcherST3" is holding the XML and wants that exact thing.
   */
  function look(words) {
    const term = words.trim().toLowerCase();
    const out = [];
    for (const one of light) {
      if (kindWanted && one[2] !== kindWanted) continue;
      if (!term) { out.push(one); if (out.length > 400) break; continue; }
      const name = one[1].toLowerCase();
      const at = name.indexOf(term);
      const alias = at < 0 && one[3] ? one[3].toLowerCase().indexOf(term) : -1;
      if (at < 0 && alias < 0) continue;
      out.push(one);
    }
    if (term) {
      out.sort((a, b) => {
        const x = a[1].toLowerCase(), y = b[1].toLowerCase();
        const ax = x.startsWith(term) ? 0 : 1, by = y.startsWith(term) ? 0 : 1;
        if (ax !== by) return ax - by;
        if (x.length !== y.length) return x.length - y.length;
        return x.localeCompare(y);
      });
    }
    return out.slice(0, 300);
  }

  function drawResults() {
    const box = el('ixList');
    if (!box) return;
    const rows = look(el('ixSearch').value || '');
    el('ixCount').textContent = rows.length >= 300
      ? 'first 300 of many' : rows.length + (rows.length === 1 ? ' thing' : ' things');
    box.innerHTML = rows.map(one =>
      '<button type="button" class="ix-row' + (one[0] === (showing && showing.id) ? ' is-on' : '')
      + '" data-open="' + esc(one[0]) + '">'
      + artCell(all.get(one[0]), 20)
      + '<b>' + esc(one[1]) + '</b>'
      + '<i class="ix-kind is-' + one[2] + '">' + esc(KIND_SAY[one[2]] || one[2]) + '</i>'
      + (one[4] ? '<u class="ix-hidden" title="Some tools do not offer this">hidden</u>' : '')
      + '</button>').join('') || '<p class="ix-none">Nothing by that name.</p>';
  }

  /* ---------------- one record, and everything it touches ---------------- */
  /*
   * What a class may hold is not stored: it is the slot the class declares
   * against the slot the item declares, which is one comparison and twelve
   * thousand links not written down.
   */
  function heldBy(record) {
    const out = [];
    if (record.kind === 'class') {
      const wants = new Set(record.slots || []);
      for (const one of all.values()) {
        if (one.kind === 'item' && wants.has(one.slot)) out.push(one);
      }
    } else if (record.kind === 'item' && record.slot !== undefined) {
      for (const one of all.values()) {
        if (one.kind === 'class' && (one.slots || []).includes(record.slot)) out.push(one);
      }
    }
    return out;
  }

  const STAT_SAY = { hp: 'Life', mp: 'Magic', att: 'Attack', def: 'Defence',
    spd: 'Speed', dex: 'Dexterity', vit: 'Vitality', wis: 'Wisdom' };

  function factsOf(one) {
    const bits = [];
    if (one.hand) bits.push(['slot', one.hand + ' (' + one.slot + ')']);
    if (one.tier !== undefined) bits.push(['tier', 'T' + one.tier]);
    if (one.sb) bits.push(['soulbound', 'yes']);
    if (one.mp) bits.push(['mana', one.mp]);
    if (one.rate !== undefined) bits.push(['rate of fire', Math.round(one.rate * 100) + '%']);
    if (one.shots > 1) bits.push(['shots', one.shots]);
    if (one.hp) bits.push(['life', one.hp.toLocaleString('en-US')]);
    if (one.def) bits.push(['armour', one.def]);
    if (one.weight !== undefined) bits.push(['roll weight', one.weight.toLocaleString('en-US')]);
    if (one.fits) bits.push(['goes on', one.fits]);
    if (one.refuses) bits.push(['never on', one.refuses]);
    if (one.beside) bits.push(['not beside', one.beside]);
    if (one.takes) bits.push(['takes', one.takes]);
    if (one.ground) bits.push(['ground', one.ground]);
    if (one.tiles) bits.push(['tiles walked', one.tiles.toLocaleString('en-US')]);
    if (one.pic) bits.push(['picture', one.pic === 'wiki' ? 'from the wiki' : 'cut from the client']);
    if (one.stats) {
      for (const key of Object.keys(STAT_SAY)) {
        if (one.stats[key] === undefined) continue;
        bits.push([STAT_SAY[key].toLowerCase(), one.stats[key]
          + (one.stats[key + 'Top'] !== undefined ? ' … ' + one.stats[key + 'Top'] : '')]);
      }
    }
    if (one.steps) {
      for (const many of Object.keys(one.steps)) {
        bits.push([many + ' pieces', Object.keys(one.steps[many])
          .map(k => (one.steps[many][k] > 0 ? '+' : '') + one.steps[many][k] + ' ' + k).join(' ')]);
      }
    }
    return bits;
  }

  function drawCard(id) {
    const box = el('ixCard');
    const one = all.get(id);
    showing = one || null;
    if (!box) return;
    if (!one) {
      box.innerHTML = '<p class="ix-none">Pick something on the left.</p>';
      return;
    }
    const held = heldBy(one).slice(0, 60);
    const links = [];
    for (const [how, to] of one.outLinks || []) links.push([how, to, false]);
    for (const [how, from] of one.inLinks || []) links.push([how, from, true]);
    if (one.kind === 'class') held.forEach(x => links.push(['may hold', x.id, false]));
    if (one.kind === 'item') held.forEach(x => links.push(['may hold', x.id, true]));

    const facts = factsOf(one);
    const where = one.from
      ? (all.files[one.from[0]] || '?') + (one.from[1] ? ' · ' + one.from[1] : '')
      : 'not declared in the client';

    box.innerHTML = '<header class="ix-card-head">'
      + artCell(one, 44)
      + '<span class="ix-kind is-' + one.kind + '">' + esc(KIND_SAY[one.kind] || one.kind) + '</span>'
      + '<h3>' + esc(one.said || one.name) + '</h3>'
      + (one.alias ? '<code>' + esc(one.alias) + '</code>' : '')
      + '</header>'
      + (one.about ? '<p class="ix-about">' + esc(one.about) + '</p>' : '')
      + (one.hidden
        ? '<p class="ix-warn"><b>Not offered by the tools</b> — ' + esc(one.hidden.join('; ')) + '.</p>'
        : '')
      + (one.twin
        ? '<p class="ix-warn">The client declares more than one thing under this name.</p>'
        : '')
      + (facts.length
        ? '<dl class="ix-facts">' + facts.map(([k, v]) =>
          '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>'
        : '')
      + (one.labels && one.labels.length
        ? '<p class="ix-labels">' + one.labels.map(x =>
          '<i>' + esc(x) + '</i>').join('') + '</p>'
        : '')
      + drawTools(one)
      + (links.length ? drawLinks(links) : '')
      + '<p class="ix-from">Declared in <code>' + esc(where) + '</code></p>';
  }

  /* What another page can do with this thing. */
  function drawTools(one) {
    const doors = [];
    if (one.kind === 'item' && !one.hidden) {
      doors.push(['bench', 'Try it on the bench', 'Put this in the matching slot and see what it does']);
      doors.push(['enchant', 'Price its enchantments', 'Open the calculator with this item']);
    }
    if (one.kind === 'class') doors.push(['bench', 'Build this class', 'Open the bench on it']);
    if (one.kind === 'enemy') {
      doors.push(['bench', 'Fight it', 'Use it as the target on the bench']);
    }
    if (one.kind === 'place' || (one.outLinks || []).some(x => x[0] === 'lives in')) {
      doors.push(['atlas', 'Find it on the map', 'Open the realm atlas']);
    }
    if (!doors.length) return '';
    return '<p class="ix-doors">' + doors.map(([go, say, why]) =>
      '<button type="button" class="ix-door" data-door="' + go + '" title="' + esc(why) + '">'
      + esc(say) + '</button>').join('') + '</p>';
  }

  function drawLinks(links) {
    const byHow = new Map();
    for (const [how, id, backwards] of links) {
      const key = (backwards ? '← ' : '') + how;
      (byHow.get(key) || byHow.set(key, []).get(key)).push(id);
    }
    let out = '<div class="ix-links">';
    for (const [how, ids] of byHow) {
      out += '<div class="ix-link-row"><i>' + esc(how) + '</i><span>'
        + ids.slice(0, 40).map(id => {
          const one = all.get(id);
          return '<button type="button" class="ix-jump" data-open="' + esc(id) + '">'
            + art(one, 14) + esc(one ? (one.said || one.name) : id) + '</button>';
        }).join('')
        + (ids.length > 40 ? '<em>and ' + (ids.length - 40) + ' more</em>' : '')
        + '</span></div>';
    }
    return out + '</div>';
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    el('ixSearch').addEventListener('input', drawResults);
    el('ixKinds').addEventListener('click', event => {
      const chip = event.target.closest('[data-kind]');
      if (!chip) return;
      kindWanted = chip.dataset.kind === kindWanted ? '' : chip.dataset.kind;
      for (const one of el('ixKinds').querySelectorAll('[data-kind]')) {
        one.classList.toggle('is-on', one.dataset.kind === kindWanted);
      }
      drawResults();
    });
    document.getElementById('pageIndex').addEventListener('click', event => {
      const open = event.target.closest('[data-open]');
      if (open) {
        drawCard(open.dataset.open);
        drawResults();
        const card = el('ixCard');
        if (card) card.scrollTop = 0;
        return;
      }
      const door = event.target.closest('[data-door]');
      if (door && showing) walkThrough(door.dataset.door, showing);
    });
  }

  /*
   * Through the door with whatever the record can carry: an item into the
   * slot it belongs in, a class as the class, an enemy as the thing being
   * fought. What the other page cannot use, it ignores.
   */
  function walkThrough(where, one) {
    if (where === 'bench' && typeof window.benchWith === 'function') {
      window.benchWith({
        item: one.kind === 'item' ? one.name : undefined,
        hand: one.hand,
        klass: one.kind === 'class' ? one.name : undefined,
        target: one.kind === 'enemy' ? one.name : undefined
      });
      return;
    }
    if (where === 'enchant' && typeof window.enchantThis === 'function') {
      window.enchantThis({ item: one.name, slots: [] });
      return;
    }
    if (where === 'atlas') {
      location.hash = 'realm';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  function fillKinds() {
    el('ixKinds').innerHTML = KINDS.map(([kind, say]) =>
      '<button type="button" class="ix-chip is-' + kind + '" data-kind="' + kind + '">'
      + esc(say) + '</button>').join('');
  }

  async function start() {
    if (started) return;
    const box = el('ixBody');
    if (!box) return;
    if (!await load()) {
      box.innerHTML = '<p class="tc-missing">The index is not built yet. '
        + 'Run <code>node tools/build-index.js</code>.</p>';
      return;
    }
    started = true;
    // The sheet's address, once, for every picture on the page to point at.
    {
      const bundle = window.ROTMG_BUNDLE;
      el('ixBody').style.setProperty('--ix-sheet', 'url('
        + ((bundle && bundle.indexSheet) || 'assets/index/sheet.png') + ')');
    }
    fillKinds();
    wire();
    el('ixBuilt').textContent = all.count.toLocaleString('en-US')
      + ' things, read from the client of ' + all.built;
    drawResults();
    drawCard('');
  }

  /* Somebody else may want to open a record: the atlas, or a search box. */
  function show(id) {
    if (!started) return false;
    if (!all.has(id)) return false;
    drawCard(id);
    drawResults();
    return true;
  }

  return { start, show };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RealmIndex;
