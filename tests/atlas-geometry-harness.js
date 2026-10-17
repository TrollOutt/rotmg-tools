'use strict';
const vm = require('vm');
const { sourceSlice } = require('./source-slice');
const { graph, digest } = require('./atlas-data-harness');

const names = ['roundWorld', 'onGlobe', 'offGlobe', 'place', 'fromScreen', 'seenRange', 'flatTile', 'toTile'];
function makeApi(source, moduleSource, state) {
  const calls = [];
  let tiltCall = 0, globeCall = 0;
  const tracked = (name, value) => state.trace && value ? new Proxy(value, {
    get(target, key) { calls.push([name, key]); return target[key]; }
  }) : value;
  const context = { view: state.view,
    globe() { calls.push('globe'); return state.radii ? state.radii[globeCall++ % state.radii.length] : 1250 * context.view.scale; },
    spin() { calls.push('spin'); return tracked('spin', state.spin); },
    tilting() { calls.push('tilting'); return state.tilts ? state.tilts[tiltCall++ % state.tilts.length] : state.tilt; },
    lean(box) { calls.push(['lean', box === state.box]); return tracked('lean', state.lean); },
    turning() { calls.push('turning'); return state.turn; }
  };
  context.view = tracked('view', state.view);
  if (moduleSource) vm.runInNewContext(moduleSource, context);
  vm.runInNewContext(sourceSlice(source, 'tools/atlas-viewer.html')(
    'const FLAT_ENOUGH = 1.5;', '/* ---------------- the pyramid ---------------- */')
    + ';this.api={' + names.join(',') + '};', context);
  return { api: context.api, calls, context };
}

// Compact inputs replayed against the immutable pre-extraction source snapshot.
function cases() {
  const rows = [];
  for (const scale of [0.02, 0.4, 8, 128, 0, -0, -1, NaN, Infinity]) {
    for (const mode of ['flat', 'turned', 'tilted']) {
      for (const box of [{ w: 1440, h: 1000 }, { w: 375, h: 667 }, { w: 0, h: 0 }, { w: 1 }]) {
        rows.push({ view: { x: 100.25, y: -70.5, scale }, box,
          spin: mode === 'flat' ? null : { sin: 0.6, cos: 0.8 },
          tilt: mode === 'tilted', turn: mode !== 'flat', lean: { sin: 0.6, cos: 0.8, h: box.h * 2.4 } });
      }
    }
  }
  rows.push(
    { ...rows[0], view: {}, trace: true },
    { ...rows[1], view: { x: -0, y: Infinity, scale: 2 }, trace: true },
    { ...rows[2], trace: true, tilts: [true, false, false, true], radii: [1, 500, Infinity, -0] },
    { ...rows[2], box: null },
    { ...rows[2], lean: { sin: 1, cos: 0, h: 0 } },
    { ...rows[2], view: { x: -300, y: 400, scale: 10 }, trace: true }
  );
  return rows;
}
function project(source, moduleSource, state) {
  const { api, calls } = makeApi(source, moduleSource, state), out = [];
  for (const [name, args] of [
    ['roundWorld', [state.box]],
    ...[-0, 1, -1, 1250 * state.view.scale * Math.PI, Infinity, NaN, undefined].flatMap(n => [
      ['onGlobe', [n, n]], ['offGlobe', [n, n]],
      ['place', [n, -n, state.box]], ['fromScreen', [n, -n, state.box]],
      ['flatTile', [n, -n, state.box]], ['toTile', [n, -n, state.box]]
    ]),
    ...[undefined, 0, -20, 80, NaN].map(pad => ['seenRange', [state.box, pad]]),
    ['fromScreen', [0, state.box?.h / 2 - state.lean.cos * state.lean.h / state.lean.sin, state.box]],
    ['place', [state.view.x, state.view.y + (state.lean.h - 1) / state.lean.sin / state.view.scale, state.box]]
  ]) {
    try { out.push([name, api[name](...args)]); }
    catch (error) { out.push([name, ['throw', error.name, error.message]]); }
  }
  return { digest: digest({ out, calls }), sample: graph(out.slice(0, 4)) };
}
module.exports = { names, makeApi, cases, project };
