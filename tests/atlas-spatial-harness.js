'use strict';
const vm = require('vm');
const { sourceSlice } = require('./source-slice');
const { digest } = require('./atlas-data-harness');

// Exercise the actual changed simulation functions, not a rewritten old engine.
// Unchanged world/loot/progression dependencies are deterministic test doubles.
// Full-corpus browser replay separately covers the real application adapters.
function simulation(source, moduleSource, markers, multiplier, seed, edge = false) {
  const events = [], random = [], states = [];
  let rng = seed >>> 0, serial = 0, tick = 0;
  const math = Object.create(Math);
  math.random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    const value = rng / 4294967296;
    random.push(value);
    return value;
  };
  const c = { Math: math, alive: [], folk: [], shots: [], sparks: [], litter: [],
    view: { scale: 10 }, SHOW_LIFE: 3, FOLK_BACK: 9, FOLK_HOLD: 0.78,
    DODGE_SEE: 3.2, DYING: 0.36, observedCombat: new Map(),
    HEAL_AT: vit => 1 + 0.12 * vit, MANA_AT: wis => 0.5 + 0.06 * wis,
    PACE_AT: speed => 4 + 5.6 * speed / 75, SHOTS_AT: dex => 1.5 + 6.5 * dex / 75,
    ensureCombat() {}, refile() {}, finishSpeech(one) { events.push(['speech', one.id]); },
    zoneOf: () => 1, zoneById: new Map([[1, {}]]),
    canStand: (x, y) => Math.abs(x) < 512 && Math.abs(y) < 512 && Math.floor(x) !== 24,
    walkable: (x, y) => c.canStand(x, y),
    atTile: x => ({ walled: Math.floor(x) === 24 }),
    pointBy: () => ({ x: (math.random() - 0.5) * 48, y: (math.random() - 0.5) * 48 }),
    distributedRoam: () => c.pointBy(), beaconFor: () => ({ x: 16, y: 0 }),
    graveFor(one) { events.push(['grave', one.id]); },
    speak(tag, one) { events.push(['speak', tag, one && one.id]); },
    sparePreyNear: () => true, usefulLootFor: () => null,
    reinforcementFor() { return null; },
    nearTo: () => c.alive,
    preyFor(one) {
      return c.alive.find(beast => beast.hp > 0 && !(beast.down > 0)
        && Math.hypot(beast.x - one.x, beast.y - one.y) < 26) || null;
    },
    hurtOf(shot, att, armour) {
      return Math.max(shot.low * 0.15,
        (shot.low + math.random() * (shot.high - shot.low)) * (0.5 + att / 50) - armour);
    },
    burst(beast) {
      events.push(['burst', beast.id]);
      beast.dying = 0; beast.down = 0.2 + math.random();
      c.sparks.push({ x: beast.x, y: beast.y, left: 0.5 + math.random() });
    },
    dropFrom(beast) { events.push(['drop', beast.id]); c.litter.push({ x: beast.x, y: beast.y, left: 1 }); },
    reward(one, beast) {
      events.push(['reward', one.id, beast.id]);
      one.kills++;
      // Mirrors the position-changing dependency that must invalidate the grid
      // during reverse projectile iteration, before the next hostile impact.
      one.x = edge ? 48 : (math.random() - 0.5) * 80; one.y = 0;
    },
    stepSparks(delta) { for (const s of c.sparks) s.left -= delta; },
    stepLitter(delta) { for (const bit of c.litter) bit.left -= delta; },
    balancePopulation() {
      if (tick % 11 === 3) {
        const beast = makeBeast(c.alive.length);
        c.alive.push(beast); events.push(['spawn', beast.id]);
      }
      if (tick % 17 === 9 && c.alive.length > 3) {
        const gone = c.alive.pop(); events.push(['remove', gone.id]);
      }
    }
  };
  const gun = { id: 'bolt', slot: 0, fast: 12, life: 1.5, reach: 18,
    low: 12, high: 18, hurt: 16, many: 2, fan: 9, motion: {}, flags: [] };
  function makeBeast(i) {
    return { id: 'b' + serial++, home: 1, x: (i % 16) * 4 - 32,
      y: Math.floor(i / 16) * 4 - 16, vx: 2, vy: 1, phase: 0,
      hp: 40, full: 40, down: 0, dying: 0,
      kind: { type: i % 3, def: 2, shots: [gun] } };
  }
  function makeFolk(i) {
    return { id: 'f' + serial++, x: (i % 8) * 6 - 24, y: Math.floor(i / 8) * 5,
      vx: 0, vy: 0, phase: 0, hp: 100, full: 100, mp: 100, mpFull: 100,
      down: 0, kills: 0, level: 1, cool: 0, spell: 0, name: 'kept',
      kind: { weapon: { shot: gun }, ability: { mp: 2, shot: gun } },
      at: { vit: 0, wis: 0, pace: 75, dex: 30, att: 40, def: 3 },
      beacon: { x: 16, y: 0 }, roamZone: 1, roam: { x: 40, y: 10 }, target: null };
  }
  c.newFolk = () => { const fresh = makeFolk(0); fresh.x = 16; fresh.y = 0; events.push(['respawn', fresh.id]); return fresh; };
  for (let i = 0; i < 96 * multiplier; i++) c.alive.push(makeBeast(i));
  for (let i = 0; i < 16 * multiplier; i++) c.folk.push(makeFolk(i));
  c.observedCombat.set(0, [{ duration: 0.3, points: [[0, 0, 0], [0.3, 1, 0]],
    attacks: [[0, 0, 1, 0, 0, 0, 0, 14, 'bolt']] }]);
  vm.createContext(c);
  if (moduleSource) {
    vm.runInContext(moduleSource, c);
    const bindings = sourceSlice(source, 'tools/atlas-viewer.html')(
      '/* Atlas local search indices.', '/*\n * What a character is at a given level.');
    vm.runInContext(bindings, c);
  }
  const kernel = moduleSource ? markers.map(([from, to]) =>
    sourceSlice(source, 'simulation source')(from, to)).join('\n') : source;
  vm.runInContext(kernel
    + '\nthis.api={stepWorld,stepLife,stepFolk,stepShots,stepObserved,dodge,fire};'
    + '\nthis.simState=()=>({simOwed,simIdle});', c);
  const fire = c.fire;
  c.fire = function (from, at, shot, hurt, mine, by, spread) {
    events.push(['fire', from.id, at.id, from.x, from.y, at.x, at.y, hurt, mine, by && by.id, spread]);
    return fire(from, at, shot, hurt, mine, by, spread);
  };
  for (let i = 0; i < 48 * multiplier; i++) {
    c.fire({ x: i % 12 - 6, y: i % 5 - 2 }, c.folk[i % c.folk.length], gun,
      10, i % 3 === 0, null, 0);
  }
  if (edge) {
    c.alive[0].x = 0; c.alive[0].y = 0;
    c.folk[0].x = -1; c.folk[0].y = 0;
    c.folk[1].x = 1; c.folk[1].y = 0;
    for (let i = 2; i < c.folk.length; i++) { c.folk[i].x = 1000 + i; c.folk[i].y = -1000; }
    c.api.stepLife(1 / 30); // Equal-distance target selection uses source order.
    events.push(['tie', c.alive[0].observed && c.alive[0].observed.target.id, c.folk[0].id]);
    c.folk[1].down = 0.01; c.folk[1].x = -300;
    c.folk[0].x = 15.99; c.folk[0].y = 0;
    c.alive[1].x = 48; c.alive[1].y = 0; c.alive[1].hp = 1;
    c.shots.length = 0;
    c.fire({ x: 48, y: 0 }, { x: 48, y: 0 }, { ...gun, fast: 0 }, 25, false, null, 0);
    c.fire({ x: 48, y: 0 }, { x: 48, y: 0 }, { ...gun, fast: 0 }, 100, true, c.folk[0], 0);
    c.api.stepFolk(1 / 30);
    events.push(['teleport-impact', c.folk[0].x, c.folk[0].hp]);
  }
  for (tick = 0; tick < 120; tick++) {
    // Array mutations at the next step boundary must not retain stale ranks.
    if (tick === 24) { const fresh = makeFolk(0); c.folk.push(fresh); events.push(['join', fresh.id]); }
    if (tick === 48) { const gone = c.folk.splice(2, 1)[0]; events.push(['leave', gone.id]); }
    if (tick === 60) { c.folk.reverse(); events.push(['reorder']); }
    c.api.stepWorld(tick === 80 ? 0.4 : 1 / 30);
    states.push(digest({ alive: c.alive, folk: c.folk, shots: c.shots,
      sparks: c.sparks, litter: c.litter, clock: c.simState(), rng }));
  }
  return { states, state: states.at(-1), events: digest(events), random: digest(random),
    eventCount: events.length, randomCount: random.length, sample: events.filter(e =>
      ['tie', 'teleport-impact', 'respawn', 'spawn', 'remove', 'reward'].includes(e[0])) };
}
module.exports = { simulation };
