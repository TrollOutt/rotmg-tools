'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../web/theorycraft.js'), 'utf8');
const marker = 'return { start, share, open, put };';
assert(source.includes(marker), 'TheoryCraft test hook still exists');

function harness(objectUrls) {
  const context = {
    module: { exports: {} }, window: {},
    TheoryEngine: require('../web/theory-engine'),
    BuildProgression: require('../web/progression'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array, Blob, URL: objectUrls
  };
  vm.runInNewContext(source.replace(marker, 'return { sheetStyleUrl };'), context);
  return context.module.exports.sheetStyleUrl;
}

(async () => {
  const blobs = [];
  const convert = harness({ createObjectURL(blob) {
    blobs.push(blob);
    return 'blob:sheet-' + blobs.length;
  } });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
  const bytes = Buffer.from(png.split(',')[1], 'base64');
  assert.equal(convert(png), 'blob:sheet-1');
  assert.equal(blobs[0].type, 'image/png');
  assert.deepEqual(Buffer.from(await blobs[0].arrayBuffer()), bytes,
    'CSS sheets retain every PNG byte, including bytes above 127');
  assert.equal(convert(png), 'blob:sheet-1');
  assert.equal(blobs.length, 1, 'Repeated uses share one document-lifetime URL');
  assert.equal(convert('data:image/png;base64,AAEC/w=='), 'blob:sheet-2');
  assert.deepEqual(Buffer.from(await blobs[1].arrayBuffer()), Buffer.from([0, 1, 2, 255]));
  for (const url of ['assets/theory/sheet.png?v=build', 'assets/index/sheet.png', 'blob:existing']) {
    assert.equal(convert(url), url, 'Ordinary URLs retain cache versions and identity');
  }
  assert.equal(blobs.length, 2);
  assert.equal(harness(undefined)(png), png, 'Unavailable object URLs retain embedded images');
  assert.equal(harness({ createObjectURL() { throw new Error('unavailable'); } })(png), png,
    'Resource creation failure retains embedded images');
  console.log('Theory CSS sheets: exact bytes, shared URLs, versioned paths and fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
