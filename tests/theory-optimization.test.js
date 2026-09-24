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

console.log('theory optimization contract: ok');
