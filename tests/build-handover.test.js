'use strict';

/*
 * TheoryCraft -> Enchant Calculator, for one item and for a whole build.
 *
 * The bench builds each hand-over with one function (handoverFor) and the
 * calculator turns each into a setup with one function (handoverSetup), so a
 * whole build is the single-item path four times. These check the two ends:
 * every item carries only its own enchantments, an empty slot is not handed
 * over, an item the calculator cannot place is reported and does not stop
 * the others, and the tabs already open are never touched.
 */

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const harness = require('./theory-harness');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const raw = require('../data/TheoryCraft/theorycraft.json');

const sources = {
  clientModText: read('data', 'Enchantment documents', 'client-enchantments.txt'),
  clientItemText: read('data', 'Items', 'client-items.txt'),
  clientArtifactText: read('data', 'Artifacts', 'client-artifacts.txt'),
  awakenText: read('data', 'Awakened Items', 'awakenedItems.txt')
};

/* ------------------------------------------------------------------ *
 * The bench: one hand-over per filled slot, each with its own ench    *
 * ------------------------------------------------------------------ */

const t = harness(sources, raw, true);
const HANDS = ['weapon', 'ability', 'armor', 'ring'];

// Enchantments the calculator can name, found by asking the same function
// the button uses rather than by guessing a spelling here.
const probe = t.fresh('Wizard');
t.use(probe);
const usable = [];
for (const one of raw.enchants) {
  if (usable.length >= 16) break;
  if (/^AWAKENED/.test(one.id)) continue;
  probe.gear.weapon.ench = [one.id, null, null, null];
  const said = t.handoverFor('weapon');
  if (said && said.slots.length === 1 && !usable.some(u => u.name === said.slots[0])) {
    usable.push({ id: one.id, name: said.slots[0] });
  }
}
assert.equal(usable.length, 16, 'HANDOVER-001 sixteen distinct nameable enchantments exist for the fixture');

const state = t.fresh('Wizard');
HANDS.forEach((hand, i) => {
  assert(state.gear[hand].name, `HANDOVER-002 the starter build fills the ${hand}`);
  state.gear[hand].ench = usable.slice(i * 4, i * 4 + 4).map(one => one.id);
});
t.use(state);

const whole = t.buildHandover();
assert.equal(whole.length, 4, 'HANDOVER-003 a full build hands over four items');
whole.forEach((said, i) => {
  assert.equal(said.item, state.gear[HANDS[i]].name,
    `HANDOVER-003 the ${HANDS[i]} is handed over in page order`);
  assert.deepEqual([...said.slots], usable.slice(i * 4, i * 4 + 4).map(one => one.name),
    `HANDOVER-004 the ${HANDS[i]} carries exactly its own enchantments`);
  assert.deepEqual(JSON.parse(JSON.stringify(said)), JSON.parse(JSON.stringify(t.handoverFor(HANDS[i]))),
    `HANDOVER-005 the build path is the single-item path for the ${HANDS[i]}`);
});
const everyName = whole.flatMap(said => said.slots);
assert.equal(new Set(everyName).size, everyName.length,
  'HANDOVER-004 no enchantment is carried by two items');

state.gear.ability.name = null;
const gap = t.buildHandover();
assert.deepEqual([...gap.map(said => said.item)],
  [state.gear.weapon.name, state.gear.armor.name, state.gear.ring.name],
  'HANDOVER-006 an empty slot is not handed over');
assert.equal(t.handoverFor('ability'), null, 'HANDOVER-006 an empty slot hands over nothing');

/* ------------------------------------------------------------------ *
 * The calculator: new tabs only, one per placeable item               *
 * ------------------------------------------------------------------ */

const app = read('web', 'app.js');
const slice = (from, to) => {
  const start = app.indexOf(from);
  const end = app.indexOf(to, start);
  assert(start >= 0 && end > start, `HANDOVER-010 app.js still has ${from.trim()}`);
  return app.slice(start, end);
};
const script = [
  slice('function labelForSetup(setup)', 'function persistTabs()'),
  slice('function handoverSetup(said)', 'window.enchantThis = function'),
  slice('function tabsForBuild(list, group)', 'window.enchantBuild = function')
].join('\n') + '\nmodule.exports = { handoverSetup, tabsForBuild, newTab, enchantCan: window.enchantCan };';

