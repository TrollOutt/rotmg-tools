'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('web/app.js');
const theory = read('web/theorycraft.js');
const engineSource = read('web/engine.js');
const i18nSource = read('web/i18n.js');
const realm = read('web/realm-map.js');
const newsSource = read('web/whats-new.js');
const skinsSource = read('web/skins/app.js');
const fichesSource = read('web/fiches-c.js');
const atlasSource = read('tools/atlas-viewer.html');

/* LOAD: expensive modules own one in-flight startup promise. */
assert(
  app.includes('if (famePageLoading) return famePageLoading;'),
  'LOAD: Fame must reuse an in-flight first-load promise'
);

assert(
  app.includes('if (!theoryScriptLoading) {')
    && app.includes('theoryScriptLoading = new Promise'),
  'LOAD: Theory script loading must be shared'
);

assert(
  app.includes('if (!indexScriptLoading) {')
    && app.includes('indexScriptLoading = new Promise'),
  'LOAD: Index script loading must be shared'
);

assert(
  theory.includes('if (startPromise) return startPromise;'),
  'LOAD: Theory start() must be idempotent while loading'
);

/* MEM/PERF: Theory animation loops stop off-page and resume on revisit. */
assert(
  theory.includes("const theoryOpen = () => document.body.dataset.page === 'theory';")
    && theory.includes('if (anyLeft && motionWanted() && theoryOpen())')
    && theory.includes('if (painting || !theoryOpen()) return;')
    && theory.includes('if (!theoryOpen()) {')
    && theory.includes('if (started) {')
    && theory.includes('resumeMotion();'),
  'MEM/PERF: Theory RAF loops must sleep off-page and resume on revisit'
);

assert(
  newsSource.includes('if (startPromise) return startPromise;'),
  'LOAD: Whats New init() must be idempotent while loading'
);

/* PERF: long calculator work yields even in a hidden tab. */
assert(
  /const yieldToUi\s*=\s*\(\)\s*=>\s*new Promise\(resolve => setTimeout\(resolve,\s*0\)\)/.test(app),
  'PERF: calculator chunks must yield through a timer rather than RAF'
);

/* PERF: item optimization yields inside a beam level, not only between levels. */
assert(
  app.includes('const optimizerBreathe = budgetedYield(12);')
    && app.includes('await optimizerBreathe();'),
  'PERF: item optimizer candidate expansion must respect the UI compute budget'
);

/* LOAD: Atlas is lazy and requested only once. */
assert(
  app.includes('if (atlasAsked) return;')
    && app.includes('atlasAsked = true;'),
  'LOAD: Atlas lazy loading must be one-shot'
);

/* MEM/PERF: Atlas owns at most one render loop and stops when hidden. */
assert(
  realm.includes('if (active && grid && !frame)')
    && realm.includes('if (!active && frame) { cancelAnimationFrame(frame); frame = 0; }'),
  'MEM: Atlas render loop must start once and stop when inactive'
);

/*
 * PERF:
 * Full Atlas drawing must not scale linearly with 120/144/240 Hz monitors.
 * The simulation has its own fixed clock; this only caps presentation.
 */
assert(
  atlasSource.includes("pace = said.pace === 'still'")
    && /\?\s*Infinity\s*:\s*12/.test(atlasSource),
  'PERF: active Atlas rendering must cap high-refresh displays'
);

/* MEM/PERF: embedded Atlas owns no RAF while still or backgrounded. */
assert(
  atlasSource.includes('let frameClock = 0;')
    && atlasSource.includes('return !document.hidden && pace !== Infinity;')
    && atlasSource.includes('if (!frameClock && frameWanted()) frameClock = requestAnimationFrame(frame);')
    && atlasSource.includes('if (frameClock) cancelAnimationFrame(frameClock);')
    && atlasSource.includes('if (frameWanted()) startFrame();')
    && atlasSource.includes('else stopFrame();')
    && atlasSource.includes('if (!frameWanted()) { last = now; return; }'),
  'MEM/PERF: embedded Atlas RAF must stop while still or backgrounded'
);

/* MEM/NET: the host owns visitor polling when Atlas is embedded. */
assert(
  atlasSource.includes('(function countVisitors() {')
    && atlasSource.includes('if (bare) return;'),
  'MEM/NET: embedded Atlas must not duplicate the host visitor heartbeat'
);

