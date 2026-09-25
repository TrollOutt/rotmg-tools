'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('web/app.js');
const theory = read('web/theorycraft.js');
const realm = read('web/realm-map.js');
const newsSource = read('web/whats-new.js');
const skinsSource = read('web/skins/app.js');
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
