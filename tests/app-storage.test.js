'use strict';
const assert = require('assert/strict'), fs = require('fs');
const { storage: harness } = require('./app-harness');
const T = 'rotmg-enchant-calculator/tabs/v1', B = T + '/recovery';
const L = 'rotmg-enchant-calculator/v1', F = 'rotmg-enchant-calculator/filters/2';
const source = fs.readFileSync(require('path').join(__dirname, '../web/app.js'), 'utf8').replace(/\r\n/g, '\n');
const setup = { rarity: '4', type: 'WEAPON', dust: 'T14', item: 'Saved item',
  subtypes: ['ALIEN'], tiers: ['1', '3'], artifactBlacklist: ['Artifact'],
  optimizeGoal: 'stat:hp', slots: [{ name: 'Known', locked: true }] };
const good = JSON.stringify({ tabs: [{ id: 'a', label: 'First', setup },
  { id: 'b', label: 'Second', setup: {} }], active: 'a' });
const raw = ' {"tabs":[null,{"label":"Keep me","setup":{"item":"Saved item","slots":[{"name":"Known","locked":true}]}}]}\n';
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0;
for (const text of [source, source.replace(/\n/g, '\r\n')]) {
  const make = (initial, options = {}) => harness(initial, { source: text, ...options });
  const h = make({ [T]: good, [F]: '{"tarot":false}', [L]: 'legacy untouched' });
  h.restore();
  assert.equal(h.state.loadingTab, false);
  assert.equal(h.state.activeTab, 'a');
  assert.equal(h.fields.awakenedItem.value, 'Saved item');
  assert.deepEqual(plain(h.state.slots[0]), { index: 1, name: 'Known', locked: true });
  assert.equal(h.state.filters.tarot, false);
  assert.equal(h.values.get(L), 'legacy untouched');
  assert.equal(h.values.has(B), false);
  const saved = h.values.get(T);
  h.fields.awakenedItem.value = 'Edited';
  h.switchTab('b');
  assert.equal(JSON.parse(h.values.get(T)).active, 'b');
  assert.equal(JSON.parse(h.values.get(T)).tabs[0].setup.item, 'Edited');
  assert.equal(h.fields.awakenedItem.value, 'Edited', 'restore waits for transition');
  assert.equal(h.timers[0].delay, 190);
  h.timers.shift().callback();
  assert.equal(h.fields.awakenedItem.value, '');
  assert.equal(h.state.loadingTab, false);
  const reloaded = make(Object.fromEntries(h.values)); reloaded.restore();
  assert.equal(reloaded.values.get(T), h.values.get(T), 'normal reload storage is byte-exact');
  const historical = make({ [L]: JSON.stringify(setup) }); historical.restore();
  assert.equal(historical.fields.awakenedItem.value, 'Saved item');
  assert.equal(historical.values.get(L), JSON.stringify(setup));
  assert.equal(JSON.parse(historical.values.get(T)).tabs[0].setup.item, 'Saved item');
  assert.notEqual(saved, good, 'normal save still normalizes active setup as before');

  for (const subtypes of [3, {}, true, 'ALIEN', null, false, 0, ['ALIEN']]) {
    const value = JSON.stringify({ tabs: [{ id: 'a', setup: { ...setup, subtypes } }], active: 'a' });
    const s = make({ [T]: value }); s.restore();
    assert.equal(s.state.loadingTab, false);
    assert.equal(s.fields.awakenedItem.value, setup.item);
    assert.equal(s.state.slots[0].name, 'Known');
    const selected = s.subtypes.filter(box => box.checked).map(box => box.value);
    assert.deepEqual(selected, typeof subtypes === 'string' || Array.isArray(subtypes) ? ['ALIEN'] : []);
    assert.deepEqual(JSON.parse(s.values.get(T)).tabs[0].setup.subtypes, selected);
    assert.equal(s.values.has(B), false, 'invalid subtype has no recoverable selection');
    const again = make(Object.fromEntries(s.values)); again.restore();
    assert.equal(again.values.get(T), s.values.get(T));
  }

  for (const invalid of [raw, '{broken', 'null', '', '{}', '[]', '42', 'true',
    '{"tabs":[]}', '{"tabs":[null,{}]}',
    '{"tabs":[null,{"id":"a","label":"Valid","setup":{}}],"active":"a"}']) {
    const s = make({ [T]: invalid, [L]: JSON.stringify(setup), [F]: '{}' }); s.restore();
    assert.equal(s.state.loadingTab, false);
    assert.ok(s.state.tabs.length);
    const untouched = [...s.values];
    s.refresh(); s.persistTabs(); s.saveSetup();
    const tab = s.newTab({}); tab.id += '-next'; s.state.tabs.push(tab); s.switchTab(tab.id);
    assert.equal(s.timers[0].delay, 190); s.timers.shift().callback();
    s.resetSetup();
    assert.deepEqual([...s.values], untouched, 'refresh, switching and reset preserve every key');
    assert.equal(s.values.get(T), invalid);
    const again = make(Object.fromEntries(s.values)); again.restore();
    assert.deepEqual([...again.values], untouched, 'reload preserves original bytes');
    assert.equal(s.calls.some(call => call[0] === 'set' || call[0] === 'remove'), false);
  }
  const fresh = make(); fresh.restore();
  assert.ok(fresh.values.has(T));
  assert.equal(fresh.values.has(B), false);
  // Recovery is an explicit operation; the backup must precede replacement.
  const s = make({ [T]: raw, [L]: 'legacy' }); s.restore();
  s.fields.awakenedItem.value = 'New item'; s.saveSetup();
  assert.equal(s.values.get(T), raw);
  s.resumeTabSaving();
  const writes = s.calls.filter(call => call[0] === 'set');
  assert.deepEqual(writes.map(call => call[1]), [B, T]);
  assert.equal(writes[0][2], raw);
  assert.equal(s.values.get(B), raw);
  assert.equal(JSON.parse(s.values.get(T)).tabs[0].setup.item, 'New item');
  const again = make(Object.fromEntries(s.values)); again.restore();
  assert.equal(again.values.get(B), raw);
  assert.equal(again.values.get(T), s.values.get(T));
  s.resumeTabSaving(); assert.equal(s.values.get(B), raw);
  s.resetSetup(); assert.equal(s.values.get(B), raw, 'normal reset never removes recovery backup');

  for (const mode of ['full', 'unavailable', 'ignored-write', 'bad-readback', 'conflict', 'changed-original']) {
    const initial = { [T]: raw, [L]: 'keep legacy' };
    if (mode === 'conflict') initial[B] = 'older backup';
    let fail = false;
    const s = make(initial, {
      read(key, values) {
        if (fail && mode === 'unavailable') throw Error('storage unavailable');
        if (fail && mode === 'bad-readback' && key === B && values.has(B)) return 'incorrect';
        return values.has(key) ? values.get(key) : null;
      },
      write(key, value, values) {
        if (fail && mode === 'full') throw Error('quota exceeded');
        if (fail && mode === 'ignored-write') return;
        values.set(key, value);
      }
    });
    s.restore(); fail = true;
    if (mode === 'changed-original') s.values.set(T, 'changed elsewhere');
    const original = s.values.get(T);
    s.resumeTabSaving(); s.refresh(); s.persistTabs(); s.resetSetup();
    assert.equal(s.values.get(T), original, mode);
    assert.equal(s.values.get(L), 'keep legacy', mode);
    assert.equal(s.calls.some(call => call[0] === 'set' && call[1] === T), false, mode);
    if (mode === 'conflict') assert.equal(s.values.get(B), 'older backup');
  }
  // Recovery during the 190 ms transition must not copy the old editor into
  // the newly active tab: both setups have already been banked in memory.
  const switching = make({ [T]: raw }); switching.restore();
  switching.fields.awakenedItem.value = 'First item'; switching.saveSetup();
  const target = switching.newTab({ item: 'Second item' }); target.id += '-next';
  switching.state.tabs.push(target); switching.switchTab(target.id);
  switching.resumeTabSaving();
  assert.equal(JSON.parse(switching.values.get(T)).tabs[1].setup.item, 'Second item');
  assert.equal(switching.values.get(B), raw);
  switching.timers.shift().callback();
  assert.equal(switching.fields.awakenedItem.value, 'Second item');
  const existing = make({ [T]: raw, [B]: raw }); existing.restore(); existing.resumeTabSaving();
  assert.equal(existing.values.get(B), raw);
  assert.notEqual(existing.values.get(T), raw);
  assert.equal(existing.calls.some(call => call[0] === 'set' && call[1] === B), false);
  const unreadable = make({ [T]: raw }, { read() { throw Error('unavailable'); } });
  unreadable.restore(); unreadable.refresh(); unreadable.persistTabs(); unreadable.resetSetup();
  assert.equal(unreadable.values.get(T), raw, 'failed initial read cannot authorize an overwrite');
  checks++;
}
console.log(`Calculator storage: ${checks} LF/CRLF runs; recovery, byte preservation, backup failures and normal persistence pass.`);
