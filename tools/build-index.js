/*
 * The index: one record for every thing the site talks about, and the links
 * between them.
 *
 * The other three tools each read the client for themselves and each decide
 * what to keep - so when an item is missing from the bench or an enchantment
 * from the calculator, there is nowhere to look up whether the thing exists at
 * all. This is that place. It holds everything the client declares in the
 * families the site deals in, whether or not any tool shows it, and says for
 * each one where it came from and why a tool might be hiding it.
 *
 *     node tools/build-index.js
 *
 * It writes data/Index/index.json - the records and their links - and
 * data/Index/search.json, a light list the page can load first.
 *
 *
 * What an identifier is.
 *
 * "kind:name", where the name is what the game shows. The client's own id is
 * kept beside it as an alias, because that is what the art and the XML are
 * filed under and half the joins need it. Neither is unique across the whole
 * client - a display name can belong to several definitions, an id can be
 * reused between kinds - so the pair is what makes a record findable, and
 * where a name really is claimed twice the record says so rather than
 * silently keeping one.
 *
 *
 * What it does not do.
 *
 * It does not compute damage, cost or odds, and it does not decide what a
 * tool should show. It records declarations and their provenance; the tools
 * apply their own rules on top and the index says what those rules hid.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const OUT = path.join(root, 'data', 'Index');
/*
 * And a copy where the built site can fetch it. Everything else the site
 * needs is written into the page itself, but this is three and a half
 * megabytes for a page most visitors never open - so the served copy asks for
 * it only when somebody does, and only the file you download to keep carries
 * it inside.
 */
const SERVED = path.join(root, 'web', 'assets', 'index');

/* ---------------- reading the client ---------------- */
const objectFiles = fs.readdirSync(XML)
  .filter(name => /^Objects\.\d+\.xml$/.test(name)).sort();

/*
 * Attributes in whatever order the client wrote them. Most objects open with
 * type then id; a sixth of the file does not, and a pattern that insists on
 * the order walks past five thousand eight hundred definitions.
 */
const SHAPE = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/g;

const num = (body, tag, attr) => {
  const m = attr
    ? new RegExp('<' + tag + '[^>]*' + attr + '="([^"]+)"').exec(body)
    : new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>').exec(body);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
};
const text = (body, tag) => {
  const m = new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>').exec(body);
  return m ? m[1].trim() : '';
};
const has = (body, tag) => new RegExp('<' + tag + '\\s*/>').test(body);
const labelsOf = body => (text(body, 'Labels') || '').split(',').filter(Boolean);

/* Every object in the client, with the file it was declared in. */
const objects = [];
const byType = new Map();
for (const file of objectFiles) {
  const raw = fs.readFileSync(path.join(XML, file), 'utf8');
  for (const m of raw.matchAll(SHAPE)) {
    const id = /\bid="([^"]*)"/.exec(m[1]);
    const said = /\btype="([^"]+)"/.exec(m[1]);
    if (!id || !said) continue;
    const type = Number.parseInt(said[1], 16);
    if (!Number.isFinite(type)) continue;
    const one = { file, type, id: id[1], body: m[2] };
    objects.push(one);
    byType.set(type, one);
  }
}

/* What the game calls it on screen; the client's id is the working name. */
const nameOf = one => (text(one.body, 'DisplayId') || one.id).trim();

/* ---------------- the records ---------------- */
const records = new Map();          // id -> record
const links = [];                   // {from, to, how}

/*
 * Where a record came from, as a number into one list of file names. Two
 * hundred and thirty-eight documents and eleven thousand records: spelling
 * the name out on every one of them costs half a megabyte to say the same
 * forty things over and over.
 */
const fileList = [];
const fileAt = new Map();
function fileNumber(name) {
  if (!fileAt.has(name)) { fileAt.set(name, fileList.length); fileList.push(name); }
  return fileAt.get(name);
}

function put(kind, name, one, extra) {
  let id = kind + ':' + name;
  const had = records.get(id);
  if (had) {
    /*
     * A name claimed twice is two records, not one with a footnote. The
     * client really does declare several things under one name - a piece of
     * armour handed out by four dungeons, an enchantment written twice - and
     * an index that keeps one of them is an index that cannot answer "which
     * of these is the one I am holding". The second and later ones take the
     * client's own id into their identifier and are tied to the first.
     */
    id = kind + ':' + name + '#' + (one && one.id ? one.id : records.size);
    if (records.has(id)) return records.get(id);
    links.push({ from: id, how: 'same name as', to: kind + ':' + name });
  }
  const made = Object.assign({
    id, kind, name,
    twin: id.indexOf('#') > 0 || undefined,
    alias: one && one.id !== name ? one.id : undefined,
    from: one ? [fileNumber(one.file), '0x' + one.type.toString(16)] : undefined
  }, extra || {});
  records.set(id, made);
  return made;
}

