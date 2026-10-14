/* Loot access uses the same client records and community joins as the index.
 * No tier ceiling, name matching, or transitive spawn links: a portal dropping
 * in a biome does not make that dungeon's loot accessible in the biome. */
/**
 * The projections read by this module, rather than the full source datasets.
 * IDs are canonical Index IDs; wiki relations use positions in ids and pages.
 * @typedef {[number, number, number, number]} Art
 * @typedef {[number, number, number, number, number]} Film
 * @typedef {Object} IndexRecord
 * @property {string} id
 * @property {string} kind
 * @property {string} name
 * @property {string} [rank]
 * @property {Art} [art]
 * @property {string} [icon]
 * @property {Film} [film]
 * @property {number[]} [filmFor]
 * @property {string[]} [untiered]
 * @property {string[]} [setTier]
 * @property {[string, string][]} [in]
 * @typedef {{records: IndexRecord[], views: {theory: {items: string[]}}}} ProgressionIndex
 * @typedef {Object} ProgressionWiki
 * @property {string[]} ids
 * @property {[string, string][]} pages
 * @property {[number, number][]} page
 * @property {[number, number][]} [dungeon]
 * @property {[number, number][]} [drop]
 * @property {string[]} [tierDropHands]
 * @property {[number, number, number, number][]} [tierDrop]
 * @typedef {{name: string, hand: string, slot: number, tier?: number, labels?: string}} ProgressionItem
 * @typedef {{id: string, slug: string, rank: string}} RealmBiome
 * @typedef {{groups?: {biome: string}[], detail?: {drops?: {name: string, path?: string}[]}}} RealmCreature
 * @typedef {{biomes?: Record<string, RealmBiome>, creatures?: Record<string, RealmCreature>}} ProgressionRealm
 * @typedef {{records?: Record<string, {name?: string, sprite?: string}>}} ProgressionEnrichment
 * @typedef {Object} ProgressionZone
 * @property {string} id
 * @property {string} name
 * @property {'dungeon' | 'biome'} kind
 * @property {string} [index]
 * @property {string} [rank]
 * @property {Art} [art]
 * @property {string} [icon]
 * @property {Film} [film]
 * @property {number[]} [filmFor]
 * @property {number} [difficulty]
 * @property {number} [count]
 * @typedef {{zones: ProgressionZone[], sources: Map<string, Set<string>>, starter: Set<string>}} ProgressionCatalogue
 * @typedef {{version: number, mode: string, selection?: string, difficulty?: number | null, zones: unknown, excluded?: unknown, biomeRanks?: string[]}} StoredProgression
 * @typedef {{version: 3, mode: string, selection: string, difficulty: number | null, zones: string[], biomeRanks: string[], excluded?: string[]}} ProgressionProfile
 * @typedef {{mode: string, zones?: string[], biomeRanks?: string[]}} ProgressionSelection
 */
