/*
 * What the Skin Viewer needs to know, projected out of the index.
 *
 *   node tools/generate-skins.js
 *
 * The viewer used to carry its own catalogue: 1,475 skins with their names,
 * their class and a costume worked out from the name, 802 dyes, the 19
 * classes, and a bridge of guessed links back to index records. Eighteen
 * megabytes of it, and nothing in this repository could rebuild any of it.
 *
 * All of that is in the index now, read from the same client files by the
 * same build. So this is a projection like every other one here - it reads
 * data/Index/index.json and never the client - and it carries only what a
 * catalogue needs: what a thing is called, whose it is, and what it is joined
 * to. Where each frame sits is the other half, and that is geometry rather
 * than catalogue: tools/build-skin-looks.js writes it.
 *
 * The two meet on the client's own type, which is the key of both.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const provenance = require('./provenance');

const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const OUT = path.join(root, 'web', 'assets', 'skins', 'generated');

const meta = provenance.stamp(__filename, index.from, index.built);
const records = new Map(index.records.map(one => [one.id, one]));
const typeOf = one => (one.from && one.from[1]) || '';

/* The name a reader knows a thing by, not the working id, wherever they differ. */
const said = one => one.name;

/* ---------------- skins ---------------- */
/*
 * Every join here is the client's, carried through the index rather than
 * matched on a name. `unlocker` is the consumable whose <Activate skinType>
 * names this skin; `set` is the equipment set whose <ActivateOnEquip…
 * skinType> names it; `wears` is its <PlayerClassType>. `look` is the one
 * deduced thing, and is marked as such on the index record it comes from.
 */
const skins = [];
for (const one of index.records) {
  if (one.kind !== 'skin') continue;
  const links = { wears: null, unlockers: [], sets: [] };
  for (const [how, to] of one.out || []) {
    if (how === 'worn by') links.wears = (records.get(to) || {}).name || null;
  }
  /*
   * More than one thing can hand the same appearance over: the tradeable
   * consumable and its soulbound twin both unlock the Agent, and a few skins
   * are given by two different sets. All of them, in the order the index
   * holds them, rather than whichever happened to be read last.
   */
  for (const [how, from] of one.in || []) {
    if (how === 'unlocks') links.unlockers.push(from);
    if (how === 'dresses you as') links.sets.push(from);
  }
  skins.push({
    type: typeOf(one),
    id: one.id,
    name: said(one),
    client: one.alias || undefined,
    wears: links.wears || undefined,
    look: one.look || undefined,
    tier: one.tier,
    level: one.level || undefined,
    given: one.given || undefined,
    pick: one.pick ? 1 : undefined,
    unlockers: links.unlockers.length ? links.unlockers : undefined,
    sets: links.sets.length ? links.sets : undefined,
    /*
     * Whether the client holds a picture of it at all. Nineteen skins are
     * declared with an <AnimatedTexture> the client's own sprite registry has
     * no entry for - every 2-Bit class - so there is nothing to draw and
     * nothing to offer. The index says so by having no art for them, which is
     * the same nineteen.
     */
    drawn: one.art ? 1 : undefined,
    hidden: one.hidden ? one.hidden.join('; ') : undefined
  });
}
skins.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));

/* ---------------- dyes ---------------- */
/* The index already holds every dye as a thing the client puts in a bag. */
const dyes = [];
for (const one of index.records) {
  if (one.family !== 'dye' || one.folded) continue;
  dyes.push({ type: typeOf(one), id: one.id, name: said(one),
    on: one.dyes || undefined, about: one.about || undefined });
}
dyes.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));

/* ---------------- classes ---------------- */
const classes = [];
for (const one of index.records) {
  if (one.kind !== 'class') continue;
  classes.push({ type: typeOf(one), id: one.id, name: said(one) });
}

/* ---------------- written down ---------------- */
fs.mkdirSync(OUT, { recursive: true });
const write = (name, value) => {
  const body = JSON.stringify(Object.assign({}, meta, value));
  fs.writeFileSync(path.join(OUT, name), body);
  return body.length;
};
const sizes = {
  'skins.json': write('skins.json', { skins }),
  'dyes.json': write('dyes.json', { dyes }),
  'classes.json': write('classes.json', { classes })
};

/*
 * The bridge the viewer used to carry is gone. It matched skins to index
 * records by name and reached 864 of them; the index states 1,431 of the same
 * joins outright, and the other 44 have nothing pointing at them in the
 * client. A file of guesses beside a file of facts is a file nobody can trust.
 */
const stale = path.join(OUT, 'index-links.json');
if (fs.existsSync(stale)) { fs.unlinkSync(stale); console.log('  removed the guessed index bridge'); }

console.log('Projected ' + skins.length + ' skins, ' + dyes.length + ' dyes and '
  + classes.length + ' classes from index build ' + index.from.build);
for (const [name, size] of Object.entries(sizes)) {
  console.log('  ' + name.padEnd(14) + (size / 1024).toFixed(0) + ' KB');
}