const tie = (from, how, to) => { if (from && to) links.push({ from, how, to }); };

/* ---------------- the classes, and what they may hold ---------------- */
const SLOT_KIND = new Map();        // slot number -> which hand
const classes = [];
for (const one of objects) {
  if (!has(one.body, 'Player')) continue;
  const slots = (text(one.body, 'SlotTypes') || '').split(',')
    .map(x => Number(x.trim())).filter(n => n > 0);
  const record = put('class', nameOf(one), one, {
    about: text(one.body, 'Description'),
    slots,
    stats: {
      hp: num(one.body, 'MaxHitPoints'), hpTop: num(one.body, 'MaxHitPoints', 'max'),
      mp: num(one.body, 'MaxMagicPoints'), mpTop: num(one.body, 'MaxMagicPoints', 'max'),
      att: num(one.body, 'Attack'), attTop: num(one.body, 'Attack', 'max'),
      def: num(one.body, 'Defense'), defTop: num(one.body, 'Defense', 'max'),
      spd: num(one.body, 'Speed'), spdTop: num(one.body, 'Speed', 'max'),
      dex: num(one.body, 'Dexterity'), dexTop: num(one.body, 'Dexterity', 'max'),
      vit: num(one.body, 'HpRegen'), vitTop: num(one.body, 'HpRegen', 'max'),
      wis: num(one.body, 'MpRegen'), wisTop: num(one.body, 'MpRegen', 'max')
    }
  });
  classes.push({ record, one, slots });
  slots.slice(0, 4).forEach((slot, at) => {
    SLOT_KIND.set(slot, ['weapon', 'ability', 'armor', 'ring'][at]);
  });
}

/*
 * Which of them the site already has a picture of. The folder came from the
 * wiki, so it is a patch behind the game; the bench cuts what is missing out
 * of the client. Either way the index can say which, because "no picture" was
 * for a long time the reason a thing was nowhere to be seen.
 */
const drawn = (() => {
  const file = path.join(root, 'web', 'assets', 'items', 'index.json');
  if (!fs.existsSync(file)) return new Set();
  return new Set(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))));
})();

/* ---------------- everything wearable ---------------- */
/*
 * The index keeps all of it and marks what a tool would hide, rather than
 * dropping it: "the bench does not offer this because it is admin-only" is an
 * answer, and "it is not here" is not.
 */
const gear = [];
for (const one of objects) {
  if (!has(one.body, 'Item')) continue;
  const labels = labelsOf(one.body);
  if (!labels.includes('EQUIPMENT')) continue;
  const slot = num(one.body, 'SlotType');
  const hand = SLOT_KIND.get(slot);
  const hidden = [];
  if (has(one.body, 'AdminOnly')) hidden.push('admin only');
  if (/description="Item is not available to players/.test(one.body)) {
    hidden.push('not available to players');
  }
  if (labels.includes('SHINY') || / Shiny$/.test(one.id)) hidden.push('shiny');
  if (labels.includes('EFFECT')) hidden.push('an effect, not a thing worn');
  if (/(^|\s)(test|tester|testing|testiken)/i.test(one.id)) hidden.push('a test item');
  if (/\bProc\b/i.test(one.id)) hidden.push('the machinery behind a proc');
  if (!hand) hidden.push('a slot no class uses');
  const record = put('item', nameOf(one), one, {
    slot, hand,
    tier: num(one.body, 'Tier'),
    labels,
    about: text(one.body, 'Description'),
    sb: has(one.body, 'Soulbound') || undefined,
    mp: num(one.body, 'MpCost'),
    rate: num(one.body, 'RateOfFire'),
    shots: num(one.body, 'NumProjectiles'),
    pic: drawn.has(nameOf(one)) ? 'wiki' : 'client',
    hidden: hidden.length ? hidden : undefined
  });
  gear.push({ record, one, slot });
}

