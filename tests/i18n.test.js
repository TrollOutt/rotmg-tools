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

/*
 * The scatter used to swap between two separate pools by page - portals on
 * the way in and Fame Sweep, enchantment icons everywhere else. It is one
 * mixed pool now, loaded together and shared by every page, without raising
 * the on-screen scatter count above the ~44 it already was.
 */
assert(/async function spritePool\s*\(\s*\)\s*\{[\s\S]{0,200}?Promise\.all\(\[dungeonSprites\(\),\s*ambienceSprites\(\)\]\)/.test(appSource),
  'web/app.js must load dungeon portals and enchantment icons together into one shared pool');
assert(!/wanted === 'dungeon' \? await dungeonSprites\(\) : await ambienceSprites\(\)/.test(appSource),
  'web/app.js must not keep the retired per-page dungeon/enchant pool switch');
assert(!/\(page === 'fame' \|\| page === 'home'\) \? 'dungeon' : 'enchant'/.test(appSource),
  'web/app.js must not keep the retired per-page pool selector');

/*
 * The module sky adopts the atlas' own star language - varied size, varied
 * warmth, a live twinkle, and occasional shooting stars - at CSS cost rather
 * than a second canvas engine. These checks guard the wiring: that the
 * pieces exist, that they are scoped under .starfield so the same opacity
 * rules that keep the field off on the way in keep this off there too, and
 * that no new canvas was reintroduced to draw any of it.
 */
assert(/const TWINKLE_STARS = \d+;/.test(appSource) && /const SHOOTING_STARS = \d+;/.test(appSource)
  && /const SHOOTING_CYCLE = \d+;/.test(appSource),
  'web/app.js must define the module star-language star and shooting-star counts');
assert(/function buildStarLanguage\(/.test(appSource),
  'web/app.js must build the module star language into the shared starfield host');
assert(/^\.starfield \.star-twinkle \{/m.test(styleSource) && /^\.starfield \.shooting-star \{/m.test(styleSource),
  'web/style.css must scope the twinkle stars and shooting stars under .starfield, not as a standalone layer');
assert(!/^\.star-twinkle \{/m.test(styleSource) && !/^\.shooting-star \{/m.test(styleSource),
  'the twinkle stars and shooting stars must not be styled unscoped, or they would show outside the starfield gate');
assert(/@keyframes star-twinkle/.test(styleSource) && /@keyframes shooting-star/.test(styleSource),
  'web/style.css must animate the twinkle and the shooting-star streak');
assert(styleSource.includes('.starfield .star-twinkle, .starfield .shooting-star')
  || (/\.starfield \.star-twinkle[^}]*\{[^}]*animation: none/.test(styleSource)
    && /\.starfield \.shooting-star[^}]*\{[^}]*animation: none/.test(styleSource)),
  'the twinkle stars and shooting stars must stop animating under prefers-reduced-motion like the rest of the starfield');
assert(!/getContext\(['"]2d['"]\)/.test(appSource),
  'web/app.js must not reintroduce a canvas engine to draw the star language');
assert(!/\.starfield canvas|\.ambience canvas/.test(styleSource),
  'web/style.css must not paint any part of the star language on a canvas');

/*
 * The way in keeps showing the atlas' own star language through its planet
 * embed rather than a duplicate full-page field - these are untouched by
 * the module star-language work, so the planet and its single embed must
 * still be exactly what they were.
 */
assert(!/\[data-page="home"\]\s*\.starfield/.test(styleSource),
  'the module star language must not be turned on for the home page');

/*
 * Roughly double the atlas' own meteor pace: the atlas fires METEORS slots
 * every (base + roll() * range) seconds on average, and the module streaks
 * fire SHOOTING_STARS times every SHOOTING_CYCLE seconds. Read straight from
 * both sources rather than hard-coded, so either one drifting out of the
 * ~2x relationship the task called for fails here instead of silently.
 */
const atlasSource = fs.readFileSync(path.join(root, 'web', 'assets', 'atlas', 'index.html'), 'utf8');
const meteorCount = Number((atlasSource.match(/const METEORS = (\d+);/) || [])[1]);
const meteorEvery = atlasSource.match(/every:\s*(\d+)\s*\+\s*roll\(\)\s*\*\s*(\d+)/);
assert(meteorCount && meteorEvery, 'could not read the atlas meteor cadence to compare against');
const atlasHz = meteorCount / (Number(meteorEvery[1]) + Number(meteorEvery[2]) / 2);
const moduleStars = Number((appSource.match(/const SHOOTING_STARS = (\d+);/) || [])[1]);
const moduleCycle = Number((appSource.match(/const SHOOTING_CYCLE = (\d+);/) || [])[1]);
assert(moduleStars && moduleCycle, 'could not read the module shooting-star cadence');
const moduleHz = moduleStars / moduleCycle;
const ratio = moduleHz / atlasHz;
assert(ratio > 1.5 && ratio < 2.5,
  `module shooting stars must fire at roughly 2x the atlas' own pace on the way in (measured ${ratio.toFixed(2)}x)`);

console.log('English-only locale gate, catalogue retention, canonical search, static-control, '
  + 'animations-toggle removal, shared-starfield wiring, module colour-wash/aurora removal, unified '
  + 'sprite pool, and module star-language checks pass.');
