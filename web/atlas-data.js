/* Atlas panel lookups. Loading, markup and navigation remain in the viewer. */
/** @typedef {{ groups?: Record<string, string[]>, mundane?: string[] }} AtlasLootKinds */
/** @typedef {{ zones?: { loot?: { dungeons?: ({ name?: string, art?: string } | null)[] } }[] }} AtlasPanelSource */
/** @typedef {{ ids?: unknown[] }} AtlasIndexJoin */
/** @typedef {{ creatures?: Record<string, { name?: string, detail?: { drops?: ({ name?: string } | null)[] } }> }} AtlasDropReference */
/** @typedef {{ art?: Record<string, number[] | null | undefined>, sheet?: { wide?: number, tall?: number } }} AtlasItemArt */
/**
 * @typedef {Object} AtlasKnown
 * @property {Map<string, string>} ids
 * @property {Map<string, string[]>} drops
 * @property {Map<string, number[] | null | undefined>} pics
 * @property {Map<string, string>} named
 * @property {string} sheet
 * @property {number} wide
 * @property {number} tall
 */
/**
 * @typedef {Object} AtlasPanelDependencies
 * @property {() => AtlasKnown | null} getKnown Read the current join on every lookup.
 * @property {() => AtlasLootKinds | null | undefined} getKinds Read each lazy index's source when first needed.
 * @property {() => AtlasPanelSource | null | undefined} getAtlas Read the portal source when first needed.
 */
var AtlasData = (function () {
  'use strict';
  /** @param {unknown} name */
  const knownName = name => String(name || '').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ').trim().toLowerCase();

  /** @param {AtlasPanelDependencies} deps */
  function createPanelData(deps) {
    /** @type {Map<string, string[]> | null} */
    let groups = null;
    /** @type {Set<string> | null} */
    let mundane = null;
    /** @type {Map<string, string> | null} */
    let portalArt = null;
    const kinOf = {
      /** @param {unknown} name */
      group(name) {
        if (!groups) {
          groups = new Map();
          const KIN = deps.getKinds();
          for (const [kind, list] of Object.entries((KIN && KIN.groups) || {})) groups.set(knownName(kind), list);
        }
        return groups.get(knownName(name)) || null;
      },
      /** @param {unknown} name */
      mundane(name) {
        if (!mundane) {
          const KIN = deps.getKinds();
          mundane = new Set(((KIN && KIN.mundane) || []).map(knownName));
        }
        return mundane.has(knownName(name));
      }
    };

    /**
     * Build the join only after the adapter's three reads have settled.
     * Rectangles and group members retain their source references.
     * @param {AtlasIndexJoin | null | undefined} join
     * @param {AtlasDropReference | null | undefined} reference
     * @param {AtlasItemArt | null | undefined} art
     * @param {() => string} getSheet
     * @returns {AtlasKnown}
     */
    function projectKnown(join, reference, art, getSheet) {
      /** @type {Map<string, string>} */
      const ids = new Map();
      for (const id of (join && join.ids) || []) {
        // A variant (enemy:Name#phase) is not the thing a panel names.
        if (typeof id !== 'string' || id.includes('#')) continue;
        const split = id.indexOf(':');
        if (split > 0) ids.set(id.slice(0, split) + ':' + knownName(id.slice(split + 1)), id);
      }
      /** @type {Map<string, string[]>} */
      const drops = new Map();
      for (const one of Object.values((reference && reference.creatures) || {})) {
        const list = /** @type {string[]} */ (((one.detail || {}).drops || []).map(drop => drop && drop.name).filter(Boolean));
        if (one.name && list.length) drops.set(knownName(one.name), list);
      }
      /** @type {Map<string, number[] | null | undefined>} */
      const pics = new Map();
      /** @type {Map<string, string>} */
      const named = new Map();
      for (const [name, rect] of Object.entries((art && art.art) || {})) {
        pics.set(knownName(name), rect);
        named.set(knownName(name), name);
      }
      return {
        ids, drops, pics, named, sheet: getSheet(),
        wide: (art && art.sheet && art.sheet.wide) || 1024,
        tall: (art && art.sheet && art.sheet.tall) || 1280
      };
    }

    /** @param {unknown} name @param {string[]} kinds */
    function knownId(name, kinds) {
      const known = deps.getKnown();
      if (!known) return '';
      for (const kind of kinds) {
        const id = known.ids.get(kind + ':' + knownName(name));
        if (id) return id;
        if (kind === 'item' && known.named && known.named.has(knownName(name))) {
          return 'item:' + known.named.get(knownName(name));
        }
      }
      return '';
    }

    /** @param {unknown} name */
    function portalOf(name) {
      if (!portalArt) {
        portalArt = new Map();
        const A = deps.getAtlas();
        const zones = (A && A.zones) || [];
        for (const zone of zones) {
          for (const one of ((zone.loot || {}).dungeons || [])) {
            if (one && one.name && one.art) portalArt.set(knownName(one.name), one.art);
          }
        }
      }
      return portalArt.get(knownName(name)) || '';
    }

    /** @param {unknown} blueprint @param {string[]} beside */
    function blueprintFor(blueprint, beside) {
      const stem = knownName(String(blueprint).replace(/ Blueprint$/, ''));
      if (!stem || stem === knownName(blueprint)) return '';
      return beside.find(one => !/ Blueprint$/.test(one) && knownName(one).includes(stem)) || '';
    }
    return { knownName, kinOf, projectKnown, knownId, portalOf, blueprintFor };
  }
  return { createPanelData };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AtlasData;
