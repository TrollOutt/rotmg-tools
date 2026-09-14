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
  /*
   * Two flags, because one of them cannot do the job on its own.
   *
   * `started` is set after the data has been read, on purpose: a load that
   * fails leaves it false so the page can be asked for again. But it is set
   * after an `await`, and a flag set after an await guards nothing during the
   * await - which is the several seconds this spends fetching. Anything that
   * asks twice in that window gets two full runs, and the second one wires
   * every listener a second time on top of the first.
   *
   * That is not hypothetical. Opening a page from a card sets `location.hash`
   * and then routes; setting the hash also fires `hashchange`, which routes
   * again. So the router calls this twice on every arrival, a few
   * milliseconds apart, and both calls sailed past the guard.
   *
   * Doubled listeners are worse than they sound here, because choosing is a
   * toggle: the first handler turned the category on, the second saw it on
   * and - it being the first choice, which clears the rest - took everything
   * back off. The click was read, the rail redrawn, and nothing chosen.
   * Clicking a category did nothing at all, and only on the way in from
   * another page, because arriving straight at this one only routes once.
   *
   * `starting` covers exactly the window `started` cannot: from the first
   * line to the moment `started` takes over.
   */
  let started = false;
  let starting = false;
  let startPromise = null;
  /*
   * And the page's own markup, kept before anything is written over it.
   *
   * Saying "the data is not here yet" replaces the whole of the body - which
   * is also every element the working page is built out of. Say it once and
   * the pickers, the lists and the boxes this fills in are gone; a later
   * attempt that succeeds then goes looking for them and throws on the first
   * one, leaving the page stuck on a message about a file that is present.
   *
   * A load can fail for a moment and be worth trying again - a server that
   * blinked, a connection that dropped - so the message has to be undoable.
   * The markup is put back before anything is filled in.
   */
  let shell = null;
  let showing = null;                // the record on screen
  let kindWanted = '';               // the category chip that is down
  let wiki = null;                   // the community join, when there is one
  let realmeyeArchive = null;        // REALMEYE_ARCHIVE_UI: complete structured archive overlay
  let dungeonDifficulties = new Map(); // RealmEye's 1–10 dungeon ratings
  let skinBridge = null;              // exact local Viewer projection, when available
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
    if (!one) return '';
    side = Math.round(side * zoomed());
    if (one.icon) return '<img class="ix-art ix-art-file" width="' + side + '" height="' + side
      + '" src="' + esc(one.icon) + '" alt="">';
    if (!one.art || !all.sheet) return '';
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
  const dungeonKey = name => String(name || '').toLowerCase().replace(/[’]/g, "'")
    .replace(/\s+/g, ' ').trim();

  /*
   * The families, in the order somebody looks for them rather than
   * alphabetically: what you hold, who you are and what you look like, what
   * you fight, where you go, and the three that decide what goes on your gear.
   *
   * Skins sit beside Classes because that is the question they answer. The
   * thing in your bag that hands one over is a consumable and stays under
   * Consumables, filed as a skin unlocker - two different things, and the
   * card of each points at the other.
   */
  const KINDS = [
    ['item', 'Gear'], ['use', 'Consumables'], ['class', 'Classes'], ['skin', 'Skins'],
    ['enemy', 'Enemies'],
    ['portal', 'Dungeons'], ['place', 'Biomes'], ['set', 'Sets'],
    ['enchant', 'Enchantments'], ['pool', 'Pools']
  ];
  const KIND_SAY = Object.fromEntries(KINDS);

  /*
   * What to call a thing on its badge.
   *
   * "Gear" was right while every item was worn. It stopped being right when
   * the index started holding what the client puts in a bag as well as what a
   * class puts on, and a Mark of Oryx went about labelled as a piece of gear.
   * The family the client gives it is the better word, and where there is none
   * the kind still answers.
   */
  const sayKind = key => KIND_SAY[key]
    || (key ? key[0].toUpperCase() + key.slice(1) : key);

  /* Which of those a record is filed under, asked in one place by everything. */
  const filedAs = one => one.family || (one.use ? 'use' : one.kind);

  /*
   * The name of the thing a record was folded into, lower case, or ''.
   *
   * Carried on the row so a search can tell "amethyst", which is asking for
   * the shard, from "amethyst shard x5", which is asking for one of the ten
   * declarations behind it. A name rather than a flag, because the question
   * the list has to answer is whether the reader has already been shown what
   * they are looking for.
   */
  function foldedInto(one) {
    if (!one.folded) return '';
    const into = all.get(one.folded);
    return ((into && (into.said || into.name)) || one.folded).toLowerCase();
  }

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
      filedAs(one), one.alias || '', one.hidden ? 1 : 0,
      one.dev ? 1 : 0, foldedInto(one)]);
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
    all.built = (said.from && said.from.date) || said.built;
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
      drop: new Map(), dropBy: new Map(), spawn: new Map(), spawnBy: new Map(),
      dungeon: new Map(), dungeonBy: new Map(), tierDrop: new Map(), tierDropBy: new Map(),
      tierDropHands: said.tierDropHands || ['weapon', 'ability', 'armor', 'ring'],
      tierDropLists: said.tierDropLists || []
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
    for (const [from, to] of said.dungeon || []) {
      tie(wiki.dungeon, from, to);
      tie(wiki.dungeonBy, to, from);
    }
    for (const [enemy, handAt, tier, alternate, listAt] of said.tierDrop || []) {
      const entry = { hand: wiki.tierDropHands[handAt], tier, alternate: Boolean(alternate), listAt };
      tie(wiki.tierDrop, enemy, entry);
      tie(wiki.tierDropBy, entry.hand + ':' + tier + ':' + entry.alternate, enemy);
    }
  }

  async function loadSkinBridge() {
    if (skinBridge) return true;
    const raw = await fetch('assets/skins/generated/index-links.json')
      .then(response => response.ok ? response.json() : null).catch(() => null);
    if (!raw || raw.schema < 3 || !raw.reverse) return false;
    skinBridge = raw;
    return true;
  }

  /* REALMEYE_ARCHIVE_UI: structured archive data, separate from client facts. */
  async function loadRealmEyeArchive() {
    const bundle = window.ROTMG_BUNDLE;
    let raw = bundle && bundle.sources && bundle.sources.realmeyeEnrichmentText;
    if (!raw) {
      raw = await fetch('assets/index/realmeye-enrichment.json').then(r => (r.ok ? r.text() : ''))
        .catch(() => fetch('../data/Index/realmeye-enrichment.json').then(r => r.text()).catch(() => ''));
    }
    if (!raw) return;
    let said;
    try { said = JSON.parse(raw); } catch (err) { return; }
    realmeyeArchive = {
      home: (said.source && said.source.home) || 'https://www.realmeye.com/wiki/',
      page: new Map()
    };
    for (const [slug, ids] of Object.entries(said.pageIndex || {})) {
      realmeyeArchive.page.set(slug, (ids || []).filter(id => typeof id === 'string'));
    }
    for (const [id, data] of Object.entries(said.records || {})) {
      let one = all.get(id);
      if (!one && data.communityOnly) {
        one = {
          id,
          kind: data.kind || String(id).split(':', 1)[0] || 'other',
          name: data.name || String(id).replace(/^[^:]+:/, ''),
          communityOnly: true
        };
        all.set(id, one);
        if (!data.scopeOnly) light.push([one.id, one.name, filedAs(one), '', 0, 0, '']);
      }
      if (!one) continue;
      one.realmeyeArchive = data;
      /* REALMEYE_UNIFIED_PRESENTATION */
      const presentation = data.presentation || {};
      if (presentation.summary) one.realmeyeDescription = presentation.summary;
      if (presentation.rank && !one.rank) one.rank = presentation.rank;
      if (presentation.recommendedLevel !== undefined && one.recommendedLevel === undefined) {
        one.recommendedLevel = presentation.recommendedLevel;
      }
      if (data.clientZone) {
        if (data.clientZone.ground && !one.ground) one.ground = data.clientZone.ground;
        if (data.clientZone.tiles && !one.tiles) one.tiles = data.clientZone.tiles;
        if (data.clientZone.rank && !one.rank) one.rank = data.clientZone.rank;
      }
      if (data.sprite && !one.icon && !one.art) one.icon = data.sprite;
      if (Array.isArray(data.searchAliases) && data.searchAliases.length) {
        const row = light.find(entry => entry[0] === one.id);
        if (row) row[3] = [row[3], ...data.searchAliases].filter(Boolean).join(' ');
      }
      for (const page of data.pages || []) {
        const list = realmeyeArchive.page.get(page.slug) || [];
        if (!list.includes(one.id)) list.push(one.id);
        realmeyeArchive.page.set(page.slug, list);
      }
    }
  }

  /*
   * Dungeon difficulty is community data, just like the loot links beside it.
   * Keep it outside the client facts and name RealmEye wherever it is shown.
   * Names are normalised because the client and wiki disagree on punctuation
   * and capitalisation in a few places (notably Cave of A Thousand Treasures).
   */
  async function loadDungeonDifficulties() {
    const bundle = window.ROTMG_BUNDLE;
    let raw = bundle && bundle.sources && bundle.sources.dungeonText;
    if (!raw) {
      raw = await fetch('../data/Fame/dungeon-pages.txt').then(r => (r.ok ? r.text() : ''))
        .catch(() => '');
    }
    dungeonDifficulties = new Map();
    for (const line of String(raw || '').split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [name, value] = line.split('|'), difficulty = Number(value);
      if (Number.isFinite(difficulty) && Number.isInteger(difficulty * 2)
        && difficulty >= 1 && difficulty <= 10) dungeonDifficulties.set(dungeonKey(name), difficulty);
    }
  }

  function dungeonDifficultyOf(one) {
    if (!one || one.kind !== 'portal') return null;
    return dungeonDifficulties.get(dungeonKey(one.name)) || null;
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
    /*
     * A chip counts what the list will show, which is not every record: the
     * copies folded into another thing are that thing's rows, not their own,
     * and counting them made the chip promise ten Amethyst Shards and the
     * list hand back one.
     */
    const gather = test => {
      const ids = new Set();
      for (const one of all.values()) if (!one.folded && test(one)) ids.add(one.id);
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
      /*
       * What the class may hold, and what it may look like. A skin names the
       * class that wears it, so an Archer's chip answers both halves of
       * "show me the Archer" rather than only the half kept in a bag.
       */
      const ids = gather(x => x.id === one.id
        || (x.kind === 'item' && wants.has(x.slot))
        || (x.kind === 'skin'
          && (x.out || []).some(([how, to]) => how === 'worn by' && to === one.id)));
      chip(byClass, one.name, one.name, ids, one.id);
    }

    /*
     * What a character looks like, told apart by how you come by one.
     *
     * These were not in the index at all until the build stopped asking for
     * <Item />: fifteen hundred appearances the client declares, of which the
     * index held only the consumables that hand them over. A reader after
     * "which skins does the Shatters set give me" had nothing to ask.
     *
     * The three ways are the client's own, not a guess - the unlocker names
     * its skin by type, the set names its skin by type, and what neither names
     * is what you start with or what the game dresses you in itself.
     */
    const bySkin = group('Skins', 'client', 'how you come by one');
    const cameBy = how => gather(x => x.kind === 'skin'
      && (x.in || []).some(([said]) => said === how));
    const fromItem = cameBy('unlocks');
    const fromSet = cameBy('dresses you as');
    for (const [key, say, ids] of [
      ['unlocked', 'From an unlocker', fromItem],
      ['set', 'From a set', fromSet],
      ['given', 'Given to you', gather(x => x.kind === 'skin'
        && !fromItem.has(x.id) && !fromSet.has(x.id))]
    ]) {
      /* Pictured by one of its own that has a picture worth showing. */
      let shown = null;
      for (const id of ids) {
        const one = all.get(id);
        if (one && one.art && !one.hidden) { shown = one; break; }
      }
      chip(bySkin, key, say, ids, shown && shown.id);
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
     * And everything in a bag that nobody wears.
     *
     * Eight thousand things the client puts in your inventory are not gear:
     * marks, artifacts, keys, set shards, dyes, pet skins, the lot. They were
     * missing from the index entirely until the build stopped asking for the
     * EQUIPMENT label, and dropping them into Gears would have been the wrong
     * answer twice over - they are not gear, and four chips would have become
     * a wall of twenty. They get their own way in, named the way the client
     * names them.
     */
    const byBag = group('Kind of thing', 'client', 'what the client puts in a bag');
    const families = new Map();
    for (const one of all.values()) {
      if (one.kind !== 'item' || !one.family) continue;
      if (!families.has(one.family)) families.set(one.family, []);
      families.get(one.family).push(one);
    }
    for (const family of [...families.keys()].sort()) {
      /* Pictured by the first of its kind that has a picture and no warning. */
      const shown = families.get(family).find(one => one.art && !one.hidden);
      chip(byBag, family, family[0].toUpperCase() + family.slice(1),
        gather(x => x.family === family), shown && shown.id);
    }

    /*
     * And the things that fight back, told apart the way the client tells
     * them apart. Five thousand creatures with no way in but a name was the
     * biggest hole left in the rail: a reader after the gods, or after what
     * Oryx sends at a realm, had to know one by name to find any of them.
     */
    const byFoe = group('Enemies', 'client');
    const marked = label => gather(x => x.kind === 'enemy' && (x.labels || []).includes(label));
    const foes = [
      ['god', 'Gods', gather(x => Boolean(x.god))],
      ['hero', 'Heroes of Oryx', marked('HERO')],
      ['boss', 'Bosses', marked('BOSS')],
      ['miniboss', 'Minibosses', marked('MINIBOSS')],
      ['encounter', 'Encounters',
        gather(x => x.kind === 'enemy' && (x.labels || []).some(l => /ENCOUNTER$/.test(l)))],
      ['quest', 'Quest', marked('QUEST')],
      ['minion', 'Minions', marked('MINION')],
      ['critter', 'Critters', marked('CRITTER')],
      ['chest', 'Chests', marked('CHEST')],
      ['spawner', 'Spawners', gather(x => Boolean(x.spawns))]
    ];
    for (const [key, say, ids] of foes) {
      /* Pictured by one of its own that has a picture worth showing. */
      let shown = null;
      for (const id of ids) {
        const one = all.get(id);
        if (one && one.art && !one.hidden && !one.spawns) { shown = one; break; }
      }
      chip(byFoe, key, say, ids, shown && shown.id);
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
    chip(marks, 'hidden', 'No Category', gather(x => Boolean(x.hidden)));

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
        || (x.outLinks || []).some(([how, to]) => how === 'was seen in' && to === one.id)
        || (one.untiered || []).includes(x.id));
      chip(where, one.name, one.name, ids, one.id);
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
        /* A dungeon is also a way into the enemies explicitly listed on its
           community page, not only into the objects its drop table names. */
        for (const to of wiki.dungeon.get(at) || []) {
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
      /*
       * A folded copy waits to be asked for by name, and by a name that tells
       * it apart from the thing it was folded into. Ten stack sizes of one
       * shard are ten rows of the same thing to anyone browsing and to anyone
       * typing "amethyst"; type the number and you get the one in your bag.
       */
      if (one[6] && (!term || one[6].includes(term))) continue;
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
      /*
       * The first category is the anchor for everything below it. When that
       * category is also a record in its own right, put that exact record at
       * the head of the list instead of burying it alphabetically among the
       * things the category contains.
       *
       * Examples:
       *   Assassin      -> the Assassin class record
       *   Runic Tundra  -> the Runic Tundra place record
       *   The Shatters  -> the dungeon/portal record
       *
       * Generic categories such as Weapon or Bosses are unaffected unless an
       * actual surviving record carries exactly that displayed name.
       *
       * A typed search keeps its own relevance order above; this only changes
       * ordinary category browsing.
       */
      const anchorName = asked[0] && String(asked[0].say || '').trim().toLowerCase();

      out.sort((a, b) => {
        if (anchorName) {
          const aIsAnchor = String(a[1] || '').trim().toLowerCase() === anchorName;
          const bIsAnchor = String(b[1] || '').trim().toLowerCase() === anchorName;

          if (aIsAnchor !== bIsAnchor) return aIsAnchor ? -1 : 1;
        }

        return a[1].localeCompare(b[1]);
      });
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
  /*
   * How many of the groups can be unfolded, and folding to it in a way that
   * can be watched.
   *
   * Two things were wrong with doing this by redrawing the rail.
   *
   * It could not be seen happening. The bodies fold on a grid row going from
   * nothing to its own height, over a quarter of a second - but a body that
   * has just been written into the page starts at whatever it is and has
   * nothing to travel from, so every fold and unfold arrived as a jump. The
   * open state is a class on a section that is already there, so it is set as
   * a class and the transition already in the stylesheet does the rest.
   *
   * And it was measured at the wrong moment. How much room the rail has
   * depends on how wide it is, and it changes width whenever a choice is made
   * or taken back - over a third of a second, because the columns are
   * animated too. Measured at the click, the rail is still the width it was:
   * taking a choice off measured the narrow rail, decided almost nothing
   * would fit, and folded everything just as the room to unfold it arrived.
   * This is called again when the columns have finished sliding.
   *
   * The measuring itself has to be instant, or every step of it would be read
   * off a rail that is still moving - so the transition is held off while the
   * answer is worked out, the screen is put back where it was, and only then
   * is it let go and the answer applied. What you see is one movement from
   * where it was to where it belongs.
   */
  function fitGroups() {
    const box = el('ixFacets');
    const panel = el('ixBody');
    if (!box || !panel || !groups.length) return;
    const nodes = groups.map((one, at) => box.querySelector('[data-group="' + at + '"]'));
    if (!nodes.some(Boolean)) return;
    const was = nodes.map(node => !!(node && node.classList.contains('is-open')));
    const show = () => nodes.forEach((node, at) => {
      if (node) node.classList.toggle('is-open', !!groups[at].open);
    });

    box.classList.add('is-measuring');
    /* Unfolded, always, and trimmed from there - so a group that was folded
       when there was no room for it comes back the moment there is. */
    for (const one of groups) one.open = true;
    show();
    const room = () => (window.innerHeight || 900)
      - box.getBoundingClientRect().top - 24;
    for (let guard = groups.length; guard > 0; guard--) {
      if (box.scrollHeight <= room()) break;
      const still = groups.filter(one => one.open && !one.inSub);
      /* Never all of them shut: a rail of seven headings answers nothing. */
      if (still.length <= 1) break;
      still[still.length - 1].open = false;
      show();
    }

    nodes.forEach((node, at) => { if (node) node.classList.toggle('is-open', was[at]); });
    void box.offsetHeight;              // let that stand as where it starts
    box.classList.remove('is-measuring');
    show();
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
    if (kindWanted && filedAs(one) !== kindWanted) return false;
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
     * What is unfolded is worked out in fitGroups below, against the room the
     * rail actually has. A choice makes every other group shorter - after one
     * dungeon there are four classes left rather than nineteen - so what is
     * worth reading often fits where the whole rail did not.
     */
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
    box.innerHTML = rows.map(one => {
      const difficulty = dungeonDifficultyOf(all.get(one[0]));
      return '<button type="button" class="ix-row' + (one[0] === (showing && showing.id) ? ' is-on' : '')
        + '" data-open="' + esc(one[0]) + '">'
        + artCell(all.get(one[0]), 20)
        + '<b>' + esc(one[1]) + '</b>'
        + (difficulty ? '<small class="ix-difficulty" title="RealmEye difficulty rating">☠ ' + difficulty + '/10</small>' : '')
        + '<i class="ix-kind is-' + esc(one[2].replace(/ /g, '-')) + '">' + esc(sayKind(one[2])) + '</i>'
        + (one[4] ? '<u class="ix-hidden" title="Some tools do not offer this">hidden</u>' : '')
        + star(one[0])
        + '</button>';
    }).join('') || '<p class="ix-none">Nothing by that name.</p>';
    fitList(box);
  }

  /*
   * The list is as wide as its longest name, while there is nothing beside it.
   *
   * With no card open the third column is empty and the list had a fixed cap,
   * so "Antinomy Mad God Token x10" came out as "Antinomy Mad God T…" with
   * half the screen standing empty to the right of it. The cap is a measured
   * length now: every name is asked how much it is losing to the ellipsis and
   * the column is given it back, up to a point - a column wider than nine
   * hundred pixels is a name at one edge and its family at the other.
   *
   * A length rather than max-content, because the panels animate between
   * arrangements and grid only interpolates lengths.
   */
  function fitList(box) {
    const body = el('ixBody');
    if (!body || body.classList.contains('has-card')) return;
    /*
     * What the widest row would need if nothing clipped it: everything in the
     * row but the name, plus the name at its full length. Asked of the row
     * rather than of the panel, because the panel is exactly as wide as the
     * cap this is trying to work out.
     */
    let need = 0;
    for (const row of box.querySelectorAll('.ix-row')) {
      const name = row.querySelector('b');
      if (!name) continue;
      need = Math.max(need, row.clientWidth - name.clientWidth + name.scrollWidth);
    }
    if (!need) { body.style.removeProperty('--ix-listw'); return; }
    /* The panel around the list: its padding, its border, its scrollbar. */
    const card = box.closest('.card') || box;
    const round = card.getBoundingClientRect().width - box.clientWidth;
    /*
     * Measured against the row of panels, not the window. A window is not
     * always willing to say how wide it is - an embedded one reports nought -
     * and half of nought is a column that never grows past its floor.
     */
    const across = body.getBoundingClientRect().width;
    const cap = Math.min(900, across ? across * 0.5 : 900);
    const room = Math.max(320, Math.min(need + round + 2, cap));
    body.style.setProperty('--ix-listw', Math.round(room) + 'px');
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
  const PIC_SAY = { client: "the game's own art",
    skin: 'the skin it gives you', piece: 'one of its pieces' };
  const WORN_SAY = { MAXHP: 'life', MAXMP: 'magic', ATT: 'attack', DEF: 'defence',
    SPD: 'speed', DEX: 'dexterity', VIT: 'vitality', WIS: 'wisdom' };

  function factsOf(one) {
    const bits = [];
    if (one.hand) bits.push(['slot', one.hand + ' (' + one.slot + ')']);
    /* What it is, when it is not gear: a mark, a key, a pet skin. */
    if (one.family) bits.push(['kind', one.family]);
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
    if (one.rank) bits.push(['zone', one.rank]);
    if (one.recommendedLevel !== undefined) bits.push(['recommended level', one.recommendedLevel + '+']);
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

  function drawDungeonDifficulty(one) {
    const difficulty = dungeonDifficultyOf(one);
    if (!difficulty) return '';
    return '<p class="ix-dungeon-difficulty"><b>☠ Difficulty ' + difficulty
      + ' / 10</b><span>difficulty rating</span></p>';
  }

  function drawBiomeLoot(one) {
    if (one.kind !== 'place' || !one.loot) return '';
    const rows = [];
    const tiers = Object.entries(one.loot.tiers || {}).filter(([, values]) => values.length);
    if (tiers.length) rows.push('<div class="ix-link-row"><i>tiered loot</i><span>'
      + tiers.map(([slot, values]) => '<b class="ix-loot-tier">' + esc(slot) + ' '
        + esc(values.map(value => 'T' + value).join(', ')) + '</b>').join('') + '</span></div>');
    const named = (ids, label) => {
      const items = (ids || []).map(id => all.get(id)).filter(Boolean);
      if (!items.length) return;
      rows.push('<div class="ix-link-row"><i>' + esc(label) + '</i><span>'
        + items.map(item => '<button type="button" class="ix-jump" data-open="' + esc(item.id) + '">'
          + art(item, 18) + esc(item.said || item.name) + '</button>').join('') + '</span></div>');
    };
    named(one.untiered, 'untiered gear');
    named(one.setTier, 'set-tier gear');
    const dungeons = (one.dungeons || []).map(id => all.get(id)).filter(Boolean);
    if (dungeons.length) rows.push('<div class="ix-link-row"><i>dungeon entrances</i><span>'
      + dungeons.map(item => '<button type="button" class="ix-jump" data-open="' + esc(item.id) + '">'
        + art(item, 18) + esc(item.said || item.name) + '</button>').join('') + '</span></div>');
    return rows.length ? '<div class="ix-said-block ix-biome-loot"><h4>Loot available in this biome</h4>'
      + '<div class="ix-links">' + rows.join('') + '</div></div>' : '';
  }

  /*
   * The way out to the community's own page.
   *
   * Most records have one of their own. A dozen sets do not - the wiki files
   * them under a family, Oryxmas Gear or Venerable Gear, which is what every
   * one of their pieces links to - so those say where they are actually going
   * rather than promising a page about the set.
   */
  /* REALMEYE_SOURCE_LINKS_V9 */
  function archiveSourcePage(one) {
    const data = one && one.realmeyeArchive;
    if (!data) return null;
    if (data.sourcePage && data.sourcePage.slug) return data.sourcePage;
    /* REALMEYE_SUBBIOME_MODEL_V11: aggregate records have no single source page. */
    if (data.aggregateBiome) return null;
    const pages = (data.pages || []).filter(page => page && page.slug);
    if (!pages.length) return null;
    return pages.slice().sort((a, b) => {
      const aEnemies = /-enemies$/.test(a.slug || '') ? 1 : 0;
      const bEnemies = /-enemies$/.test(b.slug || '') ? 1 : 0;
      const aScoped = a.scope ? 1 : 0, bScoped = b.scope ? 1 : 0;
      return aScoped - bScoped || aEnemies - bEnemies
        || String(a.slug).length - String(b.slug).length
        || String(a.slug).localeCompare(String(b.slug));
    })[0];
  }

  function awayTo(one) {
    const archivePage = archiveSourcePage(one);
    if (archivePage) {
      const many = Number((one.realmeyeArchive && one.realmeyeArchive.sourcePageCount)
        || ((one.realmeyeArchive && one.realmeyeArchive.pages) || []).length || 1);
      const href = archivePage.url || ((realmeyeArchive && realmeyeArchive.home)
        || 'https://www.realmeye.com/wiki/') + archivePage.slug;
      return '<a class="ix-away" target="_blank" rel="noreferrer noopener" href="'
        + esc(href) + '" title="' + esc(many > 1
          ? ('RealmEye source page (' + many + ' archived pages are merged into this record)')
          : 'Its archived RealmEye source page') + '">RealmEye ↗</a>';
    }
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
    const cardLinks = one.kind === 'place' ? links.filter(([how]) => how !== 'was seen in') : links;
    const where = one.from
      ? (all.files[one.from[0]] || '?') + (one.from[1] ? ' · ' + one.from[1] : '')
      : 'not declared in the client';

    box.innerHTML = '<header class="ix-card-head">'
      + artCell(one, 44)
      + '<span class="ix-kind is-' + esc(filedAs(one).replace(/ /g, '-'))
        + '">' + esc(sayKind(filedAs(one))) + '</span>'
      + '<h3>' + esc(one.said || one.name) + '</h3>'
      + drawPlaceGuardian(one)
      + (one.alias ? '<code>' + esc(one.alias) + '</code>' : '')
      + awayTo(one)
      + star(one.id)
      + '</header>'
      + drawRecordDescription(one)
      + drawDungeonDifficulty(one)
      + drawDoes(one)
      + (one.hidden
        ? '<p class="ix-warn"><b>The other tools do not offer this</b> — ' + esc(one.hidden.join('; ')) + '.</p>'
        : '')
      + (one.benchWhy ? '<p class="ix-warn"><b>Not offered on the bench</b> — ' + esc(one.benchWhy) + '.</p>' : '')
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
      + (one.kind === 'place' ? drawPlaceKnowledge(one) : drawRealmEyeArchive(one))
      + drawFolds(one)
      + drawSlots(one)
      + (cardLinks.length ? drawLinks(cardLinks) : '')
      + (one.kind === 'place' ? '' : drawWiki(one))
      + (one.communityOnly ? '' : '<p class="ix-from">Read from <code>' + esc(where) + '</code> in the game’s own files</p>');
  }

  /*
   * Every time the client declares this thing.
   *
   * A stack size is its own object, and so is the soulbound copy, so one
   * Amethyst Shard is eleven declarations with eleven numbers. The list shows
   * one row for them, which is what a reader wants while browsing and exactly
   * not what they want once they are holding one - "which of these is in my
   * bag" is answered by the number, and the number is here.
   */
  function drawFolds(one) {
    if (!one.folds || one.folds.length < 2) return '';
    return '<div class="ix-folds"><b>This common entry represents '
      + one.folds.length + ' client declarations</b>'
      + '<ul>' + one.folds.map(x =>
        '<li><span>' + esc(x.as) + '</span>'
        + (x.why ? '<em>' + esc(x.why) + '</em>' : '')
        + (x.diff ? '<small>' + esc(x.diff) + '</small>' : '')
        + '<code>' + esc((all.files[x.from && x.from[0]] || '?')
          + (x.from && x.from[1] ? ' · ' + x.from[1] : '')) + '</code></li>').join('')
      + '</ul></div>';
  }

  /*
   * What the community says about this thing, kept in its own block and named
   * as theirs. A drop list is not a client declaration and it is not a rate:
   * it is what players have seen and written down, and it can be a patch out
   * of date. Shown, because nothing else in the game's own files answers
   * "where does this come from"; fenced, because it is somebody else's claim.
   */
  const REALMEYE_RELATION_SAY = {
    dropped_by: 'dropped by', obtained_through: 'obtained through',
    reskin_of: 'reskin of', has_reskin: 'reskins', spawns: 'spawns', spawned_by: 'spawned by',
    set_piece: 'set pieces', class: 'class', dungeon_boss: 'bosses',
    dungeon_miniboss: 'minibosses', dungeon_enemy: 'enemies', dungeon_minion: 'minions',
    dungeon_boss_minion: 'boss minions', dungeon_treasure_boss: 'treasure room boss',
    dungeon_hazard: 'hazards', dungeon_drop_interest: 'drops of interest',
    biome_regular_enemy: 'regular enemies', biome_minion: 'minions', biome_hero: 'Heroes of Oryx',
    biome_hero_minion: 'Hero minions', biome_encounter: 'encounters',
    biome_encounter_minion: 'encounter minions', biome_beacon_guardian: 'beacon guardian',
    biome_beacon_minion: 'beacon minions', biome_drop_interest: 'drops of interest',
    contains_biome: 'sub-biomes', part_of_biome: 'part of biome'
  };
  const realmFactSay = key => String(key || '').replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());

  function realmFactRows(value, prefix, rows) {
    if (prefix === 'table' || prefix.startsWith('table.')) return;
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) {
      if (value.every(x => x === null || ['string', 'number', 'boolean'].includes(typeof x))) {
        rows.push([prefix, value.join(', ')]);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        realmFactRows(child, prefix ? prefix + '.' + key : key, rows);
      }
      return;
    }
    rows.push([prefix, value]);
  }

  function realmTables(value, out) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.headers) && Array.isArray(value.rows)) { out.push(value); return; }
    for (const child of Object.values(value)) realmTables(child, out);
  }

  function realmRelationTarget(relation) {
    if (relation && relation.to && all.has(relation.to)) return all.get(relation.to);
    if (!relation || !relation.toRealmEye || !realmeyeArchive) return null;
    const ids = realmeyeArchive.page.get(relation.toRealmEye) || [];
    for (const id of ids) if (all.has(id)) return all.get(id);
    return null;
  }

  function realmRelationGroups(one) {
    const grouped = new Map();
    const add = (type, relation) => {
      if (!type || !relation) return;
      const target = realmRelationTarget(relation);
      const key = target ? 'id:' + target.id
        : relation.toRealmEye ? 'slug:' + relation.toRealmEye
        : relation.label ? 'label:' + relation.label : '';
      if (!key) return;
      if (!grouped.has(type)) grouped.set(type, new Map());
      const bucket = grouped.get(type);
      let item = bucket.get(key);
      if (!item) {
        item = { relation: { ...relation }, target, scopes: new Set() };
        bucket.set(key, item);
      }
      if (relation.scope) item.scopes.add(relation.scope);
    };

    for (const relation of (one.realmeyeArchive && one.realmeyeArchive.relations) || []) {
      add(relation.type || 'related', relation);
    }

    /* A walked-realm observation and an archive roster answer the same reader
       question. Keep one row and one target, not one row per source. */
    if (one.kind === 'place') {
      for (const [how, id] of one.inLinks || []) {
        if (how !== 'was seen in') continue;
        const target = all.get(id);
        if (target && target.kind === 'enemy') add('biome_regular_enemy', { to: id });
      }

      /* The legacy compact wiki join may still cover an item the full archive
         does not resolve. Fold it into notable drops instead of drawing the
         old "What players have written down" block underneath. */
      if (wiki) {
        const mine = wiki.page.get(one.id);
        for (const at of (mine === undefined ? [] : (wiki.drop.get(mine) || []))) {
          const candidates = (wiki.about.get(at) || []).map(id => all.get(id)).filter(Boolean);
          const target = candidates.find(x => !x.twin) || candidates[0];
          const page = wiki.pages[at] || ['', ''];
          add('biome_drop_interest', target ? { to: target.id } : { toRealmEye: page[0] });
        }
      }
    }
    return grouped;
  }

  function relationItems(groups, type) {
    return [...(groups.get(type) || new Map()).values()];
  }

  /* REALMEYE_PRESENTATION_V8 */
  function relationDisplayName(one) {
    const name = String(one ? (one.said || one.name || '') : '');
    return name.replace(/\s*\(New\)\s*$/i, '').trim();
  }

  function compactTierRange(values) {
    const nums = [...new Set((values || []).map(Number).filter(Number.isFinite))]
      .sort((a, b) => a - b);
    if (!nums.length) return '';
    const ranges = [];
    let first = nums[0], last = nums[0];
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === last + 1) { last = nums[i]; continue; }
      ranges.push([first, last]);
      first = last = nums[i];
    }
    ranges.push([first, last]);
    return ranges.map(([from, to]) => from === to ? 'T' + from : 'T' + from + '–T' + to).join(', ');
  }

  function drawRecordDescription(one) {
    const descriptions = [];
    const seen = new Set();
    for (const value of [one && one.about, one && one.realmeyeDescription]) {
      const text = String(value || '').trim();
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      if (!text || seen.has(key)) continue;
      seen.add(key);
      descriptions.push(text);
    }
    if (!descriptions.length) return '';
    return '<details class="ix-card-description"><summary>Description</summary>'
      + '<div>' + descriptions.map(text => '<p>' + esc(text) + '</p>').join('') + '</div></details>';
  }

  function drawKnowledgeTarget(item) {
    const target = item.target || realmRelationTarget(item.relation);
    const scopes = [...(item.scopes || [])].sort();
    const notes = [...(item.notes || [])].filter(Boolean);
    const titleBits = [];
    if (scopes.length) titleBits.push('Area: ' + scopes.join(', '));
    if (notes.length) titleBits.push(notes.join(' · '));
    const title = titleBits.length ? ' title="' + esc(titleBits.join(' — ')) + '"' : '';
    if (target) {
      return '<button type="button" class="ix-jump" data-open="' + esc(target.id) + '"' + title + '>'
        + art(target, 14) + esc(relationDisplayName(target)) + '</button>';
    }
    if (item.relation && item.relation.toRealmEye) {
      const slug = item.relation.toRealmEye;
      return '<a class="ix-jump is-away" target="_blank" rel="noreferrer noopener" href="'
        + esc(realmeyeArchive.home + slug) + '"' + title + '>'
        + esc(slug.replace(/-/g, ' ')) + '</a>';
    }
    if (item.relation && item.relation.label) {
      return '<span class="ix-data-chip"' + title + '>' + esc(item.relation.label) + '</span>';
    }
    return '';
  }

  function drawKnowledgeRow(label, items) {
    const chips = items.map(drawKnowledgeTarget).filter(Boolean);
    if (!chips.length) return '';
    return '<div class="ix-link-row"><i>' + esc(label) + '</i><span>' + chips.join('') + '</span></div>';
  }

  function resolvedButtons(ids) {
    return [...new Set(ids || [])].map(id => all.get(id)).filter(Boolean).map(target => ({
      relation: { to: target.id }, target, scopes: new Set()
    }));
  }

  function archiveRefItem(ref, scope) {
    if (!ref) return null;
    const relation = {};
    if (ref.to && all.has(ref.to)) relation.to = ref.to;
    if (ref.slug) relation.toRealmEye = ref.slug;
    const target = realmRelationTarget(relation);
    const item = { relation, target, scopes: new Set() };
    if (scope) item.scopes.add(scope);
    return target || relation.toRealmEye ? item : null;
  }

  function drawDropRows(rows) {
    const shown = [];
    for (const row of rows || []) {
      const items = (row.items || []).map(ref => archiveRefItem(ref, row.scope)).filter(Boolean);
      const sources = (row.sources || []).map(ref => archiveRefItem(ref, row.scope)).filter(Boolean);
      const itemChips = items.map(drawKnowledgeTarget).filter(Boolean);
      const sourceChips = sources.map(drawKnowledgeTarget).filter(Boolean);
      if (!itemChips.length) continue;
      shown.push('<div class="ix-drop-row"><span class="ix-drop-items">' + itemChips.join('') + '</span>'
        + (sourceChips.length ? '<em>from</em><span class="ix-drop-sources">' + sourceChips.join('') + '</span>' : '')
        + '</div>');
    }
    if (!shown.length) return '';
    return '<div class="ix-link-row ix-drop-interest"><i>notable drops</i><span class="ix-drop-grid">'
      + shown.join('') + '</span></div>';
  }

  /* REALMEYE_CANONICAL_PLACE_UI_V7 */
  function knowledgeItemKey(item) {
    if (!item) return '';
    const target = item.target || realmRelationTarget(item.relation);
    if (target) return 'id:' + target.id;
    if (item.relation && item.relation.toRealmEye) return 'slug:' + item.relation.toRealmEye;
    if (item.relation && item.relation.label) return 'label:' + item.relation.label;
    return '';
  }

  function mergeKnowledgeItem(into, item, note) {
    const key = knowledgeItemKey(item);
    if (!key) return;
    let kept = into.get(key);
    if (!kept) {
      kept = {
        relation: { ...(item.relation || {}) },
        target: item.target || realmRelationTarget(item.relation),
        scopes: new Set(item.scopes || []),
        notes: new Set(item.notes || [])
      };
      into.set(key, kept);
    } else {
      for (const scope of item.scopes || []) kept.scopes.add(scope);
      for (const text of item.notes || []) kept.notes.add(text);
    }
    if (note) kept.notes.add(note);
  }

  function canonicalPlaceRoles(one, groups) {
    const result = { guardian: [], encounters: [], heroes: [], enemies: [] };
    const used = new Set();
    const take = (bucket, types) => {
      const found = new Map();
      for (const type of types) {
        for (const item of relationItems(groups, type)) mergeKnowledgeItem(found, item);
      }
      for (const item of found.values()) {
        const key = knowledgeItemKey(item);
        if (!key || used.has(key)) continue;
        used.add(key);
        result[bucket].push(item);
      }
    };

    /* A guardian and an encounter are explicit roles. A hero is next. Every
       remaining creature, including every flavour of minion, is simply an
       enemy from the biome reader's point of view. */
    take('guardian', ['biome_beacon_guardian']);
    take('encounters', ['biome_encounter']);
    take('heroes', ['biome_hero']);
    take('enemies', [
      'biome_regular_enemy', 'biome_minion', 'biome_hero_minion',
      'biome_encounter_minion', 'biome_beacon_minion'
    ]);
    return result;
  }

  function dropSourceName(ref, scope) {
    const item = archiveRefItem(ref, scope);
    if (!item) return '';
    const target = item.target || realmRelationTarget(item.relation);
    if (target) return target.said || target.name || '';
    return (item.relation && item.relation.toRealmEye)
      ? item.relation.toRealmEye.replace(/-/g, ' ') : '';
  }

  function canonicalPlaceLoot(one, groups) {
    const kept = new Map();

    /* Structured drop rows are the richest observation, so they are admitted
       first. Drop sources are evidence for the item relationship; they become
       hover text rather than a second monster chip in the Loot section. */
    for (const row of (one.realmeyeArchive && one.realmeyeArchive.dropRows) || []) {
      const sources = [...new Set((row.sources || []).map(ref => dropSourceName(ref, row.scope)).filter(Boolean))];
      const note = sources.length ? 'Drops from ' + sources.join(', ') : '';
      for (const ref of row.items || []) {
        const item = archiveRefItem(ref, row.scope);
        if (item) mergeKnowledgeItem(kept, item, note);
      }
    }

    /* If a page has no structured item/source table, its simple drop relation
       still belongs here. */
    for (const item of relationItems(groups, 'biome_drop_interest')) {
      mergeKnowledgeItem(kept, item);
    }

    /* Client/Atlas-normalised loot comes next. If the same item already has a
       notable drop row, this only enriches that one item; it never draws a
       second copy under another label. */
    for (const item of resolvedButtons(one.setTier)) mergeKnowledgeItem(kept, item);
    for (const item of resolvedButtons(one.untiered)) mergeKnowledgeItem(kept, item);
    return [...kept.values()];
  }

  function drawPlaceGuardian(one) {
    if (!one || one.kind !== 'place') return '';
    const roles = canonicalPlaceRoles(one, realmRelationGroups(one));
    const chips = roles.guardian.map(drawKnowledgeTarget).filter(Boolean);
    if (!chips.length) return '';
    return '<span class="ix-place-guardian"><small>guardian</small>' + chips.join('') + '</span>';
  }

  /* REALMEYE_SUBBIOME_MODEL_V11 */
  function placePopulationTotal(one) {
    const data = one && one.realmeyeArchive;
    if (data && data.population && Number.isFinite(Number(data.population.total))) {
      return Number(data.population.total);
    }
    const roles = canonicalPlaceRoles(one, realmRelationGroups(one));
    return roles.enemies.length + roles.heroes.length + roles.encounters.length;
  }

  function placeGenerationStatus(one) {
    return one && one.realmeyeArchive && one.realmeyeArchive.generationStatus;
  }

  function drawSubBiomeTarget(item) {
    const target = item.target || realmRelationTarget(item.relation);
    if (!target) return drawKnowledgeTarget(item);
    const count = placePopulationTotal(target);
    const status = placeGenerationStatus(target);
    const titleBits = [];
    if (status && status.label) titleBits.push(status.label);
    const title = titleBits.length ? ' title="' + esc(titleBits.join(' — ')) + '"' : '';
    return '<button type="button" class="ix-jump ix-sub-biome" data-open="' + esc(target.id) + '"' + title + '>'
      + art(target, 14) + '<span>' + esc(relationDisplayName(target)) + '</span>'
      + '<small>' + count + '</small></button>';
  }

  function drawPopulationEmpty(one) {
    const status = placeGenerationStatus(one);
    if (status && status.code === 'not-generating') {
      return '<div class="ix-empty-population">No current generated population — '
        + esc(status.label) + '.</div>';
    }
    if (one && one.realmeyeArchive && one.realmeyeArchive.scopeOnly) {
      return '<div class="ix-empty-population">No population is currently listed for this sub-biome.</div>';
    }
    return '';
  }

  function drawPlaceKnowledge(one) {
    if (one.kind !== 'place') return '';
    const groups = realmRelationGroups(one);
    const roles = canonicalPlaceRoles(one, groups);
    const sections = [];

    const population = [];
    if (roles.enemies.length) population.push(drawKnowledgeRow('enemies', roles.enemies));
    if (roles.heroes.length) population.push(drawKnowledgeRow('Heroes of Oryx', roles.heroes));
    if (roles.encounters.length) population.push(drawKnowledgeRow('encounters', roles.encounters));
    const populationTotal = placePopulationTotal(one);
    const emptyPopulation = drawPopulationEmpty(one);
    if (population.length || emptyPopulation) {
      sections.push('<details class="ix-knowledge-section" open><summary>Population <small class="ix-section-count">'
        + populationTotal + '</small></summary><div class="ix-links">'
        + population.join('') + emptyPopulation + '</div></details>');
    }

    const lootRows = [];
    const tiers = Object.entries((one.loot && one.loot.tiers) || {})
      .filter(([, values]) => values && values.length);
    if (tiers.length) {
      lootRows.push('<div class="ix-link-row"><i>tiered</i><span>' + tiers.map(([kind, values]) =>
        '<span class="ix-data-chip"><b>' + esc(kind) + '</b> ' + esc(compactTierRange(values)) + '</span>').join('')
        + '</span></div>');
    }
    const loot = canonicalPlaceLoot(one, groups);
    if (loot.length) lootRows.push(drawKnowledgeRow('items', loot));
    const dungeons = resolvedButtons(one.dungeons);
    if (dungeons.length) lootRows.push(drawKnowledgeRow('dungeon entrances', dungeons));
    if (lootRows.length) {
      sections.push('<details class="ix-knowledge-section" open><summary>Loot</summary><div class="ix-links">'
        + lootRows.join('') + '</div></details>');
    }

    const sub = relationItems(groups, 'contains_biome');
    const subNames = ((one.realmeyeArchive && one.realmeyeArchive.subBiomes) || []).slice();
    if (sub.length || subNames.length) {
      let row = '';
      if (sub.length) row = '<div class="ix-link-row"><i>areas</i><span>'
        + sub.map(drawSubBiomeTarget).filter(Boolean).join('') + '</span></div>';
      else row = '<div class="ix-link-row"><i>areas</i><span>'
        + subNames.map(name => '<span class="ix-data-chip">' + esc(name) + '</span>').join('')
        + '</span></div>';
      sections.push('<details class="ix-knowledge-section" open><summary>Sub-biomes</summary><div class="ix-links">'
        + row + '</div></details>');
    }

    return sections.length ? '<div class="ix-knowledge-block">' + sections.join('') + '</div>' : '';
  }

  function drawRealmEyeArchive(one) {
    const data = one.realmeyeArchive;
    if (!data || one.kind === 'place') return '';
    const facts = [];
    realmFactRows(data.facts || {}, '', facts);
    const shownFacts = facts.slice(0, 40);
    const groups = realmRelationGroups(one);
    const relationRows = [...groups].map(([type, values]) =>
      drawKnowledgeRow(REALMEYE_RELATION_SAY[type] || realmFactSay(type), [...values.values()])
    ).filter(Boolean).join('');
    const tables = [];
    realmTables((data.facts || {}).table, tables);
    const tableHtml = tables.slice(0, 6).map(table => {
      const headers = (table.headers || []).slice(0, 8);
      const rows = (table.rows || []).slice(0, 20);
      if (!headers.length && !rows.length) return '';
      return '<div class="ix-realm-table">'
        + (table.caption ? '<b>' + esc(table.caption) + '</b>' : '')
        + '<table>'
        + (headers.length ? '<thead><tr>' + headers.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead>' : '')
        + '<tbody>' + rows.map(row => '<tr>' + row.slice(0, 8).map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') + '</tbody>'
        + '</table></div>';
    }).join('');
    if (!shownFacts.length && !relationRows && !tableHtml) return '';
    return '<div class="ix-knowledge-block"><details class="ix-knowledge-section" open><summary>Details</summary>'
      + (shownFacts.length ? '<dl class="ix-facts">' + shownFacts.map(([key, value]) =>
        '<div><dt>' + esc(realmFactSay(key.split('.').pop())) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>' : '')
      + (relationRows ? '<div class="ix-links">' + relationRows + '</div>' : '')
      + tableHtml + '</details></div>';
  }

  function drawWiki(one) {
    if (!wiki) return '';
    const mine = wiki.page.get(one.id);
    if (mine === undefined) return '';
    const rows = [];
    const say = (how, list) => {
      if (!list || !list.length) return;
      rows.push('<div class="ix-link-row"><i>' + esc(how) + '</i><span>'
        + list.slice(0, 24).map(at => {
          const [slug, title] = wiki.pages[at] || ['', '?'];
          const here = (wiki.about.get(at) || [])
            .map(id => all.get(id)).filter(Boolean);
          const archiveHere = realmeyeArchive
            ? (realmeyeArchive.page.get(slug) || []).map(id => all.get(id)).filter(Boolean) : [];
          const candidates = [...here, ...archiveHere];
          const pick = candidates.find(x => !x.twin) || candidates[0];
          if (pick) {
            return '<button type="button" class="ix-jump" data-open="' + esc(pick.id) + '">'
              + art(pick, 14) + esc(relationDisplayName(pick)) + '</button>';
          }
          return '<a class="ix-jump is-away" target="_blank" rel="noreferrer noopener"'
            + ' href="' + esc(wiki.home + slug) + '">' + esc(title) + '</a>';
        }).join('')
        + (list.length > 24 ? '<em>and ' + (list.length - 24) + ' more</em>' : '')
        + '</span></div>');
    };
    say('dropped by', wiki.dropBy.get(mine));
    say('listed as dropping', wiki.drop.get(mine));
    if (one.kind === 'item' && one.hand && one.tier !== undefined) {
      const alternate = one.hand === 'weapon' && (one.labels || []).includes('SUBTYPE');
      const listed = [...new Set(wiki.tierDropBy.get(one.hand + ':' + one.tier + ':' + alternate) || [])];
      say('tier drop locations', listed);
    }
    say('found in', wiki.dungeonBy.get(mine));
    say('enemies found here', wiki.dungeon.get(mine));
    const tiers = wiki.tierDrop.get(mine) || [];
    if (tiers.length) {
      const labels = { weapon: 'weapons', ability: 'abilities', armor: 'armor', ring: 'rings' };
      rows.push('<div class="ix-link-row"><i>listed tier drops</i><span>'
        + tiers.map(entry => {
          const slug = wiki.tierDropLists[entry.listAt] || '';
          return '<a class="ix-jump is-away" target="_blank" rel="noreferrer noopener" href="'
            + esc(wiki.home + slug) + '">T' + entry.tier + (entry.alternate ? ' alternate ' : ' ')
            + esc(labels[entry.hand] || entry.hand) + '</a>';
        }).join('') + '</span></div>');
    }
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
    /* REALMEYE_NEUTRAL_SOURCE_UI */
    return '<div class="ix-knowledge-block"><section class="ix-knowledge-section"><h4>Related data</h4>'
      + '<div class="ix-links">' + rows.join('') + '</div></section></div>';
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
    const viewerTargets = (skinBridge && skinBridge.reverse && skinBridge.reverse[one.id]) || [];
    const viewerDoors = viewerTargets.map((target, index) => {
      const many = viewerTargets.length > 1;
      const what = target.kind === 'dye'
        ? (target.target === 'clothing' ? 'clothing dye' : 'accessory dye')
        : (target.reason === 'exact-set-skin-family' ? 'set skin' : 'skin');
      return '<button type="button" class="ix-door" data-skin-target="'
        + esc(encodeURIComponent(JSON.stringify(target))) + '" title="Open the exact linked '
        + esc(what) + ' in the local Skin Viewer">Open in Skin Viewer'
        + (many ? ' · ' + esc(what) : '') + '</button>';
    });
    if (!doors.length && !viewerDoors.length) return '';
    return '<p class="ix-doors">' + doors.map(([go, say, why]) =>
      '<button type="button" class="ix-door" data-door="' + go + '" title="' + esc(why) + '">'
      + esc(say) + '</button>').join('') + viewerDoors.join('') + '</p>';
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
            + art(one, 14) + esc(one ? relationDisplayName(one) : id) + '</button>';
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
      const skinDoor = event.target.closest('[data-skin-target]');
      if (skinDoor && typeof window.openSkinViewerTarget === 'function') {
        try { window.openSkinViewerTarget(JSON.parse(decodeURIComponent(skinDoor.dataset.skinTarget))); }
        catch (error) { console.error('Invalid Skin Viewer target', error); }
      }
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
    /*
     * The nine families the page was built around, and then whatever the
     * client's own bag turned out to hold - marks, keys, dyes, pet skins. They
     * come after, in alphabetical order, because they are the long tail and
     * the first nine are what anybody is actually looking for.
     */
    const extra = kindsLeft
      ? [...kindsLeft.keys()].filter(key => !KIND_SAY[key]).sort()
      : [];
    el('ixKinds').innerHTML = [...KINDS.map(([kind]) => kind), ...extra]
      .filter(kind => kind === kindWanted || !kindsLeft || kindsLeft.get(kind))
      .map(kind =>
        '<button type="button" class="ix-chip is-' + esc(kind.replace(/ /g, '-'))
        + (kind === kindWanted ? ' is-on' : '') + '" data-kind="' + esc(kind) + '">'
        + esc(sayKind(kind))
        + (kindsLeft && kindsLeft.get(kind)
          ? '<i>' + kindsLeft.get(kind).toLocaleString('en-US') + '</i>' : '')
        + '</button>').join('');
  }

  async function runStart() {
    const box = el('ixBody');
    if (!box) return false;
    readLoved();
    if (!await load()) {
      if (shell === null) shell = box.innerHTML;
      box.innerHTML = '<p class="tc-missing">The index is not built yet. '
        + 'Run <code>node tools/build-index.js</code>.</p>';
      return false;
    }
    if (shell !== null) { box.innerHTML = shell; shell = null; }
    // The sheet's address, once, for every picture on the page to point at.
    {
      const bundle = window.ROTMG_BUNDLE;
      el('ixBody').style.setProperty('--ix-sheet', 'url('
        + ((bundle && bundle.indexSheet) || 'assets/index/sheet.png') + ')');
    }
    await Promise.all([loadWiki(), loadDungeonDifficulties(), loadRealmEyeArchive(), loadSkinBridge()]);
    buildFacets();
    wire();
    /* The same pass every change makes, so the first screen is not a special
       case that forgets to unfold anything. */
    repaint();
    /*
     * And measured again on the next frame.
     *
     * The first pass runs the moment the rail is written, before the browser
     * has laid any of it out - so it reads a rail taller than the one that
     * ends up on screen and folds groups that would have fitted. On a wide
     * window that left one heading unfolded out of seven where six fit.
     */
    requestAnimationFrame(fitGroups);
    /* What you can browse: the copies folded into another thing are its rows. */
    el('ixBuilt').textContent = light.filter(one => !one[6]).length.toLocaleString('en-US')
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

    /* And whenever the columns have finished sliding. Both the category rail
       and the result list depend on their final width: when a card closes,
       measuring the list during the slide keeps its old narrow size and its
       names stay clipped even though the third column has gone away. */
    const body = el('ixBody');
    if (body) {
      body.addEventListener('transitionend', event => {
        if (event.target === body && event.propertyName === 'grid-template-columns') {
          fitGroups();
          const list = el('ixList');
          if (list) fitList(list);
        }
      });
    }
    started = true;
    return true;
  }

  function start() {
    if (started) return Promise.resolve(true);
    if (startPromise) return startPromise;
    starting = true;
    startPromise = runStart().catch(error => {
      console.error(error);
      return false;
    }).finally(() => {
      starting = false;
      if (!started) startPromise = null;
    });
    return startPromise;
  }

  /* Somebody else may want to open a record: the atlas, or a search box. */
  function show(id) {
    if (!started) return false;
    if (!all.has(id)) return false;
    drawCard(id);
    drawResults();
    return true;
  }

  function createOpenController(startIndex, hasRecord, showRecord) {
    return async function openRecord(id) {
      if (typeof id !== 'string' || !id || id !== id.trim() || !/^[a-z][a-z0-9-]*:.+/i.test(id)) return false;
      if (!await startIndex()) return false;
      if (!hasRecord(id)) return false;
      return Boolean(showRecord(id));
    };
  }
  const open = createOpenController(
    start,
    id => Boolean(all && all.has(id)),
    id => showing && showing.id === id ? true : show(id)
  );

  return { start, show, open, __test: { createOpenController } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RealmIndex;
