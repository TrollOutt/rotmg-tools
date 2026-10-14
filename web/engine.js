/*
 * Pure calculation engine for the RotMG enchant calculator.
 *
 * No DOM access lives here: the browser UI (web/app.js) and the Node test
 * suite (tests/engine.test.js) both load this file, so every rule below can be
 * verified without a browser.
 *
 * Reference implementation: the original Qt program (see the credit in README.md)
 * and mainwindow.cpp. Places where this port deliberately differs from the Qt
 * source are marked with "DIVERGENCE" and listed in engine.NOTES.
 */
/**
 * Client catalogue records and calculator contracts. Names and labels remain
 * strings because the installed client's catalogue can grow independently.
 * @typedef {Object} EnchantMod
 * @property {string} name
 * @property {string} description
 * @property {number} weight
 * @property {Set<string>} tags
 * @property {Set<string>} excludes
 * @property {Set<string>} itemTags
 * @property {Set<string>} special
 * @property {number[]} distribution
 * @property {string[]} [members] Family goals, never actual pool entries.
 * @typedef {EnchantMod & {id: number}} Enchantment
 * @typedef {{keys: Set<string>, excludes: Set<string>}} EnchantWeightKeys
 * @typedef {EnchantWeightKeys & ({multiplier: number, increment?: never} | {increment: number, multiplier?: never})} EnchantWeightRule
 * @typedef {{include: Set<string> | null, exclude: Set<string>, names: Set<string>}} EnchantPoolEntry
 * @typedef {{dust: string, value: number}} EnchantArtifactCost
 * @typedef {Object} EnchantArtifact
 * @property {string} name
 * @property {string} pool
 * @property {string} description
 * @property {Set<string>} labels
 * @property {EnchantArtifactCost} cost
 * @property {number} consumeProb
 * @property {EnchantPoolEntry} entry
 * @property {EnchantWeightRule[]} rules
 * @typedef {Object} EnchantItem
 * @property {string} name
 * @property {string | null} type
 * @property {string | null} dust
 * @property {number[]} costs
 * @property {number[]} slotChance
 * @property {string | null} base
 * @property {string} pool
 * @property {Set<string>} labels
 * @typedef {{clientModText?: string, modTexts?: string[], clientArtifactText: string, clientItemText: string, awakenText: string}} EnchantSources
 * @typedef {Object} EnchantDataset
 * @property {Enchantment[]} enchants
 * @property {Map<string, Enchantment>} byName
 * @property {EnchantArtifact[]} artifacts
 * @property {{name: string, missing: string[]}[]} heldArtifacts
 * @property {Map<string, EnchantArtifact>} byArtifact
 * @property {Map<string, string[]>} awakenings
 * @property {Map<string, EnchantItem>} itemsByName
 * @property {Set<string>} awokenArt
 * @property {Set<string>} blockingLabels
 * @property {Record<string, string>} spriteAlias
 * @typedef {{slots: number, locks: string[]}} EnchantSlotCounts
 * @typedef {{item: string, type: string | null, subtypes?: Set<string> | string[] | null}} EnchantItemSelection
 * @typedef {EnchantSlotCounts & EnchantItemSelection} EnchantPoolConfig
 * @typedef {EnchantPoolConfig & {dust: string, tiers?: Set<number> | number[] | null}} EnchantPlanConfig
 * @typedef {EnchantPlanConfig & {desired: string}} EnchantConfig
 * @typedef {{index: number, name?: string, locked: boolean}} EnchantSlotSelection
 * @typedef {{other: Enchantment, reason: 'duplicate' | 'after-lock' | 'before-wanted' | 'mutual'}} EnchantConflict
 * @typedef {Object} EnchantOptions
 * @property {number} [budget]
 * @property {number} [samples]
 * @property {Set<number> | number[] | null} [acceptedTiers]
 * @property {EnchantArtifact[]} [artifacts]
 * @property {() => void | Promise<void>} [breathe]
 * @property {() => boolean} [cancelled]
 * @typedef {{mods: Enchantment[], weights: Map<number, number>, total: number}} EnchantWeightedPool
 * @typedef {{tagMask: number, excludeMask: number, weight: number, count: number, goalId: number | null, members: string[]}} EnchantClass
 * @typedef {{distribution: Float64Array, exact: boolean, nodes: number, samples?: number}} EnchantDistribution
 * @typedef {EnchantDistribution & {pool: Enchantment[], impossible?: boolean}} EnchantDistributionResult
 * @typedef {EnchantDistributionResult & {odds: number}} EnchantOdds
 * @typedef {Object} EnchantCost
 * @property {number} rerolls
 * @property {number} perReroll
 * @property {number} dust
 * @property {number} artifactDust
 * @property {string} [artifactDustType]
 * @property {number} artifactsUsed
 * @property {number} medianRerolls
 * @typedef {EnchantCost & {artifact: EnchantArtifact, odds: number, rawOdds: number, exact: boolean, samples?: number}} EnchantEvaluation
 * @typedef {EnchantCost & {artifact: EnchantArtifact, odds: number, exact: boolean}} EnchantSimultaneousPlan
 * @typedef {{probability: number, value: number, rerolls: number, next: number, sub: number}} EnchantOutcome
 * @typedef {{dust: number, rerolls: number, accepted: EnchantOutcome[], rejected: EnchantOutcome[], progressChance: number}} EnchantOutcomePolicy
 * @typedef {EnchantOutcomePolicy & {artifact: EnchantArtifact, perReroll: number, pending: string[], artifactCharge: number, distribution: Float64Array}} EnchantPlanChoice
 * @typedef {{rolled: string[], lock: string[], reroll: string[], chance: number, action: 'partial' | 'lock' | 'reroll'}} EnchantDecision
 * @typedef {Object} EnchantPathStep
 * @property {string[]} locked
 * @property {string[]} pending
 * @property {EnchantArtifact} artifact
 * @property {number} perReroll
 * @property {number} artifactCharge
 * @property {string} artifactDustType
 * @property {number} progressChance
 * @property {number} expectedDustFromHere
 * @property {number} expectedRerollsFromHere
 * @property {string[]} likelyGain
 * @property {number} likelyChance
 * @property {boolean} throwsBack
 * @property {{name: string, chance: number}[]} declined
 * @property {EnchantDecision[]} decisions Non-enumerable UI metadata.
 * @property {string[]} hunt Non-enumerable UI metadata.
 * @typedef {{feasible: true, goals: string[], dust: number, rerolls: number, path: EnchantPathStep[], exact: boolean, first: EnchantPlanChoice | null}} EnchantFeasiblePlan
 * @typedef {EnchantFeasiblePlan | {feasible: false, reason: 'slots' | 'impossible'} | null} EnchantPlan
 */