/*
 * What a class may hold is not written down: it is the slot numbers the class
 * declares against the slot number each item declares, which the page can do
 * in a moment. Writing out twelve thousand of those links, in both directions,
 * was half the size of the file for a fact that is one comparison.
 */
for (const kind of classes) {
  const start = (text(kind.one.body, 'Equipment') || '').split(',').slice(0, 4);
  for (const x of start) {
    const t = Number.parseInt(x.trim(), 16);
    const got = Number.isFinite(t) && t > 0 && byType.get(t);
    if (got) tie(kind.record.id, 'starts with', 'item:' + nameOf(got));
  }
}

/* ---------------- the things that fight back ---------------- */
for (const one of objects) {
  if (!has(one.body, 'Enemy')) continue;
  const hp = num(one.body, 'MaxHitPoints');
  const labels = labelsOf(one.body);
  put('enemy', nameOf(one), one, {
    hp,
    def: num(one.body, 'Defense'),
    labels,
    about: text(one.body, 'Description'),
    boss: labels.includes('BOSS') || labels.includes('ENCOUNTER') || undefined,
    god: labels.includes('GOD') || undefined
  });
}

/* ---------------- the sets ---------------- */
{
  const file = path.join(XML, 'EquipmentSets.xml');
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    for (const m of raw.matchAll(
      /<EquipmentSet\s+type="([^"]*)"\s+id="([^"]+)">([\s\S]*?)<\/EquipmentSet>/g)) {
      const body = m[3];
      const steps = {};
      for (const [tag, howMany] of [['ActivateOnEquip2', 2], ['ActivateOnEquip3', 3],
        ['ActivateOnEquipAll', 4]]) {
        const worn = {};
        for (const at of body.matchAll(
          new RegExp('<' + tag + '\\s+([^>]*)>\\s*IncrementStat\\s*<', 'g'))) {
          const stat = /stat="([^"]+)"/.exec(at[1]);
          const amount = /amount="([^"]+)"/.exec(at[1]);
          if (!stat || !amount) continue;
          const n = Number(amount[1]);
          if (Number.isFinite(n)) worn[stat[1]] = (worn[stat[1]] || 0) + n;
        }
        if (Object.keys(worn).length) steps[howMany] = worn;
      }
      const record = put('set', m[2], { id: m[2], type: 0, file: 'EquipmentSets.xml', body },
        { steps });
      for (const piece of body.matchAll(/<Setpiece\s+slot="(\d+)"\s+itemtype="([^"]+)"/g)) {
        const got = byType.get(Number.parseInt(piece[2], 16));
        if (got) tie(record.id, 'made of', 'item:' + nameOf(got));
      }
    }
  }
}

/* ---------------- the enchantments and their pools ---------------- */
{
  const raw = fs.readFileSync(path.join(XML, 'Enchantments.xml'), 'utf8');
  for (const m of raw.matchAll(
    /<Enchantment id="([^"]+)"[^>]*>([\s\S]*?)<\/Enchantment>/g)) {
    const body = m[2];
    const labels = (text(body, 'EnchantmentLabels') || '').split(',').filter(Boolean);
    const weight = num(body, 'Weight');
    const hidden = [];
    if (!(weight > 0)) hidden.push('retired - weight nought, never rolled again');
    if (!labels.includes('ROLLABLE')) hidden.push('not rollable by enchanting');
    put('enchant', text(body, 'DisplayId') || m[1],
      { id: m[1], type: 0, file: 'Enchantments.xml', body }, {
        about: text(body, 'Description'),
        labels,
        weight,
        fits: text(body, 'CompatibleWithItemLabels'),
        refuses: text(body, 'IncompatibleWithItemLabels'),
        beside: text(body, 'IncompatibleWithEnchantmentLabels'),
        hidden: hidden.length ? hidden : undefined
      });
  }

  const pools = path.join(XML, 'EnchantmentLists.xml');
  if (fs.existsSync(pools)) {
    const list = fs.readFileSync(pools, 'utf8');
    for (const m of list.matchAll(
      /<EnchantmentList\s+type="([^"]*)"\s+id="([^"]+)">([\s\S]*?)<\/EnchantmentList>/g)) {
      put('pool', m[2], { id: m[2], type: 0, file: 'EnchantmentLists.xml', body: m[3] }, {
        takes: [...m[3].matchAll(/includeLabelsOR="([^"]+)"/g)].map(x => x[1]).join(' ')
      });
    }
  }
}

