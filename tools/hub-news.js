'use strict';
/*
 * Keep the posts DECA publishes on its own site, the RotMG Hub.
 *
 *   node tools/hub-news.js --log <file>             read the sitemap, keep each new post
 *   node tools/hub-news.js --log <file> --pending   the posts since the last integration,
 *                                                   as Markdown for whoever reads the update
 *   node tools/hub-news.js --log <file> --integrated-through <iso>
 *                                                   everything published up to then is read
 *
 * hub.realmofthemadgod.com carries the patch notes, the developers' articles
 * and a copy of every Discord announcement (the news/updates/discord-<id>
 * pages), so it alone covers Discord, X and Steam. Its sitemap lists every
 * post; a post's page holds the article as data (category, publication time,
 * whole HTML), so no browser and no AI are needed to collect it. A post is
 * fetched once, the first time the sitemap lists it. The log is the watch's
 * own state and is kept privately, not in this repository.
 */
const fs = require('fs');

const SITE = 'https://hub.realmofthemadgod.com';
const AGENT = 'rotmg-tools-news-monitor/1.0 (+https://github.com/TrollOutt/rotmg-tools)';
const DELAY_MS = 500;

/* The posts in the sitemap (news, news0... then a section, then a slug), not the listing pages. */
function postPaths(sitemap) {
  return [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(([, url]) => url.trim().replace(SITE, ''))
    .filter(path => /^\/news[^/]*\/[^/]+\/[^/]+$/.test(path)))];
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = value => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&(\w+);/g, (whole, name) => entities[name] ?? whole);

/* The article's HTML as plain text: a line per paragraph, list item or break. */
function plainText(html) {
  return decode(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* A JavaScript string literal's body, as the page's serialised data writes it. */
const unquote = body => JSON.parse('"' + body
  .replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')
  .replace(/\\'/g, "'") + '"');

/* The post a page carries, or null when the page no longer reads. */
function parsePost(page, path) {
  const start = page.indexOf('article:$R[');
  if (start < 0) return null;
  const article = page.slice(start, start + 400000);
  const field = name => new RegExp(`[{,]${name}:("((?:\\\\.|[^"\\\\])*)"|[\\w.!]+)`).exec(article);
  const string = name => { const m = field(name); return m && m[2] != null ? unquote(m[2]) : null; };
  const number = name => { const m = field(name); return m && /^\d+$/.test(m[1]) ? Number(m[1]) : null; };
  const html = string('html');
  const seconds = number('published_at') ?? number('datetime');
  if (html == null || !seconds) return null;
  const text = plainText(html);
  return {
    path,
    category: string('category') || null,
    title: string('title') || text.split('\n')[0].slice(0, 120),
    published: new Date(seconds * 1000).toISOString(),
    text
  };
}

/* Adds what the log lacks; returns the posts that were new. */
function merge(log, posts) {
  const seen = new Set(log.entries.map(e => e.path));
  const added = posts.filter(p => !seen.has(p.path));
  log.entries.push(...added);
  log.entries.sort((a, b) => a.published.localeCompare(b.published) || a.path.localeCompare(b.path));
  return added;
}

const pending = log => log.entries.filter(e => !log.integratedThrough || e.published > log.integratedThrough);

const digest = posts => posts.map(p => `## ${p.title}\n\n${p.published.slice(0, 16).replace('T', ' ')} UTC`
  + ` · ${p.category ?? 'post'} · ${SITE}${p.path}\n\n${p.text}\n`).join('\n');

async function get(url) {
  const response = await fetch(url, { headers: { 'user-agent': AGENT } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  const file = option('--log');
  if (!file) throw new Error('--log <file> is required');
  const log = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { integratedThrough: null, entries: [] };
  const save = () => fs.writeFileSync(file, JSON.stringify(log, null, 1) + '\n');

  if (args.includes('--pending')) {
    process.stdout.write(digest(pending(log)));
    return;
  }
  const through = option('--integrated-through');
  if (through) {
    log.integratedThrough = through;
    save();
    console.log(JSON.stringify({ integratedThrough: through, pending: pending(log).length }));
    return;
  }

  const paths = postPaths(await get(`${SITE}/sitemap.xml`));
  if (!paths.length) throw new Error('the sitemap lists no post: has its layout changed?');
  const known = new Set(log.entries.map(e => e.path));
  const posts = [];
  const unread = [];
  for (const path of paths.filter(p => !known.has(p))) {
    const post = parsePost(await get(SITE + path), path);
    if (post) posts.push(post); else unread.push(path);
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
  const added = merge(log, posts);
  save();
  console.log(JSON.stringify({ listed: paths.length, added: added.length, pending: pending(log).length,
    latest: log.entries.at(-1)?.published ?? null, unread }));
  // Kept posts are saved; a page that no longer reads is retried next run and fails it.
  if (unread.length) throw new Error(`${unread.length} post(s) no longer read: has the page layout changed?`);
}

module.exports = { postPaths, plainText, parsePost, merge, pending, digest };

if (require.main === module) {
  main().catch(error => {
    console.error(`\n  ${error.message}\n`);
    process.exitCode = 1;
  });
}