var EnchantEngine = (function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Data parsing                                                        *
   * ------------------------------------------------------------------ */

  // The original data files store one record per "[...]" line, records being
  // separated by a line of asterisks. "##" lines are comments.
  /**
   * @param {string} text
   * @returns {string[][]}
   */
  function readBracketGroups(text) {
    const groups = [];
    /** @type {string[]} */
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

  /** @param {string | null | undefined} value @returns {Set<string>} */
  const splitSet = value => new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean));

  // Record layout: name, description, weight, Labels, Incompatible Labels,
  // item types, special base requirement, tier weight distribution.
  /**
   * @param {string} text
   * @returns {EnchantMod[]}
   */
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

  /*
   * The enchantments, as an installed client defines them.
   *
   * data/Enchantment documents/client-enchantments.txt is generated by
   * tools/generate-enchantments.js. It replaced nine inherited documents that
   * were transcriptions of the same data — right in most places, quietly wrong
   * in a few, and unable to grow when the game did.
   *
   * A tiered enchantment is four records in the client, one line here, and its
   * tier split is those four weights over their total rather than a figure
   * rounded by hand.
   */
  /**
   * @param {string} text
   * @returns {EnchantMod[]}
   */
  function parseClientMods(text) {
    /** @type {EnchantMod[]} */
    const out = [];
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##') || !line.startsWith('ench|')) continue;
      const [, name, weight, split, labels, excludes, slots, families, , description] = line.split('|');
      out.push({
        name,
        description: description || '',
        weight: Number(weight) || 0,
        tags: splitSet(labels),
        excludes: splitSet(excludes),
        itemTags: splitSet(slots),
        special: splitSet(families),
        distribution: String(split || '').split(',').map(Number).filter(Number.isFinite)
      });
    }
    return out;
  }

  /*
   * A family of tradeoffs, offered as one goal.
   *
   * "Mana -Defense Tradeoff" and its six siblings all give the same Mana and
   * differ only in the stat they cost. A player after the Mana does not care
   * which — so the family is offered as a single target, "Mana -any Tradeoff",
   * and the odds are the odds of landing any of the seven. This is unlike
   * "Defense to Attack Bonus", where both stats are the point, so only the
   * "A -B Tradeoff" shape is grouped.
   *
   * The group is a record in the catalogue so the interface can show it like
   * any other enchantment, but it carries a `members` list and is kept out of
   * every pool: it is a way of asking, never a thing the game rolls.
   */
  /**
   * @param {EnchantMod[]} enchants
   * @returns {EnchantMod[]}
   */
  function tradeoffFamilies(enchants) {
    /** @type {Map<string, EnchantMod[]>} */
    const families = new Map();
    for (const mod of enchants) {
      if (!mod.tags.has('ROLLABLE')) continue;
      const match = /^(.+?) -(.+) Tradeoff$/.exec(mod.name);
      if (!match) continue;
      if (!families.has(match[1])) families.set(match[1], []);
      /** @type {EnchantMod[]} */ (families.get(match[1])).push(mod);
    }
    /** @type {EnchantMod[]} */
    const out = [];
    for (const [stat, members] of families) {
      if (members.length < 2) continue;          // nothing to choose between
      const first = members[0];
      const weight = members.reduce((total, mod) => total + mod.weight, 0);

      /*
       * The tier split of the family, weighted by each member's weight. The
       * members happen to agree here, but averaging rather than copying the
       * first is what makes the accepted-tier checkboxes mean the same thing
       * for a family as for one enchantment. Left empty, they would silently
       * have no effect on a family at all.
       */
      const width = Math.max(...members.map(mod => mod.distribution.length));
      const distribution = [];
      for (let tier = 0; tier < width; tier++) {
        let share = 0;
        for (const mod of members) share += mod.weight * (mod.distribution[tier] || 0);
        distribution.push(weight ? share / weight : 0);
      }

      out.push({
        name: `${stat} -any Tradeoff`,
        description: `Any of the ${members.length}: gains ${stat} and costs whichever other stat the roll gives.`,
        weight,
        tags: new Set(first.tags),
        excludes: new Set(first.excludes),
        itemTags: new Set(first.itemTags),
        special: new Set(first.special),
        distribution,
        members: members.map(mod => mod.name)
      });
    }
    return out;
  }

  // The names a goal stands for: itself, or every member of its family.
  /**
   * @param {EnchantDataset} data
   * @param {string} name
   * @returns {string[]}
   */
  function membersOf(data, name) {
    const mod = data.byName.get(name);
    return mod && mod.members ? mod.members : [name];
  }

  /*
   * The artifacts, as an installed client defines them.
   *
   * data/Artifacts/client-artifacts.txt is generated by tools/generate-artifacts.js
   * and holds all 54 of them with their pool's rules verbatim. It replaced an
   * inherited file that held 24 and could not express three of the forms the
   * client uses: a weight rule that adds rather than multiplies, an
   * enchantment added to a pool by name, and a pool that does not simply take
   * everything rollable.
   *
   * Tier labels are the one thing not taken literally. TIER1..TIER4 never
   * decide whether an enchantment is in the pool — they are a share of its own
   * weight — so a rule naming them, whether it bars them at the entry or
   * multiplies them by zero, is collected into tierRules() instead.
   */
  /** @type {Record<string, string | undefined>} */
  const CLIENT_DUST = { greenDust: 'Green', redDust: 'Red', purpleDust: 'Purple', na: 'na' };
  /** @param {string} key @returns {boolean} */
  const isTier = key => /^TIER[1-4]$/.test(key);

  /**
   * @param {string} text
   * @returns {EnchantArtifact[]}
   */
  function parseClientArtifacts(text) {
    /** @type {EnchantArtifact[]} */
    const out = [];
    /** @type {EnchantArtifact | null} */
    let current = null;
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const parts = line.split('|');

      if (parts[0] === 'artifact') {
        const [, name, pool, dustType, dustAmount, consumeProb, labels, description] = parts;
        current = {
          name,
          pool,
          description: description || '',
          labels: new Set((labels || '').split(',').filter(Boolean)),
          cost: { dust: CLIENT_DUST[dustType] || dustType, value: Number(dustAmount) || 0 },
          // The client states this per artifact. Most are 0.5; the event
          // engravings are 1, and assuming 0.5 for those overstated how far a
          // stack of them goes by a factor of two.
          consumeProb: Number.isFinite(Number(consumeProb)) ? Number(consumeProb) : 0.5,
          entry: { include: null, exclude: new Set(), names: new Set() },
          rules: []
        };
        out.push(current);
        continue;
      }
      if (!current) continue;

      if (parts[0] === 'entry') {
        const include = (parts[1] || '').split(',').filter(Boolean);
        const exclude = (parts[2] || '').split(',').filter(Boolean);
        if (include.length) current.entry.include = new Set(include);
        for (const label of exclude) {
          // "no tier 1, 2 or 3" is a statement about weight, not membership.
          if (isTier(label)) current.rules.push({ keys: new Set([label]), excludes: new Set(), multiplier: 0 });
          else current.entry.exclude.add(label);
        }
      } else if (parts[0] === 'entry-name') {
        current.entry.names.add(parts[1]);
      } else if (parts[0] === 'weight' || parts[0] === 'weight-name') {
        const byName = parts[0] === 'weight-name';
        const keys = byName ? [parts[1]] : (parts[1] || '').split(',').filter(Boolean);
        const excludes = byName ? [] : (parts[2] || '').split(',').filter(Boolean);
        const amount = parts[byName ? 2 : 3] || '';
        /** @type {EnchantWeightKeys & {increment?: number, multiplier?: number}} */
        const rule = { keys: new Set(keys), excludes: new Set(excludes) };
        if (amount.startsWith('increment=')) rule.increment = Number(amount.slice(10)) || 0;
        else rule.multiplier = Number(amount.slice(5));
        if (rule.multiplier !== undefined && !Number.isFinite(rule.multiplier)) rule.multiplier = 1;
        /** Both branches above assign exactly one weight operation. */
        current.rules.push(/** @type {EnchantWeightRule} */ (rule));
      }
    }

    // The client has no artifact record for rolling without one, because in
    // the game that is simply not using the enchanter's artifact slot — but it
    // does have the pool: "Default Enchantment Pool", whose only rule is
    // includeLabelsOR=ROLLABLE.
    out.unshift({
      name: 'No Artifact',
      pool: 'Default Enchantment Pool',
      description: 'The default roll, without the use of any artifact.',
      labels: new Set(),
      cost: { dust: 'na', value: 0 },
      consumeProb: 0,
      entry: { include: new Set(['ROLLABLE']), exclude: new Set(), names: new Set() },
      rules: []
    });
    return out;
  }

  /*
   * The items an installed client will let a player enchant.
   *
   * data/Items/client-items.txt is generated by tools/generate-items.js. It
   * carries the slot, the dust, the equipment family and the awakened
   * enchantment each item unlocks — all of which used to be scraped from wiki
   * pages and inferred from tier bands.
   */
  /**
   * @param {string} text
   * @returns {{items: EnchantItem[], awakenings: Map<string, string[]>}}
   */
  function parseClientItems(text) {
    const items = [];
    /** @type {Map<string, string[]>} */
    const awakenings = new Map();
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##') || !line.startsWith('item|')) continue;
      const [, name, slot, dust, costs, slotChance, family, pool, awoken, labels] = line.split('|');
      const item = {
        name,
        type: slot || null,
        dust: dust || null,
        // What a reroll costs at one, two, three and four slots. Stated per
        // item by the client; identical for all but a handful.
        costs: String(costs || '').split(',').map(Number).filter(Number.isFinite),
        // How likely a dropped copy is to have each slot. Not used yet.
        slotChance: String(slotChance || '').split(',').map(Number).filter(Number.isFinite),
        base: family || null,
        pool: pool || '',
        labels: splitSet(labels)
      };
      items.push(item);
      if (awoken) awakenings.set(name, awoken.split(','));
    }
    return { items, awakenings };
  }

  /*
   * The Nightmatter Circlet takes Night's Soul, which the original Qt assets
   * drew once for the group rather than per item. This borrows that picture so
   * the interface has something to show; it says nothing about the game.
   */
  const ITEM_SPRITE_ALIAS = { 'Nightmatter Circlet': 'AoO Rings' };

  /**
   * @param {string} text
   * @returns {Map<string, string[]>}
   */
  function parseAwakenings(text) {
    /** @type {Map<string, string[]>} */
    const map = new Map();
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const match = line.match(/^\[(.*)\]$/);
      if (!match) continue;
      const [item, mod] = match[1].split(',').map(part => part.trim());
      if (!item || !mod) continue;
      if (!map.has(item)) map.set(item, []);
      /** @type {string[]} */ (map.get(item)).push(mod);
    }
    return map;
  }

  // Added after the source snapshot: DECA lists the Nightmatter Circlet in the
  // Night's Soul (AoO Rings) awakened pool. The sprite alias reuses the group
  // artwork shipped with the Qt build, so no external asset is needed.

  /**
   * @param {EnchantSources} sources
   * @returns {EnchantDataset}
   */
  function buildDataset(sources) {
    // The Qt source keys enchantments by name. Several documents repeat shared
    // modifiers (ability/ring regeneration, armor/ring on-hit procs), so they
    // must exist once rather than being counted twice in a weighted pool.
    // One source now: the client. sources.modTexts is still read when it is the
    // only thing given, so a caller holding the old documents still works, but
    // nothing in the project passes them any more.
    /** @type {Map<string, EnchantMod>} */
    const unique = new Map();
    const parsed = sources.clientModText
      ? parseClientMods(sources.clientModText)
      : (sources.modTexts || []).flatMap(text => parseMods(text));
    /*
     * The client keeps a non-rollable twin of many enchantments under the same
     * display name — ALIEN_ONSHOOT_ATTACK beside ALIEN_ONSHOOT_ATTACK_ROLLABLE.
     * They are one enchantment to a player, so they collapse to one record, and
     * the rollable one wins. Explicitly: last-one-wins happened to keep the
     * right one only because of how the file sorts, and reading whichever came
     * last is exactly what once made 105 enchantments look as if they had
     * vanished from the game.
     */
    for (const mod of parsed) {
      const seen = unique.get(mod.name);
      if (seen && seen.tags.has('ROLLABLE') && !mod.tags.has('ROLLABLE')) continue;
      unique.set(mod.name, mod);
    }
    // Nothing is filtered out here. Which enchantments are in play is the
    // pool's business, and every pool the client defines states it: the
    // default one a player rolls into without an artifact is
    // "includeLabelsOR=ROLLABLE", which is what keeps Damage Resistance — the
    // one modifier in the documents the game will not roll — out of every
    // draw. Filtering globally instead looked equivalent and was not: Night
    // Prince Engraving names an enchantment that is deliberately not rollable
    // and adds it to its own pool, and a global filter made that impossible to
    // express, leaving the artifact looking like a universal x999 with none of
    // the reason it exists.
    const real = [...unique.values()];
    // The family goals come last so they take ids after every real record.
    const enchants = real.concat(tradeoffFamilies(real))
      .map((mod, index) => Object.assign({}, mod, { id: index }));
    const byName = new Map(enchants.map(mod => [mod.name, mod]));
    /*
     * An artifact whose pool names an enchantment we do not carry cannot be
     * modelled, so it is held back rather than ranked wrongly.
     *
     * One is in this state: Night Prince Engraving, whose pool adds "Crown" and
     * gives it a weight of a hundred million — which is the artifact, its whole
     * purpose being to produce that one enchantment. Crown is deliberately not
     * rollable and lives only in the client; our enchantment documents are
     * still the inherited ones and have never held it. Without it the artifact
     * keeps its x999 on UNIQUE and its x9999 on AWAKENED and nothing to spend
     * them on, which put it at the top of every table it had no business being
     * in. Generating the enchantments from the client too is what retires this.
     */
    const allArtifacts = parseClientArtifacts(sources.clientArtifactText);
    const names = new Set([...unique.values()].map(mod => mod.name));
    const held = allArtifacts.filter(a => [...a.entry.names].some(name => !names.has(name)));
    const artifacts = allArtifacts.filter(a => !held.includes(a));
    /*
     * Which items unlock which awakened enchantment.
     *
     * Read off the client: an awakened enchantment names the slot it goes on
     * and the item label it belongs to, and the items carry that label. The
     * mapping this replaced was assembled from wiki pages and held 140 entries,
     * 16 of which were group headings rather than items — "AoO Weapons",
     * "Matrix Armors". On the 124 real items the two agree exactly.
     *
     * The Qt file is still read, but only for its own sake: it lists the names
     * that have group artwork in the original assets, which is a fact about the
     * pictures and not about the game.
     */
    const awokenArt = new Set(parseAwakenings(sources.awakenText).keys());
    const clientItems = parseClientItems(sources.clientItemText);
    const awakenings = clientItems.awakenings;
    const itemsByName = new Map(clientItems.items.map(item => [item.name, item]));
    return {
      enchants,
      byName,
      artifacts,
      // Named so the interface can say what it is not showing, and why.
      heldArtifacts: held.map(a => ({
        name: a.name,
        missing: [...a.entry.names].filter(name => !names.has(name))
      })),
      byArtifact: new Map(artifacts.map(artifact => [artifact.name, artifact])),
      awakenings,
      itemsByName,
      awokenArt,
      // Only labels that appear in at least one "Incompatible Labels" list can
      // ever remove a candidate; every other label is purely descriptive.
      blockingLabels: new Set(enchants.flatMap(mod => [...mod.excludes])),
      spriteAlias: Object.assign({}, ITEM_SPRITE_ALIAS)
    };
  }

  /* ------------------------------------------------------------------ *
   * Configuration helpers                                               *
   * ------------------------------------------------------------------ */

  /** @template T @param {Set<T> | T[] | null | undefined} value @returns {Set<T>} */
  const asSet = value => value instanceof Set ? value : new Set(value || []);

  // A configuration describes the item in front of the player:
  //   slots   total enchantment slots granted by the rarity
  //   locks   enchantments already on the item and kept
  /**
   * @param {EnchantSlotCounts} cfg
   * @returns {number}
   */
  function lockCount(cfg) { return cfg.locks.length; }
  /**
   * @param {EnchantSlotCounts} cfg
   * @returns {number}
   */
  function rollsRemaining(cfg) { return Math.max(0, cfg.slots - lockCount(cfg)); }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantSlotCounts} cfg
   * @returns {Set<string>}
   */
  function lockedLabels(data, cfg) {
    /** @type {Set<string>} */
    const labels = new Set();
    for (const name of cfg.locks) {
      const mod = data.byName.get(name);
      if (mod) for (const tag of mod.tags) labels.add(tag);
    }
    return labels;
  }

  // The item's own family, straight from the same client catalogue used by the
  // calculator. Consumers must not guess Alien / Neo Alien from the item name.
  /**
   * @param {EnchantDataset | null | undefined} data
   * @param {string} itemName
   * @returns {Set<string>}
   */
  function subtypesForItem(data, itemName) {
    const item = data && data.itemsByName && data.itemsByName.get(itemName);
    return new Set(item && item.base ? [item.base] : []);
  }

  // Item-level game rules, deliberately excluding natural rollability and the
  // artifact entry rule. eligiblePool() also needs this for artifact-only
  // entries; calculator pickers add isNaturallyRollable() through
  // eligibleForItem().
  /**
   * @param {EnchantDataset} data
   * @param {EnchantItemSelection | null | undefined} cfg
   * @param {EnchantMod | null | undefined} mod
   * @returns {boolean}
   */
  function itemAllows(data, cfg, mod) {
    if (!mod || !cfg || !cfg.type || !mod.itemTags.has(cfg.type)) return false;
    if (mod.excludes.has('AWAKENED') && !(data.awakenings.get(cfg.item) || []).includes(mod.name)) return false;
    const subtypes = asSet(cfg.subtypes);
    for (const requirement of mod.special) if (!subtypes.has(requirement)) return false;
    return true;
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantItemSelection | null | undefined} cfg
   * @param {EnchantMod | null | undefined} mod
   * @returns {boolean}
   */
  function eligibleForItem(data, cfg, mod) {
    return isNaturallyRollable(mod) && itemAllows(data, cfg, mod);
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantItemSelection | null | undefined} cfg
   * @param {EnchantMod | null | undefined} mod
   * @returns {string[] | null}
   */
  function missingBase(data, cfg, mod) {
    if (!mod || !cfg || !cfg.type || !mod.itemTags.has(cfg.type)) return null;
    if (mod.excludes.has('AWAKENED') && !(data.awakenings.get(cfg.item) || []).includes(mod.name)) return null;
    const subtypes = asSet(cfg.subtypes);
    const missing = [...mod.special].filter(requirement => !subtypes.has(requirement));
    return missing.length ? missing : null;
  }

  // Directional incompatibility: candidate may follow prior iff none of the
  // candidate's refused labels are carried by prior.
  /**
   * @param {EnchantMod} candidate
   * @param {EnchantMod} prior
   * @returns {boolean}
   */
  function follows(candidate, prior) {
    for (const label of candidate.excludes) if (prior.tags.has(label)) return false;
    return true;
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantMod} mod
   * @param {EnchantSlotSelection} slot
   * @param {EnchantSlotSelection[]} others
   * @returns {EnchantConflict | null}
   */
  function conflictWith(data, mod, slot, others) {
    for (const other of others) {
      if (other.index === slot.index || !other.name) continue;
      const otherMod = data.byName.get(other.name);
      if (!otherMod) continue;
      if (otherMod.name === mod.name) return { other: otherMod, reason: 'duplicate' };
      if (other.locked && !follows(mod, otherMod)) return { other: otherMod, reason: 'after-lock' };
      if (!other.locked && slot.locked && !follows(otherMod, mod)) return { other: otherMod, reason: 'before-wanted' };
      if (!other.locked && !slot.locked && !follows(mod, otherMod) && !follows(otherMod, mod)) return { other: otherMod, reason: 'mutual' };
    }
    return null;
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
  //   5. its special base requirement is satisfied by the item's own subtypes.
  //
  // On (5), see NOTES.alienBase: the Qt source lets an artifact's pool stand in
  // for the requirement, which would put an alien enchantment on ordinary gear.
  // Alien and Neo Alien are equipment families, and an enchantment of a family
  // only goes on equipment of that same family, so the item is the only thing
  // that can satisfy the requirement here.
  /**
   * @param {EnchantDataset} data
   * @param {EnchantPoolConfig} cfg
   * @param {EnchantArtifact | null | undefined} artifact
   * @returns {Enchantment[]}
   */
  function eligiblePool(data, cfg, artifact) {
    const locked = new Set(cfg.locks);
    const labels = lockedLabels(data, cfg);
    const entry = artifact && artifact.entry;
    return data.enchants.filter(mod => {
      // A family is a way of asking for one of several, not something the game
      // rolls; it must never sit in a pool competing for a slot.
      if (mod.members) return false;
      if (locked.has(mod.name)) return false;
      if (!itemAllows(data, cfg, mod)) return false;
      for (const label of mod.excludes) if (labels.has(label)) return false;
      // What the artifact's own pool holds. Most say "everything ROLLABLE",
      // but not all: the Valentine engravings take ROLLABLE,VALENTINES, and
      // Night Prince adds one enchantment by name that its labels would not
      // have let in. Assuming every pool was the full rollable set is what
      // made those artifacts impossible to describe at all.
      if (entry && !entry.names.has(mod.name)) {
        if (entry.include && ![...entry.include].some(label => mod.tags.has(label))) return false;
        for (const label of entry.exclude) if (mod.tags.has(label)) return false;
      }
      return true;
    });
  }

  /*
   * What a normal enchanting roll can actually produce. eligiblePool() is
   * deliberately wider because artifact pools may name seasonal entries and
   * the catalogue retains retired entries so an existing item can still be
   * read. Pickers and planners without an artifact need this narrower set.
   * Keeping the predicate here gives every module the same boundary.
   */
  /**
   * @param {EnchantMod | null | undefined} mod
   * @returns {boolean}
   */
  function isNaturallyRollable(mod) {
    return !!(mod && mod.weight > 0 && mod.tags && mod.tags.has('ROLLABLE'));
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantPoolConfig} cfg
   * @returns {Enchantment[]}
   */
  function rollablePool(data, cfg) {
    return eligiblePool(data, cfg, null).filter(isNaturallyRollable);
  }

  /* ------------------------------------------------------------------ *
   * Weights                                                             *
   * ------------------------------------------------------------------ */

  // Port of the artifact multiplier loop in createTrees(). A rule applies when
  // one of its keys matches a Label or the enchantment name, and no excluded
  // Label is present. The highest matching multiplier wins; the product is
  // truncated exactly like static_cast<int>.
  /*
   * An artifact's rules compound; they do not compete.
   *
   * The client states them as a list of ModifyEnchantmentWeight entries that
   * each multiply the running weight in turn. The Ascension Ankh, for one, is
   * "LIFE,DEXTERITY,DEFENSE x7" and "DUALSTAT x3", so Attack and Defense Bonus
   * — which is both — comes out at x21. Taking the largest matching rule
   * instead, as this did, left it at x7 and made every dual-stat bonus three
   * times rarer under that artifact than the game makes it. The same held for
   * Precision Cog, Amber Honeycomb, the four alien Technologies, Spectral
   * Arrowhead and Adamantine Ingot.
   *
   * Tier rules are deliberately not part of this: they are a share of the
   * enchantment's own weight rather than a multiplier on the whole of it, and
   * tierMass accounts for them.
   */
  /**
   * @param {EnchantMod} mod
   * @param {EnchantArtifact | null | undefined} artifact
   * @returns {number}
   */
  function weightFor(mod, artifact) {
    if (!artifact || artifact.name === 'No Artifact') return mod.weight;
    // Rules apply in the order the client lists them, because one of them adds
    // rather than multiplies and the two do not commute. Night Prince Engraving
    // is the only artifact that uses it, and it adds a hundred million to one
    // enchantment — a way of saying "this one, and effectively nothing else".
    let weight = mod.weight * tierMass(mod, artifact);
    for (const rule of artifact.rules) {
      let onlyTiers = true;
      for (const key of rule.keys) if (!isTier(key)) { onlyTiers = false; break; }
      if (onlyTiers) continue;
      let matches = false;
      for (const key of rule.keys) if (mod.tags.has(key) || mod.name === key) { matches = true; break; }
      if (!matches) continue;
      let excluded = false;
      for (const label of rule.excludes) if (mod.tags.has(label)) { excluded = true; break; }
      if (excluded) continue;
      if (rule.increment !== undefined) weight += rule.increment;
      else weight *= rule.multiplier;
    }
    return Math.trunc(weight);
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantPoolConfig} cfg
   * @param {EnchantArtifact | null | undefined} artifact
   * @returns {EnchantWeightedPool}
   */
  function weightedPool(data, cfg, artifact) {
    const mods = eligiblePool(data, cfg, artifact);
    /** @type {Map<number, number>} */
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
  /**
   * @param {Enchantment[]} pool
   * @param {EnchantArtifact} artifact
   * @param {Set<number>} goalIds
   * @param {Set<string>} blockingLabels
   * @returns {{classes: EnchantClass[], labelCount: number}}
   */
  function buildClasses(pool, artifact, goalIds, blockingLabels) {
    /** @type {Map<string, number>} */
    const labelIndex = new Map();
    /** @param {string} label @returns {number} */
    const indexOf = label => {
      if (!labelIndex.has(label)) labelIndex.set(label, labelIndex.size);
      return /** @type {number} */ (labelIndex.get(label));
    };
    // Only labels that some *surviving* candidate refuses can change the pool.
    /** @type {Set<string>} */
    const relevant = new Set();
    for (const mod of pool) for (const label of mod.excludes) if (blockingLabels.has(label)) relevant.add(label);

    /** @type {Map<string, EnchantClass>} */
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
  /*
   * `goalSets` is one array of enchantments per goal, and a goal is met when
   * any member of its set lands.
   *
   * Nearly always the set holds one. It holds more when the player asks for a
   * family rather than a name — "a Mana tradeoff", meaning any of the seven,
   * because what they are after is the Mana and the stat it costs is whatever
   * the roll gives. Every member of such a family is then one class of its own
   * with the same goal bit, so the walk needs no other change.
   */
  /**
   * @param {Enchantment[]} pool
   * @param {EnchantArtifact} artifact
   * @param {number} rolls
   * @param {Enchantment[][]} goalSets
   * @param {Set<string>} blockingLabels
   * @param {number} [budget]
   * @param {Set<number> | number[] | null} [acceptedTiers]
   * @returns {EnchantDistribution}
   */
  function goalDistribution(pool, artifact, rolls, goalSets, blockingLabels, budget, acceptedTiers) {
    /** @type {Set<number>} */
    const goalIds = new Set();
    /** @type {Map<number, number>} */
    const bitOfId = new Map();
    /** @type {Map<number, number>} */
    const acceptedById = new Map();
    const tiers = acceptedTiers ? asSet(acceptedTiers) : null;
    goalSets.forEach((set, index) => {
      for (const mod of set) {
        goalIds.add(mod.id);
        bitOfId.set(mod.id, 1 << index);
        // No tier filter, or every tier selected, means the whole rolled
        // enchantment is acceptable. This must be exactly 1 even when the
        // client's rounded tier shares add up to 0.99999.
        const acceptsEveryTier = !tiers || !mod.tags.has('TIERED')
          || mod.distribution.every((_, index) => tiers.has(index + 1));
        const share = acceptsEveryTier ? 1 : tierMultiplier(mod, artifact, tiers);
        acceptedById.set(mod.id,
          Math.abs(share - 1) < 1e-12 ? 1
            : Math.abs(share) < 1e-12 ? 0
              : Math.max(0, Math.min(1, share)));
      }
    });
    const size = 1 << goalSets.length;
    const full = size - 1;
    const result = new Float64Array(size);
    if (rolls <= 0 || !goalSets.length) { result[0] = 1; return { distribution: result, exact: true, nodes: 0 }; }

    const { classes, labelCount } = buildClasses(pool, artifact, goalIds, blockingLabels);
    if (labelCount > 30) throw new Error('label space too large for the bitmask walk');
    const count = classes.length;
    const weight = classes.map(entry => entry.weight);
    const tagMask = classes.map(entry => entry.tagMask);
    const excludeMask = classes.map(entry => entry.excludeMask);
    const goalBit = classes.map(entry => entry.goalId === null ? 0 : (bitOfId.get(entry.goalId) || 0));
    const goalAccept = classes.map(entry => entry.goalId === null ? 1
      : (acceptedById.has(entry.goalId) ? /** @type {number} */ (acceptedById.get(entry.goalId)) : 1));
    const remaining = classes.map(entry => entry.count);

    /** @type {Map<string, Float64Array>} */
    const memo = new Map();
    const limit = budget || DEFAULT_BUDGET;
    let nodes = 0;

    // `picked` holds the class indices already consumed, kept sorted so that
    // permutations of the same multiset share one memo entry.
    /** @type {number[]} */
    const picked = [];
    /** @param {number} index @returns {number} */
    const insert = index => {
      let at = picked.length;

      while (
        at > 0
        && picked[at - 1] > index
      ) {
        picked[at] =
          picked[at - 1];

        at--;
      }

      picked[at] =
        index;

      return at;
    };

    /** @param {number} at @returns {void} */
    const removeAt = at => {
      picked.splice(
        at,
        1
      );
    };

    /**
     * @param {number} left
     * @param {number} active
     * @param {number} achieved
     * @param {Float64Array} out
     * @param {number} scale
     * @returns {void}
     */
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
        const bit = goalBit[i];
        const acceptance = bit && !(bit & achieved) ? goalAccept[i] : 1;

        remaining[i]--;
        const pickedAt =
          insert(i);

        if (bit && !(bit & achieved) && acceptance < 1) {
          if (acceptance > 0) {
            const nextAchieved = achieved | bit;
            if (nextAchieved === full) local[full] += chance * acceptance;
            else walk(left - 1, active | tagMask[i], nextAchieved, local, chance * acceptance);
          }
          if (acceptance < 1) {
            walk(left - 1, active | tagMask[i], achieved, local, chance * (1 - acceptance));
          }
        } else {
          const nextAchieved = achieved | bit;
          if (nextAchieved === full) local[full] += chance;
          else walk(left - 1, active | tagMask[i], nextAchieved, local, chance);
        }

        removeAt(
          pickedAt
        );
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
  /**
   * @param {Enchantment[]} pool
   * @param {EnchantArtifact} artifact
   * @param {number} rolls
   * @param {Enchantment[][]} goalSets
   * @param {Set<string>} blockingLabels
   * @param {string} seedText
   * @param {number} [samples]
   * @param {Set<number> | number[] | null} [acceptedTiers]
   * @returns {EnchantDistribution}
   */
  function sampledDistribution(pool, artifact, rolls, goalSets, blockingLabels, seedText, samples, acceptedTiers) {
    /** @type {Set<number>} */
    const goalIds = new Set();
    /** @type {Map<number, number>} */
    const bitOfId = new Map();
    /** @type {Map<number, number>} */
    const acceptedById = new Map();
    const tiers = acceptedTiers ? asSet(acceptedTiers) : null;
    goalSets.forEach((set, index) => {
      for (const mod of set) {
        goalIds.add(mod.id);
        bitOfId.set(mod.id, 1 << index);
        // No tier filter, or every tier selected, means the whole rolled
        // enchantment is acceptable. This must be exactly 1 even when the
        // client's rounded tier shares add up to 0.99999.
        const acceptsEveryTier = !tiers || !mod.tags.has('TIERED')
          || mod.distribution.every((_, index) => tiers.has(index + 1));
        const share = acceptsEveryTier ? 1 : tierMultiplier(mod, artifact, tiers);
        acceptedById.set(mod.id,
          Math.abs(share - 1) < 1e-12 ? 1
            : Math.abs(share) < 1e-12 ? 0
              : Math.max(0, Math.min(1, share)));
      }
    });
    const size = 1 << goalSets.length;
    const result = new Float64Array(size);
    const { classes } = buildClasses(pool, artifact, goalIds, blockingLabels);
    const count = classes.length;
    const goalBit = classes.map(entry => entry.goalId === null ? 0 : (bitOfId.get(entry.goalId) || 0));
    const goalAccept = classes.map(entry => entry.goalId === null ? 1
      : (acceptedById.has(entry.goalId) ? /** @type {number} */ (acceptedById.get(entry.goalId)) : 1));
    let seed = [...String(seedText)].reduce((value, ch) => ((value * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    const total = samples || 20000;
    /** @type {number[]} */
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
        const bit = goalBit[chosen];
        if (bit && !(bit & achieved)) {
          const acceptance = goalAccept[chosen];
          if (acceptance >= 1 || (acceptance > 0 && random() < acceptance)) achieved |= bit;
        }
        active |= classes[chosen].tagMask;
        remaining[chosen]--;
      }
      result[achieved] += 1 / total;
    }
    return { distribution: result, exact: false, nodes: 0, samples: total };
  }

  /*
   * PERF:
   * goalDistribution memoizes nodes inside one tree walk, but UI redraws can
   * ask distributionFor the exact same question again. Keep a small LRU per
   * dataset so those repeated requests do not rebuild the whole probability
   * tree.
   */
  const DISTRIBUTION_CACHE_MAX = 256;
  /** @type {WeakMap<EnchantDataset, Map<string, EnchantDistributionResult>>} */
  const distributionCacheByData = new WeakMap();
  /** @type {WeakMap<EnchantArtifact, number>} */
  const distributionArtifactIds = new WeakMap();
  let distributionArtifactSerial = 0;

  /**
   * @param {EnchantArtifact | null | undefined} artifact
   * @returns {number | string}
   */
  function distributionArtifactId(artifact) {
    if (
      !artifact
      || (
        typeof artifact !== 'object'
        && typeof artifact !== 'function'
      )
    ) {
      return String(artifact);
    }

    let id =
      distributionArtifactIds.get(
        artifact
      );

    if (!id) {
      id =
        ++distributionArtifactSerial;

      distributionArtifactIds.set(
        artifact,
        id
      );
    }

    return id;
  }

  /**
   * Serializes arbitrary cache-key values; object, Set, Map and array reads
   * stay unknown until the existing runtime guards identify their container.
   * @param {unknown} value
   * @param {WeakSet<object>} [seen]
   * @returns {unknown}
   */
  function distributionCacheShape(value, seen) {
    if (value === undefined) {
      return '[Undefined]';
    }

    if (
      value === null
      || typeof value !== 'object'
    ) {
      return value;
    }

    const visited =
      seen || new WeakSet();

    if (visited.has(value)) {
      return '[Circular]';
    }

    visited.add(value);

    /** @type {unknown} */
    let out;

    if (value instanceof Set) {
      out = [
        'Set',
        [.../** @type {Set<unknown>} */ (value)]
          .map(one =>
            distributionCacheShape(
              one,
              visited
            )
          )
          .sort((a, b) =>
            JSON.stringify(a)
              .localeCompare(
                JSON.stringify(b)
              )
          )
      ];
    } else if (value instanceof Map) {
      out = [
        'Map',
        [.../** @type {Map<unknown, unknown>} */ (value)]
          .map(([key, item]) => [
            distributionCacheShape(
              key,
              visited
            ),
            distributionCacheShape(
              item,
              visited
            )
          ])
          .sort((a, b) =>
            JSON.stringify(a[0])
              .localeCompare(
                JSON.stringify(b[0])
              )
          )
      ];
    } else if (Array.isArray(value)) {
      out =
        /** @type {unknown[]} */ (value).map(one =>
          distributionCacheShape(
            one,
            visited
          )
        );
    } else {
      out = {};

      for (
        const key
        of Object.keys(value).sort()
      ) {
        /** @type {Record<string, unknown>} */ (out)[key] =
          distributionCacheShape(
            /** @type {Record<string, unknown>} */ (value)[key],
            visited
          );
      }
    }

    visited.delete(value);

    return out;
  }

  /**
   * @param {EnchantDataset} data
   * @returns {Map<string, EnchantDistributionResult>}
   */
  function distributionCacheFor(data) {
    let cache =
      distributionCacheByData.get(
        data
      );

    if (!cache) {
      cache = new Map();

      distributionCacheByData.set(
        data,
        cache
      );
    }

    return cache;
  }

  /**
   * @param {EnchantPoolConfig} cfg
   * @param {EnchantArtifact} artifact
   * @param {string[]} goalNames
   * @param {EnchantOptions} settings
   * @returns {string}
   */
  function distributionCacheKey(
    cfg,
    artifact,
    goalNames,
    settings
  ) {
    /** @type {Record<string, unknown>} */
    const usefulSettings = {};

    for (
      const key
      of Object.keys(settings || {}).sort()
    ) {
      /*
       * planGoals passes the artifact list through its settings. It selects
       * which calls are made, but does not change one distribution itself.
       */
      if (key === 'artifacts') continue;

      usefulSettings[key] =
        /** @type {Record<string, unknown>} */ (settings)[key];
    }

    return JSON.stringify([
      distributionArtifactId(
        artifact
      ),
      distributionCacheShape(cfg),
      goalNames,
      distributionCacheShape(
        usefulSettings
      )
    ]);
  }

  /**
   * @param {EnchantDistributionResult} result
   * @returns {EnchantDistributionResult}
   */
  function cloneDistributionResult(result) {
    const copy =
      Object.assign(
        {},
        result
      );

    if (
      result.distribution
      && typeof result.distribution.slice === 'function'
    ) {
      copy.distribution =
        result.distribution.slice();
    }

    if (Array.isArray(result.pool)) {
      copy.pool =
        result.pool.slice();
    }

    return copy;
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantPoolConfig} cfg
   * @param {EnchantArtifact} artifact
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {EnchantDistributionResult}
   */
  function distributionForUncached(data, cfg, artifact, goalNames, options) {
    const settings = options || {};
    const pool = eligiblePool(data, cfg, artifact);
    const present = new Map(pool.map(mod => [mod.name, mod]));
    // A goal is one name, or a family standing for several — see membersOf.
    /** Boolean removes the undefined results of missing Map entries. */
    const goalMods = /** @type {Enchantment[][]} */ (goalNames.map(name =>
      membersOf(data, name).map(member => present.get(member)).filter(Boolean)));
    const size = 1 << goalNames.length;
    // A goal none of whose members is in the pool can never be rolled.
    if (goalMods.some(set => !set.length)) {
      const distribution = new Float64Array(size);
      const reachable = goalMods.map((set, index) => set.length ? index : -1).filter(index => index >= 0);
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
      const exact = goalDistribution(pool, artifact, rolls, goalMods, data.blockingLabels, settings.budget, settings.acceptedTiers);
      return Object.assign(exact, { pool });
    } catch (error) {
      const seed = `${artifact.name}|${goalNames.join('+')}|${cfg.item}|${cfg.locks.join('+')}|${rolls}`;
      const sampled = sampledDistribution(pool, artifact, rolls, goalMods, data.blockingLabels, seed, settings.samples, settings.acceptedTiers);
      return Object.assign(sampled, { pool });
    }
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantPoolConfig} cfg
   * @param {EnchantArtifact} artifact
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {EnchantDistributionResult}
   */
  function distributionFor(
    data,
    cfg,
    artifact,
    goalNames,
    options
  ) {
    const settings =
      options || {};

    const cache =
      distributionCacheFor(data);

    const key =
      distributionCacheKey(
        cfg,
        artifact,
        goalNames,
        settings
      );

    const cached =
      cache.get(key);

    if (cached) {
      /*
       * Refresh insertion order: Map doubles as a tiny LRU.
       */
      cache.delete(key);
      cache.set(key, cached);

      return cloneDistributionResult(
        cached
      );
    }

    const result =
      distributionForUncached(
        data,
        cfg,
        artifact,
        goalNames,
        settings
      );

    cache.set(
      key,
      cloneDistributionResult(
        result
      )
    );

    if (
      cache.size
      > DISTRIBUTION_CACHE_MAX
    ) {
      cache.delete(
        /** The size guard guarantees a first key exists. */
        /** @type {string} */ (cache.keys().next().value)
      );
    }

    return result;
  }

  // Probability (in percent) that at least one of `goalNames` is rolled.
  /**
   * @param {EnchantDataset} data
   * @param {EnchantPoolConfig} cfg
   * @param {EnchantArtifact} artifact
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {EnchantOdds}
   */
  function oddsAny(data, cfg, artifact, goalNames, options) {
    const result = distributionFor(data, cfg, artifact, goalNames, options);
    let odds = 0;
    for (let mask = 1; mask < result.distribution.length; mask++) odds += result.distribution[mask];
    return { odds: odds * 100, exact: result.exact, nodes: result.nodes, samples: result.samples, pool: result.pool, distribution: result.distribution };
  }

  // Probability (in percent) that every one of `goalNames` is rolled together.
  /**
   * @param {EnchantDataset} data
   * @param {EnchantPoolConfig} cfg
   * @param {EnchantArtifact} artifact
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {EnchantOdds}
   */
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
/*
 * The multiplier an artifact puts on each of the four tiers. Premium Gold is
 * TIER1,TIER2 x0 and TIER3 x4.25; most artifacts say nothing and leave all
 * four at 1.
 */
  /**
   * @param {EnchantArtifact} artifact
   * @returns {number[] | null}
   */
  function tierRules(artifact) {
    let perTier = null;
    for (const rule of artifact.rules) {
      for (const key of rule.keys) {
        const match = /^TIER([1-4])$/.exec(key);
        if (!match) continue;
        if (!perTier) perTier = [1, 1, 1, 1];
        /** Client TIER rules are multipliers, never increments. */
        perTier[Number(match[1]) - 1] = /** @type {number} */ (rule.multiplier);
      }
    }
    return perTier;                       // null when the artifact says nothing
  }

  /*
   * What fraction of a tiered enchantment's weight the artifact leaves it.
   *
   * This belongs in the pool, not only on the target. Premium Diamond bars
   * tiers one to three and restores nothing, so in the game a tiered
   * enchantment carries fifteen per cent of its weight into the draw — which
   * is the entire reason that card is the one you use to hunt a unique. Left
   * out of the denominator, every tiered competitor kept its full weight and
   * the card looked far weaker than it is.
   */
  /**
   * @param {EnchantMod | null | undefined} mod
   * @param {EnchantArtifact} artifact
   * @returns {number}
   */
  function tierMass(mod, artifact) {
    if (!mod || !mod.tags.has('TIERED') || !mod.distribution.length) return 1;
    const perTier = tierRules(artifact);
    // No tier rule means the whole of it survives. Saying so exactly matters:
    // 0.35 + 0.30 + 0.20 + 0.15 is 0.9999999999999999 in binary floating
    // point, and the truncation below would quietly shave a unit off every
    // tiered enchantment in the pool.
    if (!perTier) return 1;
    let total = 0;
    for (let index = 0; index < mod.distribution.length; index++) {
      total += (mod.distribution[index] || 0) * (perTier[index] === undefined ? 1 : perTier[index]);
    }
    return total;
  }

  /*
   * How much of a tiered enchantment's weight survives, given the artifact and
   * the tiers the player will accept.
   *
   * An artifact states this per tier: Premium Gold is TIER1,TIER2 x0 and
   * TIER3 x4.25; Precision Cog is TIER1 x0 and TIER2 x2.166. So the answer is
   * simply the accepted tiers' shares, each scaled by its own multiplier.
   *
   * This used to be a bespoke redistribution — the weight of a barred tier was
   * handed to the next surviving one — which is exactly right whenever the
   * multiplier restores the total, and 4.25 is (0.35+0.30+0.20)/0.20 on the
   * standard split, so it was right for most of them. It was wrong twice.
   * On Premium Diamond, which bars three tiers and restores nothing, the game
   * leaves a tiered enchantment 15 % of its weight while the old rule left it
   * all of it. And on the families that are not on the standard split — the
   * Relative bonuses, the Summon Power tradeoff — the restoring constants no
   * longer restore, so the totals drifted. Reading the multipliers off the
   * artifact settles both.
   */
  /**
   * @param {EnchantMod | null | undefined} mod
   * @param {EnchantArtifact} artifact
   * @param {Set<number> | number[] | null} [tiers]
   * @returns {number}
   */
  function tierMultiplier(mod, artifact, tiers) {
    if (!mod || !mod.tags.has('TIERED')) return 1;
    const distribution = mod.distribution;
    if (!distribution.length) return 1;

    const perTier = tierRules(artifact) || [1, 1, 1, 1];
    let accepted = 0;
    for (const tier of asSet(tiers)) {
      const index = tier - 1;
      if (index < 0 || index >= distribution.length) continue;
      accepted += (distribution[index] || 0) * perTier[index];
    }
    // The pool weight already carries the whole tier mass, so what is left to
    // say here is the share of it the player will settle for.
    const whole = tierMass(mod, artifact);
    return whole > 0 ? accepted / whole : 0;
  }

  /* ------------------------------------------------------------------ *
   * Cost model                                                          *
   * ------------------------------------------------------------------ */

  const BASE_COSTS = [0, 50, 65, 80, 100];

  // Cost of one reroll of every unlocked slot. Each locked slot doubles it.
  /**
   * @param {EnchantSlotCounts} cfg
   * @returns {number}
   */
  function rerollCost(cfg) { return BASE_COSTS[cfg.slots] * Math.pow(2, lockCount(cfg)); }

  // A reroll has a 50 % chance of consuming the artifact rather than a certain
  // one, and that holds for all twenty-five — confirmed by the author of the
  // original program, there is no exception. See NOTES.artifactsUsed.
  const ARTIFACT_CONSUMPTION = 0.5;

  /*
   * Expected totals for "reroll until the target appears".
   * Rerolls follow a geometric law, so the mean number of attempts is 1/p and
   * every per-attempt cost is simply multiplied by it.
   */
  /**
   * @param {EnchantSlotCounts} cfg
   * @param {number} oddsPercent
   * @param {Pick<EnchantArtifact, "cost" | "consumeProb">} artifact
   * @param {string} dustType
   * @returns {EnchantCost}
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
      // A reroll consumes the artifact with the probability the client states
      // for that artifact, so the mean number spent is that share of the mean
      // number of rerolls. It is 0.5 for most and 1 for the event engravings,
      // which a flat 0.5 had been overstating the reach of twofold.
      artifactsUsed: rerolls * (artifact.consumeProb || 0),
      // 50 % of players finish within this many rerolls.
      medianRerolls: Math.log(0.5) / Math.log(1 - Math.min(probability, 1 - 1e-15))
    };
  }

  // One table row: odds for the primary target with this artifact, plus cost.
  /**
   * @param {EnchantDataset} data
   * @param {EnchantConfig} cfg
   * @param {EnchantArtifact} artifact
   * @param {EnchantOptions} [options]
   * @returns {EnchantEvaluation | null}
   */
  function evaluate(data, cfg, artifact, options) {
    const settings = options || {};
    const target = data.byName.get(cfg.desired);
    if (!target) return null;
    const raw = oddsAny(data, cfg, artifact, [cfg.desired], settings);
    const odds = raw.odds * tierMultiplier(target, artifact, cfg.tiers);
    return Object.assign({ artifact, odds, rawOdds: raw.odds, exact: raw.exact, samples: raw.samples }, costFor(cfg, odds, artifact, cfg.dust));
  }

  /**
   * @param {EnchantDataset} data
   * @param {EnchantConfig} cfg
   * @param {EnchantOptions} [options]
   * @returns {EnchantEvaluation[]}
   */
  function evaluateAll(data, cfg, options) {
    /** Boolean removes the null results of unknown desired enchantments. */
    return /** @type {EnchantEvaluation[]} */ (data.artifacts.map(artifact => evaluate(data, cfg, artifact, options)).filter(Boolean));
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
   * shrink the pool. That is a real strategy, and pricing it honestly means
   * charging for the wait until the thing turns up — which the comparator that
   * used to live here did not do, so it is gone rather than misleading.
   */
  /**
   * @param {EnchantDataset} data
   * @param {EnchantPlanConfig} cfg
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {Generator<void, EnchantPlan, void>}
   */
  function* planGoalsSteps(data, cfg, goalNames, options) {
    const settings = options || {};
    const planSettings = Object.assign({}, settings, { acceptedTiers: cfg.tiers });
    const goals = goalNames.filter(Boolean);
    const count = goals.length;
    if (!count) return null;
    const states = 1 << count;
    if (lockCount(cfg) + count > cfg.slots) return { feasible: false, reason: 'slots' };

    const artifacts = settings.artifacts || data.artifacts;
    /** @type {number[]} */
    const value = new Array(states).fill(Infinity);       // expected dust from this state on
    /** @type {number[]} */
    const rerollValue = new Array(states).fill(Infinity); // expected rerolls from this state on
    /** @type {(EnchantPlanChoice | null)[]} */
    const choice = new Array(states).fill(null);
    value[states - 1] = 0;
    rerollValue[states - 1] = 0;

    /** @param {number} mask @returns {number} */
    const popcount = mask => { let bits = 0; while (mask) { mask &= mask - 1; bits++; } return bits; };
    /** @param {number} mask @returns {string[]} */
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
        /** @type {EnchantPlanChoice | null} */
        let best = null;

        for (const artifact of artifacts) {
          /*
           * PERF:
           * One artifact is one indivisible probability calculation.
           * The async UI wrapper yields between artifacts so the complete
           * multi-goal plan no longer monopolises the main thread.
           */
          yield;

          const result = distributionFor(data, stateCfg, artifact, pending, planSettings);
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
          let chance = 0, dustAcc = 0, rerollAcc = 0, bestForArtifact = /** @type {EnchantOutcomePolicy | null} */ (null);
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
    /** @type {EnchantPathStep[]} */
    const path = [];
    let mask = 0;
    /** @type {Set<number>} */
    const guard = new Set();
    while (mask !== states - 1 && choice[mask] && !guard.has(mask)) {
      guard.add(mask);
      /** The loop guard checked this state's choice. */
      const step = /** @type {EnchantPlanChoice} */ (choice[mask]);
      const likely = step.accepted.reduce((bestOutcome, outcome) => !bestOutcome || outcome.probability > bestOutcome.probability ? outcome : bestOutcome, /** @type {EnchantOutcome | null} */ (null));
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

      // Expose the complete conditional policy for this displayed state.
      // An accepted outcome may still lock only part of what rolled; a rejected
      // outcome means throw the whole result back and reroll.
      const lockedNow = names(mask);
      /** @param {EnchantOutcome} outcome @param {boolean} accepted @returns {EnchantDecision} */
      const decisionFor = (outcome, accepted) => {
        const rolled = [];
        for (let bit = 0; bit < step.pending.length; bit++) {
          if (outcome.sub & (1 << bit)) rolled.push(step.pending[bit]);
        }

        const lock = accepted
          ? names(outcome.next).filter(name => !lockedNow.includes(name))
          : [];
        const reroll = rolled.filter(name => !lock.includes(name));

        return {
          rolled,
          lock,
          reroll,
          chance: outcome.probability * 100,
          action: accepted ? (reroll.length ? 'partial' : 'lock') : 'reroll'
        };
      };

      const actionOrder = { lock: 0, partial: 1, reroll: 2 };
      const decisions = [
        ...step.accepted.map(outcome => decisionFor(outcome, true)),
        ...step.rejected.map(outcome => decisionFor(outcome, false))
      ].sort((a, b) =>
        actionOrder[a.action] - actionOrder[b.action]
        || b.chance - a.chance
      );

      // A singleton accepted on its own is an honest "hunt now" target.
      // If none exists, the UI falls back to the most likely accepted result.
      const hunt = decisions
        .filter(decision => decision.action === 'lock' && decision.rolled.length === 1)
        .flatMap(decision => decision.lock)
        .filter((name, index, all) => all.indexOf(name) === index);

      const pathStep = {
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
      };

      // Presentation metadata: available to the live UI without changing the
      // enumerable planner output recorded by the historical rules corpus.
      Object.defineProperties(pathStep, {
        decisions: { value: decisions, enumerable: false },
        hunt: { value: hunt, enumerable: false }
      });

      /** defineProperties installed the non-enumerable decisions and hunt. */
      path.push(/** @type {EnchantPathStep} */ (pathStep));
      mask = likely ? likely.next : states - 1;
    }

    return { feasible: true, goals, dust: value[0], rerolls: rerollValue[0], path, exact, first: choice[0] };
  }

  // Cost of insisting that every wanted enchantment lands in the same reroll.
  // Useful as a sanity contrast: it is always at least as expensive as the
  // lock-as-you-go policy, and usually far worse.
  /*
   * Public synchronous contract.
   *
   * Tests, Node consumers and callers that need an immediate answer keep the
   * exact historical API. The generator only introduces safe pause points;
   * driving every step immediately reproduces the old synchronous algorithm.
   */
  /**
   * @param {EnchantDataset} data
   * @param {EnchantPlanConfig} cfg
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {EnchantPlan}
   */
  function planGoals(data, cfg, goalNames, options) {
    const steps =
      planGoalsSteps(
        data,
        cfg,
        goalNames,
        options
      );

    let step =
      steps.next();

    while (!step.done) {
      step =
        steps.next();
    }

    return step.value;
  }

  /*
   * Browser/UI version.
   *
   * `breathe` is deliberately removed before entering the probability cache:
   * it controls scheduling only and must never become part of a distribution
   * key.
   *
   * `cancelled` lets a newer calculator generation stop obsolete work as soon
   * as the browser gets control back.
   */
  /**
   * @param {EnchantDataset} data
   * @param {EnchantPlanConfig} cfg
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {Promise<EnchantPlan>}
   */
  async function planGoalsAsync(data, cfg, goalNames, options) {
    const settings =
      options || {};

    const breathe =
      typeof settings.breathe === 'function'
        ? settings.breathe
        : async () => {};

    const cancelled =
      typeof settings.cancelled === 'function'
        ? settings.cancelled
        : () => false;

    const coreOptions =
      Object.assign(
        {},
        settings
      );

    delete coreOptions.breathe;
    delete coreOptions.cancelled;

    const steps =
      planGoalsSteps(
        data,
        cfg,
        goalNames,
        coreOptions
      );

    let step =
      steps.next();

    while (!step.done) {
      if (cancelled()) {
        return null;
      }

      await breathe();

      if (cancelled()) {
        return null;
      }

      step =
        steps.next();
    }

    return step.value;
  }


  /**
   * @param {EnchantDataset} data
   * @param {EnchantPlanConfig} cfg
   * @param {string[]} goalNames
   * @param {EnchantOptions} [options]
   * @returns {EnchantSimultaneousPlan | null}
   */
  function planSimultaneous(data, cfg, goalNames, options) {
    const settings = Object.assign({}, options || {}, { acceptedTiers: cfg.tiers });
    const artifacts = settings.artifacts || data.artifacts;
    /** @type {EnchantSimultaneousPlan | null} */
    let best = null;
    for (const artifact of artifacts) {
      const result = oddsAll(data, cfg, artifact, goalNames, settings);
      if (!(result.odds > 0)) continue;
      const cost = costFor(cfg, result.odds, artifact, cfg.dust);
      if (!best || cost.dust < best.dust) best = Object.assign({ artifact, odds: result.odds, exact: result.exact }, cost);
    }
    return best;
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
      'A reroll consumes the artifact half the time, so the mean number spent is ' +
      '0.5 / p — half the mean number of rerolls. This agrees with the Qt source, ' +
      'which shows ceil(0.5 / p); only the rounding differs. The rate is the same for ' +
      'all twenty-five artifacts, confirmed by the author of the original program: ' +
      'there is no exception among them.',
    alienBase:
      'DIVERGENCE from the Qt source: an enchantment that requires an ALIEN or ' +
      'NEO_ALIEN base is offered only on an item of that same family. The Qt source ' +
      'also accepts it when the selected artifact declares that pool, which is how the ' +
      'four Technology artifacts are written, so there it can be rolled onto ordinary ' +
      'gear. Alien and Neo Alien are equipment families and an enchantment of one ' +
      'family only goes on equipment of that family, so the artifact cannot stand in ' +
      'for the item. This affects the 7 Alien and 7 Neo Alien enchantments.',
    alienUnknown:
      'The catalogue does not record which items are Alien or Neo Alien bases, so no ' +
      'item is recognised as one on its name alone. Until it does, set the base by ' +
      'hand under "Set the slot, dust and base by hand" to reach those enchantments.',
    plannerPolicy:
      'The multi-goal plan is the exact optimum over this policy space: every reroll ' +
      'rerolls all unlocked slots, the artifact may change between rerolls, and after ' +
      'each reroll any subset of the wanted enchantments that appeared may be locked — ' +
      'including none of them, because locking doubles every later reroll. It does not ' +
      'consider locking an enchantment you never asked for in order to shrink ' +
      'the pool.'
  };

  const engine = {
    readBracketGroups, splitSet, parseMods, parseClientMods, parseClientArtifacts, parseClientItems, parseAwakenings, buildDataset,
    lockCount, rollsRemaining, lockedLabels, subtypesForItem, itemAllows, eligibleForItem, missingBase, follows, conflictWith,
    eligiblePool, isNaturallyRollable, rollablePool, weightFor, weightedPool,
    goalDistribution, distributionFor, oddsAny, oddsAll, tradeoffFamilies, membersOf, tierMultiplier, tierMass, tierRules,
    BASE_COSTS, rerollCost, costFor, evaluate, evaluateAll,
    planGoals, planGoalsAsync, planSimultaneous,
    ITEM_SPRITE_ALIAS, NOTES
  };
  return engine;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EnchantEngine;
