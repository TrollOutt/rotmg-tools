#!/usr/bin/env node
'use strict';
/*
 * Pictures of the pages a pull request changes, before and after.
 *
 *     node tools/pr-shots.js --before <dir> --after <dir> --out <dir>
 *                            [--base <ref>] [--head <ref>] [--pr <n>]
 *
 * <before> and <after> are two checkouts of the site (CI: main, and main with
 * the pull request merged). The pages are chosen from the diff between
 * --base and --head, read in <after> (default HEAD^1 and HEAD, which for a
 * pull request's merge commit are main and the merge): a file of a page's
 * own (web/fame-page.js is Fame Sweep), the page section an edit of
 * web/index.html falls in, a page's class names in a stylesheet. A change
 * that names no page shows the home page; one outside web/ shows nothing.
 *
 * Writes <page>-before.png, <page>-after.png and manifest.json in <out>.
 * Needs playwright-core and Google Chrome (both on GitHub's Ubuntu runners;
 * .github/workflows/pr-preview.yml installs the first).
 *
 * The pictures are posted on the pull request by pr-preview-comment.yml.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PAGES = {
  home: { section: 'pageHome', label: 'Home' },
  enchant: { section: 'pageEnchant', label: 'Enchant Calculator' },
  fame: { section: 'pageFame', label: 'Fame Sweep' },
  news: { section: 'pageNews', label: "What's New" },
  theory: { section: 'pageTheory', label: 'Theory Crafting' },
  index: { section: 'pageIndex', label: 'Index' },
  skins: { section: 'pageSkins', label: 'Skins' },
  pets: { section: 'pagePets', label: 'Pet Fame' }
};
// A file that belongs to one page.
const BY_FILE = [
  [/^web\/fame/, 'fame'], [/^web\/(theory|progression)/, 'theory'], [/^web\/(index-|fiches)/, 'index'],
  [/^web\/whats-new/, 'news'], [/^web\/skin/, 'skins'], [/^web\/pet-fame/, 'pets'],
  [/^web\/(engine|enchant)/, 'enchant'], [/^web\/home-/, 'home']
];
// A page's names in a changed line of a shared file (style.css, app.js...).
const BY_WORD = [
  [/\.fame-|#fame\b|pageFame/, 'fame'], [/\.theory-|#theory\b|pageTheory/, 'theory'],
  [/\.index-|\.fiche|#index\b|pageIndex/, 'index'], [/\.news-|whats-new|#news\b|pageNews/, 'news'],
  [/\.skin|#skins\b|pageSkins/, 'skins'], [/\.pet-|#pets\b|pagePets/, 'pets'],
  [/\.enchant|#enchant\b|pageEnchant/, 'enchant'], [/\.home-|pageHome/, 'home']
];
const MAX_PAGES = 4;
const MAX_HEIGHT = 1400;

const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name);
  return at > 0 ? process.argv[at + 1] : fallback;
};

function changedPages(dir, base, head) {
  const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  const files = git(['diff', '--name-only', base, head]).split('\n').filter(Boolean);
  const pages = new Set();
  for (const file of files) for (const [test, key] of BY_FILE) if (test.test(file)) pages.add(key);

  const shared = files.filter(file => file.startsWith('web/') && !BY_FILE.some(([test]) => test.test(file))
    && /\.(html|css|js)$/.test(file) && file !== 'web/locales.js');
  for (const file of shared) {
    const diff = git(['diff', '--unified=0', base, head, '--', file]);
    if (file === 'web/index.html') {
      // The section each edit falls in: the last page section opened above it.
      const after = git(['show', `${head}:${file}`]).split('\n');
      for (const [, start] of diff.matchAll(/^@@ -\S+ \+(\d+)/gm)) {
        for (let line = Number(start) - 1; line >= 0; line--) {
          const open = after[line] && after[line].match(/id="(page[A-Z]\w*)"/);
          if (!open) continue;
          const key = Object.keys(PAGES).find(name => PAGES[name].section === open[1]);
          if (key) pages.add(key);
          break;
        }
      }
    }
    for (const line of diff.split('\n').filter(text => /^[+-][^+-]/.test(text))) {
      for (const [test, key] of BY_WORD) if (test.test(line)) pages.add(key);
    }
  }
  if (!pages.size && files.some(file => file.startsWith('web/'))) pages.add('home');
  return { files, pages: [...pages].slice(0, MAX_PAGES) };
}

// The checkout as the site serves it, on a free port.
function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
  const server = http.createServer((request, response) => {
    const file = path.join(root, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (!file.startsWith(path.resolve(root))) { response.writeHead(403); response.end(); return; }
    fs.readFile(file, (error, body) => {
      if (error) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      response.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function shoot(browser, server, key, file) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    const hash = key === 'home' ? '' : '#' + key;
    await page.goto(`http://127.0.0.1:${server.address().port}/web/index.html${hash}`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('#' + PAGES[key].section).boundingBox();
    if (!box || box.width < 10 || box.height < 10) return false;
    await page.screenshot({ path: file, fullPage: true,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, MAX_HEIGHT) } });
    return true;
  } catch (error) {
    console.warn(`${key}: ${error.message.split('\n')[0]}`);
    return false;
  } finally {
    await context.close();
  }
}

async function main() {
  const before = path.resolve(option('before') || '');
  const after = path.resolve(option('after') || '');
  const out = path.resolve(option('out') || '');
  if (!option('before') || !option('after') || !option('out')) {
    console.error('node tools/pr-shots.js --before <dir> --after <dir> --out <dir> [--base <ref>] [--head <ref>] [--pr <n>]');
    process.exit(2);
  }
  const { files, pages } = changedPages(after, option('base', 'HEAD^1'), option('head', 'HEAD'));
  fs.mkdirSync(out, { recursive: true });
  const manifest = { pr: Number(option('pr')) || null, files: files.length, pages: [] };

  if (pages.length) {
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({ channel: 'chrome' });
    const servers = { before: await serve(before), after: await serve(after) };
    for (const key of pages) {
      const entry = { page: key };
      for (const side of ['before', 'after']) {
        const name = `${key}-${side}.png`;
        entry[side] = await shoot(browser, servers[side], key, path.join(out, name)) ? name : null;
      }
      manifest.pages.push(entry);
      console.log(`${PAGES[key].label}: before ${entry.before ? 'ok' : 'none'}, after ${entry.after ? 'ok' : 'none'}`);
    }
    await browser.close();
    for (const server of Object.values(servers)) server.close();
  } else {
    console.log('No page of the site changed.');
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

module.exports = { PAGES, changedPages };
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
