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
  function parse(text, overrideText) {
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

    /*
     * Whether a dungeon is in the realm all year.
     *
     * The client says so itself, in two of the collections: "Hero of the
     * Nexus" wants every standard dungeon and "Season's Beatins" every
     * seasonal one. They do not overlap, and eleven dungeons are in neither —
     * event and rotating content, in no collection at all, so there is nothing
     * to complete by doing them.
     */
    const named = name => {
      const entry = collections.find(collection => collection.name === name);
      return new Set(entry ? entry.needs.map(need => need.what) : []);
    };
    const standard = named('Hero of the Nexus');
    const seasonal = named("Season's Beatins");
    for (const dungeon of dungeons.values()) {
      dungeon.availability = standard.has(dungeon.name) ? 'standard'
        : seasonal.has(dungeon.name) ? 'seasonal' : 'other';
    }
    /*
     * Then the corrections, from data/Fame/availability-overrides.txt.
     *
     * The client's two collections were written when they were true and have
     * drifted: the alien dungeons are permanent content now and it still files
     * them as seasonal. This is the one place a player's knowledge of the live
     * game overrides the installed client, so it is a file with dates and
     * reasons in it rather than a list buried here.
     */
    const corrected = new Set();
    for (const raw of String(overrideText || '').replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const [name, availability] = line.split('|');
      const dungeon = dungeons.get(name);
      if (!dungeon || !availability) continue;
      dungeon.availability = availability;
      corrected.add(name);
    }

    /*
     * What a maxed character is carrying before it does anything.
     *
     * Maxing a stat pays flat fame and a share of the base: 200 and 5 % for
     * life and mana, 100 and 2.5 % for the other six. All eight is 1000 fame
     * and 25 %, and it is assumed here rather than asked for, because nobody
     * planning a fame run is doing it on a character that is not 8/8.
     *
     * It has to be in the sum for the sum to mean anything. Every other bonus
     * in the game — cartography, quests, kills, potions — is flat, so these
     * eight and the collections are between them the whole of the percentage
     * side. Leaving them out does not just lose 1000 fame, it understates
     * every percentage the collections pay on top.
     */
    const maxing = bonuses.filter(bonus => bonus.category === 'Maxing');
    const maxed = {
      stats: maxing.length,
      flat: maxing.reduce((total, bonus) => total + bonus.absolute, 0),
      percent: maxing.reduce((total, bonus) => total + bonus.relative, 0)
    };

    return {
      bonuses,
      collections,
      corrected,
      maxed,
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
      /*
       * What has to be in the realm for this to be finishable at all.
       *
       * The availabilities of the dungeons it still wants — so a collection
       * needing one seasonal dungeon is out of reach while seasonal content
       * is hidden, even though the other eleven are ordinary. Read off what
       * is missing rather than the whole list: the seasonal ones you have
       * already done cannot stop you finishing it.
       */
      const needs = new Set();
      for (const name of missing) {
        const dungeon = data.byName.get(name);
        if (dungeon) needs.add(dungeon.availability);
      }
      return {
        needs: [...needs].sort(),
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
    // Assumed, not asked for: see maxed in parse().
    const maxedFame = data.maxed.flat + base * data.maxed.percent / 100;

    return {
      base,
      maxed: data.maxed, maxedFame,
      earnedFlat, earnedPercent, earnedFame,
      remainingFlat, remainingPercent, remainingFame,
      total: base + maxedFame + earnedFame,
      potential: base + maxedFame + earnedFame + remainingFame,
      collections,
      ticked: ticked.size,
      dungeons: data.dungeons.length
    };
  }

  /*
   * The dungeons to do next, for the collections you picked.
   *
   * This answers one question and not another. Not "what is the best use of
   * an evening in the realm" — that is a different tool and it would rank an
   * easy dungeon in no collection above a hard one that finishes a set. It
   * is "of the things I have said I want, which single run gets me the
   * furthest", so a dungeon that appears in three of the collections you
   * picked beats one that appears in a single one, however cheap.
   *
   * Nothing outside the picked collections is offered at all. A dungeon that
   * none of them wants is not an answer to this question, whatever it pays.
   * And with nothing picked there is no question: the list is empty, and the
   * page puts the panel away rather than filling it with advice about a goal
   * the player has not set.
   *
   * Order: whatever finishes a collection first, because the last dungeon of
   * a set is worth the whole set the moment you walk out. Then the number of
   * picked collections a run moves along. Then the cheapest, the game's own
   * first-completion fame standing in for how hard it is — two dungeons that
   * tick the same boxes are separated by which is the shorter evening.
   *
   * "skip" is the dungeons a player has said they are not doing. They are not
   * ticked — refusing one earns nothing — they are simply not offered, and
   * everything behind them moves up.
   */
  function nextBest(data, done, baseFame, limit, allow, skip, focus) {
    const picked = focus instanceof Set ? focus : new Set(focus || []);
    if (!picked.size) return [];

    const ticked = done instanceof Set ? done : new Set(done || []);
    const state = summarise(data, ticked, baseFame);
    const byId = new Map(state.collections
      .filter(entry => picked.has(entry.id) && !entry.done)
      .map(entry => [entry.id, entry]));
    if (!byId.size) return [];

    return data.dungeons
      .filter(dungeon => !ticked.has(dungeon.name))
      .filter(dungeon => !skip || !skip.has(dungeon.name))
      .filter(dungeon => !allow || allow.has(dungeon.availability))
      .map(dungeon => {
        const unlocks = [];
        const towards = [];
        for (const id of dungeon.collections) {
          const collection = byId.get(id);
          if (!collection) continue;
          if (collection.missing.length === 1) unlocks.push(collection);
          else towards.push(collection);
        }
        return {
          name: dungeon.name,
          first: firstCompletion(dungeon),
          unlocks,
          towards,
          ticks: unlocks.length + towards.length,
          availability: dungeon.availability
        };
      })
      .filter(entry => entry.ticks > 0)
      .sort((a, b) => (b.unlocks.length ? 1 : 0) - (a.unlocks.length ? 1 : 0)
        || b.unlocks.length - a.unlocks.length
        || b.ticks - a.ticks
        || a.first - b.first
        || a.name.localeCompare(b.name))
      .slice(0, limit || 5);
  }

  return { parse, summarise, nextBest, firstCompletion };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EnchantFame;
