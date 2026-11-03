'use strict';
/* The home serpent follows live contours, reacts to touch, and seeks cover. */
(() => {
  const canvas = document.getElementById('homeSnake');
  const foreground = document.getElementById('homeSnakeFront');
  if (!canvas || !foreground) return;
  const pens = [canvas.getContext('2d'), foreground.getContext('2d')];
  if (pens.some(pen => !pen)) return;
  const sprite = new Image();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const core = document.getElementById('ringCore');
  const covers = [...document.querySelectorAll('.home-mark, .home-notes, .corner')];
  const TAU = Math.PI * 2, PARTS = 24, STEP = 6, CONTOUR = 96;
  const NOTICE = .42, FLEE = .94;
  const CONTROLS = 'button, a, input, select, textarea, [role="dialog"], .corner';
  const random = (lo, hi) => lo + Math.random() * (hi - lo);
  const mix = (a, b, t) => a + (b - a) * t;
  const taper = part => part > PARTS - 5 ? mix(1, .65, (part - PARTS + 5) / 5) : 1;
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const unit = v => { const n = Math.hypot(v.x, v.y) || 1; return { x: v.x / n, y: v.y / n }; };
  const inside = (p, b, inset = 0) => p.x > b.x + inset && p.x < b.x + b.w - inset
    && p.y > b.y + inset && p.y < b.y + b.h - inset;
  const targets = new Map();
  const contourCache = new WeakMap(), outlineCards = new Map();
  let modules = [], planet = null, title = null, textBoxes = [];
  let frame = 0, previous = 0, elapsed = 0, travelled = 0, measureAt = 0, settling = 0;
  let width = 0, height = 0, size = 0, head = null, heading = null, trail = [], route = null;
  let anger = 0, expressionUntil = 0, fleeUntil = 0, evadeAt = 0, hideUntil = 0;
  let displayUntil = 0, pendingEscape = false, trailAt = 0;
  let journey = 0, lastModule = null, hovered = null, blockedClick = null;
  let pointer = { x: -10000, y: -10000 }, visible = [], impulses = [], sparks = [];
  let streamers = [];
  let needsArrival = true, cursorShown = false;

  function onHome() {
    return document.body.dataset.page === 'home'
      && document.body.dataset.home === 'ring'
      && !document.body.classList.contains('ring-away')
      && !document.body.classList.contains('globe-wide');
  }
  const active = () => !document.hidden && onHome();

  function boxOf(element) {
    if (!element) return null;
    const b = element.getBoundingClientRect();
    return b.width && b.height ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  }

  function refreshContour(target) {
    const { path } = target;
    if (!path) return;
    const matrix = path.getScreenCTM();
    if (!matrix) return;
    const shape = path.getAttribute('d');
    let cached = contourCache.get(path);
    if (!cached || cached.shape !== shape) {
      const length = path.getTotalLength();
      if (!length) return;
      const local = [];
      for (let i = 0; i < CONTOUR; i++) local.push(path.getPointAtLength(length * i / CONTOUR));
      cached = { shape, local }; contourCache.set(path, cached);
    }
    target.points = cached.local.map(p => ({
      x: p.x * matrix.a + p.y * matrix.c + matrix.e,
      y: p.x * matrix.b + p.y * matrix.d + matrix.f
    }));
  }

  function readContour(element, path, needed) {
    const box = boxOf(path) || boxOf(element);
    if (!box) return null;
    const points = [];
    const length = 2 * (box.w + box.h);
    for (let i = 0; i < CONTOUR; i++) {
      const at = length * i / CONTOUR;
      points.push(at < box.w ? { x: box.x + at, y: box.y }
        : at < box.w + box.h ? { x: box.x + box.w, y: box.y + at - box.w }
        : at < 2 * box.w + box.h ? { x: box.x + 2 * box.w + box.h - at, y: box.y + box.h }
        : { x: box.x, y: box.y + length - at });
    }
    const target = { ...box, points, element, path, kind: 'module' };
    if (needed) refreshContour(target);
    return target;
  }

  function measure() {
    const box = boxOf(core);
    planet = document.body.dataset.ring === 'wheel' && box
      ? { x: box.x + box.w / 2, y: box.y + box.h / 2, r: box.w / 2, kind: 'earth', element: core } : null;
    if (planet) targets.set('earth', planet); else targets.delete('earth');
    const items = [...document.querySelectorAll('.ring-item:not(.is-sizing)')];
    const paths = [...document.querySelectorAll('.ring-seg .back')];
    const used = new Set(trail.map(p => p.anchor));
    if (route) for (const p of route.samples) if (p.anchor) used.add(p.anchor);
    modules = [];
    items.forEach((element, index) => {
      const id = 'module-' + index;
      const target = readContour(element, document.body.dataset.ring === 'wheel' ? paths[index] : null, used.has(id));
      if (!target) return;
      target.id = id;
      targets.set(target.id, target); modules.push(target);
    });
    title = boxOf(document.querySelector('.home-mark'));
    textBoxes = items.map(boxOf).filter(Boolean);
    // Hover morphs update at 30 Hz; only contours carrying the snake are sampled.
    measureAt = elapsed + (elapsed < settling ? 1 / 30 : .22);
  }

  function border(target, phase) {
    if (target.kind === 'earth') {
      // A nearly circular orbit hugs the visible rim rather than cutting across the land.
      const angle = phase * TAU, normal = { x: Math.cos(angle), y: Math.sin(angle) };
      const r = target.r + size * (.19 + .025 * Math.sin(angle * 3));
      return { x: target.x + normal.x * r, y: target.y + normal.y * r,
        z: normal.y, normal };
    }
    const at = ((phase % 1 + 1) % 1) * CONTOUR, index = Math.floor(at), t = at - index;
    const a = target.points[index], b = target.points[(index + 1) % CONTOUR];
    const p = { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) };
    const normalAt = index => {
      const before = target.points[(index + CONTOUR - 3) % CONTOUR];
      const after = target.points[(index + 3) % CONTOUR];
      return unit({ x: after.y - before.y, y: before.x - after.x });
    };
    const na = normalAt(index), nb = normalAt((index + 1) % CONTOUR);
    let normal = unit({ x: mix(na.x, nb.x, t), y: mix(na.y, nb.y, t) });
    if (normal.x * (p.x - target.x - target.w / 2) + normal.y * (p.y - target.y - target.h / 2) < 0) {
      normal = { x: -normal.x, y: -normal.y };
    }
    return { x: p.x + normal.x * size * .12, y: p.y + normal.y * size * .12,
      z: normal.y, normal };
  }

  function resolve(p) {
    const target = p.anchor && targets.get(p.anchor);
    return target ? { ...p, ...border(target, p.phase) } : p;
  }

  function interpolate(a, b, t) {
    if (a.anchor && a.anchor === b.anchor) {
      return resolve({ anchor: a.anchor, phase: mix(a.phase, b.phase, t) });
    }
    const p = resolve(a), q = resolve(b);
    return { x: mix(p.x, q.x, t), y: mix(p.y, q.y, t), z: mix(p.z, q.z, t) };
  }

  function makeRoute(points, kind, shelter = null) {
    let length = 0;
    const samples = points.map((p, i) => {
      if (i) length += distance(resolve(p), resolve(points[i - 1]));
      return { ...p, at: length };
    });
    return { samples, length, cursor: 0, kind, shelter };
  }

  function curveTo(end, tangent, bend = .4) {
    const reach = Math.max(size, distance(head, end) * bend);
    const a = { x: head.x + heading.x * reach, y: head.y + heading.y * reach };
    const b = { x: end.x - tangent.x * reach, y: end.y - tangent.y * reach };
    const points = [];
    for (let i = 0; i <= 90; i++) {
      const t = i / 90, u = 1 - t, ease = t * t * (3 - 2 * t);
      points.push({ x: u ** 3 * head.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t ** 3 * end.x,
        y: u ** 3 * head.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * end.y,
        z: mix(head.z, end.z, ease) });
    }
    return points;
  }

  function atRoute(at) {
    const samples = route.samples;
    let lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].at < at) lo = mid; else hi = mid; }
    const a = samples[lo], b = samples[hi];
    return interpolate(a, b, Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at || 1))));
  }

  function coil(target) {
    refreshContour(target);
    const id = target.kind === 'earth' ? 'earth' : target.id;
    let phase = 0, nearest = Infinity;
    for (let i = 0; i < CONTOUR; i++) {
      const d = distance(head, border(target, i / CONTOUR));
      if (d < nearest) { nearest = d; phase = i / CONTOUR; }
    }
    const direction = Math.random() < .5 ? -1 : 1;
    const entry = border(target, phase), after = border(target, phase + direction * .002);
    const points = curveTo({ ...entry, z: -.4 }, unit({ x: after.x - entry.x, y: after.y - entry.y }));
    const turns = random(.75, 1.25);
    for (let i = 0; i <= 240; i++) {
      points.push({ ...border(target, phase + direction * turns * i / 240),
        anchor: id, phase: phase + direction * turns * i / 240 });
    }
    route = makeRoute(points, 'coil');
  }

  function glide(end, kind = 'glide') {
    const tangent = unit({ x: end.x - head.x, y: end.y - head.y });
    route = makeRoute(curveTo(end, tangent, random(.35, .55)), kind);
  }

  function headRadius() {
    const scale = size * 1.14;
    const line = window.RealmOutline ? window.RealmOutline.screenPixels(scale / 16) : 0;
    // Enclose every rotation of the entire head and its black outline.
    return scale * Math.SQRT1_2 + line + 2;
  }

  function headIsClear(point = head, margin = headRadius()) {
    return point && point.x > margin && point.x < width - margin
      && point.y > margin && point.y < height - margin
      && (!planet || distance(point, planet) > planet.r + margin)
      && (!title || !inside(point, title, -margin))
      && !modules.some(m => inside(point, m, -margin));
  }

  function headCanReact(point) {
    const margin = headRadius();
    if (!headIsClear(point, margin)) return false;
    // Check live boxes only for an otherwise visible reaction. Hover growth
    // can cover the face between the throttled contour measurements.
    const earth = planet && boxOf(core);
    if (earth && distance(point, { x: earth.x + earth.w / 2, y: earth.y + earth.h / 2 })
      <= earth.w / 2 + margin) return false;
    const blockers = [...covers.map(boxOf),
      ...modules.flatMap(m => [boxOf(m.path), boxOf(m.element)])];
    return !blockers.some(box => box && inside(point, box, -margin));
  }

  function showTemper() {
    if (route.kind === 'display' || elapsed < displayUntil) return;
    if (headCanReact(head)) {
      displayUntil = elapsed + 1.65;
      expressionUntil = displayUntil;
      return;
    }
    const pockets = [];
    const inset = headRadius() + 4;
    for (const y of [.91, .82, .12, .24]) for (const x of [.18, .35, .5, .65, .82]) {
      const p = { x: Math.max(inset, Math.min(width - inset, width * x)),
        y: Math.max(inset, Math.min(height - inset, height * y)), z: -.4 };
      if (headCanReact(p)) pockets.push(p);
    }
    pockets.sort((a, b) => distance(head, a) - distance(head, b));
    if (pockets.length) glide(pockets[0], 'display');
    else {
      // Very narrow layouts may have no free pocket: keep the reaction brief.
      expressionUntil = elapsed + .75;
      if (pendingEscape) { pendingEscape = false; escape(false); }
    }
  }

  function escape(hide = true) {
    fleeUntil = Math.max(fleeUntil, elapsed + random(3.5, 5));
    evadeAt = elapsed + .7;
    const shelters = [planet && { x: planet.x, y: planet.y, z: -1 },
      title && { x: title.x + title.w / 2, y: title.y + title.h / 2, z: -1 },
      ...modules.map(m => ({ x: m.x + m.w / 2, y: m.y + m.h / 2, z: -1 }))].filter(Boolean);
    if (hide && shelters.length) {
      shelters.sort((a, b) => distance(b, pointer) - distance(a, pointer));
      const end = shelters[Math.floor(random(0, Math.min(3, shelters.length)))];
      const tangent = unit({ x: end.x - head.x, y: end.y - head.y });
      route = makeRoute(curveTo(end, tangent, .3), 'hide', end);
    } else {
      const away = unit({ x: head.x - pointer.x, y: head.y - pointer.y });
      glide({ x: Math.max(size * .3, Math.min(width - size * .3, head.x + away.x * size * 4)),
        y: Math.max(size * .3, Math.min(height - size * .3, head.y + away.y * size * 4)), z: -.6 }, 'flee');
    }
  }

  function plan() {
    if (anger > FLEE && elapsed < fleeUntil) { escape(Math.random() < .65); return; }
    const choice = journey++ === 0 ? 0 : journey === 2 ? .5 : Math.random();
    if (choice < .35 && planet) { coil(planet); return; }
    if (choice < .8 && modules.length) {
      const pool = modules.filter(m => m.id !== lastModule);
      const target = (pool.length ? pool : modules)[Math.floor(random(0, pool.length || modules.length))];
      lastModule = target.id; coil(target); return;
    }
    const side = Math.random() < .5;
    glide({ x: random(.08, .92) * width, y: (side ? random(.1, .23) : random(.79, .91)) * height, z: -.5 });
  }

  function reset(arrival = false) {
    width = window.innerWidth; height = window.innerHeight;
    const nextSize = Math.max(76, Math.min(168, Math.min(width, height) * .15));
    if (size !== nextSize) outlineCards.clear();
    size = nextSize;
    if (arrival) {
      anger = expressionUntil = fleeUntil = evadeAt = 0;
      impulses = []; sparks = []; streamers = []; blockedClick = null; hovered = null;
    }
    // Navigation may have moved the previous module's outline off screen.
    trail = []; route = null;
    measure();
    head = { x: width * .84, y: height * .83, z: -.3 };
    heading = unit({ x: -1, y: -.18 });
    for (let back = 0; back <= size * PARTS * .5; back += STEP) {
      trail.push({ x: head.x - heading.x * back, y: head.y - heading.y * back, z: head.z, at: -back });
    }
    travelled = 0; previous = 0; journey = 0; hideUntil = 0;
    displayUntil = 0; pendingEscape = false; plan();
  }

  function advance(delta) {
    elapsed += delta; anger = Math.max(0, anger - delta * .1);
    if (elapsed >= measureAt) measure();
    impulses.forEach(p => { p.age += delta; }); impulses = impulses.filter(p => p.age < 1.1);
    sparks.forEach(p => { p.age += delta; }); sparks = sparks.filter(p => p.age < .65);
    streamers.forEach(p => { p.age += delta; }); streamers = streamers.filter(p => p.age < p.life);
    if (displayUntil) {
      if (elapsed < displayUntil) return;
      displayUntil = 0;
      if (pendingEscape) { pendingEscape = false; escape(true); } else plan();
    }
    if (elapsed < hideUntil) return;
    const pace = .92 + .17 * Math.sin(elapsed * .63) + .09 * Math.sin(elapsed * 1.61);
    const fleeing = elapsed < fleeUntil;
    let left = size * (fleeing ? 4.9 : 1.7 + anger * .85) * pace * delta;
    while (left > .0001) {
      const step = Math.min(STEP, left, Math.max(0, route.length - route.cursor));
      route.cursor += step;
      const point = atRoute(route.cursor), moved = distance(head, point);
      if (moved > .001) {
        heading = unit({ x: point.x - head.x, y: point.y - head.y });
        travelled += moved; head = point; trail.unshift({ ...head, at: travelled });
      }
      left -= step;
      if (route.cursor >= route.length - .001) {
        if (route.kind === 'display') {
          displayUntil = elapsed + 1.65; expressionUntil = displayUntil; break;
        }
        if (route.kind === 'hide') { hideUntil = elapsed + random(.7, 1.25); plan(); break; }
        plan();
      }
    }
    while (trail.length > 2 && travelled - trail[trail.length - 2].at > size * PARTS * .48) trail.pop();
  }

  function body() {
    const pieces = [];
    let index = 0, behind = 0;
    for (let part = 0; part <= PARTS; part++) {
      if (part) behind += size * .34 * (taper(part - 1) + taper(part)) / 2;
      const at = travelled - behind;
      while (index < trail.length - 2 && trail[index + 1].at > at) index++;
      const a = trail[index], b = trail[index + 1];
      const p = interpolate(a, b, Math.max(0, Math.min(1, (a.at - at) / (a.at - b.at || 1))));
      const pa = resolve(a), pb = resolve(b), direction = unit({ x: pa.x - pb.x, y: pa.y - pb.y });
      const wave = reduced.matches ? 0 : Math.sin(part * .57 - elapsed * (3.4 + anger * 3))
        * size * (.07 + anger * .045) * Math.min(1, part / 5);
      p.x -= direction.y * wave; p.y += direction.x * wave;
      let pushX = 0, pushY = 0;
      for (const impulse of impulses) {
        const push = Math.exp(-(distance(p, impulse) ** 2) / (size * size * 1.5))
          * Math.sin(Math.min(1, impulse.age / .15) * Math.PI / 2) * Math.exp(-impulse.age * 3) * impulse.strength;
        pushX += impulse.nx * push; pushY += impulse.ny * push;
      }
      const limit = Math.min(1, size * .22 / (Math.hypot(pushX, pushY) || 1));
      p.x += pushX * limit; p.y += pushY * limit;
      pieces.push(p);
    }
    return pieces;
  }

  function clear() {
    visible = [];
    for (const pen of pens) { pen.setTransform(1, 0, 0, 1, 0, 0); pen.clearRect(0, 0, canvas.width, canvas.height); }
  }

  function maskPlanet(pen) {
    if (!planet) return;
    const radius = planet.r - size * .025;
    pen.beginPath(); pen.rect(-width, -height, width * 3, height * 3);
    pen.moveTo(planet.x + radius, planet.y); pen.arc(planet.x, planet.y, radius, 0, TAU);
    pen.clip('evenodd');
  }

  function outlineCard(sx, row, scale) {
    if (!window.RealmOutline) return null;
    const line = window.RealmOutline.screenPixels(scale / 16);
    const key = sx + ',' + row + ',' + scale + ',' + line;
    let card = outlineCards.get(key);
    if (!card) {
      const image = document.createElement('canvas');
      image.width = image.height = Math.ceil(scale + line * 2);
      const pen = image.getContext('2d');
      pen.imageSmoothingEnabled = false;
      const silhouette = window.RealmOutline.silhouette(sprite, sx, row * 16, 16, 16);
      pen.drawImage(silhouette, 0, line, scale, scale);
      pen.drawImage(silhouette, line * 2, line, scale, scale);
      pen.drawImage(silhouette, line, 0, scale, scale);
      pen.drawImage(silhouette, line, line * 2, scale, scale);
      card = { image, line }; outlineCards.set(key, card);
    }
    return card;
  }

  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let layer = 0; layer < 2; layer++) {
      const surface = layer ? foreground : canvas, pen = pens[layer];
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (surface.width !== w || surface.height !== h) { surface.width = w; surface.height = h; }
      pen.setTransform(dpr, 0, 0, dpr, 0, 0); pen.clearRect(0, 0, width, height);
      pen.imageSmoothingEnabled = false;
    }
    visible = [];
    if (!sprite.complete || !sprite.naturalWidth) return;
    const pieces = body();
    const poses = pieces.map((p, i) => {
      const target = p.anchor && targets.get(p.anchor);
      const ahead = pieces[Math.max(0, i - 1)], behind = pieces[Math.min(PARTS, i + 1)];
      let turn = i ? Math.atan2(ahead.y - behind.y, ahead.x - behind.x) : Math.atan2(heading.y, heading.x);
      let row = reduced.matches ? 0 : 1 + (Math.floor(elapsed * (3.4 + anger * 4) - i * .12) % 2 + 2) % 2;
      let mirror = false;
      const tense = !i && (anger > NOTICE || elapsed < expressionUntil) && headCanReact(p)
        && (elapsed < displayUntil || Math.sin(turn) >= -.68);
      // A masked or rear-facing head keeps swimming normally. Show the
      // expression to the viewer only once the whole face is in the open.
      if (tense && elapsed < displayUntil) turn = Math.PI / 2;
      if (!i) {
        if (Math.sin(turn) > .68) { row = tense ? 6 : 4; turn -= Math.PI / 2; }
        else if (Math.sin(turn) < -.68) { row = 5; turn += Math.PI / 2; }
        else {
          row = tense ? 3 : row;
          if (Math.cos(turn) < 0) { mirror = true; turn -= Math.PI; }
        }
        if (!reduced.matches) turn += Math.sin(elapsed * (tense ? 12 : 2.3)) * (tense ? .05 : .025);
      }
      return { p, i, turn, row, mirror, tense, scale: size * taper(i) * (i ? 1 : 1.14),
        front: tense || !!(target && target.kind === 'module' && p.z > .05) };
    });
    for (let layer = 0; layer < 2; layer++) {
      const pen = pens[layer];
      pen.save(); maskPlanet(pen);
      if (layer) {
        // Only the border of a module is in front; its text stays readable.
        pen.beginPath(); pen.rect(-width, -height, width * 3, height * 3);
        for (const box of textBoxes) pen.rect(box.x + 10, box.y + 9, Math.max(0, box.w - 20), Math.max(0, box.h - 18));
        pen.clip('evenodd');
      }
      // All black silhouettes go under all colours, so overlapping segments
      // share the site's outline without drawing seams through the body.
      for (const outlinePass of [true, false]) for (let i = PARTS; i >= 0; i--) {
        const { p, turn, row, mirror, scale, front, tense } = poses[i];
        if (Number(front) !== layer || (outlinePass && !window.RealmOutline)) continue;
        pen.save(); pen.translate(p.x, p.y); pen.rotate(turn + (i === PARTS ? Math.PI : 0));
        if (mirror) pen.scale(-1, 1);
        const sx = i === 0 ? 0 : i === PARTS ? 32 : 16;
        if (outlinePass) {
          const { image, line } = outlineCard(sx, row, scale);
          const edge = -scale / 2 - line;
          pen.globalAlpha = 1;
          pen.drawImage(image, 0, 0, image.width, image.height, edge, edge, image.width, image.height);
        } else {
          pen.globalAlpha = 1;
          if (tense && anger > NOTICE) pen.filter = 'drop-shadow(0 0 5px rgba(255, 178, 108, .45))';
          pen.drawImage(sprite, sx, row * 16, 16, 16, -scale / 2, -scale / 2, scale, scale);
          visible.push({ ...p, radius: scale * (i ? .25 : .36), front });
        }
        pen.restore();
      }
      pen.restore();
    }
    const pen = pens[1];
    for (const spark of sparks) {
      pen.globalAlpha = Math.max(0, 1 - spark.age / .65) * .7;
      pen.fillStyle = spark.hot ? '#ffd29a' : '#d7edff';
      pen.fillRect(spark.x + spark.vx * spark.age, spark.y + spark.vy * spark.age, 3, 3);
    }
    pen.globalAlpha = 1;
    if (!reduced.matches && elapsed > trailAt && elapsed >= hideUntil && elapsed >= displayUntil) {
      trailAt = elapsed + .16;
      const tail = pieces[PARTS];
      if (headIsClear(tail, size * .12)) burst(tail, 1, true);
    }
    drawStreamers(pen);
    updateCursor();
  }

  function burst(point, amount = 14, trail = false) {
    if (reduced.matches) return;
    const colours = ['#dff5ff', '#9bcddd', '#edc77d', '#c9b9ec'];
    for (let i = 0; i < amount; i++) {
      const angle = random(0, TAU), speed = trail ? random(12, 35) : random(80, 220);
      streamers.push({ ...point, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 25,
        age: 0, life: trail ? .65 : random(.95, 1.5), length: trail ? 10 : random(14, 27),
        phase: random(0, TAU), spin: random(-6, 6), trail, colour: colours[i % colours.length] });
    }
    streamers = streamers.slice(-160);
  }

  function drawStreamers(pen) {
    for (const ribbon of streamers) {
      const age = ribbon.age, progress = age / ribbon.life;
      const travel = (1 - Math.exp(-age * 2)) / 2;
      pen.save();
      pen.translate(ribbon.x + ribbon.vx * travel, ribbon.y + ribbon.vy * travel + 55 * age * age);
      pen.rotate(ribbon.spin * age + ribbon.phase);
      pen.globalAlpha = Math.min(1, age / .07) * Math.pow(1 - progress, .7) * (ribbon.trail ? .3 : .8);
      pen.beginPath();
      for (let i = 0; i <= 12; i++) {
        const u = i / 12, x = (u - .5) * ribbon.length;
        const y = Math.sin(u * TAU * 1.35 + ribbon.phase + age * 5) * ribbon.length * .13;
        if (i) pen.lineTo(x, y); else pen.moveTo(x, y);
      }
      pen.lineCap = 'round'; pen.lineJoin = 'round';
      pen.strokeStyle = '#080c15'; pen.lineWidth = ribbon.trail ? 3 : 4; pen.stroke();
      pen.strokeStyle = ribbon.colour; pen.lineWidth = ribbon.trail ? 1.5 : 2.5; pen.stroke();
      pen.restore();
    }
  }

  function hit(point) {
    if (!active() || (title && inside(point, title))) return null;
    if (planet && Math.hypot(point.x - planet.x, point.y - planet.y) < planet.r - size * .025) return null;
    return visible.find(p => distance(point, p) < p.radius
      && !modules.some(m => inside(point, m, p.front ? 10 : 0))) || null;
  }

  function updateCursor() {
    const touched = active() && pointer.x >= 0 && pointer.y >= 0
      && pointer.x < width && pointer.y < height && hit(pointer);
    const element = touched && document.elementFromPoint(pointer.x, pointer.y);
    const shown = !!(touched && element && !element.closest(CONTROLS));
    if (shown !== cursorShown) document.documentElement.classList.toggle('snake-can-hit', shown);
    cursorShown = shown;
  }

  function bump(point, away, strength) {
    impulses.push({ ...point, nx: away.x, ny: away.y, age: 0, strength });
    for (let i = 0; i < 7; i++) sparks.push({ ...point, vx: random(-85, 85), vy: random(-85, 85), age: 0, hot: anger > NOTICE });
  }

  document.addEventListener('pointermove', event => {
    pointer = { x: event.clientX, y: event.clientY };
    updateCursor();
    if (active() && head && (anger > FLEE || elapsed < fleeUntil) && elapsed > evadeAt
      && elapsed >= displayUntil && route.kind !== 'display' && distance(pointer, head) < size * 2) escape(Math.random() < .65);
  }, { passive: true });
  document.addEventListener('pointerdown', event => {
    blockedClick = null;
    if (event.button > 0 || !active()) return;
    const point = { x: event.clientX, y: event.clientY };
    burst(point);
    if (event.target.closest(CONTROLS)) return;
    const touched = hit(point);
    if (!touched) return;
    pointer = point; anger = Math.min(1.4, anger + .14);
    expressionUntil = Math.max(expressionUntil, elapsed + .55);
    const away = unit({ x: touched.x - point.x + heading.y * 8, y: touched.y - point.y - heading.x * 8 });
    bump(point, away, size * .65);
    if (anger >= NOTICE) { pendingEscape ||= anger > FLEE; showTemper(); }
    else glide({ x: head.x + away.x * size * 1.5, y: head.y + away.y * size * 1.5, z: -.4 }, 'recoil');
    blockedClick = { ...point, time: event.timeStamp };
    event.preventDefault(); event.stopPropagation();
    if (reduced.matches) draw();
  }, true);
  document.addEventListener('click', event => {
    if (blockedClick && event.timeStamp - blockedClick.time < 600
      && distance({ x: event.clientX, y: event.clientY }, blockedClick) < 12) {
      event.preventDefault(); event.stopPropagation(); blockedClick = null;
    }
  }, true);
  document.addEventListener('pointerover', event => {
    if (!active() || !head) return;
    const element = event.target.closest('.ring-item, #ringCore');
    if (!element || element === hovered) return;
    hovered = element; settling = elapsed + .85; measure();
    anger = Math.min(1.4, anger + .025);
    if (anger > NOTICE) { expressionUntil = Math.max(expressionUntil, elapsed + .5); showTemper(); }
    const target = element === core ? planet : modules.find(m => m.element === element);
    if (!target) return;
    const center = target.kind === 'earth' ? target : { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const nearby = body().filter(p => distance(p, center) < (target.r || Math.max(target.w, target.h) / 2) + size);
    if (nearby.length) {
      const p = nearby[0], away = unit({ x: p.x - center.x, y: p.y - center.y });
      bump(p, away, size * .3);
      if (anger > FLEE) { pendingEscape = true; showTemper(); }
    }
  }, { passive: true });
  document.addEventListener('pointerout', event => {
    if (hovered && !hovered.contains(event.relatedTarget)) hovered = null;
    if (!event.relatedTarget) { pointer = { x: -10000, y: -10000 }; updateCursor(); }
  }, { passive: true });

  function conceal() {
    if (!onHome()) needsArrival = true;
    canvas.hidden = true; foreground.hidden = true; streamers = []; clear();
    if (cursorShown) document.documentElement.classList.toggle('snake-can-hit', false);
    cursorShown = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0; previous = 0;
  }
  function tick(now) {
    if (!active() || reduced.matches) { conceal(); return; }
    advance(previous ? Math.min(.05, (now - previous) / 1000) : 0);
    previous = now; draw(); frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (!active()) { conceal(); return; }
    canvas.hidden = false; foreground.hidden = false;
    if (!head || needsArrival) { reset(true); needsArrival = false; }
    // Body-class changes and ResizeObserver callbacks only invalidate the
    // geometry; do not force several SVG/layout reads in the same frame.
    measureAt = Math.min(measureAt, elapsed + 1 / 30);
    settling = Math.max(settling, elapsed + .5);
    if (frame && !reduced.matches) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0; previous = 0;
    if (reduced.matches) { measure(); draw(); } else frame = requestAnimationFrame(tick);
  }
  sprite.addEventListener('load', sync);
  sprite.src = (window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.homeSnake) || 'assets/home/white-snake.png';
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('hashchange', sync);
  window.addEventListener('resize', () => {
    if (active()) { reset(); sync(); } else needsArrival = true;
  });
  reduced.addEventListener('change', sync);
  if (core) new ResizeObserver(() => {
    settling = elapsed + .5; measureAt = Math.min(measureAt, elapsed + 1 / 30);
    if (active() && reduced.matches) { measure(); draw(); }
  }).observe(core);
  new MutationObserver(sync).observe(document.body, {
    attributes: true, attributeFilter: ['class', 'data-page', 'data-home', 'data-ring']
  });
  sync();
})();
