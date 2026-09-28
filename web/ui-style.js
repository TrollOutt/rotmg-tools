/*
 * The reader's own look for the site: what the boxes are laid on, how they
 * are framed, and in what colour.
 *
 * Kept in this browser, each choice independent of the others:
 *
 *   background   one of the grey backgrounds in assets/ui/backgrounds, or simple
 *   frame        ornate (a fine rail with a glow) or simple (the plain border)
 *   colour       one colour for everything: the frame, and a tint over the background
 *   tint         how strongly that colour lies over the background
 *   transparency how much of what is behind a box shows through it
 *
 * A background is one large grey picture. A box is not given a resized copy
 * of it: it shows the part of the picture it has room for, at the picture's
 * own size, cut from the middle - so a small box shows detail and a large one
 * more of the same picture, and nothing is blurred by scaling. Only a box
 * larger than the picture has it enlarged, just enough to cover.
 *
 * The pictures are grey on purpose. The colour is a layer laid over the
 * picture and blended with it, never baked in, so any colour can go over any
 * background - the simple one included.
 *
 * The picture and its colour are drawn on a layer of their own behind the
 * box's content (its ::before), which is what lets the box be see-through
 * without its writing fading with it. A box that scrolls keeps them as its
 * own background instead, opaque, since a layer inside it would scroll away.
 *
 * Simple, simple and the site's colour is exactly how the site looked before
 * any of this. The same few surfaces are dressed wherever they are drawn: the
 * page itself, the Skin Viewer's panels inside its shadow root, and the atlas
 * panel inside its frame - each gets this stylesheet, a class per choice and
 * its variables, because a shadow root or another document cannot see the
 * page's own root.
 *
 * Nothing is added inside a box but that one pseudo-element: the frame is
 * shadows, so no layout moves and a box that scrolls keeps its frame.
 */
