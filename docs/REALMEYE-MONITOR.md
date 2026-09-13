# RealmEye monitor

This tool archives the RealmEye wiki locally and compares each crawl with the previous one.

It is deliberately split from the business-data extractors: the monitor stores source HTML and change metadata; a later extractor or AI can decide which facts matter for the site.

## What it detects

- new wiki pages;
- pages that return 404/410 or a recognizable deleted-page body;
- redirects / moved pages;
- meaningful changes inside RealmEye's `wiki-page` content area;
- raw HTML changes where the wiki content itself stayed the same;
- temporary HTTP/network failures separately, so they are not reported as deletions.

## Storage

Default local directory:

```text
local/realmeye-monitor/
  objects/               # raw HTML, gzip-compressed and addressed by SHA-256
  snapshots/             # one full manifest per run
  reports/               # JSON + Markdown change report per run
  latest.json            # latest manifest
  latest-report.json
  latest-report.md
```

Unchanged HTML is stored only once because `objects/` is content-addressed.

Do not publish the raw archive unless you have the right to redistribute it. The existing project already treats the RealmEye snapshot as local-only source material.

## First run

```bash
node tools/watch-realmeye.js
```

The first run creates a baseline. The second and following runs produce actual change reports.

If you already have the bundle used by `tools/index-wiki.js`, seed the crawl with it:

```bash
REALM_INDEX_BUNDLE=/absolute/path/to/bundle node tools/watch-realmeye.js
```

That is strongly recommended because every URL already known by the old snapshot is checked, including pages that may no longer be linked anywhere.

## Periodic run

Example: every 6 hours, sequentially:

```bash
node tools/watch-realmeye.js --watch 21600
```

Or use cron / Task Scheduler and keep the default one-shot mode.

The default request spacing is 1000 ms. Keep the crawl polite. If RealmEye returns 429 or 5xx responses, the monitor backs off and retries.

## Full validation

Normal runs use `ETag` / `Last-Modified` when RealmEye provides them. To force complete bodies again:

```bash
node tools/watch-realmeye.js --full
```

A good pattern is conditional checks most of the time and an occasional full run.

## Useful options

```text
--delay 1500
--concurrency 1
--watch 21600
--full
--seed https://www.realmeye.com/wiki/some-page
--bundle /path/to/bundle
--max-pages 100
--verbose
```

The crawler respects `robots.txt` by default and probes sitemap files when available.

## Completeness limit

No crawler can discover a brand-new orphan page that is simultaneously:

1. absent from the previous bundle/snapshot,
2. absent from a sitemap,
3. and not linked by any crawled wiki page.

For everything previously known, the monitor is stronger: previous URLs are always rechecked, so deletion and change detection do not depend on the page still being linked.
