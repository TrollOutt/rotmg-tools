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
assert(styleSource.includes('.starfield { transition: none; }') && !/star-drift/.test(styleSource),
  'the static starfield must not retain a drifting normal-star layer');
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
assert(/function spritePool\s*\(\s*\)\s*\{[\s\S]{0,300}?Promise\.all\(\[dungeonSprites\(\),\s*ambienceSprites\(\)\]\)/.test(appSource),
  'web/app.js must load dungeon portals and enchantment icons together into one shared pool');
assert(!/wanted === 'dungeon' \? await dungeonSprites\(\) : await ambienceSprites\(\)/.test(appSource),
  'web/app.js must not keep the retired per-page dungeon/enchant pool switch');
assert(!/\(page === 'fame' \|\| page === 'home'\) \? 'dungeon' : 'enchant'/.test(appSource),
  'web/app.js must not keep the retired per-page pool selector');
/*
 * Codex-flagged: a pre-data (portal-only) fetch resolving after a post-data
 * (complete) one must not be allowed to overwrite it - completeness, not
 * arrival order, must gate what gets applied. The behavioural proof is the
 * async ordering test further down; these are the wiring it depends on.
 */
assert(/const complete = Boolean\(state\.data\);/.test(appSource),
  'web/app.js\'s spritePool must know at call time whether this fetch can be the complete one');
assert(/ambience\.poolPromise/.test(appSource) && /ambience\.poolComplete/.test(appSource),
  'web/app.js must memoize the sprite pool and track whether a complete fetch has already landed');
assert(!/ambience\.poolLoaded/.test(appSource),
  'web/app.js must not keep the retired poolLoaded flag that could not tell a partial fetch from a complete one');

/*
 * The module sky keeps the Atlas' normal field static: its actual fixed-seed
 * 460-star distribution is painted to one DPR-aware canvas on initialisation
 * and resize only. Meteors remain the sole animated pieces.
 */
assert(/const MODULE_STARS = 460;/.test(appSource) && /const SHOOTING_STARS = \d+;/.test(appSource)
  && /const SHOOTING_CYCLE = \d+;/.test(appSource),
  'web/app.js must define the module star-language star and shooting-star counts');
assert(/function buildStarLanguage\(/.test(appSource),
  'web/app.js must build the module star language into the shared starfield host');
const moduleStarSource = appSource.slice(appSource.indexOf('function buildStarLanguage('),
  appSource.indexOf('/*\n * The drifting realms'));
assert(/className = 'module-star-canvas'/.test(appSource) && /^\.starfield \.module-star-canvas \{/m.test(styleSource),
  'the module field must be one canvas scoped inside the shared starfield host');
assert(/Math\.imul\(value, 1664525\) \+ 1013904223/.test(appSource)
  && /Math\.pow\(random\(\), 4\)/.test(appSource)
  && /0\.16 \+ lit \* 0\.84/.test(appSource)
  && /0\.5 \+ lit \* 1\.5/.test(appSource),
  'the module canvas must retain the Atlas seed, fourth-power brightness, and star sizing math');
assert(/window\.devicePixelRatio/.test(appSource) && /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/.test(appSource),
  'the module canvas must scale its backing store and drawing coordinates for device pixel ratio');
assert(/window\.addEventListener\('resize', paintStars\)/.test(appSource),
  'the module canvas must repaint when its viewport size changes');
assert(!/requestAnimationFrame|star-twinkle|TWINKLE_STARS/.test(moduleStarSource),
  'the module normal-star field must not use a frame loop or DOM twinkles');
assert(/^\.starfield \.shooting-star \{/m.test(styleSource) && /@keyframes shooting-star/.test(styleSource),
  'web/style.css must keep shooting stars scoped under the starfield');
assert(/linear-gradient\(90deg, rgba\(236, 244, 255, 0\), rgba\(236, 244, 255, \.9\)\)/.test(styleSource),
  'shooting stars must fade from their transparent -X tail to their bright +X head');

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

/*
 * A real race, not just a source pattern: routing can ask for the sprite
 * pool before the enchant data is read (spritePool only gets the portals
 * then), and the data load finishing asks for it again once it is (the
 * complete, mixed pool). Nothing orders the two underlying fetches - a slow
 * portal image can settle after the fast complete one - so a naive "last
 * write wins" lets the early, partial result land second and clobber the
 * complete one. This drives the actual spritePool/usePool source from
 * web/app.js, sliced out and run for real with fully-controlled promises,
 * to prove completeness decides the winner rather than arrival order.
 */
(async () => {
  function extractBlock(name, startMarker) {
    const start = appSource.indexOf(startMarker);
    assert(start !== -1, `sprite-pool ordering test: could not find "${startMarker}" (${name}) in web/app.js`);
    const end = appSource.indexOf('\n}', start + startMarker.length);
    assert(end !== -1, `sprite-pool ordering test: could not find the end of "${startMarker}" (${name}) in web/app.js`);
    const block = appSource.slice(start, end + 2);
    let depth = 0;
    for (const ch of block) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    assert.equal(depth, 0,
      `sprite-pool ordering test: "${name}" extraction is unbalanced - its markers in web/app.js may be stale`);
    return block;
  }
  const sliceScript = extractBlock('ambience state', 'const ambience = {') + ';\n\n'
    + extractBlock('spritePool', 'function spritePool() {') + '\n\n'
    + extractBlock('usePool', 'async function usePool() {') + '\n\n'
    + 'this.__probe = { ambience, spritePool, usePool };\n';

  function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  }
  const calls = { dungeon: [], enchant: [] };
  const context = {
    state: { data: null },
    dungeonSprites: () => { const d = deferred(); calls.dungeon.push(d); return d.promise; },
    ambienceSprites: () => { const d = deferred(); calls.enchant.push(d); return d.promise; }
  };
  vm.runInNewContext(sliceScript, context, { filename: 'app.js (sprite-pool slice)' });
  const { usePool, ambience: sliceAmbience } = context.__probe;

  // Call A: routing asks for the pool before the enchant data is read.
  context.state.data = null;
  const callA = usePool();
  assert.equal(calls.dungeon.length, 1, 'the pre-data call must fetch the portals');
  assert.equal(calls.enchant.length, 1, 'the pre-data call must still ask for the enchant pool');

  // Call B: the data finishes loading and the app asks again - the complete
  // request, exactly what initAmbience does once state.data is set.
  context.state.data = { enchants: [] };
  const callB = usePool();
  assert.equal(calls.dungeon.length, 2,
    'the post-data call must fetch its own portals rather than reusing the stale in-flight partial one');

  // Call B's fetch settles first...
  calls.dungeon[1].resolve([{ src: 'portalB' }]);
  calls.enchant[1].resolve([{ src: 'enchantB' }]);
  await callB;
  assert.deepEqual(sliceAmbience.sprites.map(sprite => sprite.src), ['portalB', 'enchantB'],
    'the complete pool must apply once it lands');

  // ...and Call A's slower, portal-only fetch settles after it. It must not
  // win: this is the exact ordering Codex flagged.
  calls.dungeon[0].resolve([{ src: 'portalA' }]);
  calls.enchant[0].resolve([]);
  await callA;
  assert.deepEqual(sliceAmbience.sprites.map(sprite => sprite.src), ['portalB', 'enchantB'],
    'a pre-data partial fetch resolving after the complete one must not overwrite it');

  console.log('English-only locale gate, catalogue retention, canonical search, static-control, '
    + 'animations-toggle removal, shared-starfield wiring, module colour-wash/aurora removal, unified '
    + 'sprite pool, module star-language, and sprite-pool ordering checks pass.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
