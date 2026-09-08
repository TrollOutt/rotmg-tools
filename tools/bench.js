/*
 * What the page spends its time on.
 *
 *   Open the atlas (or any page of the site), then in the console:
 *
 *     fetch('/tools/bench.js').then(r => r.text()).then(s => (0, eval)(s));
 *     await BENCH.atlas();      // on web/assets/atlas/
 *     await BENCH.site();       // on web/
 *
 * It must be loaded with indirect eval, as above, so that it runs in the
 * page's own global scope: the atlas keeps view, want, size and the rest in
 * top-level const, which nothing outside that scope can reach.
 *
 * Two different questions, measured two different ways.
 *
 * The atlas is one long animation, so the question is what a frame costs and
 * which part of it. Every stage of the draw loop is a top-level function
 * declaration, which in a classic script means a property of window - so each
 * one can be wrapped in a clock without touching the page. The loop is then
 * driven by hand rather than by the browser: requestAnimationFrame is stood
 * down for the duration and frame() called with a made-up clock, because a
 * frame that waits for the display measures the display, and because a tab
 * that is not being looked at is not given frames at all.
 *
 * The site is not an animation - it is a page that opens things - so the
 * question there is what opening one costs and what it is carrying. That is
 * measured where it happens: the first time a page is asked for, which is
 * when it reads and parses its own megabytes.
 *
 * What this does NOT see, and what to hold against the numbers:
 *   - the GPU. A canvas call returns as soon as the work is queued, so a
 *     stage that is slow to composite reads as cheap here. The frame total
 *     is the honest ceiling; the stages are CPU only.
 *   - layout and paint of the ordinary DOM, which is why the site half
 *     compares whole frames with the animation on and off rather than
 *     trying to time CSS.
 *   - a phone. Everything here is whatever machine it is run on; the shape
 *     of the answer travels, the milliseconds do not.
 */
