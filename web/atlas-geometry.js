/* Atlas camera projections. CSS pixel geometry only; rendering stays in the viewer. */
/** @typedef {{ x: number, y: number }} AtlasPoint */
/** @typedef {{ w: number, h: number }} AtlasBox */
/** @typedef {{ x: number, y: number, scale: number }} AtlasView */
/** @typedef {{ cos: number, sin: number }} AtlasSpin */
/** @typedef {AtlasSpin & { h: number }} AtlasLean */
/**
 * @typedef {Object} AtlasProjectionDependencies
 * @property {AtlasView} view Live camera object; never snapshot its fields.
 * @property {() => number} globe Read the current zoom-dependent radius.
 * @property {() => AtlasSpin | null} spin
 * @property {() => boolean} tilting
 * @property {(box: AtlasBox) => AtlasLean} lean
 * @property {() => boolean} turning
 * @property {number} bulge
 * @property {number} flatEnough
 */
var AtlasGeometry = (function () {
  'use strict';
  /** @param {AtlasProjectionDependencies} deps */
  function createProjection(deps) {
    const { view, globe, spin, tilting, lean, turning, bulge: BULGE, flatEnough: FLAT_ENOUGH } = deps;
    /** @param {AtlasBox} box */
    function roundWorld(box) {
      const R = globe();
      const reach = Math.hypot(box.w, box.h) / 2;
      return (reach * reach * reach) / (6 * R * R) > FLAT_ENOUGH;
    }

    /** @param {number} u @param {number} v */
    function onGlobe(u, v) {
      const R = globe(), W = R / BULGE;
      const lat = v / W, lon = u / W;
      if (lat <= -Math.PI / 2 || lat >= Math.PI / 2) return null;
      if (lon <= -Math.PI / 2 || lon >= Math.PI / 2) return null;
      const cosLat = Math.cos(lat);
      return {
        x: W * cosLat * Math.sin(lon),
        y: W * Math.sin(lat),
        // How much the surface is turned away here, which is how much smaller
        // anything standing on it should be drawn.
        k: cosLat * Math.cos(lon)
      };
    }

    /** @param {number} x @param {number} y */
    function offGlobe(x, y) {
      const W = globe() / BULGE;
      const sinLat = y / W;
      if (sinLat <= -1 || sinLat >= 1) return null;
      const lat = Math.asin(sinLat), cosLat = Math.cos(lat);
      if (cosLat < 1e-6) return null;
      const sinLon = x / (W * cosLat);
      if (sinLon < -1 || sinLon > 1) return null;
      return { u: W * Math.asin(sinLon), v: W * lat };
    }

    /** @param {number} tx @param {number} ty @param {AtlasBox} box */
    function place(tx, ty, box) {
      let u = (tx - view.x) * view.scale, v = (ty - view.y) * view.scale;
      const S = spin();
      if (S) { const nu = u * S.cos - v * S.sin; v = u * S.sin + v * S.cos; u = nu; }
      if (!tilting()) {
        if (!roundWorld(box)) return { x: box.w / 2 + u, y: box.h / 2 + v, k: 1 };
        const on = onGlobe(u, v);
        if (!on) return null;                          // round the far side
        return { x: box.w / 2 + on.x, y: box.h / 2 + on.y, k: on.k };
      }
      const L = lean(box);
      const z = L.h - v * L.sin;
      if (z < 1) return null;                            // behind the camera
      const k = L.h / z;
      return { x: box.w / 2 + u * k, y: box.h / 2 + v * L.cos * k, k };
    }

    /** @param {number} px @param {number} py @param {AtlasBox} box */
    function fromScreen(px, py, box) {
      let u = px - box.w / 2, v = py - box.h / 2;
      if (!tilting() && roundWorld(box)) {
        const off = offGlobe(u, v);
        if (!off) return { x: NaN, y: NaN };           // off the world
        u = off.u; v = off.v;
      }
      if (tilting()) {
        const L = lean(box);
        const under = L.cos * L.h + v * L.sin;
        v = Math.abs(under) < 1e-6 ? v : (v * L.h) / under;
        u = u * (L.h - v * L.sin) / L.h;
      }
      const S = spin();
      if (S) { const nu = u * S.cos + v * S.sin; v = -u * S.sin + v * S.cos; u = nu; }
      return { x: u / view.scale + view.x, y: v / view.scale + view.y };
    }

    /** @param {AtlasBox} box @param {number} [pad] */
    function seenRange(box, pad) {
      const room = pad || 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      /** @param {AtlasPoint | null} one */
      const take = one => {
        if (!one || !Number.isFinite(one.x) || !Number.isFinite(one.y)) return;
        if (one.x < x0) x0 = one.x; if (one.x > x1) x1 = one.x;
        if (one.y < y0) y0 = one.y; if (one.y > y1) y1 = one.y;
      };
      const STEPS = 6;
      for (let i = 0; i <= STEPS; i++) {
        for (let j = 0; j <= STEPS; j++) {
          take(toTile(-room + (box.w + room * 2) * i / STEPS,
            -room + (box.h + room * 2) * j / STEPS, box));
        }
      }
      // The flat reading, widened for a turn, as a floor under all that.
      const flat0 = flatTile(-room, -room, box);
      const flat1 = flatTile(box.w + room, box.h + room, box);
      const over = turning() ? Math.max(flat1.x - flat0.x, flat1.y - flat0.y) * 0.5 : 0;
      take({ x: flat0.x - over, y: flat0.y - over });
      take({ x: flat1.x + over, y: flat1.y + over });
      return { x0, y0, x1, y1 };
    }

    /** @param {number} px @param {number} py @param {AtlasBox} box */
    const flatTile = (px, py, box) => ({
      x: (px - box.w / 2) / view.scale + view.x,
      y: (py - box.h / 2) / view.scale + view.y
    });
    /** @param {number} px @param {number} py @param {AtlasBox} box */
    const toTile = (px, py, box) => fromScreen(px, py, box);
    return { roundWorld, onGlobe, offGlobe, place, fromScreen, seenRange, flatTile, toTile };
  }
  return { createProjection };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AtlasGeometry;
