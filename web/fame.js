/*
 * Fame from dungeons.
 *
 * A character's fame is what its experience earned — the base — plus a list of
 * bonuses. Two kinds matter to someone working through dungeons on purpose:
 *
 *   a ladder, one per dungeon: the first completion is worth a flat amount,
 *   and further completions at 10, 20, 40 and 100 are worth more.
 *
 *   a collection, thirteen of them: complete every dungeon of an era or a
 *   group once and take a large flat amount and a percentage of the base fame
 *   on top. "Tunnel Rat" is twelve dungeons for 3000 fame and 7.5 %.
 *
 * The percentages are the reason this is worth planning rather than grinding:
 * they are a share of the base fame, so the same twelve dungeons are worth far
 * more on a maxed character than on a fresh one.
 *
 * Every figure here is read out of an installed game client by
 * tools/generate-fame.js. Nothing is estimated.
 */
var EnchantFame = (function () {
  'use strict';

  /*
   * data/Fame/client-fame.txt: one "bonus" line, then one "needs" line per
   * condition it wants met.
   */
  function parse(text) {
    const bonuses = [];
    let current = null;
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const parts = line.split('|');
      if (parts[0] === 'bonus') {
        const [, id, group, category, name, absolute, relative, repeatable, description] = parts;
        current = {
          id,
          group,
          category,
          name,
          absolute: Number(absolute) || 0,
          relative: Number(relative) || 0,
          repeatable: repeatable === 'repeatable',
          description: description || '',
          needs: []
        };
        bonuses.push(current);
      } else if (parts[0] === 'needs' && current) {
        current.needs.push({ what: parts[1], count: Number(parts[2]) || 0 });
      }
    }

    const collections = bonuses.filter(bonus => bonus.category === 'Dungeon Collection');

    /*
     * The dungeons worth a checkbox: those with a ladder of their own. Each
     * carries what its first completion is worth and which collections it
     * counts towards. Every dungeon named by a collection has a ladder, so
     * nothing is lost by taking the ladders as the list.
     */
    const dungeons = new Map();
    for (const bonus of bonuses) {
      if (bonus.group !== 'Dungeon Bonuses' || bonus.category === 'Dungeon Collection') continue;
      const need = bonus.needs[0];
      if (!need) continue;
      if (!dungeons.has(need.what)) {
        dungeons.set(need.what, { name: need.what, category: bonus.category, ladder: [], collections: [] });
      }
      dungeons.get(need.what).ladder.push({ at: need.count, fame: bonus.absolute, name: bonus.name });
    }
    for (const dungeon of dungeons.values()) dungeon.ladder.sort((a, b) => a.at - b.at);
    for (const collection of collections) {
      for (const need of collection.needs) {
        const dungeon = dungeons.get(need.what);
        if (dungeon) dungeon.collections.push(collection.id);
      }
    }

    return {
      bonuses,
      collections,
      dungeons: [...dungeons.values()].sort((a, b) => a.name.localeCompare(b.name)),
      byName: dungeons
    };
  }

  // What one completion of a dungeon is worth, before any collection.
  function firstCompletion(dungeon) {
    const step = dungeon.ladder.find(entry => entry.at <= 1);
    return step ? step.fame : 0;
  }

  /*
   * Where a player stands, given the dungeons they have completed at least once
   * and the base fame of the character.
   *
   * "Earned" counts what those completions are already worth; "remaining" is
   * what finishing every collection would add. The percentages are turned into
   * fame with the base the player typed, so both halves are comparable.
   */
  function summarise(data, done, baseFame) {
    const ticked = done instanceof Set ? done : new Set(done || []);
    const base = Number(baseFame) || 0;

    let earnedFlat = 0;
    for (const dungeon of data.dungeons) if (ticked.has(dungeon.name)) earnedFlat += firstCompletion(dungeon);

    const collections = data.collections.map(collection => {
      const wanted = collection.needs.map(need => need.what);
      const missing = wanted.filter(name => !ticked.has(name));
      return {
        id: collection.id,
        name: collection.name,
        description: collection.description,
        absolute: collection.absolute,
        relative: collection.relative,
        wanted,
        missing,
        have: wanted.length - missing.length,
        done: missing.length === 0,
        // What it is worth in fame at this base, so it can be ranked.
        value: collection.absolute + base * collection.relative / 100
      };
    });

    let earnedPercent = 0;
    let remainingFlat = 0;
    let remainingPercent = 0;
    for (const collection of collections) {
      if (collection.done) { earnedFlat += collection.absolute; earnedPercent += collection.relative; }
      else { remainingFlat += collection.absolute; remainingPercent += collection.relative; }
    }
    // The first completions still to come, from dungeons not yet ticked.
    for (const dungeon of data.dungeons) if (!ticked.has(dungeon.name)) remainingFlat += firstCompletion(dungeon);

    const earnedFame = earnedFlat + base * earnedPercent / 100;
    const remainingFame = remainingFlat + base * remainingPercent / 100;

    return {
      base,
      earnedFlat, earnedPercent, earnedFame,
      remainingFlat, remainingPercent, remainingFame,
      total: base + earnedFame,
      potential: base + earnedFame + remainingFame,
      collections,
      ticked: ticked.size,
      dungeons: data.dungeons.length
    };
  }

  /*
   * The dungeons that finish the most fame for the least work.
   *
   * A dungeon is worth its own first completion plus, for every collection it
   * is the last one missing from, that whole collection. Ordering by that is
   * what turns a list of eighty checkboxes into a plan.
   */
  function nextBest(data, done, baseFame, limit) {
    const ticked = done instanceof Set ? done : new Set(done || []);
    const state = summarise(data, ticked, baseFame);
    const byId = new Map(state.collections.map(entry => [entry.id, entry]));

    return data.dungeons
      .filter(dungeon => !ticked.has(dungeon.name))
      .map(dungeon => {
        let unlocks = [];
        let gain = firstCompletion(dungeon);
        for (const id of dungeon.collections) {
          const collection = byId.get(id);
          // Only counts if this dungeon is the one thing left.
          if (collection && collection.missing.length === 1 && collection.missing[0] === dungeon.name) {
            unlocks.push(collection);
            gain += collection.value;
          }
        }
        return { name: dungeon.name, gain, unlocks, first: firstCompletion(dungeon) };
      })
      .sort((a, b) => b.gain - a.gain || a.name.localeCompare(b.name))
      .slice(0, limit || 5);
  }

  return { parse, summarise, nextBest, firstCompletion };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EnchantFame;
