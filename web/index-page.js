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
  let kindsLeft = null;              // how many of each family survive the rail
  let asked = [];                    // the chips that are down, in the order they went down
  /*
   * The things somebody has starred. Kept in the browser rather than anywhere
   * else: it is one reader's shortlist, nobody else's business, and it should
   * survive closing the tab without asking them to make an account.
   */
  const LOVED = 'rotmg-tools/index-favourites';
  let loved = new Set();

  const el = id => document.getElementById(id);

  /*
   * A window onto the one sheet, at whatever size is asked for, with the
   * picture's own shape kept: a creature sixteen wide and eight tall is not
   * squared off into a box.
   */
  /*
   * Everything on this page is drawn at a size the window can afford. On a
   * two-thousand-pixel screen a sixteen-pixel sprite and eleven-pixel text are
   * a postage stamp in a field, so the pictures grow with the room the way the
   * type does.
   */
  const zoomed = () => Math.min(1.7, Math.max(1, (window.innerWidth || 1400) / 1400));

  function art(one, side) {
    if (!one || !one.art || !all.sheet) return '';
    side = Math.round(side * zoomed());
    const [x, y, w, h] = one.art;
    const zoom = side / Math.max(w, h);
    return '<span class="ix-art" style="width:' + (w * zoom) + 'px;height:' + (h * zoom)
      + 'px;background-size:' + (all.sheet.wide * zoom) + 'px ' + (all.sheet.tall * zoom)
      + 'px;background-position:' + (-x * zoom) + 'px ' + (-y * zoom) + 'px"></span>';
  }

  /* The room a picture takes in a row, whether or not there is one to show. */
  function artCell(one, side) {
    const box = Math.round(side * zoomed());
    return '<span class="ix-cell" style="width:' + box + 'px;height:' + box + 'px">'
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
    ['item', 'Gear'], ['use', 'Consumables'], ['class', 'Classes'], ['enemy', 'Enemies'],
    ['portal', 'Dungeons'], ['place', 'Biomes'], ['set', 'Sets'],
    ['enchant', 'Enchantments'], ['pool', 'Pools']
  ];
  const KIND_SAY = Object.fromEntries(KINDS);

  function readLoved() {
    try {
      const said = JSON.parse(window.localStorage.getItem(LOVED) || '[]');
      if (Array.isArray(said)) loved = new Set(said.filter(one => typeof one === 'string'));
    } catch (err) { loved = new Set(); }
  }

  function writeLoved() {
    try { window.localStorage.setItem(LOVED, JSON.stringify([...loved])); } catch (err) { /* a
      browser that refuses to remember is not a reason to stop working */ }
  }

  /* The star, wherever it is drawn. */
  const star = id => '<span class="ix-love' + (loved.has(id) ? ' is-on' : '')
    + '" data-love="' + esc(id) + '" role="button" tabindex="-1"'
    + ' title="' + (loved.has(id) ? 'Take it off your list' : 'Keep it on your list')
    + '">\u2605</span>';

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
    /*
     * The name the list prints is the one the card prints. Eight things are
     * called Beehemoth Quiver and the build has already worked out what tells
     * them apart; a list that prints the bare name shows the reader eight
     * identical rows and hides the answer on the far side of a click.
     */
    /*
     * A potion and a bow are both "item" to the client, and nobody looking for
     * one is looking for the other - so the family a reader sees splits them.
     * The record keeps its own kind; this is only what the list files it under.
     */
    light = said.records.map(one => [one.id, one.said || one.name,
      one.use ? 'use' : one.kind, one.alias || '', one.hidden ? 1 : 0,
      one.dev ? 1 : 0]);
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
    all.slots = said.slots || {};
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
      near: new Map(),                 // or, failing that, the page its pieces point at
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
    for (const [who, where] of said.near || []) {
      const id = named[who];
      if (id && all.has(id)) wiki.near.set(id, where);
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
    /*
     * `inSub` marks a group that belongs in the middle column rather than the
     * rail: the same machinery counts and narrows it, it is simply drawn where
     * the reader has already said what family they are after.
     */
    const group = (title, from, note, inSub) => {
      const made = { title, from, note, inSub, chips: [], open: false };
      groups.push(made);
      return made;
    };
    const chip = (into, key, say, ids, pic) => {
      if (ids.size) into.chips.push({ key: into.title + '/' + key, say, ids, pic });
    };
    const gather = test => {
      const ids = new Set();
      for (const one of all.values()) if (test(one)) ids.add(one.id);
      return ids;
    };

    /*
     * The reader's own shortlist comes first: it is the only way in they made
     * themselves, and it is the one they will want most often.
     */
    if (loved.size) {
      const mine = new Set([...loved].filter(id => all.has(id)));
      if (mine.size) chip(group('Favourites', 'client'), 'loved', 'Starred', mine);
    }

    /* Which class may hold it - the slot the class declares against the slot
       the item declares, the same comparison the card makes. */
    const byClass = group('Class', 'client');
    for (const one of [...all.values()].filter(x => x.kind === 'class')) {
      const wants = new Set(one.slots || []);
      const ids = gather(x => x.id === one.id
        || (x.kind === 'item' && wants.has(x.slot)));
      chip(byClass, one.name, one.name, ids, one.id);
    }

    const byHand = group('Gears', 'client');
    for (const [hand, say] of [['weapon', 'Weapon'], ['ability', 'Ability'],
      ['armor', 'Armour'], ['ring', 'Ring']]) {
      /* Pictured by the plainest of its kind, the way the finer ones are. */
      let plainest = null;
      for (const one of all.values()) {
        if (one.kind !== 'item' || one.hand !== hand || one.hidden || !one.art) continue;
        if (one.tier === undefined) continue;
        if (!plainest || one.tier < plainest.tier) plainest = one;
      }
      chip(byHand, hand, say, gather(x => x.hand === hand && !x.use),
        plainest && plainest.id);
    }

    /*
     * And the finer division the client's own tiered gear agrees on: bows,
     * quivers, leather. It is what a class card names, so a reader who taps
     * Bow there lands on the same chip here.
     */
    /*
     * The finer division waits for the coarse one. Twenty-nine kinds of gear
     * in the rail is a wall to read before choosing anything; four slots and
     * then the kinds that slot holds is one question after another.
     */
    const byType = group('Kind of gear', 'client', undefined, true);
    for (const slot of Object.keys(all.slots)) {
      chip(byType, 'slot' + slot, all.slots[slot][0],
        gather(x => x.kind === 'item' && String(x.slot) === slot));
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
        || (x.outLinks || []).some(([how, to]) => how === 'was seen in' && to === one.id));
      chip(where, one.name, one.name, ids);
    }

    /*
     * Two chips reading the same word are one way in, not two. Five patches of
     * Low Forest are five records to the atlas and one place to a reader.
     */
    /*
     * And where a thing comes from. The client says nothing about loot, so
     * this one is the community's: the pages that list a dungeon's drops,
     * turned round. Only the dungeons that actually give something, and
     * marked as their word rather than the client's.
     */
    if (wiki) {
      const fromThere = new Map();          // portal record -> what it gives
      for (const [id, at] of wiki.page) {
        const one = all.get(id);
        if (!one || one.kind !== 'portal' || one.hidden || one.dev) continue;
        const gives = new Set([id]);
        for (const to of wiki.drop.get(at) || []) {
          for (const got of wiki.about.get(to) || []) gives.add(got);
        }
        if (gives.size > 3) fromThere.set(one, gives);
      }
      if (fromThere.size) {
        const out = group('Dungeon', 'wiki', 'what players list it as dropping');
        for (const [one, gives] of fromThere) {
          chip(out, one.name, one.said || one.name, gives, one.id);
        }
      }
    }

    for (const one of groups) {
      const byName = new Map();
      for (const it of one.chips) {
        const had = byName.get(it.say);
        if (had) { for (const id of it.ids) had.ids.add(id); continue; }
        byName.set(it.say, it);
      }
      one.chips = [...byName.values()].sort((a, b) => b.ids.size - a.ids.size);
    }
    groups = groups.filter(one => one.chips.length);
    if (groups[0]) groups[0].open = true;
  }

  /* The sets a record has to be in to survive the rail, one per group in play. */
  function gather() {
    narrowed = [];
    for (const one of groups) {
      const on = one.chips.filter(x => x.on);
      if (!on.length) continue;
      const any = new Set();
      for (const chip of on) for (const id of chip.ids) any.add(id);
      narrowed.push({ group: one, set: any });
    }
    refine();
  }

  function narrow() {
    gather();
    /*
     * A sub category belongs to the category above it. Take Weapon off and the
     * Bow chosen under it is still down, holding a filter that nothing can
     * satisfy - which is how the list came to say "0 things" with a chip lit
     * beside it. Any sub-category choice left with nothing behind it lets go.
     */
    let letGo = false;
    for (const one of groups) {
      if (!one.inSub) continue;
      for (const chip of one.chips) {
        if (chip.on && chip.here === 0) { chip.on = false; letGo = true; }
      }
    }
    if (letGo) {
      asked = asked.filter(chip => chip.on);
      gather();
    }
  }

  /*
   * What each way in is still worth, given the ways already taken.
   *
   * A rail that keeps offering Tome after you have picked Archer is a rail
   * asking you to try things that cannot work. So every chip is counted
   * against what the other groups have already allowed - its own group left
   * out, or picking one option would rule out its neighbours - and a chip
   * with nothing left behind it goes away until it has something again.
   */
  function refine() {
    /*
     * Counted against everything the index holds, hidden and all, because a
     * chip that reads 322 and lists nothing is worse than one that reads 322.
     */
    const alive = light.map(one => one[0]);
    const withinKind = kindWanted
      ? new Set(light.filter(one => one[2] === kindWanted).map(one => one[0]))
      : null;
    /*
     * And which families are still on the table. The sub-category row offers
     * the reader a next step, so a step that leads to an empty list is not
     * offered - the rail's own choice of family left out, the same way each
     * group is left out of its own counting.
     */
    {
      let base = alive;
      for (const one of narrowed) base = base.filter(id => one.set.has(id));
      const room = new Set(base);
      kindsLeft = new Map();
      for (const one of light) {
        if (!room.has(one[0])) continue;
        kindsLeft.set(one[2], (kindsLeft.get(one[2]) || 0) + 1);
      }
    }
    for (const set of groups) {
      const others = narrowed.filter(one => one.group !== set);
      let base = alive;
      if (withinKind) base = base.filter(id => withinKind.has(id));
      for (const one of others) base = base.filter(id => one.set.has(id));
      const room = new Set(base);
      for (const chip of set.chips) {
        let n = 0;
        if (chip.ids.size <= room.size) {
          for (const id of chip.ids) if (room.has(id)) n++;
        } else {
          for (const id of room) if (chip.ids.has(id)) n++;
        }
        chip.here = n;
      }
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
    /*
     * What a tool hides is in the index on purpose, and asking after it by
     * name is half the reason this page exists - so a search always finds it.
     * But a reader who has typed nothing has asked nothing, and the first
     * screen they see should not open on test items and the machinery behind
     * a proc. So those wait until they are asked for, by name or by the chip
     * in Marks that calls for them.
     */
    /*
     * Asking for anything at all is asking for the whole answer.
     *
     * What a tool hides is in the index on purpose, and the first screen keeps
     * it back because a reader who has typed nothing has asked nothing. But
     * picking Shiny off the rail is a question, and every shiny thing is
     * hidden by the tools - so the old rule answered "322" on the chip and
     * "nothing by that name" in the list.
     */
    const wantsHidden = Boolean(term) || narrowed.length > 0;
    const out = [];
    for (const one of light) {
      if (kindWanted && one[2] !== kindWanted) continue;
      if (one[4] && !wantsHidden) continue;
      /*
       * The plumbing waits to be asked for by name or by its own chip. An
       * enchantment pool is a real thing worth looking up and no reader
       * browsing the index is looking for one.
       */
      if (one[5] && !term && !narrowed.length && kindWanted !== one[2]) continue;
      let barred = false;
      for (const chosen of narrowed) if (!chosen.set.has(one[0])) { barred = true; break; }
      if (barred) continue;
      if (!term) { out.push(one); continue; }
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
    } else {
      /* Nothing asked for: by name, so the same question gives the same page. */
      out.sort((a, b) => a[1].localeCompare(b[1]));
    }
    /* The count is of everything that matched, not of the page of it shown. */
    const page = out.slice(0, 300);
    page.total = out.length;
    return page;
  }

  /*
   * As many groups open as the screen will hold.
   *
   * With the whole window the rail can show every one of them; with a shorter
   * window it cannot, and a page that scrolls to reach the categories is the
   * thing the folding was for. So they are opened top down and the ones that
   * would run off the bottom are shut again - measured rather than guessed,
   * because a group's height is the number of chips in it and the width of
   * the window at that moment.
   */
  function fitGroups() {
    const box = el('ixFacets');
    const panel = el('ixBody');
    if (!box || !panel) return;
    const room = () => (window.innerHeight || 900)
      - box.getBoundingClientRect().top - 24;
    for (let guard = groups.length; guard > 0; guard--) {
      if (box.scrollHeight <= room()) break;
      const still = groups.filter(one => one.open && !one.inSub);
      /* Never all of them shut: a rail of seven headings answers nothing. */
      if (still.length <= 1) break;
      const last = still[still.length - 1];
      last.open = false;
      drawFacets();
    }
  }

  /*
   * A chip going down or coming up.
   *
   * The first choice is the one the rest were narrowed against - the classes
   * left after a dungeon are that dungeon's classes - so taking it back off
   * makes nonsense of everything under it. It clears the lot rather than
   * leaving a Tier 12 and an Archer standing with nothing to be part of, and
   * the record on screen goes with them.
   */
  function turn(chip) {
    if (chip.on) {
      const wasFirst = asked[0] === chip;
      if (wasFirst) {
        for (const one of groups) for (const x of one.chips) x.on = false;
        asked = [];
        kindWanted = '';
        drawCard('');
        return;
      }
      chip.on = false;
      asked = asked.filter(one => one !== chip);
      /*
       * A sub category is offered because of the category above it, so it goes
       * when that goes. The kinds of gear are a division of the slots: drop
       * Weapon and the Bow picked underneath it has nothing left to be a
       * division of, whether or not it would still match anything on its own.
       */
      const mine = groups.find(one => one.chips.includes(chip));
      if (mine && mine.title === 'Gears') {
        for (const one of groups) {
          if (!one.inSub) continue;
          for (const under of one.chips) under.on = false;
        }
        asked = asked.filter(one => one.on);
      }
      return;
    }
    chip.on = true;
    asked.push(chip);
  }

  /* Everything the rail touches, redrawn in one go. */
  /* Whether a record survives the rail as it stands - the same test the list
     makes, without the name being typed, which is nobody's category. */
  function stillAllowed(id) {
    const one = all.get(id);
    if (!one) return false;
    if (kindWanted && one.kind !== kindWanted) return false;
    for (const chosen of narrowed) if (!chosen.set.has(id)) return false;
    return true;
  }

  function repaint() {
    narrow();
    /*
     * A card left open on something the new category cannot contain is the
     * page contradicting itself: Knight chosen on the left, a Summoner robe
     * on the right. It closes itself.
     */
    if (showing && !stillAllowed(showing.id)) drawCard('');
    /*
     * One step at a time. Nothing chosen and the rail is the page; something
     * chosen and it folds down to what was chosen, and the list has the room.
     */
    const picked = narrowed.length > 0 || Boolean(kindWanted);
    /*
     * Unfolded, always, and trimmed afterwards to what the screen will hold.
     * A choice makes every other group shorter - after one dungeon there are
     * four classes left rather than nineteen - so what is worth reading fits
     * where the whole rail did not.
     */
    for (const one of groups) one.open = true;
    const body = el('ixBody');
    if (body) {
      body.classList.toggle('has-pick', picked);
      /*
       * And the middle column keeps to the box you type in until there is
       * something to put under it. Nothing chosen and nothing typed is not a
       * list of eight thousand things; it is a question not yet asked.
       */
      body.classList.toggle('has-list', picked
        || Boolean(showing)
        || Boolean(((el('ixSearch') || {}).value || '').trim()));
    }
    drawKinds();
    drawTypes();
    drawChosen();
    drawFacets();
    fitGroups();
    drawResults();
  }

  function drawResults() {
    const box = el('ixList');
    if (!box) return;
    const rows = look(el('ixSearch').value || '');
    const many = rows.total.toLocaleString('en-US');
    el('ixCount').textContent = rows.total > rows.length
      ? 'first ' + rows.length + ' of ' + many
      : many + (rows.total === 1 ? ' thing' : ' things');
    box.innerHTML = rows.map(one =>
      '<button type="button" class="ix-row' + (one[0] === (showing && showing.id) ? ' is-on' : '')
      + '" data-open="' + esc(one[0]) + '">'
      + artCell(all.get(one[0]), 20)
      + '<b>' + esc(one[1]) + '</b>'
      + '<i class="ix-kind is-' + one[2] + '">' + esc(KIND_SAY[one[2]] || one[2]) + '</i>'
      + (one[4] ? '<u class="ix-hidden" title="Some tools do not offer this">hidden</u>' : '')
      + star(one[0])
      + '</button>').join('') || '<p class="ix-none">Nothing by that name.</p>';
  }

  /*
   * The middle column's second row: the kinds of gear, once the reader has
   * said they are looking at gear. Shown when a family, a hand or a class has
   * been chosen and gear survives it - never as a wall of twenty-nine.
   */
  function drawTypes() {
    const box = el('ixTypes');
    if (!box) return;
    const set = groups.find(one => one.inSub);
    const asked = kindWanted === 'item'
      || (set && set.chips.some(chip => chip.on))
      || groups.some(one => (one.title === 'Gears' || one.title === 'Class')
        && one.chips.some(chip => chip.on));
    const chips = set ? set.chips.filter(x => x.on || x.here > 0) : [];
    if (!set || !asked || !chips.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = chips.map(x => '<button type="button" class="ix-chip is-item'
      + (x.on ? ' is-on' : '') + '" data-facet="' + esc(x.key) + '">'
      + esc(x.say) + '<i>' + x.here.toLocaleString('en-US') + '</i></button>').join('');
  }

  /*
   * What has been chosen, once something has.
   *
   * The rail is a long thing to read, and past the first choice the reader is
   * no longer reading it - they are looking at the list. So the groups fold
   * away and what is left is the choices themselves, each one a button that
   * takes itself back off.
   */
  function drawChosen() {
    const box = el('ixChosen');
    if (!box) return;
    /*
     * Categories only. A kind of gear is chosen in the middle column and is
     * shown down there, lit, where it was picked; repeating it up here put a
     * sub category among the categories and gave it two places to be taken
     * off from.
     */
    const on = [];
    for (const set of groups) {
      if (set.inSub) continue;
      for (const chip of set.chips) if (chip.on) on.push(chip);
    }
    if (!on.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    /* Each carries the colour of the group it came from, so a chip up here is
       recognisable without its heading beside it. */
    box.innerHTML = on.map(x => '<button type="button" class="ix-chosen'
      + (x === asked[0] ? ' is-first' : '') + '" data-facet="' + esc(x.key) + '"'
      + ' data-key="' + esc(x.key.slice(0, x.key.indexOf('/')).toLowerCase()
        .replace(/[^a-z]+/g, '-')) + '"'
      + ' title="' + (x === asked[0]
        ? 'The first choice — taking it off clears the rest'
        : 'Take this one off') + '">'
      + (x.pic ? art(all.get(x.pic), 13) : '') + esc(x.say) + '<u>&times;</u></button>').join('');
  }

  function drawFacets() {
    const box = el('ixFacets');
    if (!box) return;
    /*
     * Once a choice is made its own group has nothing left to offer: the other
     * dungeons are not narrower answers, they are different questions, and
     * leaving ninety of them under a chosen one is asking the reader to undo
     * their own work to read the page. So a group that holds the choice shows
     * the choice and nothing else, and stands out as the one that was made;
     * the others are what is left to ask, and a group with nothing left to
     * ask goes away.
     */
    box.innerHTML = groups.map((one, at) => {
      if (one.inSub) return '';
      const chosen = one.chips.filter(x => x.on);
      /*
       * What is left to choose - and everything already chosen, whatever its
       * count. A chip that has been picked and then narrowed down to nothing
       * still has to be visible where it was picked, or the only way to undo
       * it is the row at the top and the group looks like it is offering
       * something it is not.
       */
      const left = one.chips.filter(x => x.on || x.here === undefined || x.here > 0);
      if (!chosen.length && !left.length) return '';
      /*
       * Only one of them is the first. Every choice narrows the ones after it,
       * but the first is the one they were all narrowed against - it is the
       * one whose removal takes the rest with it - so it is the only one drawn
       * as the anchor, and it says so.
       */
      const isFirst = Boolean(asked[0]) && chosen.includes(asked[0]);
      /*
       * And it is the only one that puts its alternatives away. Taking the
       * first choice back clears everything, so offering its neighbours beside
       * it would only invite the reader to start again. A later choice costs
       * nothing to change or to add to - weapons and abilities together is a
       * fair question - so those groups keep every option they have left.
       */
      const shown = isFirst && chosen.length ? chosen : left;
      return '<section class="ix-group' + (one.open ? ' is-open' : '')
      + (isFirst ? ' is-primary' : (chosen.length ? ' is-chosen' : ''))
      + '" data-group="' + at + '"'
      /* Its own colour, so a chip is recognisable away from its heading. */
      + ' data-key="' + esc(one.title.toLowerCase().replace(/[^a-z]+/g, '-')) + '"'
      + (shown.some(x => x.say.length > 18) ? ' data-wide' : '') + '>'
      + '<button type="button" class="ix-group-head" data-fold="' + at + '"'
      + (isFirst ? ' title="The first choice. Taking it off clears the rest."' : '') + '>'
      /* On its own line above the name, so it cannot be read as part of it. */
      + (isFirst ? '<em class="ix-first">first choice — clears the rest</em>' : '')
      + '<b>' + esc(one.title) + '</b>'
      + (one.from === 'wiki' ? '<em class="ix-said">community</em>' : '')
      + '<span class="ix-group-on">'
      + (chosen.length || '') + '</span></button>'
      + '<div class="ix-group-body"><div class="ix-group-inner">'
      + (one.note ? '<p class="ix-group-note">' + esc(one.note) + '</p>' : '')
      /*
       * No numbers here. The rail is a set of doors and the count belongs on
       * the other side of one: the family row says how many are left the
       * moment a door is opened. A chip that has nothing behind it still goes
       * away, which is the part the number was really for.
       */
      + shown
        .map(x => '<button type="button" class="ix-facet'
          + (x.on ? ' is-on' : '') + '" data-facet="' + esc(x.key) + '"'
          + ' title="' + esc(x.say) + '">'
          + (x.pic ? art(all.get(x.pic), 13) : '')
          + '<span>' + esc(x.say) + '</span>'
          /* The way off, shown when the pointer is on it. */
          + (x.on ? '<u class="ix-off">&times;</u>' : '')
          + '</button>').join('')
      + '</div></div></section>';
    }).join('');
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
  /* The client's own stat names, in the words the game's own tooltips use. */
  /* Where a picture came from, said the way a reader would ask it. */
  const PIC_SAY = { wiki: 'drawn by the community', client: "the game's own art",
    skin: 'the skin it gives you', piece: 'one of its pieces' };
  const WORN_SAY = { MAXHP: 'life', MAXMP: 'magic', ATT: 'attack', DEF: 'defence',
    SPD: 'speed', DEX: 'dexterity', VIT: 'vitality', WIS: 'wisdom' };

  function factsOf(one) {
    const bits = [];
    if (one.hand) bits.push(['slot', one.hand + ' (' + one.slot + ')']);
    if (one.tier !== undefined) bits.push(['tier', 'T' + one.tier]);
    if (one.sb) bits.push(['soulbound', 'yes']);
    if (one.mp) bits.push(['mana', one.mp]);
    if (one.rate !== undefined) bits.push(['rate of fire', Math.round(one.rate * 100) + '%']);
    if (one.shots > 1) bits.push(['shots', one.shots]);
    /*
     * What the thing actually does when you swing it. A card that says only
     * "ability (29), soulbound, 100 mana" has told the reader nothing they
     * came for; the damage, the range and what wearing it is worth are the
     * whole question.
     */
    for (const shot of one.fires || []) {
      const many = (one.fires.length > 1 ? 'shot ' + (one.fires.indexOf(shot) + 1) : 'damage');
      bits.push([many, shot.low === shot.high ? shot.low
        : shot.low + '–' + shot.high]);
      if (shot.reach !== undefined) bits.push(['range', shot.reach + ' tiles']);
      const notes = [shot.pierce ? 'ignores armour' : '', shot.through ? 'goes through' : '']
        .filter(Boolean);
      if (notes.length) bits.push(['the shot', notes.join(', ')]);
    }
    if (one.worn) {
      if (one.kind === 'set') {
        bits.push(['the four pieces give', Object.keys(one.worn).map(stat =>
          (one.worn[stat] > 0 ? '+' : '') + one.worn[stat] + ' '
          + (WORN_SAY[stat] || stat.toLowerCase())).join(', ')]);
      } else {
      /*
       * One row, not one per statistic: a creature's own life and armour are
       * already facts on this card, and "life +80" beside them reads as what
       * the thing has rather than as what it gives.
       */
      bits.push(['wearing it', Object.keys(one.worn).map(stat =>
        (one.worn[stat] > 0 ? '+' : '') + one.worn[stat] + ' '
        + (WORN_SAY[stat] || stat.toLowerCase())).join(', ')]);
      }
    }
    if (one.hp) bits.push(['life', one.hp.toLocaleString('en-US')]);
    if (one.def) bits.push(['armour', one.def]);
    if (one.weight !== undefined) bits.push(['how often it rolls', one.weight.toLocaleString('en-US')]);
    if (one.fits) bits.push(['goes on', one.fits]);
    if (one.refuses) bits.push(['never on', one.refuses]);
    if (one.beside) bits.push(['not beside', one.beside]);
    if (one.takes) bits.push(['it can give', one.takes]);
    if (one.skin) bits.push(['turns you into', one.skin]);
    if (one.came) bits.push(['came with', 'the ' + one.came]);
    if (one.ground) bits.push(['ground', one.ground]);
    if (one.tiles) bits.push(['how big', one.tiles.toLocaleString('en-US') + ' tiles']);
    if (one.pic) bits.push(['picture', PIC_SAY[one.pic] || one.pic]);
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
          .map(k => (one.steps[many][k] > 0 ? '+' : '') + one.steps[many][k] + ' '
            + (WORN_SAY[k] || k)).join(', ')]);
      }
      /*
       * And what the pieces are worth on their own. Eight of the older sets
       * pay nothing at all for being complete - they only change how you look
       * - and a card that showed nothing read as though the set did nothing.
       */
      if (one.kind === 'set' && !Object.keys(one.steps).length) {
        bits.push(['for wearing all four', 'nothing but the look']);
      }
    }
    return bits;
  }

  /*
   * What the client says a thing does where no number can say it. The Alien
   * Cores carry no damage and no bonus and read as though they did nothing;
   * the client writes their effect out in the tooltip block instead, and so
   * does it for seven hundred other pieces of gear.
   */
  function drawDoes(one) {
    if (!one.does || !one.does.length) return '';
    return '<ul class="ix-does">' + one.does.map(said => '<li>'
      + (said.length > 1 ? '<b>' + esc(said[0]) + '</b> ' + esc(said[1]) : esc(said[0]))
      + '</li>').join('') + '</ul>';
  }

  /*
   * The way out to the community's own page.
   *
   * Most records have one of their own. A dozen sets do not - the wiki files
   * them under a family, Oryxmas Gear or Venerable Gear, which is what every
   * one of their pieces links to - so those say where they are actually going
   * rather than promising a page about the set.
   */
  function awayTo(one) {
    if (!wiki) return '';
    const mine = wiki.page.get(one.id);
    if (mine !== undefined) {
      return '<a class="ix-away" target="_blank" rel="noreferrer noopener" href="'
        + esc(wiki.home + (wiki.pages[mine] || [''])[0])
        + '" title="Its page on the community wiki">RealmEye \u2197</a>';
    }
    const family = wiki.near.get(one.id);
    if (family === undefined) return '';
    const [slug, title] = wiki.pages[family] || ['', '?'];
    return '<a class="ix-away" target="_blank" rel="noreferrer noopener" href="'
      + esc(wiki.home + slug) + '" title="The community wiki files this one under '
      + esc(title) + ' rather than giving it a page">' + esc(title) + ' \u2197</a>';
  }

  function drawCard(id) {
    const box = el('ixCard');
    const one = all.get(id);
    showing = one || null;
    if (!box) return;
    /*
     * No record, no box. An empty panel the height of the window saying "pick
     * something on the left" is a lot of furniture for an instruction, and the
     * two columns that do have something to show would rather have the room.
     */
    const body = el('ixBody');
    if (!one) {
      box.innerHTML = '';
      /*
       * Left in the grid rather than taken out of it: its track shrinks to
       * nothing and it fades with it, which a display switch cannot do.
       */
      if (body) body.classList.remove('has-card');
      return;
    }
    /*
     * A record on screen means the middle column has done its job, so it stays
     * open behind the card even when nothing was chosen to get here - a link
     * inside another card is a way in too.
     */
    if (body) body.classList.add('has-card', 'has-list');
    const links = [];
    for (const [how, to] of one.outLinks || []) links.push([how, to, false]);
    for (const [how, from] of one.inLinks || []) links.push([how, from, true]);
    /*
     * A class is told by the kinds of thing it may carry, not by the four
     * hundred and thirty of them. An Archer holds a Bow, a Quiver, leather
     * armour and a ring; listing every bow ever made under "may hold" answered
     * a question nobody asked and buried the four that matter.
     *
     * An item keeps the list the other way round: nineteen classes at most,
     * and which of them can hold the thing is the question a reader has.
     */
    if (one.kind === 'item') heldBy(one).forEach(x => links.push(['may hold', x.id, true]));

    const facts = factsOf(one);
    const where = one.from
      ? (all.files[one.from[0]] || '?') + (one.from[1] ? ' · ' + one.from[1] : '')
      : 'not declared in the client';

    box.innerHTML = '<header class="ix-card-head">'
      + artCell(one, 44)
      + '<span class="ix-kind is-' + one.kind + '">' + esc(KIND_SAY[one.kind] || one.kind) + '</span>'
      + '<h3>' + esc(one.said || one.name) + '</h3>'
      + (one.alias ? '<code>' + esc(one.alias) + '</code>' : '')
      + awayTo(one)
      + star(one.id)
      + '</header>'
      + (one.about ? '<p class="ix-about">' + esc(one.about) + '</p>' : '')
      + drawDoes(one)
      + (one.hidden
        ? '<p class="ix-warn"><b>The other tools do not offer this</b> — ' + esc(one.hidden.join('; ')) + '.</p>'
        : '')
      + (one.twin
        ? '<p class="ix-warn">The game has more than one thing by this name. The words in brackets are how they differ.</p>'
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
      + drawSlots(one)
      + (links.length ? drawLinks(links) : '')
      + drawWiki(one)
      + '<p class="ix-from">Read from <code>' + esc(where) + '</code> in the game’s own files</p>';
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
  /*
   * A door is only drawn where the other page will really open.
   *
   * The index used to offer both tools on every piece of gear, and both were
   * sometimes locked: "Price its enchantments" on a Trick Mace opened the
   * calculator on "not in the item list", because the client does not let that
   * item be enchanted at all. What each tool holds is settled when the index
   * is built, against those tools' own catalogues, so a door here means the
   * thing is on the other side of it.
   *
   * Gear does not offer the bench. The bench dresses a class, and a piece of
   * gear on its own has no class to be dressed on - a Summoner ability handed
   * to whichever build happened to be open is not the reader's answer. Come at
   * it from the class instead.
   */
  function drawTools(one) {
    const doors = [];
    if (one.kind === 'item' && one.ench) {
      doors.push(['enchant', 'Price its enchantments', 'Open the calculator on this item']);
    }
    if (one.kind === 'class') doors.push(['bench', 'Build this class', 'Open the bench on it']);
    if (one.kind === 'enemy' && one.fight) {
      doors.push(['bench', 'Fight it', 'Use it as the target on the bench']);
    }
    if (one.kind === 'place' || (one.outLinks || []).some(x => x[0] === 'was seen in')) {
      doors.push(['atlas', 'Find it on the map', 'Open the realm atlas']);
    }
    if (!doors.length) return '';
    return '<p class="ix-doors">' + doors.map(([go, say, why]) =>
      '<button type="button" class="ix-door" data-door="' + go + '" title="' + esc(why) + '">'
      + esc(say) + '</button>').join('') + '</p>';
  }

  /* The kinds of gear a class may carry, each with the plainest of its kind. */
  function drawSlots(one) {
    if (one.kind !== 'class' || !one.slots || !all.slots) return '';
    const said = one.slots.map(slot => all.slots[slot]).filter(Boolean);
    if (!said.length) return '';
    return '<div class="ix-links"><div class="ix-link-row"><i>may hold</i><span>'
      + said.map(([say, plainest]) =>
        '<button type="button" class="ix-jump" data-slot="' + esc(say) + '"'
        + ' title="Show every ' + esc(say.toLowerCase()) + '">'
        + art(all.get(plainest), 14) + esc(say) + '</button>').join('')
      + '</span></div></div>';
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
  /*
   * One missing element must not take the page down with it.
   *
   * Everything here hangs off an id, and the whole page went dead once because
   * a single lookup came back empty in the middle of wiring - the search still
   * worked, nothing else did, and nothing said why. Each hook is attached on
   * its own now, the delegated one first because it carries the rest.
   */
  function hook(id, kind, run) {
    const node = id === 'pageIndex' ? document.getElementById(id) : el(id);
    if (!node) { console.warn('index: no ' + id + ' to listen on'); return; }
    node.addEventListener(kind, run);
  }

  function wire() {
    hook('ixSearch', 'input', () => {
      const body = el('ixBody');
      if (body) {
        body.classList.toggle('has-list',
          narrowed.length > 0 || Boolean(kindWanted) || Boolean(el('ixSearch').value.trim()));
      }
      drawResults();
    });
    hook('ixKinds', 'click', event => {
      const chip = event.target.closest('[data-kind]');
      if (!chip) return;
      kindWanted = chip.dataset.kind === kindWanted ? '' : chip.dataset.kind;
      repaint();
    });
    hook('ixFacets', 'click', event => {
      const fold = event.target.closest('[data-fold]');
      if (!fold) return;
      const one = groups[Number(fold.dataset.fold)];
      one.open = !one.open;
      fold.parentElement.classList.toggle('is-open', one.open);
    });
    hook('ixClear', 'click', () => {
      for (const one of groups) for (const chip of one.chips) chip.on = false;
      asked = [];
      kindWanted = '';
      drawCard('');
      repaint();
    });
    hook('pageIndex', 'click', event => {
      /*
       * One listener for every chip, because they are drawn in two places now
       * and a chip is the same thing wherever it sits.
       */
      const loves = event.target.closest('[data-love]');
      if (loves) {
        const id = loves.dataset.love;
        if (loved.has(id)) loved.delete(id); else loved.add(id);
        writeLoved();
        /*
         * The Favourites way in is made out of the list itself, so it has to
         * be rebuilt when the list changes - and the chips that were down stay
         * down, because starring something is not choosing a category.
         */
        const down = new Set();
        for (const one of groups) for (const chip of one.chips) if (chip.on) down.add(chip.key);
        buildFacets();
        for (const one of groups) for (const chip of one.chips) chip.on = down.has(chip.key);
        asked = asked.map(old => {
          for (const one of groups) for (const chip of one.chips) {
            if (chip.key === old.key) return chip;
          }
          return old;
        }).filter(chip => chip.on);
        repaint();
        if (showing) drawCard(showing.id);
        return;
      }
      const hit = event.target.closest('[data-facet]');
      if (hit) {
        let touched = null;
        for (const one of groups) {
          for (const chip of one.chips) if (chip.key === hit.dataset.facet) touched = chip;
        }
        if (touched) turn(touched);
        repaint();
        return;
      }
      const want = event.target.closest('[data-slot]');
      if (want) {
        for (const set of groups) {
          for (const chip of set.chips) {
            if (set.title === 'Kind of gear') {
              const wants = chip.say === want.dataset.slot;
              if (wants !== chip.on) turn(chip);
            }
          }
          if (set.title === 'Kind of gear') set.open = true;
        }
        repaint();
        return;
      }
      const open = event.target.closest('[data-open]');
      if (open) {
        /* Clicking the one already open shuts it, the way a chip comes off. */
        drawCard(showing && showing.id === open.dataset.open ? '' : open.dataset.open);
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

  function drawKinds() {
    el('ixKinds').innerHTML = KINDS
      .filter(([kind]) => kind === kindWanted || !kindsLeft || kindsLeft.get(kind))
      .map(([kind, say]) =>
        '<button type="button" class="ix-chip is-' + kind
        + (kind === kindWanted ? ' is-on' : '') + '" data-kind="' + kind + '">'
        + esc(say)
        + (kindsLeft && kindsLeft.get(kind)
          ? '<i>' + kindsLeft.get(kind).toLocaleString('en-US') + '</i>' : '')
        + '</button>').join('');
  }

  async function start() {
    if (started) return;
    const box = el('ixBody');
    if (!box) return;
    readLoved();
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
    await loadWiki();
    buildFacets();
    wire();
    /* The same pass every change makes, so the first screen is not a special
       case that forgets to unfold anything. */
    repaint();
    el('ixBuilt').textContent = all.count.toLocaleString('en-US')
      + ' things, read from the client of ' + all.built
      + (wiki ? ', ' + wiki.page.size.toLocaleString('en-US') + ' with a wiki page' : '');
    drawCard('');
    /*
     * The sprites are sized against the window, so a window that changes shape
     * wants them drawn again - once it has stopped changing.
     */
    let settling = null;
    window.addEventListener('resize', () => {
      clearTimeout(settling);
      settling = setTimeout(() => {
        repaint();
        if (showing) drawCard(showing.id);
      }, 180);
    });
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
