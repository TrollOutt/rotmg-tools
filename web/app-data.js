/* Item and enchantment name resolution for calculator selections and hand-overs. */
/**
 * @typedef {Object} AppResolutionData
 * @property {ReadonlyMap<string, string[]>} awakenings
 * @property {ReadonlyMap<string, { itemTags: ReadonlySet<string>, tags: ReadonlySet<string> }>} byName
 * @typedef {Object} AppItemCatalogue
 * @property {ReadonlyMap<string, unknown>} index
 * @property {(name: string) => import('./items').EnchantItemDetails | null | undefined} lookup
 * @typedef {Object} AppResolvedItem
 * @property {string} name
 * @property {string | null} awokenKey
 * @property {string[]} awoken Original catalogue array, or a fresh empty fallback.
 * @property {string | null} type
 * @property {string | null} dust
 * @property {boolean} tiered
 * @property {string} note
 * @property {string | null} special
 * @property {'both' | 'wiki' | 'awakened'} source
 * @property {number} [slots]
 * @typedef {{item: string, slots?: (string | null | undefined)[] | null}} AppItemHandover
 * @typedef {Object} AppItemResolverDependencies
 * @property {() => AppResolutionData | null | undefined} getData Live parsed enchantment catalogue.
 * @property {() => AppItemCatalogue | null | undefined} getItems Live item catalogue and rebuilt index; undefined when its script is absent.
 */
var AppData = (function () {
  'use strict';
  /**
   * Create once for the calculator. No names or results are cached: every call
   * reads the current sources. Resolved objects and picker lists are fresh,
   * while awakening arrays retain their original identity and order.
   * @param {AppItemResolverDependencies} deps
   */
  function createItemResolver(deps) {
    // A guarded resolution tolerates an absent source; the other legacy paths
    // still fail when asked to use an incomplete, uninitialized catalogue.
    /** @returns {AppResolutionData} */
    const data = () => /** @type {AppResolutionData} */ (deps.getData());
    /** @returns {AppItemCatalogue} */
    const items = () => /** @type {AppItemCatalogue} */ (deps.getItems());
    /** @param {string | null | undefined} name @returns {AppResolvedItem | null} */
    function resolveItem(name) {
      if (!name || !deps.getData()) return null;
      const known = deps.getItems() !== undefined ? items().lookup(name) : null;

      // Match the awakenable list case-insensitively too.
      let awokenKey = data().awakenings.has(name) ? name : null;
      if (!awokenKey) {
        const target = name.trim().toLowerCase();
        for (const key of data().awakenings.keys()) if (key.toLowerCase() === target) { awokenKey = key; break; }
      }
      const awoken = awokenKey ? data().awakenings.get(awokenKey) : null;
      if (!known && !awoken) return null;

      /** @type {AppResolvedItem} */
      const resolved = {
        name: known ? known.name : /** @type {string} */ (awokenKey),
        awokenKey,
        awoken: awoken || [],
        type: known ? known.type : null,
        dust: known ? known.dust : null,
        tiered: Boolean(known && known.tiered),
        note: known && known.note ? known.note : '',
        // Alien or Neo Alien, straight from the catalogue when the item has one.
        special: known && known.base ? known.base : null,
        source: known ? (awoken ? 'both' : 'wiki') : 'awakened'
      };

      if (awoken && awoken.length) {
        const mod = data().byName.get(awoken[0]);
        if (mod) {
          if (!resolved.type) resolved.type = [...mod.itemTags][0] || null;
          // Fallback for an awakenable item the catalogue does not carry: an
          // awakened enchantment tagged ALIEN belongs to an alien base, and the
          // "Neo" reskins use the NEO_ALIEN pool. The catalogue wins when it knows.
          if (!resolved.special && mod.tags.has('ALIEN')) resolved.special = /\bneo\b/i.test(resolved.name) ? 'NEO_ALIEN' : 'ALIEN';
        }
      }
      return resolved;
    }

    // Everything the item picker can offer: named gear, tiered placeholders and
    // every awakenable item, de-duplicated.
    /** @returns {string[]} */
    function knownItemNames() {
      const names = new Set();
      if (deps.getItems() !== undefined) for (const name of items().index.keys()) names.add(name);
      if (deps.getData()) for (const name of data().awakenings.keys()) names.add(name);
      return [...names].sort((a, b) => a.localeCompare(b));
    }

    /** @param {AppItemHandover} said */
    function handoverSetup(said) {
      const resolved = resolveItem(said.item);
      const slots = (said.slots || [])
        .map(handoverEnchantName)
        .filter(/** @returns {name is string} */ (name => Boolean(name)))
        .slice(0, 4)
        .map(name => ({ name, locked: false }));
      return {
        resolved,
        setup: {
          item: said.item,
          rarity: String(Math.max(slots.length, resolved && resolved.slots ? resolved.slots : 0) || ''),
          type: (resolved && resolved.type) || '',
          dust: (resolved && resolved.dust) || '',
          slots
        }
      };
    }

    /* An enchantment's name as this page knows it: exact, without its rank numeral, or up to spelling. */
    /** @param {string | null | undefined} name @returns {string | null} */
    function handoverEnchantName(name) {
      if (!name) return null;
      const byName = data().byName;
      if (byName.has(name)) return name;
      const bare = String(name).replace(/\s+(?:[IVX]+|\d+)$/, '').trim();
      if (byName.has(bare)) return bare;
      /** @param {string} value */
      const plain = value => String(value).replace(/\s+(?:[IVX]+|\d+)$/, '').replace(/['’\s-]+/g, ' ').trim().toLowerCase();
      const want = plain(name);
      const tier = (/\s+([IVX]+|\d+)$/.exec(String(name)) || [])[1];
      let fallback = null;
      for (const other of byName.keys()) {
        if (plain(other) !== want) continue;
        if (!tier || new RegExp('\\s' + tier + '$').test(other)) return other;
        fallback = fallback || other;
      }
      return fallback;
    }
    return { resolveItem, knownItemNames, handoverEnchantName, handoverSetup };
  }
  return { createItemResolver };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AppData;
