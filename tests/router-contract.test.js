'use strict';

const assert = require('assert');
const routes = require('../web/router-contract.js');

assert.deepEqual(routes.parse(''), { page: 'home', open: '' });
assert.deepEqual(routes.parse('#'), { page: 'home', open: '' });
assert.deepEqual(routes.parse('#/'), { page: 'home', open: '' });

assert.deepEqual(routes.parse('#index'), { page: 'index', open: '' });
assert.deepEqual(routes.parse('#/index'), { page: 'index', open: '' });
assert.deepEqual(
  routes.parse('#index?open=Venerable%20Doom%20Bow'),
  { page: 'index', open: 'Venerable Doom Bow' }
);

assert.deepEqual(
  routes.parse('#/index?open=Night%27s%20Soul'),
  { page: 'index', open: "Night's Soul" }
);

assert.deepEqual(
  routes.parse('#theory?open=Attack%20Bonus'),
  { page: 'theory', open: '' },
  'only Index owns the open route parameter'
);

assert.equal(routes.indexHash('Attack Bonus'), 'index?open=Attack%20Bonus');
assert.equal(routes.indexHash("Night's Soul"), "index?open=Night's%20Soul");
assert.equal(routes.indexHash('A/B? C'), 'index?open=A%2FB%3F%20C');

assert.equal(routes.indexHash(''), '');
assert.equal(routes.indexHash(' Attack Bonus'), '');
assert.equal(routes.indexHash('Attack Bonus '), '');
assert.equal(routes.indexHash(null), '');
assert.equal(routes.indexHash(undefined), '');

for (const id of [
  'Attack Bonus',
  "Night's Soul",
  'A/B? C',
  'Mana -any Tradeoff',
  'Ünicode test'
]) {
  const hash = routes.indexHash(id);
  assert(hash, `route produced for ${id}`);
  assert.deepEqual(
    routes.parse('#' + hash),
    { page: 'index', open: id },
    `index route round-trip for ${id}`
  );
}

console.log('router contract: ok');
