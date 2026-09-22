'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const vm = require('vm');

const root = path.join(__dirname, '..');
const localeSource = fs.readFileSync(path.join(root, 'web', 'locales.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(root, 'web', 'i18n.js'), 'utf8');

function runtime({ saved = null, languages = ['en-US'], href = 'https://example.test/?lang=fr',
  wanted = 'de', storage = true } = {}) {
  const kept = new Map(saved ? [['realm-tools/locale', saved]] : []);
  let reloaded = false;
  const document = { readyState: 'loading', documentElement: { lang: '' },
    addEventListener() {}, getElementById() { return null; } };
  const context = { console, Intl, URL, document, REALM_I18N_WANT: wanted,
    navigator: { language: languages[0], languages }, location: { href, reload() { reloaded = true; } },
    localStorage: storage ? { getItem: key => kept.get(key) || null, setItem: (key, value) => kept.set(key, value) }
      : { getItem() { throw new Error('storage is off'); }, setItem() { throw new Error('storage is off'); } },
    CustomEvent: function CustomEvent() {}, MutationObserver: function MutationObserver() {},
    Element: function Element() {}, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, NodeFilter: {} };
  context.window = context;
  vm.runInNewContext(localeSource, context, { filename: 'locales.js' });
  vm.runInNewContext(engineSource, context, { filename: 'i18n.js' });
  return { api: context.RealmI18n, catalogues: context.REALM_TOOLS_LOCALES, document, kept, reloaded: () => reloaded };
}

for (const input of [
  { saved: 'fr', languages: ['de-DE'], href: 'https://example.test/?lang=ru', wanted: 'pt-BR' },
  { saved: 'auto', languages: ['zh-Hans'], href: 'https://example.test/#lang=es', wanted: 'fr' },
  { saved: 'de', languages: ['fr-FR'], storage: false }
]) {
  const site = runtime(input);
  assert.equal(site.api.locale, 'en');
  assert.equal(site.api.detected, 'en');
  assert.equal(site.api.following, false);
  assert.equal(site.document.documentElement.lang, 'en');
  assert.deepEqual(Array.from(site.api.locales), ['en']);
  assert.deepEqual(Array.from(site.api.options(), row => row.value), ['en']);
  assert.equal(site.api.options()[0].on, true);
  assert.equal(site.api.t('common.search'), 'Search');
  assert.equal(site.api.number(2.25), '2.25');
  assert.equal(site.api.canonicalSearch('dex pot'), 'potion of dexterity');
  assert.equal(site.api.label('Potion of Dexterity'), 'Potion of Dexterity');
  assert.equal(site.api.match('fr-FR'), null);
  assert.equal(site.api.match('en-GB'), 'en');
  assert.doesNotThrow(() => site.api.setLocale('fr'));
  assert.equal(site.api.locale, 'en');
  assert.equal(site.kept.get('realm-tools/locale'), input.saved || undefined,
    'selection API must not persist a disabled locale choice');
  assert.equal(site.reloaded(), false, 'selection API must not reload an English-only page');
}

assert(!/mountSelector|buildMenu|paintSelector|langOpen|data-locale/.test(engineSource),
  'the English-only runtime must not contain a language-control implementation');
assert(!/\b(navigator|localStorage|sessionStorage|location|REALM_I18N_WANT)\b/.test(engineSource),
  'the runtime must not consult browser, storage, address, or frame locale inputs');
for (const file of ['web/index.html', 'web/skins/view.html', 'web/assets/atlas/index.html']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!/id=["']lang(Open|Box|Menu)["']|data-locale|class=["'][^"']*lang-pick/.test(source),
    file + ' must not contain a static locale control');
}

const first = runtime();
assert(Object.keys(first.catalogues).length > 1, 'non-English source catalogues must remain for reactivation');
const canonicalIndexTaxonomy = {
  'index.group.tier': 'Tier', 'index.chip.untiered': 'Untiered', 'index.chip.setTier': 'Set tier',
  'index.chip.soulbound': 'Soulbound', 'index.chip.shiny': 'Shiny', 'index.fact.tier': 'Tier', 'index.loot.tiered': 'Tiered'
};
for (const messages of Object.values(first.catalogues)) {
  for (const [key, term] of Object.entries(canonicalIndexTaxonomy)) assert.equal(messages[key], term);
}
const indexSource = fs.readFileSync(path.join(root, 'web', 'index-page.js'), 'utf8');
assert(indexSource.includes('esc(text)'), 'record descriptions must stay rendered as source data');
assert(!indexSource.includes('RealmI18n.label(text)'), 'record descriptions must not be localized as UI copy');
assert.equal(first.api.canonicalSearch('Potion of Dexterity'), 'potion of dexterity');

/*
 * The corner used to carry a visible "Animations on/off" switch. It is gone
 * now - the drifting background stays capable of animating and still
 * defers to prefers-reduced-motion, just with no user-facing control left
 * behind to rot: no button, no click wiring, no storage key, nothing in
 * Theory Crafting still reaching for the element that used to hold it, and
 * nothing in the site benchmark still clicking it for an on/off comparison.
 */
const homeSource = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
assert(!/ambienceToggle|ambience-toggle/.test(homeSource),
  'web/index.html must not contain the removed animations-toggle markup');
const appSource = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
assert(!/ambienceToggle|AMBIENCE_KEY/.test(appSource),
  'web/app.js must not wire up or persist the removed animations toggle');
const theorySource = fs.readFileSync(path.join(root, 'web', 'theorycraft.js'), 'utf8');
assert(!/ambienceToggle/.test(theorySource),
  'web/theorycraft.js must not query the removed animations-toggle element');
assert(/prefers-reduced-motion/.test(theorySource),
  'web/theorycraft.js must still defer to prefers-reduced-motion');
const benchSource = fs.readFileSync(path.join(root, 'tools', 'bench.js'), 'utf8');
assert(!/ambienceToggle/.test(benchSource),
  'tools/bench.js must not query or click the removed animations-toggle element');

/*
 * The starfield: one shared sky for the tool pages, and the planet kept out
 * of it. These are static checks rather than a rendered page, so what they
 * guard is the wiring - that the sky is named once, sits behind the aurora
 * and sprite scatter instead of on top of them, and is never turned on for
 * the way in - not how the gradient actually looks.
 */
const styleSource = fs.readFileSync(path.join(root, 'web', 'style.css'), 'utf8');
assert.equal((homeSource.match(/class="starfield"/g) || []).length, 1,
  'web/index.html must define exactly one shared starfield layer');
assert(homeSource.indexOf('class="starfield"') < homeSource.indexOf('id="ambience"'),
  'the starfield must sit before .ambience in the document so the aurora and sprite scatter paint over it');
assert(/^\.starfield \{/m.test(styleSource), 'web/style.css must style the shared starfield layer');
for (const page of ['enchant', 'fame', 'theory', 'index', 'skins', 'news']) {
  assert(styleSource.includes(`body[data-page="${page}"] .starfield`),
    `web/style.css must show the starfield on the ${page} tool page`);
}
assert(!/\[data-page="home"\]\s*\.starfield|\.starfield[^{]*:not\(\[data-page="home"\]\)/.test(styleSource),
  'the starfield must not be enabled for the home page, by name or by a not() default-on selector');
assert(styleSource.includes('.starfield { transition: none; }') && styleSource.includes('.starfield::before { animation: none; }'),
  'the starfield must stop drifting under prefers-reduced-motion like the rest of the ambience');
const globeMarkup = homeSource.match(/id="globeBox"/g) || [];
assert.equal(globeMarkup.length, 1, 'the atlas planet embed must appear exactly once');
const pageHomeSpan = homeSource.slice(homeSource.indexOf('id="pageHome"'), homeSource.indexOf('id="pageSkins"'));
assert(pageHomeSpan.includes('id="globeBox"'),
  'the planet embed must live inside #pageHome, not a tool page');

/*
 * The painted colour wash and the aurora used to tint every tool page from a
 * shared "realm". The wash is gone outright - no page paints it any more -
 * and the aurora is now the way in's own richer identity, so a module or
 * tool page shows the starfield through nothing but a small, dense sprite
 * scatter. These guard the wiring against regressing back, not the exact
 * look of the scatter.
 */
assert(!/\.ambience canvas/.test(styleSource),
  'web/style.css must not paint the retired colour-wash canvas on any page');
assert(!/@keyframes drift\b/.test(styleSource),
  'web/style.css must not keep the retired colour-wash drift animation');
assert(!/\bpaintRealm\b/.test(appSource),
  'web/app.js must not keep the retired canvas colour-wash painter');
for (const page of ['enchant', 'fame', 'theory', 'index', 'skins', 'news']) {
  assert(styleSource.includes(`body[data-page="${page}"] .aurora`),
    `web/style.css must turn the aurora off on the ${page} tool page`);
}
assert(!/\[data-page="home"\]\s*\.aurora/.test(styleSource),
  'the aurora must stay on for the home page, by name or by a not() default-on selector');
assert(/for \(let i = 0; i < 44; i\+\+\)/.test(appSource) && /const size = 3\.5 \+ random\(\) \* 8;/.test(appSource),
  'web/app.js must keep the DOM sprite scatter smaller and denser than the old colour-wash-era params');
assert(styleSource.includes('filter: blur(2px) saturate(1.1);'),
  'web/style.css must keep the DOM sprite scatter blur subtle for its smaller size');

console.log('English-only locale gate, catalogue retention, canonical search, static-control, '
  + 'animations-toggle removal, shared-starfield wiring, and module colour-wash/aurora removal checks pass.');
