'use strict';
// Shared input tapes, not simulation code. Golden hashes were captured from
// the supplied standalone HTML's engine before integration.
const base = { hp: 100000, def: 43, spd: 57, lvl: 5, chases: 3, rspeed: 1 };
const scenarios = [];
for (const mode of ['solo', 'group', 'rails']) for (const hard of [false, true]) for (const seed of [42, 4294967295]) {
  scenarios.push({ name: `${mode}-${hard ? 'hard' : 'normal'}-${seed}`, seed, options: { ...base, mode, hard }, steps: 2500 });
}
scenarios.push({ name: 'stationary-defeat', seed: 42, options: { hp: 1450, chases: 3 }, steps: 1800, stationary: true });
scenarios.push({ name: 'hit-handicap', seed: 17, options: { ...base, maxHits: 3 }, steps: 1000, stationary: true });
scenarios.push({ name: 'hp-handicap', seed: 17, options: { hp: 1450, loseAt: .8, dmgMult: 1.5 }, steps: 1000, stationary: true });
scenarios.push({ name: 'special-gear', seed: 99, options: { hp: 760, cur: {}, gear: {
  nild: { id: 'blood', mode: 'start', at: 30 }, armor: { id: 'matrix', mode: 'auto', at: 70 },
  ring: { id: 'amulet', mode: 'manual', at: 20 }
} }, steps: 1800, stationary: true, gear: true });
function inputAt(i, stationary) {
  if (stationary) return [0, 0, 0, { pre: i < 180 }];
  const horizontal = Math.floor(i / 120) % 2 ? -1 : 1;
  const vertical = Math.floor(i / 90) % 2 ? -1 : 1;
  return [horizontal, vertical, i % 300 < 20 ? 1 : 0,
    { pre: i < 180, resetRot: i % 300 === 20, offset: i % 600 === 0 }];
}
function snapshots(Game, scenario) {
  const game = new Game(scenario.seed, scenario.options), out = [];
  for (let i = 0; i < scenario.steps; i++) {
    if (scenario.gear && i === 350) game.useSlot('ring');
    if (scenario.gear && i === 500) game.useSlot('armor');
    game.tick(...inputAt(i, scenario.stationary));
    if ([0, 59, 179, 299, 300, 599, 600, 899, 1799, 2399, scenario.steps - 1].includes(i)) {
      // Localised event strings and the RNG closure are not numerical state.
      out.push(JSON.parse(JSON.stringify(game, (key, value) => key === 'events' || key === 'rand' ? undefined : value)));
    }
  }
  return out;
}
module.exports = { scenarios, snapshots };
