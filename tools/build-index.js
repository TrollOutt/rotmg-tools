/*
 * The index: one record for every thing the site talks about, and the links
 * between them.
 *
 * The catalogue tools project this file rather than opening the client.
 * This is the source of their records, filters and provenance. It holds everything the client declares in the
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
 * tool calculates. It records declarations, catalogue membership and provenance;
 * the browser applies combat and enchanting rules to those declarations.
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
/*
 * The installed game, or a plain word about why not.
 *
 * client-data/ is read out of an installed client and is not in this
 * repository - it is DECA's, it is large, and it is reproduced in seconds. But
 * a clone that has never seen it should say so rather than throw a stack trace
 * at somebody who has just pulled the project onto a new machine.
 */
if (!fs.existsSync(XML)) {
  console.log('\n  No client-data/ here, so there is nothing to read.');
  console.log('  On a machine with the game installed:  node tools/extract-client.js');
  console.log('  Everything this would write is already committed, so the site');
  console.log('  builds and runs without it - npm run build is enough.\n');
  process.exit(0);
}

const meta = require('./provenance').clientStamp(XML, __filename);
const documents = new Map(fs.readdirSync(XML).filter(name => name.endsWith('.xml')).sort()
  .map(name => [name, fs.readFileSync(path.join(XML, name), 'utf8')]));

const objectFiles = [...documents.keys()]
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
  const raw = documents.get(file);
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
const byName = new Map();
for (const one of objects) if (!byName.has(one.id)) byName.set(one.id, one);
const catalogues = {};
catalogues.fame = require('./extract-index-fame')(documents);
catalogues.artifacts = require('./extract-index-artifacts')(documents);
catalogues.enchantments = require('./extract-index-enchantments')(documents);
catalogues.items = require('./extract-index-items')(documents);
const mechanics = require('./extract-index-mechanics')({ root, byType, byName, documents });

/*
 * What to call it. The DisplayId where there is one - but sixteen objects
 * carry a localisation token the client never resolved, "{cave.Treasure_Thief}"
 * and one that is four question marks, and a token is not a name. Those fall
 * back to the client's own id, which in every one of those cases is the
 * readable name the token was standing in for.
 */
const nameOf = one => {
  const said = (text(one.body, 'DisplayId') || '').trim();
  if (!said || /^\{[^}]*\}$/.test(said) || /^\?+$/.test(said)) return one.id.trim();
  return said;
};

/* ---------------- the records ---------------- */
const records = new Map();          // id -> record
let slotNames = {};                 // slot number -> [what it is called, its plainest item]
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

/*
 * The same object, declared twice.
 *
 * Four hundred definitions appear in two documents at once - Objects.002 and
 * Objects.113 both declare the Frozen Chest, same type, same life, same art -
 * and they are not two chests. A type is the client's own number for a thing,
 * so the same number under the same family is the same thing however many
 * files repeat it. The second sighting adds its document to the first record's
 * provenance and stops there.
 */
const byNumber = new Map();

