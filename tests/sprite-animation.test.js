'use strict';
const assert = require('assert/strict');
const S = require('../web/sprite-animation');

const wizard = { '0/0': [0], '0/1': [1, 2, 3], '0/2': [4, 5], '2/0': [6], '2/1': [7, 8, 9],
  '2/2': [10, 11], '3/0': [12], '3/1': [13, 14, 15], '3/2': [16, 17] };

// The nearest pose a picture has.
assert.deepEqual(S.framesOf(wizard, 2, 2), [10, 11]);
assert.deepEqual(S.framesOf({ '0/0': [0], '0/2': [3, 4] }, 3, 2), [3, 4], 'No downward attack: the sideways one');
assert.deepEqual(S.framesOf({ '0/0': [7] }, 0, 1), [7], 'No walk: standing');
assert.deepEqual(S.framesOf(null, 0, 2), [0]);

// The client's sideways pictures face east; west is the same picture turned over.
assert.deepEqual(S.facingOf(1, 0), { facing: 0, flip: false });
assert.deepEqual(S.facingOf(-1, 0.2), { facing: 0, flip: true });
assert.deepEqual(S.facingOf(0.1, -1), { facing: 2, flip: false });
assert.deepEqual(S.facingOf(0.1, 1), { facing: 3, flip: false });

// An attack runs once over its own length: first frame at the shot, last as it ends.
const one = { vx: 3, vy: 0, phase: 0 };
S.startAttack(one, Math.PI, 0.4);
assert.equal(one.swing, 0.4);
assert.equal(one.swingFor, 0.4);
assert.deepEqual(S.pose(one, wizard), { frame: 4, flip: true, doing: 2 },
  'Faces its target (west) rather than the way it walks (east)');
one.swing = 0.15;
assert.equal(S.pose(one, wizard).frame, 5);
one.swing = 0.0001;
assert.equal(S.pose(one, wizard).frame, 5, 'Never past the last frame');
one.swing = 0;
assert.deepEqual(S.pose(one, wizard), { frame: 1, flip: false, doing: 1 }, 'Over: back to walking');
one.vx = 0;
assert.deepEqual(S.pose(one, wizard), { frame: 0, flip: false, doing: 0 }, 'And standing');

// A creature's attack lasts GameObject.ATTACK_PERIOD.
const beast = {};
S.startAttack(beast, 0);
assert.equal(beast.swingFor, S.ATTACK_PERIOD);
assert.equal(S.ATTACK_PERIOD, 0.3);
assert.equal(S.attackProgress({ swing: 0 }), null);
assert.equal(S.attackFrame([4, 5], 0), 4);
assert.equal(S.attackFrame([4, 5], 0.5), 5);

// A picture that keeps a left of its own is shown as it is, not turned over.
const left = { '0/2': [1], '1/2': [2] };
const facingLeft = { phase: 0 };
S.startAttack(facingLeft, Math.PI, 0.3);
assert.deepEqual(S.pose(facingLeft, left), { frame: 2, flip: false, doing: 2 });

console.log('Sprite animation: poses, facing, attack timing and its end, shared by the Atlas, Theory Crafting and the cards.');
