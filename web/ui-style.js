/*
 * The reader's own look for the site: what the boxes are laid on, how they
 * are framed, and in what colour.
 *
 * Three choices, each independent of the others, kept in this browser:
 *
 *   background   textured (the dark stone the site wears by default) or simple
 *   frame        ornate (a fine rail with a glow) or simple (the plain border)
 *   colour       the frame's colour: the site's own, or one of a few more
 *
 * Simple, simple and the site's colour is exactly how the site looked before
 * any of this. The same few surfaces are dressed wherever they are drawn: the
 * page itself, the Skin Viewer's panels inside its shadow root, and the atlas
 * panel inside its frame - each gets this stylesheet and a class per choice,
 * because a shadow root or another document cannot see the page's own root.
 *
 * Nothing is added inside a box: the frame is shadows and the background is
 * the box's own background, so no layout moves and a box that scrolls keeps
 * its frame where it is.
 */
(function () {
  'use strict';
  if (window.UIStyle) return;

  const STORE = 'rotmg-ui-style-v1';
  const DEFAULTS = { bg: 'textured', frame: 'ornate', color: 'ember' };

  /* A colour is three channels each for the rail's light and dark and for its glow. */
  const COLORS = [
    { key: 'current', say: 'Site colour', hi: '121 197 232', lo: '63 127 163', glow: '96 170 214' },
    { key: 'ember', say: 'Ember', hi: '201 137 71', lo: '140 69 29', glow: '183 88 35' },
    { key: 'blood', say: 'Blood', hi: '214 92 92', lo: '124 31 40', glow: '176 44 54' },
    { key: 'venom', say: 'Venom', hi: '150 214 108', lo: '63 122 42', glow: '92 170 62' },
    { key: 'arcane', say: 'Arcane', hi: '182 142 255', lo: '91 58 158', glow: '140 92 230' },
    { key: 'frost', say: 'Frost', hi: '164 218 255', lo: '61 127 176', glow: '104 182 240' },
    { key: 'gold', say: 'Gold', hi: '231 195 90', lo: '138 106 30', glow: '214 164 58' },
    { key: 'bone', say: 'Bone', hi: '221 213 196', lo: '125 118 106', glow: '196 188 170' }
  ];
  const colorOf = key => COLORS.find(one => one.key === key) || COLORS.find(one => one.key === DEFAULTS.color);

  /* The texture, cut for five shapes of box: each box wears the one closest to its own. */
  const TEXTURES = [
    [4, 'textured-ultrawide-4x1.avif'],
    [16 / 9, 'textured-landscape-16x9.avif'],
    [4 / 3, 'textured-landscape-4x3.avif'],
    [1, 'textured-square-1x1.avif'],
    [2 / 3, 'textured-portrait-2x3.avif']
  ];
  const textureUrl = file => new URL('assets/ui/textured/' + file, document.baseURI).href;
  const textureFor = ratio => {
    let best = TEXTURES[0], score = Infinity;
    for (const one of TEXTURES) {
      const off = Math.abs(Math.log(ratio / one[0]));
      if (off < score) { best = one; score = off; }
    }
    return best[1];
  };

  /* The surfaces dressed, per kind of root: only the big ones, never the rows inside them. */
  const TARGETS = {
    page: 'section.card, #tcWelcome, .home-card, .ix-card, .ix-ways, .wn-part, .realm-details, #itemOptimizer, #atlasIndex',
    skins: 'section.panel.stage-panel, section.panel.catalogue, section.panel.dyes',
    atlas: '#panelBody'
  };

  let chosen = load();
  const hosts = new Set();
  const dressedRoots = new WeakSet();
  const sizes = new WeakMap();

  function load() {
    try {
      const said = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (said && typeof said === 'object') return { ...DEFAULTS, ...said };
    } catch (_) { /* private window or blocked storage: the defaults */ }
    return { ...DEFAULTS };
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

  /* ---------------- one surface ---------------- */
  function paint(host) {
    const color = colorOf(chosen.color);
    host.classList.add('ui-host');
    host.classList.toggle('ui-textured', chosen.bg === 'textured');
    host.classList.toggle('ui-ornate', chosen.frame === 'ornate');
    host.classList.toggle('ui-tinted', chosen.frame === 'simple' && chosen.color !== 'current');
    host.style.setProperty('--ui-hi', color.hi);
    host.style.setProperty('--ui-lo', color.lo);
    host.style.setProperty('--ui-glow', color.glow);
    fit(host);
  }
  /* The texture closest to the box's shape; measured only while it is drawn. */
  function fit(host) {
    if (chosen.bg !== 'textured') return;
    const box = host.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) return;
    const file = textureFor(box.width / box.height);
    if (host.dataset.uiTexture === file) return;
    host.dataset.uiTexture = file;
    host.style.setProperty('--ui-tex', 'url("' + textureUrl(file) + '")');
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
  /* Its bands are drawings, so the texture is a pattern each band's face is filled with. */
  function ring() {
    const defs = document.querySelector('#ringWheel defs');
    if (!defs || defs.querySelector('#uiRingTexture')) return;
    const NS = 'http://www.w3.org/2000/svg';
    const pattern = document.createElementNS(NS, 'pattern');
    pattern.id = 'uiRingTexture';
    for (const [k, v] of Object.entries({ patternUnits: 'objectBoundingBox', patternContentUnits: 'objectBoundingBox', x: 0, y: 0, width: 1, height: 1 })) {
      pattern.setAttribute(k, v);
    }
    const image = document.createElementNS(NS, 'image');
    for (const [k, v] of Object.entries({ href: textureUrl(TEXTURES[0][1]), x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: 'xMidYMid slice' })) {
      image.setAttribute(k, v);
    }
    const shade = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: 1, height: 1, fill: 'rgb(8 7 13 / .10)' })) shade.setAttribute(k, v);
    pattern.append(image, shade);
    defs.appendChild(pattern);
  }

  /* ---------------- applying a choice ---------------- */
  function apply() {
    const root = document.documentElement, color = colorOf(chosen.color);
    root.dataset.uiBg = chosen.bg;
    root.dataset.uiFrame = chosen.frame;
    root.dataset.uiColor = color.key;
    root.style.setProperty('--ui-hi', color.hi);
    root.style.setProperty('--ui-lo', color.lo);
    root.style.setProperty('--ui-glow', color.glow);
    for (const host of [...hosts]) {
      if (!host.isConnected) { hosts.delete(host); continue; }
      paint(host);
    }
    drawMenu();
  }
  function set(change) {
    chosen = { ...chosen, ...change };
    save();
    apply();
  }

  /* ---------------- the Style button and its panel ---------------- */
  const OPTIONS = {
    bg: [['textured', 'Textured'], ['simple', 'Simple']],
    frame: [['ornate', 'Ornate'], ['simple', 'Simple']]
  };
  function drawMenu() {
    const menu = document.getElementById('styleMenu');
    if (!menu) return;
    const pair = (field, title) => '<div class="ui-style-row"><span class="ui-style-label">' + title + '</span>'
      + '<div class="ui-style-pair" role="radiogroup" aria-label="' + title + '">'
      + OPTIONS[field].map(([key, say]) => '<button type="button" role="radio" class="ui-style-choice'
        + (chosen[field] === key ? ' is-on' : '') + '" aria-checked="' + (chosen[field] === key) + '" data-ui-' + field + '="' + key + '">'
        + '<span class="ui-style-sample is-' + field + '-' + key + '" aria-hidden="true"></span>' + say + '</button>').join('')
      + '</div></div>';
    menu.innerHTML = pair('bg', 'Box background') + pair('frame', 'Frame')
      + '<div class="ui-style-row"><span class="ui-style-label">Frame colour</span>'
      + '<div class="ui-style-swatches" role="radiogroup" aria-label="Frame colour">'
      + COLORS.map(one => '<button type="button" role="radio" class="ui-style-swatch' + (chosen.color === one.key ? ' is-on' : '')
        + '" aria-checked="' + (chosen.color === one.key) + '" data-ui-color="' + one.key + '" title="' + one.say + '" aria-label="' + one.say + '"'
        + ' style="--sw-hi:' + one.hi + ';--sw-lo:' + one.lo + '"></button>').join('')
      + '</div><span class="ui-style-said">' + colorOf(chosen.color).say + '</span></div>'
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
      if (pick.dataset.uiBg) set({ bg: pick.dataset.uiBg });
      else if (pick.dataset.uiFrame) set({ frame: pick.dataset.uiFrame });
      else if (pick.dataset.uiColor) set({ color: pick.dataset.uiColor });
      else if ('uiReset' in pick.dataset) set({ ...DEFAULTS });
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
  window.addEventListener('hashchange', () => requestAnimationFrame(contexts));
  /* The Skin Viewer and the atlas arrive late; a few looks after they may have. */
  for (const wait of [300, 1200, 3000]) setTimeout(contexts, wait);

  window.UIStyle = {
    get: () => ({ ...chosen }),
    set,
    reset: () => set({ ...DEFAULTS }),
    colors: COLORS.map(one => one.key)
  };
})();
