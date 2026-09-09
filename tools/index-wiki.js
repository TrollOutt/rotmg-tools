/*
 * What the community knows, joined to what the client declares.
 *
 * The client says what a thing *is*. It does not say where it comes from:
 * loot is decided on the server, and no file in the installed game lists which
 * boss drops which bow. The community wiki does list it, and for five thousand
 * nine hundred of our records there is a page about that exact thing.
 *
 * This reads a local snapshot of that wiki and writes down only the join:
 *
 *   - which page is about which of our records, and its address;
 *   - which thing is listed as dropping which thing, and as spawning which.
 *
 * It does not copy the wiki's prose, its pictures or its tables. Those are
 * somebody else's writing; a link is the honest way to send a reader to them.
 *
 *     REALM_INDEX_BUNDLE=<path to the snapshot> node tools/index-wiki.js
 *
 * The snapshot is not in this repository and does not need to be: the join it
 * produces, data/Index/wiki.json, is committed, so the page works on a machine
 * that has never seen it. Without the snapshot this tool changes nothing.
 *
 *
 * What a claim from here is worth.
 *
 * Not the same as a client declaration, and the page must not pretend
 * otherwise. A drop list is what players have seen and written down: it has no
 * rate, it can be out of date, and it is grouped by whatever heading the page
 * happened to use. Every relation written here is marked as coming from the
 * community, and the page says so beside them.
 *
 * Nothing here resolves an ambiguity by guessing. Where one page's name
 * matches three client definitions - the plain Doom Bow, the shiny and the
 * retro - all three are joined to it and the reader is told, because which of
 * the three the page is really about is not ours to decide.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'data', 'Index');
const SERVED = path.join(root, 'web', 'assets', 'index');
const INDEX = path.join(OUT, 'index.json');

/*
 * Where the snapshot is. It is large, it is not ours to publish, and its path
 * is a local matter - so it is named by the environment, and the two places
 * looked at otherwise are inside this working copy and untracked.
 */
const BUNDLE = process.env.REALM_INDEX_BUNDLE
  || [path.join(root, 'local', 'realm-linked-index', 'bundle'),
      path.join(root, 'local', 'wiki-bundle')].find(at => fs.existsSync(at));

if (!BUNDLE || !fs.existsSync(path.join(BUNDLE, 'wiki', 'search.json'))) {
  const had = fs.existsSync(path.join(OUT, 'wiki.json'));
  console.log('\n  No wiki snapshot to read'
    + (BUNDLE ? ' at ' + BUNDLE : ' (set REALM_INDEX_BUNDLE)') + '.');
  console.log('  ' + (had
    ? 'Keeping the join already in data/Index/wiki.json.'
    : 'The index will simply have no community links.') + '\n');
  process.exit(0);
}

/* ---------------- our records, by the client's own key ---------------- */
const facts = JSON.parse(fs.readFileSync(INDEX, 'utf8'));

/*
 * The snapshot files a client object under "document|type in decimal|its id",
 * which is precisely the three things a record already carries. So the join is
 * exact: no name matching, no near misses, and nothing to arbitrate. Of the
 * seven thousand four hundred keys it knows, five thousand nine hundred and
 * ninety-two are things this index holds; the rest are portals, controllers
 * and other machinery the index does not keep.
 */
const byKey = new Map();
for (const one of facts.records) {
  if (!one.from) continue;
  /*
   * Under every document that declares it. Four hundred objects are written
   * out twice - Objects.002 and Objects.113 both hold the Frozen Chest - and
   * the index keeps one record with both provenances, so a page filed against
   * the second one has to find it too.
   */
  for (const where of [one.from[0], ...(one.also || [])]) {
    const key = facts.files[where] + '|' + parseInt(one.from[1], 16)
      + '|' + (one.alias || one.name);
    if (!byKey.has(key)) byKey.set(key, []);
    if (!byKey.get(key).includes(one.id)) byKey.get(key).push(one.id);
  }
}

/* ---------------- the snapshot ---------------- */
const search = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'wiki', 'search.json'), 'utf8'));

const pageAt = new Map();           // page id -> our page index
const pages = [];                   // [slug, title]
function pageNumber(id, slug, title) {
  if (!pageAt.has(id)) { pageAt.set(id, pages.length); pages.push([slug, title]); }
  return pageAt.get(id);
}

const idAt = new Map();             // our record id -> our id index
const ids = [];
function idNumber(id) {
  if (!idAt.has(id)) { idAt.set(id, ids.length); ids.push(id); }
  return idAt.get(id);
}