/* What an item rolls from, where it says so. */
for (const it of gear) {
  const pool = /enchantmentList="([^"]+)"/.exec(it.one.body);
  if (pool) tie(it.record.id, 'rolls from', 'pool:' + pool[1]);
  const set = /setName="([^"]+)"/.exec(it.one.body);
  if (set) tie(it.record.id, 'belongs to', 'set:' + set[1]);
}

/* ---------------- and where the creatures actually live ---------------- */
{
  const atlas = path.join(root, 'web', 'assets', 'atlas', 'atlas.json');
  if (fs.existsSync(atlas)) {
    const said = JSON.parse(fs.readFileSync(atlas, 'utf8'));
    for (const biome of said.biomes || []) {
      const record = put('place', biome.name, null, {
        tiles: biome.tiles,
        ground: biome.ground,
        from: [fileNumber('the realm as it was walked'), '']
      });
      for (const lives of biome.lives || []) {
        const got = byType.get(lives.type);
        if (got) tie('enemy:' + nameOf(got), 'lives in', record.id);
      }
    }
  }
}

/*
 * Telling apart the ones that share a name.
 *
 * Three things called Doom Bow in a list of four is a list nobody can use, so
 * where a name is claimed more than once every claimant says what makes it
 * itself. The words come from the client's own working name, which is where
 * the difference is written: "Doom Bow Shiny" and "Retro Doom Bow" against a
 * plain "Doom Bow" give Shiny and Retro. Whichever one is filed under exactly
 * its own display name is the plain one and keeps the bare name.
 */
{
  const groups = new Map();
  for (const one of records.values()) {
    const key = one.kind + ':' + one.name;
    (groups.get(key) || groups.set(key, []).get(key)).push(one);
  }
  let told = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    for (const one of group) {
      if (!one.alias) continue;                    // the plain one keeps the name
      /*
       * What the working name adds to the shown name, in the order the client
       * wrote it - a leading "Retro", a trailing "Shiny" - and the whole
       * working name where the two have nothing in common.
       */
      const said = one.name.toLowerCase().split(/\s+/);
      const extra = one.alias.split(/\s+/)
        .filter(word => !said.includes(word.toLowerCase()))
        .join(' ');
      one.said = one.name + ' (' + (extra || one.alias) + ')';
      told++;
    }
  }
  if (told) console.log('  ' + told + ' told apart by what their working name adds');
}

/* ---------------- the links, from both ends ---------------- */
const out = new Map(), back = new Map();
for (const one of links) {
  if (!records.has(one.from) || !records.has(one.to)) continue;
  (out.get(one.from) || out.set(one.from, []).get(one.from)).push([one.how, one.to]);
  (back.get(one.to) || back.set(one.to, []).get(one.to)).push([one.how, one.from]);
}
for (const [id, record] of records) {
  const mine = out.get(id), theirs = back.get(id);
  if (mine && mine.length) record.out = mine;
  if (theirs && theirs.length) record.in = theirs;
}

/* ---------------- written down ---------------- */
fs.mkdirSync(OUT, { recursive: true });
const all = [...records.values()];
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  files: fileList,
  kinds: all.reduce((tally, one) => {
    tally[one.kind] = (tally[one.kind] || 0) + 1;
    return tally;
  }, {}),
  links: links.length,
  records: all
}) + '\n');

fs.mkdirSync(SERVED, { recursive: true });
fs.copyFileSync(path.join(OUT, 'index.json'), path.join(SERVED, 'index.json'));

/* And the light list, which is what a search box needs and nothing more. */
fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify(all.map(one => [
  one.id, one.said || one.name, one.kind, one.alias || '', one.hidden ? 1 : 0
])) + '\n');

const tally = all.reduce((got, one) => {
  got[one.kind] = (got[one.kind] || 0) + 1;
  return got;
}, {});
console.log('\n  ' + all.length.toLocaleString('en-US') + ' records, '
  + links.length.toLocaleString('en-US') + ' links');
for (const kind of Object.keys(tally).sort()) {
  console.log('    ' + String(tally[kind]).padStart(6) + '  ' + kind);
}
console.log('  -> ' + path.relative(root, path.join(OUT, 'index.json'))
  + '  (' + (fs.statSync(path.join(OUT, 'index.json')).size / 1024).toFixed(0) + ' KB)\n');