(function () {
  'use strict';
  if (window.UIStyle) return;

  /* v2: the defaults changed, so everybody starts again from them. */
  const STORE = 'rotmg-ui-style-v2';
  const DEFAULTS = { bg: 'facets', frame: 'ornate', color: 'ember', custom: '#c98947', tint: 10, clear: 15 };

  /* Every background is one picture; its size is what a box is cut from. */
  const BACKGROUNDS = [
    { key: 'simple', say: 'Simple' },
    { key: 'stone', say: 'Stone', w: 1672, h: 941 },
    { key: 'slabs', say: 'Slabs', w: 1672, h: 941 },
    { key: 'facets', say: 'Facets', w: 1672, h: 941 },
    { key: 'circuit', say: 'Circuit', w: 1672, h: 941 },
    { key: 'contours', say: 'Contours', w: 1672, h: 941 },
    { key: 'dunes', say: 'Dunes', w: 1672, h: 941 },
    { key: 'smoke', say: 'Smoke', w: 1672, h: 941 },
    { key: 'linen', say: 'Linen', w: 1672, h: 941 },
    { key: 'foliage', say: 'Foliage', w: 1672, h: 941 }
  ];
  const backgroundOf = key => BACKGROUNDS.find(one => one.key === key) || BACKGROUNDS.find(one => one.key === DEFAULTS.bg);
  const pictureUrl = (key, thumb) => new URL('assets/ui/backgrounds/' + (thumb ? 'thumbs/' : '') + key + '.webp', document.baseURI).href;

  /* A colour is three channels each: the rail's light, its body, and the light it gives off. */
  const COLORS = [
    { key: 'current', say: 'Site colour', hi: '121 197 232', lo: '63 127 163', glow: '96 170 214' },
    { key: 'steel', say: 'Steel', hi: '196 201 210', lo: '98 104 114', glow: '160 166 178' },
    { key: 'ember', say: 'Ember', hi: '201 137 71', lo: '140 69 29', glow: '183 88 35' },
    { key: 'blood', say: 'Blood', hi: '214 92 92', lo: '124 31 40', glow: '176 44 54' },
    { key: 'venom', say: 'Venom', hi: '150 214 108', lo: '63 122 42', glow: '92 170 62' },
    { key: 'arcane', say: 'Arcane', hi: '182 142 255', lo: '91 58 158', glow: '140 92 230' },
    { key: 'frost', say: 'Frost', hi: '164 218 255', lo: '61 127 176', glow: '104 182 240' },
    { key: 'gold', say: 'Gold', hi: '231 195 90', lo: '138 106 30', glow: '214 164 58' }
  ];
  /* A colour of the reader's own: its light is the colour itself, its body the same darker. */
  function customColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, 'c98947'];
    const n = parseInt(m[1], 16), rgb = [n >> 16, (n >> 8) & 255, n & 255];
    const scale = k => rgb.map(v => Math.round(v * k)).join(' ');
    return { key: 'custom', say: 'Your colour', hi: rgb.join(' '), lo: scale(.55), glow: scale(.85) };
  }
  const colorOf = (key, custom) => key === 'custom' ? customColor(custom)
    : COLORS.find(one => one.key === key) || COLORS.find(one => one.key === DEFAULTS.color);

  /* A few whole looks to start from: each is only a setting of the choices below it. */
  const LOOKS = [
    { key: 'forge', say: 'Forge', set: { bg: 'stone', frame: 'ornate', color: 'ember' } },
    { key: 'crypt', say: 'Crypt', set: { bg: 'slabs', frame: 'ornate', color: 'arcane' } },
    { key: 'grove', say: 'Grove', set: { bg: 'foliage', frame: 'ornate', color: 'venom' } },
    { key: 'glacier', say: 'Glacier', set: { bg: 'contours', frame: 'ornate', color: 'frost' } },
    { key: 'machine', say: 'Machine', set: { bg: 'circuit', frame: 'ornate', color: 'current' } },
    { key: 'desert', say: 'Desert', set: { bg: 'dunes', frame: 'simple', color: 'gold' } },
    /* Plain keeps whatever colour is chosen: with the site's own it is the site as it always looked. */
    { key: 'plain', say: 'Plain', set: { bg: 'simple', frame: 'simple' } }
  ];

  /* The surfaces dressed, per kind of root: only the big ones, never the rows inside them. */
  const TARGETS = {
    page: 'section.card, #tcWelcome, .home-card, .ix-card, .ix-ways, .wn-part, .realm-details, #itemOptimizer, #atlasIndex',
    skins: 'section.panel.stage-panel, section.panel.catalogue, section.panel.dyes',
    /* The panel itself, not its scrolling body: its own dark background would otherwise stay under the picture. */
    atlas: '#panel'
  };

  /*
   * Never see-through: the two panels laid over the atlas. Everywhere else a
   * box stands on the black starry sky, so what shows through is harmless; over
   * the map it is a busy picture under the writing.
   */
  const SOLID = '#atlasIndex, #panel';

  let chosen = load();
  const hosts = new Set();
  const dressedRoots = new WeakSet();
  const sizes = new WeakMap();

  function load() {
    let said = null;
    try { said = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { /* private window or blocked storage */ }
    const out = { ...DEFAULTS, ...(said && typeof said === 'object' ? said : {}) };
    /* The first version had one background, called textured. */
    if (out.bg === 'textured') out.bg = DEFAULTS.bg;
    if (!BACKGROUNDS.some(one => one.key === out.bg)) out.bg = DEFAULTS.bg;
    out.tint = Math.max(0, Math.min(100, Number(out.tint) || 0));
    out.clear = Math.max(0, Math.min(60, Number(out.clear) || 0));
    return out;
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(chosen)); } catch (_) { /* not kept, still applied */ }
  }

  /* ---------------- the stylesheet, in every root that has surfaces ---------------- */
  function styleInto(root) {
    if (root === document || dressedRoots.has(root)) return;
    dressedRoots.add(root);
    const source = document.querySelector('[data-ui-style]');
    if (!source) return;
    const owner = root.nodeType === 9 ? root : root.ownerDocument;
    let copy;
    if (source.tagName === 'LINK') {
      copy = owner.createElement('link');
      copy.rel = 'stylesheet';
      copy.href = source.href;
    } else {
      copy = owner.createElement('style');
      copy.textContent = source.textContent;
    }
    copy.dataset.uiStyle = '';
    if (root.nodeType === 9) (root.head || root.documentElement).appendChild(copy);
    else root.prepend(copy);
  }

  /* ---------------- the variables a surface is drawn with ---------------- */
  function variables() {
    const color = colorOf(chosen.color, chosen.custom), picture = backgroundOf(chosen.bg);
    return {
      '--ui-hi': color.hi, '--ui-lo': color.lo, '--ui-glow': color.glow,
      '--ui-tint-a': String(chosen.tint / 100), '--ui-opacity': String(1 - chosen.clear / 100), '--ui-clear': chosen.clear + '%',
      '--ui-tex': picture.w ? 'url("' + pictureUrl(picture.key) + '")' : 'none'
    };
  }
  function setAll(element, values) {
    for (const [name, value] of Object.entries(values)) element.style.setProperty(name, value);
  }

  /* ---------------- one surface ---------------- */
  function paint(host, values) {
    host.classList.add('ui-host');
    const colored = chosen.color !== 'current';
    host.classList.toggle('ui-textured', chosen.bg !== 'simple');
    host.classList.toggle('ui-washed', chosen.bg === 'simple' && colored);
    host.classList.toggle('ui-ornate', chosen.frame === 'ornate');
    host.classList.toggle('ui-tinted', chosen.frame === 'simple' && colored);
    host.classList.toggle('ui-solid', host.matches(SOLID));
    setAll(host, values || variables());
    fit(host);
  }
  /*
   * The picture at its own size, enlarged only if the box is larger than it
   * is. Measured only while the box is drawn - which is also when its layer's
   * anchoring can be read: a box that is not positioned is made relative for
   * the layer to sit in it, and a box that scrolls keeps its background.
   */
  function fit(host) {
    const box = host.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) return;
    if (!host.classList.contains('ui-anchor') && !host.classList.contains('ui-placed')) {
      const style = (host.ownerDocument.defaultView || window).getComputedStyle(host);
      host.classList.add(style.position === 'static' ? 'ui-anchor' : 'ui-placed');
      host.classList.toggle('ui-scrolls', /auto|scroll/.test(style.overflowY + style.overflowX));
      host.style.setProperty('--ui-bw', style.borderTopWidth);
    }
    const picture = backgroundOf(chosen.bg);
    if (!picture.w) return;
    const k = Math.max(1, box.width / picture.w, box.height / picture.h);
    const size = Math.ceil(picture.w * k) + 'px ' + Math.ceil(picture.h * k) + 'px';
    if (host.dataset.uiSize === size) return;
    host.dataset.uiSize = size;
    host.style.setProperty('--ui-size', size);
  }
  function observerFor(win) {
    if (!sizes.has(win)) {
      sizes.set(win, new win.ResizeObserver(entries => { for (const entry of entries) fit(entry.target); }));
    }
    return sizes.get(win);
  }
  function mount(host) {
    if (hosts.has(host)) return;
    hosts.add(host);
    paint(host);
    try { observerFor(host.ownerDocument.defaultView || window).observe(host); } catch (_) { /* document going away */ }
  }
  function scan(root, kind) {
    let found;
    try { found = root.querySelectorAll(TARGETS[kind]); } catch (_) { return; }
    if (!found.length) return;
    styleInto(root);
    for (const host of found) mount(host);
  }

  /* ---------------- where the surfaces are ---------------- */
  const watchedRoots = new WeakSet();
  function watch(root, kind) {
    if (watchedRoots.has(root)) return;
    watchedRoots.add(root);
    let queued = false;
    new (root.ownerDocument || root).defaultView.MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scan(root, kind);
        /* A change on the page may be the Skin Viewer or the atlas arriving. */
        if (kind === 'page') contexts();
      });
    }).observe(root.nodeType === 9 ? root.body || root.documentElement : root, { childList: true, subtree: true });
    scan(root, kind);
  }
  /* The Skin Viewer draws into a shadow root it makes when first opened. */
  function skins() {
    const shadow = document.getElementById('skinViewerRoot')?.shadowRoot;
    if (shadow) watch(shadow, 'skins');
  }
  /* The atlas is a document of its own, inside a frame. */
  function atlas() {
    const frame = document.getElementById('realmFrame');
    if (!frame) return;
    if (!frame.dataset.uiStyleWired) {
      frame.dataset.uiStyleWired = '1';
      frame.addEventListener('load', atlas);
    }
    let doc = null;
    try { doc = frame.contentDocument; } catch (_) { return; }
    if (doc && doc.body && doc.getElementById('panelBody')) watch(doc, 'atlas');
  }
  function contexts() { skins(); atlas(); }

  /* ---------------- the ring on the front page ---------------- */
  /*
   * Its bands are drawings, so the background is a pattern their faces are
   * filled with: the picture at its own size in the drawing's units (which are
   * the stage's pixels), centred on the stage, with the colour blended over it
   * the same way as on a box.
   */
  const NS = 'http://www.w3.org/2000/svg';
  const ringParts = {};
  function ring() {
    const wheel = document.getElementById('ringWheel'), defs = wheel && wheel.querySelector('defs');
    if (!defs) return;
    if (!ringParts.pattern || !ringParts.pattern.isConnected) {
      const make = (name, attrs, into) => {
        const node = document.createElementNS(NS, name);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        if (into) into.appendChild(node);
        return node;
      };
      const pattern = make('pattern', { id: 'uiRingTexture', patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: 1, height: 1 }, defs);
      ringParts.pattern = pattern;
      ringParts.image = make('image', { preserveAspectRatio: 'none' }, pattern);
      ringParts.veil = make('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: 'rgb(0 0 0 / .22)' }, pattern);
      ringParts.tint = make('rect', { x: 0, y: 0, width: '100%', height: '100%' }, pattern);
      /* The stage's size changes the drawing's units: the pattern follows it. */
      new MutationObserver(ringFit).observe(wheel, { attributes: true, attributeFilter: ['viewBox'] });
    }
    ringFit();
  }
  function ringFit() {
    const { pattern, image, tint } = ringParts, wheel = document.getElementById('ringWheel');
    if (!pattern || !wheel) return;
    const view = wheel.viewBox && wheel.viewBox.baseVal;
    const W = view && view.width || 1600, H = view && view.height || 900;
    const picture = backgroundOf(chosen.bg);
    pattern.setAttribute('width', W);
    pattern.setAttribute('height', H);
    if (!picture.w) { image.removeAttribute('href'); return; }
    const k = Math.max(1, W / picture.w, H / picture.h), w = picture.w * k, h = picture.h * k;
    for (const [name, value] of Object.entries({ href: pictureUrl(picture.key), x: (W - w) / 2, y: (H - h) / 2, width: w, height: h })) {
      image.setAttribute(name, value);
    }
    const color = colorOf(chosen.color, chosen.custom);
    tint.setAttribute('fill', 'rgb(' + color.hi + ')');
    tint.setAttribute('fill-opacity', String(chosen.tint / 100));
    tint.style.mixBlendMode = 'color';
    /*
     * Once the picture has been made with its veil and colour already in it,
     * the pattern is that one picture and nothing else. The bands are painted
     * again on every frame a module is opening or closing, and a colour
     * blended in there was an extra layer composed for each of the six on
     * every one of those frames.
     */
    const ready = baked(picture, color);
    image.setAttribute('href', ready || pictureUrl(picture.key));
    for (const rect of [ringParts.veil, tint]) rect.style.display = ready ? 'none' : '';
  }
  /* The ring's picture with its veil and colour painted in, made once per choice (the same blending, done by a canvas). */
  let bake = { key: '', url: '' }, baking = 0;
  function baked(picture, color) {
    const key = picture.key + '|' + color.hi + '|' + chosen.tint;
    if (bake.key === key) return bake.url;
    clearTimeout(baking);
    baking = setTimeout(() => {
      const source = new Image();
      source.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = source.naturalWidth;
          canvas.height = source.naturalHeight;
          const pen = canvas.getContext('2d');
          pen.drawImage(source, 0, 0);
          pen.fillStyle = 'rgb(0 0 0 / .22)';
          pen.fillRect(0, 0, canvas.width, canvas.height);
          pen.globalCompositeOperation = 'color';
          pen.fillStyle = 'rgb(' + color.hi + ' / ' + (chosen.tint / 100) + ')';
          pen.fillRect(0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => {
            if (!blob) return;
            if (bake.url) URL.revokeObjectURL(bake.url);
            bake = { key, url: URL.createObjectURL(blob) };
            ringFit();
          }, 'image/png');
        } catch (_) { /* a picture the canvas may not read (a file opened from disk): the blended layers stay */ }
      };
      source.src = pictureUrl(picture.key);
    }, 150);
    return null;
  }

  /* ---------------- applying a choice ---------------- */
  function apply() {
    const root = document.documentElement, values = variables();
    root.dataset.uiBg = chosen.bg;
    root.dataset.uiFrame = chosen.frame;
    root.dataset.uiColor = chosen.color;
    setAll(root, values);
    for (const host of [...hosts]) {
      if (!host.isConnected) { hosts.delete(host); continue; }
      delete host.dataset.uiSize;
      paint(host, values);
    }
    ringFit();
    drawMenu();
  }
  function set(change) {
    chosen = { ...chosen, ...change };
    save();
    apply();
  }

  /* ---------------- the Style button and its panel ---------------- */
  const slider = (field, say, min, max, value, off) => '<label class="ui-style-row ui-style-slide' + (off ? ' is-off' : '') + '"><span class="ui-style-label">' + say + '</span>'
    + '<span class="ui-style-strength"><input type="range" min="' + min + '" max="' + max + '" step="5" value="' + value + '" data-ui-slide="' + field + '"'
    + ' style="--at:' + ((value - min) / (max - min) * 100) + '%"><output>' + value + '%</output></span></label>';
  const radio = (on, extra) => ' role="radio" aria-checked="' + on + '" class="' + extra + (on ? ' is-on' : '') + '"';
  function drawMenu() {
    const menu = document.getElementById('styleMenu');
    if (!menu) return;
    const lookOn = look => Object.entries(look.set).every(([k, v]) => chosen[k] === v);
    const color = colorOf(chosen.color, chosen.custom);
    menu.innerHTML = ''
      + '<div class="ui-style-row"><span class="ui-style-label">Looks</span>'
      + '<div class="ui-style-looks" role="radiogroup" aria-label="Looks">'
      + LOOKS.map(look => '<button type="button"' + radio(lookOn(look), 'ui-style-look') + ' data-ui-look="' + look.key + '">' + look.say + '</button>').join('')
      + '</div></div>'
      + '<div class="ui-style-row"><span class="ui-style-label">Background <em>' + backgroundOf(chosen.bg).say + '</em></span>'
      + '<div class="ui-style-backs" role="radiogroup" aria-label="Background">'
      + BACKGROUNDS.map(one => '<button type="button"' + radio(chosen.bg === one.key, 'ui-style-back' + (one.w ? '' : ' is-simple'))
        + ' data-ui-bg="' + one.key + '" title="' + one.say + '" aria-label="' + one.say + '"'
        + (one.w ? ' style="--thumb:url(&quot;' + pictureUrl(one.key, true) + '&quot;)"' : '') + '><span></span></button>').join('')
      + '</div></div>'
      + '<div class="ui-style-row"><span class="ui-style-label">Frame</span>'
      + '<div class="ui-style-pair" role="radiogroup" aria-label="Frame">'
      + [['ornate', 'Ornate'], ['simple', 'Simple']].map(([key, say]) => '<button type="button"' + radio(chosen.frame === key, 'ui-style-choice')
        + ' data-ui-frame="' + key + '"><span class="ui-style-sample is-frame-' + key + '" aria-hidden="true"></span>' + say + '</button>').join('')
      + '</div></div>'
      + '<div class="ui-style-row"><span class="ui-style-label">Colour <em>' + color.say + '</em></span>'
      + '<div class="ui-style-swatches" role="radiogroup" aria-label="Colour">'
      + COLORS.map(one => '<button type="button"' + radio(chosen.color === one.key, 'ui-style-swatch') + ' data-ui-color="' + one.key
        + '" title="' + one.say + '" aria-label="' + one.say + '" style="--sw-hi:' + one.hi + ';--sw-lo:' + one.lo + '"></button>').join('')
      + '<label' + radio(chosen.color === 'custom', 'ui-style-swatch is-custom') + ' title="Your colour" style="--sw-hi:'
      + customColor(chosen.custom).hi + ';--sw-lo:' + customColor(chosen.custom).lo + '">'
      + '<input type="color" value="' + chosen.custom + '" aria-label="Your colour" data-ui-custom></label>'
      + '</div></div>'
      /* Off where they change nothing: no colour on the site's own simple look, no see-through simple box. */
      + slider('tint', 'Colour on the background', 0, 100, chosen.tint, chosen.bg === 'simple' && chosen.color === 'current')
      + slider('clear', 'Transparency', 0, 60, chosen.clear, chosen.bg === 'simple')
      + '<button type="button" class="ui-style-reset" data-ui-reset>Back to the default look</button>';
  }
  function wireMenu() {
    const open = document.getElementById('styleOpen'), menu = document.getElementById('styleMenu');
    if (!open || !menu) return;
    const show = on => { menu.hidden = !on; open.setAttribute('aria-expanded', String(on)); };
    open.addEventListener('click', event => { event.stopPropagation(); show(menu.hidden); });
    menu.addEventListener('click', event => {
      event.stopPropagation();
      const pick = event.target.closest('button');
      if (!pick) return;
      const d = pick.dataset;
      if (d.uiLook) set(LOOKS.find(look => look.key === d.uiLook).set);
      else if (d.uiBg) set({ bg: d.uiBg });
      else if (d.uiFrame) set({ frame: d.uiFrame });
      else if (d.uiColor) set({ color: d.uiColor });
      else if ('uiReset' in d) set({ ...DEFAULTS });
    });
    /*
     * The slider and the colour picker are dragged: the look follows as they
     * move, and the panel is only redrawn when they are let go, so the control
     * being dragged is not replaced under the pointer.
     */
    let redraw = null;
    menu.addEventListener('input', event => {
      const t = event.target;
      if (t.matches('[data-ui-slide]')) {
        chosen[t.dataset.uiSlide] = Number(t.value);
        t.nextElementSibling.textContent = t.value + '%';
        t.style.setProperty('--at', ((t.value - t.min) / (t.max - t.min) * 100) + '%');
      } else if (t.matches('[data-ui-custom]')) {
        chosen.custom = t.value;
        chosen.color = 'custom';
        t.parentElement.style.setProperty('--sw-hi', customColor(t.value).hi);
      } else return;
      save();
      const values = variables();
      setAll(document.documentElement, values);
      for (const host of hosts) if (host.isConnected) setAll(host, values);
      ringFit();
      clearTimeout(redraw);
    });
    menu.addEventListener('change', event => {
      if (event.target.matches('[data-ui-slide], [data-ui-custom]')) redraw = setTimeout(apply, 0);
    });
    document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('#styleBox')) show(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { show(false); open.focus(); } });
  }

  /* ---------------- start ---------------- */
  apply();
  ring();
  wireMenu();
  watch(document, 'page');
  contexts();
  /*
   * The Skin Viewer, the atlas and the ring arrive late - the Skin Viewer's
   * shadow root is made when its page is first opened, which changes nothing
   * the page's own observer can see - so they are looked for a few times after
   * the page starts and after every move to another page.
   */
  /* And every box measured again: one that was hidden when it was found is drawn now. */
  const fitAll = () => { for (const host of hosts) if (host.isConnected) fit(host); };
  const lookAgain = () => { for (const wait of [0, 300, 1200, 3000]) setTimeout(() => { contexts(); ring(); fitAll(); }, wait); };
  window.addEventListener('hashchange', lookAgain);
  lookAgain();

  window.UIStyle = {
    get: () => ({ ...chosen }),
    set,
    reset: () => set({ ...DEFAULTS }),
    backgrounds: BACKGROUNDS.map(one => one.key),
    colors: COLORS.map(one => one.key)
  };
})();
