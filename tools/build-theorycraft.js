/*
 * What a build is made of, taken out of the installed client.
 *
 * Theory crafting is arithmetic on numbers somebody else chose, so the whole
 * job of this file is to find those numbers and write them down without
 * touching them. Four things are needed and the client states all four:
 *
 *   the classes      eight statistics apiece, each with the value the class
 *                    starts on and the value it can never pass, plus what one
 *                    level is worth of each. Level twenty is arithmetic.
 *
 *   the equipment     every weapon, ability, armour and ring: what it does
 *                    for you just for being worn, and the projectile it
 *                    throws - how much it hurts, how fast it flies, how long
 *                    it lives, how many go at once and how wide they fan.
 *
 *   the enchantments  a thousand of them, each with its effect written as a
 *                    mutator rather than as prose: "amount 1.4, stat ATT".
 *                    Which items each can go on is stated too, as labels the
 *                    item must and must not carry.
 *
 *   something to hit  every enemy worth calling a boss, with the hit points
 *                    and the armour it actually has.
 *
 * Nothing is derived here beyond reading the file. The formulas that turn a
 * statistic into a rate live in the page, written out where they can be
 * argued with.
 *
 *   node tools/build-theorycraft.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const XML = path.join(root, 'client-data');
const OUT = path.join(root, 'data', 'TheoryCraft');

if (!fs.existsSync(XML)) {
  console.error('\n  client-data is missing. Run: npm run scrape\n');
  process.exit(1);
}

/* ---------------- the object files, once ---------------- */
const objectText = fs.readdirSync(XML)
  .filter(name => /^Objects\.\d+\.xml$/.test(name))
  .sort()
  .map(name => fs.readFileSync(path.join(XML, name), 'utf8'));

const SHAPE = /<Object\s+type="([^"]+)"\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/Object>/g;
const byType = new Map();
const byName = new Map();
for (const text of objectText) {
  for (const m of text.matchAll(SHAPE)) {
    const type = Number.parseInt(m[1], 16);
    if (!Number.isFinite(type)) continue;
    const one = { type, id: m[2], body: m[3] };
    byType.set(type, one);
    if (!byName.has(m[2])) byName.set(m[2], one);
  }
}

/* A number out of a tag, whether or not the tag carries attributes. */
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
  return m ? m[1].trim() : undefined;
};

/*
 * The shot an item throws.
 *
 * Speed is given in tenths of a tile a second and life in milliseconds, so
 * the range is the two multiplied - which is how a Short Sword comes out at
 * three and a half tiles and an Energy Staff at eight and a half.
 */
function shotOf(body) {
  const out = [];
  for (const m of body.matchAll(/<Projectile\b[^>]*>([\s\S]*?)<\/Projectile>/g)) {
    const inner = m[1];
    const low = num(inner, 'MinDamage'), high = num(inner, 'MaxDamage');
    const flat = num(inner, 'Damage');
    const fast = num(inner, 'Speed'), lives = num(inner, 'LifetimeMS');
    if (low === undefined && high === undefined && flat === undefined) continue;
    out.push({
      low: low === undefined ? (high === undefined ? flat : high) : low,
      high: high === undefined ? (low === undefined ? flat : low) : high,
      fast: fast === undefined ? undefined : fast / 10,
      reach: (fast !== undefined && lives !== undefined)
        ? Math.round(fast * lives / 1000) / 10 : undefined,
      pierce: /<ArmorPiercing\s*\/>/.test(inner) || undefined,
      through: /<MultiHit\s*\/>/.test(inner) || undefined
    });
  }
  return out.length ? out : undefined;
}

/* What a piece of gear, or an enchantment, is worth for being worn. */
function wornOf(body) {
  const out = {};
  for (const m of body.matchAll(
    /<ActivateOnEquip\s+([^>]*)>\s*IncrementStat\s*</g)) {
    const attrs = m[1];
    const stat = /stat="([^"]+)"/.exec(attrs);
    const amount = /amount="([^"]+)"/.exec(attrs);
    if (!stat || !amount) continue;
    const n = Number(amount[1]);
    if (!Number.isFinite(n)) continue;
    out[stat[1]] = (out[stat[1]] || 0) + n;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ---------------- the six classes ---------------- */
