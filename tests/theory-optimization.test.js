'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const harness = require('./theory-harness');
const P = require('../web/progression');

const root = path.join(__dirname, '..');
const raw = require('../data/TheoryCraft/theorycraft.json');
const read = (...parts) =>
  fs.readFileSync(path.join(root, 'data', ...parts), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

const sources = {
  clientModText: read('Enchantment documents', 'client-enchantments.txt'),
  clientItemText: read('Items', 'client-items.txt'),
  clientArtifactText: read('Artifacts', 'client-artifacts.txt'),
  awakenText: read('Awakened Items', 'awakenedItems.txt')
};

const t = harness(sources, raw, true);

/* ------------------------------------------------------------------ *
 * Deterministic coordinate-ascent optimiser                           *
 * ------------------------------------------------------------------ */

for (const klass of ['Wizard', 'Archer', 'Warrior']) {
  for (const goalId of ['dps', 'stat:hp', 'stat:dex']) {
    const goal = t.GOALS.find(one => one.id === goalId);
    assert(goal, `THEORY-OPT-001 goal exists: ${goalId}`);

    const state = t.fresh(klass);
    const baseline = t.scoreOf(state, goal);

    const first = t.optimise(clone(state), goal);
    const second = t.optimise(clone(state), goal);

    assert(
      first.score >= baseline - 1e-9,
      `THEORY-OPT-001 ${klass}/${goalId}: search must not worsen its objective`
    );

    assert.equal(
      second.score,
      first.score,
      `THEORY-OPT-002 ${klass}/${goalId}: identical input gives identical score`
    );

    assert.deepEqual(
      second.state,
      first.state,
      `THEORY-OPT-002 ${klass}/${goalId}: identical input gives identical build`
    );

    assert.equal(
      second.looked,
      first.looked,
      `THEORY-OPT-002 ${klass}/${goalId}: identical input explores the same search`
    );

    assert(
      first.looked > 0 && first.looked < 10000,
      `PERF-THEORY-001 ${klass}/${goalId}: candidate evaluations stay inside budget (${first.looked})`
    );
  }
}

/* ------------------------------------------------------------------ *
 * Full catalogue search budget                                        *
 * ------------------------------------------------------------------ */

for (const one of raw.classes) {
  for (const goal of t.GOALS) {
    const result = t.optimise(clone(t.fresh(one.name)), goal);

    assert(
      result.looked > 0 && result.looked < 10000,
      `PERF-THEORY-002 ${one.name}/${goal.id}: full-catalogue search stays inside budget (${result.looked})`
    );
  }
}

/* ------------------------------------------------------------------ *
 * Locks are hard constraints                                          *
 * ------------------------------------------------------------------ */

{
  const state = t.fresh('Wizard');
  const candidates = t.searchItems('weapon', state.klass, state);
  const chosen = candidates.find(one => one.name !== state.gear.weapon.name);

  assert(chosen, 'THEORY-OPT-010 fixture needs an alternate Wizard weapon');

  state.gear.weapon = {
    name: chosen.name,
    slots: 4,
    ench: [null, null, null, null]
  };
  state.locked.weapon = true;

  const enchant = t.enchantsFor(
    chosen.name,
    state.gear.weapon.ench,
    0
  ).find(one => one.id);

  assert(enchant, 'THEORY-OPT-010 fixture needs a compatible enchantment');

  state.gear.weapon.ench[0] = enchant.id;
  state.locked['weapon:0'] = true;

  const goal = t.GOALS.find(one => one.id === 'dps');
  const result = t.optimise(clone(state), goal);

  assert.equal(
    result.state.gear.weapon.name,
    chosen.name,
    'THEORY-OPT-010 an item lock is a hard optimizer constraint'
  );

  assert.equal(
    result.state.gear.weapon.ench[0],
    enchant.id,
    'THEORY-OPT-011 an enchantment-slot lock is a hard optimizer constraint'
  );
}

/* ------------------------------------------------------------------ *
 * Multi-objective search                                              *
 * ------------------------------------------------------------------ */

{
  const state = t.fresh('Wizard');
  state.goals = ['dps', 'stat:hp'];
  state.share = { dps: 60, 'stat:hp': 40 };

  const aimA = t.aimOf(clone(state));
  const baseline = t.scoreOf(state, aimA);
  const first = t.optimise(clone(state), aimA);

  const aimB = t.aimOf(clone(state));
  const second = t.optimise(clone(state), aimB);

  assert(
    Number.isFinite(first.score),
    'THEORY-OPT-020 combined objective produces a finite score'
  );

  assert(
    first.score >= baseline - 1e-9,
    'THEORY-OPT-020 combined search must not worsen its own objective'
  );

  assert.equal(
    first.score,
    second.score,
    'THEORY-OPT-021 combined optimization is deterministic'
  );

  assert.deepEqual(
    first.state,
    second.state,
    'THEORY-OPT-021 combined optimization returns the same build'
  );

  const dps = t.scoreOf(
    first.state,
    t.GOALS.find(one => one.id === 'dps')
  );

  const hp = t.scoreOf(
    first.state,
    t.GOALS.find(one => one.id === 'stat:hp')
  );

  assert(
    Number.isFinite(dps) && dps > 0,
    'THEORY-OPT-022 combined result remains a valid damage build'
  );

  assert(
    Number.isFinite(hp) && hp > 0,
    'THEORY-OPT-022 combined result remains a valid survival build'
  );
}

/* ------------------------------------------------------------------ *
 * Progression monotonicity                                            *
 * ------------------------------------------------------------------ */

{
  const index = require('../data/Index/index.json');
  const wiki = require('../data/Index/wiki.json');
  const source = require('../web/realmeye-data.json');

  const realm = {
    biomes: Object.fromEntries(
      Object.entries(source.biomes).map(([key, one]) => [
        key,
        { id: one.id, slug: one.slug, rank: one.rank }
      ])
    ),
    creatures: Object.fromEntries(
      Object.entries(source.creatures).map(([key, one]) => [
        key,
        {
          groups: one.groups,
          detail: { drops: (one.detail || {}).drops || [] }
        }
      ])
    )
  };

  const catalogue = P.catalogue(
    index,
    wiki,
    raw.items,
    realm,
    read('Fame', 'dungeon-pages.txt')
  );

  let previous = new Set();

  for (let difficulty = 1; difficulty <= 10; difficulty += 0.5) {
    const current = new Set(
      P.forDifficulty(catalogue, difficulty)
    );

    for (const id of previous) {
      assert(
        current.has(id),
        `PROG-OPT-001 raising difficulty must not remove ${id}`
      );
    }

    for (const id of current) {
      const zone = catalogue.zones.find(one => one.id === id);

      assert(zone, `PROG-OPT-002 returned zone exists: ${id}`);
      assert.equal(
        zone.kind,
        'dungeon',
        `PROG-OPT-002 difficulty selector returns dungeons only: ${id}`
      );
      assert(
        Number.isFinite(zone.difficulty)
          && zone.difficulty >= 1
          && zone.difficulty <= difficulty,
        `PROG-OPT-002 ${id} must have an explicit rating within ${difficulty}`
      );
    }

    previous = current;
  }
}

/* ------------------------------------------------------------------ *
 * Alternatives: other whole builds, told apart by their four items    *
 * ------------------------------------------------------------------ */

{
  // The same two searches the page runs, sharing one table, then ranked.
  const searchWithAlternatives = (state, goal) => {
    t.use(state);
    const gather = new Map();
    const plain = t.prepareAccessible(t.bareOf(state));
    const a = t.optimise(plain, goal, null, gather);
    const b = t.optimise(state, goal, null, gather);
    const got = a.score >= b.score ? a : b;
    const ranked = t.alternativesOf(got, gather, goal);
    return { got, ranked, searched: a.looked + b.looked };
  };
  const dps = t.GOALS.find(one => one.id === 'dps');
  const base = t.fresh('Wizard');
  const run = searchWithAlternatives(clone(base), dps);
  const list = run.ranked.list;

  assert(list.length >= 3, 'THEORY-ALT-000 a Wizard damage search offers alternatives');
  assert.ok(list.length <= 5, 'THEORY-ALT-000 at most four alternatives are kept behind the answer');
  assert(list[0].score >= run.got.score - 1e-9,
    'THEORY-ALT-001 the first entry is the best build found');
  for (let i = 1; i < list.length; i++) {
    assert(list[i - 1].score >= list[i].score - 1e-9,
      'THEORY-ALT-009 alternatives are ranked from best to worst');
    assert.notEqual(list[i].key, list[0].key, 'THEORY-ALT-002 an alternative wears other gear than the best');
  }
  assert.equal(new Set(list.map(one => one.key)).size, list.length,
    'THEORY-ALT-003 no two entries share a gear signature');
  for (const one of list) {
    assert.equal(one.key, t.gearSignature(one.state), 'THEORY-ALT-003 the key is the four items worn');
  }

  // Enchantments are not what makes a build another build.
  const same = clone(list[0].state);
  for (const hand of ['weapon', 'ability', 'armor', 'ring']) same.gear[hand].ench = [null, null, null, null];
  assert.equal(t.gearSignature(same), list[0].key,
    'THEORY-ALT-004 changing only the enchantments keeps the same gear signature');
  const twice = new Map([[list[0].key, { key: list[0].key, score: list[0].score + 1, gear: {} }]]);
  assert.equal(t.alternativesOf(run.got, twice, dps).list.length, 1,
    'THEORY-ALT-004 the winner\'s own gear set, however enchanted, is never offered as an alternative');

  // Worn as they are, each alternative's enchantments are the ones that scored it.
  for (const one of list) {
    const worn = clone(base);
    worn.gear = clone(one.state.gear);
    t.use(worn);
    assert(Math.abs(t.scoreOf(worn, dps) - one.score) < 1e-6,
      'THEORY-ALT-010 wearing an alternative keeps its own enchantments and its own score');
  }

  const again = searchWithAlternatives(clone(base), dps).ranked.list;
  assert.deepEqual(again.map(one => one.key), list.map(one => one.key),
    'THEORY-ALT-008 the same question gives the same alternatives in the same order');

  // A kept item and a kept enchantment stay kept in every alternative.
  const kept = clone(list[0].state);
  kept.locked = { weapon: true, 'armor:0': true };
  const keptWeapon = kept.gear.weapon.name;
  const keptEnch = kept.gear.armor.ench[0];
  const heldRun = searchWithAlternatives(kept, dps).ranked.list;
  assert(heldRun.length >= 2, 'THEORY-ALT-005 a search with a kept item still offers alternatives');
  for (const one of heldRun) {
    assert.equal(one.state.gear.weapon.name, keptWeapon, 'THEORY-ALT-005 a kept item is in every alternative');
    if (one.state.gear.armor.name === kept.gear.armor.name) {
      assert.equal(one.state.gear.armor.ench[0], keptEnch, 'THEORY-ALT-005 a kept enchantment stays on its item');
    }
    assert.equal(one.state.locked.weapon, true, 'THEORY-ALT-005 the padlocks come back as they were');
    assert.equal(one.state.locked.ability, undefined, 'THEORY-ALT-005 and no padlock is added');
  }

  // A blacklisted item is never offered, in the answer or behind it.
  const banned = clone(base);
  banned.banned = { [list[0].state.gear.ability.name]: true };
  const banRun = searchWithAlternatives(banned, dps).ranked.list;
  for (const one of banRun) {
    assert.notEqual(one.state.gear.ability.name, list[0].state.gear.ability.name,
      'THEORY-ALT-006 a blacklisted item appears in no alternative');
  }

  // With sets left out of the search, no alternative wears a set piece.
  const noSets = clone(base);
  noSets.searchSets = false;
  const setRun = searchWithAlternatives(noSets, dps).ranked.list;
  for (const one of setRun) {
    for (const hand of ['weapon', 'ability', 'armor', 'ring']) {
      const item = raw.items.find(x => x.name === one.state.gear[hand].name);
      assert(!(item && item.set), 'THEORY-ALT-007 a filter the search obeys, its alternatives obey');
    }
  }

  // An alternative is another way to play, never the same way a tier worse.
  for (const [klass, goalId] of [['Wizard', 'dps'], ['Archer', 'dps'], ['Warrior', 'stat:hp']]) {
    const goal = t.GOALS.find(one => one.id === goalId);
    const state = t.fresh(klass);
    const ranked = searchWithAlternatives(clone(state), goal).ranked.list;
    for (const one of ranked.slice(1)) {
      for (const hand of ['weapon', 'ability', 'armor', 'ring']) {
        const item = raw.items.find(x => x.name === one.state.gear[hand].name);
        if (!item || !Number.isFinite(item.tier)) continue;
        const best = Math.max(...t.searchItems(hand, klass, one.state)
          .map(x => x.tier).filter(Number.isFinite));
        assert.equal(item.tier, best,
          'THEORY-ALT-013 ' + klass + ' ' + hand + ': an alternative wears the best tier on offer, not T' + item.tier);
      }
    }
  }

  // With nothing to offer, nothing is offered.
  assert.equal(t.alternativesOf(run.got, new Map(), dps).list.length, 1,
    'THEORY-ALT-011 an empty table gives the answer alone');
  const page = fs.readFileSync(path.join(root, 'web', 'theorycraft.js'), 'utf8');
  assert(page.includes('alternatives = ranked.list.length > 1 ?')
    && page.includes("if (!alternativesLive()) { box.hidden = true; box.innerHTML = ''; return; }")
    && !page.includes('data-alt-step'),
    'THEORY-ALT-011 the page draws no alternatives when there are none');

  // Logical budget: offering alternatives costs no more than the search did twice over.
  assert(run.ranked.looked <= run.searched * 2,
    'THEORY-ALT-012 alternatives stay within twice the search\'s own evaluations ('
      + run.ranked.looked + ' against ' + run.searched + ')');
}

console.log('theory optimization contract: ok');
