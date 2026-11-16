#!/usr/bin/env node
'use strict';
/*
 * A person's look at what the sources disagree on, beside the site itself.
 *
 *     npm run review            # then open http://127.0.0.1:5198/review/
 *
 * tools/database/validate_sources.py compares the Index with RealmEye and the
 * client scrape and writes local/validation/report.json. Most of what it finds
 * needs a person: RealmEye can be behind, or the site can be showing the wrong
 * object. This serves a page that puts each finding's RealmEye side on the
 * left and the site's own card on the right. A person answers one question -
 * do they show the same thing? - by the pictures, since the client's values
 * are right by definition. The answer goes to tools/validation-review.json:
 * "ok" quiets the finding; "error" makes the validator fail until the data is
 * fixed, and may name the record the page is really about, which the next
 * build and wiki join then use.
 *
 * It serves the site from this checkout (web/ and data/) so the card on the
 * right is the one the next deploy publishes. Local only: it listens on
 * 127.0.0.1 and refuses a write from any other page.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(__dirname, 'review');
const REPORT = path.join(ROOT, 'local', 'validation', 'report.json');
const VERDICTS = path.join(ROOT, 'tools', 'validation-review.json');
const INDEX = path.join(ROOT, 'data', 'Index', 'index.json');
const SERVED = ['web', 'data'];                 // what the site on the right may load

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip', '.webmanifest': 'application/manifest+json'
};

const VERDICT_ABOUT = 'A person\'s verdict on each finding of `npm run validate`, recorded by `npm run review` (or by hand). '
  + '"ok": the sources disagree but the site is right, keep it quiet. "error": the site is wrong, keep failing until '
  + 'the data is fixed. A verdict holds for the exact message it was given on; when the finding changes it is asked again.';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/* The Index is 13 MB: read once, again only when the file changes. */
let indexCache = { mtime: 0, byId: new Map(), sheet: null };
function indexRecords() {
  const mtime = fs.statSync(INDEX).mtimeMs;
  if (mtime !== indexCache.mtime) {
    const index = readJson(INDEX, { records: [] });
    indexCache = { mtime, byId: new Map(index.records.map(one => [one.id, one])), sheet: index.sheet || null };
  }
  return indexCache;
}

const SUMMARY = ['id', 'kind', 'name', 'said', 'alias', 'hp', 'def', 'art', 'folded', 'tier', 'worn', 'hidden'];
function summaries(ids) {
  const { byId } = indexRecords();
  const out = {};
  for (const id of ids) {
    const one = byId.get(id);
    if (!one) continue;
    out[id] = Object.fromEntries(SUMMARY.filter(key => one[key] !== undefined).map(key => [key, one[key]]));
    if (one.folded && byId.has(one.folded)) out[id].foldedName = byId.get(one.folded).said || byId.get(one.folded).name;
  }
  return out;
}

function state() {
  const report = readJson(REPORT, null);
  const verdicts = readJson(VERDICTS, { verdicts: {} }).verdicts || {};
  if (!report) return { report: null, verdicts, records: {}, sheet: null };
  const ids = new Set();
  for (const one of report.findings) {
    for (const id of [...(one.data?.shown || []), ...(one.data?.candidates || []), ...(one.data?.from || [])]) ids.add(id);
  }
  return { report, verdicts, records: summaries(ids), sheet: indexRecords().sheet };
}