var BuildProgression = (function () {
  'use strict';
  /**
   * @param {ProgressionIndex} index
   * @param {ProgressionWiki} wiki
   * @param {ProgressionItem[]} items
   * @param {ProgressionRealm | null} [realm]
   * @param {string} [dungeonText]
   * @param {ProgressionEnrichment | null} [enrichment]
   * @returns {ProgressionCatalogue}
   */
  function catalogue(index, wiki, items, realm, dungeonText = '', enrichment = null) {
    /** @type {Map<string, number>} */
    const ratings = new Map();
    /** @param {string} value @returns {string} */
    const ratingKey = value => value.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
    for (const line of dungeonText.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [name, value] = line.split('|'), rating = Number(value);
      if (Number.isFinite(rating) && Number.isInteger(rating * 2)
        && rating >= 1 && rating <= 10) ratings.set(ratingKey(name), rating);
    }
    const records = new Map(index.records.map(r => [r.id, r]));
    // Set assertions below follow has/set guards: Map.get does not retain them.
    /** @type {Map<string, Set<number>>} */
    const pagesById = new Map();
    for (const [id, page] of wiki.page) {
      const key = wiki.ids[id];
      if (!pagesById.has(key)) pagesById.set(key, new Set());
      /** @type {Set<number>} */ (pagesById.get(key)).add(page);
    }
    const zones = /** @type {Map<string, ProgressionZone>} */ (new Map()),
      placesByPage = /** @type {Map<number | undefined, Set<string>>} */ (new Map()),
      directBiomeSources = /** @type {Map<string, Set<string>>} */ (new Map());
    /** @param {number} page @param {string} zone @returns {void} */
    const addPage = (page, zone) => {
      if (!placesByPage.has(page)) placesByPage.set(page, new Set());
      /** @type {Set<string>} */ (placesByPage.get(page)).add(zone);
    };
    // Only real, community-linked dungeon pages; no internal teleporters.
    for (const [id, page] of wiki.page) {
      const record = records.get(wiki.ids[id]);
      if (!record || record.kind !== 'portal') continue;
      if (['Admin Arena', 'Chess', 'Daily Quest Room', 'Grand Bazaar', 'Court of Oryx'].includes(record.name)) continue;
      const [slug, name] = wiki.pages[page];
      const key = 'dungeon:' + slug;
      /*
       * A portal's still picture, and the frames it turns over where the
       * client declares them - fifty of them do, each frame with its own
       * duration. A dungeon that shimmers is how it looks in the game.
       */
      // `index`: the portal's own Index record, so a page can open it.
      if (!zones.has(key)) zones.set(key, { id: key, index: record.id, name, kind: 'dungeon', art: record.art,
        film: record.film, filmFor: record.filmFor,
        difficulty: ratings.get(ratingKey(name)) });
      addPage(page, key);
    }
    for (const [dungeon, enemy] of wiki.dungeon || []) {
      const key = 'dungeon:' + wiki.pages[dungeon][0];
      if (zones.has(key)) addPage(enemy, key);
    }
    for (const record of index.records) {
      if (record.kind !== 'place') continue;
      zones.set(record.id, { id: record.id, index: record.id, name: record.name, kind: 'biome', rank: record.rank,
        art: record.art, icon: record.icon });
      // Named biome gear is already resolved by the Index onto exact client
      // records. Keep both UT and ST pieces: neither is covered by a generic
      // tier band, and both are opt-in through the biome rank selector.
      for (const itemId of [...(record.untiered || []), ...(record.setTier || [])]) {
        if (!directBiomeSources.has(itemId)) directBiomeSources.set(itemId, new Set());
        /** @type {Set<string>} */ (directBiomeSources.get(itemId)).add(record.id);
      }
      for (const page of pagesById.get(record.id) || []) addPage(page, record.id);
      for (const [relation, enemy] of record.in || []) {
        if (relation !== 'was seen in') continue;
        for (const page of pagesById.get(enemy) || []) addPage(page, record.id);
      }
    }
    // The Atlas already records named biome populations and explicit tier
    // drops. Reuse that evidence, including Rookie areas the terrain walk
    // did not cover. Only exact tiers are expanded, never every tier below one.
    const pageBySlug = new Map(wiki.pages.map(([slug], page) => [slug, page]));
    /** @param {string} name @returns {string} */
    const slugOf = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const biomeIds = /** @type {Map<string, string>} */ (new Map()),
      tierSources = /** @type {Map<string, Set<string>>} */ (new Map());
    /** @type {Record<string, string | undefined>} */
    const aliases = { 'abandoned-city': 'place:Ancient City', 'coral-reefs': 'place:Coral Reef' };
    /*
     * A biome whose own record carries no picture wears its captured beacon,
     * which is the thing you actually go and take.
     *
     * Keyed by the realm's slug, which is what is looked up below. The Ancient
     * City's slug is `abandoned-city` - the alias two lines up says so - and
     * this said `ancient-city`, so the one biome that needed the fallback
     * never got it and the Adept rank was the one button in the dialog with
     * an empty square where its beacon should be.
     */
    /** @type {Record<string, Art | undefined>} */
    const biomeArt = {
      beach: (records.get('enemy:Captured Shores Beacon') || {}).art,
      'abandoned-city': (records.get('enemy:Captured Abandoned Beacon') || {}).art,
      'deep-sea-abyss': (records.get('enemy:Captured Abyssal Beacon') || {}).art
    };
    /*
     * The biomes the client has no place record for - the seasonal ones, and
     * the plains and forests the Index knows only from the community - are
     * still records in the Index, added from the community file. Found here by
     * name, so such a biome shows the picture the Index shows and opens the
     * Index page about it, instead of being a bare name that goes nowhere.
     */
    /** @type {Map<string, {id?: string, icon?: string}>} */
    const communityPlaces = new Map();
    for (const [id, one] of Object.entries((enrichment && enrichment.records) || {})) {
      if (!/^place:/.test(id)) continue;
      communityPlaces.set(slugOf(one.name || id.slice(6)), { id, icon: one.sprite });
    }
    for (const biome of Object.values((realm || {}).biomes || {})) {
      const existing = [...zones.values()].find(z => z.kind === 'biome' && slugOf(z.name) === biome.slug);
      const key = existing ? existing.id : (aliases[biome.slug] || 'biome:' + biome.slug);
      const page = pageBySlug.get(biome.slug);
      // An absent page still indexes undefined and falls back to the slug.
      const name = (zones.get(key) || {}).name || (wiki.pages[/** @type {number} */ (page)] || [])[1]
        || biome.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const community = communityPlaces.get(slugOf(name)) || communityPlaces.get(biome.slug) || {};
      zones.set(key, { id: key, index: (zones.get(key) || {}).index || community.id, name, kind: 'biome', rank: biome.rank,
        art: (zones.get(key) || {}).art || biomeArt[biome.slug],
        icon: (zones.get(key) || {}).icon || community.icon });
      biomeIds.set(biome.id, key);
      if (page !== undefined) addPage(page, key);
    }
    for (const [path, creature] of Object.entries((realm || {}).creatures || {})) {
      const page = pageBySlug.get(path.replace(/^\/wiki\//, ''));
      for (const group of creature.groups || []) {
        if (page !== undefined && biomeIds.has(group.biome)) addPage(page, /** @type {string} */ (biomeIds.get(group.biome)));
      }
    }
    /** @type {Map<number | undefined, Set<string>>} */
    const sourcesByPage = new Map();
    for (const [giver, item] of wiki.drop || []) {
      if (!sourcesByPage.has(item)) sourcesByPage.set(item, new Set());
      for (const zone of placesByPage.get(giver) || []) /** @type {Set<string>} */ (sourcesByPage.get(item)).add(zone);
    }
    for (const [path, creature] of Object.entries((realm || {}).creatures || {})) {
      const page = pageBySlug.get(path.replace(/^\/wiki\//, ''));
      const locations = new Set(placesByPage.get(page) || []);
      for (const group of creature.groups || []) if (biomeIds.has(group.biome)) locations.add(/** @type {string} */ (biomeIds.get(group.biome)));
      for (const drop of (creature.detail || {}).drops || []) {
        const tier = /^Tier (\d+) (Alternate )?(Weapons|Abilities|Armors?|Rings?)$/.exec(drop.name);
        if (tier) {
          const hand = /** @type {Record<string, string>} */ ({ Weapons: 'weapon', Abilities: 'ability', Armor: 'armor', Armors: 'armor', Ring: 'ring', Rings: 'ring' })[tier[3]];
          const key = hand + ':' + Number(tier[1]) + ':' + !!tier[2];
          if (!tierSources.has(key)) tierSources.set(key, new Set());
          for (const zone of locations) /** @type {Set<string>} */ (tierSources.get(key)).add(zone);
        } else {
          const itemPage = pageBySlug.get((drop.path || '').replace(/^\/wiki\//, ''));
          if (itemPage === undefined) continue;
          if (!sourcesByPage.has(itemPage)) sourcesByPage.set(itemPage, new Set());
          for (const zone of locations) /** @type {Set<string>} */ (sourcesByPage.get(itemPage)).add(zone);
        }
      }
    }
    // RealmEye's tier lists name the enemies that drop each generic tier.
    // Join those enemy pages to the explicit dungeon-population links above,
    // so a selected dungeon unlocks the tiered equipment its inhabitants drop.
    const tierHands = wiki.tierDropHands || ['weapon', 'ability', 'armor', 'ring'];
    for (const [enemy, handAt, tier, alternate] of wiki.tierDrop || []) {
      const hand = tierHands[handAt];
      if (!hand || !Number.isInteger(tier)) continue;
      const key = hand + ':' + tier + ':' + (hand === 'weapon' && Boolean(alternate));
      if (!tierSources.has(key)) tierSources.set(key, new Set());
      for (const zone of placesByPage.get(enemy) || []) /** @type {Set<string>} */ (tierSources.get(key)).add(zone);
    }
    /** @type {Map<string, Set<string>>} */
    const sources = new Map();
    for (const id of index.views.theory.items) {
      const record = records.get(id), found = new Set();
      for (const page of pagesById.get(id) || []) {
        for (const zone of sourcesByPage.get(page) || []) found.add(zone);
      }
      for (const zone of directBiomeSources.get(id) || []) found.add(zone);
      // Theory item IDs always refer to records in this Index projection.
      sources.set(/** @type {IndexRecord} */ (record).name, found);
    }
    for (const item of items) {
      const labels = (item.labels || '').split(',');
      // Lootable base/subtype items only: no soulbound copies or reskins are
      // invented by expanding a category such as "Tier 7 Weapons".
      if (!labels.includes('LOOTABLE') || (item.hand === 'weapon'
        && !labels.includes('BASETYPE') && !labels.includes('SUBTYPE'))) continue;
      const key = item.hand + ':' + item.tier + ':' + (item.hand === 'weapon' && labels.includes('SUBTYPE'));
      if (!sources.has(item.name)) sources.set(item.name, new Set());
      for (const zone of tierSources.get(key) || []) /** @type {Set<string>} */ (sources.get(item.name)).add(zone);
    }
    /** @type {Map<number, ProgressionItem>} */
    const baseline = new Map();
    // Only items with a defined tier enter the baseline map.
    for (const item of items) {
      if (item.tier === undefined) continue;
      const was = baseline.get(item.slot);
      if (!was || item.tier < /** @type {number} */ (was.tier)) baseline.set(item.slot, item);
    }
    const starter = new Set([...baseline.values()].map(item => item.name));
    for (const zone of zones.values()) {
      zone.count = [...sources.values()].filter(s => s.has(zone.id)).length;
    }
    // Missing biome ranks and dungeon ranks keep the existing fallback order.
    /** @type {Record<string, number | undefined>} */
    const ranks = { Rookie: 0, Adept: 1, Veteran: 2, Seasonal: 3 };
    return { zones: [...zones.values()].sort((a, b) =>
      ((ranks[/** @type {string} */ (a.rank)] ?? 4) - (ranks[/** @type {string} */ (b.rank)] ?? 4)) || a.name.localeCompare(b.name)), sources, starter };
  }
  /**
   * Validate the stored profile projection, including legacy versions.
   * @param {StoredProgression | null | undefined} value
   * @param {ProgressionCatalogue | null} [cat]
   * @returns {ProgressionProfile | null}
   */
  function normalize(value, cat) {
    if (!value || ![1, 2, 3].includes(value.version) || !['personal', 'best'].includes(value.mode)
      || !Array.isArray(value.zones)) return null;
    const selection = value.version === 1 ? 'manual' : /** @type {string} */ (value.selection);
    if (!['manual', 'difficulty'].includes(selection)) return null;
    // Number.isFinite rejects absent, null and nonnumeric stored values below.
    const difficulty = /** @type {number} */ (value.difficulty);
    if (selection === 'difficulty' && (!Number.isFinite(difficulty) || !Number.isInteger(difficulty * 2)
      || difficulty < 1 || difficulty > 10)) return null;
    const known = cat && new Set(cat.zones.filter(z => z.kind === 'dungeon').map(z => z.id));
    const eligible = selection === 'difficulty' && cat ? forDifficulty(cat, difficulty) : [];
    const eligibleSet = new Set(eligible);
    const excluded = selection === 'difficulty' && Array.isArray(value.excluded)
      ? [...new Set(value.excluded.filter(id => typeof id === 'string' && eligibleSet.has(id)))] : [];
    const excludedSet = new Set(excluded);
    const zones = selection === 'difficulty' && cat ? eligible.filter(id => !excludedSet.has(id))
      : [...new Set(value.zones.filter(id => typeof id === 'string' && id.startsWith('dungeon:') && (!known || known.has(id))))];
    if (value.mode === 'personal' && !zones.length) return null;
    const permittedRanks = new Set(['Rookie', 'Adept', 'Veteran']);
    const biomeRanks = (value.version >= 3 && Array.isArray(value.biomeRanks) ? value.biomeRanks : ['Rookie'])
      .filter(rank => permittedRanks.has(rank));
    return { version: 3, mode: value.mode, selection,
      difficulty: Number.isFinite(difficulty) && Number.isInteger(difficulty * 2)
        && difficulty >= 1 && difficulty <= 10 ? difficulty : null, zones,
      biomeRanks: [...new Set(biomeRanks)],
      ...(selection === 'difficulty' ? { excluded } : {}) };
  }
  /**
   * @param {ProgressionCatalogue | null | undefined} cat
   * @param {number} difficulty
   * @returns {string[]}
   */
  function forDifficulty(cat, difficulty) {
    if (!cat || !Number.isFinite(difficulty) || !Number.isInteger(difficulty * 2)
      || difficulty < 1 || difficulty > 10) return [];
    // An unrated dungeon compares undefined as before and is not selected.
    return cat.zones.filter(z => z.kind === 'dungeon' && /** @type {number} */ (z.difficulty) >= 1 && /** @type {number} */ (z.difficulty) <= difficulty).map(z => z.id);
  }
  /**
   * @param {ProgressionCatalogue | null | undefined} cat
   * @param {ProgressionSelection | null | undefined} profile
   * @param {string} name
   * @returns {boolean}
   */
  function allows(cat, profile, name) {
    if (!profile) return false;
    if (profile.mode === 'best') return true;
    if (!cat) return false;
    const sources = cat.sources.get(name) || new Set();
    return cat.starter.has(name) || selectedZoneIds(cat, profile).some(id => sources.has(id));
  }
  /**
   * @param {ProgressionCatalogue | null | undefined} cat
   * @param {ProgressionSelection | null | undefined} profile
   * @returns {string[]}
   */
  function selectedZoneIds(cat, profile) {
    if (!cat || !profile) return [];
    const ranks = new Set(Array.isArray(profile.biomeRanks) ? profile.biomeRanks : ['Rookie']);
    return [...new Set([...(profile.zones || []), ...cat.zones
      .filter(zone => zone.kind === 'biome' && ranks.has(/** @type {string} */ (zone.rank))).map(zone => zone.id)])];
  }
  return { catalogue, normalize, allows, forDifficulty, selectedZoneIds };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BuildProgression;