/* First pass: what each page is about, and how to name it. */
const about = new Map();            // page id -> [our record ids]
const seen = new Map();             // page id -> {slug, title, gone}
for (const row of search) {
  const raw = JSON.parse(fs.readFileSync(path.join(BUNDLE, row.file), 'utf8'));
  const slug = String(raw.canonicalUrl || raw.url || '')
    .replace(/^https?:\/\/(?:www\.)?realmeye\.com\/wiki\//, '');
  seen.set(raw.id, { slug, title: raw.title || row.name || slug,
    gone: Boolean(raw.life && raw.life.goneAt) });
  const mine = [];
  for (const match of raw.clientMatches || []) {
    for (const id of byKey.get(match.key) || []) if (!mine.includes(id)) mine.push(id);
  }
  if (mine.length) about.set(raw.id, mine);
}

/* ---------------- which way round a listing reads ---------------- */
/*
 * The snapshot marks a link as a drop when it sits under a heading like
 * "Drops". That says the two pages are named together in a loot section; it
 * does not say which of them is the loot. A monster page's Drops section
 * names its loot, and an item page's names the monsters that give it - the
 * same mark, opposite directions - so reading every one the same way puts
 * "Septavius the Ghost God, dropped by Pet Skins" on the card.
 *
 * The index already knows what each page is about, so the pair settles it: a
 * creature or a place on one side and a thing on the other is a drop, and any
 * other shape is a sentence this cannot read. Those are left out rather than
 * guessed at; a wrong arrow is worse than a missing one.
 */
function shapeOf(records) {
  let foe = false, thing = false;
  for (const id of records) {
    const kind = id.slice(0, id.indexOf(':'));
    if (kind === 'enemy' || kind === 'place') foe = true;
    else if (kind === 'item') thing = true;
  }
  return foe ? 'foe' : thing ? 'thing' : 'unknown';
}
const READS = {
  /* Somebody drops something: the giver is a creature or a place. */
  drop: (from, to) => (from === 'foe' && to !== 'foe')
    || (from === 'unknown' && to === 'thing'),
  /* Something summons something: both ends are alive. */
  spawn: (from, to) => (from === 'foe' && to !== 'thing')
    || (from === 'unknown' && to === 'foe')
};

const near = [];

/*
 * And the ones the client gives no number.
 *
 * A set lives in EquipmentSets.xml with no type of its own, so the key join -
 * document, number, id - cannot reach it, and every set card was missing the
 * link to a page that plainly exists. The same is true of the realm's biomes.
 * For those two families only, and only where exactly one page answers to the
 * name once punctuation and case are set aside, the title is enough: a set
 * name is not a word anything else in the wiki is called.
 *
 * Not for items or creatures. There the key join already works, and a name is
 * claimed three times often enough that guessing would undo the whole point.
 */
{
  const byTitle = new Map();
  const norm = one => String(one).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [id, one] of seen) {
    if (one.gone) continue;
    const key = norm(one.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(id);
  }
  /*
   * And the wiki does not always spell a set the way the client does. It calls
   * the Corrupted Paladin "Corrupted Paladin Set" and the four Paths
   * "Path of the Magus Engraving"; the client leaves the noun off. So the name
   * is tried with and without the words the wiki habitually adds, still on the
   * condition that exactly one page answers.
   */
  const TRIES = [
    name => name,
    name => name + ' set',
    name => name.replace(/ set$/, ''),
    name => name + ' engraving',
    name => name + ' gear'
  ];
  let told = 0;
  const stillLoose = [];
  for (const one of facts.records) {
    if (one.kind !== 'set' && one.kind !== 'place') continue;
    let page = null;
    for (const shape of TRIES) {
      const found = byTitle.get(shape(norm(one.name))) || [];
      if (found.length === 1) { page = found[0]; break; }
    }
    if (!page) { if (one.kind === 'set') stillLoose.push(one); continue; }
    if (!about.has(page)) about.set(page, []);
    if (!about.get(page).includes(one.id)) { about.get(page).push(one.id); told++; }
  }
  if (told) console.log('  ' + told + ' sets and places matched by name, having no number to match on');
  /*
   * And where a set has no page at all, the way a player would find one:
   * open one of its pieces and see what the piece points at. Every piece of
   * the Oryxmas Miracle Set links to "Oryxmas Gear", every Venerable piece to
   * "Venerable Gear" - the wiki files those sets under the family rather than
   * one page each.
   *
   * That is not the set's own page, so it is kept apart as `near` and the card
   * names it rather than pretending. A candidate has to be linked from the
   * body of nearly every piece and share a word with the set, or "Enchanting"
   * and "Forge" - which every piece links to - would win every time.
   */
  const DULL = new Set(['set', 'sets', 'gear', 'the', 'of', 'a', 'i', 'ii', 'iii', 'and']);
  for (const one of stillLoose) {
    const pieces = (one.out || []).filter(([how]) => how === 'made of').map(([, to]) => to);
    const mine = new Set(norm(one.name).split(' ').filter(word => !DULL.has(word)));
    if (!mine.size || pieces.length < 3) continue;
    const tally = new Map();
    let looked = 0;
    for (const piece of pieces) {
      const where = [...about].find(([, ids]) => ids.includes(piece));
      if (!where) continue;
      looked++;
      const row = search.find(x => x.id === where[0]);
      if (!row) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(BUNDLE, row.file), 'utf8'));
      const here = new Set();
      for (const link of raw.links || []) {
        if (link.region !== 'content' || !link.targetId) continue;
        here.add(link.targetId);
      }
      for (const id of here) tally.set(id, (tally.get(id) || 0) + 1);
    }
    if (!looked) continue;
    let best = null;
    for (const [id, n] of tally) {
      if (n < looked * 0.8) continue;
      const said = seen.get(id);
      if (!said || /^template/i.test(said.title)) continue;
      const theirs = norm(said.title).split(' ').filter(word => !DULL.has(word));
      if (!theirs.some(word => mine.has(word))) continue;
      if (!best || n > best.n) best = { id, n, title: said.title, slug: said.slug };
    }
    if (best) near.push([one.id, best]);
  }
  if (near.length) {
    console.log('  ' + near.length + ' sets pointed at the family page their own pieces point at: '
      + near.slice(0, 4).map(([, x]) => x.title).join(', '));
  }
  const stillNone = stillLoose.length - near.length;
  if (stillNone) console.log('  ' + stillNone + ' sets the wiki does not write about at all');
}