const known = new Map([
  ['Known Staff', { type: 'WEAPON', dust: 'Red' }],
  ['Known Spell', { type: 'ABILITY', dust: 'Blue' }],
  ['Known Robe', { type: 'ARMOR', dust: 'Green' }]
]);
const existing = [{ id: 'kept', label: 'Somebody else', setup: { item: 'Other', slots: [{ name: 'A', locked: true }] } }];
const context = {
  module: { exports: {} }, window: {},
  Date, Math, Set, Array, String, Boolean,
  state: {
    data: { byName: new Map(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(name => [name, {}])) },
    tabs: existing
  },
  resolveItem: name => (known.has(name) ? Object.assign({ name }, known.get(name)) : null)
};
vm.runInNewContext(script, context, { filename: 'app.js (build hand-over slice)' });
const { tabsForBuild, enchantCan } = context.module.exports;
const before = JSON.stringify(existing);

const made = tabsForBuild([
  { item: 'Known Staff', slots: ['A', 'B'] },
  { item: 'Unknown Ring', slots: ['C'] },
  { item: 'Known Spell', slots: ['C', 'D', 'Not a mod'] },
  null,
  { item: 'Known Robe', slots: ['E', 'F', 'G', 'A', 'B'] }
], { id: 'g1', label: 'Wizard build' });

assert.deepEqual([...made.skipped], ['Unknown Ring'],
  'HANDOVER-011 an item the calculator cannot place is reported, not given a tab');
assert.deepEqual([...made.tabs.map(tab => tab.label)], ['Known Staff', 'Known Spell', 'Known Robe'],
  'HANDOVER-012 every placeable item gets a tab named after it, in order');
assert.deepEqual([...made.tabs].map(tab => [...tab.setup.slots.map(slot => slot.name)]),
  [['A', 'B'], ['C', 'D'], ['E', 'F', 'G', 'A']],
  'HANDOVER-013 each tab holds only its own known enchantments, at most four');
assert.deepEqual([...made.tabs].map(tab => [tab.setup.type, tab.setup.dust]),
  [['WEAPON', 'Red'], ['ABILITY', 'Blue'], ['ARMOR', 'Green']],
  'HANDOVER-014 each tab takes its own item facts');
assert.equal(new Set([...made.tabs.map(tab => tab.id), 'kept']).size, 4,
  'HANDOVER-015 new tabs never share an id with each other or an open tab');
assert.notEqual(made.tabs[0].setup.slots, made.tabs[1].setup.slots,
  'HANDOVER-013 no two tabs share one slot list');
assert.equal(JSON.stringify(existing), before, 'HANDOVER-016 the tabs already open are left untouched');
assert.deepEqual([...made.tabs].map(tab => tab.group && tab.group.id + ':' + tab.group.label),
  ['g1:Wizard build', 'g1:Wizard build', 'g1:Wizard build'], 'HANDOVER-017 a sent build stays together as one named group');
assert.notEqual(made.tabs[0].group, made.tabs[1].group, 'HANDOVER-017 no two tabs share one group object');
assert.equal(enchantCan('Known Staff'), true, 'HANDOVER-018 the bench is told an enchantable item can be sent');
assert.equal(enchantCan('Unknown Ring'), false, 'HANDOVER-018 and told plainly when the game will not enchant one');
assert.equal(context.state.tabs, existing, 'HANDOVER-016 building tabs does not replace the open set');

/* And the page wiring: the build button goes through the shared path. */
const theory = read('web', 'theorycraft.js');
assert(theory.includes("window.enchantThis(said);") && theory.includes('const said = handoverFor(take.dataset.take);'),
  'HANDOVER-020 the single-item button uses handoverFor');
assert(theory.includes('window.enchantBuild(said, { label: build.name })') && theory.includes('const said = buildHandover();'),
  'HANDOVER-021 the whole-build button uses buildHandover');
