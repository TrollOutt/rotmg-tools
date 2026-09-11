'use strict';
const assert = require('assert/strict');
const P = require('../web/progression');
const raw = require('../data/TheoryCraft/theorycraft.json');
const index = require('../data/Index/index.json');
const wiki = require('../data/Index/wiki.json');
const harness = require('./theory-harness');

// An explicit fixture catches accidental traversal into portals, summoned
// bosses, unknown drops, or a similarly named item without an exact join.
const records = [
  { id: 'place:Forest', kind: 'place', name: 'Forest', rank: 'Rookie',
    in: [['was seen in', 'enemy:Sprite']], setTier: ['item:Forest set staff'] },
  { id: 'portal:Cave', kind: 'portal', name: 'Cave' },
  { id: 'portal:Endgame', kind: 'portal', name: 'Endgame' },
  { id: 'enemy:Sprite', kind: 'enemy', name: 'Sprite' },
  { id: 'enemy:Boss', kind: 'enemy', name: 'Boss' },
  { id: 'enemy:Final', kind: 'enemy', name: 'Final' },
  ...['Starter', 'Forest staff', 'Cave staff', 'Final staff', 'Unknown staff', 'Final ring', 'Forest set staff'].map(name => ({ id: 'item:' + name, kind: 'item', name }))
];
const ids = records.map(r => r.id);
const pages = records.map(r => [r.name.toLowerCase().replace(/ /g, '-'), r.name]);
const fixtureIndex = { records, views: { theory: { items: ids.filter(id => id.startsWith('item:')) } } };
const fixtureWiki = {
  ids, pages, page: ids.map((_, n) => [n, n]), dungeon: [[1, 4], [2, 5]],
  drop: [[3, 7], [4, 8], [5, 9], [5, 11], [3, 2]], spawn: [[3, 5], [5, 3]]
};
const template = raw.items.find(i => i.name === 'Energy Staff');
assert(template);
const items = ['Starter', 'Forest staff', 'Cave staff', 'Final staff', 'Unknown staff'].map((name, n) => ({
  ...template, name, tier: n, shots: [{ low: (n + 1) * 20, high: (n + 1) * 20, reach: 8 }]
}));
items.push({ ...template, name: 'Forest set staff', tier: 0,
  labels: ((template.labels || '') + ',ST').replace(/^,/, ''),
  shots: [{ low: 15, high: 15, reach: 8 }] });
items.push({ name: 'Final ring', hand: 'ring', slot: 9, worn: { ATT: 100 }, set: 'Final set' });
const cat = P.catalogue(fixtureIndex, fixtureWiki, items);
const personal = { version: 1, mode: 'personal', zones: ['place:Forest'] };
assert(P.allows(cat, personal, 'Starter'));
assert(P.allows(cat, personal, 'Forest staff'));
assert(P.allows(cat, personal, 'Forest set staff'), 'Index-resolved biome ST gear must be available directly');
assert(!P.allows(cat, personal, 'Cave staff'));
assert(!P.allows(cat, personal, 'Final staff'), 'Biome must not unlock a dropped portal or summoned boss');
assert(!P.allows(cat, personal, 'Unknown staff'));
assert(!P.allows(cat, null, 'Starter'), 'Setup is required');
assert(P.allows(cat, { ...personal, mode: 'best' }, 'Unknown staff'));
assert(P.allows(cat, { ...personal, zones: ['dungeon:cave'] }, 'Cave staff'));
assert(!P.allows(null, personal, 'Forest staff'), 'Missing loot data must fail closed');
assert.equal(P.normalize({ version: 0, mode: 'personal', zones: ['place:Forest'] }, cat), null);
assert.equal(P.normalize({ ...personal, zones: ['removed-zone'] }, cat), null);
assert.equal(P.normalize({ ...personal, zones: {} }, cat), null);
assert.equal(P.normalize({ ...personal, zones: ['place:Forest'] }, cat), null, 'Old biome-only profiles must repeat setup');
assert.deepEqual(P.normalize({ ...personal, zones: ['dungeon:cave', 'dungeon:cave', 'unknown'] }, cat),
  { version: 3, mode: 'personal', selection: 'manual', difficulty: null,
    zones: ['dungeon:cave'], biomeRanks: ['Rookie'] });

