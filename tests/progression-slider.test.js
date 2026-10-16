'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../web/progression');
const raw = require('../data/TheoryCraft/theorycraft.json');
const access = P.catalogue(require('../data/Index/index.json'), require('../data/Index/wiki.json'),
  raw.items, require('../web/realmeye-data.json'),
  fs.readFileSync(path.join(__dirname, '../data/Fame/dungeon-pages.txt'), 'utf8'));
const source = fs.readFileSync(path.join(__dirname, '../web/theorycraft.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// A small DOM double exercises the real renderer and delegated input/save handlers.
// Native range event generation and animated sprite pixels are checked in Chrome.
class Node {
  constructor(id = '') { this.id = id; this.dataset = {}; this.children = []; this.listeners = {}; this.value = ''; this.style = { setProperty() {} }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async emit(type, target = this) { for (const fn of this.listeners[type] || []) await fn({ target, preventDefault() {} }); }
  closest() { return this; }
  focus() {}
  showModal() { this.open = true; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  insertBefore(node, next) {
    if (node === next) return;
    node.remove();
    const at = next ? this.children.indexOf(next) : this.children.length;
    assert(at >= 0);
    this.children.splice(at, 0, node); node.parent = this;
  }
  insertAdjacentHTML(where, html) {
    assert.equal(where, 'beforeend');
    for (const match of html.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
      const node = new Node(); node.html = match[0];
      node.dataset.removeZone = /data-remove-zone="([^"]+)"/.exec(node.html)[1];
      node.dataset.zoneName = /data-zone-name="([^"]+)"/.exec(node.html)[1];
      this.insertBefore(node, null); this.created++;
    }
  }
  querySelectorAll(selector) { return selector.includes('data-zone-name') || selector.includes('data-remove-zone') ? this.children : []; }
}
function harness() {
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
  const storage = new Map();
  const context = { module: { exports: {} }, window: {}, document: { getElementById: el },
    TheoryEngine: require('../web/theory-engine'), BuildProgression: P,
    localStorage: { setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame() { throw Error('Progression must remain synchronous'); }, cancelAnimationFrame() {} };
  const hook = `return { wireProgress, drawDungeonCards, dungeonCards, selectedDungeons,
    setup(cat, draft, content) { access = cat; profileDraft = draft; profile = draft; data = content;
      paint = drawProgress = () => { document.getElementById('tcWelcome').open = false; };
      const original = startFilms; startFilms = within => { window.filmStarts++; original(within); };
      window.filmStarts = 0;
    }, draft() { return profileDraft; }, setZones(zones) { profileDraft.zones = zones; } };`;
  vm.runInNewContext(source.replace('return { start, share, open, put };', hook), context);
  const api = context.module.exports;
  const draft = { version: 1, mode: 'personal', selection: 'difficulty', difficulty: 1,
    zones: P.forDifficulty(access, 1), biomeRanks: ['Rookie'], excluded: [] };
  api.setup(access, draft, raw); api.wireProgress();
  const list = el('tcZones-dungeon'); list.created = 0; el('tcWelcome').open = true;
  return { api, el, list, storage, context };
}
(async () => {
  const h = harness();
  const check = () => {
    const selected = plain(h.api.selectedDungeons(h.api.draft()));
    assert.deepEqual(h.list.children.map(n => n.dataset.removeZone), selected.map(z => z.id));
    assert.equal(new Set(h.list.children).size, h.list.children.length);
    assert.equal(new Set(h.list.children.map(n => n.dataset.removeZone)).size, selected.length);
    for (const [i, node] of h.list.children.entries()) assert.equal(node.html, h.api.dungeonCards([selected[i]]), 'Retained content matches a fresh render');
  };
  const input = async value => { h.el('tcDifficultySlider').value = String(value); await h.el('tcWelcome').emit('input', h.el('tcDifficultySlider')); check(); };
  await input(10); assert.equal(h.list.children.length, 79);
  const retained = h.list.children.slice(); const created = h.list.created; const starts = h.context.window.filmStarts;
  for (let i = 0; i < 30; i++) await input(10);
  assert.equal(h.list.created, created, 'Repeated values create no cards');
  assert.deepEqual(h.list.children, retained, 'Unchanged cards keep their identity');
  assert.equal(h.context.window.filmStarts, starts, 'Unchanged lists keep their animation clock');
  for (const value of [1, 10, 2, 9, 4, 8, 3, 10]) await input(value);
  assert(h.context.window.filmStarts > starts, 'Changed lists restart animation discovery');
  h.el('tcZoneSearch').value = 'pirate'; await h.el('tcWelcome').emit('input', h.el('tcZoneSearch'));
  await input(1); await input(10);
  for (const node of h.list.children) assert.equal(node.hidden, !node.dataset.zoneName.includes('pirate'));
  h.list.insertBefore(h.list.lastElementChild, h.list.firstElementChild);
  h.api.drawDungeonCards(); check(); // Reconcile order without duplicating retained cards.
  h.api.setZones([]); h.api.drawDungeonCards(); check(); assert.equal(h.list.children.length, 0);
  assert.equal(h.el('tcZoneEmpty-dungeon').hidden, false);
  await input(10); check(); assert.equal(h.list.children.length, 79);
  // The browser produces input for mouse, touch and keyboard alike. Releases and
  // lifecycle events must never replace the latest synchronous selection.
  for (const release of ['pointerup', 'touchend', 'change', 'keyup', 'pagehide', 'visibilitychange']) {
    await input(3); await input(10); await h.el('tcWelcome').emit(release, h.el('tcDifficultySlider')); check();
    assert.equal(h.api.draft().difficulty, 10);
  }
  const expected = P.normalize(plain(h.api.draft()), access);
  await h.el('tcWelcome').emit('click', h.el('tcProfileSave'));
  assert.equal(h.el('tcWelcome').open, false);
  assert.deepEqual(JSON.parse(h.storage.get('rotmg-build-progression-v1')), expected, 'Immediate validation saves the last value and all 79 dungeons');
  assert.equal(expected.zones.length, 79); assert.equal(h.api.draft(), null);
  const cancel = harness();
  cancel.el('tcDifficultySlider').value = '10'; await cancel.el('tcWelcome').emit('input', cancel.el('tcDifficultySlider'));
  await cancel.el('tcWelcome').emit('cancel'); await cancel.el('tcWelcome').emit('close');
  assert.equal(cancel.api.draft(), null); assert.equal(cancel.storage.size, 0, 'Cancel preserves the existing unsaved-edit contract');
  console.log('Progression cards: 79 destinations, stable identity/content/order, rapid input, synchronous release/save and cancel.');
})().catch(error => { console.error(error); process.exitCode = 1; });