/* MEM: same-origin fetch tracking cannot retain a hung request forever. */
assert(
  app.includes('const token = { at: performance.now(), expiry: 0 };')
    && app.includes('clearTimeout(token.expiry);')
    && app.includes('token.expiry = setTimeout(drop, WAIT_MOST);'),
  'MEM: fetch tracking tokens must expire at the navigation rescue budget'
);

/* MEM: leaving Skin Viewer tears its integrated instance down. */
assert(
  app.includes("if (page === 'skins')")
    && app.includes('window.SkinViewer.unmount();'),
  'MEM: leaving Skin Viewer must unmount it'
);

/* MEM/PERF: Skin Viewer owns one RAF and releases it while inactive. */
assert(
  skinsSource.includes('let previous=performance.now(),animationFrame=0;')
    && skinsSource.includes('if(!active)return;')
    && skinsSource.includes('if(active&&!animationFrame)')
    && skinsSource.includes('if(animationFrame){cancelAnimationFrame(animationFrame);animationFrame=0}')
    && skinsSource.includes('}else startLoop();'),
  'MEM/PERF: Skin Viewer render loop must stop when inactive and restart once'
);


/*
 * MEM/PERF:
 * fiche projectile simulations cache geometry instead of forcing layout on
 * every animation frame, and the RAF disappears while the canvas is offscreen.
 */
