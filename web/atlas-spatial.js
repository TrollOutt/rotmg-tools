/* Ordered broad-phase queries. Exact targeting and collision tests stay in the viewer. */
/** @typedef {{ x: number, y: number }} AtlasSpatialPoint */
var AtlasSpatial = (function () {
  'use strict';

  /**
   * Each identity occurs once. Rebuild after changing source-array order;
   * update after moving an entity, including teleports between queries.
   * Queries return independent snapshots in source order, not cell order.
   * @template {AtlasSpatialPoint} T
   * @param {number} [cellSize]
   */
  function createGrid(cellSize = 16) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new RangeError('Invalid spatial cell size');
    /** @type {Map<string, T[]>} */
    const cells = new Map();
    /** @type {Map<T, string | null>} Active membership only. */
    const locations = new Map();
    /** @type {WeakMap<T, number>} Includes filtered source entries. */
    let order = new WeakMap();
    /** @type {Set<T>} */
    const unplaced = new Set();
    /** @type {(entity: T) => boolean} */
    let include = () => true;
    let nextOrder = 0;

    /** @param {T} entity */
    function detach(entity) {
      const key = locations.get(entity);
      if (key === undefined) return;
      if (key === null) unplaced.delete(entity);
      else {
        const held = cells.get(key);
        if (held) {
          const at = held.indexOf(entity);
          if (at >= 0) held.splice(at, 1);
          if (!held.length) cells.delete(key);
        }
      }
      locations.delete(entity);
    }

    /** @param {T} entity */
    function update(entity) {
      if (!order.has(entity)) order.set(entity, nextOrder++);
      // Friendly projectiles do not need keys, membership records or buckets.
      if (!include(entity)) { detach(entity); return; }
      const key = Number.isFinite(entity.x) && Number.isFinite(entity.y)
        ? Math.floor(entity.x / cellSize) + ',' + Math.floor(entity.y / cellSize) : null;
      if (locations.get(entity) === key) return;
      detach(entity);
      locations.set(entity, key);
      if (key === null) unplaced.add(entity);
      else {
        let held = cells.get(key);
        if (!held) { held = []; cells.set(key, held); }
        held.push(entity);
      }
    }

    /** @param {readonly T[]} source @param {(entity: T) => boolean} [filter] */
    function rebuild(source, filter = () => true) {
      cells.clear(); locations.clear(); unplaced.clear(); order = new WeakMap(); nextOrder = 0;
      include = filter;
      for (const entity of source) update(entity);
    }

    /** @param {T} entity */
    function remove(entity) { detach(entity); order.delete(entity); }

    /** @param {T[]} result */
    function ordered(result) {
      return result.sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
    }

    /**
     * Conservative cell bounds, deliberately not an exact geometric filter.
     * Non-finite points remain candidates: the original narrow phase decides.
     * Huge/non-finite queries fall back to source order rather than looping
     * over an unbounded grid or overflowing the cell iterator.
     * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
     */
    function queryBox(x0, y0, x1, y1) {
      if (x0 > x1 || y0 > y1) return [];
      const c0 = Math.floor(x0 / cellSize), c1 = Math.floor(x1 / cellSize);
      const r0 = Math.floor(y0 / cellSize), r1 = Math.floor(y1 / cellSize);
      if (!Number.isSafeInteger(c0) || !Number.isSafeInteger(c1)
        || !Number.isSafeInteger(r0) || !Number.isSafeInteger(r1)
        || (c1 - c0 + 1) * (r1 - r0 + 1) > 4096) {
        return ordered([...locations.keys()]);
      }
      const found = [...unplaced];
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const held = cells.get(c + ',' + r);
          if (held) for (const entity of held) found.push(entity);
        }
      }
      return ordered(found);
    }

    /**
     * Radius bounding box, suitable for both circular searches and square
     * projectile spans. The caller retains its original exact distance test.
     * @param {number} x @param {number} y @param {number} radius
     */
    function query(x, y, radius) {
      return queryBox(x - radius, y - radius, x + radius, y + radius);
    }
    return { rebuild, update, remove, query, queryBox };
  }
  return { createGrid };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AtlasSpatial;
