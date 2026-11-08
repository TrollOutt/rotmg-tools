'use strict';
/*
 * The Pet Fame Calculator's numbers against what the game and RealmEye say.
 *
 * The arithmetic (web/pet-fame-engine.js) has to reproduce RealmEye's own totals
 * for the feed power each stretch of levels takes, and its prices have to be the
 * ones written down in data/Pets/realmeye-pets.json, which the client's yard
 * upgraders agree with. The data the page draws with (web/pet-fame-data.js) has
 * to hold every pet skin and only real food.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const E = require(path.join(root, 'web', 'pet-fame-engine.js'));
const wiki = require(path.join(root, 'data', 'Pets', 'realmeye-pets.json'));
const D = vm.runInNewContext(fs.readFileSync(path.join(root, 'web', 'pet-fame-data.js'), 'utf8') + ';PetFameData');

/* RealmEye's table of the feed power each stretch takes, to within a point of rounding. */
const near = (got, want, what) => assert(Math.abs(got - want) <= 1.5, `${what}: ${Math.round(got)} is not ${want}`);
const t = wiki.feedPowerNeeded.wikiCumulative;
for (const [range, want] of Object.entries(t.ability1)) {
  if (range === 'total') continue;
  const [a, z] = range.split('-').map(Number);
  near(E.fpTo(0, a, z), want, 'ability 1 ' + range);
}
for (const [range, want] of Object.entries(t.ability2)) {
  if (range === 'total') continue;
  const [a, z] = range.split('-').map(Number);
  near(E.fpTo(1, a, z), want, 'ability 2 ' + range);
}
for (const [range, want] of Object.entries(t.ability3)) {
  if (range === 'total') continue;
  const [a, z] = range.split('-').map(Number);
  near(E.fpTo(2, a, z), want, 'ability 3 ' + range);
}

/* The prices are RealmEye's, and the yard's are the client's too. */
E.RARITY.forEach((name, k) => {
  assert.deepEqual(E.FEED[k], wiki.feedCost[name], 'feeding cost at ' + name);
  if (k < 4) assert.deepEqual(E.FUSE[k], wiki.fuseCost[name], 'fusing cost at ' + name);
  if (k > 0) assert.deepEqual(E.YARD[k], wiki.yardUpgrade[name], 'yard upgrade to ' + name);
});
assert.deepEqual(E.CAP, E.RARITY.map(n => wiki.abilityCap[n]));
assert.deepEqual(D.costs.feed, wiki.feedCost);
const client = require(path.join(root, 'data', 'Pets', 'pets.json')).yardUpgraders.filter(u => u.yardType);
for (const u of client) {
  const mine = E.YARD[u.yardType - 1];
  assert.equal(mine.fame, u.fame, 'yard fame for type ' + u.yardType);
  assert.equal(mine.gold, u.gold, 'yard gold for type ' + u.yardType);
}

/* A pet fed from an egg reaches the cap of each rarity in turn, and the third ability opens at Legendary. */
const road = E.road(0, [1, 1, 1], 3);
assert.equal(road.length, 5);
road.forEach((seg, k) => {
  assert.equal(seg.open, E.unlocked(k), 'abilities open at ' + E.RARITY[k]);
  assert(seg.fp > 0, 'the road has something to feed at ' + E.RARITY[k]);
});
assert.deepEqual([0, 1, 2, 3, 4].map(k => E.unlocked(k)), [1, 2, 2, 3, 3]);
// Aiming only at the first ability asks for no more than aiming at all three.
const first = E.road(0, [1, 1, 1], 1).reduce((s, g) => s + g.fp, 0), all = road.reduce((s, g) => s + g.fp, 0);
assert(first < all, 'maxing only the first ability costs less than maxing all three');
// And a level asks for the right rarity.
assert.deepEqual([1, 30, 31, 50, 51, 70, 71, 90, 91, 100].map(E.rarityOfLevel), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);

