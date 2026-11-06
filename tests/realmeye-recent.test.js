'use strict';

/*
 * tools/realmeye-recent.js on a copy of the page's table layout: what an edit
 * reads as, and that the log keeps each revision once.
 */
const assert = require('assert/strict');
const { parseRecent, merge, pending } = require('../tools/realmeye-recent');

const row = (slug, title, rev, comment, created) => `<tr><td><a href="/wiki/${slug}" title="/wiki/${slug}">${title}</a></td>`
  + `<td>${rev}<span class="muted"> (<a title="Diff with the previous revision" href="/compare-revisions-of-wiki-page/${slug}/${rev - 1}/${rev}">P</a>)</span></td>`
  + `<td>${comment}</td><td><a href="/player/Someone">Someone</a></td>`
  + `<td><span class="timeago" title="${created}">${created.replace('T', ' ').replace('Z', '')}</span></td>`
  + '<td>35315&nbsp;<span style="color: green">(+285)</span></td><td></td></tr>';
const page = rows => '<table id="u" class="table"><thead><tr><th>Page</th><th><abbr title="Revision">Rev.</abbr></th>'
  + '<th>Comment</th><th>Author</th><th>Created</th><th>Bytes</th><th>S.</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';

const first = parseRecent(page([
  row('haunted-cemetery-guide', 'Haunted Cemetery Guide', 78, '<abbr title="added info about boss spawn locations">added inf...ocations</abbr>', '2026-11-06T08:59:43Z'),
  row('thessal-s-tides', 'Thessal&#39;s Tides', 3, 'outdated', '2026-11-06T07:15:39Z')
]));
assert.deepEqual(first[0], {
  slug: 'haunted-cemetery-guide', title: 'Haunted Cemetery Guide', revision: 78,
  comment: 'added info about boss spawn locations', author: 'Someone', created: '2026-11-06T08:59:43Z'
}, 'RECENT-001 an edit: the whole comment, the time in UTC');
assert.equal(first[1].title, "Thessal's Tides", 'RECENT-002 entities are decoded');
assert.equal(first.length, 2, 'RECENT-003 the header row is not an edit');

const log = { integratedThrough: null, entries: [] };
assert.equal(merge(log, first).length, 2);
const again = parseRecent(page([
  row('ocean-trench', 'Ocean Trench', 12, 'drops', '2026-11-06T10:00:00Z'),
  row('haunted-cemetery-guide', 'Haunted Cemetery Guide', 78, 'x', '2026-11-06T08:59:43Z')
]));
assert.deepEqual(merge(log, again).map(e => e.slug), ['ocean-trench'], 'RECENT-004 a revision already kept is not kept twice');
assert.deepEqual(log.entries.map(e => e.created), ['2026-11-06T07:15:39Z', '2026-11-06T08:59:43Z', '2026-11-06T10:00:00Z'],
  'RECENT-005 the log is in time order');

assert.deepEqual(pending(log), ['thessal-s-tides', 'haunted-cemetery-guide', 'ocean-trench'], 'RECENT-006 nothing integrated yet');
log.integratedThrough = '2026-11-06T08:59:43Z';
assert.deepEqual(pending(log), ['ocean-trench'], 'RECENT-007 only what came after the last integration');

console.log('realmeye-recent: ok');