assert(app.includes('const made = tabsForBuild(list, { id: groupId, label });') && app.includes('state.tabs.push(...made.tabs);'),
  'HANDOVER-022 the calculator appends the new tabs rather than rewriting the open one');
assert(read('web', 'index.html').includes('id="tcTakeAll"'), 'HANDOVER-023 the whole-build button is on the page');
assert(theory.includes('const refused = said => can && can(said.item) === false;') && theory.includes('button.disabled = !ok.length;'),
  'HANDOVER-024 the whole-build button says up front what the calculator will not take');
assert(app.includes('sayTabNote(made.skipped.length'), 'HANDOVER-025 what could not be sent is said on the calculator page');
assert(app.includes('function closeGroup(id)') && app.includes('data-close-group='), 'HANDOVER-026 a sent build closes as one group');

/* ------------------------------------------------------------------ *
 * A sent build's group: folded, renamed and recoloured as one         *
 * ------------------------------------------------------------------ */
{
  const start = app.indexOf('const GROUP_COLOURS = {');
  const end = app.indexOf('/* Every tab of one sent build at once.');
  assert(start >= 0 && end > start, 'HANDOVER-030 the group helpers remain extractable');
  const switched = [];
  let drawn = 0, kept = 0;
  const group = () => ({ id: 'g1', label: 'Wizard build', colour: 'blue' });
  const groupContext = {
    Object, Math, String,
    state: {
      activeTab: 't2',
      tabs: [{ id: 't1' }, { id: 't2', group: group() }, { id: 't3', group: group() }, { id: 't4' }]
    },
    document: { createElement: () => ({ dataset: {}, set innerHTML(v) { this.html = v; } }) },
    html: text => String(text),
    persistTabs: () => { kept++; },
    renderTabs: () => { drawn++; },
    switchTab: id => { switched.push(id); },
    module: { exports: {} }
  };
  vm.runInNewContext(app.slice(start, end) + '\nmodule.exports = { updateGroup, toggleGroup, groupMenu, GROUP_COLOURS };',
    groupContext, { filename: 'app.js (tab group slice)' });
  const g = groupContext.module.exports;
  const members = () => groupContext.state.tabs.filter(tab => tab.group);

  g.updateGroup('g1', { label: 'Wizard DPS', colour: 'gold' });
  assert(members().every(tab => tab.group.label === 'Wizard DPS' && tab.group.colour === 'gold'),
    'HANDOVER-031 a rename and a colour reach every tab of the group');
  assert.equal(groupContext.state.tabs[0].group, undefined, 'HANDOVER-031 and no tab outside it');
  assert(kept >= 1 && drawn >= 1, 'HANDOVER-031 the change is kept and drawn');

  g.toggleGroup('g1');
  assert(members().every(tab => tab.group.collapsed === true), 'HANDOVER-032 folding folds the whole group');
  assert.deepEqual([...switched], ['t1'], 'HANDOVER-033 folding the group on screen moves to the nearest tab outside it');
  g.toggleGroup('g1');
  assert(members().every(tab => tab.group.collapsed === false), 'HANDOVER-034 and pressing it again opens it');

  groupContext.state.tabs = [{ id: 't2', group: group() }];
  groupContext.state.activeTab = 't2';
  switched.length = 0;
  g.toggleGroup('g1');
  assert(groupContext.state.tabs[0].group.collapsed === true && switched.length === 0,
    'HANDOVER-035 with nothing outside it, the group still folds and the editor stays');
  assert(Object.keys(g.GROUP_COLOURS).length >= 4, 'HANDOVER-036 a group has colours to choose from');
  assert(/data-group-name="g1"/.test(g.groupMenu(group(), 'blue').html)
    && /data-group-colour="gold"/.test(g.groupMenu(group(), 'blue').html), 'HANDOVER-036 the group menu offers a name and colours');
  assert(app.includes('if (tab.group && tab.group.collapsed) continue;'), 'HANDOVER-037 a folded group draws no tabs of its own');
}

console.log('build hand-over contract: ok');