const GROWN = {
  MaxHitPoints: 'hp', MaxMagicPoints: 'mp', Attack: 'att', Defense: 'def',
  Speed: 'spd', Dexterity: 'dex', HpRegen: 'vit', MpRegen: 'wis'
};
const classes = [];
for (const [, one] of byType) {
  if (!/<Player\s*\/>/.test(one.body)) continue;
  const grow = {};
  for (const m of one.body.matchAll(
    /<LevelIncrease\s+min="(-?\d+)"\s+max="(-?\d+)"\s*>(\w+)<\/LevelIncrease>/g)) {
    const key = GROWN[m[3]];
    if (key) grow[key] = (Number(m[1]) + Number(m[2])) / 2;
  }
  const gear = text(one.body, 'Equipment') || '';
  const slots = (text(one.body, 'SlotTypes') || '').split(',')
    .map(x => Number(x.trim())).filter(n => n > 0);
  classes.push({
    name: one.id,
    about: text(one.body, 'Description'),
    hp: num(one.body, 'MaxHitPoints'), hpTop: num(one.body, 'MaxHitPoints', 'max'),
    mp: num(one.body, 'MaxMagicPoints'), mpTop: num(one.body, 'MaxMagicPoints', 'max'),
    att: num(one.body, 'Attack'), attTop: num(one.body, 'Attack', 'max'),
    def: num(one.body, 'Defense'), defTop: num(one.body, 'Defense', 'max'),
    spd: num(one.body, 'Speed'), spdTop: num(one.body, 'Speed', 'max'),
    dex: num(one.body, 'Dexterity'), dexTop: num(one.body, 'Dexterity', 'max'),
    vit: num(one.body, 'HpRegen'), vitTop: num(one.body, 'HpRegen', 'max'),
    wis: num(one.body, 'MpRegen'), wisTop: num(one.body, 'MpRegen', 'max'),
    grow,
    slots: slots.slice(0, 4),
    /*
     * The starting kit, by position rather than by what happens to be there.
     * The list is weapon, ability, armour, ring, and then the pack - and a
     * class with no starting ring writes minus one in that place. Dropping
     * the empties first slid the health potion out of the pack and onto the
     * ring finger.
     */
    kit: gear.split(',').slice(0, 4).map(x => {
      const t = Number.parseInt(x.trim(), 16);
      return (Number.isFinite(t) && t > 0 && (byType.get(t) || {}).id) || null;
    })
  });
}
classes.sort((a, b) => a.name.localeCompare(b.name));

/*
 * Which of the four hands a slot number belongs to.
 *
 * The client numbers slots rather than naming them, and the numbering is by
 * kind of item - a staff is seventeen, a wand is eight - so the four groups
 * are read off the classes themselves: whatever slot a class's first hand
 * takes is a weapon slot, its second an ability, and so on. That way a new
 * kind of weapon in a future update lands in the right place without this
 * file being edited.
 */
const HANDS = ['weapon', 'ability', 'armor', 'ring'];
const handOf = new Map();
for (const one of classes) {
  one.slots.forEach((slot, i) => { if (HANDS[i]) handOf.set(slot, HANDS[i]); });
}

/* ---------------- everything wearable ---------------- */
const items = [];
for (const [, one] of byType) {
  if (!/<Item\s*\/>/.test(one.body)) continue;
  const slot = num(one.body, 'SlotType');
  const hand = handOf.get(slot);
  if (!hand) continue;                       // a potion, a key, an egg
  const labels = text(one.body, 'Labels') || '';
  /*
   * Real gear only. The client keeps a developer's toolbox in the same files
   * - an Admin Staff that hits for two thousand, a Test Ring worth ninety-nine
   * thousand life - and it marks the difference: everything a player can
   * actually hold carries the EQUIPMENT label and the toolbox carries none of
   * it. Left in, the calculator's answer to every question was the toolbox.
   */
  if (!labels.split(',').includes('EQUIPMENT')) continue;
  items.push({
    name: one.id,
    hand,
    slot,
    tier: num(one.body, 'Tier'),
    bag: num(one.body, 'BagType'),
    mp: num(one.body, 'MpCost'),
    rate: num(one.body, 'RateOfFire'),
    many: num(one.body, 'NumProjectiles'),
    fan: num(one.body, 'ArcGap'),
    worn: wornOf(one.body),
    shots: shotOf(one.body),
    // What the ability actually does, when it is not simply a projectile.
    does: text(one.body, 'Activate'),
    set: text(one.body, 'SetName'),
    labels: labels || undefined
  });
}
items.sort((a, b) => a.hand.localeCompare(b.hand)
  || (a.tier === undefined ? 99 : a.tier) - (b.tier === undefined ? 99 : b.tier)
  || a.name.localeCompare(b.name));

