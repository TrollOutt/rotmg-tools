/*
 * Read every tier drop-location list linked from RealmEye's Lists page and
 * attach the resulting enemy -> equipment-tier relations to the community
 * half of the Index. The list pages are the evidence: no tier is inferred
 * from an enemy name, a dungeon rating, or neighbouring equipment.
 *
 *   node tools/fetch-realmeye-tier-drops.js
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const root = path.join(__dirname, '..');
const INDEX = path.join(root, 'data', 'Index', 'index.json');
const WIKI = path.join(root, 'data', 'Index', 'wiki.json');
const SERVED = path.join(root, 'web', 'assets', 'index', 'wiki.json');
const HOST = 'https://www.realmeye.com';
const LISTS = HOST + '/wiki/lists';
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];
const HANDS = ['weapon', 'ability', 'armor', 'ring'];

function get(url, attempt = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'rotmg-tools tier-drop collector' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        return get(new URL(response.headers.location, url).href, attempt).then(resolve, reject);
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode === 200) return resolve(Buffer.concat(chunks).toString('utf8'));
        if (attempt < 2) return setTimeout(() => get(url, attempt + 1).then(resolve, reject), 300 * (attempt + 1));
        reject(new Error('HTTP ' + response.statusCode + ' for ' + url));
      });
    }).on('error', error => {
      if (attempt < 2) return setTimeout(() => get(url, attempt + 1).then(resolve, reject), 300 * (attempt + 1));
      reject(error);
    });
  });
}

const slugOf = href => String(href || '').replace(/^https?:\/\/(?:www\.)?realmeye\.com\/wiki\//, '')
  .replace(/^\/wiki\//, '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
const mainOf = html => {
  const start = html.indexOf('class="wiki-page"');
  const end = html.indexOf('class="col-md-3 wiki-sidebar"', start);
  return start < 0 ? '' : html.slice(start, end < 0 ? html.length : end);
};

function listShape(slug) {
  const hit = /^list-tier-([a-z]+)-(alternate-)?(weapon|ability-item|armor|ring)-drop-locations$/.exec(slug);
  if (!hit) return null;
  const tier = WORDS.indexOf(hit[1]);
  const hand = { weapon: 'weapon', 'ability-item': 'ability', armor: 'armor', ring: 'ring' }[hit[3]];
  return tier < 0 ? null : { tier, hand, alternate: Boolean(hit[2]) };
}

function enemiesOf(html) {
  const main = mainOf(html);
  // Older list templates insert a separate "The enemies are" paragraph;
  // newer ones put the linked enemy paragraph straight after Sort order.
  const block = /Sort order[\s\S]*?<\/p>\s*(?:<p>[^<]*enemies are:\s*<\/p>\s*)?<p>([\s\S]*?)<\/p>/i.exec(main);
  if (!block) return [];
  return [...block[1].matchAll(/href="(\/wiki\/[^"#?]+)(?:#[^"]*)?"/gi)]
    .map(match => slugOf(match[1])).filter((slug, at, all) => slug && all.indexOf(slug) === at);
}

function locationsOf(html) {
  const main = mainOf(html);
  const start = main.search(/<h3\b[^>]*\bid="stats"[^>]*>/i);
  if (start < 0) return [];
  const after = main.slice(start + 4);
  const next = after.search(/<h[23]\b/i);
  const stats = main.slice(start, next < 0 ? main.length : start + 4 + next);
  const row = /Locations?:\s*([\s\S]*?)<\/p>/i.exec(stats);
  if (!row) return [];
  return [...row[1].matchAll(/href="(\/wiki\/[^"#?]+)(?:#[^"]*)?"/gi)]
    .map(match => slugOf(match[1])).filter((slug, at, all) => slug && all.indexOf(slug) === at);
}

async function main() {
  const landing = await get(LISTS);
  const listSlugs = [...mainOf(landing).matchAll(/href="\/wiki\/(list-tier-[^"]+-drop-locations)"/gi)]
    .map(match => match[1]).filter((slug, at, all) => listShape(slug) && all.indexOf(slug) === at);
  if (listSlugs.length !== 46) throw new Error('Expected 46 tier lists, found ' + listSlugs.length);

  const pages = [];
  for (let at = 0; at < listSlugs.length; at += 6) {
    const batch = listSlugs.slice(at, at + 6);
    pages.push(...await Promise.all(batch.map(async slug => ({ slug, html: await get(HOST + '/wiki/' + slug) }))));
    process.stdout.write('\r  tier lists ' + Math.min(at + 6, listSlugs.length) + '/' + listSlugs.length);
  }
  console.log('');

  const wiki = JSON.parse(fs.readFileSync(WIKI, 'utf8'));
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const records = new Map(index.records.map(record => [record.id, record]));
  const pageAt = new Map((wiki.pages || []).map((page, at) => [slugOf(page[0]), at]));
  const enemyPages = new Set((wiki.page || []).filter(([idAt]) => {
    const record = records.get((wiki.ids || [])[idAt]);
    return record && record.kind === 'enemy';
  }).map(([, page]) => page));
  const portalPages = new Set((wiki.page || []).filter(([idAt]) => {
    const record = records.get((wiki.ids || [])[idAt]);
    return record && record.kind === 'portal';
  }).map(([, page]) => page));
  const listAt = new Map();
  const lists = [];
  const numberList = slug => {
    if (!listAt.has(slug)) { listAt.set(slug, lists.length); lists.push(slug); }
    return listAt.get(slug);
  };
  const edges = new Set();
  const missed = new Set();
  const enemySlugs = new Map();
  let mentions = 0;
  const hash = crypto.createHash('sha256').update(landing);
  for (const page of pages) {
    hash.update(page.html);
    const shape = listShape(page.slug);
    const hand = HANDS.indexOf(shape.hand);
    const enemies = enemiesOf(page.html);
    if (!enemies.length) throw new Error('No enemies found on ' + page.slug);
    for (const slug of enemies) {
      mentions++;
      const enemy = pageAt.get(slug);
      if (enemy === undefined || !enemyPages.has(enemy)) { missed.add(slug); continue; }
      enemySlugs.set(enemy, slug);
      edges.add([enemy, hand, shape.tier, shape.alternate ? 1 : 0, numberList(page.slug)].join(','));
    }
  }

  const enemyDocuments = [];
  const enemies = [...enemySlugs].map(([page, slug]) => ({ page, slug }));
  for (let at = 0; at < enemies.length; at += 8) {
    const batch = enemies.slice(at, at + 8);
    enemyDocuments.push(...await Promise.all(batch.map(async enemy => ({
      ...enemy, html: await get(HOST + '/wiki/' + enemy.slug)
    }))));
    process.stdout.write('\r  enemy locations ' + Math.min(at + 8, enemies.length) + '/' + enemies.length);
  }
  console.log('');

  const locationPairs = new Set();
  const dungeonPairs = new Set((wiki.dungeon || []).map(pair => pair[0] + ',' + pair[1]));
  for (const enemy of enemyDocuments) {
    hash.update(enemy.html);
    for (const slug of locationsOf(enemy.html)) {
      const dungeon = pageAt.get(slug);
      if (dungeon === undefined || !portalPages.has(dungeon)) continue;
      const pair = dungeon + ',' + enemy.page;
      locationPairs.add(pair);
      dungeonPairs.add(pair);
    }
  }
  wiki.dungeon = [...dungeonPairs].map(pair => pair.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  wiki.tierDungeon = [...locationPairs].map(pair => pair.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  wiki.tierDungeonFrom = {
    kind: 'community', source: 'RealmEye', built: new Date().toISOString().slice(0, 10),
    method: 'Stats Location fields on every client-joined enemy from the tier lists'
  };

  wiki.tierDropHands = HANDS;
  wiki.tierDropLists = lists;
  wiki.tierDrop = [...edges].map(edge => edge.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  wiki.tierDropFrom = {
    kind: 'community', source: 'RealmEye', at: LISTS,
    built: new Date().toISOString().slice(0, 10), snapshot: hash.digest('hex'),
    method: 'all tier drop-location lists linked from RealmEye Lists'
  };
  fs.writeFileSync(WIKI, JSON.stringify(wiki) + '\n');
  fs.mkdirSync(path.dirname(SERVED), { recursive: true });
  fs.copyFileSync(WIKI, SERVED);

  const dungeonEnemies = new Set((wiki.dungeon || []).map(([, enemy]) => enemy));
  const tierEnemies = new Set(wiki.tierDrop.map(([enemy]) => enemy));
  const linked = [...tierEnemies].filter(enemy => dungeonEnemies.has(enemy));
  console.log('  ' + wiki.tierDrop.length.toLocaleString('en-US') + ' enemy/tier relations from '
    + lists.length + ' lists (' + mentions.toLocaleString('en-US') + ' mentions)');
  console.log('  ' + linked.length.toLocaleString('en-US') + '/' + tierEnemies.size.toLocaleString('en-US')
    + ' tier-dropping enemy pages are already linked to a dungeon');
  console.log('  ' + locationPairs.size.toLocaleString('en-US')
    + ' dungeon/enemy relations confirmed by enemy Stats Location fields');
  console.log('  ' + missed.size.toLocaleString('en-US') + ' enemy pages not joined to a client enemy in the current Index');
  console.log('  -> ' + path.relative(root, WIKI));
}

main().catch(error => { console.error(error); process.exit(1); });