function put(kind, name, one, extra) {
  /*
   * Only for things the client numbers. A set, a pool and an enchantment list
   * are given a type of nought by the reader above because they have none of
   * their own, and nought is not an identity: merging on it collapsed a
   * thousand enchantments into one.
   */
  if (one && one.type) {
    const key = kind + '|' + one.type;
    const twice = byNumber.get(key);
    if (twice) {
      const where = fileNumber(one.file);
      if (!twice.also) twice.also = [];
      if (twice.from[0] !== where && !twice.also.includes(where)) twice.also.push(where);
      return twice;
    }
  }
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
  if (one && one.type) byNumber.set(kind + '|' + one.type, made);
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

/* ---------------- everything wearable ---------------- */
/*
 * The index keeps all of it and marks what a tool would hide, rather than
 * dropping it: "the bench does not offer this because it is admin-only" is an
 * answer, and "it is not here" is not.
 */
/*
 * What a piece of gear does, read the way the bench reads it so that the two
 * cannot drift: damage from the projectile, range from its speed multiplied by
 * how long it lives, and what wearing it is worth from ActivateOnEquip.
 */
const shotOf = mechanics.shotOf;

/*
 * What the client says a thing does when a number cannot say it.
 *
 * Twenty-five pieces of visible gear carry no damage, no bonus and no rate,
 * and read on the card as though they did nothing: the Alien Cores, the
 * Reactors. They do plenty, and the client writes it out - "Gain strength
 * based on the amount of Alien Gear you wear" - in the tooltip block rather
 * than as a mutator. Five thousand item definitions carry one.
 */
function tipsOf(body) {
  const out = [];
  for (const m of body.matchAll(
    /<EffectInfo\s+name="([^"]*)"\s+description="([^"]*)"/g)) {
    const name = m[1].trim(), said = m[2].trim();
    if (!said) continue;
    out.push(name ? [name, said] : [said]);
  }
  return out.length ? out : undefined;
}

const wornOf = mechanics.wornOf;

/*
 * And whether the other two tools will actually take the thing.
 *
 * The index used to offer a door to the bench and to the calculator on every
 * piece of gear, and both doors were sometimes locked: the Trick Mace opened
 * the calculator on "not in the item list", because the client does not let it
 * be enchanted at all. So membership is read from what those tools were built
 * with rather than assumed. Both catalogues are extracted in this build;
 * no older projection participates in deciding membership.
 */
const offered = (() => {
  const bench = new Set(), ench = new Set(), fought = new Set();
  for (const one of mechanics.items) bench.add(one.name);
  for (const one of mechanics.bosses) fought.add(one.name);
  const awakens = new Map();
  for (const item of catalogues.items) {
    ench.add(item.name);
    if (item.awoken.length) awakens.set(item.name, item.awoken);
  }
  return { bench, ench, fought, awakens };
})();

/*
 * What kind of thing this is, when it is not gear.
 *
 * Everything the client marks with <Item /> goes into a bag: it is a thing you
 * own, and the index is where you go to find out about a thing. But most of
 * them are not worn, and calling them all "an item" the way the gear is called
 * an item tells a reader nothing at all.
 *
 * The client says which is which, in two different ways, and both are read
 * here rather than guessed. Some things carry a label - MARK, ARTIFACT, KEY -
 * and some carry nothing but the verb they fire when you use them, which is
 * just as plain: a thing whose Activate says UnlockPetSkin is a pet skin, and
 * a thing that says CreatePet is an egg. Between them they name nine in ten of
 * what used to be filed as "a slot no class uses".
 *
 * The verb is asked first, because a label like FORGESTORE is on almost
 * anything you can dismantle and says nothing about what the thing is.
 */
const DOES = new Map([
  ['UnlockSkin', 'skin'], ['UnlockPetSkin', 'pet skin'],
  ['UnlockGravestone', 'gravestone'], ['UnlockTitle', 'title'],
  ['CreatePet', 'pet egg'], ['PermaPet', 'pet egg'],
  ['CreatePortal', 'key'], ['AddDust', 'enchant dust'],
  ['GrantSupporterPoints', 'supporter reward']
]);
const LABELLED = [
  ['mark', labels => labels.includes('MARK')],
  ['artifact', labels => labels.includes('ARTIFACT')],
  ['key', labels => labels.some(l => /(^|_)KEY$/.test(l))],
  ['shard', (labels, id) => labels.includes('NILSHARD') || /Shard(\s*x\s*\d+)?$/.test(id)],
  ['material', labels => labels.includes('MATERIAL') || labels.includes('UPGRADECORE')],
  ['engraving', labels => labels.includes('ENGRAVING')],
  ['emote', labels => labels.some(l => /_EMOTE$/.test(l))],
  ['token', labels => labels.includes('RATCOIN') || labels.includes('TOKEN')],
  ['consumable', labels => labels.includes('CONSUMABLE')]
];
const familyOf = (labels, one) => {
  const cls = text(one.body, 'Class');
  if (cls === 'Dye') return 'dye';
  if (cls === 'Entrance') return 'entrance';
  for (const m of one.body.matchAll(/<Activate[^>]*>([^<]*)<\/Activate>/g)) {
    const say = DOES.get(m[1].trim());
    if (say) return say;
  }
  for (const [say, test] of LABELLED) if (test(labels, one.id)) return say;
  return 'other';
};

const gear = [];
for (const one of objects) {
  if (!has(one.body, 'Item')) continue;
  const labels = labelsOf(one.body);
  /*
   * Everything in a bag, not only what a class can wear.
   *
   * This asked for the EQUIPMENT label and stopped, which kept eight thousand
   * eight hundred things out of the index: every mark, every artifact, the
   * keys, the set shards, the dyes and the pet stones - and the Paper Machete,
   * which the client lets you enchant and simply never labelled. So the
   * calculator offered an item the index had never heard of, and six hundred
   * pages of the community wiki had nothing here to point at.
   *
   * A thing the client puts in your bag is a thing this index knows about. The
   * label decides what family it belongs to, not whether it exists.
   */
  const isGear = labels.includes('EQUIPMENT') || /<EnchantmentSlots[\s/>]/.test(one.body);
  const family = isGear ? undefined : familyOf(labels, one);
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
  /* Long Sword 1Rarity through 4Rarity: four copies for showing off a frame. */
  if (/\d+Rarity$/.test(one.id)) hidden.push('a swatch for drawing a rarity frame');
  /*
   * A potion is not gear with a slot nobody uses; it is a different kind of
   * thing. Two thousand of them were filed as hidden for a reason that was
   * true of the slot and false of the object, which put every key, token and
   * potion behind a warning. They are their own family now, and only the seven
   * that are neither worn nor drunk keep the old reason.
   */
  /*
   * "A slot no class uses" was the reason given to everything that was not
   * worn, which was true of the slot and false of the object: a key is not a
   * ring nobody can equip, it is a key. Anything the client gives a family to
   * is filed under that family and is not hidden at all. What is left - a
   * handful of things that are neither worn, drunk, nor anything the client
   * names - keeps the old reason, which for them is the honest one.
   */
  const drunk = labels.includes('CONSUMABLE');
  if (!hand && !drunk && (!family || family === 'other')) hidden.push('a slot no class uses');
  const record = put('item', nameOf(one), one, {
    slot, hand,
    tier: num(one.body, 'Tier'),
    labels,
    about: text(one.body, 'Description'),
    sb: has(one.body, 'Soulbound') || undefined,
    mp: num(one.body, 'MpCost'),
    rate: num(one.body, 'RateOfFire'),
    shots: num(one.body, 'NumProjectiles'),
    use: drunk ? 1 : undefined,
    family,
    fires: shotOf(one.body),
    worn: wornOf(one.body),
    does: tipsOf(one.body),
    /*
     * Only the first record under a name is offered a door. Where the client
     * declares three things called Doom Bow, the bench and the calculator know
     * one of them, by that name, and cannot be told which - so the shiny and
     * the retro send nobody anywhere.
     */
    bench: !records.has('item:' + nameOf(one)) && offered.bench.has(nameOf(one))
      ? 1 : undefined,
    ench: !records.has('item:' + nameOf(one)) && offered.ench.has(nameOf(one))
      ? 1 : undefined,
    pic: 'client',
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
    /* Only the creatures the bench will actually stand a build in front of. */
    fight: !records.has('enemy:' + nameOf(one)) && offered.fought.has(nameOf(one))
      ? 1 : undefined,
    boss: labels.includes('BOSS') || labels.includes('ENCOUNTER') || undefined,
    god: labels.includes('GOD') || undefined,
    /*
     * The invisible machinery that puts creatures on the map.
     *
     * A spawner is a GameObject with an Enemy flag and no picture: the client
     * counts it as something that fights so that it can be killed to stop the
     * wave, and the player never sees it. Three hundred and seventy-four of
     * them sat in the list of things to fight with a blank where the creature
     * should be, so they are marked for what they are.
     */
    spawns: text(one.body, 'Class') === 'GameObject'
      && /<File>invisible<\/File>/.test(one.body) || undefined,
    /* What brought it, where it is not a creature of anywhere in particular. */
    came: (labels.find(one => /_INVASION_/.test(one)) || '')
      .replace(/_(ADEPT|VETERAN|MASTER)$/, '').split('_')
      .map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(' ') || undefined
  });
}

/* ---------------- the doors into places ---------------- */
/*
 * A dungeon is a portal in the client, and the community's drop lists are full
 * of them: the Doom Bow comes from the Undead Lair, and the card had nothing to
 * draw beside that name because the index kept no such thing. Two hundred and
 * twenty-three portals, every one of them with its own art, so a dungeon in a
 * list now looks like the dungeon.
 */
for (const one of objects) {
  if (!/<Class>Portal<\/Class>/.test(one.body)) continue;
  const labels = labelsOf(one.body);
  const hidden = [];
  if (has(one.body, 'AdminOnly')) hidden.push('admin only');
  if (/(^|\s)(test|tester|testing)/i.test(one.id)) hidden.push('a test item');
  put('portal', nameOf(one), one, {
    labels,
    about: text(one.body, 'Description'),
    /*
     * The ones that are wiring rather than a way in: the teleporters inside
     * the Spectral Penitentiary, the bare "Teleport". Kept, because the index
     * keeps what the client declares, but not offered to a reader browsing.
     */
    dev: /TP|^Teleport$|Return/i.test(one.id) ? 1 : undefined,
    hidden: hidden.length ? hidden : undefined
  });
}

/* ---------------- the sets ---------------- */
{
  const file = path.join(XML, 'EquipmentSets.xml');
  if (fs.existsSync(file)) {
    const raw = documents.get(path.basename(file));
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
      /*
       * What the pieces are worth on their own, added up.
       *
       * Most of the older sets pay nothing for being complete - the Oryx
       * Awesome Set only changes how you look - and a card that showed nothing
       * read as though the set did nothing. It does: it is four pieces, and
       * their bonuses are the reason to wear them. That total is what the wiki
       * calls the overall stat bonus, and where the two disagree the client is
       * the one holding the numbers. Its ring gives 140 life today against the
       * 140 the wiki still adds up differently, and the wiki's page says the
       * set stopped dropping in 2018.
       */
      const pieces = [];
      const worn = {};
      for (const piece of body.matchAll(/<Setpiece\s+slot="(\d+)"\s+itemtype="([^"]+)"/g)) {
        const got = byType.get(Number.parseInt(piece[2], 16));
        if (!got) continue;
        pieces.push(got);
        const mine = records.get('item:' + nameOf(got));
        for (const stat of Object.keys((mine && mine.worn) || {})) {
          worn[stat] = (worn[stat] || 0) + mine.worn[stat];
        }
      }
      /*
       * And its face. A set has no picture of its own, but the skin it turns
       * the wearer into is an object like any other, with art the client draws.
       */
      /*
       * Any of the tags that changes a skin, not just the one for wearing all
       * four. The Paths and the big multi-class sets hand out their skin with
       * ActivateOnEquipCustom instead, and looking only for ActivateOnEquipAll
       * left twenty-five sets with an empty frame.
       */
      const changes = /<ActivateOnEquip\w*\s+skinType="([^"]+)"[^>]*>\s*ChangeSkin/.exec(body);
      const skin = changes && byType.get(Number.parseInt(changes[1], 16));
      /*
       * Eighteen of them hand out no skin at all - the big multi-class stat
       * sets, Agents of Oryx and the Venerable three - so there is no picture
       * of the set anywhere in the client. Rather than an empty frame they
       * wear the face of their first piece, and the card says that is what it
       * is looking at.
       */
      const emblem = skin || pieces[0];
      const record = put('set', m[2], { id: m[2], type: 0, file: 'EquipmentSets.xml', body },
        { steps,
          worn: Object.keys(worn).length ? worn : undefined,
          skin: skin ? nameOf(skin) : undefined,
          pic: skin ? 'skin' : (pieces[0] ? 'piece' : undefined),
          drawnAs: emblem ? emblem.id : undefined });
      for (const got of pieces) tie(record.id, 'made of', 'item:' + nameOf(got));
    }
  }
}