/* Second pass: the relations, now that every page's records are known. */
const KEPT = { wiki_lists_drop: 'drop', wiki_lists_spawn: 'spawn' };
const edges = { drop: new Set(), spawn: new Set() };
let looked = 0, dropped = 0, unread = 0;

for (const row of search) {
  const raw = JSON.parse(fs.readFileSync(path.join(BUNDLE, row.file), 'utf8'));
  const here = about.get(raw.id) || [];

  for (const link of raw.links || []) {
    const kind = KEPT[link.semanticRelation];
    if (!kind || !link.targetId || !seen.has(link.targetId)) continue;
    const there = about.get(link.targetId) || [];
    /*
     * An edge with neither end on a record of ours says nothing this index can
     * show - one wiki page listing another - so it is left where it is.
     */
    if (!here.length && !there.length) { dropped++; continue; }
    /* A page listing itself is a table of contents, not a fact. */
    if (link.targetId === raw.id) { dropped++; continue; }
    if (!READS[kind](shapeOf(here), shapeOf(there))) { unread++; continue; }
    /*
     * And the thing at the far end has to be a thing.
     *
     * Both readings put what is given at the target end, so that end should
     * name something the index knows. Often it does not: a boss's Drops
     * section links the categories its loot belongs to as readily as the loot
     * - Weapons, Armor, Rings, Ability Items - and those pages answer to no
     * record of ours at all.
     *
     * Measured on the snapshot of 8 September: 3,613 of 12,954 drop edges
     * pointed at a page carrying no record, and five titles accounted for two
     * and a half thousand of them. "Oryx the Mad God drops Weapons" is true
     * and it is not a fact anything can use - worse, anything reading this
     * table to ask where an item comes from has to wade through it.
     *
     * The check above already threw away an edge with a record at neither
     * end. This throws away the ones with a record only at the near end,
     * which is the same argument carried one step further.
     */
    if (!there.length) { dropped++; continue; }
    /*
     * Page to page, not record to record. One page answers to three client
     * definitions where a name is claimed three times, and fanning the same
     * drop list out across all three would write it nine times and imply that
     * the wiki said something separate about each. It said it once, about the
     * page; the card finds it through the page.
     */
    const pair = pageNumber(raw.id, seen.get(raw.id).slug, seen.get(raw.id).title)
      + ',' + pageNumber(link.targetId, seen.get(link.targetId).slug,
        seen.get(link.targetId).title);
    if (edges[kind].has(pair)) continue;
    edges[kind].add(pair);
    looked++;
  }

}

/* ---------------- written down ---------------- */
const page = [];
for (const [id, mine] of about) {
  const at = pageNumber(id, seen.get(id).slug, seen.get(id).title);
  for (const one of mine) page.push([idNumber(one), at]);
}
const pairs = kind => [...edges[kind]].map(one => one.split(',').map(Number));

const nearby = [];
for (const [id, best] of near) {
  nearby.push([idNumber(id), pageNumber(best.id, best.slug, best.title)]);
}

const said = {
  built: new Date().toISOString().slice(0, 10),
  says: 'the RealmEye community wiki',
  at: 'https://www.realmeye.com/wiki/',
  pages, ids, page, near: nearby,
  drop: pairs('drop'), spawn: pairs('spawn')
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'wiki.json'), JSON.stringify(said) + '\n');
fs.mkdirSync(SERVED, { recursive: true });
fs.copyFileSync(path.join(OUT, 'wiki.json'), path.join(SERVED, 'wiki.json'));

const size = (fs.statSync(path.join(OUT, 'wiki.json')).size / 1024).toFixed(0);
console.log('\n  ' + ids.length.toLocaleString('en-US') + ' of our records have a page, '
  + pages.length.toLocaleString('en-US') + ' pages referenced');
console.log('  ' + edges.drop.size.toLocaleString('en-US') + ' drop and '
  + edges.spawn.size.toLocaleString('en-US') + ' spawn links kept, '
  + dropped.toLocaleString('en-US') + ' set aside as unreachable, '
  + unread.toLocaleString('en-US') + ' that could point either way');
console.log('  -> ' + path.relative(root, path.join(OUT, 'wiki.json')) + '  (' + size + ' KB)\n');
