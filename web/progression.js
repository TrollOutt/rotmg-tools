/* Loot access uses the same client records and community joins as the index.
 * No tier ceiling, name matching, or transitive spawn links: a portal dropping
 * in a biome does not make that dungeon's loot accessible in the biome. */
var BuildProgression = (function () {
  'use strict';
  function catalogue(index, wiki, items, realm, dungeonText = '') {
    const ratings = new Map();
    const ratingKey = value => value.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
    for (const line of dungeonText.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [name, value] = line.split('|'), rating = Number(value);
      if (Number.isFinite(rating) && Number.isInteger(rating * 2)
        && rating >= 1 && rating <= 10) ratings.set(ratingKey(name), rating);
    }
    const records = new Map(index.records.map(r => [r.id, r]));
    const pagesById = new Map();
    for (const [id, page] of wiki.page) {
      const key = wiki.ids[id];
      if (!pagesById.has(key)) pagesById.set(key, new Set());
      pagesById.get(key).add(page);
    }
    const zones = new Map(), placesByPage = new Map(), directBiomeSources = new Map();
    const addPage = (page, zone) => {
      if (!placesByPage.has(page)) placesByPage.set(page, new Set());
      placesByPage.get(page).add(zone);
    };
    // Only real, community-linked dungeon pages; no internal teleporters.
    for (const [id, page] of wiki.page) {
      const record = records.get(wiki.ids[id]);
      if (!record || record.kind !== 'portal') continue;
      if (['Admin Arena', 'Chess', 'Daily Quest Room', 'Grand Bazaar', 'Court of Oryx'].includes(record.name)) continue;
      const [slug, name] = wiki.pages[page];
      const key = 'dungeon:' + slug;
      if (!zones.has(key)) zones.set(key, { id: key, name, kind: 'dungeon', art: record.art,
        difficulty: ratings.get(ratingKey(name)) });
      addPage(page, key);
    }
    for (const [dungeon, enemy] of wiki.dungeon || []) {
      const key = 'dungeon:' + wiki.pages[dungeon][0];
      if (zones.has(key)) addPage(enemy, key);
    }
    for (const record of index.records) {
      if (record.kind !== 'place') continue;
      zones.set(record.id, { id: record.id, name: record.name, kind: 'biome', rank: record.rank,
        art: record.art, icon: record.icon });
      // Named biome gear is already resolved by the Index onto exact client
      // records. Keep both UT and ST pieces: neither is covered by a generic
      // tier band, and both are opt-in through the biome rank selector.
      for (const itemId of [...(record.untiered || []), ...(record.setTier || [])]) {
        if (!directBiomeSources.has(itemId)) directBiomeSources.set(itemId, new Set());
        directBiomeSources.get(itemId).add(record.id);
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
    const slugOf = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const biomeIds = new Map(), tierSources = new Map();
    const aliases = { 'abandoned-city': 'place:Ancient City', 'coral-reefs': 'place:Coral Reef' };
    const biomeArt = {
      beach: (records.get('enemy:Captured Shores Beacon') || {}).art,
      'ancient-city': (records.get('enemy:Captured Abandoned Beacon') || {}).art,
      'deep-sea-abyss': (records.get('enemy:Captured Abyssal Beacon') || {}).art
    };
    for (const biome of Object.values((realm || {}).biomes || {})) {
      const existing = [...zones.values()].find(z => z.kind === 'biome' && slugOf(z.name) === biome.slug);
      const key = existing ? existing.id : (aliases[biome.slug] || 'biome:' + biome.slug);
      const page = pageBySlug.get(biome.slug);
      const name = (zones.get(key) || {}).name || (wiki.pages[page] || [])[1]
        || biome.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      zones.set(key, { id: key, name, kind: 'biome', rank: biome.rank,
        art: (zones.get(key) || {}).art || biomeArt[biome.slug],
        icon: (zones.get(key) || {}).icon });
      biomeIds.set(biome.id, key);
      if (page !== undefined) addPage(page, key);
    }
    for (const [path, creature] of Object.entries((realm || {}).creatures || {})) {
      const page = pageBySlug.get(path.replace(/^\/wiki\//, ''));
      for (const group of creature.groups || []) {
        if (page !== undefined && biomeIds.has(group.biome)) addPage(page, biomeIds.get(group.biome));
      }
    }
    const sourcesByPage = new Map();
    for (const [giver, item] of wiki.drop || []) {
      if (!sourcesByPage.has(item)) sourcesByPage.set(item, new Set());
      for (const zone of placesByPage.get(giver) || []) sourcesByPage.get(item).add(zone);
    }
    for (const [path, creature] of Object.entries((realm || {}).creatures || {})) {
      const page = pageBySlug.get(path.replace(/^\/wiki\//, ''));
      const locations = new Set(placesByPage.get(page) || []);
      for (const group of creature.groups || []) if (biomeIds.has(group.biome)) locations.add(biomeIds.get(group.biome));
      for (const drop of (creature.detail || {}).drops || []) {
        const tier = /^Tier (\d+) (Alternate )?(Weapons|Abilities|Armors?|Rings?)$/.exec(drop.name);
        if (tier) {
          const hand = { Weapons: 'weapon', Abilities: 'ability', Armor: 'armor', Armors: 'armor', Ring: 'ring', Rings: 'ring' }[tier[3]];
          const key = hand + ':' + Number(tier[1]) + ':' + !!tier[2];
          if (!tierSources.has(key)) tierSources.set(key, new Set());
          for (const zone of locations) tierSources.get(key).add(zone);
        } else {
          const itemPage = pageBySlug.get((drop.path || '').replace(/^\/wiki\//, ''));
          if (itemPage === undefined) continue;
          if (!sourcesByPage.has(itemPage)) sourcesByPage.set(itemPage, new Set());
          for (const zone of locations) sourcesByPage.get(itemPage).add(zone);
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
      for (const zone of placesByPage.get(enemy) || []) tierSources.get(key).add(zone);
    }
    const sources = new Map();
    for (const id of index.views.theory.items) {
      const record = records.get(id), found = new Set();
      for (const page of pagesById.get(id) || []) {
        for (const zone of sourcesByPage.get(page) || []) found.add(zone);
      }
      for (const zone of directBiomeSources.get(id) || []) found.add(zone);
      sources.set(record.name, found);
    }
    for (const item of items) {
      const labels = (item.labels || '').split(',');
      // Lootable base/subtype items only: no soulbound copies or reskins are
      // invented by expanding a category such as "Tier 7 Weapons".
      if (!labels.includes('LOOTABLE') || (item.hand === 'weapon'
        && !labels.includes('BASETYPE') && !labels.includes('SUBTYPE'))) continue;
      const key = item.hand + ':' + item.tier + ':' + (item.hand === 'weapon' && labels.includes('SUBTYPE'));
      if (!sources.has(item.name)) sources.set(item.name, new Set());
      for (const zone of tierSources.get(key) || []) sources.get(item.name).add(zone);
    }
    const baseline = new Map();
    for (const item of items) {
      if (item.tier === undefined) continue;
      const was = baseline.get(item.slot);
      if (!was || item.tier < was.tier) baseline.set(item.slot, item);
    }
    const starter = new Set([...baseline.values()].map(item => item.name));
    for (const zone of zones.values()) {
      zone.count = [...sources.values()].filter(s => s.has(zone.id)).length;
    }
    const ranks = { Rookie: 0, Adept: 1, Veteran: 2, Seasonal: 3 };
    return { zones: [...zones.values()].sort((a, b) =>
      ((ranks[a.rank] ?? 4) - (ranks[b.rank] ?? 4)) || a.name.localeCompare(b.name)), sources, starter };
  }
  function normalize(value, cat) {
    if (!value || ![1, 2, 3].includes(value.version) || !['personal', 'best'].includes(value.mode)
      || !Array.isArray(value.zones)) return null;
    const selection = value.version === 1 ? 'manual' : value.selection;
    if (!['manual', 'difficulty'].includes(selection)) return null;
    const difficulty = value.difficulty;
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
  function forDifficulty(cat, difficulty) {
    if (!cat || !Number.isFinite(difficulty) || !Number.isInteger(difficulty * 2)
      || difficulty < 1 || difficulty > 10) return [];
    return cat.zones.filter(z => z.kind === 'dungeon' && z.difficulty >= 1 && z.difficulty <= difficulty).map(z => z.id);
  }
  function allows(cat, profile, name) {
    if (!profile) return false;
    if (profile.mode === 'best') return true;
    if (!cat) return false;
    const sources = cat.sources.get(name) || new Set();
    return cat.starter.has(name) || selectedZoneIds(cat, profile).some(id => sources.has(id));
  }
  function selectedZoneIds(cat, profile) {
    if (!cat || !profile) return [];
    const ranks = new Set(Array.isArray(profile.biomeRanks) ? profile.biomeRanks : ['Rookie']);
    return [...new Set([...(profile.zones || []), ...cat.zones
      .filter(zone => zone.kind === 'biome' && ranks.has(zone.rank)).map(zone => zone.id)])];
  }
  return { catalogue, normalize, allows, forDifficulty, selectedZoneIds };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BuildProgression;
