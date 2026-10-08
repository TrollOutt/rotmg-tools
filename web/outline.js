'use strict';
/*
 * The black line round a character or a creature, one rule for every page.
 *
 * The client draws it as it draws the character, so none of the sprite sheets
 * carry it; it has to be laid on wherever a picture of someone is put down.
 * The original viewer draws it four pixels wide on a sprite pixel thirty wide:
 * two fifteenths of a sprite pixel. A line that thin would be less than a
 * screen pixel on a small picture, and a line that vanishes is no line, so it
 * is never less than one screen pixel.
 *
 * Nothing here is baked into a picture. A line baked in has one thickness for
 * every zoom, and a sheet carries it for ever; a line laid on at the moment of
 * drawing follows the zoom and reaches the next client update's characters
 * with no step to remember.
 *
 * Three ways of laying it, for the three ways a picture reaches the screen:
 *   spritePixels(scale)   the width in sprite pixels (the Skin Viewer's shader reads this number)
 *   draw(ctx, ...)        onto a 2D canvas: the sprite's silhouette, four times, under the sprite
 *   filter(scale)         onto an element: an SVG filter, for pictures set as a CSS background
 *
 * `scale` is always screen pixels to one sprite pixel.
 *
 * web/skins/renderer.js (a module that tests import alone) and the Atlas page
 * (tools/atlas-viewer.html, a page of its own) carry the same two numbers;
 * tests/outline.test.js fails if any of the three drifts.
 */
(function (root) {
  const RATIO = 2 / 15;
  const spritePixels = scale => Math.max(RATIO, 1 / Math.max(scale || 1, 1e-6));
  // Whole screen pixels, for the places that cannot draw a fraction of one without blurring it.
  const screenPixels = scale => Math.max(1, Math.round(RATIO * Math.max(scale || 1, 1e-6)));

  /* ---- a 2D canvas ---- */
  // The silhouette of one rectangle of a picture, in black, made once.
  const silhouettes = new WeakMap();
  function silhouette(img, sx, sy, sw, sh) {
    const key = sx + ',' + sy + ',' + sw + ',' + sh;
    let per = silhouettes.get(img);
    if (!per) silhouettes.set(img, per = new Map());
    let one = per.get(key);
    if (!one) {
      one = root.document.createElement('canvas');
      one.width = Math.max(1, sw); one.height = Math.max(1, sh);
      const g = one.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#000';
      g.fillRect(0, 0, one.width, one.height);
      per.set(key, one);
    }
    return one;
  }
  /*
   * drawImage's nine arguments, with the line laid under the sprite. `scale`
   * is what the picture is drawn at; left out, it is the width ratio of the
   * two rectangles, which is right wherever a sheet pixel is a sprite pixel.
   */
  function draw(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, scale) {
    const t = screenPixels(scale || dw / Math.max(sw, 1));
    const ink = silhouette(img, sx, sy, sw, sh);
    ctx.drawImage(ink, dx - t, dy, dw, dh);
    ctx.drawImage(ink, dx + t, dy, dw, dh);
    ctx.drawImage(ink, dx, dy - t, dw, dh);
    ctx.drawImage(ink, dx, dy + t, dw, dh);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /* ---- an element ---- */
  const WIDTHS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  let made = false;
  function filters() {
    if (made || !root.document) return;
    const doc = root.document, host = doc.body || doc.documentElement;
    if (!host) return;
    made = true;
    const one = n => '<filter id="rt-ink-' + n + '" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">'
      + [[n, 0], [-n, 0], [0, n], [0, -n]].map(([dx, dy], i) => '<feOffset in="SourceAlpha" dx="' + dx + '" dy="' + dy + '" result="o' + i + '"/>').join('')
      + '<feMerge result="m"><feMergeNode in="o0"/><feMergeNode in="o1"/><feMergeNode in="o2"/><feMergeNode in="o3"/></feMerge>'
      + '<feFlood flood-color="#000" result="k"/><feComposite in="k" in2="m" operator="in" result="ink"/>'
      + '<feMerge><feMergeNode in="ink"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = '<defs>' + WIDTHS.map(one).join('') + '</defs>';
    host.appendChild(svg);
  }
  // A CSS filter value for a picture drawn at `scale` screen pixels to a sprite pixel.
  function filter(scale) {
    filters();
    const n = screenPixels(scale);
    const at = WIDTHS.find(w => w >= n) || WIDTHS[WIDTHS.length - 1];
    return 'url(#rt-ink-' + at + ')';
  }

  const api = { RATIO, spritePixels, screenPixels, silhouette, draw, filter, filters, WIDTHS };
  root.RealmOutline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', filters);
  else filters();
})(typeof window !== 'undefined' ? window : globalThis);
