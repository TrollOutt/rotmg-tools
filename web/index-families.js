/* Index family construction and catalogue relationships. Picture decoding stays with the caller. */
/**
 * @typedef {Object} IndexFamilyRecord
 * @property {string} id
 * @property {string} kind
 * @property {string} name
 * @property {boolean | readonly string[]} [hidden]
 * @property {boolean | number} [dev]
 * @property {boolean} [communityOnly]
 * @property {readonly string[]} [labels]
 * @property {number} [hp]
 * @property {number} [tier]
 * @property {number} [slot]
 * @property {string} [hand]
 * @property {string} [tone]
 * @property {boolean | readonly string[]} [spawns]
 * @property {readonly number[]} [slots]
 * @property {readonly [string, string][]} [out]
 * @property {{ relations?: readonly { type: string, to: string }[] }} [realmeyeArchive]
 * @property {{ spawns: readonly { id?: string }[], waves?: readonly { enemies: readonly { id?: string }[] }[] }} [event]
 */
/**
 * @typedef {Object} IndexFamilySection
 * @property {string} id
 * @property {string} title
 * @property {string[]} ids
 * @property {string | null | undefined} pic
 */
/**
 * @template {IndexFamilyRecord} R
 * @typedef {Object} IndexFamilyDomain
 * @property {string} id
 * @property {string} title
 * @property {string} blurb
 * @property {IndexFamilySection[]} groups
 * @property {string[]} ids
 * @property {string | null | undefined} [pic]
 * @property {(record: R) => number} [sortBy]
 * @property {IndexFamilySection & { kinds: IndexFamilySection[] }} [abilities]
 * @property {Map<string, IndexFamilySection>} [kindOf]
 */
/**
 * @template {IndexFamilyRecord} R
 * @typedef {Object} IndexFamilyDependencies
 * @property {() => readonly R[]} getList Current unfolded catalogue in insertion order.
 * @property {(id: string | null | undefined) => R | undefined} getRecord Live lookup, including absent representatives and unresolved relations.
 * @property {() => Record<string, readonly string[]>} getSlots
 * @property {() => IndexFamilyDomain<R>[]} getDomains Published families, read again by resolutions and lazy associations.
 * @property {() => ReadonlyMap<string, ReadonlySet<string>> | null | undefined} getFoundIn Current archive roster.
 * @property {(ids: string[]) => void} setSidePortals Publish at the original build phase, including a later failed build.
 * @property {(holders: Map<number, R>) => void} setHolderOf
 * @property {(domains: IndexFamilyDomain<R>[]) => void} setDomains
 * @property {() => readonly string[]} getBiomeLevels
 * @property {(record: R) => number | null} difficultyOf
 * @property {(record: R) => R | null} portalHome Live portal resolver, including replacements by the adapter.
 * @property {(record: R) => boolean} isEventDungeon
 * @property {(record: R) => boolean} isSidePortal
 * @property {(record: R) => boolean} isTechnical
 * @property {(record: R) => boolean} hasPicture
 * @property {(record: R) => string} picKey
 * @property {(record: R) => boolean} isGear
 * @property {(record: R) => string} kindSay
 * @property {(record: R) => string} biomeLevel
 * @property {(record: R) => string} bagShelf
 */
