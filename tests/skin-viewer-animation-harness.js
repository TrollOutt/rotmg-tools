'use strict';
const vm = require('vm'), assert = require('assert/strict');
const { sourceSlice } = require('./source-slice');
const { graph } = require('./skin-viewer-harness');
function run(source, moduleSource, state, clock = 1000, period = 600) {
  const slice = sourceSlice(source, 'web/skins/app.js'), calls = [];
  const page = { S: state, ATTACK_PERIOD_MS: period,
    performance: { now() { calls.push(['now', clock]); return clock; } },
    renderFrameState() { calls.push(['render', state.skin?.sequences.indexOf(state.seq), state.index, state.last]); } };
  let creations = 0;
  if (moduleSource) {
    vm.runInNewContext(moduleSource, page);
    const create = page.SkinViewerAnimation.createSequencePlayback;
    page.SkinViewerAnimation.createSequencePlayback = deps => { creations++; return create(deps); };
  }
  const factory = moduleSource ? 'const playback=SkinViewerAnimation.createSequencePlayback({getAttackPeriod:()=>attackPeriod()});' : '';
  const code = factory + slice('function isMoving(){', 'function classKit(){')
    + slice('function attackSpeedMultiplier(){', 'function select(s){')
    + slice('function current(){', 'function visibleSkins(){')
    + slice('function advance(){', 'function updateMovement(dt){');
  vm.runInNewContext(code + '\nglobalThis.api={sequence,current,advance,attackFrame,useSequence,syncActivity,attackSpeedMultiplier,attackPeriod,attackShotsPerSecond};', page);
  assert.equal(creations, moduleSource ? 1 : 0, 'One playback factory shared by all adapters');
  return { api: page.api, calls };
}
function exercise(source, moduleSource, skin) {
  const S = { skin, seq: null, index: 0, last: 0, facingRaw: 3, shooting: false, attackUntil: 0, attackStart: 0, attackSpeed: 1, keys: new Set() };
  const { api, calls } = run(source, moduleSource, S), out = [];
  const attempt = fn => { try { return ['ok', fn()]; } catch(e) { return ['throw', e.name, e.message]; } };
  const pool = skin?.sequences || [];
  const identity = (array, value) => { if (value === undefined) return -1; const i = array.indexOf(value); assert(i >= 0, 'Return the original object'); assert.strictEqual(value, array[i]); return i; };
  for (const set of [-1, 0, 1]) for (const action of [-1, 0, 1, 2, 3, NaN]) for (const dir of [-1, 0, 1, 2, 3, Infinity])
    out.push(identity(pool, api.sequence(action, dir, set)));
  for (const seq of [undefined, ...pool]) {
    S.seq = seq;
    for (const index of [-1, 0, 1, (seq?.frames.length || 0) - 1, seq?.frames.length || 0, Infinity, NaN]) {
      S.index = index;
      out.push(attempt(() => identity(skin?.frames || pool.flatMap(q=>q.frames), api.current())));
      out.push(attempt(() => { const ret = api.advance(); assert.equal(ret, undefined); return S.index; }));
    }
    for (const speed of [.25, 1, 4, 0, NaN, Infinity, -Infinity]) {
      S.attackSpeed = speed;
      out.push([api.attackSpeedMultiplier(), api.attackPeriod(), api.attackShotsPerSecond()]);
      for (const now of [-1, 0, 149, 150, 299, 300, 599, 600, 601, Infinity, NaN]) {
        S.index = 1;
        out.push(attempt(() => { const ret = api.attackFrame(now); assert.equal(ret, undefined); return S.index; }));
      }
    }
  }
  S.seq = pool[0]; S.index = 3; S.attackSpeed = 1;
  for (const shooting of [false, true]) for (const until of [0, 999, 1001, Infinity, NaN]) for (const keys of [[], ['ArrowUp'], ['KeyD']]) {
    S.shooting = shooting; S.attackUntil = until; S.keys = new Set(keys);
    for (const reset of [false, true]) {
      api.syncActivity(1000, reset);
      out.push([identity(pool, S.seq), S.index, S.last]);
    }
  }
  return graph({ out, calls });
}

function limits(source, moduleSource) {
  const trace = [], out = [];
  const attempt = fn => { try { return ['ok', fn()]; } catch(e) { return ['throw', e.name, e.message]; } };
  const frames = [false, true, false, true].map((value, i) => ({ get spriteAvailable() { trace.push(['sprite', i]); return value; } }));
  const S = { seq: { actionRaw: 2, frames }, index: 0, attackStart: 0,
    get attackSpeed() { trace.push(['speed']); return 1; } };
  for (const period of [600, 0, -100, Infinity, -Infinity, NaN]) {
    const { api } = run(source, moduleSource, S, 1000, period);
    for (const start of [-Infinity, -100, 0, 1000, Infinity, NaN]) for (const now of [-Infinity, -1, 0, 1000, Infinity, NaN]) {
      S.attackStart = start; S.index = 1;
      out.push(attempt(() => { api.attackFrame(now); return S.index; }));
    }
    S.index = 1;
    out.push(attempt(() => { api.advance(); return S.index; }));
    out.push(attempt(() => api.current() === frames[S.index]));
  }
  for (const seq of [null, undefined, {}, { actionRaw: 2 }, { actionRaw: 2, frames: [] }]) {
    const { api } = run(source, moduleSource, S);
    S.seq = seq; S.index = 3;
    out.push(attempt(() => api.current()));
    out.push(attempt(() => { api.advance(); return S.index; }));
    out.push(attempt(() => { api.attackFrame(1000); return S.index; }));
  }
  return graph({ out, trace });
}
module.exports = { run, exercise, limits };