/* ---------------- the enchantments and their pools ---------------- */
{
  const raw = documents.get('Enchantments.xml');
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
    const list = documents.get(path.basename(pools));
    for (const m of list.matchAll(
      /<EnchantmentList\s+type="([^"]*)"\s+id="([^"]+)">([\s\S]*?)<\/EnchantmentList>/g)) {
      /*
       * Plumbing. A pool is how the game decides what an item may roll, and it
       * is worth being able to look one up - but nobody browsing the index is
       * looking for "Default Enchantment Pool", so it waits to be asked for.
       */
      put('pool', m[2], { id: m[2], type: 0, file: 'EnchantmentLists.xml', body: m[3] }, {
        dev: 1,
        takes: [...m[3].matchAll(/includeLabelsOR="([^"]+)"/g)].map(x => x[1]).join(' ')
      });
    }
  }
}

/*
 * Which enchantments a pool can actually give.
 *
 * A pool names none of them. It says "everything labelled ROLLABLE" and then
 * changes the odds - so the link is the label, and eight hundred and ninety
 * enchantments that looked unattached are simply attached by a rule rather
 * than by a list. Where a pool does name one, it is naming a favourite: the
 * Fool Pool multiplies Jester's Trick fifteenfold, and that is worth saying
 * out loud beside the enchantment as well as beside the pool.
 */
{
  const charms = [...records.values()].filter(one => one.kind === 'enchant');
  const file = path.join(XML, 'EnchantmentLists.xml');
  if (fs.existsSync(file)) {
    const raw = documents.get(path.basename(file));
    for (const m of raw.matchAll(
      /<EnchantmentList\s+type="([^"]*)"\s+id="([^"]+)">([\s\S]*?)<\/EnchantmentList>/g)) {
      const pool = 'pool:' + m[2];
      if (!records.has(pool)) continue;
      const takes = new Set(), refuses = new Set();
      for (const rule of m[3].matchAll(/<EnchantmentEntryLabel\s+([^>]*)\/>/g)) {
        const yes = /includeLabelsOR="([^"]+)"/.exec(rule[1]);
        const no = /excludeLabelsOR="([^"]+)"/.exec(rule[1]);
        for (const label of (yes ? yes[1] : '').split(',')) if (label) takes.add(label);
        for (const label of (no ? no[1] : '').split(',')) if (label) refuses.add(label);
      }
      /*
       * Counted, not listed. Nine hundred rollable enchantments against
       * fifty-five pools is forty-eight thousand edges saying the same dull
       * thing, and it doubled the file; how many pools can give you this is
       * the fact worth having, and the two that name it are below.
       */
      if (takes.size) {
        for (const charm of charms) {
          const labels = charm.labels || [];
          if (!labels.some(label => takes.has(label))) continue;
          if (labels.some(label => refuses.has(label))) continue;
          charm.pools = (charm.pools || 0) + 1;
        }
      }
      for (const named of m[3].matchAll(/<ModifyEnchantmentWeight\s+id="([^"]+)"[^>]*mult="([^"]+)"/g)) {
        const charm = charms.find(one => one.alias === named[1] || one.name === named[1]);
        if (!charm) continue;
        tie(charm.id, Number(named[2]) >= 1 ? 'favoured by' : 'held back by', pool);
      }
    }
  }
}

