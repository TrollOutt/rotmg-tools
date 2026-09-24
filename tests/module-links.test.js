'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('web/app.js');
const atlasTemplate = read('tools/atlas-viewer.html');
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
  3,
  'LINK-003 Atlas template has three message channels'
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
  3,
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

  return out.replace('/*ATLAS*/null', '__ATLAS__');
}

function normalizedBuiltAtlas(source) {
  return source
    .replace(/\r\n/g, '\n')
    .replace(
      /^const A = \{.*\};$/m,
      'const A = __ATLAS__;'
    );
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