const testData = { ...raw, items, enchants: [], sets: [{ name: 'Final set', pieces: ['Final staff', 'Final ring'], steps: { 2: { ATT: 200 } } }] };
const t = harness({}, testData, false);
const state = t.fresh('Wizard');
state.scope = 'gear'; state.gear.weapon.name = 'Final staff';
t.use(state); t.progression(cat, personal);
const goal = t.GOALS.find(g => g.id === 'dps');
assert(goal);
assert(t.searchItems('weapon', state.klass, state).some(i => i.name === 'Forest staff'), 'Unavailable stronger gear must not prune reachable gear');
const result = t.optimise(state, goal);
assert.equal(result.state.gear.weapon.name, 'Forest staff');
assert.equal(result.state.gear.ring.name, null, 'Set search must not insert inaccessible pieces');
assert.equal(state.gear.weapon.name, 'Final staff', 'Search must not mutate its input');
const lifeState = t.fresh('Wizard');
lifeState.scope = 'gear';
t.use(lifeState); t.progression(cat, personal);
const lifeGoal = t.GOALS.find(g => g.id === 'stat:hp');
assert(lifeGoal);
assert.equal(t.optimise(lifeState, lifeGoal).state.gear.weapon.name, 'Forest staff',
  'A stat-neutral slot must prefer the highest reachable tier instead of staying at T0');
state.locked.weapon = true;
assert.equal(t.optimise(state, goal).state.gear.weapon.name, 'Final staff', 'Owned locked gear survives');
state.locked.weapon = false;
t.progression(cat, null);
assert.throws(() => t.optimise(state, goal), /Set up your progression/);
t.progression(null, personal);
assert.throws(() => t.optimise(state, goal), /Set up your progression/);
t.progression(cat, { ...personal, mode: 'best' });
assert(t.itemsFor('weapon', state.klass).some(i => i.name === 'Unknown staff'));
t.progression(cat, personal);
assert(!t.itemsFor('weapon', state.klass).some(i => i.name === 'Unknown staff'));

// The shipped data should retain separate late-game destinations and exact
// links, and every known source must point at a selectable place.
const ratings = require('fs').readFileSync(require('path').join(__dirname, '../data/Fame/dungeon-pages.txt'), 'utf8');
const shipped = P.catalogue(index, wiki, raw.items, require('../web/realmeye-data.json'), ratings);
for (const id of ['dungeon:pirate-cave', 'dungeon:oryx-s-sanctuary', 'dungeon:the-shatters', 'place:Sprite Forest']) {
  assert(shipped.zones.some(z => z.id === id), 'Missing place: ' + id);
}
const knownZones = new Set(shipped.zones.map(z => z.id));
for (const sources of shipped.sources.values()) for (const id of sources) assert(knownZones.has(id));
const beach = { ...personal, zones: ['biome:beach'] };
assert(P.allows(shipped, beach, 'Comet Staff'), 'Rookie loot must include explicit common tier drops');
assert(!P.allows(shipped, beach, 'Staff of the Cosmic Whole'), 'Rookie zone must not unlock top tiers');
assert(!P.allows(shipped, beach, 'Comet Staff (SB)'), 'Generic tiers must not grant soulbound copies');
assert(shipped.zones.some(z => z.id === 'biome:beach' && z.rank === 'Rookie'));
const ratedProfile = n => ({ version: 3, mode: 'personal', selection: 'difficulty', difficulty: n,
  zones: [], biomeRanks: ['Rookie'] });
