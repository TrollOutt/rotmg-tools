'use strict';

/*
 * tools/realmeye-link-report.js on a tiny Index: what counts as having a page,
 * and what is left out of the lists.
 */
const assert = require('assert/strict');
const { report, slugOf } = require('../tools/realmeye-link-report');

const index = {
  records: [
    { id: 'item:Coral Bow', kind: 'item', name: 'Coral Bow' },
    { id: 'item:Coral Bow (SB)', kind: 'item', name: 'Coral Bow (SB)' },
    { id: 'item:Hidden Bow', kind: 'item', name: 'Hidden Bow' },
    { id: 'enemy:Thessal', kind: 'enemy', name: 'Thessal' },
    { id: 'enemy:Thessal#Wounded', kind: 'enemy', name: 'Thessal' },
    { id: 'portal:Legacy Ocean Trench', kind: 'portal', name: 'Legacy Ocean Trench', said: 'Legacy Ocean Trench Portal' },
    { id: 'portal:Admin Room', kind: 'portal', name: 'Admin Room', hidden: true }
  ],
  views: { theory: { items: ['item:Coral Bow', 'item:Coral Bow (SB)', 'item:Hidden Bow'], bosses: ['enemy:Thessal#Wounded'] } }
};
const enrichment = {
  records: {
    'item:Coral Bow': { communityOnly: false },
    'enemy:Thessal': { communityOnly: false },
    'portal:Ocean Trench (Original)': { communityOnly: true }
  }
};
const availability = { records: { 'item:Hidden Bow': 'unreleased' } };
const whatsNew = {
  made: '2026-11-03',
  drawers: {
    weapons: { added: [{ id: 'Coral Bow' }, { id: 'Coral Bow (SB)' }], changed: [], gone: [] },
    places: { added: [{ id: 'Legacy Ocean Trench Portal' }, { id: 'Ocean Trench Gravestone 1' }], changed: [{ id: 'Coral Bow' }], gone: [] }
  }
};

const { latest, shown } = report(index, enrichment, availability, whatsNew);
const group = label => shown.find(g => g.label === label);

assert.deepEqual(latest.without, ['item:Coral Bow (SB)', 'portal:Legacy Ocean Trench'],
  'LINKS-001 the update\'s records without a page, found by the name the game shows');
assert.equal(latest.total, 3, 'LINKS-002 an entry listed twice counts once');
assert.equal(latest.outsideIndex, 1, 'LINKS-003 an entry the Index lacks is counted, not listed');
assert.deepEqual(group('Theory gear').without, ['item:Coral Bow (SB)'], 'LINKS-004 an unreleased record is left out');
assert.equal(group('Theory gear').total, 2, 'LINKS-005 and not counted');
assert.deepEqual(group('Theory creatures').without, ['enemy:Thessal#Wounded'], 'LINKS-006 a variant needs its own link');
assert.deepEqual(group('Portals').without, ['portal:Legacy Ocean Trench'],
  'LINKS-007 a community-only record is no link, and a hidden portal is not shown');
assert.equal(slugOf('Helm of the Juggernaut - Chaos'), 'helm-of-the-juggernaut-chaos', 'LINKS-008 the likely wiki address');

console.log('realmeye-link-report: ok');