/* ---------------- the enchantments ---------------- */
const enchantText = fs.readFileSync(path.join(XML, 'Enchantments.xml'), 'utf8');
const enchants = [];
for (const m of enchantText.matchAll(
  /<Enchantment id="([^"]+)"[^>]*>([\s\S]*?)<\/Enchantment>/g)) {
  const body = m[2];
  const mut = /<Mutators>([\s\S]*?)<\/Mutators>/.exec(body);
  const inner = mut ? mut[1] : '';
  const fits = text(body, 'CompatibleWithItemLabels');
  const notFits = text(body, 'IncompatibleWithItemLabels');
  const notWith = text(body, 'IncompatibleWithEnchantmentLabels');
  const notOn = text(body, 'IncompatibleWithItemIds');
  enchants.push({
    id: m[1],
    name: text(body, 'DisplayId') || m[1],
    says: text(body, 'Description'),
    labels: text(body, 'EnchantmentLabels') || undefined,
    fits: fits || undefined,
    notFits: notFits || undefined,
    notWith: notWith || undefined,
    notOn: notOn || undefined,
    weight: num(body, 'Weight'),
    worn: wornOf(inner),
    /*
     * Some of them do not raise a statistic at all: they change the shot, or
     * hang something off a hit. Those are carried as the raw name of what
     * they do, so the page can show them and say plainly that it is not
     * counting them rather than counting them wrongly.
     */
    alters: [...new Set([...inner.matchAll(/<(\w+)[\s>]/g)]
      .map(one => one[1]).filter(one => one !== 'ActivateOnEquip'))]
      .join(',') || undefined
  });
}
enchants.sort((a, b) => a.name.localeCompare(b.name));

/* ---------------- the sets ---------------- */
/*
 * A set is four named pieces and a run of bonuses that come in as you wear
 * more of them. The client gives the bonuses per threshold - two pieces,
 * three, all four - each as the same IncrementStat mutator everything else
 * uses, so they cost nothing extra to understand.
 */
const sets = [];
{
  const file = path.join(XML, 'EquipmentSets.xml');
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    for (const m of raw.matchAll(
      /<EquipmentSet\s+type="[^"]*"\s+id="([^"]+)">([\s\S]*?)<\/EquipmentSet>/g)) {
      const body = m[2];
      const pieces = [...body.matchAll(/<Setpiece\s+slot="(\d+)"\s+itemtype="([^"]+)"/g)]
        .map(one => (byType.get(Number.parseInt(one[2], 16)) || {}).id)
        .filter(Boolean);
      if (!pieces.length) continue;
      const steps = {};
      for (const [tag, howMany] of [['ActivateOnEquip2', 2], ['ActivateOnEquip3', 3],
        ['ActivateOnEquipAll', 4]]) {
        /*
         * Each threshold on its own. Splitting the body at a tag and keeping
         * everything after it swept the later thresholds into the earlier
         * ones, so two pieces claimed the bonus for four.
         */
        const found = [...body.matchAll(
          new RegExp('<' + tag + '\\s+([^>]*)>\\s*IncrementStat\\s*<', 'g'))];
        const worn = {};
        for (const one of found) {
          const stat = /stat="([^"]+)"/.exec(one[1]);
          const amount = /amount="([^"]+)"/.exec(one[1]);
          if (!stat || !amount) continue;
          const n = Number(amount[1]);
          if (Number.isFinite(n)) worn[stat[1]] = (worn[stat[1]] || 0) + n;
        }
        if (Object.keys(worn).length) steps[howMany] = worn;
      }
      if (!Object.keys(steps).length) continue;
      sets.push({ name: m[1], pieces: [...new Set(pieces)], steps });
    }
  }
}

