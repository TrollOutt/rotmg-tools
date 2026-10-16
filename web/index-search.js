/* Weighted Index name search. Record classification and catalogue ownership stay with the caller. */
/**
 * @typedef {Object} IndexSearchFilters Eligibility flags supplied by the catalogue.
 * @property {boolean | readonly string[]} [hidden]
 * @property {boolean} [communityOnly]
 */
/**
 * @typedef {IndexSearchFilters & IndexSearchName} IndexSearchRecord
 * @typedef {Object} IndexSearchName
 * @property {string} id
 * @property {string} kind
 * @property {string} [name]
 * @property {string} [said]
 * @property {string} [clientId]
 * @property {boolean | number} [dev]
 */
/**
 * @template {IndexSearchRecord} R
 * @typedef {[score: number, length: number, record: R]} IndexSearchHit
 */
/**
 * @template {IndexSearchRecord} R
 * @typedef {Object} IndexSearchDependencies
 * @property {() => readonly R[]} getRecords Live catalogue, in its original insertion order.
 * @property {(record: R) => boolean} isTechnical Live picture classification.
 * @property {(record: R) => string} kindSay Live role classification.
 * @property {(record: R) => boolean} isGear Live equipment classification.
 */
var IndexSearch = (function () {
  'use strict';
  /* ---------------- search ---------------- */
  /* What players type for the places they go most. */
  /** @type {Record<string, string>} */
  const SHORT = {
    o1: "Oryx's Castle", o2: "Oryx's Chamber", o3: "Oryx's Sanctuary", lh: 'Lost Halls', mv: 'Moonlight Village',
    udl: 'Undead Lair', ot: 'Ocean Trench', shats: 'The Shatters', shatts: 'The Shatters', cult: 'Cultist Hideout',
    nest: 'The Nest', tomb: 'Tomb of the Ancients', abby: 'Abyss of Demons', dwd: 'Deadwater Docks', lod: 'Lair of Draconis',
    pcave: 'Pirate Cave', wc: 'Wine Cellar', mbc: 'Marble Colossus'
  };
  /**
   * Create once per browse interface. Callbacks are read on each search; cached
   * normalized names retain the original per-record WeakMap lifetime.
   * @template {IndexSearchRecord} R
   * @param {IndexSearchDependencies<R>} deps
   */
  function createSearch(deps) {
    // How much a reader is likely to mean a kind of thing.
    /** @param {R} r */
    const weight = r => {
      if (r.kind === 'portal' || r.kind === 'class' || r.kind === 'status' || r.kind === 'place' || r.kind === 'set' || r.kind === 'event') return 0;
      if (deps.isTechnical(r) || r.dev) return 6;
      if (r.kind === 'enemy') return /Hero|Encounter|Boss|God/.test(deps.kindSay(r)) ? 1 : 3;
      if (deps.isGear(r)) return 1;
      if (r.kind === 'skin' || r.kind === 'enchant') return 2;
      return 3;
    };
    /*
     * Forgiving matching. A name is read as plain words - no apostrophes, no
     * punctuation - so "oryxs castle" finds Oryx's Castle; a plural finds the
     * singular ("mads" finds Mad Lab); and a word of four letters or more may
     * be one letter off (two from seven), so "javlin" still finds the Mad
     * Javelin. It only speaks when the plain matches are few: a typo should
     * rescue a search, not bury a good one under near misses.
     */
    /** @param {unknown} s */
    const plain = s => String(s).toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const STOP = new Set(['of', 'the', 'a']);
    // A name's plain words, worked out once per record rather than on every key.
    /** @type {WeakMap<R, string[]>} */
    const wordsOf = new WeakMap();
    /** @param {R} r */
    const plainWords = r => {
      let got = wordsOf.get(r);
      if (!got) wordsOf.set(r, got = plain(r.said || r.name).split(' ').filter(w => w && !STOP.has(w)));
      return got;
    };
    // Edits between two words, two letters swapped counting as one ("sheild"); gives up past the most allowed.
    /** @param {string} a @param {string} b @param {number} most */
    function near(a, b, most) {
      if (Math.abs(a.length - b.length) > most) return false;
      /** @type {number[] | null} */
      let before = null;
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let low = i;
        for (let j = 1; j <= b.length; j++) {
          row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
          if (row[j] < low) low = row[j];
        }
        if (low > most) return false;
        before = prev; prev = row;
      }
      return prev[b.length] <= most;
    }
    // One typed word against one word of a name: the start of it, its singular, or nearly it.
    /** @param {string} w @param {string} nw */
    function wordFits(w, nw) {
      if (nw.startsWith(w)) return true;
      const one = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : '';
      if (one && nw.startsWith(one)) return true;
      if (w.length < 4) return false;
      const most = w.length >= 7 ? 2 : 1;
      return near(w, nw, most) || (nw.length > w.length && near(w, nw.slice(0, w.length), most));
    }
    /** @param {string} term @returns {IndexSearchHit<R>[]} */
    function rank(term) {
      const t = term.trim().toLowerCase();
      if (!t) return [];
      const words = t.split(/\s+/).filter(w => w && !STOP.has(w));
      const loose = plain(t).split(' ').filter(w => w && !STOP.has(w));
      const meant = SHORT[t] && SHORT[t].toLowerCase();
      /** @type {IndexSearchHit<R>[]} */
      const hits = [];
      /** @type {R[]} */
      const maybe = [];
      for (const r of deps.getRecords()) {
        if (r.hidden || (r.communityOnly && r.kind !== 'place')) continue;
        const n = String(r.said || r.name).toLowerCase();
        const bare = n.replace(/^the\s+/, '');
        let rank;
        if (meant && n === meant) rank = -1;
        else if (n === t || bare === t) rank = 0;
        else if (bare.startsWith(t) || n.startsWith(t)) rank = 1;
        else if (words.length && words.every(w => new RegExp('(^|[\\s\'(-])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n))) rank = 2;
        else if (words.length && words.every(w => n.includes(w))) rank = 3;
        // The client's own name for it, which is what a reader holding a data mine types.
        else if (r.clientId && r.clientId.toLowerCase() !== n && r.clientId.toLowerCase().includes(t)) rank = 3;
        else {
          if (loose.length) maybe.push(r);
          continue;
        }
        hits.push([rank * 10 + weight(r), n.length, r]);
      }
      if (hits.length < 20 && loose.length) {
        for (const r of maybe) {
          const nws = plainWords(r);
          if (loose.every(w => nws.some(nw => wordFits(w, nw)))) hits.push([40 + weight(r), String(r.said || r.name).length, r]);
        }
      }
      hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return hits;
    }

    /** @param {string} term @param {number} [limit] @returns {R[]} */
    function search(term, limit = 60) {
      return rank(term).slice(0, limit).map(h => h[2]);
    }
    return { search, rank };
  }
  return { createSearch };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IndexSearch;
