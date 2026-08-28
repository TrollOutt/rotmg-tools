/*
 * Pure calculation engine for the RotMG enchant calculator.
 *
 * No DOM access lives here: the browser UI (web/app.js) and the Node test
 * suite (tests/engine.test.js) both load this file, so every rule below can be
 * verified without a browser.
 *
 * Reference implementation: "Qt Source Files (not zipped)/Classes+Functions.h"
 * and mainwindow.cpp. Places where this port deliberately differs from the Qt
 * source are marked with "DIVERGENCE" and listed in engine.NOTES.
 */
var EnchantEngine = (function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Data parsing                                                        *
   * ------------------------------------------------------------------ */

  // The original data files store one record per "[...]" line, records being
  // separated by a line of asterisks. "##" lines are comments.
  function readBracketGroups(text) {
    const groups = [];
    let current = [];
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      if (/^\*{5,}$/.test(line)) { if (current.length) { groups.push(current); current = []; } continue; }
      const match = line.match(/^\[(.*)\]$/);
      if (match) current.push(match[1]);
    }
    if (current.length) groups.push(current);
    return groups;
  }

  const splitSet = value => new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean));

  // Record layout: name, description, weight, Labels, Incompatible Labels,
  // item types, special base requirement, tier weight distribution.
  function parseMods(text) {
    return readBracketGroups(text).filter(group => group.length >= 7).map(group => ({
      name: group[0],
      description: group[1] || '',
      weight: Number(group[2]) || 0,
      tags: splitSet(group[3]),
      excludes: splitSet(group[4]),
      itemTags: splitSet(group[5]),
      special: splitSet(group[6]),
      distribution: String(group[7] || '').split(',').map(Number).filter(Number.isFinite)
    }));
  }

  // Record layout: name, description, "dust,amount", artifact-only pools, then
  // one line per weight rule: key[,key...],multiplier[,excluded label...].
  function parseArtifacts(text) {
    return readBracketGroups(text).filter(group => group.length >= 4).map(group => {
      const cost = String(group[2] || 'na,0').split(',');
      const rules = group.slice(4).map(line => {
        const parts = line.split(',').map(part => part.trim());
        let at = parts.findIndex(part => /^\d+(\.\d+)?$/.test(part));
        if (at < 0) at = parts.length;
        return { keys: new Set(parts.slice(0, at)), multiplier: Number(parts[at]) || 1, excludes: new Set(parts.slice(at + 1)) };
      });
      return {
        name: group[0],
        description: group[1] || '',
        cost: { dust: (cost[0] || 'na').trim(), value: Number(cost[1]) || 0 },
        pools: splitSet(group[3]),
        rules
      };
    });
  }

  function parseAwakenings(text) {
    const map = new Map();
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const match = line.match(/^\[(.*)\]$/);
      if (!match) continue;
      const [item, mod] = match[1].split(',').map(part => part.trim());
      if (!item || !mod) continue;
      if (!map.has(item)) map.set(item, []);
      map.get(item).push(mod);
    }
    return map;
  }

  // Added after the source snapshot: DECA lists the Nightmatter Circlet in the
  // Night's Soul (AoO Rings) awakened pool. The sprite alias reuses the group
  // artwork shipped with the Qt build, so no external asset is needed.
  const EXTRA_AWAKENINGS = { 'Nightmatter Circlet': ["Night's Soul"] };
  const ITEM_SPRITE_ALIAS = { 'Nightmatter Circlet': 'AoO Rings' };

  function buildDataset(sources) {
    // The Qt source keys enchantments by name. Several documents repeat shared
    // modifiers (ability/ring regeneration, armor/ring on-hit procs), so they
    // must exist once rather than being counted twice in a weighted pool.
    const unique = new Map();
    for (const text of sources.modTexts) for (const mod of parseMods(text)) unique.set(mod.name, mod);
    const enchants = [...unique.values()].map((mod, index) => Object.assign({}, mod, { id: index }));
    const byName = new Map(enchants.map(mod => [mod.name, mod]));
    const artifacts = parseArtifacts(sources.artifactText);
    const awakenings = parseAwakenings(sources.awakenText);
    for (const [item, mods] of Object.entries(EXTRA_AWAKENINGS)) awakenings.set(item, mods.slice());
    return {
      enchants,
      byName,
      artifacts,
      byArtifact: new Map(artifacts.map(artifact => [artifact.name, artifact])),
      awakenings,
      // Only labels that appear in at least one "Incompatible Labels" list can
      // ever remove a candidate; every other label is purely descriptive.
      blockingLabels: new Set(enchants.flatMap(mod => [...mod.excludes])),
      spriteAlias: Object.assign({}, ITEM_SPRITE_ALIAS)
    };
  }

  /* ------------------------------------------------------------------ *
   * Configuration helpers                                               *
   * ------------------------------------------------------------------ */

  const asSet = value => value instanceof Set ? value : new Set(value || []);

  // A configuration describes the item in front of the player:
  //   slots         total enchantment slots granted by the rarity
  //   locks         enchantments already on the item and kept (real locks)
  //   virtualLabels hypothetical label-only locks used by the route comparator
  function lockCount(cfg) { return cfg.locks.length + (cfg.virtualLabels || []).length; }
  function rollsRemaining(cfg) { return Math.max(0, cfg.slots - lockCount(cfg)); }

  function lockedLabels(data, cfg) {
    const labels = new Set();
    for (const name of cfg.locks) {
      const mod = data.byName.get(name);
      if (mod) for (const tag of mod.tags) labels.add(tag);
    }
    for (const group of cfg.virtualLabels || []) for (const label of group) labels.add(label);
    return labels;
  }

  /* ------------------------------------------------------------------ *
   * Eligible pool                                                       *
   * ------------------------------------------------------------------ */

  // Port of initialLiteCull(). A candidate survives when:
  //   1. it is not already locked on the item (a locked slot cannot reroll),
  //   2. the item type is in its item-type list,
  //   3. awakened-only enchantments belong to the selected awakenable item,
  //   4. none of its Incompatible Labels appears among the Labels carried by
  //      the locked enchantments,  Labels(lock) ∩ IncompatibleLabels(cand) = ∅
  //   5. its special base requirement is satisfied by the item subtype or by
  //      an artifact that opens that pool.
  function eligiblePool(data, cfg, artifact) {
    const locked = new Set(cfg.locks);
    const labels = lockedLabels(data, cfg);
    const itemAwakenings = new Set(data.awakenings.get(cfg.item) || []);
    const pools = artifact && artifact.pools ? artifact.pools : new Set();
    const subtypes = asSet(cfg.subtypes);
    return data.enchants.filter(mod => {
      if (locked.has(mod.name)) return false;
      if (!mod.itemTags.has(cfg.type)) return false;
      if (mod.excludes.has('AWAKENED') && !itemAwakenings.has(mod.name)) return false;
      for (const label of mod.excludes) if (labels.has(label)) return false;
      for (const requirement of mod.special) if (!subtypes.has(requirement) && !pools.has(requirement)) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------------ *
   * Weights                                                             *
   * ------------------------------------------------------------------ */

  // Port of the artifact multiplier loop in createTrees(). A rule applies when
  // one of its keys matches a Label or the enchantment name, and no excluded
  // Label is present. The highest matching multiplier wins; the product is
  // truncated exactly like static_cast<int>.
  function weightFor(mod, artifact) {
    if (!artifact || artifact.name === 'No Artifact') return mod.weight;
    let best = -1;
    for (const rule of artifact.rules) {
      let matches = false;
      for (const key of rule.keys) if (mod.tags.has(key) || mod.name === key) { matches = true; break; }
      if (!matches) continue;
      let excluded = false;
      for (const label of rule.excludes) if (mod.tags.has(label)) { excluded = true; break; }
      if (!excluded && rule.multiplier > best) best = rule.multiplier;
    }
    return Math.trunc(mod.weight * (best < 0 ? 1 : best));
  }

  function weightedPool(data, cfg, artifact) {
    const mods = eligiblePool(data, cfg, artifact);
    const weights = new Map();
    let total = 0;
    for (const mod of mods) { const weight = weightFor(mod, artifact); weights.set(mod.id, weight); total += weight; }
    return { mods, weights, total };
  }

  /* ------------------------------------------------------------------ *
   * Exact odds over the remaining random rolls                          *
   * ------------------------------------------------------------------ */

  /*
   * Two candidates behave identically for every future roll when they share
   *   (a) the Labels that can block something, (b) their Incompatible Labels,
   *   (c) their weight under the selected artifact.
   * Collapsing the pool into those equivalence classes turns a 200-candidate,
   * four-roll tree (unreachable in practice) into a few tens of classes, which
   * is enumerated exactly in milliseconds. Goals are kept as singleton classes
   * so an individual enchantment can still be identified.
   */
  function buildClasses(pool, artifact, goalIds, blockingLabels) {
    const labelIndex = new Map();
    const indexOf = label => {
      if (!labelIndex.has(label)) labelIndex.set(label, labelIndex.size);
      return labelIndex.get(label);
    };
    // Only labels that some *surviving* candidate refuses can change the pool.
    const relevant = new Set();
    for (const mod of pool) for (const label of mod.excludes) if (blockingLabels.has(label)) relevant.add(label);

    const groups = new Map();
    for (const mod of pool) {
      const isGoal = goalIds.has(mod.id);
      const tags = [...mod.tags].filter(tag => relevant.has(tag)).sort();
      const excludes = [...mod.excludes].filter(label => relevant.has(label)).sort();
      const weight = weightFor(mod, artifact);
      const key = isGoal ? `goal:${mod.id}` : `${tags.join(',')}#${excludes.join(',')}#${weight}`;
      let group = groups.get(key);
      if (!group) {
        group = { tagMask: 0, excludeMask: 0, weight, count: 0, goalId: isGoal ? mod.id : null, members: [] };
        for (const tag of tags) group.tagMask |= 1 << indexOf(tag);
        for (const label of excludes) group.excludeMask |= 1 << indexOf(label);
        groups.set(key, group);
      }
      group.count++;
      group.members.push(mod.name);
    }
    return { classes: [...groups.values()], labelCount: labelIndex.size };
  }

  const DEFAULT_BUDGET = 3000000;

  /*
   * Returns the probability distribution over "which goals ended up on the
   * item" after `rolls` random slots. The result is an array of length
   * 2**goals.length indexed by a bitmask of achieved goals.
   *
   * Rolls are sequential: the mod taken by a slot adds its Labels, which
   * removes every remaining candidate whose Incompatible Labels match, and
   * removes itself (a mod cannot occupy two slots on the same item).
   */
  function goalDistribution(pool, artifact, rolls, goalMods, blockingLabels, budget) {
    const goalIds = new Set(goalMods.map(mod => mod.id));
    const size = 1 << goalMods.length;
    const full = size - 1;
    const result = new Float64Array(size);
    if (rolls <= 0 || !goalMods.length) { result[0] = 1; return { distribution: result, exact: true, nodes: 0 }; }

    const { classes, labelCount } = buildClasses(pool, artifact, goalIds, blockingLabels);
    if (labelCount > 30) throw new Error('label space too large for the bitmask walk');
    const count = classes.length;
    const weight = classes.map(entry => entry.weight);
    const tagMask = classes.map(entry => entry.tagMask);
    const excludeMask = classes.map(entry => entry.excludeMask);
    const goalBit = classes.map(entry => entry.goalId === null ? 0 : 1 << goalMods.findIndex(mod => mod.id === entry.goalId));
    const remaining = classes.map(entry => entry.count);

    const memo = new Map();
    const limit = budget || DEFAULT_BUDGET;
    let nodes = 0;

    // `picked` holds the class indices already consumed, kept sorted so that
    // permutations of the same multiset share one memo entry.
    const picked = [];
    const insert = index => { let at = picked.length; while (at > 0 && picked[at - 1] > index) { picked[at] = picked[at - 1]; at--; } picked[at] = index; };
    const remove = index => { const at = picked.indexOf(index); picked.splice(at, 1); };

    function walk(left, active, achieved, out, scale) {
      if (++nodes > limit) throw new Error('tree budget exceeded');
      if (achieved === full || left === 0) { out[achieved] += scale; return; }

      let total = 0;
      let reachable = false;
      for (let i = 0; i < count; i++) {
        if (!remaining[i] || (excludeMask[i] & active)) continue;
        total += weight[i] * remaining[i];
        if (goalBit[i] && !(goalBit[i] & achieved)) reachable = true;
      }
      // No goal can still be rolled: whatever fills the rest is irrelevant.
      if (!total || !reachable) { out[achieved] += scale; return; }

      const key = `${achieved}|${picked.join(',')}`;
      const cached = memo.get(key);
      if (cached) { for (let mask = 0; mask < size; mask++) if (cached[mask]) out[mask] += scale * cached[mask]; return; }

      const local = new Float64Array(size);
      for (let i = 0; i < count; i++) {
        if (!remaining[i] || (excludeMask[i] & active)) continue;
        const chance = weight[i] * remaining[i] / total;
        const nextAchieved = achieved | goalBit[i];
        if (nextAchieved === full) { local[full] += chance; continue; }
        remaining[i]--;
        insert(i);
        walk(left - 1, active | tagMask[i], nextAchieved, local, chance);
        remove(i);
        remaining[i]++;
      }
      memo.set(key, local);
      for (let mask = 0; mask < size; mask++) if (local[mask]) out[mask] += scale * local[mask];
    }

    walk(rolls, 0, 0, result, 1);
    return { distribution: result, exact: true, nodes };
  }

  /*
   * Deterministic fallback. It is only reached if the exact enumeration blows
   * its node budget, which the class collapse makes very unlikely; the caller
   * is told so it can label the number as an estimate rather than a fact.
   */
  function sampledDistribution(pool, artifact, rolls, goalMods, blockingLabels, seedText, samples) {
    const goalIds = new Set(goalMods.map(mod => mod.id));
    const size = 1 << goalMods.length;
    const result = new Float64Array(size);
    const { classes } = buildClasses(pool, artifact, goalIds, blockingLabels);
    const count = classes.length;
    const goalBit = classes.map(entry => entry.goalId === null ? 0 : 1 << goalMods.findIndex(mod => mod.id === entry.goalId));
    let seed = [...String(seedText)].reduce((value, ch) => ((value * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    const total = samples || 20000;
    const remaining = new Array(count);
    for (let sample = 0; sample < total; sample++) {
      for (let i = 0; i < count; i++) remaining[i] = classes[i].count;
      let active = 0, achieved = 0;
      for (let roll = 0; roll < rolls && achieved !== size - 1; roll++) {
        let sum = 0;
        for (let i = 0; i < count; i++) if (remaining[i] && !(classes[i].excludeMask & active)) sum += classes[i].weight * remaining[i];
        if (!sum) break;
        let pick = random() * sum, chosen = -1;
        for (let i = 0; i < count; i++) {
          if (!remaining[i] || (classes[i].excludeMask & active)) continue;
          pick -= classes[i].weight * remaining[i];
          if (pick <= 0) { chosen = i; break; }
        }
        if (chosen < 0) break;
        achieved |= goalBit[chosen];
        active |= classes[chosen].tagMask;
        remaining[chosen]--;
      }
      result[achieved] += 1 / total;
    }
    return { distribution: result, exact: false, nodes: 0, samples: total };
  }

  function distributionFor(data, cfg, artifact, goalNames, options) {
    const settings = options || {};
    const pool = eligiblePool(data, cfg, artifact);
    const present = new Map(pool.map(mod => [mod.name, mod]));
    const goalMods = goalNames.map(name => present.get(name));
    const size = 1 << goalNames.length;
    // A goal that is not even in the pool can never be rolled.
    if (goalMods.some(mod => !mod)) {
      const distribution = new Float64Array(size);
      const reachable = goalMods.map((mod, index) => mod ? index : -1).filter(index => index >= 0);
      if (!reachable.length) { distribution[0] = 1; return { distribution, exact: true, nodes: 0, pool, impossible: true }; }
      const partial = distributionFor(data, cfg, artifact, reachable.map(index => goalNames[index]), settings);
      for (let mask = 0; mask < partial.distribution.length; mask++) {
        let mapped = 0;
        for (let bit = 0; bit < reachable.length; bit++) if (mask & (1 << bit)) mapped |= 1 << reachable[bit];
        distribution[mapped] += partial.distribution[mask];
      }
      return { distribution, exact: partial.exact, nodes: partial.nodes, pool, impossible: true };
    }
    const rolls = rollsRemaining(cfg);
    try {
      const exact = goalDistribution(pool, artifact, rolls, goalMods, data.blockingLabels, settings.budget);
      return Object.assign(exact, { pool });
    } catch (error) {
      const seed = `${artifact.name}|${goalNames.join('+')}|${cfg.item}|${cfg.locks.join('+')}|${rolls}`;
      const sampled = sampledDistribution(pool, artifact, rolls, goalMods, data.blockingLabels, seed, settings.samples);
      return Object.assign(sampled, { pool });
    }
  }

  // Probability (in percent) that at least one of `goalNames` is rolled.
  function oddsAny(data, cfg, artifact, goalNames, options) {
    const result = distributionFor(data, cfg, artifact, goalNames, options);
    let odds = 0;
    for (let mask = 1; mask < result.distribution.length; mask++) odds += result.distribution[mask];
    return { odds: odds * 100, exact: result.exact, nodes: result.nodes, samples: result.samples, pool: result.pool, distribution: result.distribution };
  }

  // Probability (in percent) that every one of `goalNames` is rolled together.
  function oddsAll(data, cfg, artifact, goalNames, options) {
    const result = distributionFor(data, cfg, artifact, goalNames, options);
    const full = result.distribution.length - 1;
    return { odds: result.distribution[full] * 100, exact: result.exact, nodes: result.nodes, samples: result.samples, pool: result.pool, distribution: result.distribution };
  }

  /* ------------------------------------------------------------------ *
   * Tier distribution                                                   *
   * ------------------------------------------------------------------ */

  // Port of the tieredMult block in populateResultsList(). Artifacts carrying
  // a TIER key push the roll into the higher tiers of the distribution.
  function tierMultiplier(mod, artifact, tiers) {
    if (!mod || !mod.tags.has('TIERED')) return 1;
    const distribution = mod.distribution;
    if (!distribution.length) return 1;
    const keys = new Set(artifact.rules.flatMap(rule => [...rule.keys]));
    let result = 0;
    for (const tier of asSet(tiers)) {
      if (keys.has('TIER3')) { if (tier === 4) result = 1; }
      else if (keys.has('TIER2')) {
        if (tier === 3) result += (distribution[0] || 0) + (distribution[1] || 0) + (distribution[2] || 0);
        else if (tier === 4) result += distribution[3] || 0;
      } else if (keys.has('TIER1')) {
        if (tier === 2) result += (distribution[0] || 0) + (distribution[1] || 0);
        else if (tier > 2) result += distribution[tier - 1] || 0;
      } else result += distribution[tier - 1] || 0;
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Cost model                                                          *
   * ------------------------------------------------------------------ */

  const BASE_COSTS = [0, 50, 65, 80, 100];

  // Cost of one reroll of every unlocked slot. Each locked slot doubles it.
  function rerollCost(cfg) { return BASE_COSTS[cfg.slots] * Math.pow(2, lockCount(cfg)); }

  /*
   * Expected totals for "reroll until the target appears".
   * Rerolls follow a geometric law, so the mean number of attempts is 1/p and
   * every per-attempt cost is simply multiplied by it.
   */
  function costFor(cfg, oddsPercent, artifact, dustType) {
    if (!(oddsPercent > 0)) {
      return { rerolls: Infinity, dust: Infinity, artifactDust: artifact.cost.dust === 'na' ? 0 : Infinity, artifactsUsed: Infinity, medianRerolls: Infinity, perReroll: rerollCost(cfg) };
    }
    const probability = oddsPercent / 100;
    const rerolls = 1 / probability;
    const perReroll = rerollCost(cfg);
    const multiplier = Math.pow(2, lockCount(cfg));
    // Artifact charges are billed in the artifact's own dust type; they only
    // add to the displayed total when that matches the selected dust.
    const artifactPerReroll = artifact.cost.dust === 'na' ? 0 : artifact.cost.value * multiplier;
    const artifactTotal = artifactPerReroll * rerolls;
    return {
      rerolls,
      perReroll,
      dust: perReroll * rerolls + (artifact.cost.dust === dustType ? artifactTotal : 0),
      artifactDust: artifact.cost.dust === 'na' || artifact.cost.dust === dustType ? 0 : artifactTotal,
      artifactDustType: artifact.cost.dust,
      // One artifact is consumed per reroll; "No Artifact" consumes none.
      artifactsUsed: artifact.name === 'No Artifact' ? 0 : rerolls,
      // 50 % of players finish within this many rerolls.
      medianRerolls: Math.log(0.5) / Math.log(1 - Math.min(probability, 1 - 1e-15))
    };
  }

  // One table row: odds for the primary target with this artifact, plus cost.
  function evaluate(data, cfg, artifact, options) {
    const settings = options || {};
    const target = data.byName.get(cfg.desired);
    if (!target) return null;
    const raw = oddsAny(data, cfg, artifact, [cfg.desired], settings);
    const odds = raw.odds * tierMultiplier(target, artifact, cfg.tiers);
    return Object.assign({ artifact, odds, rawOdds: raw.odds, exact: raw.exact, samples: raw.samples }, costFor(cfg, odds, artifact, cfg.dust));
  }

  function evaluateAll(data, cfg, options) {
    return data.artifacts.map(artifact => evaluate(data, cfg, artifact, options)).filter(Boolean);
  }

  /* ------------------------------------------------------------------ *
   * Multi-goal planning                                                 *
   * ------------------------------------------------------------------ */

  /*
   * Cheapest way to finish every wanted enchantment.
   *
   * Policy space searched exactly:
   *   - a reroll always rerolls every unlocked slot at once;
   *   - before each reroll the player may pick any artifact;
   *   - after each reroll the player may lock any subset of the wanted
   *     enchantments that came up — including none of them.
   *
   * That last freedom matters. Locking doubles every later reroll and costs a
   * slot, so a wanted enchantment that shows up early is sometimes worth
   * throwing back rather than locking. The search finds those cases instead of
   * assuming them away.
   *
   * State = the set of wanted enchantments currently locked. With V[S] the
   * expected remaining dust, W(T) the cheapest state reachable by locking a
   * non-empty subset of the enchantments T that just appeared, and c(S) the
   * cost of one reroll:
   *
   *   V[S] = min over artifact of  ( c(S) + Σ_T P(T) · min(V[S], W(T)) )
   *
   * "min(V[S], …)" is the option of locking nothing and rerolling, which folds
   * into a geometric wait. Accepting exactly the k cheapest outcomes is optimal
   * for some k, so the fixed point is found by scanning every k. States are
   * solved from the most complete downwards, so every W(T) is already known.
   *
   * Not searched: locking an enchantment that was never asked for, in order to
   * shrink the pool. The lock-route comparator covers that case separately.
   */
  function planGoals(data, cfg, goalNames, options) {
    const settings = options || {};
    const goals = goalNames.filter(Boolean);
    const count = goals.length;
    if (!count) return null;
    const states = 1 << count;
    if (lockCount(cfg) + count > cfg.slots) return { feasible: false, reason: 'slots' };

    const artifacts = settings.artifacts || data.artifacts;
    const value = new Array(states).fill(Infinity);       // expected dust from this state on
    const rerollValue = new Array(states).fill(Infinity); // expected rerolls from this state on
    const choice = new Array(states).fill(null);
    value[states - 1] = 0;
    rerollValue[states - 1] = 0;

    const popcount = mask => { let bits = 0; while (mask) { mask &= mask - 1; bits++; } return bits; };
    const names = mask => goals.filter((_, index) => mask & (1 << index));
    let exact = true;

    for (let done = count - 1; done >= 0; done--) {
      for (let mask = 0; mask < states - 1; mask++) {
        if (popcount(mask) !== done) continue;
        const pendingIndex = [];
        for (let i = 0; i < count; i++) if (!(mask & (1 << i))) pendingIndex.push(i);
        const pending = pendingIndex.map(index => goals[index]);
        const stateCfg = Object.assign({}, cfg, { locks: [...cfg.locks, ...names(mask)] });
        if (rollsRemaining(stateCfg) <= 0) continue;

        const perReroll = rerollCost(stateCfg);
        const lockMultiplier = Math.pow(2, lockCount(stateCfg));
        let best = null;

        for (const artifact of artifacts) {
          const result = distributionFor(data, stateCfg, artifact, pending, settings);
          if (result.exact === false) exact = false;
          const cost = perReroll + (artifact.cost.dust === cfg.dust ? artifact.cost.value * lockMultiplier : 0);

          // For every outcome T, the cheapest state reachable by locking part of it.
          const outcomes = [];
          for (let sub = 1; sub < result.distribution.length; sub++) {
            const probability = result.distribution[sub];
            if (!probability) continue;
            let bestValue = Infinity, bestRerolls = Infinity, bestMask = mask;
            for (let take = sub; take > 0; take = (take - 1) & sub) {   // every non-empty subset of sub
              let next = mask;
              for (let bit = 0; bit < pending.length; bit++) if (take & (1 << bit)) next |= 1 << pendingIndex[bit];
              if (value[next] < bestValue) { bestValue = value[next]; bestRerolls = rerollValue[next]; bestMask = next; }
            }
            if (Number.isFinite(bestValue)) outcomes.push({ probability, value: bestValue, rerolls: bestRerolls, next: bestMask, sub });
          }
          if (!outcomes.length) continue;

          // Accepting the k cheapest outcomes and rerolling on everything else
          // is optimal for some k; try them all and keep the best.
          outcomes.sort((a, b) => a.value - b.value);
          let chance = 0, dustAcc = 0, rerollAcc = 0, bestForArtifact = null;
          for (let k = 0; k < outcomes.length; k++) {
            chance += outcomes[k].probability;
            dustAcc += outcomes[k].probability * outcomes[k].value;
            rerollAcc += outcomes[k].probability * outcomes[k].rerolls;
            const dust = (cost + dustAcc) / chance;
            const rerolls = (1 + rerollAcc) / chance;
            if (!bestForArtifact || dust < bestForArtifact.dust) bestForArtifact = { dust, rerolls, accepted: outcomes.slice(0, k + 1), rejected: outcomes.slice(k + 1), progressChance: chance * 100 };
          }
          if (bestForArtifact && (!best || bestForArtifact.dust < best.dust)) {
            best = Object.assign({
              artifact, perReroll, pending,
              artifactCharge: artifact.cost.dust === 'na' ? 0 : artifact.cost.value * lockMultiplier,
              distribution: result.distribution
            }, bestForArtifact);
          }
        }
        if (best) { value[mask] = best.dust; rerollValue[mask] = best.rerolls; choice[mask] = best; }
      }
    }

    if (!Number.isFinite(value[0])) return { feasible: false, reason: 'impossible' };

    // Most likely progression, for display.
    const path = [];
    let mask = 0;
    const guard = new Set();
    while (mask !== states - 1 && choice[mask] && !guard.has(mask)) {
      guard.add(mask);
      const step = choice[mask];
      const likely = step.accepted.reduce((bestOutcome, outcome) => !bestOutcome || outcome.probability > bestOutcome.probability ? outcome : bestOutcome, null);
      // Outcomes the optimal policy deliberately declines to lock in full.
      const throwsBack = step.accepted.some(outcome => {
        let all = mask;
        for (let bit = 0; bit < step.pending.length; bit++) if (outcome.sub & (1 << bit)) all |= 1 << goals.indexOf(step.pending[bit]);
        return all !== outcome.next;
      });
      // Wanted enchantments that are cheaper to throw back than to lock here,
      // because locking would double every later reroll for the hard ones.
      const declined = [];
      for (let bit = 0; bit < step.pending.length; bit++) {
        const alone = 1 << bit;
        const outcome = step.rejected.find(entry => entry.sub === alone);
        if (outcome && outcome.probability > 0) declined.push({ name: step.pending[bit], chance: outcome.probability * 100 });
      }
      path.push({
        locked: names(mask),
        pending: step.pending,
        artifact: step.artifact,
        perReroll: step.perReroll,
        artifactCharge: step.artifactCharge,
        artifactDustType: step.artifact.cost.dust,
        progressChance: step.progressChance,
        expectedDustFromHere: value[mask],
        expectedRerollsFromHere: rerollValue[mask],
        likelyGain: likely ? names(likely.next).filter(name => !names(mask).includes(name)) : [],
        likelyChance: likely ? likely.probability * 100 : 0,
        throwsBack,
        declined
      });
      mask = likely ? likely.next : states - 1;
    }

    return { feasible: true, goals, dust: value[0], rerolls: rerollValue[0], path, exact, first: choice[0] };
  }

  // Cost of insisting that every wanted enchantment lands in the same reroll.
  // Useful as a sanity contrast: it is always at least as expensive as the
  // lock-as-you-go policy, and usually far worse.
  function planSimultaneous(data, cfg, goalNames, options) {
    const artifacts = (options && options.artifacts) || data.artifacts;
    let best = null;
    for (const artifact of artifacts) {
      const result = oddsAll(data, cfg, artifact, goalNames, options);
      if (!(result.odds > 0)) continue;
      const cost = costFor(cfg, result.odds, artifact, cfg.dust);
      if (!best || cost.dust < best.dust) best = Object.assign({ artifact, odds: result.odds, exact: result.exact }, cost);
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Lock-route comparison                                               *
   * ------------------------------------------------------------------ */

  /*
   * "Should I lock something else first?" Locking a rolled enchantment removes
   * every candidate that its Labels forbid, which raises the per-slot chance of
   * the target — but it also costs one random slot and doubles every later
   * reroll. Both effects are priced here.
   *
   * Candidates are grouped by the Labels they contribute, because two
   * enchantments with the same blocking Labels have exactly the same effect on
   * the pool. Each group is evaluated with a real named member so the reported
   * pool also loses that enchantment, and the group's members are listed.
   */
  function lockRoutes(data, cfg, options) {
    const settings = options || {};
    const target = data.byName.get(cfg.desired);
    if (!target) return [];
    const plain = data.byArtifact.get('No Artifact');
    const basePool = eligiblePool(data, cfg, plain);
    const existing = new Set(cfg.locks);

    const groups = new Map();
    for (const mod of basePool) {
      if (mod.name === target.name || existing.has(mod.name)) continue;
      // Locking a mod whose Labels forbid the target makes the target
      // unreachable: never suggest it.
      let blocksTarget = false;
      for (const label of target.excludes) if (mod.tags.has(label)) { blocksTarget = true; break; }
      if (blocksTarget) continue;
      const labels = [...mod.tags].filter(label => data.blockingLabels.has(label)).sort();
      const key = labels.join('|');
      let group = groups.get(key);
      if (!group) { group = { labels, members: [], representative: mod }; groups.set(key, group); }
      group.members.push(mod.name);
      // Prefer the lightest member as the representative: it is the one whose
      // removal from the pool distorts the remaining weights the least.
      if (mod.weight < group.representative.weight) group.representative = mod;
    }

    const routes = [];
    for (const group of groups.values()) {
      const routeCfg = Object.assign({}, cfg, { locks: [...cfg.locks, group.representative.name] });
      if (rollsRemaining(routeCfg) < 1) continue;
      const pool = eligiblePool(data, cfg, plain).length;
      const afterPool = eligiblePool(data, routeCfg, plain).length;
      if (afterPool >= pool) continue; // this lock changes nothing
      routes.push({
        labels: group.labels,
        members: group.members,
        representative: group.representative,
        cfg: routeCfg,
        pool: afterPool,
        removed: pool - afterPool
      });
    }
    return routes.sort((a, b) => b.removed - a.removed || a.representative.name.localeCompare(b.representative.name));
  }

  /* ------------------------------------------------------------------ *
   * Notes surfaced in the UI                                            *
   * ------------------------------------------------------------------ */

  const NOTES = {
    incompatibility:
      'A candidate is removed when one of its Incompatible Labels appears among the ' +
      'Labels of an enchantment already locked or already rolled in this attempt: ' +
      'Labels(prior) ∩ IncompatibleLabels(candidate) ≠ ∅. The relation is directional, ' +
      'so A may allow B while B forbids A.',
    qtDivergence:
      'DIVERGENCE from the Qt source: Classes+Functions.h compares the Incompatible ' +
      'Labels of the two enchantments with each other (cullMask uses excludeIDs on ' +
      'both sides). This port uses the RealmEye reading above. The two agree on about ' +
      '98.6% of enchantment pairs; they differ mainly around Jester\'s Trick, the ' +
      'weapon damage/fire-rate trade-offs and the awakened mods.',
    duplicateRoll:
      'DIVERGENCE from the Qt source: when a mod has already been rolled it is removed ' +
      'from the pool and the remaining weights are renormalised. The Qt tree skips the ' +
      'duplicate but keeps its weight in the denominator, which loses a little ' +
      'probability mass on every branch.',
    artifactsUsed:
      'DIVERGENCE from the Qt source: "artifacts used" is the mean number of rerolls ' +
      '(1 / p), one artifact per reroll. The Qt table shows ceil(0.5 / p), which is ' +
      'neither the mean nor the median.',
    plannerPolicy:
      'The multi-goal plan is the exact optimum over this policy space: every reroll ' +
      'rerolls all unlocked slots, the artifact may change between rerolls, and after ' +
      'each reroll any subset of the wanted enchantments that appeared may be locked — ' +
      'including none of them, because locking doubles every later reroll. It does not ' +
      'consider locking an enchantment you never asked for; use the lock-route ' +
      'comparator for that.',
    lockRoutes:
      'Lock routes are conditional: the suggested enchantment has to be rolled first, ' +
      'and it is only worth locking if you keep it. Candidates carrying the same ' +
      'blocking Labels are grouped because they cull the pool identically; the numbers ' +
      'are computed with one real member of the group.'
  };

  const engine = {
    readBracketGroups, splitSet, parseMods, parseArtifacts, parseAwakenings, buildDataset,
    lockCount, rollsRemaining, lockedLabels, eligiblePool, weightFor, weightedPool,
    goalDistribution, distributionFor, oddsAny, oddsAll, tierMultiplier,
    BASE_COSTS, rerollCost, costFor, evaluate, evaluateAll,
    planGoals, planSimultaneous, lockRoutes,
    EXTRA_AWAKENINGS, ITEM_SPRITE_ALIAS, NOTES
  };
  return engine;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EnchantEngine;