'use strict';
(function () {

const NAMES = [
  'warmAhead', 'keepInSight', 'unwindTurn',
  'drawSpace', 'drawOryxBehind',
  'groundFlat', 'groundGlobe', 'groundTilted',
  'stepLife', 'stepFolk', 'stepChat',
  'drawThings', 'drawLife', 'drawFolk', 'drawChat',
  'drawLandmarks', 'drawBeacons', 'drawNames',
  'stepSky', 'stepBirds', 'drawBirds', 'drawSky', 'drawOryxHands'
];

const spent = Object.create(null);

function arm() {
  for (const name of NAMES) {
    const was = window[name];
    if (typeof was !== 'function' || was.wrapped) continue;
    spent[name] = 0;
    const now = function () {
      const t0 = performance.now();
      try { return was.apply(this, arguments); }
      finally { spent[name] += performance.now() - t0; }
    };
    now.wrapped = was;
    window[name] = now;
  }
}
function disarm() {
  for (const name of NAMES) {
    if (window[name] && window[name].wrapped) window[name] = window[name].wrapped;
  }
}
const zero = () => { for (const name of NAMES) spent[name] = 0; };

/*
 * Frames, driven by hand.
 *
 * frame() re-arms itself, so rAF is stood down first or every call would
 * leave another one queued behind it; document.hidden is answered no for the
 * same length of time, because the loop's first act is to do nothing at all
 * when the tab is in the background and a benchmark tab often is.
 */
function drive(count, dt, each) {
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 0;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  const frames = [];
  let clock = performance.now();
  try {
    for (let i = 0; i < count; i++) {
      if (each) each(i);
      clock += dt;
      const t0 = performance.now();
      window.frame(clock);
      frames.push(performance.now() - t0);
    }
  } finally {
    delete document.hidden;
    window.requestAnimationFrame = raf;
    raf(window.frame);                   // and the page gets its loop back
  }
  return frames;
}

const sorted = xs => xs.slice().sort((a, b) => a - b);
const mid = xs => sorted(xs)[Math.floor(xs.length / 2)] || 0;
const p95 = xs => sorted(xs)[Math.floor(xs.length * 0.95)] || 0;
const sum = xs => xs.reduce((a, b) => a + b, 0);
const r2 = n => Math.round(n * 100) / 100;

/* One scene: put the view somewhere, warm it, then measure. */
function scene(name, set, count) {
  count = count || 90;
  set(0);
  drive(12, 16.7, null);                 // warm: chunks fetched, caches filled
  zero();
  const frames = drive(count, 16.7, set);
  const stages = [];
  for (const stage of NAMES) {
    if (!spent[stage]) continue;
    stages.push({ stage, msPerFrame: r2(spent[stage] / count) });
  }
  stages.sort((a, b) => b.msPerFrame - a.msPerFrame);
  const total = mid(frames);
  return {
    scene: name,
    frameMedianMs: r2(total),
    frameP95Ms: r2(p95(frames)),
    accountedMs: r2(sum(stages.map(s => s.msPerFrame))),
    stages
  };
}

const BENCH = {};

/* ---------------------------------------------------------------- *
 * The atlas                                                        *
 * ---------------------------------------------------------------- */
BENCH.atlas = async function () {
  if (typeof window.frame !== 'function') throw new Error('not the atlas page');
  const box = size();
  const home = homeView(box);
  const put = (scale, turn) => () => {
    view.x = want.x = home.x; view.y = want.y = home.y;
    view.scale = want.scale = scale;
    TUNE.turn = turn || 0;
  };
  arm();
  const out = [];
  try {
    out.push(scene('home — the view everyone lands on', put(home.scale, 0)));
    out.push(scene('home, panning', (() => {
      const at = put(home.scale, 0);
      return i => { at(); view.x = want.x = home.x + i * 3; };
    })()));
    out.push(scene('mid zoom (level 2)', put(2, 0)));
    out.push(scene('closest zoom (level 0)', put(10, 0)));
    out.push(scene('closest zoom, turned 30°', put(10, 30)));
    out.push(scene('home, turned 30° — what unwinding saves', put(home.scale, 30)));
  } finally {
    disarm();
  }
  const where = {
    canvas: box.w + '×' + box.h + ' css px, dpr ' + (window.devicePixelRatio || 1),
    levels: A.levels.length,
    chunksHeld: (window.chunkCache && window.chunkCache.size) || null,
    creatures: (typeof life !== 'undefined' && life.length) || null
  };
  console.table(out.map(o => ({ scene: o.scene, median: o.frameMedianMs, p95: o.frameP95Ms })));
  for (const o of out) { console.groupCollapsed(o.scene); console.table(o.stages); console.groupEnd(); }
  return { where, scenes: out };
};

/* ---------------------------------------------------------------- *
 * The site                                                         *
 * ---------------------------------------------------------------- */
/* Whole frames, with the drifting realms behind everything and without. */
function framesFor(seconds) {
  return new Promise(resolve => {
    const gaps = [];
    let last = 0, until = performance.now() + seconds * 1000;
    const tick = now => {
      if (last) gaps.push(now - last);
      last = now;
      if (now < until) requestAnimationFrame(tick); else resolve(gaps);
    };
    requestAnimationFrame(tick);
  });
}

BENCH.site = async function () {
  const toggle = document.getElementById('ambienceToggle');
  const was = toggle && toggle.getAttribute('aria-pressed') === 'true';
  const out = { where: location.hash || '#home' };

  if (toggle) {
    if (!was) toggle.click();
    out.animationsOn = summarise(await framesFor(3));
    toggle.click();
    out.animationsOff = summarise(await framesFor(3));
    if (was) toggle.click();
  }

  /*
   * What each page costs to open for the first time - which is when it reads
   * and parses whatever it is built on. Measured by asking for the page and
   * timing the call, since each tool loads its own data on first sight.
   */
  out.opening = [];
  for (const page of ['enchant', 'theory', 'index', 'fame', 'news']) {
    const t0 = performance.now();
    location.hash = page;
    await new Promise(r => setTimeout(r, 0));
    const blocking = performance.now() - t0;
    await new Promise(r => setTimeout(r, 1200));   // let its own loading settle
    out.opening.push({ page, blockingMs: r2(blocking) });
  }
  location.hash = '';

  out.transferred = performance.getEntriesByType('resource')
    .map(e => ({ name: e.name.split('/').slice(-1)[0], kb: Math.round(e.transferSize / 1024) }))
    .filter(e => e.kb > 40)
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 20);
  if (performance.memory) {
    out.heapMb = Math.round(performance.memory.usedJSHeapSize / 1048576);
  }
  console.table(out.opening);
  console.table(out.transferred);
  return out;
};

function summarise(gaps) {
  if (!gaps.length) return null;
  return { frames: gaps.length, medianGapMs: r2(mid(gaps)), p95GapMs: r2(p95(gaps)),
    fps: Math.round(1000 / mid(gaps)) };
}

window.BENCH = BENCH;
console.log('BENCH ready — await BENCH.atlas() on the atlas, await BENCH.site() on the site');

})();