assert(
  fichesSource.includes('const fitSim = width =>')
    && fichesSource.includes("typeof ResizeObserver === 'function'")
    && /fitSim\s*\(\s*entry\.contentRect\.width\s*\)/.test(fichesSource)
    && fichesSource.includes("typeof IntersectionObserver === 'function'")
    && /simVisible\s*=\s*Boolean\s*\(/.test(fichesSource)
    && fichesSource.includes('stopSimFrame();')
    && fichesSource.includes('scheduleSimFrame();'),
  'MEM/PERF: fiche simulations must cache geometry and sleep offscreen'
);

/*
 * PERF: low-rate fiche skin animation must not poll at display refresh rate.
 */
assert(
  fichesSource.includes('let skinTimer = 0;')
    && fichesSource.includes('setTimeout(')
    && fichesSource.includes('tickSkin,')
    && fichesSource.includes('skinVisibilityObserver')
    && fichesSource.includes('const setAttackFrames = [];'),
  'MEM/PERF: fiche skin animation must use its real cadence and sleep offscreen'
);

/*
 * PERF: Theory must reuse immutable animation frame lists and obtain animated
 * duel geometry from ResizeObserver rather than forcing a layout read per RAF.
 */
assert(
  theory.includes('const targetFrameRuns =')
    && theory.includes('new WeakMap();')
    && theory.includes('let duelMeasureObserver = null;')
    && theory.includes('entry.contentRect')
    && theory.includes('duelMeasure.wide'),
  'MEM/PERF: Theory animation metadata and duel geometry must stay cached'
);

/*
 * PERF: repeated probability questions reuse finished distributions.
 */
assert(
  engineSource.includes('const DISTRIBUTION_CACHE_MAX = 256;')
    && engineSource.includes('const distributionCacheByData = new WeakMap();')
    && engineSource.includes('function distributionForUncached(')
    && engineSource.includes('return cloneDistributionResult('),
  'PERF: enchant distributions must retain a bounded cross-call cache'
);

/*
 * PERF: the i18n observer localizes newly inserted trees. It must not subscribe
 * to mutation classes its callback does not consume.
 */
assert(
  /watch\.observe\(\s*root,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\s*\)/s.test(i18nSource),
  'PERF: i18n observer must watch inserted trees only'
);


/*
 * PERF: fiche simulation scenery is static and must stay cached between
 * projectile frames.
 */
assert(
  fichesSource.includes("const simBackdrop =")
    && fichesSource.includes("const paintSimBackdrop = (")
    && fichesSource.includes("pen.drawImage(")
    && fichesSource.includes("simBackdrop,"),
  'PERF: fiche simulations must cache their static canvas backdrop'
);

/*
 * PERF: Theory film sprites may be checked each RAF, but unchanged frames
 * must not trigger another style invalidation.
 */
assert(
  theory.includes('lastFrame: -1')
    && theory.includes('if (film.lastFrame !== frame)')
    && theory.includes('film.lastFrame = frame;'),
  'PERF: Theory films must only write style when their frame changes'
);

/*
 * PERF: Skin Viewer resize storms collapse to one expensive stage fit per
 * animation frame.
 */
assert(
  skinsSource.includes('let fitStageFrame=0;')
    && skinsSource.includes('function scheduleFitStage()')
    && skinsSource.includes('new ResizeObserver(scheduleFitStage)'),
  'PERF: Skin Viewer stage fitting must be coalesced'
);


/*
 * PERF: high-refresh displays must not multiply the cost of small preview
 * animations.
 */
assert(
  fichesSource.includes('const SIM_FRAME_MIN_MS =')
    && fichesSource.includes('1000 / 72')
    && theory.includes('const FILM_FRAME_MIN_MS =')
    && theory.includes('const DUEL_FRAME_MIN_MS ='),
  'PERF: preview animations must stay bounded on high-refresh displays'
);

/*
 * PERF: Theory target animation does no DOM work while its page is inactive.
 */
assert(
  /targetClock\s*=\s*setInterval\(\(\)\s*=>\s*\{[\s\S]*?!theoryOpen\(\)[\s\S]*?!motionWanted\(\)/.test(theory),
  'MEM/PERF: Theory target interval must sleep off-page'
);



/*
 * PERF: Atlas canvas geometry is owned by ResizeObserver rather than queried
 * from every animation frame.
 */
assert(
  atlasSource.includes('const atlasCssSize = {')
    && atlasSource.includes("typeof ResizeObserver === 'function'")
    && atlasSource.includes('atlasSizeObserver.observe(canvas);')
    && atlasSource.includes('atlasSizeObserver')
    && atlasSource.includes('atlasCssSize.w')
    && atlasSource.includes('atlasCssSize.h'),
  'PERF: Atlas must cache its CSS canvas geometry'
);

/*
 * MEM/PERF: a yielded Enchant build plan must not start after navigation or
 * after a newer calculator generation superseded it.
 */
assert(
  app.includes('const planGeneration =')
    && app.includes("document.body.dataset.page !== 'enchant'")
    && app.includes('state.runId !== planGeneration'),
  'MEM/PERF: stale Enchant build plans must stop before expensive work'
);

/*
 * PERF: the probability walk already knows the insertion position. Do not
 * scan picked[] with indexOf() again on every recursive unwind.
 */
assert(
  engineSource.includes('const pickedAt =')
    && engineSource.includes('insert(i);')
    && engineSource.includes('const removeAt = at =>')
    && engineSource.includes('removeAt(')
    && !engineSource.includes('picked.indexOf(index)'),
  'PERF: enchant walk must remove picked classes without a linear search'
);


/*
 * MEM/LOAD regression:
 * a failed Whats New fetch is retryable. Retrying must not attach another
 * document click/keydown pair.
 */
async function checkWhatsNewRetry() {
  const oldDocument = global.document;
  const oldFetch = global.fetch;

  const listeners = new Map();
  const newsScale = { innerHTML: '' };

  global.document = {
    addEventListener(type) {
      listeners.set(type, (listeners.get(type) || 0) + 1);
    },
    getElementById(id) {
      if (id === 'newsScale') return newsScale;
      return null;
    }
  };

  global.fetch = () => Promise.reject(new Error('offline for lifecycle test'));

  const modulePath = require.resolve('../web/whats-new.js');
  delete require.cache[modulePath];

  try {
    const news = require(modulePath);

    assert.equal(await news.init(null), false, 'first failed load remains retryable');
    assert.equal(await news.init(null), false, 'second failed load remains retryable');

    assert.equal(
      listeners.get('click'),
      1,
      'MEM: retry must not duplicate the document click listener'
    );

    assert.equal(
      listeners.get('keydown'),
      1,
      'MEM: retry must not duplicate the document keydown listener'
    );
  } finally {
    delete require.cache[modulePath];

    if (oldDocument === undefined) delete global.document;
    else global.document = oldDocument;

    if (oldFetch === undefined) delete global.fetch;
    else global.fetch = oldFetch;
  }
}

checkWhatsNewRetry()
  .then(() => {
    console.log('runtime lifecycle: ok');
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });


/*
 * PERF:
 * Theory's Search button keeps the exact synchronous optimiser for its
 * contract tests, while the browser drives the same work cooperatively.
 */
assert(
  theory.includes('function* optimiseSteps(')
    && theory.includes('async function runOptimiserStepsAsync(')
    && /yield;\s*(?:const|let)\s+\w+\s*=\s*scoreOf\(/.test(theory)
    && theory.includes('yield* optimiseSteps(trial, goal, null);')
    && theory.includes('await optimiseAsync(plain, aim, null, gather);')
    && theory.includes('await optimiseAsync(build, aim, null, gather);')
    && theory.includes('await alternativesOfAsync(got, gather, aim);'),
  'PERF: Theory optimizer must yield inside scored candidate work'
);
