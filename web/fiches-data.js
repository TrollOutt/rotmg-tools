/* Supplementary Index card data. Loading phases are scheduled by the card adapter. */
/** @typedef {{ id: string, clientId?: string, name?: string, about?: string }} FichesDataRecord */
/** @typedef {{ facts?: Record<string, string>, presentation?: { summary?: string } }} FichesCommunityEntry */
/** @typedef {{ records?: Record<string, FichesCommunityEntry> }} FichesCommunityPayload */
/** @typedef {{ facts: Record<string, string>, notes: string, prose: string[], variants: string }} FichesCommunity */
/** @typedef {Record<string, { power?: number | string | null, [key: string]: unknown }>} FichesForgeTable */
/** @typedef {{ realmeyeEnrichmentText?: string, clientForgeText?: string }} FichesDataSources */
/**
 * @typedef {Object} FichesDataDependencies
 * @property {() => FichesDataSources | null | undefined} getSources Read the current bundle at each original loading phase.
 * @property {(url: string) => Promise<FichesCommunityPayload>} fetchCommunity Current HTTP reader, invoked only without kept text.
 * @property {(url: string) => Promise<FichesForgeTable | null | undefined>} fetchForge
 * @property {() => void} settled The adapter owns pending counts and redraws.
 */
var FichesData = (() => {
  'use strict';
  /** @param {FichesDataDependencies} deps */
  function createCardData(deps) {
    /** @type {Record<string, FichesCommunityEntry> | null} */
    let reRecords = null;
    /** @type {string | undefined} */
    let keptEnrichment;
    /** @type {FichesForgeTable | null} */
    let clientExtra = {};
    /** @type {string | undefined} */
    let keptForge;

    // Called once at each original phase. Reading does not retry a failed load.
    // Kept strings are snapshots of those phases, decoded only on first use.
    function loadCommunity() {
      keptEnrichment = (deps.getSources() || {}).realmeyeEnrichmentText;
      if (keptEnrichment) Promise.resolve().finally(deps.settled);
      else deps.fetchCommunity('assets/index/realmeye-enrichment.json')
        .then(j => { reRecords = j.records || {}; }).catch(() => { reRecords = {}; }).finally(deps.settled);
    }
    function communityRecords() {
      if (reRecords === null && keptEnrichment) {
        try { reRecords = JSON.parse(keptEnrichment).records || {}; } catch (err) { reRecords = {}; }
      }
      return reRecords || {};
    }
    function loadForge() {
      keptForge = (deps.getSources() || {}).clientForgeText;
      clientExtra = keptForge ? null : {};
      if (keptForge) Promise.resolve().finally(deps.settled);
      else deps.fetchForge('assets/index/client-forge.json')
        .then(j => { clientExtra = j || {}; }).catch(() => {}).finally(deps.settled);
    }
    function forgeExtra() {
      if (clientExtra === null && keptForge) {
        try { clientExtra = JSON.parse(keptForge) || {}; } catch (err) { clientExtra = {}; }
      }
      return /** @type {FichesForgeTable} */ (clientExtra);
    }
    const SUMMARY_LABELS = ['Tier Grouped Drops', 'Blueprint', 'Drops From', 'Obtained Through', 'Tier', 'On Equip',
      'Effect(s)', 'MP Cost', 'XP Bonus', 'Soulbound', 'Feed Power', 'Forging Cost', 'Dismantling Value', 'Dust Type',
      'Loot Bag', 'Notes', 'Shots', 'Damage', 'Projectile Speed', 'Lifetime', 'Range', 'Rate of Fire', 'Reskin(s)',
      'Upgrade', 'Reactive Proc', 'Potion', 'Consumed with use', 'Amplitude', 'Frequency', 'Power Level', 'Cooldown'];
    const LABEL_RX = new RegExp('(?:^|\\s)(' + SUMMARY_LABELS.slice().sort((a, b) => b.length - a.length)
      .map(x => x.replace(/[()]/g, '\\$&')).join('|') + ')(?=\\s|$)', 'g');

    /*
     * 1 191 objets sur 3 134 n'ont que le résumé aplati de leur page RealmEye,
     * sans champs. On relit ce résumé pour les quelques champs sûrs ; dans le
     * vrai site, cela appartient au générateur, pas à la page.
     */
    /** @param {string | null | undefined} text @param {string | null | undefined} about */
    function parseSummary(text, about) {
      let body = String(text || '');
      if (about && body.startsWith(about)) body = body.slice(about.length);
      const hits = [...body.matchAll(LABEL_RX)];
      if (hits.length < 2) return { prose: body.trim(), fields: {} };
      /** @type {Record<string, string>} */
      const fields = {};
      let blueprint = false;
      hits.forEach((m, i) => {
        const label = m[1];
        const from = m.index + m[0].length;
        const to = label === 'Notes' ? body.length : (hits[i + 1] ? hits[i + 1].index : body.length);
        const value = body.slice(from, to).trim();
        if (label === 'Blueprint') { blueprint = true; return; }
        const key = (blueprint && /Drops From|Obtained Through/.test(label) ? 'Blueprint ' : '') + label;
        if (!(key in fields)) fields[key] = value;
      });
      return { prose: '', fields };
    }

    /** @param {FichesDataRecord} r @returns {FichesCommunity} */
    function communityOf(r) {
      const data = communityRecords()[r.id] || null;
      /** @type {FichesCommunity} */
      const out = { facts: {}, notes: '', prose: [], variants: '' };
      if (!data) return out;
      const f = data.facts || {};
      /** @param {string} k @param {...string} names */
      const pick = (k, ...names) => { for (const n of names) if (f[n]) { out.facts[k] = f[n]; return; } };
      pick('power', 'power_level'); pick('xp', 'xp_bonus', 'total_xp_bonus'); pick('feed', 'feed_power');
      pick('dismantle', 'dismantling_value'); pick('forge', 'forging_cost'); pick('dust', 'dust_type');
      pick('bag', 'loot_bag'); pick('effect', 'effect_s'); pick('got', 'obtained_through');
      const summary = (data.presentation && data.presentation.summary) || '';
      const parsed = parseSummary(summary, r.about);
      const F = parsed.fields;
      /** @param {string} k @param {string | undefined} v @param {RegExp} rx */
      const ok = (k, v, rx) => { if (!out.facts[k] && v && rx.test(v)) out.facts[k] = v; };
      ok('xp', F['XP Bonus'], /^\d+%$/);
      ok('feed', F['Feed Power'], /^[\d,]+$/);
      ok('dismantle', F['Dismantling Value'], /^[\d\s/]+$/);
      ok('forge', F['Forging Cost'], /^[\w\s/()]+$/);
      ok('power', F['Power Level'], /^\d+$/);
      if (F['Notes']) out.notes = F['Notes'].replace(/^TBA\s+/, '');
      out.variants = [F['Reskin(s)'] && 'Reskin: ' + F['Reskin(s)'], F['Upgrade'] && 'Upgrade: ' + F['Upgrade']]
        .filter(Boolean).join(' · ');
      /* De la prose seulement si c'en est : une table des matières n'en est pas. */
      if (parsed.prose && /[a-z]\.(\s|$)/.test(parsed.prose)) out.prose.push(parsed.prose);
      return out;
    }

    /** @param {FichesDataRecord} r @param {FichesCommunity} com */
    const powerOf = (r, com) => { const cx = forgeExtra()[/** @type {string} */ (r.clientId || r.name)] || {}; return cx.power !== undefined ? String(cx.power) : com.facts.power || ''; };
    return { loadCommunity, loadForge, communityRecords, forgeExtra, parseSummary, communityOf, powerOf };
  }
  return { createCardData };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FichesData;
