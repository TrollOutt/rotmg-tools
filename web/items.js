/*
 * Which item you are enchanting, and what that tells us.
 *
 * Two things follow from the item itself and never have to be asked:
 *   - its slot (weapon / ability / armor / ring),
 *   - the dust its rerolls are billed in, which depends on the item's tier.
 *
 * One thing does NOT follow from it: the rarity, and therefore the number of
 * enchantment slots. Rarity is rolled when the item drops (50 % / 37.5 % /
 * 25 % / 12.5 % for Uncommon / Rare / Legendary / Divine), so two copies of the
 * same item can have a different number of slots. It stays a manual choice.
 *
 * A third thing follows from it when it applies: its base family, Alien or Neo
 * Alien. That decides which of the fourteen family enchantments it can take.
 *
 * All three are stated per item by the game client and land in
 * data/Items/client-items.txt, written by tools/generate-items.js. This file
 * holds only the rules that read it: the lookup, and the tier bands used for
 * the synthetic "Tier 9 Weapon" entries a player can price without knowing an
 * item's name.
 */
var EnchantItems = (function () {
  'use strict';

  // Tiered gear: the dust follows the tier number, in three bands per slot.
  // Kept here as well as in the generator so a stale catalogue is still
  // interpreted consistently.
  const TIER_BANDS = {
    WEAPON:  { Green: [1, 9], Red: [10, 12], Purple: [13, 14] },
    ABILITY: { Green: [1, 4], Red: [5, 6],   Purple: [7, 7] },
    ARMOR:   { Green: [1, 9], Red: [10, 12], Purple: [13, 14] },
    RING:    { Green: [1, 4], Red: [5, 6],   Purple: [7, 7] }
  };
  const TIER_LABEL = { WEAPON: 'Weapon', ABILITY: 'Ability', ARMOR: 'Armor', RING: 'Ring' };

  /*
   * Corrections applied on top of the scraped catalogue, each with its reason.
   * The wiki's reroll tables predate the Advance of Oryx set, so its dust is
   * missing there even though the item is listed on the ring index.
   */
  /*
   * Empty on purpose. Every correction that used to live here existed because
   * the dust was being inferred from a tier band or read off a wiki page; the
   * client states it per item, so there is nothing left to correct. The hook
   * stays in case the game itself ever ships something that needs one.
   */
  const OVERRIDES = {};

  /*
   * Empty now. Both entries that lived here corrected a wiki spelling, and one
   * of them had become wrong: the client calls that sword "Pirate King's
   * Cutlass", which is the name the alias was redirecting away from. The
   * case-and-spacing-insensitive lookup below covers the rest. The hook stays
   * for a name the client genuinely writes differently from the player.
   */
  const ALIASES = {};

  const normalise = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function dustForTier(type, tier) {
    const bands = TIER_BANDS[type];
    if (!bands || tier === undefined || tier === null) return null;
    for (const [dust, [low, high]] of Object.entries(bands)) if (tier >= low && tier <= high) return dust;
    return null;
  }

  let index = new Map();
  let byNormalised = new Map();

  /*
   * The same index, built from data/Items/client-items.txt.
   *
   * Everything an item decides — its slot, its dust, its equipment family — is
   * stated outright by the client, so none of it is inferred here any more. The
   * tier bands above survive only for the synthetic "Tier 9 Weapon" entries,
   * which exist so someone who does not remember an item's name can still price
   * a roll; no real item needs them.
   */
  function loadClient(text) {
    index = new Map();
    byNormalised = new Map();
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##') || !line.startsWith('item|')) continue;
      const [, name, slot, dust, , , family] = line.split('|');
      if (!slot || !dust) continue;         // 6 Void items carry neither
      index.set(name, {
        name,
        type: slot,
        dust,
        tier: null,
        tiered: false,
        sprite: null,
        base: family || null,
        note: ''
      });
    }

    for (const [type, bands] of Object.entries(TIER_BANDS)) {
      const max = Math.max(...Object.values(bands).map(range => range[1]));
      for (let tier = 1; tier <= max; tier++) {
        const dust = dustForTier(type, tier);
        const name = `Tier ${tier} ${TIER_LABEL[type]}`;
        if (dust && !index.has(name)) index.set(name, { name, type, dust, tier, tiered: true, sprite: null, base: null, note: '' });
      }
    }

    for (const [name, entry] of index) byNormalised.set(normalise(name), entry);
    return index;
  }

  // Tolerant lookup: exact name, then case/spacing-insensitive, then an alias.
  function lookup(name) {
    if (!name) return null;
    if (index.has(name)) return index.get(name);
    const key = normalise(name);
    if (byNormalised.has(key)) return byNormalised.get(key);
    const alias = ALIASES[key];
    return alias ? index.get(alias) || null : null;
  }

  return {
    TIER_BANDS, TIER_LABEL, ALIASES, OVERRIDES,
    dustForTier, normalise, loadClient, lookup,
    get index() { return index; },
    get size() { return index.size; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EnchantItems;