/*
 * And which item wakes which enchantment. Fifty-one enchantments are awakened
 * ones, each belonging to a particular piece of gear, and an enchantment card
 * that did not say which was asking the reader to already know.
 */
{
  const charms = new Map();
  const bare = name => name.replace(/ \(Neo\)$/, '');
  for (const one of records.values()) {
    if (one.kind !== 'enchant') continue;
    if (!charms.has(one.name)) charms.set(one.name, one);
    if (!charms.has(bare(one.name))) charms.set(bare(one.name), one);
  }
  for (const [item, waking] of offered.awakens) {
    const mine = records.get('item:' + item);
    if (!mine) continue;
    for (const name of waking) {
      const charm = charms.get(name) || charms.get(bare(name));
      if (charm) tie(mine.id, 'wakes', charm.id);
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
    /*
     * A biome is a stretch of ground, and one realm holds several stretches of
     * the same one - five separate patches of Low Forest, three of Dead
     * Church. The atlas keeps them apart because they are in different places
     * on the map; the index should not, because "Low Forest" is one kind of
     * place and five chips reading Low Forest are five ways of saying it. The
     * patches are added up into one, and everything that lives in any of them
     * lives in it.
     */
    const together = new Map();
    for (const biome of said.biomes || []) {
      // "Zone N" is an intermediate atlas label for a patch whose real name
      // is resolved later. Older atlas files retained that stale snapshot;
      // it is not a location and must never become an Index record.
      if (/^Zone \d+$/.test(biome.name || '')) continue;
      const had = together.get(biome.name);
      if (had) {
        had.tiles += biome.tiles || 0;
        had.patches++;
        for (const lives of biome.lives || []) had.lives.push(lives);
        continue;
      }
      together.set(biome.name, {
        name: biome.name, ground: biome.ground, tiles: biome.tiles || 0,
        patches: 1, lives: [...(biome.lives || [])]
      });
    }
    for (const biome of together.values()) {
      const record = put('place', biome.name, null, {
        tiles: biome.tiles,
        patches: biome.patches > 1 ? biome.patches : undefined,
        ground: biome.ground,
        from: [fileNumber('the realm as it was walked'), '']
      });
      for (const lives of biome.lives) {
        const got = byType.get(lives.type);
        /*
         * An invasion is not a home. The realm was walked while the aliens
         * were landing, so thirteen of their creatures were written down in
         * every biome the walk passed through - and a card saying an Alien
         * Soldier is seen in the Coral Reef, the Dead Church and five other
         * places is describing the day of the walk, not the creature. They
         * carry the invasion's own label and keep that instead.
         */
        if (got && /_INVASION_/.test(labelsOf(got.body).join(','))) continue;
        /*
         * "Was seen in", not "lives in". The list comes from walking the realm
         * and writing down what was standing there, so an event's creatures
         * are recorded wherever the event happened to be - which reads as a
         * home it does not have.
         */
        if (got) tie('enemy:' + nameOf(got), 'was seen in', record.id);
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

/* ---------------- what each slot is a slot for ---------------- */
/*
 * A class card used to list every item the class may hold - four hundred of
 * them for an Archer, which answers a question nobody asked. What it wants to
 * say is Bow, Quiver, Leather armour, Ring.
 *
 * The client does not name its slots, but its tiered gear does: every tiered
 * item in slot three carries BOW, every one in slot fifteen carries QUIVER. So
 * the name of a slot is the label its tiered items agree on, and its picture
 * is the plainest of them - the tier nought, which is the one a class is
 * handed on the day it is made.
 */
{
  const SKIP = /^(EQUIPMENT|TIERED|LOOTABLE|TRADEABLE|SOULBOUND|XPBONUS|SHINY|RESKIN|BASETYPE|ROLLABLE|MPCOST|STAT|STATMOD|SINGLESTAT|DUALSTAT|QUEST|PROC|CONSUMABLE|UT|ST|WEAPON|ABILITY|ARMOR|T\d+|POWERTIER_.*|ORG_.*|TAB_.*|STGEN.*|SET.*|HAS_.*|NUMPROJ.*|APPLY_STAT_EFF|CAUSE_STAT_EFF|COOLDOWN|SUMMONPOWERED|.*_ENCHANTABLE)$/;
  const SAY = { LEATHER: 'Leather armour', HEAVY: 'Heavy armour', ROBE: 'Robe' };
  const wanted = new Set();
  for (const kind of classes) for (const slot of kind.record.slots || []) wanted.add(slot);
  const table = {};
  for (const slot of wanted) {
    const here = gear.filter(x => x.slot === slot && x.record.tier !== undefined);
    if (!here.length) continue;
    const tally = new Map();
    for (const it of here) {
      for (const label of it.record.labels || []) {
        if (SKIP.test(label)) continue;
        tally.set(label, (tally.get(label) || 0) + 1);
      }
    }
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    /* The plainest real one: slot one's lowest tier is a test sword. */
    const honest = here.filter(x => !x.record.hidden);
    const plainest = (honest.length ? honest : here).reduce((low, x) =>
      (low === null || x.record.tier < low.record.tier) ? x : low, null);
    table[slot] = [SAY[best[0]]
      || best[0].charAt(0) + best[0].slice(1).toLowerCase(), plainest.record.id];
  }
  slotNames = table;
}

/* ---------------- one thing, however many times the client says it ---------------- */
/*
 * Three thousand rows of the same object.
 *
 * The client declares a stack size as its own object, so Amethyst Shard is
 * eleven declarations, Ancient Fossil is fifteen, and a reader scrolling the
 * index met ten Forgotten Tomes in a row before reaching anything new. Same
 * again for the soulbound copy of a thing that also drops tradeable, and for
 * the lettered placeholders a set uses - 2KenseiST2A through Q, which say
 * nothing at all beyond their own name.
 *
 * Nothing is thrown away. Every declaration keeps its record, its client id
 * and its number, because "which of these is the one in my bag" is a question
 * this index exists to answer. One of them carries the row and the rest are
 * folded into it and listed on its card; the page hides a folded row while
 * you browse and hands it back the moment you search for it by name.
 *
 * Where a tool offers one of them, that one carries the row. The calculator
 * knows an Agents of Oryx Shard x15 by exactly that name, and folding it into
 * a stack of one would have hidden the only door to it.
 */
{
  const held = [...records.values()];
  const offers = one => Boolean(one.bench || one.ench);
  const foldStats = {};
  let foldGroups = 0;
  const identity = new Set(['id', 'name', 'said', 'alias', 'from', 'also',
    'twin', 'folded', 'folds', 'art', 'benchArt', 'benchPic', 'pic', 'in',
    'out', 'clientId', 'bench', 'ench', 'fight']);
  /*
   * The one that keeps the row. A catalogue member wins first; otherwise a
   * visible, playable creature wins over an invisible helper carrying the
   * same DisplayId. The final terms make the choice deterministic.
   */
  const pick = here => [...here].sort((a, b) => {
    const score = one => (offers(one) ? 10000 : 0) + (one.fight ? 5000 : 0)
      + (!one.hidden ? 1000 : 0) + (!one.spawns ? 500 : 0)
      + (!one.alias ? 100 : 0) + (one.hp !== undefined ? 20 : 0)
      + ((one.labels || []).includes('BOSS') ? 10 : 0);
    return score(b) - score(a) || a.id.localeCompare(b.id);
  })[0];
  function fold(here, say, why, rule) {
    here = [...new Set(here)].filter(one => one && !one.folded);
    const into = pick(here);
    if (here.length < 2 || !into) return false;
    /*
     * Facts that vary stay visible on the common card. The full record also
     * remains addressable through an exact working-id search, but the summary
     * must not pretend that a 1,100-life historical Lich and its 300,000-life
     * replacement are numerically identical.
     */
    const fields = new Set(here.flatMap(one => Object.keys(one)));
    const varied = [...fields].filter(key => !identity.has(key)
      && new Set(here.map(one => JSON.stringify(one[key]))).size > 1);
    const label = { hp: 'life', def: 'armour', slot: 'slot', tier: 'tier',
      labels: 'labels', hidden: 'warnings', about: 'description', fires: 'shot',
      worn: 'bonuses', does: 'effects', spawns: 'spawner', came: 'invasion' };
    const brief = (key, value) => {
      if (value === undefined) return (label[key] || key) + ': none';
      if (typeof value === 'number') return (label[key] || key) + ': ' + value.toLocaleString('en-US');
      if (typeof value === 'string' || typeof value === 'boolean') {
        return (label[key] || key) + ': ' + String(value);
      }
      if (key === 'labels' || key === 'hidden') return (label[key] || key) + ': ' + value.join(', ');
      return (label[key] || key) + ' differ';
    };
    /* Named before the survivor is renamed, or it loses its own label. A
       representative may already carry a smaller family; expand it here so
       the final card lists every original declaration, not intermediate rows. */
    into.folds = here.flatMap(one => one.folds?.length ? one.folds : [{
      as: one.said || one.name,
      was: one.alias || undefined, from: one.from,
      why: typeof why === 'function' ? why(one) : undefined,
      diff: varied.length ? varied.slice(0, 5).map(key => brief(key, one[key])).join('; ') : undefined
    }]);
    into.said = say;
    for (const one of here) if (one !== into && !one.folded) one.folded = into.id;
    foldGroups++;
    foldStats[rule] = (foldStats[rule] || 0) + here.length - 1;
    return true;
  }

  /*
   * A stack size: "Amethyst Shard x1" and "Amethyst Shard x 10" are one
   * thing. Some newer artifacts hide the quantity in the working id while
   * giving every stack the same DisplayId (Permafrost Snowflake and Ivory
   * Heart); both names therefore participate.
   */
  const stacks = new Map();
  for (const one of held) {
    if (one.kind !== 'item' || one.folded) continue;
    const m = [one.name, one.alias].filter(Boolean)
      .map(name => /^(.*[^\s])\s*x\s*(\d+)$/i.exec(name)).find(Boolean);
    if (!m) continue;
    const key = one.kind + '|' + m[1];
    if (!stacks.has(key)) stacks.set(key, []);
    stacks.get(key).push(one);
    one.many = Number(m[2]);
  }
  for (const [key, here] of stacks) {
    const base = key.split('|').slice(1).join('|');
    for (const one of held) {
      if (one.kind === 'item' && !one.folded && one.name === base && !here.includes(one)) {
        here.push(one);
      }
    }
    here.sort((a, b) => a.many - b.many);
    fold(here, base, one => one.many ? 'a stack of ' + one.many : 'one of them', 'stack');
    for (const one of here) delete one.many;
  }

  const named = new Map(held.filter(r => !r.folded).map(r => [r.kind + '|' + r.name, r]));

  /*
   * The soulbound copy of a thing that also drops tradeable. Only where the
   * client says the same about both: same slot, same tier, same description.
   */
  for (const one of held) {
    const m = /^(.+?)\s*\(SB\)$/.exec(one.name);
    if (!m || one.folded) continue;
    const plain = named.get(one.kind + '|' + m[1]);
    if (!plain || plain.folded || plain.slot !== one.slot || plain.tier !== one.tier) continue;
    if ((plain.about || '') !== (one.about || '')) continue;
    fold([plain, one], m[1],
      x => (x === one ? 'the soulbound copy' : 'the tradeable one'), 'soulbound copy');
  }

  /*
   * A letter on the end of a working name - but only where the client says
   * exactly the same thing about every one of them.
   *
   * 2KenseiST2A through Q looked like eleven copies of one ability and are
   * two: five that fire one shot and six that fire another. SulfW Ring A
   * through E look the same and are five different rings. So the names are
   * only the invitation; what folds them is the client agreeing, field for
   * field, that they are the same thing.
   */
  const same = one => JSON.stringify(Object.fromEntries(Object.entries(one)
    .filter(([key]) => !identity.has(key)).sort(([a], [b]) => a.localeCompare(b))));
  const letters = new Map();
  for (const one of held) {
    if (one.folded) continue;
    const m = /^(.{4,}[a-z0-9])([A-Z])$/.exec(one.name);
    if (!m) continue;
    const key = one.kind + '|' + m[1] + '|' + same(one);
    if (!letters.has(key)) letters.set(key, { base: m[1], here: [] });
    letters.get(key).here.push(one);
  }
  for (const { base, here } of letters.values()) {
    fold(here, base.trimEnd(), one => 'variant ' + one.name.slice(base.length),
      'lettered variant');
  }

  /*
   * The same DisplayId is one browse entry.
   *
   * The client routinely gives helpers, difficulty variants and historical
   * copies the same player-facing name: six Adult Basilisks, forty Shatters
   * waypoints called Magi Conductor, nineteen definitions called Oryx the Mad
   * God. They are still separate records and exact working-id searches still
   * reveal them, but repeating the same row is not useful navigation. Every
   * working id and source remains listed on the common card.
   */
  const displayed = new Map();
  for (const one of held) {
    if (one.folded) continue;
    const key = one.kind + '|' + one.name;
    if (!displayed.has(key)) displayed.set(key, []);
    displayed.get(key).push(one);
  }
  for (const here of displayed.values()) {
    fold(here, here[0].name,
      one => one.alias ? 'client id ' + one.alias : 'the plain client id',
      'same display name');
  }

  /* Capitalisation and punctuation are not separate identities. This catches
     client typos such as "Mk II"/"Mk.II" and SHamrock without erasing either
     working id. */
  const spellings = new Map();
  const spelling = name => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const one of held) {
    if (one.folded) continue;
    const key = one.kind + '|' + spelling(one.name);
    if (!spellings.has(key)) spellings.set(key, []);
    spellings.get(key).push(one);
  }
  for (const here of spellings.values()) {
    if (new Set(here.map(one => one.name)).size < 2) continue;
    fold(here, here[0].name.replace(/^\+/, ''),
      one => 'spelled in the client as ' + one.name, 'spelling variant');
  }

  /*
   * Internal effect pieces are often lettered or numbered only to address a
   * different projectile. They are already marked as hidden machinery, and
   * a common entry with the varying shot called out is more useful than five
   * consecutive 2ArcherST1 rows. The restriction to hidden item machinery
   * deliberately leaves real lettered gear (the five SulfW rings) separate.
   *
   * A few enemy-side controllers use the same scheme without a hidden flag:
   * MV Regular Loot 0..4, beam points, helpers and tiered snowman shells. The
   * technical noun is required so Oryx the Mad God 1/2/3 cannot be folded by
   * this broader rule.
   */
  const technical = new Map();
  for (const one of held) {
    if (one.folded) continue;
    const itemMachine = one.kind === 'item' && (one.hidden?.some(reason =>
      /effect|machinery|test/i.test(reason))
      || (one.hidden?.length && /\b(?:Subattack|Projectile|Proc|Shot|Effect)\b/i.test(one.name))
      || /^\d+[A-Za-z]+ST\d+[A-Z]$/.test(one.name));
    const enemyMachine = one.kind === 'enemy'
      && /\b(?:Loot|Point|Helper|Wall|Beam|Spawner|Initiator|Object|Segment|Switch|Tier|Guill)\b/i.test(one.name);
    if (!itemMachine && !enemyMachine) continue;
    const m = /^(.*?)(?:\s+(\d+)|([A-Z]))$/.exec(one.name);
    if (!m || m[1].length < 4) continue;
    const key = one.kind + '|' + m[1];
    if (!technical.has(key)) technical.set(key, { base: m[1], here: [] });
    technical.get(key).here.push(one);
  }
  for (const { base, here } of technical.values()) {
    const plain = held.find(one => !one.folded && one.kind === here[0]?.kind && one.name === base);
    if (plain && !here.includes(plain)) here.push(plain);
    if (here.length < 2) continue;
    fold(here, base, one => 'technical variant ' + one.name.slice(base.length).trim(),
      'technical variant');
  }

  /* A duplicate plain DisplayId can make the early (SB) lookup ambiguous.
     Once same-name copies are common entries, join any remaining pair. */
  for (const one of held) {
    if (one.folded) continue;
    const m = /^(.+?)\s*\(SB\)$/.exec(one.name);
    if (!m) continue;
    const plain = held.find(x => !x.folded && x.kind === one.kind && x.name === m[1]
      && x.slot === one.slot && x.tier === one.tier && (x.about || '') === (one.about || ''));
    if (plain) fold([plain, one], m[1], x => x === one
      ? 'the soulbound copy' : 'the tradeable one', 'soulbound copy');
  }

  /*
   * Names that differ only by a mechanical counter or by New/Actual are
   * joined when every indexed fact agrees. This catches Broken Heart 1..8,
   * old/new realm heroes and similar families without combining meaningful
   * numbered tiers or different Oryx incarnations.
   */
  function foldByShape(shape, rule, why) {
    const groups = new Map();
    for (const one of held) {
      if (one.folded) continue;
      const base = shape(one.name);
      if (!base || base === one.name) continue;
      const key = one.kind + '|' + base + '|' + same(one);
      if (!groups.has(key)) groups.set(key, { base, here: [] });
      groups.get(key).here.push(one);
      const plain = held.find(x => !x.folded && x.kind === one.kind
        && x.name === base && same(x) === same(one));
      if (plain && !groups.get(key).here.includes(plain)) groups.get(key).here.push(plain);
    }
    for (const { base, here } of groups.values()) fold(here, base, why(base), rule);
  }
  foldByShape(name => /\s+\d+$/.test(name) ? name.replace(/\s+\d+$/, '') : '',
    'numbered variant', base => one => one.name === base
      ? 'the unnumbered form' : 'variant ' + one.name.slice(base.length).trim());
  /* New/Actual marks an edition of an enemy even when its life or contextual
     label changed. Those differences are retained in `diff` on the card. */
  const editions = new Map();
  const editionBase = name => {
    const base = name.replace(/^(?:New\s+Actual|Actual|New)\s+/i, '')
      .replace(/\s+(?:New\s+Actual|Actual|New)$/i, '')
      .replace(/\s+\((?:New\s+Actual|Actual|New|(?:New\s+)?MV Event)\)$/i, '');
    return base === name ? '' : base;
  };
  for (const one of held) {
    if (one.folded || one.kind !== 'enemy') continue;
    const base = editionBase(one.name);
    if (!base) continue;
    const key = one.kind + '|' + base;
    if (!editions.has(key)) editions.set(key, { base, here: [] });
    editions.get(key).here.push(one);
    const plain = held.find(x => !x.folded && x.kind === one.kind && x.name === base);
    if (plain && !editions.get(key).here.includes(plain)) editions.get(key).here.push(plain);
  }
  for (const { base, here } of editions.values()) {
    fold(here, base, one => {
      const words = one.name.replace(base, '').replace(/[()]/g, '').trim();
      return words ? words + ' edition' : 'the plain edition';
    }, 'edition variant');
  }

  /* A progression prefix changes the unlocked appearance, not the item kind. */
  const progressions = new Map();
  for (const one of held) {
    if (one.folded || one.kind !== 'item' || one.family !== 'gravestone') continue;
    const m = /^(Level\s+\d+(?:-\d+)?|\d+\/\d+)\s+(.+?\s+Unlocker)$/i.exec(one.name);
    if (!m) continue;
    const key = one.kind + '|' + m[2] + '|' + same(one);
    if (!progressions.has(key)) progressions.set(key, { base: m[2], here: [] });
    progressions.get(key).here.push(one);
  }
  for (const { base, here } of progressions.values()) {
    fold(here, base, one => one.name.slice(0, -base.length).trim(),
      'progression variant');
  }

  /* Every hidden declaration points straight to the final common entry. */
  for (const one of held) {
    if (!one.folded) continue;
    const seen = new Set([one.id]);
    let into = records.get(one.folded);
    while (into?.folded && !seen.has(into.id)) {
      seen.add(into.id);
      into = records.get(into.folded);
    }
    if (!into || seen.has(into.id)) throw new Error('Invalid fold chain at ' + one.id);
    one.folded = into.id;
  }

  const folded = held.filter(r => r.folded).length;
  console.log('  ' + folded.toLocaleString('en-US')
    + ' further declarations folded into the thing they are a copy of');
  console.log('  ' + foldGroups.toLocaleString('en-US') + ' common entries: '
    + Object.entries(foldStats).map(([rule, count]) => count + ' ' + rule).join(', '));
  records.folding = { groups: foldGroups, declarations: folded, byRule: foldStats };
}

const theoryView = require('./index-model').attach(records, mechanics, objects);

/* ---------------- the links, from both ends ---------------- */
const out = new Map(), back = new Map();
/*
 * Said once. Merging the five patches of Low Forest into one place made every
 * creature that lives in two of them say so twice, and a card that lists the
 * same neighbour five times is a card nobody reads to the end.
 */
const already = new Set();
for (const one of links) {
  if (!records.has(one.from) || !records.has(one.to)) continue;
  const said = JSON.stringify([one.from, one.how, one.to]);
  if (already.has(said)) continue;
  already.add(said);
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
const result = {
  ...meta,
  views: { theory: theoryView },
  catalogues,
  files: fileList,
  kinds: all.reduce((tally, one) => {
    tally[one.kind] = (tally[one.kind] || 0) + 1;
    return tally;
  }, {}),
  folding: records.folding,
  links: links.length,
  slots: slotNames,
  records: all
};
const priorFile = path.join(OUT, 'index.json');
if (process.argv.includes('--sprites')) {
  const assets = new Map();
  const readAsset = name => {
    if (!assets.has(name)) {
      const file = path.join(XML, name);
      assets.set(name, fs.existsSync(file) ? fs.readFileSync(file) : null);
    }
    return assets.get(name);
  };
  if (!readAsset('spritesheet.bin')) throw new Error('Sprite registry missing; extract client textures first.');
  require('./index-sprites')({root, documents, readAsset, facts: result});
  const theory = require('./index-model').project(result);
  require('./theory-sprites')({root, documents, readAsset, facts: theory});
  require('./index-model').artwork(result, theory);
} else if (fs.existsSync(priorFile)) {
  const prior = JSON.parse(fs.readFileSync(priorFile, 'utf8'));
  const had = new Map(prior.records.map(r => [r.id, r]));
  for (const r of result.records) {
    const before = had.get(r.id);
    if (!before) continue;
    for (const field of ['art', 'benchArt', 'benchPic']) if (before[field] !== undefined) r[field] = before[field];
  }
  if (prior.sheet) result.sheet = prior.sheet;
  if (prior.theorySheet) result.theorySheet = prior.theorySheet;
}
fs.writeFileSync(priorFile, JSON.stringify(result) + '\n');

fs.mkdirSync(SERVED, { recursive: true });
fs.copyFileSync(path.join(OUT, 'index.json'), path.join(SERVED, 'index.json'));

/* And the light list, which is what a search box needs and nothing more. */
fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify({ ...meta, records: all.map(one => [
  one.id, one.said || one.name, one.kind, one.alias || '', one.hidden ? 1 : 0
]) }) + '\n');

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