var IndexFamilies = (function () {
  'use strict';
  /**
   * Create once per browse interface. Callbacks stay live. Portal names are
   * indexed on first demand, memberships on first search and drops on first
   * query. Only a completed family build invalidates memberships and drops;
   * portal names and representative pictures reset at the start of a build.
   * @template {IndexFamilyRecord} R
   * @param {IndexFamilyDependencies<R>} deps
   */
  function createFamilies(deps) {
    /** @param {R} r */
    const L = r => r.labels || [];
    /** @param {R | null | undefined} r */
    const archiveOf = r => (r && r.realmeyeArchive) || null;
    // Family IDs already resolve in the catalogue. Keep the legacy failure if
    // that invariant is broken, while optional relations use getRecord directly.
    /** @param {string} id @returns {R} */
    const member = id => /** @type {R} */ (deps.getRecord(id));
    const BAG_SHELVES = [
      ['potions', 'Potions'], ['chests', 'Chests & boxes'], ['keys', 'Keys'], ['blueprints', 'Blueprints'],
      ['materials', 'Materials & marks'], ['pets', 'Pets'], ['dyes', 'Dyes'], ['styles', 'Item styles'],
      ['titles', 'Titles'], ['emotes', 'Emotes & entrances'], ['tarot', 'Tarot & artifacts'],
      ['unlockers', 'Skin unlockers'], ['other', 'Other consumables']
    ];
    /** @type {[RegExp, string][]} */
    const PORTAL_PART = [
      [/^AI Untaris\b/, 'Untaris'], [/^HUDL\b/, 'Heroic Undead Lair'], [/^LH\b|^Lost Halls \(/, 'Lost Halls'],
      [/^LOD\b|Draconis|^Ivory Wyvern/, 'Lair of Draconis'], [/^3D Portal/, 'The Third Dimension'], [/Shaitan/, 'Lair of Shaitan'],
      [/^Remnant of the Void/, 'The Void'], [/Wine Cellar/, 'Wine Cellar'], [/^Tomb of the Ancients \(/, 'Tomb of the Ancients']
    ];
    /** @type {Map<string, R> | null} */
    let mainByName = null;
    /** @param {R | null | undefined} r @returns {R | null} */
    const portalHome = r => {
      if (!r || r.kind !== 'portal' || deps.difficultyOf(r)) return null;
      if (!mainByName) { mainByName = new Map(); for (const p of deps.getList()) if (p.kind === 'portal' && deps.difficultyOf(p)) mainByName.set(String(p.name).toLowerCase(), p); }
      const name = String(r.name);
      for (const [test, home] of PORTAL_PART) if (test.test(name)) return mainByName.get(home.toLowerCase()) || null;
      const base = name.replace(/^Legacy\s+/, '').replace(/\s+Portal$/, '').trim().toLowerCase();
      return mainByName.get(base) || mainByName.get('the ' + base) || null;
    };
    // A dungeon RealmEye describes (a boss, a roster, drops) and the client does not rate: an event or seasonal one.
    /** @param {R} r */
    const isEventDungeon = r => r.kind === 'portal' && !deps.difficultyOf(r) && !deps.portalHome(r)
      && ((archiveOf(r) || {}).relations || []).some(x => /^dungeon_/.test(x.type));
    // A portal that is no dungeon of its own: a part of one, a hub (Nexus, Vault, guild halls), a test.
    /** @param {R} r */
    const isSidePortal = r => r.kind === 'portal' && !deps.difficultyOf(r) && !deps.isEventDungeon(r);

    /** @type {Set<string>} */
    const used = new Set();
    /** @param {R | undefined} r @returns {r is R} */
    const canPick = r => Boolean(r && !r.hidden && deps.hasPicture(r));
    /** @param {string[]} ids @param {(record: R) => number} [score] */
    function pick(ids, score = () => 0) {
      const ranked = [...ids].map(id => deps.getRecord(id)).filter(canPick).sort((a, b) => score(b) - score(a));
      const r = ranked.find(x => !used.has(deps.picKey(x))) || ranked[0];
      if (r) used.add(deps.picKey(r));
      return r ? r.id : null;
    }
    /*
     * What a family lists: nothing hidden, RealmEye's own records only as
     * biomes, and the plumbing (the build marks it dev) only where it has a
     * place of its own: the pools' section, the other portals.
     */
    /** @param {R} r */
    const shown = r => !r.hidden && (!r.dev || r.kind === 'pool' || r.kind === 'portal') && (!r.communityOnly || r.kind === 'place');
    /** @param {(record: R) => boolean} test */
    const visible = test => deps.getList().filter(r => shown(r) && !deps.isTechnical(r) && test(r)).map(r => r.id);
    /** @param {(record: R) => boolean} test */
    const technical = test => deps.getList().filter(r => shown(r) && deps.isTechnical(r) && test(r)).map(r => r.id);
    /** @param {R} r */
    const hp = r => r.hp || 0;
    /** @param {R} r */
    const tierScore = r => (r.tier !== undefined ? r.tier : L(r).includes('UT') ? 15 : L(r).includes('ST') ? 16 : 0);
    /** @param {string} id @param {string} title @param {string[]} ids @param {(record: R) => number} [score] @returns {IndexFamilySection} */
    const section = (id, title, ids, score) => ({ id, title, ids, pic: pick(ids, score) });

    function buildDomains() {
      used.clear();
      mainByName = null;
      /** @type {IndexFamilyDomain<R>[]} */
      const out = [];
      /** @param {string} id @param {string} title @param {string} blurb @param {IndexFamilySection[]} groups @param {Partial<IndexFamilyDomain<R>>} [extra] */
      const domain = (id, title, blurb, groups, extra = {}) => {
        const ids = [...new Set(groups.flatMap(g => g.ids))];
        out.push({ id, title, blurb, groups: groups.filter(g => g.ids.length), ids, ...extra });
      };
      const classes = visible(r => r.kind === 'class');
      domain('classes', 'Classes', 'Their stats, the gear they hold and the skins they wear.', [section('all', 'Classes', classes)],
        { sortBy: r => classes.indexOf(r.id) });
      const dungeons = visible(r => r.kind === 'portal' && !deps.isSidePortal(r));
      deps.setSidePortals(deps.getList().filter(r => shown(r) && deps.isSidePortal(r)).map(r => r.id));
      /** @param {R} r */
      const band = r => { const d = deps.difficultyOf(r); return !d ? 'other' : d <= 3 ? 'easy' : d <= 6 ? 'mid' : d <= 8 ? 'hard' : 'end'; };
      /** @param {R} r */
      const dungeonScore = r => deps.difficultyOf(r) || 0;
      /** @param {string} b */
      const inBand = b => dungeons.filter(id => band(member(id)) === b);
      domain('dungeons', 'Dungeons', 'Every dungeon: who lives there, what drops, how hard it is.', [
        section('easy', 'Starter (1–3)', inBand('easy'), dungeonScore),
        section('mid', 'Intermediate (4–6)', inBand('mid'), dungeonScore),
        section('hard', 'Advanced (7–8)', inBand('hard'), dungeonScore),
        section('end', 'Endgame (9–10)', inBand('end'), dungeonScore),
        section('other', 'Events & seasonal', inBand('other'), dungeonScore)
      ], { sortBy: r => deps.difficultyOf(r) || 99 });
      const places = visible(r => r.kind === 'place');
      domain('biomes', 'Realm biomes', 'The places of the realm and what roams them.',
        deps.getBiomeLevels().map(l => section(l.toLowerCase(), l === 'Other' ? 'Other biomes' : l, places.filter(id => deps.biomeLevel(member(id)) === l))));
      // The events in the order the catalogue writes them: the invasion, then the year's holidays, then the seasons.
      const events = visible(r => r.kind === 'event');
      domain('events', 'Events', 'The seasonal events, and the score of the realm at which each brings out its creatures.',
        [section('all', 'Events', events)], { sortBy: r => events.indexOf(r.id) });
      const st = visible(r => r.kind === 'status');
      domain('status', 'Status effects', 'What each effect does, what inflicts it and who is immune.', [
        section('bad', 'Debuffs', st.filter(id => member(id).tone === 'bad')),
        section('good', 'Buffs', st.filter(id => member(id).tone === 'good'))
      ]);
      const foes = visible(r => r.kind === 'enemy');
      /** @param {string} id */
      const role = id => deps.kindSay(member(id));
      domain('enemies', 'Enemies', 'Gods, bosses, encounters and everything that shoots back.', [
        section('god', 'Gods', foes.filter(id => role(id) === 'God'), hp),
        section('hero', 'Heroes of Oryx', foes.filter(id => role(id) === 'Hero of Oryx'), hp),
        section('encounter', 'Encounters', foes.filter(id => role(id) === 'Encounter'), hp),
        section('boss', 'Bosses', foes.filter(id => role(id) === 'Boss'), hp),
        section('miniboss', 'Minibosses', foes.filter(id => role(id) === 'Miniboss'), hp),
        section('spawner', 'Spawners', foes.filter(id => member(id).spawns), hp),
        section('enemy', 'Other enemies', foes.filter(id => role(id) === 'Enemy' && !member(id).spawns), hp)
      // Creatures with a known home first (the event copies and test dummies have none), then the toughest.
      ], { sortBy: r => (deps.getFoundIn() && (/** @type {ReadonlyMap<string, ReadonlySet<string>>} */ (deps.getFoundIn())).has(r.id) ? 0 : 1e9) - hp(r) });
      const gear = visible(deps.isGear);
      domain('gear', 'Gear', 'Weapons, abilities, armour and rings, tiered, UT and ST.',
        Object.entries(deps.getSlots()).map(([slot, [say]]) => section('slot' + slot, say, gear.filter(id => String(member(id).slot) === slot), tierScore)),
        { sortBy: r => -tierScore(r) });
      domain('sets', 'Sets', 'Four pieces that change the look and the shot.', [section('all', 'Sets', visible(r => r.kind === 'set'))]);
      const skins = visible(r => r.kind === 'skin');
      /** @param {R} r */
      const wornBy = r => ((r.out || []).find(([h]) => h === 'worn by') || [])[1];
      domain('skins', 'Skins', 'Every costume, class by class.',
        classes.map(cid => section(cid, member(cid).name, skins.filter(id => wornBy(member(id)) === cid))),
        { sortBy: r => (L(r).includes('ST') ? 0 : 1) });
      const bag = visible(r => r.kind === 'item' && !deps.isGear(r));
      /** @type {Map<string, string[]>} */
      const shelf = new Map(BAG_SHELVES.map(([id]) => [id, []]));
      for (const id of bag) (/** @type {string[]} */ (shelf.get(deps.bagShelf(member(id))))).push(id);
      domain('bag', 'Consumables & bag', 'Potions, chests, keys, blueprints, pets, dyes, styles, emotes…',
        BAG_SHELVES.map(([id, title]) => section(id, title, /** @type {string[]} */ (shelf.get(id)))),
        // The eight stat potions before the boosters and the event drinks.
        { sortBy: r => (L(r).includes('STATPOTION') ? 0 : 1) });
      // Enchantments by what they are: the awakened and unique ones apart from the stat bonuses.
      const enchants = visible(r => r.kind === 'enchant');
      /** @param {R} r */
      const sort = r => L(r).includes('AWAKENED') ? 'awakened' : L(r).includes('UNIQUE') ? 'unique'
        : L(r).some(l => /ALIEN/.test(l)) ? 'alien' : L(r).some(l => /^(PROC|ONHIT|ONSHOOT|ONABILITY)/.test(l)) ? 'proc'
          : L(r).some(l => /^(REWARD|LOOT|XP|DUST)$/.test(l)) ? 'reward' : 'stat';
      /** @param {string} k */
      const ofSort = k => enchants.filter(id => sort(member(id)) === k);
      domain('enchants', 'Enchantments', 'What can roll on gear, and from which pool.', [
        section('awakened', 'Awakened', ofSort('awakened')),
        section('unique', 'Unique', ofSort('unique')),
        section('alien', 'Alien', ofSort('alien')),
        section('proc', 'On hit, shoot or ability', ofSort('proc')),
        section('reward', 'Loot, XP & dust', ofSort('reward')),
        section('stat', 'Stat bonuses', ofSort('stat')),
        section('pool', 'Pools', visible(r => r.kind === 'pool'))
      ]);
      for (const d of out) d.pic = pick(/** @type {string[]} */ (d.groups.map(g => g.pic).filter(Boolean))) || (d.groups[0] && d.groups[0].pic);
      /*
       * Nineteen kinds of ability, most of them one class's, made nineteen
       * headings over a line or two each. They are one section: each line says
       * its kind and the class that holds it, and a menu narrows to one.
       */
      const gd = out.find(d => d.id === 'gear');
      const kinds = gd ? gd.groups.filter(g => (deps.getRecord(g.ids[0]) || {}).hand === 'ability') : [];
      if (gd && kinds.length) {
        gd.abilities = { id: 'abilities', title: 'Abilities', ids: kinds.flatMap(g => g.ids), pic: kinds[0].pic, kinds };
        gd.kindOf = new Map(kinds.flatMap(g => g.ids.map(id => [id, g])));
      }
      /** @type {Map<number, R>} */
      const holderOf = new Map();
      deps.setHolderOf(holderOf);
      for (const id of classes) for (const s of member(id).slots || []) if (!holderOf.has(s)) holderOf.set(s, member(id));
      deps.setDomains(out);
      familyOf = null;
      givesMemo = null;
    }
    /** @param {string} id */
    const domain = id => deps.getDomains().find(d => d.id === id);
    // A family's section by its id, the gear's abilities taken together included.
    /** @param {IndexFamilyDomain<R>} d @param {string | null | undefined} s */
    const groupOf = (d, s) => !s ? null : s === 'abilities' && d.abilities ? d.abilities : d.groups.find(x => x.id === s) || null;
    /** @param {IndexFamilyDomain<R> | null | undefined} d @param {IndexFamilySection | null | undefined} g */
    const isKind = (d, g) => Boolean(d && d.abilities && g && d.abilities.kinds.includes(g));

    /** @type {Map<string, R[]> | null} */
    let givesMemo = null;
    function dungeonGives() {
      if (givesMemo) return givesMemo;
      const gear = new Set((/** @type {IndexFamilyDomain<R>} */ (domain('gear'))).ids);
      /** @type {Map<string, Set<string>>} */
      const by = new Map();
      /** @param {R} portal @param {string} id */
      const give = (portal, id) => {
        const home = deps.difficultyOf(portal) ? portal : deps.portalHome(portal) || portal;
        (/** @type {Set<string>} */ (by.get(home.id) || by.set(home.id, new Set()).get(home.id))).add(id);
      };
      for (const p of deps.getList()) {
        if (p.kind !== 'portal') continue;
        for (const x of (archiveOf(p) || {}).relations || []) if (x.type === 'dungeon_drop_interest' && gear.has(x.to)) give(p, x.to);
      }
      for (const id of gear) {
        for (const x of (archiveOf(deps.getRecord(id)) || {}).relations || []) {
          const from = x.type === 'dropped_by' && x.to && deps.getRecord(x.to);
          if (!from) continue;
          if (from.kind === 'portal') give(from, id);
          else if (from.kind === 'enemy') for (const at of (deps.getFoundIn() && (/** @type {ReadonlyMap<string, ReadonlySet<string>>} */ (deps.getFoundIn())).get(from.id)) || []) { const p = deps.getRecord(at); if (p && p.kind === 'portal') give(p, id); }
        }
      }
      givesMemo = new Map([...by].map(([k, ids]) => [k, [...ids].map(id => member(id))
        .sort((a, b) => tierScore(b) - tierScore(a) || String(a.name).localeCompare(b.name))]));
      return givesMemo;
    }
    // The gear a dungeon gives that a class can hold, of one hand or any.
    /** @param {string} cls @param {R} g */
    const classHolds = (cls, g) => ((deps.getRecord(cls) || {}).slots || []).includes(/** @type {number} */ (g.slot));
    /** @param {R} r @param {string} cls @param {string} hand */
    const gaveTo = (r, cls, hand) => (dungeonGives().get(r.id) || []).filter(g => (!hand || g.hand === hand) && (!cls || classHolds(cls, g)));
    /** @param {IndexFamilyDomain<R>} d @param {number} n */
    function sampleOf(d, n) {
      /** @type {string[]} */
      const out = [];
      const keys = new Set();
      /** @param {string | null | undefined} id */
      const add = id => { const r = deps.getRecord(id); const k = r && deps.picKey(r); if (r && k && !keys.has(k) && deps.hasPicture(r)) { keys.add(k); out.push(/** @type {string} */ (id)); } };
      for (const g of d.groups) add(g.pic);
      const ranked = d.ids.map(id => member(id)).sort((a, b) => (d.sortBy ? d.sortBy(a) - d.sortBy(b) : 0));
      for (const r of ranked) { if (out.length >= n) break; add(r.id); }
      return out.slice(0, n);
    }
    /** @param {R & { event: NonNullable<R["event"]> }} r */
    const eventFaces = r => [...new Set([...r.event.spawns.map(s => s.id), ...(r.event.waves || []).flatMap(w => w.enemies.map(x => x.id))].filter(Boolean))];
    /** @type {Map<string, string> | null} */
    let familyOf = null;
    function familyMembership() {
      if (!familyOf) { familyOf = new Map(); for (const d of deps.getDomains()) for (const id of d.ids) if (!familyOf.has(id)) familyOf.set(id, d.id); }
      return familyOf;
    }
    return { buildDomains, domain, groupOf, isKind, technical, portalHome, isEventDungeon,
      isSidePortal, familyMembership, dungeonGives, classHolds, gaveTo, sampleOf, eventFaces };
  }
  return { createFamilies };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IndexFamilies;
