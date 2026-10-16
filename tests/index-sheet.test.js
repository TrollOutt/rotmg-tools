/*
 * A picture sheet that arrives as a data: URI is written once, not into every picture.
 *
 *   node tests/index-sheet.test.js
 *
 * In the downloadable copy the Index's picture sheet is a data: URI of well over
 * a megabyte. The family landing draws several hundred small pictures cut out of
 * it, and each one used to carry the whole URI in its own style: the page being
 * built reached nine hundred million characters and the browser refused with
 * "RangeError: Invalid string length", leaving the Index empty.
 *
 * slice() of web/index-browse.js is run here against a made-up document. Nothing
 * opens a browser; the real page is checked separately, from a file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../web/index-browse.js'), 'utf8');
const marker = 'module.exports = { mount };';
assert(source.includes(marker), 'index-browse.js: the export this test reaches slice() through has moved');

// A document that only keeps what is written into it.
function page() {
  const made = [];
  let sheets = null;
  const document = {
    head: { appendChild(el) { if (el.id === 'ixbSheets') sheets = el; } },
    getElementById: id => (id === 'ixbSheets' ? sheets : null),
    createElement(tag) {
      const el = { tag, id: '', nodes: [], appendChild(node) { this.nodes.push(node); return node; } };
      made.push(el);
      return el;
    },
    createTextNode: text => ({ text })
  };
  const exported = { exports: {} };
  const window = { ROTMG_BUNDLE: null };
  vm.runInNewContext(source.replace(marker, 'module.exports = { mount, slice };'),
    { window, document, module: exported, console, Math, Object, Map, Set, String, Number, JSON, Promise,
      IndexSearch: require('../web/index-search'), IndexFilter: require('../web/index-filter') },
    { filename: 'web/index-browse.js' });
  return {
    slice: exported.exports.slice,
    rules: () => (sheets ? sheets.nodes.map(n => n.text) : []),
    styleElements: () => made.filter(el => el.tag === 'style').length
  };
}

const SHEET = { wide: 2048, tall: 6000 };
const cut = i => [(i % 40) * 16, Math.floor(i / 40) * 16, 16, 16];
const uri = size => 'data:image/png;base64,' + 'A'.repeat(size);

// What every picture looked like before, for a sheet that is an ordinary address.
function legacy(url, [x, y, w, h], px, extra = '') {
  const z = px / Math.max(w, h, 8);
  return '<span class="ixb-art" style="' + extra + ';width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(' + url
    + ');background-size:' + SHEET.wide * z + 'px ' + SHEET.tall * z + 'px;background-position:' + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
}

let checks = 0;

// 1. The published site: the sheet is a short address and nothing about it changes.
{
  const p = page();
  for (const url of ['assets/index/sheet.png', 'assets/index/sheet.png?v=2026-10-06']) {
    for (let i = 0; i < 20; i++) {
      assert.equal(p.slice(url, SHEET, cut(i), 30), legacy(url, cut(i), 30), 'a sheet that is an address is written as before');
      checks++;
    }
  }
  const filter = 'filter:grayscale(1) sepia(1)';
  assert.equal(p.slice('assets/index/status-icons.png', SHEET, cut(3), 16, filter), legacy('assets/index/status-icons.png', cut(3), 16, filter),
    'a filter given with the picture is kept');
  assert.deepEqual(p.rules(), [], 'an ordinary address writes no rule');
  assert.equal(p.styleElements(), 0, 'and creates no style element');
  checks += 3;
}

// 2. The downloadable copy: what a picture costs no longer depends on the size of the sheet.
{
  const small = page(), large = page();
  const a = small.slice(uri(10000), SHEET, cut(5), 30);
  const b = large.slice(uri(2000000), SHEET, cut(5), 30);
  assert.equal(a.length, b.length, 'a picture costs the same however large the sheet is');
  assert(b.length < 400, 'a picture is a few hundred characters, not the sheet (' + b.length + ')');
  checks += 2;
}

// 3. Several hundred pictures: the sheet is declared once and written nowhere else.
{
  const p = page();
  const big = uri(1367702);                       // the size of the real sheet in the download
  let html = '';
  for (let i = 0; i < 900; i++) html += p.slice(big, SHEET, cut(i), 30);
  assert(html.length < 300000, '900 pictures of a 1.3 MB sheet stay small (' + html.length + ' characters)');
  assert(!html.includes('AAAAAAAAAA'), 'no picture carries any part of the sheet');
  assert(!html.includes('background-image'), 'the sheet is not named in any picture\'s own style');
  assert.equal(p.styleElements(), 1, 'one style element holds the sheets');
  assert.equal(p.rules().length, 1, 'the sheet is declared exactly once');
  assert.equal(p.rules()[0].split(big).length - 1, 1, 'and the sheet is in that rule exactly once');
  assert.match(p.rules()[0], /^\.ixb-sheet-\d+\{background-image:url\(data:image\/png;base64,A+\)\}$/, 'as a plain background-image rule');
  const klass = /ixb-sheet-\d+/.exec(p.rules()[0])[0];
  assert.equal(html.split('class="ixb-art ' + klass + '"').length - 1, 900, 'every picture points at that rule');
  checks += 7;

  // Opening, closing and opening the Index again draws the same pictures again.
  for (let i = 0; i < 900; i++) p.slice(big, SHEET, cut(i), 30);
  assert.equal(p.rules().length, 1, 'drawing the pictures again adds no rule');
  assert.equal(p.styleElements(), 1, 'and no style element');
  checks += 2;
}

// 4. The picture is still cut and placed the same way.
{
  const p = page();
  const big = uri(5000);
  const filter = 'filter:grayscale(1) sepia(1)';
  for (const [rect, px, extra] of [[cut(0), 30, ''], [cut(77), 14, ''], [[48, 96, 16, 24], 36, filter], [[0, 0, 5, 5], 16, '']]) {
    const now = p.slice(big, SHEET, rect, px, extra);
    const before = legacy(big, rect, px, extra);
    const geometry = html => (html.match(/(?:^|[;"])(?:width|height|background-size|background-position):[^;"]*/g) || []).map(s => s.replace(/^[;"]/, ''));
    assert.deepEqual(geometry(now), geometry(before), 'size, position and cut are what they were');
    if (extra) assert(now.includes(extra), 'the filter given with the picture is kept');
    assert(/^<span class="ixb-art ixb-sheet-\d+" style="/.test(now) && now.endsWith('"></span>'), 'still one span of the same kind');
    checks += 2 + (extra ? 1 : 0);
  }
}

// 5. Two different sheets are two rules, each once.
{
  const p = page();
  const one = uri(3000), two = uri(4000);
  const a = p.slice(one, SHEET, cut(1), 30), b = p.slice(two, SHEET, cut(1), 30), c = p.slice(one, SHEET, cut(2), 30);
  assert.equal(p.rules().length, 2, 'each sheet has its own rule');
  const [ka, kb, kc] = [a, b, c].map(h => /ixb-sheet-\d+/.exec(h)[0]);
  assert.notEqual(ka, kb, 'with its own class');
  assert.equal(ka, kc, 'and a sheet seen again keeps its class');
  checks += 3;
}

console.log(`Index sheet: ${checks} checks - a data: sheet is written once and the pictures point at it.`);
