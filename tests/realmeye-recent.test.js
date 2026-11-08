'use strict';

/*
 * tools/realmeye-recent.js on a copy of the page's table layout: what an edit
 * reads as, and that the log keeps each revision once.
 */
const assert = require('assert/strict');
const { parseRecent, layoutProblem, merge, pending } = require('../tools/realmeye-recent');

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

// An edit that a later one superseded links to that revision: /wiki/<slug>/<revision> is the same page.
const older = parseRecent(page([row('coral-bow/85', 'Coral Bow', 85, 'imgs', '2026-11-06T15:51:45Z')]));
assert.equal(older[0].slug, 'coral-bow', 'RECENT-012 a revision link is read as its page');
const before = { integratedThrough: null, entries: [{ slug: 'coral-bow/85', revision: 85, created: '2026-11-06T15:51:45Z' }] };
assert.deepEqual(merge(before, [...older, { slug: 'coral-bow', revision: 86, created: '2026-11-06T18:24:15Z' }]).map(e => e.revision), [86],
  'RECENT-013 a log kept before is read the same way, and keeps the revision once');
assert.deepEqual(pending(before), ['coral-bow'], 'RECENT-014 the page is asked once');

assert.equal(layoutProblem(page([]), []), null, 'RECENT-008 a quiet day, the table empty, is not a fault');
assert.equal(layoutProblem(page([row('a', 'A', 2, 'x', '2026-11-06T10:00:00Z')]), first), null, 'RECENT-009 rows that read');
assert.match(layoutProblem('<html><body>Just a moment...</body></html>', []), /table is gone/, 'RECENT-010 no table');
assert.match(layoutProblem(page(['<tr><td>other</td></tr>']), []), /rows no longer read/, 'RECENT-011 rows that do not read');

console.log('realmeye-recent: ok');
