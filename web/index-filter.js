/* Ordered family selection. Catalogue ownership and record classifiers stay with the caller. */
/**
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
 * @template R
 * @typedef {Object} IndexFilterDependencies
 * @property {() => IndexFilterState} getState Live narrowing state.
 * @property {(id: string) => R} getRecord Resolve a valid family member without cloning it.
 * @property {() => readonly string[]} getSidePortals Live technical portal membership.
 * @property {() => Record<string, { test: (record: R) => boolean }>} getTags Live tag predicates.
 * @property {(record: R) => string} tierOf
 * @property {(record: R, hows: string[]) => readonly string[]} statusesOf
 * @property {(record: R) => string} setClass
 * @property {(record: R) => readonly string[]} scalesOf
 * @property {(record: R) => { id: string } | null | undefined} placeOf
 * @property {(record: R, cls: string, hand: string) => readonly unknown[]} gaveTo
 */
var IndexFilter = (function () {
  'use strict';
  /**
   * Create once per browse interface. Family membership already carries the
   * catalogue's visibility rules; do not add a second eligibility policy here.
   * @template R
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
    return { select };
  }
  return { createFilter };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IndexFilter;
