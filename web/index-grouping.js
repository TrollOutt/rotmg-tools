/* Ordered Index groups. Classification and catalogue ownership stay with the caller. */
/**
 * @typedef {Object} IndexGroupingRecord
 * @property {string} id
 * @property {string} [name]
 * @property {string} [said]
 * @property {false} [bundle]
 * @typedef {Object} IndexGroupingSection
 * @property {string} id
 * @property {string} title
 * @property {readonly string[]} ids
 */
/**
 * @template {IndexGroupingRecord} R
 * @typedef {Object} IndexGroupingDomain
 * @property {string} id
 * @property {readonly IndexGroupingSection[]} groups
 * @property {IndexGroupingSection & { kinds: readonly IndexGroupingSection[] }} [abilities]
 * @property {(record: R) => number} [sortBy]
 */
/**
 * @template {IndexGroupingRecord} R
 * @typedef {{ bundle: true, name: string, members: [string, R][] }} IndexGroupingBundle
 */
/**
 * @template {IndexGroupingRecord} R
 * @typedef {{ title: string, g?: IndexGroupingSection, rows: (R | IndexGroupingBundle<R>)[] }} IndexGroupingPart
 */
/**
 * @template {IndexGroupingRecord} R
 * @typedef {Object} IndexGroupingDependencies
 * @property {(id: string) => R} getRecord Resolve section members at each call.
 * @property {(record: R) => boolean} isSidePortal Live technical portal classification.
 * @property {(by: string) => { key: (record: R) => string, order?: (title: string) => number, last?: string }} getGroup Live grouping rules.
 */
var IndexGrouping = (function () {
  'use strict';
  /**
   * Create once per browse interface. Inputs and dependency callbacks stay live;
   * neither records nor section objects are copied or cached.
   * @template {IndexGroupingRecord} R
   * @param {IndexGroupingDependencies<R>} deps
   */
  function createGrouping(deps) {
    // Numeral variants share one row; singleton bundles keep their record identity.
    const ROMAN = /^(.*\S)\s+(I|II|III|IV|V|VI)$/;
    /** @param {R[]} rows @returns {(R | IndexGroupingBundle<R>)[]} */
    function bundleRows(rows) {
      /** @type {(R | IndexGroupingBundle<R>)[]} */
      const out = [];
      /** @type {Map<string, IndexGroupingBundle<R>>} */
      const byBase = new Map();
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
    /**
     * @param {readonly R[]} rows
     * @param {{ d: IndexGroupingDomain<R>, g?: IndexGroupingSection | null }} ctx
     * @param {string} by
     * @returns {IndexGroupingPart<R>[]}
     */
    function grouped(rows, ctx, by) {
      const d = ctx.d;
      /** @param {R} a @param {R} b */
      const sorter = (a, b) => (d.sortBy ? d.sortBy(a) - d.sortBy(b) : 0) || String(a.name).replace(/^The /, '').localeCompare(String(b.name).replace(/^The /, ''));
      /** @param {R[]} list */
      const pack = list => d.id === 'enchants' ? bundleRows(list) : list;
      if (by === 'section') {
        const keep = new Set(rows.map(r => r.id));
        const abilities = d.abilities;
        const sections = ctx.g ? [ctx.g] : abilities
          ? d.groups.flatMap(x => x === abilities.kinds[0] ? [abilities] : abilities.kinds.includes(x) ? [] : [x]) : d.groups;
        /** @type {IndexGroupingPart<R>[]} */
        const parts = sections.map(p => ({ title: p.title, g: p, rows: pack(p.ids.filter(id => keep.has(id)).map(id => deps.getRecord(id)).sort(sorter)) }));
        const side = rows.filter(r => deps.isSidePortal(r));
        if (side.length && d.id === 'dungeons') parts.push({ title: 'Other portals', rows: side.sort(sorter) });
        return parts.filter(p => p.rows.length);
      }
      const G = deps.getGroup(by);
      /** @type {Map<string, R[]>} */
      const buckets = new Map();
      for (const r of rows) { const k = G.key(r); (/** @type {R[]} */ (buckets.get(k) || buckets.set(k, []).get(k))).push(r); }
      // The catch-all bucket goes last, whatever its size. Number keeps boolean subtraction strict.
      return [...buckets].map(([title, list]) => ({ title, rows: pack(list.sort(sorter)) }))
        .sort((a, b) => (Number(a.title === G.last) - Number(b.title === G.last)) || (G.order ? G.order(a.title) - G.order(b.title) : b.rows.length - a.rows.length) || a.title.localeCompare(b.title));
    }
    return { grouped };
  }
  return { createGrouping };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IndexGrouping;
