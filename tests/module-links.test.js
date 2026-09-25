'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('web/app.js');
const atlasTemplate = read('tools/atlas-viewer.html');
const css = read('web/style.css');
const indexPageSource = read('web/index-page.js');
const atlasBuilt = read('web/assets/atlas/index.html');

/* ------------------------------------------------------------------ *
 * Host <-> Atlas message boundary                                     *
 * ------------------------------------------------------------------ */

assert(
  app.includes(
    "if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return;"
  ),
  'LINK-001 host accepts Atlas messages only from realmFrame'
);

assert(
  app.includes("frame.contentWindow.postMessage(what, '*');"),
  'LINK-002 host sends Atlas commands to the iframe window itself'
);

const templateListeners =
  (atlasTemplate.match(/window\.addEventListener\('message'/g) || []).length;

const templateGuards =
  (atlasTemplate.match(/event\.source !== window\.parent/g) || []).length;

assert.equal(
  templateListeners,
  5,
  'LINK-003 Atlas template has five message channels (settle, clear-sky, pace, bare, panel-width)'
);

assert.equal(
  templateGuards,
  templateListeners,
  'LINK-003 every Atlas template message channel authenticates its parent'
);

const builtListeners =
  (atlasBuilt.match(/window\.addEventListener\('message'/g) || []).length;

const builtGuards =
  (atlasBuilt.match(/event\.source !== window\.parent/g) || []).length;

assert.equal(
  builtListeners,
  5,
  'LINK-004 published Atlas has the expected message channels'
);

assert.equal(
  builtGuards,
  builtListeners,
  'LINK-004 published Atlas preserves every parent-source guard'
);

/* ------------------------------------------------------------------ *
 * Atlas template -> published page projection                         *
 * ------------------------------------------------------------------ */

function normalizedPublishedAtlas(source) {
  let out = source.replace(/\r\n/g, '\n');

  const cuts = [
    /<aside id="bench">[\s\S]*?<\/aside>\n/,
    /  \/\* The bench, for trying things[\s\S]*?#bench p \{[^}]*\}\n/,
    /\/\* -+ the bench, wired up -+ \*\/[\s\S]*?\n\}\n\n(?=(?:requestAnimationFrame|startFrame))/
  ];

  for (const cut of cuts) {
    assert(
      cut.test(out),
      'LINK-005 published Atlas bench projection marker remains present'
    );
    out = out.replace(cut, '');
  }

  return out.replace('/*ATLAS*/null', '__ATLAS__').replace('/*LOOTKIN*/null', '__LOOTKIN__');
}

function normalizedBuiltAtlas(source) {
  return source
    .replace(/\r\n/g, '\n')
    .replace(
      /^const A = \{.*\};$/m,
      'const A = __ATLAS__;'
    )
    // The kinds of drop the build reads from the Index: a table, or null without one.
    .replace(/^const KIN = (?:\{.*\}|null);$/m, 'const KIN = __LOOTKIN__;');
}

assert.equal(
  normalizedBuiltAtlas(atlasBuilt),
  normalizedPublishedAtlas(atlasTemplate),
  'LINK-005 published Atlas must be exactly the template minus local bench plus inlined data'
);

const atlasFunctionalMarkers = [
  'body.unheard #map',
  'let tripFrom = 0, tripFor = 0, tripAt = null;',
  'if (tripFor > 0) return 0;',
  'if (said.over > 0)',
  "window.parent.postMessage({ rotmg: 'sky' }, '*')",
  "window.parent.postMessage({ rotmg: 'hello' }, '*')",
  "document.body.classList.remove('unheard')"
];

for (const token of atlasFunctionalMarkers) {
  assert(
    atlasTemplate.includes(token),
    `LINK-006 Atlas functional bridge survives in template: ${token}`
  );

  assert(
    atlasBuilt.includes(token),
    `LINK-006 Atlas functional bridge survives publication: ${token}`
  );
}

assert(
  !atlasTemplate.includes('RealmI18n'),
  'LINK-007 Atlas template keeps the English-only runtime independent of RealmI18n'
);

assert(
  !atlasBuilt.includes('RealmI18n'),
  'LINK-007 published Atlas keeps the English-only runtime independent of RealmI18n'
);

/* ------------------------------------------------------------------ *
 * Atlas clear sky: the cloud is skipped, not drawn transparent        *
 * ------------------------------------------------------------------ */

for (const [where, source] of [['template', atlasTemplate], ['published', atlasBuilt]]) {
  assert(
    source.includes('<button id="skyKnob" type="button" aria-pressed="false"'),
    `LINK-020 ${where} Atlas has the clear-sky switch`
  );
  assert(
    source.includes('if (weatherOn) stepSky(delta, box);')
      && source.includes('if (weatherOn) drawSky(box, now);'),
    `LINK-021 ${where} Atlas skips both of the sky's steps under a clear sky`
  );
  assert.equal((source.match(/(?<!function )\bdrawSky\(box, now\)/g) || []).length, 1,
    `LINK-021 ${where} Atlas draws the sky from the frame only`);
  assert(
    source.includes('stepBirds(delta);\n  drawBirds(box);')
      || source.includes('stepBirds(delta);\r\n  drawBirds(box);'),
    `LINK-022 ${where} Atlas keeps the birds out of the clear-sky gate`
  );
  assert(source.includes('const skyShown = () => !clearSky || bare;'),
    `LINK-023 ${where} Atlas keeps its weather when framed as scenery`);
  const knob = source.slice(source.indexOf("document.getElementById('skyKnob')"),
    source.indexOf('How often to draw at all.'));
  assert(knob.length > 0 && !/requestAnimationFrame|setInterval/.test(knob),
    `LINK-024 ${where} Atlas clear-sky switch starts no loop of its own`);
}

/* ------------------------------------------------------------------ *
 * Atlas -> Index: only through records the Index holds               *
 * ------------------------------------------------------------------ */

{
  const vm = require('vm');
  const start = atlasTemplate.indexOf('let known = null, knownAsked = false;');
  const end = atlasTemplate.indexOf('/* Whichever panel is open is drawn again once all of that arrives. */');
  assert(start >= 0 && end > start, 'LINK-030 Atlas Index join helpers remain extractable');
  const asked = [];
  const files = {
    '/web/assets/atlas/../index/wiki.json': { ids: ["portal:Davy Jones' Locker", 'enemy:Sea Dragon',
      'enemy:Sea Dragon#Phase Two', "item:Pirate King's Cutlass", 'item:Health Potion'] },
    '/web/assets/atlas/../../realmeye-data.json': { creatures: { '/wiki/sea-dragon': { name: 'Sea Dragon',
      detail: { drops: [{ name: 'Health Potion' }, { name: 'Tier 8 Weapons' }, { name: 'Tier 10 Weapons' }, { name: 'Unjoined Relic' }] } } } },
    '/web/assets/atlas/../index/item-art.json': { sheet: { wide: 1024, tall: 1280 }, art: { 'Health Potion': [424, 976, 8, 8] } }
  };
  const context = {
    BASE: '/web/assets/atlas/', window: {}, Map, String, Promise, Object, Math, Number, JSON,
    fetch: url => { asked.push(url); return Promise.resolve({ ok: !!files[url], json: () => Promise.resolve(files[url]) }); },
    panelBody: { addEventListener() {} }, module: { exports: {} }
  };
  context.window.parent = context.window;
  vm.runInNewContext(atlasTemplate.slice(start, end)
    + '\nmodule.exports = { askKnown, knownId, indexButton, dropsOf };', context);
  const k = context.module.exports;
  assert.equal(k.indexButton('Sea Dragon', ['enemy']), '', 'LINK-031 nothing is offered before the Index has been read');
  new Promise(resolve => k.askKnown(resolve)).then(() => {
    assert.deepEqual([...asked].sort(), Object.keys(files).sort(), 'LINK-032 the Atlas reads the files the site publishes beside it');
    assert.equal(k.knownId('Sea Dragon', ['enemy']), 'enemy:Sea Dragon', 'LINK-033 a creature the Index holds is found');
    assert.equal(k.knownId('Davy Jones’ Locker', ['portal']), "portal:Davy Jones' Locker",
      'LINK-034 the curly apostrophe of the reference matches the client name');
    assert.equal(k.knownId('Sea Dragon', ['item']), '', 'LINK-035 a name is only found under the kind it was asked as');
    assert.equal(k.knownId('Phase Two', ['enemy']), '', 'LINK-036 variants are not names');
    assert.equal(k.indexButton('Unjoined Thing', ['enemy', 'item', 'portal']), '',
      'LINK-037 a thing the Index does not hold gets no button rather than a guessed one');
    assert.match(k.indexButton('Sea Dragon', ['enemy']), /data-index="enemy:Sea Dragon"/, 'LINK-038 the button carries the record id');
    const drops = k.dropsOf('Sea Dragon');
    assert.match(drops, /data-index="item:Health Potion"[^>]*title="Health Potion"/, 'LINK-039 a named drop opens its item');
    assert.match(drops, /background-position:-/, 'LINK-039 a named drop is drawn with its Index picture');
    assert(!/T8|Tier 8|weapons/i.test(drops), 'LINK-040 the tiers are said once for the zone, not under every creature');
    assert.match(drops, /<span class="tier-run">[^<]*Unjoined Relic/, 'LINK-041 a drop with no picture is said by name');
    assert(!/data-index="[^"]*Unjoined Relic/.test(drops), 'LINK-041 and a drop the Index does not hold is not linked');
    assert(!/realmeye\.com/.test(atlasTemplate.slice(start, end)), 'LINK-042 the panel sends nobody to RealmEye');
  }).catch(error => { console.error(error); process.exitCode = 1; });
  /*
   * With the kinds of drop written in by the page build: the health and magic
   * potions are left out, a kind turns through its members, a blueprint is
   * framed with the item named after it and opens its own Index record even
   * without a wiki page, and a dungeon it opens is drawn as its portal.
   */
  {
    const kin = { groups: { 'Common Pet Eggs': ['Common Feline Egg', 'Common Canine Egg'] }, mundane: ['Health Potion'] };
    const kinFiles = {
      '/web/assets/atlas/../index/wiki.json': { ids: ['enemy:Sigma Werewolf', 'item:Helm of the Juggernaut', 'item:Health Potion', 'portal:The Tavern'] },
      '/web/assets/atlas/../../realmeye-data.json': { creatures: { one: { name: 'Sigma Werewolf', detail: { drops: [
        { name: 'Health Potion' }, { name: 'Tier 9 Armor' }, { name: 'Common Pet Eggs' }, { name: 'Juggernaut Blueprint' },
        { name: 'Helm of the Juggernaut' }, { name: 'The Tavern' }] } } } },
      '/web/assets/atlas/../index/item-art.json': { sheet: { wide: 1024, tall: 1280 }, art: {
        'Health Potion': [424, 976, 8, 8], 'Juggernaut Blueprint': [496, 928, 8, 8], 'Helm of the Juggernaut': [8, 8, 8, 8],
        'Common Feline Egg': [16, 16, 8, 8], 'Common Canine Egg': [24, 16, 8, 8] } }
    };
    const kinContext = {
      BASE: '/web/assets/atlas/', window: {}, Map, Set, String, Promise, Object, Math, Number, JSON,
      A: { zones: [{ loot: { dungeons: [{ name: 'The Tavern', art: 'the-tavern.png' }] } }] },
      asset: file => '/' + file,
      fetch: url => Promise.resolve({ ok: !!kinFiles[url], json: () => Promise.resolve(kinFiles[url]) }),
      panelBody: { addEventListener() {} }, module: { exports: {} }
    };
    kinContext.window.parent = kinContext.window;
    assert(atlasTemplate.includes('const KIN = /*LOOTKIN*/null;'), 'LINK-045 the page build has a place to write the kinds of drop');
    vm.runInNewContext(atlasTemplate.slice(start, end).replace('/*LOOTKIN*/null', JSON.stringify(kin))
      + '\nmodule.exports = { askKnown, dropsOf };', kinContext);
    const kk = kinContext.module.exports;
    new Promise(resolve => kk.askKnown(resolve)).then(() => {
      const drops = kk.dropsOf('Sigma Werewolf');
      assert(!/Health Potion/.test(drops), 'LINK-045 health and magic potions are left out');
      assert(/data-roll="[^"]+;[^"]+"/.test(drops), 'LINK-046 a kind of drop turns through its members');
      assert.match(drops, /<span class="pair"><button[^>]*data-index="item:Helm of the Juggernaut"[^]*?data-index="item:Juggernaut Blueprint"[^>]*unlocks Helm of the Juggernaut/,
        'LINK-047 a blueprint stands framed with the item it unlocks and opens its own Index record');
      assert.match(drops, /class="drop portal" data-index="portal:The Tavern"[^>]*><img src="\/loot\/the-tavern.png"/,
        'LINK-048 a dungeon it opens is drawn as its portal');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  }
  assert(app.includes("if (said.rotmg === 'index') {") && app.includes('if (!RealmRoutes.indexHash(said.id)) return;')
    && app.includes('window.openIndexRecord(said.id);'), 'LINK-043 the host opens an Atlas record through the checked Index route');
  assert(app.includes("if (said.rotmg === 'clouds') { dressSkySwitch(said); return; }")
    && app.includes("tellAtlas({ rotmg: 'clear-sky', on: !skyClear });"), 'LINK-044 the host drives the clouds switch beside its cross');
  assert(atlasTemplate.includes("if (!said || said.rotmg !== 'clear-sky') return;"), "LINK-044 the Atlas listens for the host's clouds switch");
  // While the atlas is open out, a record it points at is shown over its
  // panel from the Index's own card, and the map is not left.
  assert(app.includes("if (atlasOpenOut()) { openAtlasIndex(said.id, true); return; }")
    && app.includes('RealmIndex.card(id)') && indexPageSource.includes('box.innerHTML = cardHtml(one);')
    && indexPageSource.includes('html: cardHtml(one)'),
    'LINK-049 the Atlas opens a record in a drawer drawn from the Index card itself');
  assert(atlasTemplate.includes("window.parent.postMessage({ rotmg: 'panel', open, wide }, '*')")
    && app.includes("if (said.rotmg === 'panel') { besideAtlasPanel(said); return; }")
    && css.includes('.globe-box.has-atlas-panel .globe-shut { right: calc(var(--atlas-panel, 0px) + 18px); }'),
    "LINK-050 the host's cross and clouds stand beside the Atlas panel, not on it");
  assert(atlasTemplate.includes(`'<span class="gates">' + portals.join('') + '</span>'`),
    'LINK-051 the dungeons a creature opens stand apart from what it drops');
}

/* ------------------------------------------------------------------ *
 * Index cross-module open contract                                    *
 * ------------------------------------------------------------------ */

const RealmIndex = require('../web/index-page.js');
const createOpenController = RealmIndex.__test.createOpenController;

async function run() {
  let starts = 0;
  let lookups = 0;
  let shows = 0;

  const open = createOpenController(
    async () => {
      starts++;
      return true;
    },
    id => {
      lookups++;
      return id === 'item:Known';
    },
    id => {
      shows++;
      return id === 'item:Known';
    }
  );

  for (const bad of [
    '',
    null,
    undefined,
    'item',
    ' item:Known',
    'item:Known ',
    'not a route'
  ]) {
    assert.equal(
      await open(bad),
      false,
      `LINK-010 malformed Index id is rejected: ${String(bad)}`
    );
  }

  assert.equal(
    starts,
    0,
    'LINK-010 malformed ids are rejected before starting the Index'
  );

  assert.equal(
    lookups,
    0,
    'LINK-010 malformed ids never reach record lookup'
  );

  assert.equal(
    shows,
    0,
    'LINK-010 malformed ids never reach display'
  );

  assert.equal(
    await open('item:Known'),
    true,
    'LINK-011 a valid known record opens'
  );

  assert.equal(starts, 1, 'LINK-011 valid open starts the Index');
  assert.equal(lookups, 1, 'LINK-011 valid open verifies the record');
  assert.equal(shows, 1, 'LINK-011 valid open displays the record');

  assert.equal(
    await open('item:Missing'),
    false,
    'LINK-012 a well-formed unknown record is rejected'
  );

  assert.equal(
    shows,
    1,
    'LINK-012 an unknown record is never displayed'
  );

  let checkedAfterFailure = false;

  const unavailable = createOpenController(
    async () => false,
    () => {
      checkedAfterFailure = true;
      return true;
    },
    () => true
  );

  assert.equal(
    await unavailable('item:Known'),
    false,
    'LINK-013 failed Index startup aborts the handoff'
  );

  assert.equal(
    checkedAfterFailure,
    false,
    'LINK-013 failed startup performs no record lookup'
  );

  const falseShow = createOpenController(
    async () => true,
    () => true,
    () => 0
  );

  assert.equal(
    await falseShow('item:Known'),
    false,
    'LINK-014 display result is normalized to a boolean'
  );

  console.log('module link contract: ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
