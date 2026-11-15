'use strict';
// ROT-B-03 / R6: the floor under availability.json, and its explicit override. Offline.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { floorProblem, checkFloor } = require('../tools/availability-floor.js');

const list = n => ({
  pages: { unreleased: { listed: n, records: n } },
  records: Object.fromEntries(Array.from({ length: n }, (_, i) => [`item:Made-up ${i}`, 'unreleased']))
});

assert.strictEqual(floorProblem(list(37)), '');
assert.match(floorProblem(list(3)), /lists 3 records \(floor 10\)/);
assert.match(floorProblem({ pages: { unreleased: { listed: 0, records: 0 } }, records: list(12).records }), /listed nothing/);

assert.strictEqual(checkFloor(list(37), {}), '');
assert.throws(() => checkFloor(list(0), {}), /ROTMG_ACCEPT_DATA_CHANGES=1/);
assert.match(checkFloor(list(0), { ROTMG_ACCEPT_DATA_CHANGES: '1' }), /accepted by ROTMG_ACCEPT_DATA_CHANGES/);

// The committed list is above the floor.
const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'Index', 'availability.json'), 'utf8'));
assert.strictEqual(floorProblem(committed), '');

console.log('availability floor: ok');