/* ---------------- something to hit ---------------- */
const bosses = [];
for (const [, one] of byType) {
  if (!/<Enemy\s*\/>/.test(one.body)) continue;
  const hp = num(one.body, 'MaxHitPoints');
  if (!hp || hp < 1000) continue;
  /*
   * Only the two kinds of thing anybody builds against, and the client names
   * them itself rather than leaving it to be inferred: an ENCOUNTER is what
   * turns up in the realm, and a BOSS is what waits at the end of a dungeon.
   * Quest was the wrong question - it marks anything that counts towards one,
   * which is two and a half thousand things including every minion.
   */
  const labels = text(one.body, 'Labels') || '';
  const labelSet = labels.split(',').map(one => one.trim());
  if (!labelSet.includes('ENCOUNTER') && !labelSet.includes('BOSS')) continue;
  /*
   * And not the ones that come round once a year. This is the one filter here
   * the client does not make for me: it labels a snowball chest and a marble
   * colossus identically, so the seasons are recognised by name, which is
   * where the game itself puts the difference. Anything whose name has not
   * been resolved out of the localisation table goes too - a target called
   * "{cave.Golden_Oryx_Effigy}" is not a target anybody picked.
   */
  const shown = text(one.body, 'DisplayId') || one.id;
  if (/^[{]/.test(shown)) continue;
  if (/(^|[^a-z])(retro|snowball|present|chicken|bunny|carnival|party|beach bum|cupcake|effigy|lol|easter|santa|turkey|pumpkin|valentine|nostalgi)/i
    .test(shown)) continue;
  bosses.push({
    name: shown,
    // The portrait folder is filed under the object's own id, which is often
    // not the name the game shows - "Oryx the Mad God 2" against "Oryx".
    id: one.id,
    hp,
    def: num(one.body, 'Defense') || 0,
    god: /\bGOD\b/.test(labels) || undefined,
    hero: /\bHERO\b/.test(labels) || undefined,
    quest: /<Quest\s*\/>/.test(one.body) || undefined
  });
}
// One entry a name: a boss appears once per dungeon it is used in.
{
  const seen = new Map();
  for (const one of bosses) {
    const had = seen.get(one.name);
    if (!had || had.hp < one.hp) seen.set(one.name, one);
  }
  bosses.length = 0;
  bosses.push(...seen.values());
}
bosses.sort((a, b) => b.hp - a.hp);

/*
 * A picture for each of them, and for the things they will be hitting.
 *
 * Both already exist. The atlas cuts every class out of the client with its
 * whole run of poses - standing, walking and swinging, in each direction it
 * has one for - and the realm catalogue holds a portrait of every boss. So
 * this only has to write down where they are rather than cut anything again.
 */
{
  const atlas = path.join(root, 'web', 'assets', 'atlas', 'atlas.json');
  if (fs.existsSync(atlas)) {
    try {
      const said = JSON.parse(fs.readFileSync(atlas, 'utf8'));
      const art = new Map((said.folk || []).map(one => [one.name, one.sprite]));
      for (const one of classes) {
        const sprite = art.get(one.name);
        if (sprite) one.art = sprite;
      }
    } catch (e) { /* no atlas yet: the page draws a plain figure instead */ }
  }
}
{
  /*
   * A portrait for whatever has one. The site already carries a folder of
   * them, filed under the object's own id rather than the name the game
   * shows, so both are tried - and what has none is drawn as a plain shape
   * and says so in the list, rather than being hidden.
   */
  const index = path.join(root, 'web', 'assets', 'realm-monsters', 'index.json');
  if (fs.existsSync(index)) {
    try {
      const have = JSON.parse(fs.readFileSync(index, 'utf8'));
      /*
       * The atlas is the better source where it has one - it cuts the whole
       * run of poses, so the thing being hit can move - and the portrait
       * folder covers the rest.
       */
      const moving = new Map();
      const atlas = path.join(root, 'web', 'assets', 'atlas', 'atlas.json');
      if (fs.existsSync(atlas)) {
        const said = JSON.parse(fs.readFileSync(atlas, 'utf8'));
        for (const owner of [...(said.zones || []), ...(said.biomes || [])]) {
          for (const alive of owner.lives || []) {
            if (alive.sprite && !moving.has(alive.name)) moving.set(alive.name, alive.sprite);
          }
        }
      }
      for (const one of bosses) {
        const strip = moving.get(one.name) || moving.get(one.id);
        if (strip) { one.strip = strip; continue; }
        if (have[one.name]) one.art = one.name;
        else if (have[one.id]) one.art = one.id;
      }
    } catch (e) { /* no portraits: plain shapes it is */ }
  }
}

/* ---------------- write it ---------------- */
fs.mkdirSync(OUT, { recursive: true });
const out = { classes, items, enchants, sets, bosses };
const file = path.join(OUT, 'theorycraft.json');
fs.writeFileSync(file, JSON.stringify(out) + '\n');

const counted = hand => items.filter(one => one.hand === hand).length;
console.log('\n  ' + classes.length + ' classes'
  + '\n  ' + items.length + ' wearable things ('
  + HANDS.map(h => counted(h) + ' ' + h).join(', ') + ')'
  + '\n  ' + enchants.length + ' enchantments, '
  + enchants.filter(one => one.worn).length + ' of them a plain statistic'
  + '\n  ' + out.bosses.length + ' things worth hitting'
  + '\n  -> ' + path.relative(root, file)
  + '  (' + (fs.statSync(file).size / 1024).toFixed(0) + ' KB)\n');