for (let n = 1; n <= 10; n += 0.5) {
  const saved = P.normalize(ratedProfile(n), shipped);
  assert(saved && saved.zones.length);
  const expected = shipped.zones.filter(z => z.kind === 'dungeon' && z.difficulty && z.difficulty <= n).map(z => z.id);
  assert.deepEqual(saved.zones, expected);
  assert.deepEqual(P.normalize(JSON.parse(JSON.stringify(saved)), shipped), saved, 'Reload must preserve difficulty');
  if (n > 1) assert(P.forDifficulty(shipped, n - 0.5).every(id => saved.zones.includes(id)), 'Lower levels stay included');
}
for (const n of [0, 11, 3.25, '4', null]) assert.equal(P.normalize(ratedProfile(n), shipped), null);
const excludedProfile = P.normalize({ ...ratedProfile(2.5), excluded: ['dungeon:sprite-world', 'unknown'] }, shipped);
assert(!excludedProfile.zones.includes('dungeon:sprite-world'), 'A manually removed dungeon stays excluded');
assert.deepEqual(excludedProfile.excluded, ['dungeon:sprite-world']);
assert.deepEqual(P.normalize(JSON.parse(JSON.stringify(excludedProfile)), shipped), excludedProfile, 'Exclusions survive reload');
assert(P.forDifficulty(shipped, 2).includes('dungeon:pirate-cave'));
assert(!P.forDifficulty(shipped, 2).includes('dungeon:sprite-world'));
assert(P.forDifficulty(shipped, 2.5).includes('dungeon:sprite-world'));
assert(!P.forDifficulty(shipped, 6).includes('dungeon:secluded-thicket'));
assert(P.forDifficulty(shipped, 6.5).includes('dungeon:secluded-thicket'));
assert(!P.forDifficulty(shipped, 2).includes('dungeon:the-shatters'));
assert(P.forDifficulty(shipped, 10).includes('dungeon:the-shatters'));
assert(!P.forDifficulty(shipped, 10).includes('dungeon:beachzone'), 'Unknown difficulty is never inferred');
assert(P.normalize({ ...ratedProfile(2), selection: 'manual', zones: ['dungeon:beachzone', 'dungeon:the-shatters'] }, shipped), 'Manual selection overrides difficulty, including unrated dungeons');
assert(!P.normalize(ratedProfile(1), shipped).zones.some(id => id.startsWith('place:')), 'Difficulty must not silently unlock biomes');
const rookieOnly = P.normalize(ratedProfile(1), shipped);
assert.deepEqual(rookieOnly.biomeRanks, ['Rookie']);
assert(!P.allows(shipped, rookieOnly, 'Crystal Mace'), 'Rare Adept biome loot is opt-in');
assert(!P.allows(shipped, rookieOnly, 'Cloak of the Deep'), 'Rare Veteran biome loot is opt-in');
const adept = P.normalize({ ...ratedProfile(1), biomeRanks: ['Rookie', 'Adept'] }, shipped);
assert(P.allows(shipped, adept, 'Crystal Mace'), 'Selecting Adept unlocks its direct biome UT loot');
assert(P.allows(shipped, adept, "Traveler's Trinket"),
  'Selecting Adept unlocks its direct biome ST loot');
assert(!P.allows(shipped, adept, 'Cloak of the Deep'), 'Adept does not silently unlock Veteran loot');
const veteran = P.normalize({ ...ratedProfile(1), biomeRanks: ['Veteran'] }, shipped);
assert.deepEqual(veteran.biomeRanks, ['Veteran'], 'Rookie can be deselected after the initial default');
assert(P.allows(shipped, veteran, 'Cloak of the Deep'), 'Selecting Veteran unlocks its direct biome UT loot');
assert(P.allows(shipped, veteran, 'Electric Guitar'),
  'Selecting Veteran unlocks its direct biome ST loot');
assert(!P.allows(shipped, rookieOnly, 'Kiritsukeru'),
  'Biome ST loot stays unavailable until its biome rank is selected');
const noBiomes = P.normalize({ ...ratedProfile(1), biomeRanks: [] }, shipped);
assert.deepEqual(noBiomes.biomeRanks, [], 'All biome ranks may be deselected');
assert(!P.allows(shipped, noBiomes, 'Quiver of Thunder'), 'Deselected Rookie loot stays unavailable');
const early = P.normalize(ratedProfile(2.5), shipped);
const highestReachableTier = hand => Math.max(...raw.items
  .filter(item => item.hand === hand && Number.isFinite(item.tier) && P.allows(shipped, early, item.name))
  .map(item => item.tier));
assert(highestReachableTier('weapon') >= 6, 'Early dungeon bosses must expose their listed weapon tiers');
assert(highestReachableTier('ability') >= 3, 'Early dungeon bosses must expose their listed ability tiers');
assert(highestReachableTier('armor') >= 6, 'Early dungeon bosses must expose their listed armor tiers');
assert(highestReachableTier('ring') >= 2, 'Early dungeon bosses must expose their listed ring tiers');
const difficulties = new Map(shipped.zones.filter(z => z.kind === 'dungeon').map(z => [z.name, z.difficulty]));
for (const [name, value] of [['Spider Den', 1.5], ['Snake Pit', 2.5], ['Haunted Cemetery', 4.5],
  ['Fungal Cavern', 7.5], ['The Trials of Cronus', 6.5], ['White Snake Invasion II', 7.5],
  ['The Void', 8.5], ["Oryx's Sanctuary", 9.5], ['The Shatters', 10]]) {
  assert.equal(difficulties.get(name), value, name + ' difficulty drifted from RealmEye dungeon directory');
}
console.log('Progression: exact loot joins, no portal/spawn leakage, setup gate, persistence validation, constrained optimization, sets, owned locks and mode switching verified.');
