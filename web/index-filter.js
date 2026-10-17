/* Family selection and facet preparation. Catalogue ownership and classifiers stay with the caller. */
/**
 * @typedef {{ id: string, name: string }} IndexFilterRecord
 * @typedef {Object} IndexFilterGroup
 * @property {readonly string[]} ids
 * @typedef {IndexFilterGroup & { id: string }} IndexFilterDomain
 * @typedef {Object} IndexFilterState
 * @property {boolean} [tech]
 * @property {string} tier
 * @property {string} inf
 * @property {string} gra
 * @property {string} cls
 * @property {string} scl
 * @property {string} home
 * @property {string} dcls
 * @property {string} dh
 * @property {ReadonlySet<string>} tags
 */
/**
 * @template {IndexFilterRecord} R
 * @typedef {Object} IndexFilterTag
 * @property {string} say
 * @property {readonly string[]} fams
 * @property {(record: R) => boolean} test
 */
/**
 * @template {IndexFilterRecord} R
 * @typedef {Object} IndexFilterDependencies
 * @property {() => IndexFilterState} getState Live narrowing state.
 * @property {(id: string) => R} getRecord Resolve a valid family member without cloning it.
 * @property {() => readonly string[]} getSidePortals Live technical portal membership.
 * @property {() => Record<string, IndexFilterTag<R>>} getTags Live tag definitions, returned by reference.
 * @property {() => readonly R[]} getClasses Live class-family records, in family order.
 * @property {() => readonly string[]} getHands Live equipment menu keys, in display order.
 * @property {(record: R) => string} tierOf
 * @property {(record: R, hows: string[]) => readonly string[]} statusesOf
 * @property {(record: R) => string} setClass
 * @property {(record: R) => readonly string[]} scalesOf
 * @property {(record: R) => R | null | undefined} placeOf
 * @property {(place: R) => number} rankOfPlace
 * @property {(record: R, cls: string, hand: string) => readonly unknown[]} gaveTo
 */
var IndexFilter = (function () {
  'use strict';
  /** @param {readonly string[]} list */
  const count = list => {
    /** @type {Map<string, number>} */
    const m = new Map();
    for (const x of list) m.set(x, (m.get(x) || 0) + 1);
    return m;
  };
  /**
   * Create once per browse interface. Family membership already carries the
   * catalogue's visibility rules; do not add a second eligibility policy here.
   * @template {IndexFilterRecord} R
   * @param {IndexFilterDependencies<R>} deps
   */
  function createFilter(deps) {
    /** @param {IndexFilterDomain} d @param {IndexFilterGroup | null | undefined} g */
    function select(d, g) {
      const S = deps.getState();
      let ids = g ? g.ids : d.ids;
      // The other portals belong to no section: they are offered on the whole family only.
      if (S.tech && !g && d.id === 'dungeons') ids = ids.concat(deps.getSidePortals());
      let rows = ids.map(id => deps.getRecord(id));
      const all = rows;
      if (S.tier) rows = rows.filter(r => deps.tierOf(r) === S.tier);
      if (S.inf) rows = rows.filter(r => deps.statusesOf(r, ['inflicts', 'inflicts on players']).includes(S.inf));
      if (S.gra) rows = rows.filter(r => deps.statusesOf(r, ['grants']).includes(S.gra));
      if (S.cls) rows = rows.filter(r => deps.setClass(r) === S.cls);
      if (S.scl) rows = rows.filter(r => deps.scalesOf(r).includes(S.scl));
      if (S.home) rows = rows.filter(r => { const p = deps.placeOf(r); return p && p.id === S.home; });
      if (d.id === 'dungeons' && (S.dcls || S.dh)) rows = rows.filter(r => deps.gaveTo(r, S.dcls, S.dh).length);
      for (const t of S.tags) {
        const tag = deps.getTags()[t];
        if (tag) rows = rows.filter(tag.test);
      }
      return { all, rows };
    }
    /**
     * Prepare options from the unfiltered family/section selection, not rows.
     * Preserve repeated status occurrences and insertion order. Only dungeon
     * counts use the other class/hand selection; selected tags remain offered.
     * No cache: archive overlays and classifier replacements stay observable.
     * @param {{ id: string }} d
     * @param {readonly R[]} all
     */
    function options(d, all) {
      const S = deps.getState();
      const inflicted = count(all.flatMap(r => deps.statusesOf(r, ['inflicts', 'inflicts on players'])));
      const granted = count(all.flatMap(r => deps.statusesOf(r, ['grants'])));
      const tiers = count(all.map(r => deps.tierOf(r)).filter(Boolean));
      const classes = d.id === 'sets' ? count(all.map(r => deps.setClass(r)).filter(Boolean)) : count([]);
      const scaled = d.id === 'gear' ? count(all.flatMap(r => deps.scalesOf(r))) : count([]);
      const homes = d.id === 'enemies' ? count(all.map(r => deps.placeOf(r)).filter(Boolean).map(p => /** @type {R} */ (p).id)) : count([]);
      const homesOrdered = [...homes].sort((a, b) => deps.rankOfPlace(deps.getRecord(a[0])) - deps.rankOfPlace(deps.getRecord(b[0])) || deps.getRecord(a[0]).name.localeCompare(deps.getRecord(b[0]).name));
      const tags = Object.entries(deps.getTags()).filter(([k, t]) => t.fams.includes(d.id) && (S.tags.has(k) || all.some(t.test)));
      /** @type {[string, number][]} */
      let dungeonClasses = [];
      /** @type {[string, number][]} */
      let handsLeft = [];
      if (d.id === 'dungeons') {
        const ofClass = deps.getClasses();
        dungeonClasses = ofClass.map(/** @returns {[string, number]} */ c => [c.id, all.filter(r => deps.gaveTo(r, c.id, S.dh).length).length]).filter(([, n]) => n);
        handsLeft = deps.getHands().map(/** @returns {[string, number]} */ h => [h, all.filter(r => deps.gaveTo(r, S.dcls, h).length).length]).filter(([, n]) => n);
      }
      return { inflicted, granted, tiers, classes, scaled, homes, homesOrdered, tags, dungeonClasses, handsLeft };
    }
    return { select, options };
  }
  return { createFilter };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IndexFilter;
