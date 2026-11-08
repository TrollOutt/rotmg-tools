'use strict';
/*
 * Keep RealmEye's list of recent wiki edits before it forgets them.
 *
 *   node tools/realmeye-recent.js --log <file>             read the list, add what is new
 *   node tools/realmeye-recent.js --log <file> --pending   the pages edited since the last
 *                                                          integration, one per line
 *   node tools/realmeye-recent.js --log <file> --integrated-through <created>
 *                                                          everything up to then is in the archive
 *
 * recent-changes-of-the-rotmg-wiki shows only the last day or so, and only so
 * many rows, so it is read every few hours and each edit kept in the log: one
 * entry per page revision, which a later read never duplicates. The log is the
 * watch's own state and is kept privately, with the archive, not in this
 * repository. One request per run, with the archive monitor's user agent.
 */
const fs = require('fs');

const URL = 'https://www.realmeye.com/recent-changes-of-the-rotmg-wiki';
const AGENT = 'rotmg-tools-realmeye-monitor/1.0 (+https://github.com/TrollOutt/rotmg-tools)';

const decode = value => String(value)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&amp;/g, '&');
/* A page's slug: an older revision is linked as /wiki/<slug>/<revision>, the same page. */
const pageSlug = slug => slug.replace(/\/\d+$/, '');
const text = cell => decode(cell.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/* The rows of the changes table: page, revision, comment, author, when, size. */
function parseRecent(page) {
  const out = [];
  for (const [, row] of page.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
    const slug = /href="\/wiki\/([^"#?]+)"/.exec(row)?.[1];
    if (!slug || cells.length < 5) continue;
    // The time is in UTC in the timeago title; the shown comment is cut short, the abbr title is whole.
    const created = /class="timeago" title="([^"]+)"/.exec(cells[4])?.[1];
    const revision = Number(text(cells[1]).match(/^\d+/)?.[0]);
    if (!created || !revision) continue;
    out.push({
      slug: pageSlug(decode(slug)), title: text(cells[0]), revision,
      comment: decode(/<abbr title="([^"]*)"/.exec(cells[2])?.[1] ?? text(cells[2])),
      author: text(cells[3]), created
    });
  }
  return out;
}

/* Why the page cannot be trusted, or null. A quiet day leaves the table with no
 * rows, which is not a fault; a table that is gone, or rows that no longer read, is. */
function layoutProblem(page, entries) {
  const body = /<th>Page<\/th>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(page)?.[1];
  if (body == null) return 'the recent changes table is gone: has its layout changed?';
  if (!entries.length && /<tr\b/.test(body)) return 'the recent changes rows no longer read: has their layout changed?';
  return null;
}

/* Adds what the log lacks; returns the entries that were new. */
function merge(log, entries) {
  for (const e of log.entries) e.slug = pageSlug(e.slug); // logs written before revision links were read
  const seen = new Set(log.entries.map(e => e.slug + '#' + e.revision));
  const added = entries.filter(e => !seen.has(e.slug + '#' + e.revision));
  log.entries.push(...added);
  log.entries.sort((a, b) => a.created.localeCompare(b.created) || a.slug.localeCompare(b.slug));
  return added;
}

const pending = log => [...new Set(log.entries
  .filter(e => !log.integratedThrough || e.created > log.integratedThrough).map(e => pageSlug(e.slug)))];

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  const file = option('--log');
  if (!file) throw new Error('--log <file> is required');
  const log = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { integratedThrough: null, entries: [] };
  const save = () => fs.writeFileSync(file, JSON.stringify(log, null, 1) + '\n');

  if (args.includes('--pending')) {
    for (const slug of pending(log)) console.log(slug);
    return;
  }
  const through = option('--integrated-through');
  if (through) {
    log.integratedThrough = through;
    save();
    console.log(JSON.stringify({ integratedThrough: through, pending: pending(log).length }));
    return;
  }
  const response = await fetch(URL, { headers: { 'user-agent': AGENT } });
  if (!response.ok) throw new Error(`RealmEye answered ${response.status}`);
  const page = await response.text();
  const entries = parseRecent(page);
  const problem = layoutProblem(page, entries);
  if (problem) throw new Error(problem);
  const added = merge(log, entries);
  save();
  console.log(JSON.stringify({ listed: entries.length, added: added.length, pending: pending(log).length,
    latest: log.entries.at(-1)?.created ?? null }));
}

module.exports = { parseRecent, layoutProblem, merge, pending };

if (require.main === module) {
  main().catch(error => {
    console.error(`\n  ${error.message}\n`);
    process.exitCode = 1;
  });
}