function writeVerdict({ key, verdict, note, pick }) {
  const report = readJson(REPORT, null);
  const finding = report && report.findings.find(one => one.check + '|' + one.key === key);
  if (!finding) throw Object.assign(new Error('no such finding in the current report: ' + key), { status: 404 });
  if (verdict !== null && verdict !== 'ok' && verdict !== 'error') {
    throw Object.assign(new Error('verdict must be "ok", "error" or null'), { status: 400 });
  }
  const offered = [...(finding.data?.shown || []), ...(finding.data?.candidates || [])];
  if (pick !== undefined && pick !== null && (verdict !== 'error' || !offered.includes(pick) || !finding.data?.page)) {
    throw Object.assign(new Error('a pick must be one of the records shown for this page, with "error"'), { status: 400 });
  }
  const doc = readJson(VERDICTS, { about: VERDICT_ABOUT, verdicts: {} });
  doc.about = doc.about || VERDICT_ABOUT;
  doc.verdicts = doc.verdicts || {};
  if (verdict === null) delete doc.verdicts[key];
  else {
    doc.verdicts[key] = {
      verdict, note: String(note || '').slice(0, 500), message: finding.message,
      ...(pick ? { pick, page: finding.data.page } : {}),
      at: new Date().toISOString().slice(0, 10), time: new Date().toISOString()
    };
  }
  doc.verdicts = Object.fromEntries(Object.keys(doc.verdicts).sort().map(k => [k, doc.verdicts[k]]));
  const temp = VERDICTS + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(doc, null, 1) + '\n');
  fs.renameSync(temp, VERDICTS);
  return doc.verdicts;
}

let running = null;
function rerun() {
  if (running) return running;
  running = new Promise((resolve, reject) => {
    const python = process.env.PYTHON || 'python';
    const child = spawn(python, ['tools/database/validate_sources.py', '--no-fail', '--show', '0'], { cwd: ROOT });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(output) : reject(new Error('validation failed:\n' + output))));
  }).finally(() => { running = null; });
  return running;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

/* A file under one of the served folders, never outside the checkout. */
function staticFile(urlPath) {
  let relative;
  try { relative = decodeURIComponent(urlPath).replace(/^\/+/, ''); } catch { return null; }
  if (relative.startsWith('review/')) {
    const file = path.resolve(PAGE, relative.slice('review/'.length) || 'index.html');
    return file.startsWith(PAGE + path.sep) ? file : null;
  }
  if (relative === 'review') return path.join(PAGE, 'index.html');
  const top = relative.split('/')[0];
  if (!SERVED.includes(top) || relative.split('/').some(part => part.startsWith('.'))) return null;
  let file = path.resolve(ROOT, relative);
  if (!file.startsWith(path.join(ROOT, top) + path.sep) && file !== path.join(ROOT, top)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  return file;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 64 * 1024) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      parts.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch {
        reject(Object.assign(new Error('body is not JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function createServer({ port }) {
  const origin = 'http://127.0.0.1:' + port;
  return http.createServer(async (req, res) => {
    try {
      // Another name pointed at this machine is not this page (DNS rebinding).
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(String(req.headers.host || ''))) {
        return send(res, 421, { error: 'open this page at ' + origin + '/review/' });
      }
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/review/api/')) {
        const action = url.pathname.slice('/review/api/'.length);
        if (req.method === 'GET' && action === 'state') return send(res, 200, state());
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
        // Only this page may write: a page elsewhere in the browser must not answer for the user.
        const from = req.headers.origin;
        if ((from && from !== origin && from !== 'http://localhost:' + port)
          || !String(req.headers['content-type'] || '').startsWith('application/json')) {
          return send(res, 403, { error: 'writes are accepted from the review page only' });
        }
        if (action === 'verdict') return send(res, 200, { verdicts: writeVerdict(await readBody(req)) });
        if (action === 'rerun') { await rerun(); return send(res, 200, state()); }
        return send(res, 404, { error: 'unknown action' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      if (url.pathname === '/') { res.writeHead(302, { Location: '/review/' }); return res.end(); }
      const file = staticFile(url.pathname);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file),
        TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch (error) {
      return send(res, error.status || 500, { error: error.message });
    }
  });
}

module.exports = { createServer, staticFile, writeVerdict, state, paths: { REPORT, VERDICTS, INDEX } };

if (require.main === module) {
  const at = process.argv.indexOf('--port');
  const port = at > 0 ? Number(process.argv[at + 1]) : 5198;
  (async () => {
    if (!fs.existsSync(REPORT) || process.argv.includes('--fresh')) {
      console.log('  Running the validation first (npm run validate)...');
      await rerun();
    }
    createServer({ port }).listen(port, '127.0.0.1', () => {
      console.log('\n  Review: http://127.0.0.1:' + port + '/review/');
      console.log('  Verdicts go to tools/validation-review.json. Ctrl+C to stop.\n');
    });
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
