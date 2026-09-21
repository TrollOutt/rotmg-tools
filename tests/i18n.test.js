'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const vm = require('vm');

const root = path.join(__dirname, '..');
const localeSource = fs.readFileSync(path.join(root, 'web', 'locales.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'web', 'i18n.js'), 'utf8');

/*
 * The language layer on its own, with a browser made of five objects.
 *
 * Everything that decides which language a page is in - what was stored, what
 * the address asked for, what the browser says it reads - arrives through one
 * of those five, so a run of this file can put a visitor from anywhere in
 * front of the site without a browser being involved. The selector is not
 * built here: `readyState` says loading and nothing ever fires, which is what
 * keeps this a test of the decision rather than of the DOM.
 */
function runtime({ saved = null, languages = ['en-US'], href = 'https://example.test/',
  storage = true, beforeEngine } = {}) {
  const kept = new Map(saved ? [['realm-tools/locale', saved]] : []);
  let reloaded = false;
  const document = {
    readyState: 'loading', documentElement: { lang: '' },
    addEventListener() {}, getElementById() { return null; }
  };
  const context = {
    console, Intl, URL, document,
    navigator: { language: languages[0], languages },
    location: { href, reload() { reloaded = true; } },
    localStorage: storage
      ? { getItem: key => kept.get(key) || null, setItem: (key, value) => kept.set(key, value) }
      : { getItem() { throw new Error('storage is off'); }, setItem() { throw new Error('storage is off'); } },
    CustomEvent: function CustomEvent() {}, MutationObserver: function MutationObserver() {},
    Element: function Element() {}, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, NodeFilter: {}
  };
  context.window = context;
  vm.runInNewContext(localeSource, context, { filename: 'locales.js' });
  if (beforeEngine) beforeEngine(context.REALM_TOOLS_LOCALES);
  vm.runInNewContext(engineSource, context, { filename: 'i18n.js' });
  return { api: context.RealmI18n, catalogues: context.REALM_TOOLS_LOCALES,
    document, kept, reloaded: () => reloaded };
}

/* ------------------------------------------------------------------ *
 * What a language tag means                                           *
 * ------------------------------------------------------------------ */

const { api: tags } = runtime();
const maps = {
  'fr-FR': 'fr', 'fr-CA': 'fr', 'fr-BE': 'fr', fr: 'fr',
  'pt-BR': 'pt-BR', 'pt-PT': 'pt-PT', pt: 'pt-PT', 'pt-AO': 'pt-PT',
  'es-ES': 'es', 'es-MX': 'es', 'es-AR': 'es',
  'de-DE': 'de', 'de-AT': 'de', 'de-CH': 'de',
  'ru-RU': 'ru', 'pl-PL': 'pl', 'tr-TR': 'tr', 'fi-FI': 'fi',
  'it-IT': 'it', 'sv-SE': 'sv', 'da-DK': 'da',
  'zh-CN': 'zh-CN', 'zh-SG': 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-Hans-CN': 'zh-CN', zh: 'zh-CN',
  'en-US': 'en', 'en-GB': 'en', 'en-CA': 'en', 'en-AU': 'en',
  en_GB: 'en'
};
for (const [tag, want] of Object.entries(maps)) {
  assert.equal(tags.match(tag), want, `${tag} must resolve to ${want}`);
}
/* Nothing is guessed at: a language with no catalogue says so, and the caller
   moves on to whatever the reader asked for next. Traditional Chinese is here
   on purpose - the catalogue is Simplified, and the two are not swappable. */
for (const tag of ['ja-JP', 'ko', 'nl-NL', 'zh-TW', 'zh-Hant', 'zh-HK', 'xx', '', null]) {
  assert.equal(tags.match(tag), null, `${tag} has no catalogue and must not be forced into one`);
}

/* ------------------------------------------------------------------ *
 * Which language a visitor gets                                       *
 * ------------------------------------------------------------------ */

/* Nobody has said anything: the browser decides, and that is automatic. */
const first = runtime({ languages: ['fr-FR', 'en-US'] });
assert.equal(first.api.locale, 'fr');
assert.equal(first.api.following, true, 'a first visit follows the browser');
assert.equal(first.document.documentElement.lang, 'fr');

/* A choice outlives the browser setting that disagrees with it. */
const chosen = runtime({ saved: 'de', languages: ['fr-FR'] });
assert.equal(chosen.api.locale, 'de', 'a stored choice wins over detection');
assert.equal(chosen.api.following, false);
assert.equal(chosen.api.detected, 'fr', 'and detection still knows what it would have picked');

/* Asking for the detection back starts it up again. */
const back = runtime({ saved: 'auto', languages: ['fr-FR'] });
assert.equal(back.api.locale, 'fr', 'auto means detect again on every visit');
assert.equal(back.api.following, true);

/* A browser with nothing this site speaks falls back to English rather than to
   the first catalogue that happens to be listed. */
const stranger = runtime({ languages: ['ja-JP', 'ko-KR'] });
assert.equal(stranger.api.locale, 'en');
assert.equal(stranger.api.following, true);

/* Portuguese and Chinese, end to end rather than tag by tag. */
assert.equal(runtime({ languages: ['pt-BR'] }).api.locale, 'pt-BR');
assert.equal(runtime({ languages: ['pt-PT'] }).api.locale, 'pt-PT');
assert.equal(runtime({ languages: ['zh-Hans'] }).api.locale, 'zh-CN');
assert.equal(runtime({ languages: ['es-MX'] }).api.locale, 'es');
assert.equal(runtime({ languages: ['de-CH'] }).api.locale, 'de');

/* The address can show one page in one language without changing anybody's
   mind, and it says so: a language from a link is a language somebody asked
   for, not one that was detected. */
const linked = runtime({ href: 'https://example.test/?lang=de', languages: ['fr-FR'] });
assert.equal(linked.api.locale, 'de');
assert.equal(linked.api.following, false);
assert.equal(linked.kept.get('realm-tools/locale'), undefined, 'a link must not rewrite a preference');

/* And it sits under a choice that was actually made. */
const stubborn = runtime({ saved: 'en', href: 'https://example.test/?lang=de', languages: ['fr-FR'] });
assert.equal(stubborn.api.locale, 'en', 'a stored choice outranks the address');

/* A browser that refuses storage still reads the site in its own language. */
const sealed = runtime({ languages: ['fr-FR'], storage: false });
assert.equal(sealed.api.locale, 'fr');
assert.equal(sealed.api.following, true);
assert.doesNotThrow(() => sealed.api.setLocale('de'), 'choosing with no storage must not throw');

/* ------------------------------------------------------------------ *
 * Choosing                                                            *
 * ------------------------------------------------------------------ */

const switching = runtime({ saved: 'en' });
switching.api.setLocale('de');
assert.equal(switching.kept.get('realm-tools/locale'), 'de');
assert(switching.reloaded(), 'changing locale must rerender the complete application');

/* What is written down is the answer, not the language it resolved to: this is
   the difference between following the browser and being stuck on whatever it
   said the first time. */
const releasing = runtime({ saved: 'de', languages: ['fr-FR'] });
releasing.api.setLocale('auto');
assert.equal(releasing.kept.get('realm-tools/locale'), 'auto');
assert(releasing.reloaded(), 'going back to automatic changes the language here');

/* Automatic that lands on the language already showing changes the control and
   nothing else - there is no reason to reload a page that would come back the
   same, and every reason not to. */
const quiet = runtime({ saved: 'fr', languages: ['fr-FR'] });
quiet.api.setLocale('auto');
assert.equal(quiet.kept.get('realm-tools/locale'), 'auto');
assert.equal(quiet.api.locale, 'fr');
assert.equal(quiet.api.following, true);
assert.equal(quiet.reloaded(), false, 'the same words on the screen need no reload');

/* ------------------------------------------------------------------ *
 * What the selector is made of                                        *
 * ------------------------------------------------------------------ */

const menu = runtime({ languages: ['fr-FR'] });
const rows = menu.api.options();
assert.equal(rows.length, menu.api.locales.length + 1, 'every language, and automatic above them');
assert.equal(rows.length, 15);
assert.equal(rows[0].value, 'auto', 'automatic is offered first');
assert.deepEqual(rows.slice(1).map(row => row.value), menu.api.locales);
for (const row of rows) {
  assert(row.flag && row.flag.length, `${row.value} must carry a flag`);
  assert(row.name && row.name.trim(), `${row.value} must carry its own name`);
}
assert.equal(rows.filter(row => row.on).length, 1, 'exactly one row is the current one');
assert.equal(rows[0].on, true, 'and on a first visit that row is automatic');
/* Automatic says what it found, so nobody has to choose it to find out. */
assert.equal(rows[0].found.value, 'fr');
assert.equal(rows[0].found.name, 'Français');
assert(rows[0].found.flag, 'the detected language is shown with its flag too');
assert.equal(rows[0].name, menu.api.t('language.auto'));
assert.notEqual(rows[0].name, 'language.auto', 'the automatic row must be translated, not keyed');

const picked = runtime({ saved: 'de', languages: ['fr-FR'] }).api.options();
assert.equal(picked[0].on, false, 'automatic is off once a language has been chosen');
assert.equal(picked.find(row => row.value === 'de').on, true);
assert.equal(picked[0].found.value, 'fr', 'and it still reports what it would detect');

/* The names and flags are the site's own list, checked here rather than in the
   markup, because the markup no longer has one. */
for (const code of menu.api.locales) {
  assert(menu.api.flags[code], `${code} has no flag`);
  assert(menu.api.names[code], `${code} has no name`);
}
assert(menu.api.flags.auto, 'automatic has a globe');
assert.equal(new Set(Object.values(menu.api.flags)).size, menu.api.locales.length + 1,
  'no two languages share a flag');

/* ------------------------------------------------------------------ *
 * Catalogues, numbers and the things ROTMG will not have translated   *
 * ------------------------------------------------------------------ */

const french = runtime({ saved: 'fr' });
assert.equal(french.api.locale, 'fr', 'saved locale must win detection');
assert.equal(french.document.documentElement.lang, 'fr');
assert.equal(french.api.t('common.search'), 'Rechercher');
assert.equal(french.api.number(2.25), '2,25');
assert.equal(french.api.canonicalSearch('dextérité'), 'dexterity');
assert.equal(french.api.canonicalSearch('dex pot'), 'potion of dexterity');
assert.equal(french.api.t('DEX'), 'DEX', 'technical stat code must remain unchanged');
assert.equal(french.api.t('Potion of Dexterity'), 'Potion of Dexterity', 'canonical item name must remain unchanged');
assert.match(french.api.label('Armored'), /\(Armored\)$/, 'localized status keeps its canonical label accessible');
assert.equal(french.api.label('Potion of Dexterity'), 'Potion of Dexterity');

/*
 * A hole in a catalogue line holds what it says it holds.
 *
 * `{count} thing` used to be turned into "anything ending in the word thing",
 * which is how the Index came to offer a filter called "Kind of coisa" and the
 * Skin Viewer a "Pet pele". A count is a number; a phrase that happens to end
 * in the same word is not a count, and is left exactly as it was.
 */
const brazilian = runtime({ saved: 'pt-BR' });
assert.equal(brazilian.api.label('Uncatalogued sentinel thing'), 'Uncatalogued sentinel thing',
  'a phrase ending in a catalogued word must not be half-translated');
assert.equal(brazilian.api.label('Pet skin'), 'Pet skin');
assert.equal(brazilian.api.label('Weapon items'), 'Weapon items');
assert.notEqual(brazilian.api.label('12 things'), '12 things',
  'while a real count still reads as one');
assert.match(brazilian.api.label('12 things'), /^12 /, 'and keeps the number it was given');

// A missing localized key falls back to the English catalogue, never to a raw empty value.
const fallback = runtime({ saved: 'fr', beforeEngine: catalogues => { delete catalogues.fr['common.search']; } });
assert.equal(fallback.api.t('common.search'), 'Search');

/* Index cards are rendered after the initial DOM localization pass, so their
   variable copy must use catalogued semantic keys rather than raw English. */
const indexSource = fs.readFileSync(path.join(root, 'web', 'index-page.js'), 'utf8');
for (const key of ['index.results.firstOf', 'index.built.summary', 'index.source.readFrom']) {
  assert(indexSource.includes(`t('${key}'`), `Index runtime copy must use ${key}`);
  assert.equal(typeof french.api.t(key), 'string', `${key} must resolve for every locale`);
  assert.notEqual(french.api.t(key), key, `${key} must not leak as an i18n key`);
}
assert(indexSource.includes('esc(text)'), 'record descriptions must stay rendered as source data');
assert(!indexSource.includes("RealmI18n.label(text)"), 'record descriptions must not be localized as UI copy');

const indexTool = fs.readFileSync(path.join(root, 'tools', 'translate-static-i18n.js'), 'utf8');
assert(indexTool.includes('translateAll(target, indexRows, locale)'),
  'Index locale generation must retain each locale as its own offline fallback');
assert(!indexTool.includes("target === 'pt' ? 'pt-PT' : target"),
  'Portuguese offline fallback must not route Brazilian Portuguese through pt-PT');

const canonicalIndexTaxonomy = {
  'index.group.tier': 'Tier',
  'index.chip.untiered': 'Untiered',
  'index.chip.setTier': 'Set tier',
  'index.chip.soulbound': 'Soulbound',
  'index.chip.shiny': 'Shiny',
  'index.fact.tier': 'Tier', 'index.loot.tiered': 'Tiered'
};
for (const [locale, messages] of Object.entries(first.catalogues)) {
  for (const [key, term] of Object.entries(canonicalIndexTaxonomy)) {
    assert.equal(messages[key], term, `${locale} must retain the canonical Index taxonomy ${term}`);
  }
}
const taxonomyCompounds = {
  'index.loot.tieredLoot': 'Tier', 'index.loot.untieredGear': 'Untier',
  'index.loot.setTierGear': 'Set', 'index.relation.setPieces': 'Set',
  'index.relation.tierDropLocations': 'Tier', 'index.relation.listedTierDrops': 'Tier'
};
for (const [locale, messages] of Object.entries(first.catalogues)) {
  if (locale === 'en') continue;
  for (const [key, token] of Object.entries(taxonomyCompounds)) {
    assert(messages[key].includes(token), `${locale} must retain ${token} in ${key}`);
    assert.notEqual(messages[key], first.catalogues.en[key],
      `${locale} must translate the surrounding words in ${key}`);
  }
}
assert.equal(first.catalogues.fr['index.results.firstOf'], '{total} premier {affiché} sur {shown}',
  'French first-of wording and placeholder order must retain the approved pre-taxonomy value');
assert.equal(first.catalogues.tr['index.results.firstOf'], '{total} {shown} içinden ilk {gösterilen}',
  'Turkish first-of wording and placeholder order must retain the approved pre-taxonomy value');

console.log('i18n detection, automatic mode, preference order, selector contents, persistence, '
  + 'locale numbers, search aliases and canonical ROTMG values pass.');
