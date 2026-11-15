'use strict';
// ROT-B-01: a RealmEye crawl in which pages fail is never "complete", and a
// crawl in which too many fail exits in error without replacing latest.json.
// Offline: the network is replaced by options.request.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const monitor = require('../tools/watch-realmeye.js');

const HOST = 'https://www.realmeye.com';
const SLUGS = ['realm-of-the-mad-god', 'lists', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function page(slug) {
  const links = SLUGS.map(s => `<a href="/wiki/${s}">${s}</a>`).join(' ');
  return `<!doctype html><html><head><title>${slug} - RealmEye</title></head>` +
    `<body><div class="wiki-page"><h1>${slug}</h1><p>${slug} text</p>${links}</div></body></html>`;
}

// A block page served with 200, as a challenge wall does: no wiki body.
const CHALLENGE = '<!doctype html><html><head><title>Just a moment...</title></head><body><p>Checking your browser.</p></body></html>';

// failing(slug) -> null (answers 200) or a status / 'throw'.
function fakeRequest(failing) {
  return async url => {
    const { pathname } = new URL(url);
    if (!pathname.startsWith('/wiki/')) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    const slug = pathname.slice('/wiki/'.length);
    const failure = failing(slug);
    if (failure === 'throw') throw new Error('connect ECONNRESET');
    if (failure === 'challenge') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(CHALLENGE) };
    }
    if (failure) return { status: failure, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>blocked</html>') };
    return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(page(slug)) };
  };
}

function options(extra, failing) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'realmeye-crawl-guard-'));
  const parsed = monitor.parseArgs(['--out', out, '--delay', '0', '--retries', '0', ...extra]);
  parsed.request = fakeRequest(failing);
  return parsed;
}

async function crawl(extra, failing) {
  const opts = options(extra, failing);
  const log = console.log;
  const warn = console.warn;
  const write = process.stdout.write;
  console.log = () => {};
  console.warn = () => {};
  process.stdout.write = () => true;
  try {
    const result = await monitor.crawlOnce(opts);
    return { out: opts.out, result, error: null };
  } catch (error) {
    return { out: opts.out, result: null, error };
  } finally {
    console.log = log;
    console.warn = warn;
    process.stdout.write = write;
  }
}

function snapshots(out) {
  const dir = path.join(out, 'snapshots');
  return fs.readdirSync(dir).map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

(async () => {
  // Pure rules.
  assert.deepStrictEqual(monitor.crawlHealth([{ status: 200 }, { status: 404 }, { status: 0, robotsDenied: true }]),
    { total: 3, failed: 0, failedRatio: 0 });
  assert.strictEqual(monitor.crawlHealth([{ status: 403 }, { status: 0, error: 'x' }, { status: 503 }, { status: 200 }]).failed, 3);
  const base = { maxPagesReached: false, pagesCount: 5, queueLength: 5, failed: 0, explicitSeeds: false };
  assert.strictEqual(monitor.crawlComplete(base), true);
  assert.strictEqual(monitor.crawlComplete({ ...base, failed: 1 }), false);
  assert.strictEqual(monitor.crawlComplete({ ...base, explicitSeeds: true }), false);
  assert.throws(() => monitor.parseArgs(['--max-error-ratio', '1.5']), /max-error-ratio/);

  // Normal case: every page answers, the crawl is complete and promoted.
  const normal = await crawl([], () => null);
  assert.strictEqual(normal.error, null, normal.error && normal.error.message);
  assert.strictEqual(normal.result.snapshot.complete, true);
  assert.strictEqual(normal.result.snapshot.pages.length, SLUGS.length);
  assert.ok(fs.existsSync(path.join(normal.out, 'latest.json')));

  // Every page blocked (the Cloudflare case of the audit): before the fix,
  // nothing was discovered and the run was declared complete with exit 0.
  for (const failure of [403, 'throw']) {
    const blocked = await crawl([], () => failure);
    assert.ok(blocked.error, `all pages ${failure}: the crawl must fail`);
    assert.match(blocked.error.message, /crawl failed: 2 of 2 pages unreadable/);
    assert.ok(!fs.existsSync(path.join(blocked.out, 'latest.json')), 'a failed crawl never becomes latest.json');
    const [snapshot] = snapshots(blocked.out);
    assert.strictEqual(snapshot.complete, false);
  }

  // A challenge page answered 200 everywhere: a failure, nothing archived as content.
  assert.strictEqual(monitor.hasWikiContent(CHALLENGE), false);
  assert.strictEqual(monitor.hasWikiContent(page('a')), true);
  const walled = await crawl([], () => 'challenge');
  assert.ok(walled.error, 'a 200 challenge on every page must fail the crawl');
  assert.match(walled.error.message, /2 of 2 pages unreadable/);
  const [wall] = snapshots(walled.out);
  assert.ok(wall.pages.every(one => one.error && !one.rawHash), 'a challenge page is never stored as the page');
  assert.ok(!fs.existsSync(path.join(walled.out, 'objects')) || fs.readdirSync(path.join(walled.out, 'objects')).length === 0);

  // One trapped page in ten stays under the limit, and is kept out of the archive.
  const oneTrap = await crawl([], slug => slug === 'c' ? 'challenge' : null);
  assert.strictEqual(oneTrap.error, null);
  const trapped = oneTrap.result.snapshot.pages.find(one => one.url.endsWith('/wiki/c'));
  assert.ok(trapped.error && !trapped.rawHash);
  assert.strictEqual(oneTrap.result.snapshot.complete, false);

  // 30 % of the pages fail: above the default 20 % limit.
  const failing = new Set(['a', 'b', 'c']);
  const partial = await crawl([], slug => failing.has(slug) ? 503 : null);
  assert.ok(partial.error, '30 % failures must fail the crawl');
  assert.match(partial.error.message, /3 of 10 pages unreadable \(30%/);
  assert.strictEqual(snapshots(partial.out)[0].complete, false);

  // The limit can be set: the same 30 % passes at 0.5, but is still not complete.
  const tolerated = await crawl(['--max-error-ratio', '0.5'], slug => failing.has(slug) ? 503 : null);
  assert.strictEqual(tolerated.error, null);
  assert.strictEqual(tolerated.result.snapshot.complete, false);
  assert.ok(fs.existsSync(path.join(tolerated.out, 'latest.json')));

  // The cloud update's seed mode never yields a complete crawl, even when all goes well.
  const seeded = await crawl(['--no-sitemap', '--seed', HOST + '/wiki/a', '--max-pages', '3'], () => null);
  assert.strictEqual(seeded.error, null);
  assert.strictEqual(seeded.result.snapshot.complete, false);

  console.log('realmeye crawl guard: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
