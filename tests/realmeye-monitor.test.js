'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const monitor = require('../tools/watch-realmeye.js');

const html1 = `<!doctype html><html><head><title>Alpha - RealmEye</title><link rel="canonical" href="https://realmeye.com/wiki/alpha"></head><body><div class="wiki-page"><h1>Alpha</h1><p>HP: 100</p><a href="/wiki/beta#x">Beta</a></div><div class="col-md-3 wiki-sidebar">noise</div></body></html>`;
const html2 = `<!doctype html><html><head><title>Alpha - RealmEye</title><link href="/wiki/alpha" rel="canonical"></head><body><div class="wiki-page"><h1>Alpha</h1><p>HP: 120</p><a href="https://www.realmeye.com/wiki/beta?foo=1">Beta</a></div><div class="col-md-3 wiki-sidebar">different noise</div></body></html>`;

assert.strictEqual(monitor.canonicalWikiUrl('https://realmeye.com/wiki/beta?x=1#z'), 'https://www.realmeye.com/wiki/beta');
assert.ok(!monitor.extractWikiMain(html1).includes('noise'));
assert.deepStrictEqual(monitor.extractLinks(html1), ['https://www.realmeye.com/wiki/alpha', 'https://www.realmeye.com/wiki/beta']);
assert.strictEqual(monitor.extractCanonical(html1), 'https://www.realmeye.com/wiki/alpha');
assert.strictEqual(monitor.extractCanonical(html2), 'https://www.realmeye.com/wiki/alpha');
assert.notStrictEqual(
  monitor.normalizeWikiContent(monitor.extractWikiMain(html1)),
  monitor.normalizeWikiContent(monitor.extractWikiMain(html2))
);
assert.ok(monitor.firstDifference(monitor.textFromHtml(html1), monitor.textFromHtml(html2)));

const robots = monitor.parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\n', 'rotmg-tools-realmeye-monitor');
assert.strictEqual(robots.allowed('https://www.realmeye.com/wiki/alpha'), true);
assert.strictEqual(robots.allowed('https://www.realmeye.com/private/no'), false);
assert.strictEqual(robots.allowed('https://www.realmeye.com/private/public/x'), true);

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'realmeye-monitor-test-'));
const raw1 = monitor.storeHtmlObject(out, html1);
const raw2 = monitor.storeHtmlObject(out, html2);
const main1 = monitor.normalizeWikiContent(monitor.extractWikiMain(html1));
const main2 = monitor.normalizeWikiContent(monitor.extractWikiMain(html2));
const previous = { generatedAt: '2026-09-10T00:00:00.000Z', pages: [{ url: 'https://www.realmeye.com/wiki/alpha', finalUrl: 'https://www.realmeye.com/wiki/alpha', status: 200, title: 'Alpha', rawHash: raw1, contentHash: require('crypto').createHash('sha256').update(main1).digest('hex') }] };
const current = { generatedAt: '2026-09-11T00:00:00.000Z', complete: true, pages: [{ url: 'https://www.realmeye.com/wiki/alpha', finalUrl: 'https://www.realmeye.com/wiki/alpha', status: 200, title: 'Alpha', rawHash: raw2, contentHash: require('crypto').createHash('sha256').update(main2).digest('hex') }] };
const report = monitor.makeReport(previous, current, out);
assert.strictEqual(report.counts.changed, 1);
assert.strictEqual(report.counts.added, 0);
assert.strictEqual(report.counts.removed, 0);

const baseline = monitor.makeReport(null, current, out);
assert.strictEqual(baseline.baseline, true);
assert.strictEqual(baseline.counts.added, 0);

console.log('ok');
