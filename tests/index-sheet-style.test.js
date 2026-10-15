'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('let indexSheetStyle = null;');
const end = source.indexOf('\n/* ------------------------------------------------------------------ *', start);
assert(start > 0 && end > start, 'Calculator sheet and loader test boundary exists');
const index = fs.readFileSync(path.join(__dirname, '../web/index-page.js'), 'utf8');
const indexStart = index.indexOf("    // The sheet's address, once");
const indexEnd = index.indexOf('    await Promise.all', indexStart);
assert(indexStart > 0 && indexEnd > indexStart, 'Index sheet setup test boundary exists');

function harness(bundle, objectUrls) {
  const styles = new Map(), indexStyles = new Map(), blobs = [];
  const context = {
    BUNDLE: bundle, state: { itemArt: null },
    window: { ROTMG_BUNDLE: bundle, ROTMG_SHARED_DATA: { index: { built: 'index date' } } },
    el: () => ({ style: { setProperty: (key, value) => indexStyles.set(key, value) } }),
    document: { documentElement: { style: { setProperty: (key, value) => styles.set(key, value) } } },
    atob: value => Buffer.from(value, 'base64').toString('binary'), Uint8Array, Blob,
    URL: objectUrls === undefined ? { createObjectURL(blob) {
      blobs.push(blob);
      return 'blob:item-sheet-' + blobs.length;
    } } : objectUrls,
    fetch: async () => ({ json: async () => ({ from: { build: 'client' }, built: 'build date' }) })
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { styles, indexStyles, blobs, load: () => vm.runInContext('ensureItemArt()', context),
    startIndex: () => vm.runInContext(index.slice(indexStart, indexEnd), context),
    forgetArt: () => { context.state.itemArt = null; } };
}

(async () => {
  const png = 'data:image/png;base64,AAEC/w==';
  const art = { items: {} };
  const page = harness({ indexSheet: png, itemArt: art });
  assert.equal(await page.load(), art);
  assert.equal(page.styles.get('--sheet'), 'url(blob:item-sheet-1)',
    'The actual calculator loader places a short URL in the inherited variable');
  assert.equal(page.blobs[0].type, 'image/png');
  assert.deepEqual(Buffer.from(await page.blobs[0].arrayBuffer()), Buffer.from([0, 1, 2, 255]));
  page.forgetArt();
  await page.load();
  assert.equal(page.blobs.length, 1, 'Reopening reuses the document resource');
  assert.equal(page.styles.get('--sheet'), 'url(blob:item-sheet-1)');
  page.startIndex();
  page.startIndex();
  assert.equal(page.indexStyles.get('--ix-sheet'), page.styles.get('--sheet'),
    'The actual Index setup shares the short sheet URL with the calculator and card consumers');
  assert.equal(page.blobs.length, 1, 'Both interfaces share one document resource');

  const served = harness(null);
  await served.load();
  assert.equal(served.styles.get('--sheet'), 'url(assets/index/sheet.png?v=client-build%20date)');
  assert.equal(served.blobs.length, 0, 'Served sheets keep their build version');
  served.startIndex();
  assert.equal(served.indexStyles.get('--ix-sheet'), 'url(assets/index/sheet.png?v=index%20date)');
  const versioned = harness({ indexSheet: 'assets/index/sheet.png?v=kept', itemArt: art });
  await versioned.load();
  assert.equal(versioned.styles.get('--sheet'), 'url(assets/index/sheet.png?v=kept)');
  assert.equal(versioned.blobs.length, 0);
  versioned.startIndex();
  assert.equal(versioned.indexStyles.get('--ix-sheet'), 'url(assets/index/sheet.png?v=kept)');

  for (const urls of [null, { createObjectURL() { throw new Error('unavailable'); } }]) {
    const fallback = harness({ indexSheet: png, itemArt: art }, urls);
    await fallback.load();
    assert.equal(fallback.styles.get('--sheet'), 'url(' + png + ')');
    fallback.startIndex();
    assert.equal(fallback.indexStyles.get('--ix-sheet'), 'url(' + png + ')');
  }
  console.log('Index CSS sheet: both loaders, exact bytes, shared lifetime cache, versions and fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
