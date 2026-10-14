/*
 * What's New writes the Index's picture sheet once, not into every picture.
 *
 *   node tests/whats-new-sheet.test.js
 *
 * In the downloadable copy the sheet is a data: URI of 1.37 million characters,
 * and each picture on a What's New page used to carry all of it in its own
 * style. The summary page draws fifty-odd pictures, so opening it built about
 * seventy-four million characters of styles, held a hundred megabytes more in
 * the browser and kept the page busy for over a second.
 *
 * picture() of web/whats-new.js is run here against a made-up document. Nothing
 * opens a browser; the real page is measured separately, from a file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../web/whats-new.js'), 'utf8');
const marker = '  return { init };';
assert.equal(source.split(marker).length, 2, 'whats-new.js: the return this test reaches picture() through has moved');

const SHEET = { wide: 2048, tall: 6000 };
const uri = size => 'data:image/png;base64,' + 'A'.repeat(size);

// A document that only keeps what is written into it, and a page that holds `sheet`.
function page(sheet) {
  const made = [];
  let rules = null;
  const document = {
    head: { appendChild(el) { if (el.id === 'wnSheet') rules = el; } },
    getElementById: id => (id === 'wnSheet' ? rules : null),
    createElement(tag) {
      const el = { tag, id: '', textContent: '', nodes: [], appendChild(node) { this.nodes.push(node); return node; } };
      made.push(el);
      return el;
    },
    createTextNode: text => ({ text })
  };
  const window = { ROTMG_BUNDLE: { indexSheet: sheet }, addEventListener() {} };
  const exported = { exports: {} };
  vm.runInNewContext(source.replace(marker, '  return { init, picture, setIndex(value) { ix = value; } };'),
    { window, document, module: exported, console, Math, Object, Map, Set, String, Number, JSON, Promise, RegExp, Array },
    { filename: 'web/whats-new.js' });
  const news = exported.exports;
  news.setIndex({ sheet: SHEET });
  return {
    picture: news.picture,
    use(next) { window.ROTMG_BUNDLE.indexSheet = next; },
    // Everything the page has declared, as text.
    css: () => (rules ? [rules.textContent, ...rules.nodes.map(n => n.text)].filter(Boolean).join('') : ''),
    styleElements: () => made.filter(el => el.tag === 'style').length
  };
}

const thing = rect => ({ sheet: rect });
const cut = i => [(i % 40) * 16, Math.floor(i / 40) * 16, 16, 16];

// What a picture looked like before, for a sheet that is an ordinary address.
function legacy(url, [x, y, w, h], aim, max) {
  const z = Math.max(1, Math.min(max || 12, Math.floor((aim || 56) / Math.max(w, h, 8))));
  return '<span class="wn-art pn-sheet" style="width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(\'' + url
    + '\');background-size:' + SHEET.wide * z + 'px ' + SHEET.tall * z + 'px;background-position:' + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
}
const geometry = html => (html.match(/(?:^|[;"])(?:width|height|background-size|background-position):[^;"]*/g) || []).map(s => s.replace(/^[;"]/, ''));

let checks = 0;

// 1. The published site: the sheet is a short address and nothing changes.
{
  const p = page('assets/index/sheet.png');
  for (let i = 0; i < 30; i++) {
    for (const [aim, max] of [[undefined, undefined], [24, 3], [56, 12], [90, 4]]) {
      assert.equal(p.picture(thing(cut(i)), aim, max), legacy('assets/index/sheet.png', cut(i), aim, max), 'a sheet that is an address is written as before');
      checks++;
    }
  }
  assert.equal(p.css(), '', 'an ordinary address writes no rule');
  assert.equal(p.styleElements(), 0, 'and creates no style element');
  checks += 2;
}

// 2. The downloadable copy: what a picture costs no longer depends on the sheet.
{
  const a = page(uri(10000)).picture(thing(cut(5)), 56, 12);
  const b = page(uri(2000000)).picture(thing(cut(5)), 56, 12);
  assert.equal(a.length, b.length, 'a picture costs the same however large the sheet is');
  assert(b.length < 400, 'a picture is a few hundred characters, not the sheet (' + b.length + ')');
  checks += 2;
}

// 3. Hundreds of pictures, across pages and reopenings: the sheet is declared once.
{
  const big = uri(1367702);                       // the size of the real sheet in the download
  const p = page(big);
  let html = '';
  for (let i = 0; i < 900; i++) html += p.picture(thing(cut(i)), 56, 12);
  assert(html.length < 300000, '900 pictures of a 1.3 MB sheet stay small (' + html.length + ' characters)');
  assert(!html.includes('AAAAAAAAAA'), 'no picture carries any part of the sheet');
  assert(!html.includes('background-image'), 'no picture names the sheet in its own style');
  assert.equal(p.styleElements(), 1, 'one style element holds the sheet');
  assert.equal(p.css().split(big).length - 1, 1, 'and the sheet is in it exactly once');
  assert.match(p.css(), /^\.wn-art\.pn-sheet-\d+\{background-image:url\('data:image\/png;base64,A+'\)\}$/, 'as one rule, strong enough to win over .wn-art');
  const klass = /pn-sheet-\d+/.exec(p.css())[0];
  assert.equal(html.split('class="wn-art pn-sheet ' + klass + '"').length - 1, 900, 'every picture names that rule');
  checks += 6;

  // Changing tab, changing season, closing and opening again draws them again.
  for (let round = 0; round < 5; round++) for (let i = 0; i < 100; i++) p.picture(thing(cut(i)), 24, 3);
  assert.equal(p.styleElements(), 1, 'drawing the pictures again adds no style element');
  assert.equal(p.css().split(big).length - 1, 1, 'and no second copy of the sheet');
  checks += 2;
}

// 4. Size, cut and position are what they were.
{
  const big = uri(5000), p = page(big);
  for (let i = 0; i < 60; i++) {
    for (const [aim, max] of [[undefined, undefined], [24, 3], [90, 4]]) {
      const now = p.picture(thing(cut(i)), aim, max);
      assert.deepEqual(geometry(now), geometry(legacy(big, cut(i), aim, max)), 'size and cut are what they were');
      assert(/^<span class="wn-art pn-sheet pn-sheet-\d+" style="width:/.test(now) && now.endsWith('"></span>'), 'still one span of the same kind');
      checks += 2;
    }
  }
}

// 5. Another sheet is another rule, and a sheet seen again keeps its class.
{
  const one = uri(3000), two = uri(4000), p = page(one);
  const a = p.picture(thing(cut(1)), 56, 12);
  p.use(two);
  const b = p.picture(thing(cut(1)), 56, 12);
  p.use(one);
  const c = p.picture(thing(cut(2)), 56, 12);
  const [ka, kb, kc] = [a, b, c].map(h => /pn-sheet-\d+/.exec(h)[0]);
  assert.notEqual(ka, kb, 'a different sheet has its own class');
  assert.equal(ka, kc, 'a sheet seen again keeps its class');
  assert.equal(p.styleElements(), 1, 'both rules sit in the one style element');
  checks += 3;
}

// 6. A creature that walks is drawn from its own strip, as before, and uses no sheet.
{
  const p = page(uri(5000));
  const walker = { sheet: cut(3), sprite: { clips: { walk: { file: 'walker.png', tile: 16, frames: 4, height: 16 } } } };
  const html = p.picture(walker, 56, 12);
  assert(html.includes('--wn-rest:url(') && html.includes('is-moving'), 'a walking creature is still drawn from its strip');
  assert(!/pn-sheet-\d+/.test(html), 'and does not name the sheet');
  assert.equal(p.css(), '', 'so nothing is declared for it');
  checks += 3;
}

console.log(`What's New sheet: ${checks} checks - the Index sheet is written once and the pictures point at it.`);