/* Every effect is mapped from level 1 to 100 and rises with the level. */
for (const name of E.ABILITIES) {
  for (const stat of E.EFFECT[name].stats) {
    assert.equal(stat[2].length, 6, name + ' ' + stat[0] + ' has a value at each of the six levels');
  }
  const low = E.effect(name, 1), high = E.effect(name, 100);
  assert.equal(low.length, high.length);
}
assert.equal(E.effect('Heal', 100)[0].value, 90, 'a level 100 Heal heals 90 HP');
assert.equal(E.effect('Heal', 1)[0].value, 10, 'a level 1 Heal heals 10 HP');

/* What the page draws with. */
// All but the client's 'Disabled Pet' placeholder, which has no rarity and no family.
const skins = require(path.join(root, 'data', 'Pets', 'pets.json')).skins.filter(s => s.rarity && s.family);
assert.equal(D.pets.list.length, skins.length, 'every pet skin of the client is on the page');
for (const p of D.pets.list) {
  assert(p.a.length === p.fw.length && p.a.length > 0, p.n + ' has frames');
  assert(['Common', 'Rare', 'Divine'].includes(p.r), p.n + ' has a look');
}
assert(D.foods.list.length > 100, 'the foods are there');
for (const f of D.foods.list) {
  assert(f.fp > 0, f.name + ' feeds something');
  assert(!/admin|test/i.test(f.name) && f.name !== 'Feed', f.name + ' is not a debug item');
}
const ambrosia = D.foods.list.find(f => f.name === 'Ambrosia');
assert.equal(ambrosia.fp, 5000);
assert.equal(ambrosia.gold, 1000);
for (const file of ['pets.png', 'foods.png']) assert(fs.existsSync(path.join(root, 'web', 'assets', 'pets', file)), file + ' is next to the page');

console.log('Pet Fame: the arithmetic reproduces RealmEye\'s totals; prices, yard, skins and food match the data.');

/* The cheapest Legendary: RealmEye's prices put together by hand for a 750 FP food, in fame. */
{
  const food = { fp: 750, gold: 0 };
  const items = fp => Math.ceil(fp / 750);
  // A Legendary egg needs only a Rare yard to hatch, and nothing fed for the full cap.
  const egg = E.cheapest(3, 'cap', 1, 0, 'fame', food);
  assert.strictEqual(egg.total, 525 + 3500, 'a Legendary egg costs the yard up to Rare');
  assert.strictEqual(egg.next, 0, 'a second Legendary egg costs nothing more');
  // Two Rare eggs, each fed 1 → 70 at Rare, fused in a Legendary yard.
  const rare = E.cheapest(2, 'cap', 1, 0, 'fame', food);
  assert.strictEqual(rare.yard, 525 + 3500 + 43750, 'fusing two Rares needs the Legendary yard');
  assert.strictEqual(rare.fuse, 7000);
  assert.strictEqual(rare.feed, 2 * items(E.fpTo(0, 1, 70)) * 175);
  assert.strictEqual(rare.levels[0], 70, 'two Rares at 70 give a Legendary at 70');
  assert.strictEqual(rare.levels.length, 3, 'the third ability opens at Legendary');
  assert.strictEqual(rare.cap, 90);
  // Unfed, the fusion's cap is the parents' first ability + 20: a weak Legendary.
  const unfed = E.cheapest(0, 'any', 1, 0, 'fame', food);
  assert.strictEqual(unfed.feed, 0);
  assert.strictEqual(unfed.fuse, 4 * 525 + 2 * 1750 + 7000, 'seven fusions from eight Common eggs');
  assert.strictEqual(unfed.cap, 21);
  // A yard already owned is not paid again.
  assert.strictEqual(E.cheapest(2, 'cap', 1, 3, 'fame', food).yard, 0);
  // Fed to 90: the levels before 70 are cheaper at Rare, so farming from Rare eggs beats the Legendary egg's feeding.
  const maxEgg = E.cheapest(3, 'max', 1, 3, 'fame', food), maxRare = E.cheapest(2, 'max', 1, 3, 'fame', food);
  assert.strictEqual(maxEgg.feed, items(E.fpTo(0, 1, 90)) * 625);
  assert(maxRare.next < maxEgg.next, 'two Rares fed to 70 then fused are cheaper to take to 90 than a Legendary egg');
}
