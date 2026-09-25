'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function memoryStorage(initial = {}) {
  const values = new Map(
    Object.entries(initial).map(([key, value]) => [key, String(value)])
  );

  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('storage unavailable');
  },
  setItem() {
    throw new Error('storage unavailable');
  }
};

/* ------------------------------------------------------------------ *
 * Skin Viewer: every storage access is guarded                        *
 * ------------------------------------------------------------------ */

{
  const source = read('web/skins/app.js');

  assert.equal(
    (source.match(/localStorage\.getItem\(/g) || []).length,
    1,
    'STORAGE-001 Skin Viewer has one raw getItem, inside storageGet only'
  );

  assert.equal(
    (source.match(/localStorage\.setItem\(/g) || []).length,
    1,
    'STORAGE-001 Skin Viewer has one raw setItem, inside storageSet only'
  );

  const start = source.indexOf('function storageGet(key)');
  const end = source.indexOf('let mountedInstance', start);

  assert(start >= 0 && end > start,
    'STORAGE-001 Skin Viewer storage helpers remain extractable');

  const helperSource = source.slice(start, end);

  const context = {
    localStorage: throwingStorage,
    module: { exports: {} }
  };

  vm.runInNewContext(
    helperSource + '\nmodule.exports={storageGet,storageSet};',
    context,
    { filename: 'skin-storage-helpers.js' }
  );

  assert.equal(
    context.module.exports.storageGet('anything'),
    null,
    'STORAGE-002 unavailable storage reads fall back to null'
  );

  assert.equal(
    context.module.exports.storageSet('anything', 'value'),
    false,
    'STORAGE-002 unavailable storage writes fail softly'
  );

  const working = memoryStorage();
  context.localStorage = working;

  assert.equal(
    context.module.exports.storageSet('key', 'value'),
    true,
    'STORAGE-003 working storage reports a successful write'
  );

  assert.equal(
    context.module.exports.storageGet('key'),
    'value',
    'STORAGE-003 working storage round-trips through the helper'
  );
}

/* ------------------------------------------------------------------ *
 * Fame page persistence                                               *
 * ------------------------------------------------------------------ */

function fameHarness(localStorage) {
  const source = read('web/fame-page.js');
  const marker = 'return { init, render };';

  assert(source.includes(marker),
    'STORAGE-010 FamePage test hook marker exists');

  const script = source.replace(
    marker,
    `return {
      init, render,
      __storageTest: {
        save,
        load,
        state
      }
    };`
  );

  const context = {
    module: { exports: {} },
    console,
    localStorage,
    window: {},
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    }
  };

  vm.runInNewContext(script, context, {
    filename: path.join(root, 'web/fame-page.js')
  });

  return context.module.exports.__storageTest;
}

{
  const storage = memoryStorage();
  const fame = fameHarness(storage);

  fame.state.done = new Set(['Snake Pit', 'Sprite World']);
  fame.state.skipped = new Set(['The Shatters']);
  fame.state.base = 12345;

  assert.doesNotThrow(
    () => fame.save(),
    'STORAGE-011 Fame persistence writes cleanly'
  );

  fame.state.done = new Set();
  fame.state.skipped = new Set();
  fame.state.base = 0;

  fame.load();

  assert.deepEqual(
    [...fame.state.done],
    ['Snake Pit', 'Sprite World'],
    'STORAGE-011 Fame completed dungeons round-trip'
  );

  assert.deepEqual(
    [...fame.state.skipped],
    ['The Shatters'],
    'STORAGE-011 Fame skipped dungeons round-trip'
  );

  assert.equal(
    fame.state.base,
    12345,
    'STORAGE-011 Fame base value round-trips'
  );
}

{
  const fame = fameHarness(throwingStorage);

  fame.state.done = new Set(['old']);
  fame.state.skipped = new Set(['old']);
  fame.state.base = 99;

  assert.doesNotThrow(
    () => fame.load(),
    'STORAGE-012 Fame load survives unavailable storage'
  );

  assert.deepEqual([...fame.state.done], []);
  assert.deepEqual([...fame.state.skipped], []);
  assert.equal(fame.state.base, 0);

  assert.doesNotThrow(
    () => fame.save(),
    'STORAGE-012 Fame save survives unavailable storage'
  );
}

{
  const storage = memoryStorage({
    'rotmg-enchant-calculator/fame/done': '{not-json'
  });

  const fame = fameHarness(storage);

  fame.state.done = new Set(['old']);
  fame.state.skipped = new Set(['old']);
  fame.state.base = 99;

  fame.load();

  assert.deepEqual(
    [...fame.state.done],
    [],
    'STORAGE-013 malformed Fame storage resets completed state'
  );

  assert.deepEqual(
    [...fame.state.skipped],
    [],
    'STORAGE-013 malformed Fame storage resets skipped state'
  );

  assert.equal(
    fame.state.base,
    0,
    'STORAGE-013 malformed Fame storage resets base value'
  );
}

/* ------------------------------------------------------------------ *
 * Index favourites                                                    *
 * ------------------------------------------------------------------ */

function indexHarness(localStorage) {
  const source = read('web/index-page.js');
  const marker =
    'return { start, show, open, card, door, __test: { createOpenController } };';

  assert(source.includes(marker),
    'STORAGE-020 RealmIndex test hook marker exists');

  const script = source.replace(
    marker,
    `return {
      start, show, open, card, door,
      __test: {
        createOpenController,
        readLoved,
        writeLoved,
        setLoved(values) { loved = new Set(values); },
        lovedValues() { return [...loved]; }
      }
    };`
  );

  const context = {
    module: { exports: {} },
    console,
    window: { localStorage }
  };

  vm.runInNewContext(script, context, {
    filename: path.join(root, 'web/index-page.js')
  });

  return context.module.exports.__test;
}

{
  const storage = memoryStorage({
    'rotmg-tools/index-favourites':
      JSON.stringify(['item:A', 42, null, 'enemy:B'])
  });

  const index = indexHarness(storage);
  index.readLoved();

  assert.deepEqual(
    [...index.lovedValues()],
    ['item:A', 'enemy:B'],
    'STORAGE-021 Index restores only string favourite ids'
  );

  index.setLoved(['class:Wizard', 'portal:Snake Pit']);
  index.writeLoved();

  assert.deepEqual(
    JSON.parse(storage.values.get('rotmg-tools/index-favourites')),
    ['class:Wizard', 'portal:Snake Pit'],
    'STORAGE-021 Index favourites round-trip'
  );
}

{
  const index = indexHarness(throwingStorage);

  assert.doesNotThrow(
    () => index.readLoved(),
    'STORAGE-022 Index favourite read survives unavailable storage'
  );

  assert.deepEqual([...index.lovedValues()], []);

  index.setLoved(['class:Wizard']);

  assert.doesNotThrow(
    () => index.writeLoved(),
    'STORAGE-022 Index favourite write survives unavailable storage'
  );
}

{
  const storage = memoryStorage({
    'rotmg-tools/index-favourites': '{broken'
  });

  const index = indexHarness(storage);
  index.setLoved(['old']);
  index.readLoved();

  assert.deepEqual(
    [...index.lovedValues()],
    [],
    'STORAGE-023 malformed favourite JSON resets the shortlist'
  );
}

/* ------------------------------------------------------------------ *
 * Theory progression profile                                          *
 * ------------------------------------------------------------------ */

function theoryStorageHarness(localStorage) {
  const source = read('web/theorycraft.js');
  const marker = 'return { start, share, open, put };';

  assert(source.includes(marker),
    'STORAGE-030 TheoryCraft test hook marker exists');

  const script = source.replace(
    marker,
    `return {
      start, share, open, put,
      __storageTest: {
        saveProfile,
        profile() { return profile; },
        saved() { return profileSaved; }
      }
    };`
  );

  const said = { textContent: '' };

  const context = {
    module: { exports: {} },
    console,
    localStorage,
    document: {
      getElementById(id) {
        return id === 'tcSaid' ? said : {};
      }
    },
    window: {
      ROTMG_BUNDLE: { sources: {} }
    },
    BuildProgression: require('../web/progression'),
    EnchantEngine: require('../web/engine')
  };

  vm.runInNewContext(script, context, {
    filename: path.join(root, 'web/theorycraft.js')
  });

  return context.module.exports.__storageTest;
}

{
  const storage = memoryStorage();
  const theory = theoryStorageHarness(storage);

  const profile = {
    version: 3,
    mode: 'best',
    selection: 'manual',
    difficulty: null,
    zones: [],
    biomeRanks: ['Rookie']
  };

  theory.saveProfile(profile);

  assert.equal(
    theory.saved(),
    true,
    'STORAGE-031 Theory profile reports successful persistence'
  );

  assert.deepEqual(
    JSON.parse(storage.values.get('rotmg-build-progression-v1')),
    profile,
    'STORAGE-031 Theory profile is persisted exactly'
  );
}

{
  const theory = theoryStorageHarness(throwingStorage);

  const profile = {
    version: 3,
    mode: 'best',
    selection: 'manual',
    difficulty: null,
    zones: [],
    biomeRanks: ['Rookie']
  };

  assert.doesNotThrow(
    () => theory.saveProfile(profile),
    'STORAGE-032 Theory profile survives unavailable storage'
  );

  assert.equal(
    theory.saved(),
    false,
    'STORAGE-032 Theory exposes that persistence is unavailable'
  );

  assert.equal(
    theory.profile().mode,
    'best',
    'STORAGE-032 in-memory profile remains usable'
  );
}

console.log('storage / private-mode contract: ok');
