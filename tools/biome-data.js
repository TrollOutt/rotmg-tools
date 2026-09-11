'use strict';

/*
 * The Index is the public contract for biome facts. The Atlas still discovers
 * those facts from its imported realm reference, then build-index normalises
 * them here. Later Atlas builds read the same contract back instead of
 * maintaining a second, slightly different representation.
 */

const plain = value => String(value || '').toLowerCase()
  .normalize('NFKD').replace(/[\u2018\u2019\u02bc]/g, "'")
  .replace(/[^a-z0-9]+/g, ' ').trim();

function mergeNamed(into, values) {
  const seen = new Set(into.map(one => plain(typeof one === 'string' ? one : one.name)));
  for (const value of values || []) {
    const key = plain(typeof value === 'string' ? value : value && value.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    into.push(typeof value === 'string' ? value : { ...value });
  }
}

function mergeLoot(into, loot) {
  if (!loot) return into;
  into ||= { tiers: {}, slots: {}, dungeons: [], gear: [], items: [] };
  for (const [slot, tiers] of Object.entries(loot.tiers || {})) {
    into.tiers[slot] = [...new Set([...(into.tiers[slot] || []), ...(tiers || [])])]
      .filter(Number.isFinite).sort((a, b) => a - b);
  }
  Object.assign(into.slots, loot.slots || {});
  mergeNamed(into.dungeons, loot.dungeons);
  mergeNamed(into.gear, loot.gear);
  mergeNamed(into.items, loot.items);
  return into;
}

function fromAtlas(atlas) {
  const facts = new Map();
  const take = source => {
    if (!source || !source.name || /^Zone \d+$/.test(source.name)) return;
    const key = plain(source.name);
    const fact = facts.get(key) || { name: source.name };
    if (source.rank) fact.rank = source.rank;
    if (source.wiki) fact.wiki = source.wiki;
    if (source.loot) fact.loot = mergeLoot(fact.loot, source.loot);
    facts.set(key, fact);
  };
  for (const biome of atlas.biomes || []) take(biome);
  // Zone records hold the complete drop aggregation in older Atlas builds.
  for (const zone of atlas.zones || []) take(zone);
  return facts;
}

function fromIndex(index) {
  const facts = new Map();
  for (const place of index.records || []) {
    if (place.kind !== 'place') continue;
    facts.set(plain(place.name), {
      name: place.name, rank: place.rank, wiki: place.wiki,
      loot: place.loot ? JSON.parse(JSON.stringify(place.loot)) : undefined
    });
  }
  return facts;
}

function applyIndexToAtlas(index, atlas) {
  const facts = fromIndex(index);
  let changed = 0;
  for (const target of [...(atlas.biomes || []), ...(atlas.zones || [])]) {
    const fact = facts.get(plain(target.name));
    if (!fact) continue;
    for (const field of ['rank', 'wiki', 'loot']) {
      if (fact[field] === undefined) continue;
      target[field] = typeof fact[field] === 'object'
        ? JSON.parse(JSON.stringify(fact[field])) : fact[field];
    }
    changed++;
  }
  return changed;
}

module.exports = { plain, mergeLoot, fromAtlas, fromIndex, applyIndexToAtlas };
