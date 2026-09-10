/*
 * Link enemies to the dungeons whose RealmEye pages list them.
 *
 * The installed client says what an enemy is, but dungeon populations are
 * mostly server/map data and are not declared by the object catalogue. The
 * local RealmEye export preserves explicit page sections such as Enemies,
 * Boss, Minions and Treasure Room Boss. This tool keeps only those sections,
 * only on pages already joined to a client portal, and only members already
 * joined to client enemy records. No free-text or fuzzy-name guess becomes a
 * relation.
 *
 *   REALMEYE_EXPORT=<folder containing pages.jsonl and collections.jsonl>
 *     node tools/link-index-dungeons.js
 *
 * Without a local export the committed relations are kept unchanged.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const INDEX = path.join(root, 'data', 'Index', 'index.json');
const WIKI = path.join(root, 'data', 'Index', 'wiki.json');
const SERVED = path.join(root, 'web', 'assets', 'index', 'wiki.json');
const candidates = [
  process.env.REALMEYE_EXPORT,
  path.join(root, 'local', 'realmeye-export'),
  path.join(root, '..', 'exports', 'latest')
].filter(Boolean);
const source = candidates.find(folder => fs.existsSync(path.join(folder, 'pages.jsonl'))
  && fs.existsSync(path.join(folder, 'collections.jsonl')));

if (!source) {
  console.log('\n  No local RealmEye export found (set REALMEYE_EXPORT).');
  console.log('  Keeping the dungeon links already in data/Index/wiki.json.\n');
  process.exit(0);
}

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const wiki = JSON.parse(fs.readFileSync(WIKI, 'utf8'));
const records = new Map(index.records.map(one => [one.id, one]));
const slugOf = value => String(value || '').replace(/^https?:\/\/(?:www\.)?realmeye\.com\/wiki\//, '')
  .replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
const wikiPageAt = new Map((wiki.pages || []).map((one, at) => [slugOf(one[0]), at]));

/* Which wiki pages already have an exact, client-backed portal/enemy join. */
const pageKinds = new Map();
for (const [idAt, pageAt] of wiki.page || []) {
  const id = (wiki.ids || [])[idAt];
  const record = records.get(id);
  if (!record) continue;
  if (!pageKinds.has(pageAt)) pageKinds.set(pageAt, new Set());
  pageKinds.get(pageAt).add(record.kind);
}
const portalPages = new Set([...pageKinds].filter(([, kinds]) => kinds.has('portal')).map(([at]) => at));
const enemyPages = new Set([...pageKinds].filter(([, kinds]) => kinds.has('enemy')).map(([at]) => at));

const rowsOf = file => fs.readFileSync(file, 'utf8').split(/\r?\n/)
  .filter(Boolean).map(line => JSON.parse(line));
const pagesFile = path.join(source, 'pages.jsonl');
const collectionsFile = path.join(source, 'collections.jsonl');
const localPages = new Map();
for (const page of rowsOf(pagesFile)) {
  const at = wikiPageAt.get(slugOf(page.canonical_url || page.url));
  if (at !== undefined && !page.gone_at) localPages.set(page.id, at);
}

/*
 * Section names are evidence, not decoration. Exclude prose/history/loot
 * sections even when they happen to mention a creature, and accept explicit
 * population words across the wiki's many house styles.
 */
const POPULATION = /\b(?:enemies?|boss(?:es)?|mini[ -]?boss(?:es)?|minions?|monsters?|guardians?|hazards?|servants?|followers?|cavecrawlers?|mercenaries?|archdemons?|demons?|fairies|bats|slimes|traps|turrets|villagers|golems|crusaders|infantry|mages|trio)\b/i;
const NOT_POPULATION = /\b(?:historical|history|trivia|drops?|loot|daily|quests?|tips?|strateg(?:y|ies)|key|contents|mechanics?|guide|solution|layout|event only)\b/i;
const populationSection = name => POPULATION.test(name) && !NOT_POPULATION.test(name);

const pairs = new Set();
const evidence = new Set();
const sections = [];
const sectionAt = new Map();
const numberSection = name => {
  if (!sectionAt.has(name)) { sectionAt.set(name, sections.length); sections.push(name); }
  return sectionAt.get(name);
};
let examined = 0;
for (const row of rowsOf(collectionsFile)) {
  if (!populationSection(row.name || '')) continue;
  const dungeon = localPages.get(row.owner_page_id);
  const enemy = localPages.get(row.member_page_id);
  if (dungeon === undefined || enemy === undefined
    || !portalPages.has(dungeon) || !enemyPages.has(enemy)) continue;
  examined++;
  pairs.add(dungeon + ',' + enemy);
  evidence.add(dungeon + ',' + enemy + ',' + numberSection(row.name));
}

const numeric = value => [...value].map(one => one.split(',').map(Number))
  .sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] || 0) - (b[2] || 0));
wiki.dungeon = numeric(pairs);
wiki.dungeonSections = sections;
wiki.dungeonEvidence = numeric(evidence);
const hash = crypto.createHash('sha256');
hash.update(fs.readFileSync(pagesFile));
hash.update(fs.readFileSync(collectionsFile));
wiki.dungeonFrom = {
  kind: 'community', source: 'RealmEye', built: new Date().toISOString().slice(0, 10),
  snapshot: hash.digest('hex'),
  method: 'explicit population sections on pages joined to client portals'
};

fs.writeFileSync(WIKI, JSON.stringify(wiki) + '\n');
fs.mkdirSync(path.dirname(SERVED), { recursive: true });
fs.copyFileSync(WIKI, SERVED);

const linkedEnemies = new Set(wiki.dungeon.map(([, enemy]) => enemy));
const linkedDungeons = new Set(wiki.dungeon.map(([dungeon]) => dungeon));
console.log('\n  ' + wiki.dungeon.length.toLocaleString('en-US') + ' dungeon/enemy page links kept');
console.log('  ' + linkedEnemies.size.toLocaleString('en-US') + ' enemy pages across '
  + linkedDungeons.size.toLocaleString('en-US') + ' dungeon pages');
console.log('  ' + evidence.size.toLocaleString('en-US') + ' explicit section citations from '
  + sections.length.toLocaleString('en-US') + ' section names (' + examined.toLocaleString('en-US') + ' rows examined)');
console.log('  -> ' + path.relative(root, WIKI) + '\n');
