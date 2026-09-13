#!/usr/bin/env node
'use strict';

/*
 * RealmEye wiki monitor for rotmg-tools.
 *
 * Goals:
 *   - discover all reachable /wiki/ pages;
 *   - keep a deduplicated archive of raw HTML;
 *   - detect added, removed/moved and content-changed pages;
 *   - distinguish meaningful wiki-content changes from raw HTML noise;
 *   - seed the crawl from the previous snapshot and, when available,
 *     REALM_INDEX_BUNDLE/wiki/search.json;
 *   - run once or continuously.
 *
 * The archive is intentionally local and should not be committed/published.
 *
 * Examples:
 *   node tools/watch-realmeye.js
 *   node tools/watch-realmeye.js --full
 *   node tools/watch-realmeye.js --watch 3600
 *   node tools/watch-realmeye.js --delay 1500 --concurrency 1
 *   REALM_INDEX_BUNDLE=/path/to/bundle node tools/watch-realmeye.js
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

const HOST = 'https://www.realmeye.com';
const DEFAULT_SEEDS = [
  HOST + '/wiki/realm-of-the-mad-god',
  HOST + '/wiki/lists'
];
const USER_AGENT = 'rotmg-tools-realmeye-monitor/1.0 (+https://github.com/TrollOutt/rotmg-tools)';
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const REMOVED_STATUS = new Set([404, 410]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function safeRunId(iso) {
  return iso.replace(/[:.]/g, '-');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, data) {
  ensureDir(path.dirname(file));
  const temp = file + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2);
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function parsePositiveInt(value, name, min = 1) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    out: path.resolve(process.cwd(), 'local', 'realmeye-monitor'),
    delay: 1000,
    concurrency: 1,
    timeout: 25000,
    retries: 3,
    maxPages: 0,
    maxBodyBytes: 25 * 1024 * 1024,
    watchSeconds: 0,
    full: false,
    robots: true,
    sitemap: true,
    seeds: [],
    bundle: process.env.REALM_INDEX_BUNDLE || '',
    verbose: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value after ${arg}`);
      return argv[++i];
    };

    switch (arg) {
      case '--out': options.out = path.resolve(next()); break;
      case '--delay': options.delay = parsePositiveInt(next(), '--delay', 0); break;
      case '--concurrency': options.concurrency = parsePositiveInt(next(), '--concurrency'); break;
      case '--timeout': options.timeout = parsePositiveInt(next(), '--timeout'); break;
      case '--retries': options.retries = parsePositiveInt(next(), '--retries', 0); break;
      case '--max-pages': options.maxPages = parsePositiveInt(next(), '--max-pages'); break;
      case '--max-body-mb': options.maxBodyBytes = parsePositiveInt(next(), '--max-body-mb') * 1024 * 1024; break;
      case '--watch': options.watchSeconds = parsePositiveInt(next(), '--watch'); break;
      case '--seed': options.seeds.push(next()); break;
      case '--bundle': options.bundle = path.resolve(next()); break;
      case '--full': options.full = true; break;
      case '--no-robots': options.robots = false; break;
      case '--no-sitemap': options.sitemap = false; break;
      case '--verbose': options.verbose = true; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`RealmEye wiki monitor\n\n` +
`Usage:\n` +
`  node tools/watch-realmeye.js [options]\n\n` +
`Options:\n` +
`  --out DIR            Archive directory (default: local/realmeye-monitor)\n` +
`  --delay MS           Minimum delay between HTTP request starts (default: 1000)\n` +
`  --concurrency N      Requests processed per batch (default: 1)\n` +
`  --timeout MS         Per-request timeout (default: 25000)\n` +
`  --retries N          Retries for network/429/5xx failures (default: 3)\n` +
`  --max-pages N        Safety cap; 0 means unlimited\n` +
`  --max-body-mb N      Maximum single response size (default: 25)\n` +
`  --watch SECONDS      Repeat forever after each completed run\n` +
`  --full               Disable conditional GET and download every page body\n` +
`  --seed URL           Add a crawl seed (repeatable)\n` +
`  --bundle DIR         Existing RealmEye bundle used as an additional seed source\n` +
`  --no-sitemap         Do not probe sitemap.xml / robots Sitemap entries\n` +
`  --no-robots          Do not enforce robots.txt (use only if you have permission)\n` +
`  --verbose            Print each fetched URL\n` +
`  -h, --help           Show this help\n`);
}

function canonicalWikiUrl(input) {
  let url;
  try {
    url = new URL(input, HOST);
  } catch (_) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'www.realmeye.com' && host !== 'realmeye.com') return null;
  if (!url.pathname.startsWith('/wiki/')) return null;

  url.protocol = 'https:';
  url.hostname = 'www.realmeye.com';
  url.port = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  if (url.pathname === '/wiki') return null;
  return url.href;
}

function absoluteRealmEyeUrl(input) {
  let url;
  try { url = new URL(input, HOST); } catch (_) { return null; }
  const host = url.hostname.toLowerCase();
  if (host !== 'www.realmeye.com' && host !== 'realmeye.com') return null;
  url.protocol = 'https:';
  url.hostname = 'www.realmeye.com';
  url.port = '';
  url.hash = '';
  return url.href;
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function extractTitle(html, mainHtml) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(mainHtml || '');
  if (h1) return textFromHtml(h1[1]).trim();
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  return title ? textFromHtml(title[1]).replace(/\s+[|\-–—]\s+RealmEye.*$/i, '').trim() : '';
}

function extractWikiMain(html) {
  const source = String(html || '');
  const marker = /class\s*=\s*["'][^"']*\bwiki-page\b[^"']*["']/i.exec(source);
  if (!marker) return source;

  let start = source.lastIndexOf('<', marker.index);
  if (start < 0) start = marker.index;

  const tail = source.slice(start);
  const sidebar = /class\s*=\s*["'][^"']*\bwiki-sidebar\b[^"']*["']/i.exec(tail);
  if (!sidebar) return tail;

  let end = tail.lastIndexOf('<', sidebar.index);
  if (end < 0) end = sidebar.index;
  return tail.slice(0, end);
}

function stripVolatileMarkup(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '')
    .replace(/\snonce\s*=\s*(["']).*?\1/gi, '')
    .replace(/\sdata-csrf(?:token)?\s*=\s*(["']).*?\1/gi, '')
    .replace(/<input\b[^>]*(?:csrf|token)[^>]*>/gi, '');
}

function normalizeWikiContent(mainHtml) {
  return stripVolatileMarkup(mainHtml)
    .replace(/\r\n?/g, '\n')
    .replace(/>\s+</g, '><')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function textFromHtml(html) {
  return decodeHtmlEntities(
    stripVolatileMarkup(html)
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h1|h2|h3|h4|h5|h6|table|section|article)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLinks(html) {
  const links = new Set();
  const re = /\bhref\s*=\s*(["'])(.*?)\1/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const href = decodeHtmlEntities(match[2]);
    const url = canonicalWikiUrl(href);
    if (url) links.add(url);
  }
  return [...links];
}

function extractCanonical(html) {
  const relFirst = /<link\b[^>]*\brel\s*=\s*(["'])canonical\1[^>]*\bhref\s*=\s*(["'])(.*?)\2[^>]*>/i.exec(html);
  if (relFirst) return canonicalWikiUrl(decodeHtmlEntities(relFirst[3]));

  const hrefFirst = /<link\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*\brel\s*=\s*(["'])canonical\3[^>]*>/i.exec(html);
  return hrefFirst ? canonicalWikiUrl(decodeHtmlEntities(hrefFirst[2])) : null;
}

function looksGone(html, title, text) {
  const sample = `${title || ''}\n${text || ''}`.slice(0, 8000);
  return /\b(?:page not found|this page (?:does not exist|has been deleted)|no such page|article not found)\b/i.test(sample);
}

function firstDifference(before, after, radius = 260) {
  before = String(before || '');
  after = String(after || '');
  if (before === after) return null;

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) suffix++;

  const beforeStart = Math.max(0, prefix - radius);
  const afterStart = Math.max(0, prefix - radius);
  const beforeEnd = Math.min(before.length, before.length - suffix + radius);
  const afterEnd = Math.min(after.length, after.length - suffix + radius);

  return {
    offset: prefix,
    before: before.slice(beforeStart, beforeEnd),
    after: after.slice(afterStart, afterEnd)
  };
}

function objectFile(outDir, hash) {
  return path.join(outDir, 'objects', hash.slice(0, 2), hash + '.html.gz');
}

function storeHtmlObject(outDir, html) {
  const body = Buffer.from(html, 'utf8');
  const hash = sha256(body);
  const file = objectFile(outDir, hash);
  if (!fs.existsSync(file)) {
    ensureDir(path.dirname(file));
    atomicWrite(file, zlib.gzipSync(body, { level: 9 }));
  }
  return hash;
}

function readHtmlObject(outDir, hash) {
  if (!hash) return null;
  try {
    return zlib.gunzipSync(fs.readFileSync(objectFile(outDir, hash))).toString('utf8');
  } catch (_) {
    return null;
  }
}

class RateLimiter {
  constructor(delay) {
    this.delay = Math.max(0, delay);
    this.nextAt = 0;
    this.chain = Promise.resolve();
  }

  async wait() {
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const previous = this.chain;
    this.chain = current;
    await previous;

    try {
      const now = Date.now();
      const wait = Math.max(0, this.nextAt - now);
      if (wait) await sleep(wait);
      this.nextAt = Date.now() + this.delay;
    } finally {
      release();
    }
  }
}

function headerValue(headers, name) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(', ') : (value || '');
}

function parseRetryAfter(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function requestOnce(url, requestHeaders, options, limiter) {
  await limiter.wait();
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        ...requestHeaders
      }
    }, response => {
      const chunks = [];
      let size = 0;
      let finished = false;

      const fail = error => {
        if (finished) return;
        finished = true;
        response.destroy();
        reject(error);
      };

      response.on('data', chunk => {
        size += chunk.length;
        if (size > options.maxBodyBytes) {
          return fail(new Error(`Response exceeded ${options.maxBodyBytes} bytes: ${url}`));
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (finished) return;
        finished = true;
        resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks)
        });
      });
      response.on('error', fail);
    });

    req.setTimeout(options.timeout, () => req.destroy(new Error(`Timeout after ${options.timeout}ms: ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

async function fetchWithRedirects(url, requestHeaders, options, limiter) {
  let current = url;
  const redirects = [];

  for (let hop = 0; hop < 8; hop++) {
    const response = await requestOnce(current, requestHeaders, options, limiter);
    if (!REDIRECT_STATUS.has(response.status)) {
      return { ...response, finalUrl: current, redirects };
    }

    const location = headerValue(response.headers, 'location');
    if (!location) return { ...response, finalUrl: current, redirects };
    const next = absoluteRealmEyeUrl(new URL(location, current).href);
    redirects.push({ status: response.status, from: current, to: next || new URL(location, current).href });
    if (!next) return { ...response, finalUrl: current, redirects };
    current = next;
  }

  throw new Error(`Too many redirects: ${url}`);
}

async function fetchWithRetry(url, requestHeaders, options, limiter) {
  let lastError = null;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      const response = await fetchWithRedirects(url, requestHeaders, options, limiter);
      if (!RETRYABLE.has(response.status) || attempt >= options.retries) return response;

      const retryAfter = parseRetryAfter(headerValue(response.headers, 'retry-after'));
      const backoff = retryAfter || Math.min(30000, 750 * (2 ** attempt) + Math.floor(Math.random() * 250));
      await sleep(backoff);
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) throw error;
      await sleep(Math.min(30000, 750 * (2 ** attempt) + Math.floor(Math.random() * 250)));
    }
  }
  throw lastError || new Error(`Unable to fetch ${url}`);
}

function wildcardPatternToRegExp(pattern) {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '$') source += '$';
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + source);
}

function parseRobots(text, agentToken) {
  const groups = [];
  let current = null;
  let sawRule = false;
  const sitemaps = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();

    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }

    if (key === 'user-agent') {
      if (!current || sawRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if ((key === 'allow' || key === 'disallow') && current) {
      sawRule = true;
      if (value || key === 'allow') current.rules.push({ type: key, pattern: value });
    }
  }

  const token = agentToken.toLowerCase();
  const exact = groups.filter(group => group.agents.some(agent => agent !== '*' && token.includes(agent)));
  const selected = exact.length ? exact : groups.filter(group => group.agents.includes('*'));
  const rules = selected.flatMap(group => group.rules);

  function allowed(url) {
    const parsed = new URL(url);
    const target = parsed.pathname + parsed.search;
    let winner = null;
    for (const rule of rules) {
      if (!rule.pattern) continue;
      let matches = false;
      try { matches = wildcardPatternToRegExp(rule.pattern).test(target); } catch (_) { matches = target.startsWith(rule.pattern); }
      if (!matches) continue;
      const length = rule.pattern.replace(/[\*$]/g, '').length;
      if (!winner || length > winner.length || (length === winner.length && rule.type === 'allow')) {
        winner = { ...rule, length };
      }
    }
    return !winner || winner.type === 'allow';
  }

  return { allowed, sitemaps };
}

async function loadRobots(options, limiter) {
  if (!options.robots && !options.sitemap) return { allowed: () => true, sitemaps: [] };
  const url = HOST + '/robots.txt';
  try {
    const response = await fetchWithRetry(url, {}, options, limiter);
    if (response.status === 404) return { allowed: () => true, sitemaps: [] };
    if (response.status !== 200) {
      console.warn(`  robots.txt: HTTP ${response.status}; continuing without parsed rules`);
      return { allowed: () => true, sitemaps: [] };
    }
    return parseRobots(response.body.toString('utf8'), 'rotmg-tools-realmeye-monitor');
  } catch (error) {
    console.warn(`  robots.txt: ${error.message}; continuing without parsed rules`);
    return { allowed: () => true, sitemaps: [] };
  }
}

function extractSitemapLocs(xml) {
  const urls = [];
  for (const match of String(xml || '').matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeHtmlEntities(match[1]).trim();
    if (value) urls.push(value);
  }
  return urls;
}

async function discoverSitemapSeeds(robots, options, limiter) {
  if (!options.sitemap) return [];

  const sitemapUrls = new Set([HOST + '/sitemap.xml']);
  for (const one of robots.sitemaps || []) {
    const url = absoluteRealmEyeUrl(one);
    if (url) sitemapUrls.add(url);
  }

  const wiki = new Set();
  const visitedMaps = new Set();
  const queue = [...sitemapUrls];

  while (queue.length && visitedMaps.size < 20) {
    const mapUrl = queue.shift();
    if (visitedMaps.has(mapUrl)) continue;
    visitedMaps.add(mapUrl);
    try {
      const response = await fetchWithRetry(mapUrl, {}, options, limiter);
      if (response.status !== 200) continue;
      const text = response.body.toString('utf8');
      for (const loc of extractSitemapLocs(text)) {
        const page = canonicalWikiUrl(loc);
        if (page) {
          wiki.add(page);
          continue;
        }
        const nested = absoluteRealmEyeUrl(loc);
        if (nested && /\.xml(?:$|\?)/i.test(nested) && !visitedMaps.has(nested)) queue.push(nested);
      }
    } catch (_) {
      // Sitemap is an optional discovery aid, not a run blocker.
    }
  }

  return [...wiki];
}

function seedFromBundle(bundleDir) {
  if (!bundleDir) return [];
  const searchFile = path.join(bundleDir, 'wiki', 'search.json');
  if (!fs.existsSync(searchFile)) return [];

  const rows = readJson(searchFile, []);
  if (!Array.isArray(rows)) return [];
  const seeds = new Set();

  for (const row of rows) {
    const direct = canonicalWikiUrl(row && (row.canonicalUrl || row.url || row.href));
    if (direct) seeds.add(direct);

    if (!row || !row.file) continue;
    const file = path.join(bundleDir, row.file);
    const raw = readJson(file, null);
    if (!raw) continue;
    const url = canonicalWikiUrl(raw.canonicalUrl || raw.url || '');
    if (url) seeds.add(url);
  }

  return [...seeds];
}

function indexPrevious(previous) {
  const map = new Map();
  if (!previous || !Array.isArray(previous.pages)) return map;
  for (const page of previous.pages) if (page && page.url) map.set(page.url, page);
  return map;
}

function pageState(record) {
  if (!record) return 'missing';
  if (record.error) return 'error';
  if (record.robotsDenied) return 'robots';
  if (record.goneHint || REMOVED_STATUS.has(record.status)) return 'gone';
  if (record.status >= 200 && record.status < 300) return 'ok';
  return 'http-' + record.status;
}

function summarizeChange(change, limit = 120) {
  const title = change.title || change.url;
  return title.length > limit ? title.slice(0, limit - 1) + '…' : title;
}

function makeReport(previous, snapshot, outDir) {
  const before = indexPrevious(previous);
  const after = indexPrevious(snapshot);
  const added = [];
  const removed = [];
  const moved = [];
  const changed = [];
  const htmlOnly = [];
  const statusChanged = [];
  const errors = [];

  for (const [url, current] of after) {
    const old = before.get(url);
    const currentState = pageState(current);

    if (currentState === 'error' || currentState === 'robots' || current.status >= 500 || current.status === 429) {
      errors.push({ url, title: current.title || (old && old.title) || '', state: currentState, error: current.error || null, status: current.status || null });
      continue;
    }

    if (!old) {
      if (previous && currentState === 'ok' && (!current.redirects || current.redirects.length === 0)) {
        added.push({ url, title: current.title || '', contentHash: current.contentHash });
      }
      continue;
    }

    const oldState = pageState(old);
    if (current.finalUrl && old.finalUrl && current.finalUrl !== old.finalUrl) {
      moved.push({ url, title: current.title || old.title || '', from: old.finalUrl, to: current.finalUrl });
    } else if (current.redirects && current.redirects.length && current.finalUrl && current.finalUrl !== url && old.finalUrl !== current.finalUrl) {
      moved.push({ url, title: current.title || old.title || '', from: url, to: current.finalUrl });
    }

    if (oldState === 'ok' && currentState === 'gone') {
      removed.push({ url, title: old.title || current.title || '', status: current.status, goneHint: Boolean(current.goneHint) });
      continue;
    }

    if (oldState !== currentState) {
      statusChanged.push({ url, title: current.title || old.title || '', before: oldState, after: currentState, status: current.status });
    }

    if (oldState === 'ok' && currentState === 'ok') {
      if (old.contentHash && current.contentHash && old.contentHash !== current.contentHash) {
        const beforeHtml = readHtmlObject(outDir, old.rawHash);
        const afterHtml = readHtmlObject(outDir, current.rawHash);
        const beforeText = beforeHtml == null ? '' : textFromHtml(extractWikiMain(beforeHtml));
        const afterText = afterHtml == null ? '' : textFromHtml(extractWikiMain(afterHtml));
        changed.push({
          url,
          title: current.title || old.title || '',
          beforeContentHash: old.contentHash,
          afterContentHash: current.contentHash,
          beforeRawHash: old.rawHash,
          afterRawHash: current.rawHash,
          difference: firstDifference(beforeText, afterText)
        });
      } else if (old.rawHash && current.rawHash && old.rawHash !== current.rawHash) {
        htmlOnly.push({
          url,
          title: current.title || old.title || '',
          beforeRawHash: old.rawHash,
          afterRawHash: current.rawHash
        });
      }
    }
  }

  const previousOk = [...before.values()].filter(page => pageState(page) === 'ok').length;
  const currentOk = [...after.values()].filter(page => pageState(page) === 'ok').length;
  const suspiciousDrop = previousOk > 0 && currentOk < previousOk * 0.8;

  return {
    schema: 1,
    generatedAt: snapshot.generatedAt,
    previousGeneratedAt: previous ? previous.generatedAt : null,
    baseline: !previous,
    complete: snapshot.complete,
    suspiciousDrop,
    counts: {
      previousPages: before.size,
      currentPages: after.size,
      previousOk,
      currentOk,
      added: added.length,
      removed: removed.length,
      moved: moved.length,
      changed: changed.length,
      htmlOnly: htmlOnly.length,
      statusChanged: statusChanged.length,
      errors: errors.length
    },
    added,
    removed,
    moved,
    changed,
    htmlOnly,
    statusChanged,
    errors
  };
}

function reportMarkdown(report) {
  const lines = [];
  lines.push(`# RealmEye monitor — ${report.generatedAt}`);
  lines.push('');
  if (report.baseline) {
    lines.push('Baseline initiale créée. Aucun changement comparatif à signaler.');
    lines.push('');
  }
  lines.push(`- Pages OK: ${report.counts.currentOk}`);
  lines.push(`- Ajoutées: ${report.counts.added}`);
  lines.push(`- Supprimées / disparues: ${report.counts.removed}`);
  lines.push(`- Déplacées / redirigées: ${report.counts.moved}`);
  lines.push(`- Contenu wiki modifié: ${report.counts.changed}`);
  lines.push(`- HTML brut modifié seulement: ${report.counts.htmlOnly}`);
  lines.push(`- Erreurs / blocages: ${report.counts.errors}`);
  lines.push(`- Crawl complet: ${report.complete ? 'oui' : 'non'}`);
  if (report.suspiciousDrop) lines.push('- ATTENTION: chute anormale du nombre de pages accessibles; vérifier le site/réseau avant de conclure à des suppressions massives.');

  const section = (title, items, format) => {
    if (!items.length) return;
    lines.push('', `## ${title} (${items.length})`, '');
    for (const item of items) lines.push('- ' + format(item));
  };

  section('Pages ajoutées', report.added, item => `[${summarizeChange(item)}](${item.url})`);
  section('Pages supprimées / disparues', report.removed, item => `[${summarizeChange(item)}](${item.url})`);
  section('Pages déplacées / redirigées', report.moved, item => `[${summarizeChange(item)}](${item.url}) → ${item.to}`);
  section('Contenu wiki modifié', report.changed, item => {
    const diff = item.difference;
    if (!diff) return `[${summarizeChange(item)}](${item.url})`;
    const before = diff.before.replace(/\s+/g, ' ').trim().slice(-180);
    const after = diff.after.replace(/\s+/g, ' ').trim().slice(-180);
    return `[${summarizeChange(item)}](${item.url})\n  - avant: ${before}\n  - après: ${after}`;
  });
  section('HTML brut modifié seulement', report.htmlOnly, item => `[${summarizeChange(item)}](${item.url})`);
  section('Erreurs / blocages', report.errors, item => `${item.url} — ${item.error || item.state || item.status || 'erreur'}`);

  lines.push('');
  return lines.join('\n');
}

async function crawlOnce(options) {
  ensureDir(options.out);
  ensureDir(path.join(options.out, 'objects'));
  ensureDir(path.join(options.out, 'snapshots'));
  ensureDir(path.join(options.out, 'reports'));

  const startedAt = nowIso();
  const runId = safeRunId(startedAt);
  const latestFile = path.join(options.out, 'latest.json');
  const previous = readJson(latestFile, null);
  const previousByUrl = indexPrevious(previous);
  const limiter = new RateLimiter(options.delay);

  console.log(`\nRealmEye monitor — ${startedAt}`);
  console.log(`  archive: ${options.out}`);
  console.log(`  previous: ${previous ? `${previous.pages.length} pages @ ${previous.generatedAt}` : 'none (baseline)'}`);

  const robots = await loadRobots(options, limiter);
  if (options.robots && !robots.allowed(DEFAULT_SEEDS[0])) {
    throw new Error(`robots.txt disallows ${new URL(DEFAULT_SEEDS[0]).pathname} for this crawler`);
  }

  const seeds = new Set();
  const seedSources = new Map();
  function addSeed(url, source) {
    const canonical = canonicalWikiUrl(url);
    if (!canonical) return;
    if (!seeds.has(canonical)) seedSources.set(canonical, source);
    seeds.add(canonical);
  }

  for (const seed of DEFAULT_SEEDS) addSeed(seed, 'default');
  for (const seed of options.seeds) addSeed(seed, 'cli');
  for (const page of previousByUrl.values()) addSeed(page.url, 'previous');

  const bundleSeeds = seedFromBundle(options.bundle);
  for (const seed of bundleSeeds) addSeed(seed, 'bundle');

  const sitemapSeeds = await discoverSitemapSeeds(robots, options, limiter);
  for (const seed of sitemapSeeds) addSeed(seed, 'sitemap');

  console.log(`  seeds: ${seeds.size} (${bundleSeeds.length} bundle, ${sitemapSeeds.length} sitemap)`);

  const queue = [];
  const queued = new Set();
  const records = new Map();
  let discovered = 0;
  let maxPagesReached = false;

  function enqueue(url, source, discoveredFrom = null) {
    const canonical = canonicalWikiUrl(url);
    if (!canonical || queued.has(canonical)) return false;
    if (options.maxPages && queued.size >= options.maxPages) {
      maxPagesReached = true;
      return false;
    }
    queued.add(canonical);
    queue.push({ url: canonical, source, discoveredFrom });
    return true;
  }

  for (const seed of seeds) enqueue(seed, seedSources.get(seed) || 'seed');

  async function processOne(job) {
    const old = previousByUrl.get(job.url);
    if (options.robots && !robots.allowed(job.url)) {
      records.set(job.url, {
        url: job.url,
        finalUrl: job.url,
        status: 0,
        robotsDenied: true,
        source: job.source,
        discoveredFrom: job.discoveredFrom,
        fetchedAt: nowIso()
      });
      return;
    }

    const headers = {};
    if (!options.full && old) {
      if (old.etag) headers['If-None-Match'] = old.etag;
      if (old.lastModified) headers['If-Modified-Since'] = old.lastModified;
    }

    if (options.verbose) console.log(`  GET ${job.url}`);
    try {
      let response = await fetchWithRetry(job.url, headers, options, limiter);
      if (response.status === 304 && old && old.rawHash && readHtmlObject(options.out, old.rawHash) == null) {
        // The manifest survived but its content object did not. A 304 has no
        // body, so retry unconditionally instead of manufacturing an empty page.
        response = await fetchWithRetry(job.url, {}, options, limiter);
      }
      const finalWiki = canonicalWikiUrl(response.finalUrl);
      if (finalWiki && finalWiki !== job.url) enqueue(finalWiki, 'redirect', job.url);

      if (response.status === 304 && old && old.rawHash) {
        const oldHtml = readHtmlObject(options.out, old.rawHash);
        if (oldHtml != null) {
          for (const link of extractLinks(oldHtml)) {
            if (enqueue(link, 'link', job.url)) discovered++;
          }
          records.set(job.url, {
            ...old,
            source: job.source,
            discoveredFrom: job.discoveredFrom || old.discoveredFrom || null,
            transportStatus: 304,
            fetchedAt: nowIso(),
            etag: headerValue(response.headers, 'etag') || old.etag || '',
            lastModified: headerValue(response.headers, 'last-modified') || old.lastModified || ''
          });
          return;
        }
      }

      const body = response.body.toString('utf8');
      const contentType = headerValue(response.headers, 'content-type');
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType) || /^\s*</.test(body);
      const rawHash = body ? storeHtmlObject(options.out, body) : '';
      const mainHtml = isHtml ? extractWikiMain(body) : body;
      const normalized = isHtml ? normalizeWikiContent(mainHtml) : body.trim();
      const text = isHtml ? textFromHtml(mainHtml) : body.trim();
      const title = isHtml ? extractTitle(body, mainHtml) : '';
      const canonical = isHtml ? extractCanonical(body) : null;
      const goneHint = isHtml ? looksGone(body, title, text) : false;

      const record = {
        url: job.url,
        finalUrl: finalWiki || response.finalUrl,
        canonicalUrl: canonical,
        redirects: response.redirects,
        status: response.status,
        transportStatus: response.status,
        source: job.source,
        discoveredFrom: job.discoveredFrom,
        fetchedAt: nowIso(),
        contentType,
        etag: headerValue(response.headers, 'etag'),
        lastModified: headerValue(response.headers, 'last-modified'),
        contentLength: Buffer.byteLength(body),
        title,
        rawHash,
        contentHash: sha256(normalized),
        textHash: sha256(text),
        goneHint
      };
      records.set(job.url, record);

      if (isHtml && response.status >= 200 && response.status < 300 && !goneHint) {
        for (const link of extractLinks(body)) {
          if (enqueue(link, 'link', job.url)) discovered++;
        }
        if (canonical) enqueue(canonical, 'canonical', job.url);
      }
    } catch (error) {
      records.set(job.url, {
        url: job.url,
        finalUrl: job.url,
        status: 0,
        source: job.source,
        discoveredFrom: job.discoveredFrom,
        fetchedAt: nowIso(),
        error: error.message
      });
    }
  }

  let cursor = 0;
  while (cursor < queue.length) {
    const batch = queue.slice(cursor, cursor + options.concurrency);
    cursor += batch.length;
    await Promise.all(batch.map(processOne));

    const ok = [...records.values()].filter(record => pageState(record) === 'ok').length;
    const errors = [...records.values()].filter(record => pageState(record) === 'error').length;
    process.stdout.write(`\r  pages ${records.size}/${queue.length} | ok ${ok} | discovered ${discovered} | errors ${errors}`);
  }
  process.stdout.write('\n');

  const pages = [...records.values()].sort((a, b) => a.url.localeCompare(b.url));
  const complete = !maxPagesReached && pages.length === queue.length;
  const snapshot = {
    schema: 1,
    generatedAt: startedAt,
    completedAt: nowIso(),
    host: HOST,
    userAgent: USER_AGENT,
    complete,
    options: {
      delay: options.delay,
      concurrency: options.concurrency,
      full: options.full,
      robots: options.robots,
      sitemap: options.sitemap,
      maxPages: options.maxPages || null
    },
    discovery: {
      initialSeeds: seeds.size,
      bundleSeeds: bundleSeeds.length,
      sitemapSeeds: sitemapSeeds.length,
      discoveredLinks: discovered,
      maxPagesReached
    },
    pages
  };

  const report = makeReport(previous, snapshot, options.out);
  const snapshotFile = path.join(options.out, 'snapshots', runId + '.json');
  const reportJson = path.join(options.out, 'reports', runId + '.json');
  const reportMd = path.join(options.out, 'reports', runId + '.md');

  atomicWrite(snapshotFile, JSON.stringify(snapshot, null, 2) + '\n');
  atomicWrite(reportJson, JSON.stringify(report, null, 2) + '\n');
  atomicWrite(reportMd, reportMarkdown(report));
  atomicWrite(latestFile, JSON.stringify(snapshot, null, 2) + '\n');
  atomicWrite(path.join(options.out, 'latest-report.json'), JSON.stringify(report, null, 2) + '\n');
  atomicWrite(path.join(options.out, 'latest-report.md'), reportMarkdown(report));

  console.log(`  report: ${path.relative(process.cwd(), reportMd)}`);
  console.log(`  +${report.counts.added} added | -${report.counts.removed} removed | ${report.counts.changed} content changed | ${report.counts.htmlOnly} raw-only | ${report.counts.errors} errors`);
  if (!complete) console.warn('  WARNING: crawl incomplete; do not treat missing coverage as deletion.');
  if (report.suspiciousDrop) console.warn('  WARNING: suspicious accessibility drop; inspect network/site state before accepting mass removals.');

  return { snapshot, report };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(options.out);

  do {
    try {
      await crawlOnce(options);
    } catch (error) {
      console.error('\nRealmEye monitor failed:', error && error.stack ? error.stack : error);
      if (!options.watchSeconds) process.exitCode = 1;
    }

    if (!options.watchSeconds) break;
    const next = new Date(Date.now() + options.watchSeconds * 1000).toISOString();
    console.log(`  next run: ${next}`);
    await sleep(options.watchSeconds * 1000);
  } while (true);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = {
  canonicalWikiUrl,
  extractWikiMain,
  normalizeWikiContent,
  textFromHtml,
  extractLinks,
  extractCanonical,
  looksGone,
  firstDifference,
  parseRobots,
  storeHtmlObject,
  readHtmlObject,
  makeReport,
  reportMarkdown,
  pageState
};
