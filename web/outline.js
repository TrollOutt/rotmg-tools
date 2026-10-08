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
  /*
   * Not laid on again every frame. A sprite, drawn at a size, is given its line
   * once - the sprite and its four shifted shadows composed on a card - and
   * the card is what every later frame draws: one drawImage, as if there were
   * no line. The card is made at a whole number of pixels to a pixel of art
   * (the zoom rounded), so what is cached is a handful of sizes per sprite, not
   * one per fractional zoom, and it is drawn at the exact size asked.
   */
  let cards = new WeakMap();
  let held = 0;                // pixels of cards kept
  const LIMIT = 12e6;          // pixels of cards kept (about fifty megabytes) before the lot are let go and made again as they are asked for
  const BIGGEST = 4e5;         // a card of more pixels than this is drawn live instead of kept
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
  function card(img, sx, sy, sw, sh, k, t) {
    const key = sx + ',' + sy + ',' + sw + ',' + sh + ',' + k + ',' + t;
    let per = cards.get(img);
    let one = per && per.get(key);
    if (one) return one;
    // Too many kept: let them all go; the ones still on screen are made again on the next frame.
    if (held >= LIMIT) { cards = new WeakMap(); held = 0; per = null; }
    if (!per) cards.set(img, per = new Map());
    const w = sw * k + t * 2, h = sh * k + t * 2;
    one = root.document.createElement('canvas');
    one.width = w; one.height = h;
    const g = one.getContext('2d');
    g.imageSmoothingEnabled = false;
    const ink = silhouette(img, sx, sy, sw, sh);
    g.drawImage(ink, 0, t, sw * k, sh * k); g.drawImage(ink, t * 2, t, sw * k, sh * k);
    g.drawImage(ink, t, 0, sw * k, sh * k); g.drawImage(ink, t, t * 2, sw * k, sh * k);
    g.drawImage(img, sx, sy, sw, sh, t, t, sw * k, sh * k);
    per.set(key, one);
    held += w * h;
    return one;
  }
  /*
   * drawImage's nine arguments, with the line round the picture. `artPixel` is
   * how many pixels of the picture are one pixel of the art it was cut from -
   * one for the client's own sheets, two for the atlas's doubled ones, the
   * enlargement for a picture the wiki enlarged - so the line is two fifteenths
   * of the art's pixel whatever the picture is made of.
   */
  function draw(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, artPixel) {
    const per = dw / Math.max(sw, 1);                    // screen pixels to a pixel of the picture
    const a = artPixel || 1;
    // Smaller than a screen pixel to a pixel of art, a line would be all there is of the picture: left off.
    if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0) || per * a < 1) { ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); return; }
    const k = Math.max(1, Math.round(per));              // the card's pixels to a pixel of the picture
    // The line, in the card's pixels: two fifteenths of a pixel of art, and a screen pixel at the least.
    const t = Math.max(1, Math.round(Math.max(RATIO * a * k, k / per)));
    if ((sw * k + t * 2) * (sh * k + t * 2) > BIGGEST) {
      const live = Math.max(1, Math.round(Math.max(RATIO * a * per, 1))), ink = silhouette(img, sx, sy, sw, sh);
      ctx.drawImage(ink, dx - live, dy, dw, dh); ctx.drawImage(ink, dx + live, dy, dw, dh);
      ctx.drawImage(ink, dx, dy - live, dw, dh); ctx.drawImage(ink, dx, dy + live, dw, dh);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    const one = card(img, sx, sy, sw, sh, k, t);
    // The card is k pixels to a pixel of the picture; it is drawn at the size asked, the line with it.
    const fx = dw / (sw * k), fy = dh / (sh * k);
    ctx.drawImage(one, 0, 0, one.width, one.height, dx - t * fx, dy - t * fy, one.width * fx, one.height * fy);
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
