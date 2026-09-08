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
  let wiki = null;                   // the community join, when there is one
  let groups = [];                   // the browse rail, built once from the data
  let narrowed = [];                 // one set of allowed ids per group in play

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

  /*
   * And what the community knows, which is a separate file because it is a
   * separate kind of claim. The client does not say where anything comes from
   * - loot is the server's business - so "dropped by" can only ever be what
   * players have written down. It is loaded beside the index, shown apart from
   * it, and the page says whose word it is.
   */
  async function loadWiki() {
    const bundle = window.ROTMG_BUNDLE;
    let raw = bundle && bundle.sources && bundle.sources.wikiText;
    if (!raw) {
      raw = await fetch('assets/index/wiki.json').then(r => (r.ok ? r.text() : ''))
        .catch(() => fetch('../data/Index/wiki.json').then(r => r.text()).catch(() => ''));
    }
    if (!raw) return;
    let said;
    try { said = JSON.parse(raw); } catch (err) { return; }
    const named = said.ids || [];
    wiki = {
      says: said.says, home: said.at, built: said.built, pages: said.pages || [],
      page: new Map(),                 // our record -> the page about it
      about: new Map(),                // that page -> every record it answers to
      drop: new Map(), dropBy: new Map(), spawn: new Map(), spawnBy: new Map()
    };
    const tie = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    for (const [who, where] of said.page || []) {
      const id = named[who];
      if (!id || !all.has(id)) continue;
      wiki.page.set(id, where);
      tie(wiki.about, where, id);
    }
    for (const [from, to] of said.drop || []) { tie(wiki.drop, from, to); tie(wiki.dropBy, to, from); }
    for (const [from, to] of said.spawn || []) { tie(wiki.spawn, from, to); tie(wiki.spawnBy, to, from); }
  }

  /* ---------------- ways in ---------------- */
  /*
   * A search box only helps somebody who already knows the name. The rail is
   * for the other reader: every way of cutting the index that the data really
   * supports, with how many things each way holds. Each one is the client's
   * own division - the wiki's own lists were tried and dropped, because what
   * its pages call a list is anything linked from a section of them, which put
   * the Doom Bow under Shiny Items and under Loot Containers.
   *
   * Within a group the choices add up, between groups they narrow: Archer and
   * Wizard means either, Archer and Weapon means both.
   */
  function buildFacets() {
    groups = [];
    const group = (title, from, note) => {
      const made = { title, from, note, chips: [], open: false };
      groups.push(made);
      return made;
    };
    const chip = (into, key, say, ids) => {
      if (ids.size) into.chips.push({ key: into.title + '/' + key, say, ids });
    };
    const gather = test => {
      const ids = new Set();
      for (const one of all.values()) if (test(one)) ids.add(one.id);
      return ids;
    };

    /* Which class may hold it - the slot the class declares against the slot
       the item declares, the same comparison the card makes. */
    const byClass = group('Class', 'client');
    for (const one of [...all.values()].filter(x => x.kind === 'class')) {
      const wants = new Set(one.slots || []);
      const ids = gather(x => x.id === one.id
        || (x.kind === 'item' && wants.has(x.slot)));
      chip(byClass, one.name, one.name, ids);
    }

    const bySlot = group('Slot', 'client');
    for (const [hand, say] of [['weapon', 'Weapon'], ['ability', 'Ability'],
      ['armor', 'Armour'], ['ring', 'Ring']]) {
      chip(bySlot, hand, say, gather(x => x.hand === hand));
    }

    const byTier = group('Tier', 'client');
    chip(byTier, 'ut', 'Untiered', gather(x => (x.labels || []).includes('UT')));
    chip(byTier, 'st', 'Set tier', gather(x => (x.labels || []).includes('ST')));
    for (let t = 0; t <= 14; t++) {
      chip(byTier, 't' + t, 'T' + t, gather(x => x.tier === t));
    }

    const marks = group('Marks', 'client');
    chip(marks, 'sb', 'Soulbound', gather(x => Boolean(x.sb)));
    chip(marks, 'shiny', 'Shiny', gather(x => (x.labels || []).includes('SHINY')));
    chip(marks, 'reskin', 'Reskin', gather(x => (x.labels || []).includes('RESKIN')));
    chip(marks, 'boss', 'Boss', gather(x => Boolean(x.boss)));
    chip(marks, 'god', 'God', gather(x => Boolean(x.god)));
    chip(marks, 'hidden', 'Hidden by a tool', gather(x => Boolean(x.hidden)));

    /*
     * The seasons, as far as the client names them. It labels a couple of
     * hundred things with the event they belong to and sometimes with its
     * year; it names no year at all for everything else, so there is no year
     * axis here rather than a hollow one.
     */
    const when = group('Season', 'client', 'only where the client names one');
    const SEASON = [
      ['Oryxmas', /^ORYXMAS|^ORG_ORYXMAS/], ['Halloween', /^HALLOWEEN|^HAUNTEDHALLOWS/],
      ['Easter', /^EASTER/], ["Valentine's", /^VALENTINE/],
      ['MotMG', /^MOTMG/], ['Spring', /^SPRINGMEANING/]
    ];
    for (const [say, test] of SEASON) {
      chip(when, say, say, gather(x => (x.labels || []).some(l => test.test(l))));
    }

    const where = group('Biome', 'client');
    for (const one of [...all.values()].filter(x => x.kind === 'place')
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const ids = gather(x => x.id === one.id
        || (x.outLinks || []).some(([how, to]) => how === 'lives in' && to === one.id));
      chip(where, one.name, one.name, ids);
    }

    for (const one of groups) {
      one.chips.sort((a, b) => b.ids.size - a.ids.size);
    }
    groups = groups.filter(one => one.chips.length);
    if (groups[0]) groups[0].open = true;
  }

  /* The sets a record has to be in to survive the rail, one per group in play. */
  function narrow() {
    narrowed = [];
    for (const one of groups) {
      const on = one.chips.filter(x => x.on);
      if (!on.length) continue;
      const any = new Set();
      for (const chip of on) for (const id of chip.ids) any.add(id);
      narrowed.push(any);
    }
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
      let barred = false;
      for (const set of narrowed) if (!set.has(one[0])) { barred = true; break; }
      if (barred) continue;
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

  function drawFacets() {
    const box = el('ixFacets');
    if (!box) return;
    box.innerHTML = groups.map((one, at) =>
      '<section class="ix-group' + (one.open ? ' is-open' : '')
      + '" data-group="' + at + '">'
      + '<button type="button" class="ix-group-head" data-fold="' + at + '">'
      + '<b>' + esc(one.title) + '</b>'
      + (one.from === 'wiki' ? '<em class="ix-said">community</em>' : '')
      + '<span class="ix-group-on">'
      + (one.chips.filter(x => x.on).length || '') + '</span></button>'
      + '<div class="ix-group-body">'
      + (one.note ? '<p class="ix-group-note">' + esc(one.note) + '</p>' : '')
      + one.chips.map(x => '<button type="button" class="ix-facet'
        + (x.on ? ' is-on' : '') + '" data-facet="' + esc(x.key) + '">'
        + esc(x.say) + '<i>' + x.ids.size.toLocaleString('en-US') + '</i></button>').join('')
      + '</div></section>').join('');
    const on = groups.reduce((n, one) => n + one.chips.filter(x => x.on).length, 0);
    const clear = el('ixClear');
    if (clear) clear.hidden = !on;
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
      + (wiki && wiki.page.has(one.id)
        ? '<a class="ix-away" target="_blank" rel="noreferrer noopener" href="'
          + esc(wiki.home + (wiki.pages[wiki.page.get(one.id)] || [''])[0])
          + '" title="Its page on the community wiki">RealmEye ↗</a>'
        : '')
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
      + drawWiki(one)
      + '<p class="ix-from">Declared in <code>' + esc(where) + '</code></p>';
  }

  /*
   * What the community says about this thing, kept in its own block and named
   * as theirs. A drop list is not a client declaration and it is not a rate:
   * it is what players have seen and written down, and it can be a patch out
   * of date. Shown, because nothing else in the game's own files answers
   * "where does this come from"; fenced, because it is somebody else's claim.
   */
  function drawWiki(one) {
    if (!wiki) return '';
    const mine = wiki.page.get(one.id);
    if (mine === undefined) return '';
    const rows = [];
    const say = (how, list) => {
      if (!list || !list.length) return;
      rows.push('<div class="ix-link-row"><i>' + esc(how) + '</i><span>'
        + list.slice(0, 24).map(at => {
          const here = (wiki.about.get(at) || [])
            .map(id => all.get(id)).filter(Boolean);
          const pick = here.find(x => !x.twin) || here[0];
          const [slug, title] = wiki.pages[at] || ['', '?'];
          if (pick) {
            return '<button type="button" class="ix-jump" data-open="' + esc(pick.id) + '">'
              + art(pick, 14) + esc(pick.said || pick.name) + '</button>';
          }
          return '<a class="ix-jump is-away" target="_blank" rel="noreferrer noopener"'
            + ' href="' + esc(wiki.home + slug) + '">' + esc(title) + '</a>';
        }).join('')
        + (list.length > 24 ? '<em>and ' + (list.length - 24) + ' more</em>' : '')
        + '</span></div>');
    };
    say('dropped by', wiki.dropBy.get(mine));
    say('listed as dropping', wiki.drop.get(mine));
    /*
     * One row for summoning, not two. The wiki writes "Spawns:" and "Spawns
     * from:" under the same heading, and the link keeps the heading but not
     * the line - so which way round a pair reads is not in the data. Both
     * directions together say the true thing: these two are named in each
     * other's reproduction.
     */
    const kin = [...new Set([...(wiki.spawn.get(mine) || []),
      ...(wiki.spawnBy.get(mine) || [])])];
    say('spawns, or is spawned by', kin);
    if (!rows.length) return '';
    return '<div class="ix-said-block"><h4>What players have written down'
      + '<em>' + esc(wiki.says) + '</em></h4>'
      + '<p class="ix-group-note">What players have listed, not what the client'
      + ' declares, and never a drop rate.</p>'
      + '<div class="ix-links">' + rows.join('') + '</div></div>';
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
    el('ixFacets').addEventListener('click', event => {
      const fold = event.target.closest('[data-fold]');
      if (fold) {
        const one = groups[Number(fold.dataset.fold)];
        one.open = !one.open;
        fold.parentElement.classList.toggle('is-open', one.open);
        return;
      }
      const hit = event.target.closest('[data-facet]');
      if (!hit) return;
      for (const one of groups) {
        for (const chip of one.chips) if (chip.key === hit.dataset.facet) chip.on = !chip.on;
      }
      narrow();
      drawFacets();
      drawResults();
    });
    el('ixClear').addEventListener('click', () => {
      for (const one of groups) for (const chip of one.chips) chip.on = false;
      narrow();
      drawFacets();
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
    await loadWiki();
    buildFacets();
    wire();
    drawFacets();
    el('ixBuilt').textContent = all.count.toLocaleString('en-US')
      + ' things, read from the client of ' + all.built
      + (wiki ? ', ' + wiki.page.size.toLocaleString('en-US') + ' with a wiki page' : '');
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
