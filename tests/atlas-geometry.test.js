'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { names, makeApi, cases, project } = require('./atlas-geometry-harness');
const { graph } = require('./atlas-data-harness');
const { createProjection } = require('../web/atlas-geometry');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('tools/atlas-viewer.html'), moduleSource = read('web/atlas-geometry.js');
const frozen = require('./atlas-geometry-corpus.json');

for (const newline of ['\n', '\r\n']) {
  const text = source.replace(/\r\n/g, '\n').replace(/\n/g, newline);
  const moduleText = moduleSource.replace(/\r\n/g, '\n').replace(/\n/g, newline);
  cases().forEach((state, i) => {
    const before = graph(state);
    const result = project(text, moduleText, state);
    assert.equal(result.digest, frozen.hashes[i], `Exact coordinates and dependency call order: ${i}, ${JSON.stringify(newline)}`);
    assert.deepStrictEqual(graph(state), before, 'Camera, viewport and supplied orientation objects are not mutated');
    if (!i) assert.deepStrictEqual(result.sample, frozen.sample);
  });
}
const context = {};
vm.runInNewContext(moduleSource, context);
assert.equal(typeof context.AtlasGeometry.createProjection, 'function', 'Classic module loads without DOM globals');
const state = cases()[0], adapter = makeApi(source, moduleSource, state);
assert.deepStrictEqual(adapter.calls, [], 'Factory initialization performs no geometry reads');
const deps = { view: state.view, globe: adapter.context.globe, spin: adapter.context.spin,
  tilting: adapter.context.tilting, lean: adapter.context.lean, turning: adapter.context.turning,
  bulge: 0.5, flatEnough: 1.5 };
const pure = createProjection(deps);
assert.deepStrictEqual(Object.keys(pure), names);
for (const scale of [0.02, 2, 10]) {
  state.view.scale = scale;
  state.view.x += 37;
  state.spin = { sin: 0.6, cos: 0.8 };
  state.tilt = scale === 10;
  state.turn = true;
  const got = pure.place(103, 107, state.box);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(adapter.api.place(103, 107, state.box))), 'Current camera values are read at each call');
  assert.notStrictEqual(pure.place(103, 107, state.box), got, 'Projection results remain fresh objects');
}
assert(source.indexOf('/*ATLAS_GEOMETRY*/') < source.indexOf('AtlasGeometry.createProjection('));
console.log(`Atlas geometry: ${frozen.hashes.length} frozen profiles, LF/CRLF, live dependencies and DOM-free loading pass.`);
