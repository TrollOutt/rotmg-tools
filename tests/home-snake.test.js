'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const outline = require('../web/outline');

function scene({ width = 942, height = 960, reducedMotion = false, wheel = true, svg = false } = {}) {
  let queued = null, observer, resized, mediaChanged, now = 0, seed = 49291;
  const listeners = {}, classes = new Set(), cursorClasses = new Set();
  let pointedElement = null;
  let morphing = false, shapeVersion = 0;
  const metrics = { svgSamples: 0, outlineCanvases: 0, outlineDraws: 0 };
  const body = { dataset: { page: 'home', home: 'ring', ring: wheel ? 'wheel' : 'list' },
    classList: { contains: key => classes.has(key) } };
  const media = { matches: reducedMotion, addEventListener: (_, fn) => { mediaChanged = fn; } };
  function surface() {
    let state = {}, stack = [], pictures = [], circles = [], boxes = [], shadows = 0, strokes = 0;
    const pen = {
      get globalAlpha() { return state.alpha ?? 1; }, set globalAlpha(value) { state.alpha = value; },
      setTransform() {}, clearRect() { pictures = []; circles = []; boxes = []; shadows = 0; strokes = 0; },
      beginPath() {}, rect(x, y, w, h) { boxes.push({ x, y, w, h }); }, moveTo() {},
      lineTo() {}, stroke() { strokes++; },
      arc(x, y, r) { circles.push({ x, y, r }); },
      save() { stack.push({ ...state }); }, restore() { state = stack.pop(); }, clip() {},
      translate(x, y) { state.x = x; state.y = y; }, rotate(angle) { state.angle = angle; },
      scale(x) { state.mirror = x < 0; }, fillRect() {},
      drawImage(image, sx, sy, sw, sh, dx, dy, w) {
        if (image.cachedOutline) { shadows++; return; }
        pictures.push({ ...state, alpha: pen.globalAlpha, sx, sy, size: w });
      }
    };
    return { getContext: () => pen, get pictures() { return pictures; },
      get circles() { return circles; }, get boxes() { return boxes; },
      get shadows() { return shadows; }, get strokes() { return strokes; }, hidden: false };
  }
  const canvas = surface(), front = surface();
  const core = { radius: 160, getBoundingClientRect() {
    return { x: width / 2 - this.radius, y: height / 2 - this.radius, width: this.radius * 2, height: this.radius * 2 };
  }, contains: () => false };
  const modules = [[20, 300, 260, 100], [662, 300, 260, 100], [20, 560, 260, 100]].map(([x, y, w, h]) => ({
    box: { x, y, width: w, height: h }, getBoundingClientRect() { return this.box; }, contains: () => false
  }));
  const paths = modules.map(element => ({
    getBoundingClientRect: () => element.getBoundingClientRect(),
    getAttribute: () => String(shapeVersion),
    getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getTotalLength: () => 2 * (element.box.width + element.box.height),
    getPointAtLength(at) {
      metrics.svgSamples++;
      const { x, y, width: w, height: h } = element.box;
      return at < w ? { x: x + at, y } : at < w + h ? { x: x + w, y: y + at - w }
        : at < 2 * w + h ? { x: x + 2 * w + h - at, y: y + h }
        : { x, y: y + 2 * (w + h) - at };
    }
  }));
  const mark = { box: { x: width / 2 - 150, y: 70, width: 300, height: 100 },
    getBoundingClientRect() { return this.box; } };
  const notes = { box: { x: width / 2 - 100, y: 190, width: 200, height: 40 },
    getBoundingClientRect() { return this.box; } };
  const document = { body, hidden: false,
    documentElement: { classList: { toggle(key, on) { if (on) cursorClasses.add(key); else cursorClasses.delete(key); } } },
    elementFromPoint: () => ({ closest: () => pointedElement }),
    getElementById: id => id === 'homeSnake' ? canvas : id === 'homeSnakeFront' ? front : core,
    querySelector: () => mark,
    querySelectorAll: selector => selector.startsWith('.ring-item') ? modules
      : selector.startsWith('.home-mark') ? [mark, notes] : svg ? paths : [],
    createElement: () => {
      metrics.outlineCanvases++;
      return { cachedOutline: true, getContext: () => ({ drawImage() { metrics.outlineDraws++; } }) };
    },
    addEventListener: (event, fn) => { listeners[event] = fn; } };
  const math = Object.create(Math);
  math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const sandbox = {
    document, Math: math,
    window: { innerWidth: width, innerHeight: height, devicePixelRatio: 1, location: { hash: '' },
      RealmOutline: { screenPixels: outline.screenPixels, silhouette: () => ({ ink: true }) },
      matchMedia: () => media, addEventListener: (event, fn) => { listeners[event] = fn; } },
    Image: class { complete = true; naturalWidth = 48; addEventListener() {} },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    ResizeObserver: class { constructor(fn) { resized = fn; } observe() {} },
    requestAnimationFrame: fn => { queued = fn; return 1; },
    cancelAnimationFrame: () => { queued = null; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/home-snake.js'), 'utf8'), sandbox);
  return {
    document, media, sandbox, listeners, canvas, front, core, modules, mark, notes, classes, cursorClasses, metrics,
    animateContours() { morphing = true; },
    step() {
      now += 1000 / 60;
      if (morphing) shapeVersion++;
      const callback = queued; queued = null;
      if (callback) callback(now);
      return [...canvas.pictures, ...front.pictures];
    },
    event(type, point, element = null) {
      pointedElement = element;
      const event = { clientX: point.x, clientY: point.y, button: 0, timeStamp: now,
        target: { closest: () => element }, relatedTarget: null, prevented: false,
        preventDefault() { this.prevented = true; }, stopPropagation() {} };
      listeners[type](event); return event;
    },
    get running() { return !!queued; },
    changed: () => observer(), resize: () => resized(), motionChanged: () => mediaChanged()
  };
}
const headOf = images => images.find(p => p.sx === 0);
function facing(head) {
  const row = head.sy / 16;
  const pose = row === 4 || row === 6 ? Math.PI / 2 : row === 5 || row === 7 ? -Math.PI / 2 : 0;
  return head.angle + pose + (head.mirror ? Math.PI : 0);
}

const world = scene();
let last, minSpeed = Infinity, maxSpeed = 0, nearRim = 0, moduleCoils = 0;
const poses = new Set();
for (let i = 0; i < 60 * 100; i++) {
  const images = world.step(), head = headOf(images);
  assert(head, 'The serpent retains its head through route changes');
  for (const p of images) {
    assert([p.x, p.y, p.angle, p.size].every(Number.isFinite));
    assert.equal(p.alpha, 1, 'Every head, body and tail sprite is fully opaque on both layers');
  }
  poses.add(head.sy);
  if (Math.abs(Math.hypot(head.x - 471, head.y - 480) - 187) < 12) nearRim++;
  if (world.front.pictures.length) moduleCoils++;
  for (const surface of [world.canvas, world.front]) {
    assert(surface.circles.some(c => c.r > 150 && c.r <= 160), 'Both layers mask the Earth interior');
    assert.equal(surface.shadows, surface.pictures.length, 'One cached shared-outline card outlines each segment');
  }
  if (last && i > 2) {
    const dx = head.x - last.x, dy = head.y - last.y, speed = Math.hypot(dx, dy);
    assert(speed < 8, `Normal route changes remain continuous at frame ${i}: ${speed}, ${JSON.stringify({ last, head })}`);
    if (speed > .01) {
      assert((dx * Math.cos(facing(head)) + dy * Math.sin(facing(head))) / speed > .75,
        'Side, front and back head poses all face the swimming direction');
      minSpeed = Math.min(minSpeed, speed); maxSpeed = Math.max(maxSpeed, speed);
    }
  }
  last = head;
}
assert(nearRim > 100, 'Earth orbits follow its rim');
assert(moduleCoils > 100, 'Some coils pass around module borders on the foreground layer');
assert(poses.has(4 * 16) && poses.has(5 * 16), 'Vertical movement uses front and back head poses');
assert(maxSpeed / minSpeed > 1.3, 'The serpent varies its speed');

const touched = scene();
let head = headOf(touched.step());
const baseline = [];
for (let i = 0; i < 25; i++) { const next = headOf(touched.step()); baseline.push(Math.hypot(next.x - head.x, next.y - head.y)); head = next; }
for (let i = 0; i < 9; i++) {
  assert(touched.event('pointerdown', head).prevented, 'Visible snake clicks are consumed');
  head = headOf(touched.step());
}
const mouse = { x: head.x - 12, y: head.y - 8 };
touched.event('pointermove', mouse);
let fastest = 0, angryFrames = 0, clearAngryFrames = 0, frontReactionFrames = 0, mouseDistance = 0;
const protest = { ...head };
for (let i = 0; i < 210; i++) {
  const next = headOf(touched.step());
  fastest = Math.max(fastest, Math.hypot(next.x - head.x, next.y - head.y));
  if ([3, 6, 7].includes(next.sy / 16)) {
    angryFrames++;
    if (next.sy === 6 * 16) frontReactionFrames++;
    if (Math.hypot(next.x - 471, next.y - 480) > 170
      && !touched.modules.some(m => next.x > m.box.x && next.x < m.box.x + m.box.width
        && next.y > m.box.y && next.y < m.box.y + m.box.height)) clearAngryFrames++;
  }
  if (i === 60) assert(Math.hypot(next.x - protest.x, next.y - protest.y) < 75,
    'Even repeated hits leave time for a visible protest before fleeing');
  mouseDistance = Math.max(mouseDistance, Math.hypot(next.x - mouse.x, next.y - mouse.y));
  head = next;
}
assert(angryFrames > 65 && clearAngryFrames / angryFrames > .8,
  'The special head remains visible for a clear reaction rather than spending it behind scenery');
assert(frontReactionFrames > 65, 'The visible protest turns its special head toward the viewer');
assert(fastest > Math.max(...baseline) * 2, 'Repeated touches cause a fast escape');
assert(mouseDistance > 190, 'An agitated serpent gets away from an approaching mouse');
assert(!touched.event('pointerdown', { x: 3, y: 3 }).prevented, 'Empty sky is not a snake hit');
assert(!touched.event('pointerdown', head, touched.modules[0]).prevented, 'Module controls retain their clicks');
assert(!touched.event('click', head, touched.modules[0]).prevented, 'An earlier snake touch does not swallow a later module click');

const patient = scene(); head = headOf(patient.step());
for (let i = 0; i < 3; i++) { patient.event('pointerdown', head); head = headOf(patient.step()); }
let laterSpeed = 0;
for (let i = 0; i < 100; i++) {
  const next = headOf(patient.step());
  if (i > 75) laterSpeed = Math.max(laterSpeed, Math.hypot(next.x - head.x, next.y - head.y));
  head = next;
}
assert(laterSpeed < Math.max(...baseline) * 1.9, 'A few taps do not immediately trigger a fast escape');

const shy = scene();
const uncovered = p => p.x > 25 && p.x < 917 && p.y > 25 && p.y < 935
  && Math.hypot(p.x - 471, p.y - 480) > 170
  && !(p.x > 321 && p.x < 621 && p.y > 70 && p.y < 170)
  && !shy.modules.some(m => p.x > m.box.x && p.x < m.box.x + m.box.width
    && p.y > m.box.y && p.y < m.box.y + m.box.height);
let pictures, bodyHit;
for (let i = 0; i < 1800; i++) {
  pictures = shy.step();
  bodyHit = pictures.find(p => p.sx === 16 && uncovered(p));
  if (!uncovered(headOf(pictures)) && bodyHit) break;
}
assert(bodyHit && !uncovered(headOf(pictures)), 'The test reaches a hidden head with an exposed body');
for (let i = 0; i < 9; i++) {
  assert(shy.event('pointerdown', bodyHit).prevented);
  pictures = shy.step();
  bodyHit = pictures.find(p => p.sx === 16 && uncovered(p));
  assert(bodyHit, 'An exposed segment remains available for the next touch');
}
let exposedReaction = 0;
let checkedLiveCovers = false;
function wholeHeadClear(h) {
  const margin = h.size * Math.SQRT1_2 + outline.screenPixels(h.size / 16) + 2;
  const outside = b => h.x <= b.x - margin || h.x >= b.x + b.width + margin
    || h.y <= b.y - margin || h.y >= b.y + b.height + margin;
  return h.x > margin && h.x < 942 - margin && h.y > margin && h.y < 960 - margin
    && Math.hypot(h.x - 471, h.y - 480) > shy.core.radius + margin
    && [shy.mark, shy.notes, ...shy.modules].every(m => outside(m.box));
}
function assertReactionVisible(h) {
  assert.notEqual(h.sy / 16, 7, 'The rear pose never substitutes for a visible angry face');
  if ([3, 6].includes(h.sy / 16)) {
    assert(wholeHeadClear(h), 'An angry face and its entire outline stay clear of every occluder');
    assert(shy.front.pictures.includes(h), 'A visible angry face is drawn above its own body');
    return true;
  }
  return false;
}
for (let i = 0; i < 420; i++) {
  const h = headOf(shy.step());
  if (assertReactionVisible(h)) {
    exposedReaction++;
    if (!checkedLiveCovers) {
      // No observer notification: a hover can grow between geometry samples.
      // Even a corner of the head behind a box must suppress the expression.
      for (const cover of [shy.modules[0], shy.mark, shy.notes]) {
        const before = { ...cover.box };
        cover.box = { x: h.x + h.size * .4, y: h.y - 20, width: 40, height: 40 };
        assert(![3, 6, 7].includes(headOf(shy.step()).sy / 16),
          'A live module, title or season badge suppresses a partially covered angry head');
        cover.box = before;
        assert(assertReactionVisible(headOf(shy.step())), 'The visible face can react again after the cover leaves');
      }
      const radius = shy.core.radius;
      shy.core.radius = Math.hypot(h.x - 471, h.y - 480) - h.size * .4;
      assert(![3, 6, 7].includes(headOf(shy.step()).sy / 16),
        'Live Earth growth suppresses a partially masked expression immediately');
      shy.core.radius = radius;
      checkedLiveCovers = true;
    }
  }
}
assert(exposedReaction >= 70, 'A hidden head comes into the open to show its reaction before seeking cover');
assert(checkedLiveCovers, 'The reaction scenario exercises hover occlusion between measurements');

const snakeCss = fs.readFileSync(path.join(__dirname, '../web/style.css'), 'utf8');
assert.match(snakeCss, /body\[data-page="home"\]\[data-home="ring"\] \.home-snake \{ opacity: 1; \}/,
  'The canvas adds no transparency to the snake');

const cursor = scene(); head = headOf(cursor.step());
cursor.event('pointermove', head);
assert(cursor.cursorClasses.has('snake-can-hit'), 'A visible snake shows the sword cursor');
cursor.event('pointermove', head, cursor.modules[0]);
assert(!cursor.cursorClasses.has('snake-can-hit'), 'Module controls keep their normal cursor');
cursor.event('pointermove', { x: 3, y: 3 });
assert(!cursor.cursorClasses.has('snake-can-hit'), 'Empty sky keeps its normal cursor');
cursor.event('pointermove', head);
cursor.classes.add('globe-wide'); cursor.changed();
assert(!cursor.cursorClasses.has('snake-can-hit'), 'Opening the Atlas removes the sword cursor');

const party = scene(); party.step();
assert(!party.event('pointerdown', { x: 90, y: 800 }).prevented, 'A background click stays a background click');
party.step();
const burstStrokes = party.front.strokes;
assert(burstStrokes >= 28, 'A background click emits a burst of curled streamers');
for (let i = 0; i < 120; i++) party.step();
assert(party.front.strokes < burstStrokes / 2, 'The click burst disappears, leaving only the restrained tail trail');

const hover = scene(); hover.step();
hover.event('pointerover', { x: 470, y: 480 }, hover.core);
hover.core.radius = 200; hover.resize();
for (let i = 0; i < 3; i++) hover.step();
assert(hover.canvas.circles.some(c => c.r > 190), 'The occlusion follows the enlarged Earth');
hover.modules[0].box.width += 120;
hover.event('pointerover', { x: 70, y: 340 }, hover.modules[0]);
hover.step();
assert(hover.front.boxes.some(b => b.w === 360), 'Text masks follow expanded module geometry');

for (const className of ['ring-away', 'globe-wide']) {
  world.classes.add(className); world.changed();
  assert(!world.running && world.canvas.hidden && world.front.hidden, className + ' hides both layers immediately');
  assert.equal(world.canvas.pictures.length + world.front.pictures.length, 0, 'No old snake frame remains on the Atlas');
  world.classes.delete(className); world.changed();
}
world.sandbox.window.location.hash = '#realm'; world.classes.add('globe-wide'); world.listeners.hashchange();
assert(!world.running && world.canvas.hidden, 'The displayed Atlas hides the serpent while data-page remains home');
world.classes.delete('globe-wide'); world.changed();
assert(world.running && !world.canvas.hidden, 'Closing the Atlas restores the serpent even when #realm remains in the address');
let arrival = headOf(world.step());
assert(arrival.x > 700 && arrival.y > 700, 'The return starts a fresh visible arrival rather than resuming an old hidden route');
world.sandbox.window.location.hash = ''; world.listeners.hashchange();
for (const page of ['index', 'theory', 'enchant', 'skins', 'pets']) {
  world.document.body.dataset.page = page; world.document.body.dataset.home = 'cards'; world.changed();
  assert(!world.running && world.canvas.hidden && world.front.hidden, page + ' stops both layers');
  world.document.body.dataset.page = 'home'; world.document.body.dataset.home = 'ring'; world.changed();
  arrival = headOf(world.step());
  assert(world.running && !world.canvas.hidden && arrival.x > 700 && arrival.y > 700,
    'Returning from ' + page + ' brings a visible serpent back to the home sky');
}
world.document.hidden = true; world.listeners.visibilitychange();
assert(!world.running, 'Background tabs stop the frame loop');
world.document.hidden = false; world.listeners.visibilitychange();
world.media.matches = true; world.motionChanged();
assert(!world.running && !world.canvas.hidden, 'Reduced motion retains a static serpent');
const still = scene({ reducedMotion: true });
assert(!still.running && headOf(still.step()), 'Initial reduced motion works without scheduling frames');
const phone = scene({ width: 390, height: 844, wheel: false });
for (let i = 0; i < 60 * 10; i++) phone.step();
assert(phone.running, 'The list layout works without a planet');

const efficient = scene({ svg: true });
for (let i = 0; i < 60 * 100; i++) efficient.step();
for (let i = 0; i < 1800 && !efficient.front.pictures.length; i++) efficient.step();
assert(efficient.front.pictures.length, 'The performance scenario reaches a module coil');
const cacheBefore = efficient.metrics.outlineCanvases;
efficient.event('pointerover', { x: 100, y: 350 }, efficient.modules[0]);
const samplesBefore = efficient.metrics.svgSamples;
efficient.animateContours();
for (let i = 0; i < 60; i++) {
  // ResizeObserver and CSS-state notifications can arrive on every hover frame.
  efficient.resize(); efficient.changed(); efficient.step();
}
const sampled = efficient.metrics.svgSamples - samplesBefore;
assert(sampled <= 96 * 2 * 34, 'Hover geometry stays within two active contours at 30 samples per second');
assert(efficient.metrics.outlineCanvases - cacheBefore <= 2, 'Hover reuses the warm outline cards');
assert.equal(efficient.metrics.outlineDraws, efficient.metrics.outlineCanvases * 4,
  'The four shared silhouettes are only composed when an outline card is first built');
console.log('Home snake: shared outline, sword cursor, patient reactions, streamers, return navigation and hover budget pass.');
console.log(`Hover stress: ${sampled} SVG point samples for 60 observer notifications; ${efficient.metrics.outlineCanvases - cacheBefore} new outline cards.`);
