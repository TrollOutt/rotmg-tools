/*
 * The Index's way of browsing: families on the left, the list in the middle,
 * the card on the right.
 *
 * web/index-page.js reads the records, the status effects, the dungeon
 * difficulties and RealmEye's archive, and draws the card. This draws the
 * rest out of what it read: the families a reader comes for (dungeons by
 * difficulty, biomes by level, enemies by role, gear by slot, the bag by
 * shelf...), each one narrowed and grouped in the middle, and it asks the
 * card to show whatever is picked. A link taken inside the card is followed
 * here too, through the `realmindex:card` event.
 *
 * Two kinds of category are kept apart on purpose:
 *   families   each member is a record with its own card (a dungeon, a class)
 *   filters    a property many records share (a tier, soulbound, a biome)
 *
 * The view lives in the address (#index?f=dungeons&s=end&open=...) so it can
 * be shared and Back undoes a step. Everything here is English; the site is.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n0 = n => Number(n).toLocaleString('en-US');
  const L = r => r.labels || [];
  const bundle = () => window.ROTMG_BUNDLE || null;

  /* ================================================================== *
   * What the Index read, seen as families                                *
   * ================================================================== */
  const IX = {};
  let D = null;                                   // RealmIndex.data()

  async function readExtras() {
    const b = bundle();
    // The biomes' beacons, the pictures the site keeps for the atlas.
    IX.beacons = await fetch('assets/realm-biomes/index.json').then(r => r.json()).then(j => j.beacons || null).catch(() => null);
    // The creatures' walking loops: carried inside the kept copy, beside the served one.
    const carried = b && b.realmMonsterAnimations;
    IX.moving = carried ? Object.fromEntries(Object.keys(carried).map(k => [k, k]))
      : await fetch('assets/realm-monster-animations/index.json').then(r => r.json()).catch(() => ({}));
    IX.loopSrc = key => carried ? carried[key] : 'assets/realm-monster-animations/' + encodeURIComponent(IX.moving[key]);
    await readSheet();
  }

  /*
   * Which rectangles of the sheet are empty: invisible objects (spawners,
   * triggers) carry a transparent sprite, and a representative picture must
   * never be one of those. Decoded with createImageBitmap: an <img>'s
   * decode() can wait seconds for the first paint.
   */
  let alpha = null;
  async function readSheet() {
    try {
      const b = bundle();
      const ix = window.ROTMG_SHARED_DATA && window.ROTMG_SHARED_DATA.index, mark = ix && (ix.built || (ix.from && ix.from.build));
      const blob = await fetch((b && b.indexSheet) || 'assets/index/sheet.png' + (mark ? '?v=' + encodeURIComponent(mark) : '')).then(r => r.blob());
      const img = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      alpha = { w: img.width, data: g.getImageData(0, 0, img.width, img.height).data };
    } catch (err) { alpha = null; }
  }
  const blankCache = new Map();
  IX.isBlank = rect => {
    if (!alpha || !rect) return false;
    const key = rect.join(',');
    if (blankCache.has(key)) return blankCache.get(key);
    const [x, y, w, h] = rect;
    let seen = 0;
    for (let j = 0; j < h && seen < 3; j++) for (let i = 0; i < w; i++) if (alpha.data[((y + j) * alpha.w + x + i) * 4 + 3] > 24) { if (++seen >= 3) break; }
    blankCache.set(key, seen < 3);
    return seen < 3;
  };

  function readRecords() {
    IX.records = D.all;
    IX.list = [...D.all.values()].filter(r => !r.folded);
    IX.slots = D.slots || {};
    // What each record inflicts, grants or shrugs off, read from the status records.
    IX.statusOf = new Map();
    const add = (id, name, how, x) => (IX.statusOf.get(id) || IX.statusOf.set(id, []).get(id)).push({ name, how, duration: x && x.duration });
    for (const r of IX.list) {
      if (r.kind !== 'status' || !r.status) continue;
      const e = r.status;
      for (const x of e.inflicts || []) add(x.id, e.name, 'inflicts', x);
      for (const x of e.grants || []) add(x.id, e.name, 'grants', x);
      for (const x of e.inflictedBy || []) add(x.id, e.name, 'inflicts on players', x);
      for (const id of e.immune || []) add(id, e.name, 'immune to');
    }
    readArchive();
  }
  // RealmEye's archive, once read: where creatures live, the roles their rosters give them.
  function readArchive() {
    const a = D.archive();
    IX.foundIn = a ? a.livesIn : null;
    IX.rosterRole = a ? a.roles : null;
  }
  const archiveOf = r => (r && r.realmeyeArchive) || null;

  /* ---------------- what a record is ---------------- */
  const FAMILY = r => r.family || (r.use ? 'use' : r.kind);
  IX.isGear = r => r.kind === 'item' && !r.use && !r.family && r.slot !== undefined && r.slot !== 10;
  IX.difficultyOf = r => (r && r.kind === 'portal' && D.difficulty(r)) || null;
  IX.kindSay = r => {
    if (r.kind === 'status') return r.tone === 'good' ? 'Buff' : 'Debuff';
    if (r.kind === 'enemy') {
      // The most specific role first: a Hero or an Encounter is often flagged god too.
      const roster = IX.rosterRole && IX.rosterRole.get(r.id);
      if (L(r).includes('HERO') || r.role === 'hero' || (roster && roster.has('hero'))) return 'Hero of Oryx';
      if (L(r).some(l => /ENCOUNTER$/.test(l)) || r.role === 'encounter' || (roster && roster.has('encounter'))) return 'Encounter';
      if (L(r).includes('BOSS') || (roster && (roster.has('boss') || roster.has('treasure_boss')))) return 'Boss';
      if (L(r).includes('MINIBOSS') || (roster && roster.has('miniboss'))) return 'Miniboss';
      if (r.god) return 'God';
      return 'Enemy';
    }
    if (IX.isGear(r)) return (IX.slots[r.slot] || ['Gear'])[0] + (r.tier !== undefined ? ' · T' + r.tier : L(r).includes('UT') ? ' · UT' : L(r).includes('ST') ? ' · ST' : '');
    if (r.kind === 'item' && ['use', 'consumable', 'other', 'material'].includes(FAMILY(r))) return SHELF_ONE[bagShelf(r)] || 'Consumable';
    return ({ portal: 'Dungeon', place: 'Biome', class: 'Class', skin: 'Skin', set: 'Set', enchant: 'Enchantment', pool: 'Pool', use: 'Consumable' })[FAMILY(r)]
      || FAMILY(r)[0].toUpperCase() + FAMILY(r).slice(1);
  };
  const KCLASS = r => 'is-' + (r.kind === 'item' && (r.use || r.family) ? 'use' : r.kind);

  /* ---------------- pictures ---------------- */
  /*
   * A biome is drawn by its beacon. The rookie bands share their region's
   * (every desert the Desert beacon), the forests the Forest one.
   */
  const BEACON_OF = { 'Ancient City': 'Abandoned City', 'Coral Reef': 'Coral Reefs', 'Nature Ruins': 'Forest', 'Low Forest': 'Forest',
    'High Forest': 'Forest', 'Mid Plains': 'Plains', 'High Plains': 'Plains', 'Low Desert': 'Desert', 'Mid Desert': 'Desert', 'High Desert': 'Desert' };
  IX.beaconOf = r => (r && r.kind === 'place' && IX.beacons && IX.beacons[BEACON_OF[r.name] || r.name]) || null;
  // How hard a biome is, as its beacon's caption says it ("Abandoned City Beacon (Adept)"); the high bands are the Highlands.
  IX.BIOME_LEVELS = ['Rookie', 'Highlands', 'Adept', 'Veteran', 'Seasonal', 'Other'];
  IX.biomeLevel = r => {
    if (/^High /.test(r.name)) return 'Highlands';
    const b = IX.beaconOf(r), m = b && String(b.alt || '').match(/\((\w+)\)/);
    if (m && IX.BIOME_LEVELS.includes(m[1])) return m[1];
    // A beacon captioned with no level is a season's: Eternal Frost, Relentless Springs.
    return b ? 'Seasonal' : 'Other';
  };
  IX.loopOf = r => { const key = [r.clientId, r.alias, r.name].find(k => k && IX.moving && IX.moving[k]); return key ? IX.loopSrc(key) : ''; };

  IX.art = function art(r, px = 32) {
    if (!r) return glyph('?', 'none', px);
    if (r.statusArt && D.statusSheet) return slice((bundle() && bundle().statusSheet) || 'assets/index/status-icons.png', D.statusSheet, r.statusArt, px,
      // The game draws a lowered stat with the raised stat's icon in red.
      r.name === 'Stat Reduction' ? 'filter:grayscale(1) sepia(1) saturate(6) hue-rotate(-40deg) brightness(.95)' : '');
    const beacon = IX.beaconOf(r);
    if (beacon) return '<img class="ixb-pic is-beacon" src="assets/realm-biomes/' + encodeURIComponent(beacon.file) + '" alt="" style="width:' + px + 'px;height:' + px + 'px">';
    // A creature that moves is drawn moving: its walking loop, cut for the atlas.
    const loop = r.kind === 'enemy' && IX.loopOf(r);
    if (loop) return '<img class="ixb-pic" src="' + esc(loop) + '" alt="" loading="lazy" style="width:' + px + 'px;height:' + px + 'px">';
    const pic = picFor(r);
    if (pic && D.sheet) return slice((bundle() && bundle().indexSheet) || 'assets/index/sheet.png', D.sheet, pic, px);
    return glyph(initials(r.name), r.kind === 'status' ? r.tone : 'none', px);
  };
  function slice(url, sheet, [x, y, w, h], px, extra = '') {
    const z = px / Math.max(w, h, 8);
    return '<span class="ixb-art" style="' + extra + ';width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(' + url
      + ');background-size:' + sheet.wide * z + 'px ' + sheet.tall * z + 'px;background-position:' + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
  }
  const initials = name => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const glyph = (text, tone, px) => '<span class="ixb-glyph is-' + tone + '" style="width:' + px + 'px;height:' + px + 'px;font-size:' + Math.max(8, px * 0.38) + 'px">' + esc(text) + '</span>';

  /*
   * The picture a record is drawn with when the client gave it none: a
   * spawner is drawn as what it brings, a pool as what rolls from it.
   */
  const byName = new Map();
  let named = null;
  const POOL_SHORT = { lod: 'Lair of Draconis', tomb: 'Tomb of the Ancients', nest: 'The Nest', hudl: 'Heroic Undead Lair',
    iabyss: 'Heroic Abyss of Demons', kogbold: 'Kogbold Steamworks', aoo: 'Avatar of Oryx' };
  function poolNamesake(r) {
    if (!named) {
      named = new Map();
      const rank = { portal: 0, set: 1, enchant: 2, item: 3, enemy: 4 };
      for (const one of IX.records.values()) {
        if (one.hidden || one.folded || !one.art || !(one.kind in rank) || IX.isBlank(one.art)) continue;
        const k = String(one.name).toLowerCase(), was = named.get(k);
        if (!was || rank[one.kind] < rank[was.kind]) named.set(k, one);
      }
    }
    const base = String(r.name).replace(/ Pool$/, '').replace(/^(AI|Test) /, '');
    const tries = [base, 'The ' + base, base + ' Tarot Card', 'The ' + base + ' Tarot Card', base + ' Card', 'Path of the ' + base, base + ' Set', POOL_SHORT[base.toLowerCase()] || ''];
    for (const t of tries) { const one = t && named.get(t.toLowerCase()); if (one) return one; }
    return null;
  }
  function picFor(r) {
    if (r.kind === 'place' && (!r.art || IX.isBlank(r.art))) {
      for (const [how, id] of r.in || []) {
        const one = how === 'was seen in' && IX.records.get(id);
        if (one && one.art && !IX.isBlank(one.art)) return one.art;
      }
    }
    if (r.kind === 'pool') {
      const one = poolNamesake(r);
      if (one) return one.art;
      for (const [how, id] of r.in || []) {
        const it = how === 'rolls from' && IX.records.get(id);
        if (it && !it.hidden && it.art && !IX.isBlank(it.art)) return it.art;
      }
    }
    if (r.spawns || /Spawner/i.test(r.name)) {
      if (!byName.size) for (const one of IX.records.values()) if (one.kind === 'enemy' && !one.spawns && one.art && !IX.isBlank(one.art)) byName.set(one.name, one);
      // "SpecPen Jailer Spawner Deep Sea" -> "SpecPen Jailer", then "Jailer".
      const words = String(r.name).replace(/\s*Spawner\b.*$/i, '').trim().split(/\s+/);
      for (let i = 0; i < words.length; i++) { const it = byName.get(words.slice(i).join(' ')); if (it) return it.art; }
    }
    return r.art && !IX.isBlank(r.art) ? r.art : null;
  }
  IX.hasPicture = r => Boolean(r && (r.statusArt || IX.beaconOf(r) || picFor(r)));
  // Machinery rather than things: an enemy or a portal the client never drew.
  IX.isTechnical = r => (r.kind === 'enemy' || r.kind === 'portal') && !IX.hasPicture(r);

  /* ---------------- dungeons: the main one, the rest under it ---------------- */
  /*
   * A portal that is a piece of a dungeon (a teleporter inside Untaris, the
   * Wine Cellar's locked door, the boss room of the Lost Halls) or its old
   * version (Legacy Pirate Cave) belongs under that dungeon, not beside it.
   */
  const PORTAL_PART = [
    [/^AI Untaris\b/, 'Untaris'], [/^HUDL\b/, 'Heroic Undead Lair'], [/^LH\b|^Lost Halls \(/, 'Lost Halls'],
    [/^LOD\b|Draconis|^Ivory Wyvern/, 'Lair of Draconis'], [/^3D Portal/, 'The Third Dimension'], [/Shaitan/, 'Lair of Shaitan'],
    [/^Remnant of the Void/, 'The Void'], [/Wine Cellar/, 'Wine Cellar'], [/^Tomb of the Ancients \(/, 'Tomb of the Ancients']
  ];
  let mainByName = null;
  IX.portalHome = r => {
    if (!r || r.kind !== 'portal' || IX.difficultyOf(r)) return null;
    if (!mainByName) { mainByName = new Map(); for (const p of IX.list) if (p.kind === 'portal' && IX.difficultyOf(p)) mainByName.set(String(p.name).toLowerCase(), p); }
    const name = String(r.name);
    for (const [test, home] of PORTAL_PART) if (test.test(name)) return mainByName.get(home.toLowerCase()) || null;
    const base = name.replace(/^Legacy\s+/, '').replace(/\s+Portal$/, '').trim().toLowerCase();
    return mainByName.get(base) || mainByName.get('the ' + base) || null;
  };
  // A dungeon RealmEye describes (a boss, a roster, drops) and the client does not rate: an event or seasonal one.
  IX.isEventDungeon = r => r.kind === 'portal' && !IX.difficultyOf(r) && !IX.portalHome(r)
    && ((archiveOf(r) || {}).relations || []).some(x => /^dungeon_/.test(x.type));
  // A portal that is no dungeon of its own: a part of one, a hub (Nexus, Vault, guild halls), a test.
  IX.isSidePortal = r => r.kind === 'portal' && !IX.difficultyOf(r) && !IX.isEventDungeon(r);

  /* ---------------- the bag, by shelf ---------------- */
  const BAG_SHELVES = [
    ['potions', 'Potions'], ['chests', 'Chests & boxes'], ['keys', 'Keys'], ['blueprints', 'Blueprints'],
    ['materials', 'Materials & marks'], ['pets', 'Pets'], ['dyes', 'Dyes'], ['styles', 'Item styles'],
    ['titles', 'Titles'], ['emotes', 'Emotes & entrances'], ['tarot', 'Tarot & artifacts'],
    ['unlockers', 'Skin unlockers'], ['other', 'Other consumables']
  ];
  const SHELF_ONE = { potions: 'Potion', chests: 'Chest', keys: 'Key', blueprints: 'Blueprint', materials: 'Material', pets: 'Pet item',
    dyes: 'Dye', styles: 'Item style', titles: 'Title', emotes: 'Emote', tarot: 'Artifact', unlockers: 'Skin unlocker', other: 'Consumable' };
  function bagShelf(r) {
    const f = FAMILY(r), n = String(r.name);
    if (/Blueprint/.test(n)) return 'blueprints';
    if (f === 'skin unlocker') return 'unlockers';
    if (f === 'key' || /\bKey\b/.test(n)) return 'keys';
    if (f === 'dye') return 'dyes';
    if (L(r).includes('SHADER') || /\bStyle( Remover)?$/.test(n)) return 'styles';
    if (f === 'title' || L(r).includes('TITLE') || /Title Unlocker$/.test(n)) return 'titles';
    if (f === 'emote' || f === 'entrance' || f === 'gravestone') return 'emotes';
    if (f === 'pet egg' || f === 'pet skin' || /\b(Egg|Pet Treat|Treat|Pet Food|Feed)\b/.test(n)) return 'pets';
    if (f === 'artifact') return 'tarot';
    if (L(r).includes('STATPOTION') || /\b(Potion|Elixir|Tincture|Effusion)\b/.test(n)) return 'potions';
    if (['material', 'shard', 'mark', 'enchant dust', 'token', 'supporter reward'].includes(f)) return 'materials';
    if (/\b(Chest|Mystery|Box|Crate|Gift|Pack|Bundle|Cache|Goodie Bag|Parcel|Treasure|Present|Lootbox)\b/.test(n)) return 'chests';
    return 'other';
  }

  /* ---------------- the families ---------------- */
  // Judged by the picture itself: two records can share one sprite.
  const used = new Set();
  IX.picKey = r => {
    const b = IX.beaconOf(r);
    if (b) return 'beacon,' + b.file;
    const a = r && (r.statusArt ? ['s', r.name === 'Stat Reduction' ? 'red' : '', ...r.statusArt] : picFor(r));
    return a ? a.join(',') : '';
  };
  function pick(ids, score = () => 0) {
    const ranked = [...ids].map(id => IX.records.get(id)).filter(r => r && !r.hidden && IX.hasPicture(r)).sort((a, b) => score(b) - score(a));
    const r = ranked.find(x => !used.has(IX.picKey(x))) || ranked[0];
    if (r) used.add(IX.picKey(r));
    return r ? r.id : null;
  }
  /*
   * What a family lists: nothing hidden, RealmEye's own records only as
   * biomes, and the plumbing (the build marks it dev) only where it has a
   * place of its own: the pools' section, the other portals.
   */
  const shown = r => !r.hidden && (!r.dev || r.kind === 'pool' || r.kind === 'portal') && (!r.communityOnly || r.kind === 'place');
  const visible = test => IX.list.filter(r => shown(r) && !IX.isTechnical(r) && test(r)).map(r => r.id);
  IX.technical = test => IX.list.filter(r => shown(r) && IX.isTechnical(r) && test(r)).map(r => r.id);
  const hp = r => r.hp || 0;
  const tierScore = r => (r.tier !== undefined ? r.tier : L(r).includes('UT') ? 15 : L(r).includes('ST') ? 16 : 0);
  const section = (id, title, ids, score) => ({ id, title, ids, pic: pick(ids, score) });

  function buildDomains() {
    used.clear();
    mainByName = null;
    const out = [];
    const domain = (id, title, blurb, groups, extra = {}) => {
      const ids = [...new Set(groups.flatMap(g => g.ids))];
      out.push({ id, title, blurb, groups: groups.filter(g => g.ids.length), ids, ...extra });
    };
    const classes = visible(r => r.kind === 'class');
    domain('classes', 'Classes', 'Their stats, the gear they hold and the skins they wear.', [section('all', 'Classes', classes)],
      { sortBy: r => classes.indexOf(r.id) });
    const dungeons = visible(r => r.kind === 'portal' && !IX.isSidePortal(r));
    IX.sidePortals = IX.list.filter(r => shown(r) && IX.isSidePortal(r)).map(r => r.id);
    const band = r => { const d = IX.difficultyOf(r); return !d ? 'other' : d <= 3 ? 'easy' : d <= 6 ? 'mid' : d <= 8 ? 'hard' : 'end'; };
    const dungeonScore = r => IX.difficultyOf(r) || 0;
    const inBand = b => dungeons.filter(id => band(IX.records.get(id)) === b);
    domain('dungeons', 'Dungeons', 'Every dungeon: who lives there, what drops, how hard it is.', [
      section('easy', 'Starter (1–3)', inBand('easy'), dungeonScore),
      section('mid', 'Intermediate (4–6)', inBand('mid'), dungeonScore),
      section('hard', 'Advanced (7–8)', inBand('hard'), dungeonScore),
      section('end', 'Endgame (9–10)', inBand('end'), dungeonScore),
      section('other', 'Events & seasonal', inBand('other'), dungeonScore)
    ], { sortBy: r => IX.difficultyOf(r) || 99 });
    const places = visible(r => r.kind === 'place');
    domain('biomes', 'Realm biomes', 'The places of the realm and what roams them.',
      IX.BIOME_LEVELS.map(l => section(l.toLowerCase(), l === 'Other' ? 'Other biomes' : l, places.filter(id => IX.biomeLevel(IX.records.get(id)) === l))));
    const st = visible(r => r.kind === 'status');
    domain('status', 'Status effects', 'What each effect does, what inflicts it and who is immune.', [
      section('bad', 'Debuffs', st.filter(id => IX.records.get(id).tone === 'bad')),
      section('good', 'Buffs', st.filter(id => IX.records.get(id).tone === 'good'))
    ]);
    const foes = visible(r => r.kind === 'enemy');
    const role = id => IX.kindSay(IX.records.get(id));
    domain('enemies', 'Enemies', 'Gods, bosses, encounters and everything that shoots back.', [
      section('god', 'Gods', foes.filter(id => role(id) === 'God'), hp),
      section('hero', 'Heroes of Oryx', foes.filter(id => role(id) === 'Hero of Oryx'), hp),
      section('encounter', 'Encounters', foes.filter(id => role(id) === 'Encounter'), hp),
      section('boss', 'Bosses', foes.filter(id => role(id) === 'Boss'), hp),
      section('miniboss', 'Minibosses', foes.filter(id => role(id) === 'Miniboss'), hp),
      section('spawner', 'Spawners', foes.filter(id => IX.records.get(id).spawns), hp),
      section('enemy', 'Other enemies', foes.filter(id => role(id) === 'Enemy' && !IX.records.get(id).spawns), hp)
    // Creatures with a known home first (the event copies and test dummies have none), then the toughest.
    ], { sortBy: r => (IX.foundIn && IX.foundIn.has(r.id) ? 0 : 1e9) - hp(r) });
    const gear = visible(IX.isGear);
    domain('gear', 'Gear', 'Weapons, abilities, armour and rings, tiered, UT and ST.',
      Object.entries(IX.slots).map(([slot, [say]]) => section('slot' + slot, say, gear.filter(id => String(IX.records.get(id).slot) === slot), tierScore)),
      { sortBy: r => -tierScore(r) });
    domain('sets', 'Sets', 'Four pieces that change the look and the shot.', [section('all', 'Sets', visible(r => r.kind === 'set'))]);
    const skins = visible(r => r.kind === 'skin');
    const wornBy = r => ((r.out || []).find(([h]) => h === 'worn by') || [])[1];
    domain('skins', 'Skins', 'Every costume, class by class.',
      classes.map(cid => section(cid, IX.records.get(cid).name, skins.filter(id => wornBy(IX.records.get(id)) === cid))),
      { sortBy: r => (L(r).includes('ST') ? 0 : 1) });
    const bag = visible(r => r.kind === 'item' && !IX.isGear(r));
    const shelf = new Map(BAG_SHELVES.map(([id]) => [id, []]));
    for (const id of bag) shelf.get(bagShelf(IX.records.get(id))).push(id);
    domain('bag', 'Consumables & bag', 'Potions, chests, keys, blueprints, pets, dyes, styles, emotes…',
      BAG_SHELVES.map(([id, title]) => section(id, title, shelf.get(id))),
      // The eight stat potions before the boosters and the event drinks.
      { sortBy: r => (L(r).includes('STATPOTION') ? 0 : 1) });
    // Enchantments by what they are: the awakened and unique ones apart from the stat bonuses.
    const enchants = visible(r => r.kind === 'enchant');
    const sort = r => L(r).includes('AWAKENED') ? 'awakened' : L(r).includes('UNIQUE') ? 'unique'
      : L(r).some(l => /ALIEN/.test(l)) ? 'alien' : L(r).some(l => /^(PROC|ONHIT|ONSHOOT|ONABILITY)/.test(l)) ? 'proc'
        : L(r).some(l => /^(REWARD|LOOT|XP|DUST)$/.test(l)) ? 'reward' : 'stat';
    const ofSort = k => enchants.filter(id => sort(IX.records.get(id)) === k);
    domain('enchants', 'Enchantments', 'What can roll on gear, and from which pool.', [
      section('awakened', 'Awakened', ofSort('awakened')),
      section('unique', 'Unique', ofSort('unique')),
      section('alien', 'Alien', ofSort('alien')),
      section('proc', 'On hit, shoot or ability', ofSort('proc')),
      section('reward', 'Loot, XP & dust', ofSort('reward')),
      section('stat', 'Stat bonuses', ofSort('stat')),
      section('pool', 'Pools', visible(r => r.kind === 'pool'))
    ]);
    for (const d of out) d.pic = pick(d.groups.map(g => g.pic).filter(Boolean)) || (d.groups[0] && d.groups[0].pic);
    /*
     * Nineteen kinds of ability, most of them one class's, made nineteen
     * headings over a line or two each. They are one section: each line says
     * its kind and the class that holds it, and a menu narrows to one.
     */
    const gd = out.find(d => d.id === 'gear');
    const kinds = gd ? gd.groups.filter(g => (IX.records.get(g.ids[0]) || {}).hand === 'ability') : [];
    if (gd && kinds.length) {
      gd.abilities = { id: 'abilities', title: 'Abilities', ids: kinds.flatMap(g => g.ids), pic: kinds[0].pic, kinds };
      gd.kindOf = new Map(kinds.flatMap(g => g.ids.map(id => [id, g])));
    }
    IX.holderOf = new Map();
    for (const id of classes) for (const s of IX.records.get(id).slots || []) if (!IX.holderOf.has(s)) IX.holderOf.set(s, IX.records.get(id));
    IX.domains = out;
    familyOf = null;
    givesMemo = null;
  }
  IX.domain = id => IX.domains.find(d => d.id === id);
  // A family's section by its id, the gear's abilities taken together included.
  IX.groupOf = (d, s) => !s ? null : s === 'abilities' && d.abilities ? d.abilities : d.groups.find(x => x.id === s) || null;
  const isKind = (d, g) => Boolean(d && d.abilities && g && d.abilities.kinds.includes(g));

  /* ---------------- search ---------------- */
  /* What players type for the places they go most. */
  const SHORT = {
    o1: "Oryx's Castle", o2: "Oryx's Chamber", o3: "Oryx's Sanctuary", lh: 'Lost Halls', mv: 'Moonlight Village',
    udl: 'Undead Lair', ot: 'Ocean Trench', shats: 'The Shatters', shatts: 'The Shatters', cult: 'Cultist Hideout',
    nest: 'The Nest', tomb: 'Tomb of the Ancients', abby: 'Abyss of Demons', dwd: 'Deadwater Docks', lod: 'Lair of Draconis',
    pcave: 'Pirate Cave', wc: 'Wine Cellar', mbc: 'Marble Colossus'
  };
  // How much a reader is likely to mean a kind of thing.
  const weight = r => {
    if (r.kind === 'portal' || r.kind === 'class' || r.kind === 'status' || r.kind === 'place' || r.kind === 'set') return 0;
    if (IX.isTechnical(r) || r.dev) return 6;
    if (r.kind === 'enemy') return /Hero|Encounter|Boss|God/.test(IX.kindSay(r)) ? 1 : 3;
    if (IX.isGear(r)) return 1;
    if (r.kind === 'skin' || r.kind === 'enchant') return 2;
    return 3;
  };
  /*
   * Forgiving matching. A name is read as plain words - no apostrophes, no
   * punctuation - so "oryxs castle" finds Oryx's Castle; a plural finds the
   * singular ("mads" finds Mad Lab); and a word of four letters or more may
   * be one letter off (two from seven), so "javlin" still finds the Mad
   * Javelin. It only speaks when the plain matches are few: a typo should
   * rescue a search, not bury a good one under near misses.
   */
  const plain = s => String(s).toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const STOP = new Set(['of', 'the', 'a']);
  // A name's plain words, worked out once per record rather than on every key.
  const wordsOf = new WeakMap();
  const plainWords = r => {
    let got = wordsOf.get(r);
    if (!got) wordsOf.set(r, got = plain(r.said || r.name).split(' ').filter(w => w && !STOP.has(w)));
    return got;
  };
  // Edits between two words, two letters swapped counting as one ("sheild"); gives up past the most allowed.
  function near(a, b, most) {
    if (Math.abs(a.length - b.length) > most) return false;
    let before = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let low = i;
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
        if (row[j] < low) low = row[j];
      }
      if (low > most) return false;
      before = prev; prev = row;
    }
    return prev[b.length] <= most;
  }
  // One typed word against one word of a name: the start of it, its singular, or nearly it.
  function wordFits(w, nw) {
    if (nw.startsWith(w)) return true;
    const one = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : '';
    if (one && nw.startsWith(one)) return true;
    if (w.length < 4) return false;
    const most = w.length >= 7 ? 2 : 1;
    return near(w, nw, most) || (nw.length > w.length && near(w, nw.slice(0, w.length), most));
  }
  IX.search = (term, limit = 60) => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    const words = t.split(/\s+/).filter(w => w && !STOP.has(w));
    const loose = plain(t).split(' ').filter(w => w && !STOP.has(w));
    const meant = SHORT[t] && SHORT[t].toLowerCase();
    const hits = [], maybe = [];
    for (const r of IX.list) {
      if (r.hidden || (r.communityOnly && r.kind !== 'place')) continue;
      const n = String(r.said || r.name).toLowerCase();
      const bare = n.replace(/^the\s+/, '');
      let rank;
      if (meant && n === meant) rank = -1;
      else if (n === t || bare === t) rank = 0;
      else if (bare.startsWith(t) || n.startsWith(t)) rank = 1;
      else if (words.length && words.every(w => new RegExp('(^|[\\s\'(-])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n))) rank = 2;
      else if (words.length && words.every(w => n.includes(w))) rank = 3;
      // The client's own name for it, which is what a reader holding a data mine types.
      else if (r.clientId && r.clientId.toLowerCase() !== n && r.clientId.toLowerCase().includes(t)) rank = 3;
      else {
        if (loose.length) maybe.push(r);
        continue;
      }
      hits.push([rank * 10 + weight(r), n.length, r]);
    }
    if (hits.length < 20 && loose.length) {
      for (const r of maybe) {
        const nws = plainWords(r);
        if (loose.every(w => nws.some(nw => wordFits(w, nw)))) hits.push([40 + weight(r), String(r.said || r.name).length, r]);
      }
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return hits.slice(0, limit).map(h => h[2]);
  };

  /* ================================================================== *
   * The page                                                             *
   * ================================================================== */
  const ORDER = ['classes', 'dungeons', 'biomes', 'status', 'enemies', 'gear', 'sets', 'skins', 'bag', 'enchants'];
  // A family drawn as a wall of pictures by default: few members, each a thing with a card.
  const VISUAL = new Set(['classes', 'dungeons', 'biomes', 'status', 'sets', 'skins']);

  /* ---------------- state, kept in the address ---------------- */
  const KEYS = ['f', 's', 'q', 'qf', 'by', 'view', 'tier', 'inf', 'gra', 'cls', 'scl', 'home', 'dcls', 'dh', 'open', 'wide'];
  const S = { tags: new Set(), tech: false };
  function readHash() {
    const hash = location.hash.replace(/^#\/?/, '');
    const at = hash.indexOf('?');
    const p = new URLSearchParams(at < 0 ? '' : hash.slice(at + 1));
    for (const k of KEYS) S[k] = p.get(k) || '';
    S.tags = new Set((p.get('tags') || '').split(',').filter(Boolean));
    S.tech = p.get('tech') === '1';
  }
  let lastStep = null;
  function writeHash() {
    const p = new URLSearchParams();
    for (const k of KEYS) if (S[k]) p.set(k, S[k]);
    if (S.tags.size) p.set('tags', [...S.tags].join(','));
    if (S.tech) p.set('tech', '1');
    const query = p.toString();
    const url = location.pathname + location.search + '#index' + (query ? '?' + query : '');
    // A new family, section or card is a step Back can undo; typing and filtering are not.
    const step = ['f', 's', 'open'].map(k => S[k]).join('|');
    if (lastStep !== null && step !== lastStep) history.pushState(null, '', url); else history.replaceState(null, '', url);
    lastStep = step;
  }
  const FILTERS = ['tier', 'inf', 'gra', 'cls', 'scl', 'home', 'dcls', 'dh'];
  const clearFilters = () => { for (const k of FILTERS) S[k] = ''; S.tags.clear(); };

  /* ---------------- what a line shows, given where it is ---------------- */
  const statusesOf = (r, hows) => (IX.statusOf.get(r.id) || []).filter(x => hows.includes(x.how)).map(x => x.name);
  const tierOf = r => L(r).includes('UT') ? 'UT' : L(r).includes('ST') ? 'ST' : r.tier !== undefined ? String(r.tier) : '';
  const tierSay = t => /\d/.test(t) ? 'T' + t : t;
  // Where a creature lives: its biome before a dungeon it also turns up in.
  const placeOf = r => {
    const at = IX.foundIn && IX.foundIn.get(r.id);
    if (!at || !at.size) return null;
    const all = [...at].map(id => IX.records.get(id)).filter(Boolean);
    return all.find(p => p.kind === 'place') || all[0] || null;
  };
  const setClass = r => { const rel = ((archiveOf(r) || {}).relations || []).find(x => x.type === 'class' && x.to); return rel ? rel.to : ''; };
  /*
   * A name says less where its context already says it: "Rogue" under the
   * Rogue's skins, "Set" in the sets. The full name stays in the tooltip.
   */
  function shortName(r, ctx) {
    const full = r.said || r.name;
    let words = [];
    if (ctx && ctx.d && ctx.d.id === 'sets') words = ['Set'];
    if (ctx && ctx.d && ctx.d.id === 'skins' && ctx.g) words = [ctx.g.title];
    if (ctx && ctx.heading && ctx.d && (ctx.d.id === 'sets' || ctx.d.id === 'skins') && IX.records.has('class:' + ctx.heading)) words.push(ctx.heading);
    let name = full;
    for (const w of words) {
      const cut = name.replace(new RegExp('^' + w + '\\s*-\\s*|\\s+' + w + '$'), '').trim();
      if (cut) name = cut;
    }
    return name;
  }
  const TAGS = {
    sb: { say: 'Soulbound', test: r => Boolean(r.sb), fams: ['gear', 'bag'] },
    shiny: { say: 'Shiny', test: r => L(r).includes('SHINY'), fams: ['gear', 'skins'] },
    quest: { say: 'Quest', test: r => L(r).includes('QUEST'), fams: ['enemies'] }
  };
  const TIERS = ['UT', 'ST', ...Array.from({ length: 15 }, (_, i) => String(14 - i))];
  /*
   * The stats an item grows with, as the client says: a hit or a count over
   * a floor of a stat, a status that lasts longer with it, a bonus measured
   * as a share of it. A share of the same stat ("half your life off") is a
   * cost, not a scaling, and is left out.
   */
  const STAT_ORDER = ['MAXHP', 'MAXMP', 'ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS'];
  const STAT_SAY = { MAXHP: 'Life', MAXMP: 'Mana', ATT: 'Attack', DEF: 'Defense', SPD: 'Speed', DEX: 'Dexterity', VIT: 'Vitality', WIS: 'Wisdom' };
  const STAT_TINT = { MAXHP: '#58cfda', MAXMP: '#f4d24c', ATT: '#ca46dd', DEF: '#8b9cb3', SPD: '#58da6e', DEX: '#ff5f2a', VIT: '#dd0c32', WIS: '#4b9be7' };
  const statTag = s => s === 'HP' ? 'MAXHP' : s === 'MP' || s === 'MAHMP' ? 'MAXMP' : s;
  const scaledMemo = new WeakMap();
  function scalesOf(r) {
    let got = scaledMemo.get(r);
    if (got) return got;
    const s = new Set(), c = r.cast;
    if (c && c.from !== undefined && (c.dmg || c.more >= 0.001)) s.add(statTag(c.stat || 'WIS'));
    for (const x of r.share || []) if (x.of && x.of !== x.stat) s.add(statTag(x.of));
    for (const x of r.rel || []) if (x.of && x.of !== x.stat) s.add(statTag(x.of));
    for (const x of r.conditions || []) {
      if (x.scalingStat) s.add(statTag(x.scalingStat));
      else if (x.wisMin || x.wisPerDuration) s.add('WIS');
    }
    got = STAT_ORDER.filter(k => s.has(k));
    scaledMemo.set(r, got);
    return got;
  }
  const placeRank = new Map();
  const rankOfPlace = p => p.kind === 'place' ? IX.BIOME_LEVELS.indexOf(IX.biomeLevel(p)) : 10 + (IX.difficultyOf(p) || 11);
  const GROUP = {
    section: { say: 'Section' },
    // UT and ST apart, the tiered ladder in one group, best first: one heading per tier would be a heading per two lines.
    tier: { say: 'Tier', key: r => { const t = tierOf(r); return t === 'UT' || t === 'ST' ? t : t ? 'Tiered' : 'Untiered'; }, order: k => ['UT', 'ST', 'Tiered', 'Untiered'].indexOf(k) },
    inflicts: { say: 'Status it inflicts', key: r => statusesOf(r, ['inflicts', 'inflicts on players'])[0] || 'None', last: 'None' },
    // The realm's biomes first, rookie to seasonal, then the dungeons from the easiest.
    place: { say: 'Where it lives', key: r => { const p = placeOf(r); if (!p) return 'No known home'; placeRank.set(p.name, rankOfPlace(p)); return p.name; },
      order: k => placeRank.get(k) || 0, last: 'No known home' },
    cls: { say: 'Class', key: r => { const c = IX.records.get(setClass(r)); return c ? c.name : 'Not tied to a class'; }, order: k => k === 'Not tied to a class' ? 1 : 0 },
    letter: { say: 'A–Z', key: r => String(r.name).replace(/^The\s+/, '')[0].toUpperCase(), order: k => k.charCodeAt(0) }
  };
  const groupsFor = (f, g) => ['section', ...({ gear: ['tier', 'inflicts'], enemies: ['place'], sets: ['cls', 'letter'], dungeons: ['letter'],
    bag: ['letter'], enchants: ['letter'], skins: g ? [] : ['letter'] }[f] || [])];
  // A chosen gear slot reads best by tier.
  const defaultBy = (d, g) => d.id === 'gear' && g ? 'tier' : 'section';

  /* ---------------- favourites, the card's own ---------------- */
  const loved = () => (D && D.loved && D.loved()) || new Set();
  const HANDS = 'rotmg-tools/index-hands';
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || '[]'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return []; } };
  const hands = new Set(store(HANDS));

  /* ---------------- rail ---------------- */
  const HAND_SAY ={ weapon: 'Weapons', ability: 'Abilities', armor: 'Armour', ring: 'Rings' };
  /*
   * What a dungeon gives, by class and by hand. RealmEye's word, like every
   * drop here: the gear its page lists among the notable drops, and the gear
   * that lists a boss living in that dungeon (or the dungeon itself) as its
   * source. A part of a dungeon (a boss room, an old version) gives to its
   * main one. Best first: ST and UT, then the highest tier.
   */
  let givesMemo = null;
  function dungeonGives() {
    if (givesMemo) return givesMemo;
    const gear = new Set(IX.domain('gear').ids), by = new Map();
    const give = (portal, id) => {
      const home = IX.difficultyOf(portal) ? portal : IX.portalHome(portal) || portal;
      (by.get(home.id) || by.set(home.id, new Set()).get(home.id)).add(id);
    };
    for (const p of IX.list) {
      if (p.kind !== 'portal') continue;
      for (const x of (archiveOf(p) || {}).relations || []) if (x.type === 'dungeon_drop_interest' && gear.has(x.to)) give(p, x.to);
    }
    for (const id of gear) {
      for (const x of (archiveOf(IX.records.get(id)) || {}).relations || []) {
        const from = x.type === 'dropped_by' && x.to && IX.records.get(x.to);
        if (!from) continue;
        if (from.kind === 'portal') give(from, id);
        else if (from.kind === 'enemy') for (const at of (IX.foundIn && IX.foundIn.get(from.id)) || []) { const p = IX.records.get(at); if (p && p.kind === 'portal') give(p, id); }
      }
    }
    givesMemo = new Map([...by].map(([k, ids]) => [k, [...ids].map(id => IX.records.get(id))
      .sort((a, b) => tierScore(b) - tierScore(a) || String(a.name).localeCompare(b.name))]));
    return givesMemo;
  }
  // The gear a dungeon gives that a class can hold, of one hand or any.
  const classHolds = (cls, g) => ((IX.records.get(cls) || {}).slots || []).includes(g.slot);
  const gaveTo = (r, cls, hand) => (dungeonGives().get(r.id) || []).filter(g => (!hand || g.hand === hand) && (!cls || classHolds(cls, g)));
  // One slot a hand is drawn by: the sword for weapons, the spell for abilities, the leather armour, the ring.
  const HAND_PIC = { weapon: 1, ability: 11, armor: 6, ring: 9 };
  // What the filter found in a dungeon, as small pictures, best first.
  function lootStrip(r, max) {
    if (r.kind !== 'portal' || !(S.dcls || S.dh)) return '';
    const found = gaveTo(r, S.dcls, S.dh);
    if (!found.length) return '';
    // The hover list names them; a browser tooltip on top of it would only be a second window.
    return '<span class="ixb-loot">'
      + found.slice(0, max).map(g => '<span>' + IX.art(g, 16) + '</span>').join('')
      + (found.length > max ? '<small>+' + (found.length - max) + '</small>' : '') + '</span>';
  }

  /*
   * The same list, on hover: a small window beside the dungeon naming what the
   * filter found, each piece with what it does, to be reached with the pointer
   * and clicked. It is only ever a preview; a click on the dungeon opens its card.
   */
  const num = v => Number.isInteger(v) ? String(v) : String(+Number(v).toFixed(1));
  const statWord = (k, text) => '<b style="color:' + (STAT_TINT[k] || 'inherit') + '">' + esc(text) + '</b>';
  // What a piece of gear does, in a line: the shot of a weapon, the cost of an ability, the stats worn.
  function gearLine(g) {
    const bits = [], f = (g.fires || [])[0];
    if ((g.hand === 'weapon' || g.hand === 'ability') && f && f.high) {
      const shots = g.shots > 1 ? ' ×' + g.shots : '';
      bits.push('<span>' + num(f.low) + (f.low !== f.high ? '–' + num(f.high) : '') + ' damage' + shots + (g.hand === 'weapon' && f.reach ? ' · range ' + num(f.reach) : '') + '</span>');
    }
    if (g.hand === 'ability' && g.mp) bits.push('<span>' + statWord('MAXMP', g.mp + ' mana') + '</span>');
    const worn = g.worn || {};
    const stats = STAT_ORDER.filter(k => worn[k]).map(k => statWord(k, (worn[k] > 0 ? '+' : '') + worn[k] + ' ' + STAT_SAY[k]));
    if (stats.length) bits.push('<span>' + stats.join(' ') + '</span>');
    if (!bits.length && g.does && g.does[0]) bits.push('<span>' + esc(g.does[0][0]) + '</span>');
    return bits.join('');
  }
  let tipBox = null, tipFrom = null, tipTimer = 0, tipShut = 0;
  const tipOn = r => r && r.kind === 'portal' && (S.dcls || S.dh);
  function hideTip() {
    clearTimeout(tipTimer); clearTimeout(tipShut);
    tipFrom = null;
    if (tipBox) tipBox.hidden = true;
  }
  function showTip(from) {
    const r = IX.records.get(from.dataset.pick);
    const found = tipOn(r) ? gaveTo(r, S.dcls, S.dh) : [];
    if (!found.length || !from.isConnected) return hideTip();
    if (!tipBox) {
      tipBox = document.createElement('div');
      tipBox.className = 'ixb-tip';
      tipBox.addEventListener('mouseenter', () => clearTimeout(tipShut));
      tipBox.addEventListener('mouseleave', () => { clearTimeout(tipShut); tipShut = setTimeout(hideTip, 200); });
      tipBox.addEventListener('click', e => { const b = e.target.closest('[data-tip-pick]'); if (b) openCard(b.dataset.tipPick); });
      $('pageIndex').append(tipBox);
    }
    const cls = IX.records.get(S.dcls), say = [cls && cls.name, S.dh && HAND_SAY[S.dh]].filter(Boolean).join(' · ');
    let html = '<div class="ixb-tip-h"><b>' + esc(r.said || r.name) + '</b><span>' + found.length + (found.length === 1 ? ' piece' : ' pieces') + ' · ' + esc(say) + '</span></div>';
    for (const h of Object.keys(HAND_SAY)) {
      const list = found.filter(g => g.hand === h);
      if (!list.length) continue;
      if (!S.dh) html += '<div class="ixb-tip-g">' + esc(HAND_SAY[h]) + ' <small>' + list.length + '</small></div>';
      html += list.map(g => { const t = tierOf(g);
        return '<button type="button" class="ixb-tip-row" data-tip-pick="' + esc(g.id) + '"><span class="ixb-cell">' + IX.art(g, 28) + '</span><span><b>' + esc(g.said || g.name) + '</b>'
          + '<span class="ixb-tip-l">' + gearLine(g) + '</span></span>' + (t ? '<span class="ixb-tier is-' + t.toLowerCase() + '">' + tierSay(t) + '</span>' : '') + '</button>'; }).join('');
    }
    tipBox.innerHTML = html;
    tipBox.scrollTop = 0;
    tipBox.hidden = false;
    tipFrom = from;
    // Beside the dungeon, on the right where there is room; never cut by the window.
    const a = from.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
    const left = a.right + w + 12 <= innerWidth ? a.right + 4 : Math.max(8, a.left - w - 4);
    tipBox.style.left = left + 'px';
    tipBox.style.top = Math.max(8, Math.min(a.top, innerHeight - h - 8)) + 'px';
  }
  const tipTarget = e => e.target.closest('#ixbList .ixb-tile[data-pick], #ixbList .ixb-row[data-pick]');
  function wireTip() {
    const mid = $('ixbMid');
    mid.addEventListener('mouseover', e => {
      const t = tipTarget(e);
      if (!t || t === tipFrom) { if (t) clearTimeout(tipShut); return; }
      if (!tipOn(IX.records.get(t.dataset.pick))) return;
      clearTimeout(tipTimer); clearTimeout(tipShut);
      tipTimer = setTimeout(() => showTip(t), tipFrom ? 40 : 180);
    });
    mid.addEventListener('mouseout', e => {
      const t = tipTarget(e);
      if (!t || t.contains(e.relatedTarget)) return;
      clearTimeout(tipTimer); clearTimeout(tipShut);
      tipShut = setTimeout(hideTip, 220);
    });
    mid.addEventListener('scroll', hideTip, { passive: true });
  }
  function rail() {
    const box = $('ixbRail');
    const searching = Boolean(S.q.trim());
    const fav = [...loved()].filter(id => IX.records.has(id));
    box.innerHTML = '<input class="ixb-find" id="ixbSearch" type="search" placeholder="Search everything…  ( / )" value="' + esc(S.q) + '" autocomplete="off">'
      + '<div class="ixb-fams"><button type="button" class="ixb-fam is-home' + (!S.f && !searching ? ' is-on' : '') + '" data-home title="Every family at a glance">'
      + '<span class="ixb-homeglyph">⌂</span><b>Overview</b><small></small></button>'
      + ORDER.map(id => IX.domain(id)).map(d => {
        const on = S.f === d.id && !searching;
        return '<button type="button" class="ixb-fam' + (on ? (S.s ? ' is-in' : ' is-on') : '') + '" data-f="' + d.id + '">' + IX.art(IX.records.get(d.pic), 26)
          + '<b>' + esc(d.title) + '</b><small>' + n0(d.ids.length) + '</small></button>'
          + (on && d.groups.length > 1 ? subsOf(d) : '');
      }).join('') + '</div>'
      + (fav.length ? '<div class="ixb-foot"><div class="ixb-h">★ Favourites <small>' + fav.length + '</small></div><div class="ixb-mini">'
        + fav.map(id => { const r = IX.records.get(id); return '<button type="button" data-pick="' + esc(id) + '" title="' + esc(r.said || r.name) + '">' + IX.art(r, 16) + '<span>' + esc(r.said || r.name) + '</span></button>'; }).join('')
        + '</div></div>' : '');
    const q = $('ixbSearch');
    q.addEventListener('input', () => { S.q = q.value; S.qf = ''; writeHash(); mid(); railFams(); });
  }
  // While typing, only the family highlight changes: the box keeps its focus.
  function railFams() {
    const searching = Boolean(S.q.trim());
    document.querySelectorAll('#ixbRail .ixb-fam').forEach(b => b.classList.toggle('is-on', !searching && (b.dataset.home !== undefined ? !S.f : b.dataset.f === S.f && !S.s)));
    document.querySelectorAll('#ixbRail .ixb-subs').forEach(x => { x.hidden = searching; });
  }
  /*
   * A family's sections. Gear's twenty-nine slots sit under four hands that
   * fold, so the other families stay in sight; the chosen slot's hand is open.
   */
  function subsOf(d) {
    const on = g => S.s === g.id || (g === d.abilities && d.abilities.kinds.some(k => k.id === S.s));
    const sub = g => '<button type="button" class="ixb-sub' + (on(g) ? ' is-on' : '') + '" data-f="' + d.id + '" data-s="' + esc(g.id) + '" title="' + esc(g.title + ' · ' + g.ids.length) + '">'
      + (g.pic ? IX.art(IX.records.get(g.pic), 14) : '') + '<span>' + esc(g.title) + '</span><small>' + g.ids.length + '</small></button>';
    if (d.id !== 'gear') {
      const two = d.groups.length > 8 && d.groups.every(g => g.title.length <= 11);
      return '<div class="ixb-subs' + (two ? ' is-two' : '') + '">' + d.groups.map(sub).join('') + '</div>';
    }
    const byHand = new Map();
    for (const g of d.groups) {
      const hand = (IX.records.get(g.ids[0]) || {}).hand || 'other';
      (byHand.get(hand) || byHand.set(hand, []).get(hand)).push(g);
    }
    return '<div class="ixb-subs">' + ['weapon', 'ability', 'armor', 'ring', 'other'].filter(h => byHand.has(h)).map(h => {
      const list = byHand.get(h), open = hands.has(h) || list.some(g => g.id === S.s);
      // The abilities are one list, so their heading is the link to it rather than a fold.
      if (h === 'ability' && d.abilities) return '<button type="button" class="ixb-hand is-link' + (on(d.abilities) ? ' is-on' : '') + '" data-f="' + d.id + '" data-s="abilities" title="Every ability · ' + d.abilities.ids.length + '">'
        + esc(HAND_SAY.ability) + '<small>' + n0(d.abilities.ids.length) + '</small></button>';
      if (list.length === 1) return list.map(sub).join('');
      return '<button type="button" class="ixb-hand' + (open ? ' is-open' : '') + '" data-hand="' + h + '">' + esc(HAND_SAY[h] || 'Other') + '<small>' + list.length + ' kinds</small></button>'
        + (open ? '<div class="ixb-hand-body">' + list.map(sub).join('') + '</div>' : '');
    }).join('') + '</div>';
  }

  /* ---------------- middle ---------------- */
  let pending = [], ctxNow = { d: null }, viewNow = 'rows', familyOf = null, searchFirst = '';
  function mid() {
    const box = $('ixbMid');
    hideTip();
    if (S.q.trim()) return search(box);
    if (!S.f || !IX.domain(S.f)) return landing(box);
    const d = IX.domain(S.f), g = IX.groupOf(d, S.s);
    let ids = g ? g.ids : d.ids;
    // The other portals belong to no section: they are offered on the whole family only.
    if (S.tech && !g && d.id === 'dungeons') ids = ids.concat(IX.sidePortals);
    let rows = ids.map(id => IX.records.get(id));
    const all = rows;
    if (S.tier) rows = rows.filter(r => tierOf(r) === S.tier);
    if (S.inf) rows = rows.filter(r => statusesOf(r, ['inflicts', 'inflicts on players']).includes(S.inf));
    if (S.gra) rows = rows.filter(r => statusesOf(r, ['grants']).includes(S.gra));
    if (S.cls) rows = rows.filter(r => setClass(r) === S.cls);
    if (S.scl) rows = rows.filter(r => scalesOf(r).includes(S.scl));
    if (S.home) rows = rows.filter(r => { const p = placeOf(r); return p && p.id === S.home; });
    if (d.id === 'dungeons' && (S.dcls || S.dh)) rows = rows.filter(r => gaveTo(r, S.dcls, S.dh).length);
    for (const t of S.tags) if (TAGS[t]) rows = rows.filter(TAGS[t].test);
    results(box, { d, g, all, rows });
  }
  const count = list => { const m = new Map(); for (const x of list) m.set(x, (m.get(x) || 0) + 1); return m; };
  function results(box, ctx) {
    const { d, g, all, rows } = ctx;
    ctxNow = ctx;
    box.dataset.fam = d.id;
    const view = S.view || (VISUAL.has(d.id) ? 'wall' : 'rows');
    const bys = groupsFor(d.id, g);
    const by = bys.includes(S.by) ? S.by : defaultBy(d, g);
    const pic = IX.records.get(g ? g.pic : d.pic);
    // Offer only the narrowing that would leave something, with the counts it would leave.
    const inflicted = count(all.flatMap(r => statusesOf(r, ['inflicts', 'inflicts on players'])));
    const granted = count(all.flatMap(r => statusesOf(r, ['grants'])));
    const tiers = count(all.map(tierOf).filter(Boolean));
    const classes = d.id === 'sets' ? count(all.map(setClass).filter(Boolean)) : new Map();
    const scaled = d.id === 'gear' ? count(all.flatMap(scalesOf)) : new Map();
    // Where the creatures live, biomes first, rookie to seasonal, then the dungeons from the easiest.
    const homes = d.id === 'enemies' ? count(all.map(placeOf).filter(Boolean).map(p => p.id)) : new Map();
    const homesOrdered = [...homes].sort((a, b) => rankOfPlace(IX.records.get(a[0])) - rankOfPlace(IX.records.get(b[0])) || IX.records.get(a[0]).name.localeCompare(IX.records.get(b[0]).name));
    const tags = Object.entries(TAGS).filter(([k, t]) => t.fams.includes(d.id) && (S.tags.has(k) || all.some(t.test)));
    // The first option names the filter, so no label is needed beside it.
    // A tint gives each option, and the chosen select, the colour of what it names.
    const select = (key, any, map, label = x => x, ordered, tint) => map.size < 2 && !S[key] ? '' : '<select data-sel="' + key + '" class="' + (S[key] ? 'is-set' : '') + '" title="' + esc(any) + '"'
      + (tint && S[key] ? ' style="color:' + tint(S[key]) + ';border-color:' + tint(S[key]) + '"' : '') + '><option value="" style="color:var(--text)">' + esc(any) + '</option>'
      + (ordered || [...map].sort((a, b) => b[1] - a[1])).map(([v, n]) => '<option value="' + esc(v) + '"' + (tint ? ' style="color:' + tint(v) + '"' : '') + (S[key] === v ? ' selected' : '') + '>' + esc(label(v)) + ' · ' + n + '</option>').join('') + '</select>';
    /*
     * A menu that shows what it names: a status with its picture, a stat in
     * its colour, an ability's kind with the class that holds it. Offered as
     * soon as one choice would narrow the list, in a section as in the family.
     */
    const menu = (key, any, entries, say) => !entries.length && !S[key] ? '' : '<span class="ixb-dd' + (S[key] ? ' is-set' : '') + '" data-dd="' + key + '">'
      + '<button type="button" class="ixb-dd-btn" data-dd-open="' + key + '" aria-haspopup="listbox" aria-expanded="false">' + (S[key] ? say(S[key]) : esc(any)) + '<i aria-hidden="true">▾</i></button>'
      + '<span class="ixb-dd-menu" role="listbox" hidden><button type="button" data-ddv="" data-ddk="' + key + '">' + esc(any) + '</button>'
      + entries.map(([v, n]) => '<button type="button" role="option" aria-selected="' + (S[key] === v) + '" class="' + (S[key] === v ? 'is-on' : '') + '" data-ddv="' + esc(v) + '" data-ddk="' + key + '">' + say(v) + '<small>' + n0(n) + '</small></button>').join('')
      + '</span></span>';
    const byCount = map => [...map].sort((a, b) => b[1] - a[1]);
    const statusSay = v => IX.art(IX.records.get('status:' + v), 16) + '<span>' + esc(v) + '</span>';
    const statSay = v => '<span><b style="color:' + STAT_TINT[v] + '">' + esc(STAT_SAY[v] || v) + '</b></span>';
    // The kinds of ability, offered on the abilities and on any one kind of them.
    const kindMenu = d.abilities && g && (g === d.abilities || isKind(d, g)) ? (() => {
      const kindSay = id => { const k = d.abilities.kinds.find(x => x.id === id); const h = k && IX.holderOf.get((IX.records.get(k.ids[0]) || {}).slot); return '<span>' + esc(k ? k.title : id) + (h ? ' <em>' + esc(h.name) + '</em>' : '') + '</span>'; };
      const cur = g === d.abilities ? '' : g.id;
      return '<span class="ixb-dd' + (cur ? ' is-set' : '') + '" data-dd="kind">'
        + '<button type="button" class="ixb-dd-btn" data-dd-open="kind" aria-haspopup="listbox" aria-expanded="false">' + (cur ? kindSay(cur) : 'Any kind') + '<i aria-hidden="true">▾</i></button>'
        + '<span class="ixb-dd-menu" role="listbox" hidden><button type="button" data-ddk="s" data-ddv="abilities">Any kind</button>'
        + d.abilities.kinds.map(k => '<button type="button" role="option" class="' + (k.id === cur ? 'is-on' : '') + '" data-ddk="s" data-ddv="' + esc(k.id) + '">' + kindSay(k.id) + '<small>' + n0(k.ids.length) + '</small></button>').join('')
        + '</span></span>';
    })() : '';
    // Dungeons by what they give: a class, and the kind of gear it holds. Each menu counts the dungeons that would be left.
    const giving = d.id === 'dungeons' ? (() => {
      const ofClass = IX.domain('classes').ids.map(id => IX.records.get(id));
      const classes = ofClass.map(c => [c.id, all.filter(r => gaveTo(r, c.id, S.dh).length).length]).filter(([, n]) => n);
      const handsLeft = Object.keys(HAND_SAY).map(h => [h, all.filter(r => gaveTo(r, S.dcls, h).length).length]).filter(([, n]) => n);
      const classSay = v => { const c = IX.records.get(v); return IX.art(c, 16) + '<span>' + esc(c ? c.name : v) + '</span>'; };
      const handSay = v => { const p = IX.records.get((IX.slots[HAND_PIC[v]] || [])[1]); return (p ? IX.art(p, 16) : '') + '<span>' + esc(HAND_SAY[v] || v) + '</span>'; };
      return menu('dcls', 'Any class', classes, classSay) + menu('dh', 'Any gear', handsLeft, handSay);
    })() : '';
    const filters = giving + kindMenu + (d.id === 'gear' || d.id === 'skins' ? select('tier', 'Any tier', tiers, tierSay, TIERS.filter(t => tiers.has(t)).map(t => [t, tiers.get(t)])) : '')
      + (d.id === 'sets' ? select('cls', 'Any class', classes, v => (IX.records.get(v) || {}).name || v) : '')
      + (d.id === 'enemies' ? select('home', 'Any biome or dungeon', homes, v => (IX.records.get(v) || {}).name || v, homesOrdered) : menu('inf', 'Inflicts…', byCount(inflicted), statusSay))
      + (d.id === 'gear' || d.id === 'bag' ? menu('gra', 'Grants…', byCount(granted), statusSay) : '')
      + (d.id === 'gear' ? menu('scl', 'Scales with…', STAT_ORDER.filter(k => scaled.has(k)).map(k => [k, scaled.get(k)]), statSay) : '')
      + tags.map(([k, t]) => '<button type="button" class="ixb-chip' + (S.tags.has(k) ? ' is-on' : '') + '" data-tag="' + k + '">' + esc(t.say) + '</button>').join('');
    const anySet = FILTERS.some(k => S[k]) || S.tags.size;
    const grouping = bys.length > 1 ? '<span class="ixb-lbl">Group</span><select data-by>' + bys.map(k => '<option value="' + k + '"' + (by === k ? ' selected' : '') + '>' + GROUP[k].say + '</option>').join('') + '</select>' : '';
    const toggle = '<span class="ixb-tog" title="List or portraits"><button type="button" class="' + (view === 'rows' ? 'is-on' : '') + '" data-view="rows" title="List">☰</button><button type="button" class="' + (view === 'wall' ? 'is-on' : '') + '" data-view="wall" title="Portraits">▦</button></span>';
    const title = g ? '<button type="button" class="ixb-up" data-f="' + d.id + '" title="Back to all ' + esc(d.title) + '">' + esc(d.title) + ' ›</button> ' + esc(g.title) : esc(d.title);
    box.innerHTML = '<div class="ixb-head">' + (pic ? '<span class="ixb-big">' + IX.art(pic, 38) + '</span>' : '')
      + '<div><h2>' + title + '</h2>' + (g ? '' : '<p>' + esc(d.blurb) + '</p>') + '</div>'
      + '<div class="ixb-right"><span class="ixb-count">' + (rows.length === all.length ? n0(rows.length) : n0(rows.length) + ' of ' + n0(all.length)) + '</span>' + toggle + '</div></div>'
      + (filters || grouping ? '<div class="ixb-tools">' + filters + (anySet ? '<button type="button" class="ixb-clear" data-clear>clear</button>' : '') + '<span class="ixb-push">' + grouping + '</span></div>' : '')
      + '<div id="ixbList"></div><div class="ixb-sentinel" id="ixbSentinel"></div>';
    pending = grouped(rows, ctx, by);
    viewNow = view;
    // A single group that only repeats the title has no heading.
    if (pending.length === 1 && by === 'section') pending[0].bare = true;
    $('ixbList').innerHTML = rows.length ? '' : '<p class="ixb-none">Nothing here with these filters. <button type="button" class="ixb-clear" data-clear>Clear them</button></p>';
    more(view, ctx);
    observe(view, ctx);
  }
  /*
   * Names that differ only by a numeral (Dexterity Bonus I to IV) are one
   * thing in four strengths: one line, with the strengths as buttons.
   */
  const ROMAN = /^(.*\S)\s+(I|II|III|IV|V|VI)$/;
  function bundleRows(rows) {
    const out = [], byBase = new Map();
    for (const r of rows) {
      const m = String(r.said || r.name).match(ROMAN);
      if (!m) { out.push(r); continue; }
      let b = byBase.get(m[1]);
      if (!b) { b = { bundle: true, name: m[1], members: [] }; byBase.set(m[1], b); out.push(b); }
      b.members.push([m[2], r]);
    }
    const order = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    for (const b of byBase.values()) b.members.sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
    return out.map(x => x.bundle && x.members.length === 1 ? x.members[0][1] : x);
  }
  function grouped(rows, ctx, by) {
    const d = ctx.d;
    const sorter = (a, b) => (d.sortBy ? d.sortBy(a) - d.sortBy(b) : 0) || String(a.name).replace(/^The /, '').localeCompare(String(b.name).replace(/^The /, ''));
    const pack = list => d.id === 'enchants' ? bundleRows(list) : list;
    if (by === 'section') {
      const keep = new Set(rows.map(r => r.id));
      const sections = ctx.g ? [ctx.g] : d.abilities
        ? d.groups.flatMap(x => x === d.abilities.kinds[0] ? [d.abilities] : d.abilities.kinds.includes(x) ? [] : [x]) : d.groups;
      const parts = sections.map(p => ({ title: p.title, g: p, rows: pack(p.ids.filter(id => keep.has(id)).map(id => IX.records.get(id)).sort(sorter)) }));
      const side = rows.filter(r => IX.isSidePortal(r));
      if (side.length && d.id === 'dungeons') parts.push({ title: 'Other portals', rows: side.sort(sorter) });
      return parts.filter(p => p.rows.length);
    }
    const G = GROUP[by], buckets = new Map();
    for (const r of rows) { const k = G.key(r); (buckets.get(k) || buckets.set(k, []).get(k)).push(r); }
    // The catch-all bucket (no home, no status) goes last, whatever its size.
    return [...buckets].map(([title, list]) => ({ title, rows: pack(list.sort(sorter)) }))
      .sort((a, b) => ((a.title === G.last) - (b.title === G.last)) || (G.order ? G.order(a.title) - G.order(b.title) : b.rows.length - a.rows.length) || a.title.localeCompare(b.title));
  }
  // Draw the next slice: a few hundred cells at a time, whole groups where they fit.
  function more(view, ctx) {
    const box = $('ixbList');
    if (!box) return;
    let budget = view === 'wall' ? 360 : 240, html = '';
    while (budget > 0 && pending.length) {
      const g = pending[0];
      if (!g.started) {
        html += (g.bare ? '' : '<div class="ixb-grp">' + esc(g.title) + ' <small>' + g.rows.length + '</small></div>') + '<div class="' + (view === 'wall' ? 'ixb-walls' : 'ixb-rows') + '" data-grp></div>';
        g.started = true; g.at = 0;
      }
      const take = g.rows.slice(g.at, g.at + budget);
      g.at += take.length; budget -= take.length;
      const here = { ...ctx, g: ctx.g || g.g, heading: g.title, mixed: g.mixed };
      html += '<template data-fill>' + take.map(r => view === 'wall' ? tileOf(r, here) : rowOf(r, here)).join('') + '</template>';
      if (g.at >= g.rows.length) pending.shift();
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // Each template fills the last group container drawn so far.
    for (const node of [...tmp.childNodes]) {
      if (node.tagName === 'TEMPLATE') { const into = box.querySelectorAll('[data-grp]'); into[into.length - 1].append(node.content); }
      else box.append(node);
    }
  }
  let watcher = null;
  function observe(view, ctx) {
    if (watcher) watcher.disconnect();
    // The list scrolls inside its box on a desk, with the page on a phone.
    const root = getComputedStyle($('ixbMid')).overflowY === 'visible' ? null : $('ixbMid');
    watcher = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && pending.length) more(view, ctx); }, { root, rootMargin: '600px' });
    watcher.observe($('ixbSentinel'));
  }
  const fxIcons = r => (IX.statusOf.get(r.id) || []).filter(x => x.how !== 'immune to').slice(0, 3)
    .map(x => '<span title="' + esc((x.how === 'grants' ? 'Grants ' : 'Inflicts ') + x.name) + '">' + IX.art(IX.records.get('status:' + x.name), 14) + '</span>').join('');
  /*
   * One line per thing, saying only what its list does not: a tier on gear,
   * where a creature lives, what kind of thing it is in a mixed list.
   */
  function rowOf(r, ctx) {
    if (r.bundle) {
      const first = r.members[0][1];
      return '<div class="ixb-row' + (r.members.some(([, m]) => m.id === S.open) ? ' is-on' : '') + '" data-pick="' + esc(first.id) + '" role="button" tabindex="0"><span class="ixb-cell">' + IX.art(first, 28) + '</span><span><b>' + esc(r.name) + '</b></span>'
        + '<span class="ixb-vars">' + r.members.map(([n, m]) => '<button type="button" data-pick="' + esc(m.id) + '" class="' + (m.id === S.open ? 'is-on' : '') + '" title="' + esc(m.said || m.name) + '">' + n + '</button>').join('') + '</span></div>';
    }
    const d = ctx && ctx.d;
    let sub = '', end = '';
    if (!d && ctx.mixed !== false) sub = '<span class="ixb-kind ' + KCLASS(r) + '">' + esc(IX.kindSay(r)) + '</span>';
    else if (d && d.id === 'enemies') {
      // The line says where it lives; its role only when no section and no heading says it.
      const role = IX.kindSay(r), byPlace = (S.by || defaultBy(d, ctx.g)) === 'place';
      const showRole = byPlace && !(ctx.g && d.groups.includes(ctx.g)) && role !== 'Enemy';
      const p = byPlace ? null : placeOf(r);
      sub = (p || showRole) ? '<span class="ixb-sub-l">' + esc([showRole ? role : '', p ? p.name : ''].filter(Boolean).join(' · ')) + '</span>' : '';
    }
    if (d && d.id === 'gear' && d.kindOf && d.kindOf.has(r.id) && !isKind(d, ctx.g)) {
      const holder = IX.holderOf.get(r.slot);
      sub = '<span class="ixb-sub-l">' + esc(d.kindOf.get(r.id).title) + (holder ? ' · ' + esc(holder.name) : '') + '</span>';
    }
    if (d && (d.id === 'gear' || d.id === 'skins')) { const t = tierOf(r); if (t && t !== ctx.heading) end += '<span class="ixb-tier is-' + t.toLowerCase() + '">' + tierSay(t) + '</span>'; }
    // What a creature inflicts is on its card; its line says where it lives.
    if (!d || d.id !== 'enemies') end = fxIcons(r) + end;
    if (d && d.id === 'dungeons') end = lootStrip(r, 8) + end;
    return '<button type="button" class="ixb-row' + (S.open === r.id ? ' is-on' : '') + '" data-pick="' + esc(r.id) + '" ' + (tipOn(r) ? 'aria-label' : 'title') + '="' + esc(r.said || r.name) + '"><span class="ixb-cell">' + IX.art(r, 28) + '</span><span>'
      + (sub && !d ? sub : '') + '<b>' + esc(shortName(r, ctx)) + '</b>' + (sub && d ? sub : '') + '</span><span class="ixb-end">' + end + '</span></button>';
  }
  function tileOf(r, ctx) {
    if (r.bundle) {
      const first = r.members[0][1];
      return '<div class="ixb-tile" data-pick="' + esc(first.id) + '" role="button" tabindex="0">' + IX.art(first, 36) + '<span>' + esc(r.name) + '</span><span class="ixb-vars">'
        + r.members.map(([n, m]) => '<button type="button" data-pick="' + esc(m.id) + '" title="' + esc(m.said || m.name) + '">' + n + '</button>').join('') + '</span></div>';
    }
    const dif = r.kind === 'portal' && IX.difficultyOf(r);
    const said = esc((r.said || r.name) + (dif ? ' · difficulty ' + dif + '/10' : ''));
    // With the hover list to read, the browser's own tooltip would open beside it: the name stays for screen readers only.
    return '<button type="button" class="ixb-tile' + (S.open === r.id ? ' is-on' : '') + '" data-pick="' + esc(r.id) + '" ' + (tipOn(r) ? 'aria-label="' + said + '"' : 'title="' + said + '"') + '>'
      + (dif ? '<i class="ixb-pip">' + dif + '</i>' : '') + IX.art(r, 40) + '<span>' + esc(shortName(r, ctx)) + '</span>' + lootStrip(r, 4) + '</button>';
  }

  /* ---------------- search ---------------- */
  // Everything that matches, sorted into its families, which narrow it in one click.
  function search(box) {
    box.dataset.fam = '';
    if (!familyOf) { familyOf = new Map(); for (const d of IX.domains) for (const id of d.ids) if (!familyOf.has(id)) familyOf.set(id, d.id); }
    const hits = IX.search(S.q, 800);
    const fam = r => familyOf.get(r.id) || (IX.isTechnical(r) ? 'tech' : 'other');
    const per = count(hits.map(fam));
    const shownHits = S.qf ? hits.filter(r => fam(r) === S.qf) : hits;
    const title = id => id === 'tech' ? 'Technical objects' : id === 'other' ? 'Other' : IX.domain(id).title;
    const fams = [...per.keys()];
    box.innerHTML = '<div class="ixb-head"><div><h2>“' + esc(S.q.trim()) + '”</h2><p>' + (hits.length ? (hits.length >= 800 ? 'The first 800 matches' : n0(hits.length) + (hits.length === 1 ? ' match' : ' matches')) + '. Enter opens the first.' : 'Nothing has that name.') + '</p></div></div>'
      + (fams.length > 1 ? '<div class="ixb-tools"><button type="button" class="ixb-chip' + (S.qf ? '' : ' is-on') + '" data-qf="">All <small>' + hits.length + '</small></button>'
        + fams.map(id => '<button type="button" class="ixb-chip' + (S.qf === id ? ' is-on' : '') + '" data-qf="' + id + '">' + esc(title(id)) + ' <small>' + per.get(id) + '</small></button>').join('') + '</div>' : '')
      + '<div id="ixbList"></div><div class="ixb-sentinel" id="ixbSentinel"></div>';
    const parts = new Map();
    for (const r of shownHits) { const k = fam(r); (parts.get(k) || parts.set(k, []).get(k)).push(r); }
    // A group of one kind (all dungeons) does not say the kind on every line.
    pending = [...parts].map(([k, rows]) => ({ title: title(k), rows, mixed: new Set(rows.map(IX.kindSay)).size > 1 }));
    if (pending.length === 1) pending[0].bare = true;
    const ctx = { d: null };
    ctxNow = ctx; viewNow = 'rows';
    more('rows', ctx);
    observe('rows', ctx);
    searchFirst = shownHits[0] ? shownHits[0].id : '';
  }

  // A family's taste: one picture per section, then its most telling members, no sprite twice.
  function sampleOf(d, n) {
    const out = [], keys = new Set();
    const add = id => { const r = IX.records.get(id); const k = r && IX.picKey(r); if (r && k && !keys.has(k) && IX.hasPicture(r)) { keys.add(k); out.push(id); } };
    for (const g of d.groups) add(g.pic);
    const ranked = d.ids.map(id => IX.records.get(id)).sort((a, b) => (d.sortBy ? d.sortBy(a) - d.sortBy(b) : 0));
    for (const r of ranked) { if (out.length >= n) break; add(r.id); }
    return out.slice(0, n);
  }
  // A family's sections as links; gear's twenty-nine read as its four hands.
  function hubSections(d) {
    if (d.id === 'gear') return Object.entries(HAND_SAY).map(([h, say]) => h === 'ability' && d.abilities
      ? '<button type="button" data-f="gear" data-s="abilities">' + say + '</button>'
      : '<button type="button" data-f="gear" data-unfold="' + h + '">' + say + '</button>').join('');
    const some = d.groups.slice(0, 7);
    return some.map(g => '<button type="button" data-f="' + d.id + '" data-s="' + esc(g.id) + '">' + esc(g.title) + '</button>').join('')
      + (d.groups.length > some.length ? '<button type="button" data-f="' + d.id + '">+' + (d.groups.length - some.length) + ' more</button>' : '');
  }
  /*
   * The page before a family is chosen: every family as a card that fills
   * the room it has - what it holds, a strip of its members, its sections
   * one click away. Nothing under them, so the page never needs to scroll.
   */
  function landing(box) {
    box.dataset.fam = 'overview';
    box.innerHTML = '<div class="ixb-landing"><div class="ixb-head"><div><h2>Index</h2><p>Pick a family, or search with <b>/</b>.</p></div></div>'
      + '<div class="ixb-hub">' + ORDER.map(id => IX.domain(id)).map(d => '<div class="ixb-famcard"><button type="button" class="ixb-t" data-f="' + d.id + '">'
        + '<span class="ixb-tpic">' + IX.art(IX.records.get(d.pic), 30) + '</span><b>' + esc(d.title) + '</b><small>' + n0(d.ids.length) + '</small></button>'
        + '<p>' + esc(d.blurb) + '</p>'
        + '<div class="ixb-strip">' + sampleOf(d, 90).map(id => '<button type="button" data-pick="' + esc(id) + '" title="' + esc(IX.records.get(id).said || IX.records.get(id).name) + '">' + IX.art(IX.records.get(id), 34) + '</button>').join('') + '</div>'
        + (d.groups.length > 1 ? '<div class="ixb-secs">' + hubSections(d) + '</div>' : '') + '</div>').join('') + '</div></div>';
    fitStrips();
  }
  // A strip shows whole rows only: a picture the card would cut in half is left out.
  function fitStrips() {
    for (const strip of document.querySelectorAll('#ixbMid .ixb-strip')) {
      const room = strip.clientHeight;
      for (const one of strip.children) one.style.visibility = one.offsetTop + one.offsetHeight > room + 1 ? 'hidden' : '';
    }
  }

  /* ---------------- card ---------------- */
  /*
   * The card is web/index-page.js's own; this only opens and shuts it, makes
   * it wide on demand, and sizes its type from the column it is in (the page
   * sizes it from the window, which in a third of the screen is too small).
   */
  function card() {
    const body = $('ixBody');
    body.classList.toggle('is-wide', Boolean(S.wide));
    const wide = $('ixbWide');
    if (wide) {
      wide.classList.toggle('is-on', Boolean(S.wide));
      wide.title = S.wide ? 'Make the card narrow again' : 'Make the card wide';
      wide.textContent = S.wide ? '⤡' : '⤢';
    }
    const want = S.open && IX.records.get(S.open) ? S.open : '';
    if (!want) { RealmIndex.close(); return; }
    // open() leaves a card already on screen as it is: no redraw, no scroll lost.
    RealmIndex.open(want);
  }
  function sizeCard() {
    const box = $('ixCard');
    if (!box) return;
    const px = Math.max(13, Math.min(19, box.clientWidth / 42));
    box.style.setProperty('--ix-fs', px.toFixed(2) + 'px');
    fitCardArt();
  }
  /*
   * The card's small pictures - a link's sprite, a dust's or a material's
   * icon - are cut at a size set by the window, and its type now follows the
   * column: in a wide column the words outgrew them. Each is brought up to a
   * little more than the type beside it; a larger picture is left as it is.
   */
  function fitCardArt() {
    const box = $('ixCard');
    if (!box) return;
    const want = (parseFloat(box.style.getPropertyValue('--ix-fs')) || 0) * 1.25;
    if (!want) return;
    for (const one of box.querySelectorAll('.ix-jump .ix-art, .fc2-ui')) {
      one.style.zoom = '';
      const tall = one.getBoundingClientRect().height;
      if (tall > 2 && tall < want) one.style.zoom = (want / tall).toFixed(3);
    }
  }
  function openCard(id, from) {
    hideTip();
    S.open = id;
    document.querySelectorAll('#ixbMid .is-on[data-pick]').forEach(x => x.classList.remove('is-on'));
    if (from && from.closest('#ixbMid')) (from.closest('.ixb-row,.ixb-tile') || from).classList.add('is-on');
    card(); writeHash();
  }
  function closeCard() {
    S.open = '';
    document.querySelectorAll('#ixbMid .is-on[data-pick]').forEach(x => x.classList.remove('is-on'));
    card(); writeHash();
  }
  // A link followed inside the card, or the card shut there: the list and the address follow it.
  function followCard(id) {
    if (id === S.open) return;
    // Back, Forward or a link from another tool: the address already says it, and is read whole on hashchange.
    const hash = location.hash, at = hash.indexOf('?');
    if (/^#\/?index\b/.test(hash) && (new URLSearchParams(at < 0 ? '' : hash.slice(at + 1)).get('open') || '') === id) return;
    S.open = id;
    document.querySelectorAll('#ixbMid .is-on[data-pick]').forEach(x => x.classList.remove('is-on'));
    if (id) document.querySelectorAll('#ixbMid [data-pick="' + CSS.escape(id) + '"]').forEach(x => (x.closest('.ixb-row,.ixb-tile') || x).classList.add('is-on'));
    writeHash();
  }

  /* ---------------- events ---------------- */
  function all() { rail(); mid(); card(); writeHash(); }
  // Opened from an address or by Back: the open card's line is drawn and brought into sight.
  function reveal() {
    if (!S.open) return;
    const sel = '#ixbList [data-pick="' + CSS.escape(S.open) + '"]';
    for (let guard = 0; guard < 30 && !document.querySelector(sel) && pending.length; guard++) more(viewNow, ctxNow);
    const it = document.querySelector(sel);
    if (it) it.scrollIntoView({ block: 'center' });
  }
  // Going somewhere in the families (the overview, a family, a section) shuts the card that was open.
  function openFamily(f, s) {
    S.f = f; S.s = s || ''; S.q = ''; S.qf = ''; S.by = ''; S.view = ''; clearFilters(); S.tech = false;
    S.open = '';
    $('ixbMid').scrollTop = 0; all();
  }
  const onIndex = () => document.body.dataset.page === 'index';
  function shutMenu(dd) {
    dd.classList.remove('is-open');
    const m = dd.querySelector('.ixb-dd-menu'), b = dd.querySelector('.ixb-dd-btn');
    if (m) m.hidden = true;
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function wire() {
    const page = $('pageIndex');
    page.addEventListener('click', e => {
      const t = e.target.closest('[data-home],[data-f],[data-pick],[data-tag],[data-tech],[data-view],[data-clear],[data-close],[data-wide],[data-hand],[data-qf],[data-dd-open],[data-ddk]');
      // One menu open at a time; its own button toggles it, a click anywhere else shuts it.
      const openOne = document.querySelector('#ixbMid .ixb-dd.is-open');
      if (t && t.dataset.ddOpen) {
        const dd = t.closest('.ixb-dd'), was = dd.classList.contains('is-open');
        if (openOne) shutMenu(openOne);
        if (!was) { dd.classList.add('is-open'); dd.querySelector('.ixb-dd-menu').hidden = false; t.setAttribute('aria-expanded', 'true'); }
        return;
      }
      if (openOne) shutMenu(openOne);
      if (!t || !t.closest('#ixBody')) return;
      if (t.dataset.ddk !== undefined) { S[t.dataset.ddk] = t.dataset.ddv; mid(); writeHash(); return; }
      if (t.dataset.home !== undefined) { openFamily(''); return; }
      if (t.dataset.close !== undefined) { closeCard(); return; }
      if (t.dataset.wide !== undefined) { S.wide = S.wide ? '' : '1'; card(); writeHash(); return; }
      if (t.dataset.hand) { const h = t.dataset.hand; if (hands.has(h)) hands.delete(h); else hands.add(h); store(HANDS, [...hands]); rail(); return; }
      if (t.dataset.qf !== undefined) { S.qf = t.dataset.qf; mid(); writeHash(); return; }
      if (t.dataset.f) {
        if (t.dataset.unfold) { hands.add(t.dataset.unfold); store(HANDS, [...hands]); }
        openFamily(t.dataset.f, t.dataset.s); return;
      }
      if (t.dataset.pick) { openCard(t.dataset.pick, t); return; }
      if (t.dataset.tag) { if (S.tags.has(t.dataset.tag)) S.tags.delete(t.dataset.tag); else S.tags.add(t.dataset.tag); mid(); writeHash(); return; }
      if (t.dataset.tech !== undefined) { S.tech = !S.tech; mid(); writeHash(); return; }
      if (t.dataset.view) { S.view = t.dataset.view; mid(); writeHash(); return; }
      if (t.dataset.clear !== undefined) { clearFilters(); mid(); writeHash(); }
    });
    page.addEventListener('change', e => {
      const t = e.target;
      if (!t.closest('#ixbMid')) return;
      if (t.dataset.sel) { S[t.dataset.sel] = t.value; mid(); writeHash(); }
      if (t.dataset.by !== undefined) { S.by = t.value; mid(); writeHash(); }
    });
    document.addEventListener('keydown', e => {
      if (!onIndex()) return;
      const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('ixbSearch').focus(); $('ixbSearch').select(); return; }
      if (e.target.id === 'ixbSearch' && e.key === 'Enter' && searchFirst) { openCard(searchFirst); return; }
      if (e.key === 'Escape') {
        hideTip();
        const open = document.querySelector('#ixbMid .ixb-dd.is-open');
        if (open) { shutMenu(open); open.querySelector('.ixb-dd-btn').focus(); return; }
        if (e.target.id === 'ixbSearch' && S.q) { S.q = ''; e.target.value = ''; writeHash(); mid(); railFams(); return; }
        if (S.open && !typing) closeCard();
      }
      // A bundled line is a div: Enter opens it like a button.
      if (e.key === 'Enter' && e.target.matches('div[data-pick]')) openCard(e.target.dataset.pick, e.target);
    });
    wireTip();
    document.addEventListener('realmindex:card', e => followCard(e.detail.id));
    document.addEventListener('realmindex:loved', () => rail());
    // RealmEye's archive arrives after the page: places, roles, biomes, dungeon events.
    document.addEventListener('realmindex:realmeye', () => {
      readRecords(); buildDomains();
      const typing = document.activeElement && document.activeElement.id === 'ixbSearch', top = $('ixbMid').scrollTop;
      rail(); mid();
      $('ixbMid').scrollTop = top;
      if (typing) { const q = $('ixbSearch'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    });
    // Back and Forward, and a link from another tool (#index?open=...).
    window.addEventListener('hashchange', () => {
      if (!onIndex() || !/^#\/?index\b/.test(location.hash)) return;
      readHash();
      lastStep = ['f', 's', 'open'].map(k => S[k]).join('|');
      rail(); mid(); card(); reveal();
    });
    // The list's room decides its scale: 1 up to 900px wide, then larger, to half again on a wide screen.
    new ResizeObserver(([e]) => {
      if (!S.f && !S.q.trim()) fitStrips();
      const k = Math.max(1, Math.min(1.5, e.contentRect.width / 900));
      $('ixbMid').style.setProperty('--k', k.toFixed(3));
      $('ixbMid').style.setProperty('--kt', (1 + (k - 1) * 0.5).toFixed(3));
    }).observe($('ixbMid'));
    new ResizeObserver(sizeCard).observe($('ixCard'));
    // The card is drawn and redrawn by its own module: its pictures are fitted once it has settled.
    let fitting = 0;
    new MutationObserver(() => { cancelAnimationFrame(fitting); fitting = requestAnimationFrame(fitCardArt); })
      .observe($('ixCard'), { childList: true });
  }

  /* ---------------- start ---------------- */
  let mounted = null;
  function mount() {
    if (mounted) return mounted;
    mounted = (async () => {
      if (!$('ixbRail') || typeof RealmIndex === 'undefined') return false;
      if (!await RealmIndex.start()) { mounted = null; return false; }
      D = RealmIndex.data();
      await readExtras();
      readRecords();
      buildDomains();
      readHash();
      $('ixbClose').title = 'Close (Esc)';
      wire();
      lastStep = null;
      all();
      reveal();
      sizeCard();
      return true;
    })().catch(err => { console.error(err); mounted = null; return false; });
    return mounted;
  }
  window.RealmIndexBrowse = { mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = { mount };
})();
