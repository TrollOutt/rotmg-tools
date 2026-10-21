'use strict';
/*
 * Everything the Pet Fame Calculator draws and counts, cut out of the client.
 *
 *   node tools/build-pet-fame.js
 *
 * Writes
 *   web/assets/pets/pets.png    every pet skin's frames, 32 pixels to a cell
 *   web/assets/pets/foods.png   every pet food, 16 pixels to a cell
 *   web/pet-fame-data.js        where each one is, and what it is worth
 *
 * It reads data/Pets/pets.json (tools/extract-pets.js) for the skins and the
 * client's own XML for the food, so a game update reaches the page the usual
 * way: extract the client, then run this. Gold prices of the shop food are
 * RealmEye's (data/Pets/realmeye-pets.json); the client does not carry them.
 */
const fs = require('fs');
const path = require('path');
const registry = require('./spritesheet');
const { readPng, writePng } = require('./png');

const root = path.join(__dirname, '..');
const XML = process.env.ROTMG_CLIENT_DATA || path.join(root, 'client-data');
const OUT = path.join(root, 'web', 'assets', 'pets');
const pets = require(path.join(root, 'data', 'Pets', 'pets.json'));
const realmeye = require(path.join(root, 'data', 'Pets', 'realmeye-pets.json'));

const sheet = registry.read(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const pngs = {};
const texture = name => pngs[name] || (pngs[name] = readPng(fs.readFileSync(path.join(XML, 'textures', name + '.png'))));

/* ---------------- pets: every frame of every skin ---------------- */
const CELL = 32, COLS = 64, MAX_FRAMES = 16;
const animated = new Map();
for (const f of sheet.animated) {
  const k = f.atlas + '#' + f.index;
  if (!animated.has(k)) animated.set(k, []);
  animated.get(k).push(f);
}
const hatchable = new Set(pets.pets.filter(p => !p.noHatchOrFuse).map(p => p.defaultSkin));
const petList = [];
let frames = 0;
for (const skin of pets.skins) {
  // One skin has no rarity or family: the client's 'Disabled Pet' placeholder, which nobody can own.
  if (!skin.rarity || !skin.family) continue;
  const all = animated.get(skin.animation.file + '#' + skin.animation.index) || [];
  if (!all.length) continue;
  // idle (0), walk (1), attack (2): every walk and attack frame, idle trimmed to what is left
  const pick = [];
  for (const action of [1, 2, 0]) {
    const group = all.filter(f => f.action === action);
    pick.push(...group.slice(0, action === 0 ? Math.max(1, MAX_FRAMES - pick.length) : 8));
  }
  const used = pick.slice(0, MAX_FRAMES);
  petList.push({
    n: skin.display, f: skin.family, r: skin.rarity, h: hatchable.has(skin.id) ? 1 : 0,
    c: frames, ht: Math.max(...used.map(f => f.rect.h)),
    a: used.map(f => f.action), fw: used.map(f => f.rect.w), frames: used
  });
  frames += used.length;
}
{
  const rows = Math.ceil(frames / COLS), W = COLS * CELL, H = rows * CELL, buf = Buffer.alloc(W * H * 4);
  const from = texture('characters');
  for (const p of petList) {
    p.frames.forEach((f, i) => {
      const k = p.c + i, ox = (k % COLS) * CELL, oy = Math.floor(k / COLS) * CELL + (CELL - f.rect.h);   // stood on the floor of its cell
      for (let y = 0; y < f.rect.h; y++) for (let x = 0; x < f.rect.w; x++) {
        const s = ((f.rect.y + y) * from.width + f.rect.x + x) * 4, d = ((oy + y) * W + ox + x) * 4;
        from.pixels.copy(buf, d, s, s + 4);
      }
    });
    delete p.frames;
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pets.png'), writePng(W, H, buf));
}

/* ---------------- food ---------------- */
const objects = [];
for (const name of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n)).sort()) {
  for (const m of fs.readFileSync(path.join(XML, name), 'utf8').matchAll(/<Object\s[^>]*?>[\s\S]*?<\/Object>/g)) objects.push(m[0]);
}
const tag = (o, n) => {
  const at = [o.indexOf('<' + n + '>'), o.indexOf('<' + n + ' ')].filter(x => x >= 0);
  if (!at.length) return undefined;
  const start = o.indexOf('>', Math.min(...at)) + 1, end = o.indexOf('</' + n + '>', start);
  return end < 0 ? undefined : o.slice(start, end);
};
const idOf = o => (o.match(/<Object[^>]*\bid="([^"]*)"/) || [])[1];
const still = new Map(sheet.still.map(a => [a.name, new Map(a.sprites.map(s => [s.index, s]))]));

/* Where a food comes from, from RealmEye's Pet Food page: the client says nothing about it. */
const OBTAIN = { 'Hot Sauce': 'Cinco De Mayo', 'Grilled Honey Comb': 'Summer BBQ', 'Honeyed Snake Skewer': 'Summer BBQ', "Vamp Steak Flambe'": 'Summer BBQ', 'Steamed Zombie Steak': 'Summer BBQ', Cranberries: 'Thanksgiving', 'Drowned Shamrock': "St Patrick's Day", 'Ear of Corn': 'Thanksgiving', 'Royal Marbled Chocolate': 'Summer BBQ', 'Snow Cone': 'Oryxmas', 'Enriched Bee Steak': 'Summer BBQ', 'Egg Omelette': 'The Tinkerer', 'Sliced Yam': 'Thanksgiving', 'Pumpkin Pie': 'Thanksgiving', 'Picante Taco': 'Cinco De Mayo', Cheese: 'Rat Extermination', 'Gingerbread House': 'Oryxmas', 'Power Pizza': 'The Appetizer', 'Candy Apple': 'Halloween', 'Caramel Apple': 'Halloween', 'Chaos Cake': 'MotMG', 'Chocolate Cream Sandwich Cookie': 'The Appetizer', 'Rainbow Gummy Worm': 'Halloween', 'Sugar Gummy Worm': 'Halloween', 'Napalm Taco': 'Cinco De Mayo', "The Appetizer's Spicy Power Pizza": 'Summer BBQ', 'Gold Bar': 'The Tinkerer', 'Oryx Cookie': 'MotMG', 'Thanksgiving Turkey': 'Thanksgiving', 'Christmas Tree Cupcake': 'Oryxmas', 'Droplet of Ambrosia': 'Login Seer', 'Droplet of Bloody Ambrosia': 'Halloween', 'Roast Biff': 'Easter', 'Grapes of Heaven': 'MotMG', 'Strawberry Milkshake': "Valentine's Day", Superburger: 'The Appetizer', "The Appetizer's Spicy Oryx Cookie": 'Summer BBQ', 'Vial of Pure Ambrosia': 'Login Seer', 'Vial of Bloody Ambrosia': 'Halloween', 'Christmas Turkey Leg': 'Oryxmas', 'Pumpkin Spice Latte': 'Autumn Season', 'Chocolate Bonbon': "Valentine's Day", 'Atomic Taco': 'Cinco De Mayo', 'Hot Cross Buns': 'Easter', 'Chalice of Ambrosia': 'Login Seer', 'Chalice of Bloody Ambrosia': 'Halloween', 'Mashed Potatoes': 'Thanksgiving', "The Appetizer's Spicy Superburger": 'Summer BBQ', 'Carrot Cake': 'Easter', 'Pecan Pie': 'Thanksgiving', Ambrosia: 'The Appetizer', 'Bloody Ambrosia': 'Halloween', 'Apple Pie': 'Thanksgiving', 'Glazed Apple': 'Oryxmas', Eyecicle: 'Halloween', 'Glowing Green Goo': 'MotMG', 'Dark Ambrosia': 'MotMG', 'Void Venom': 'MotMG', 'Sanctified Ambrosia': 'MotMG', Cornbread: 'Thanksgiving', 'Fairy Berry Treat': 'Druid Release', 'Mouthwatering Melon': 'Summer Mystery Box', 'Space Ration': 'Alien Invasion', 'Daeva Elixir': 'MotMG', 'Energy Potato': 'Mystery Box', 'Chocolate Bar': 'Halloween', 'Turkey Cake': 'Thanksgiving', 'Mossy Potato': 'Druid Release', 'Cosmic Spice': 'Alien Invasion', 'Heart-shaped Chocolate Box': '6 Chocolate Bonbons', 'Asteralis Root': 'Alien Invasion', 'Reindeer Food': 'Oryxmas Mystery Box', 'Woodland Protein Shake': 'Druid Release', 'Astral Jelly': 'Alien Invasion', 'Solar Energy Drink': 'MotMG Mystery Box', 'Grove Energy Drink': 'Druid Release', 'Solar Potato': 'Easter Mystery Box', 'Ancient Cozy Root': 'Druid Release', 'Xeno Heart': 'Alien Invasion' };
/* Ordinary gear that a pet is often fed anyway: not PetFood, but worth listing with its source. */
const GEAR = { 'Wine Cellar Incantation': 'Drop · tradable', 'Candy Ring': 'Candyland', 'Amber Encrusted Helmet': 'Ancient Ruins', 'Cloak of the Planewalker': 'Forge C', 'Mace of the Celestial Forest': 'Drop', 'Candy-Coated Armor': 'Forge B', 'Tome of Holy Protection': 'Forge A', 'MMace MMurderer': 'Trade', 'Omnipotence Ring': 'Forge SS', 'Greater Potion of Life': 'Drop', 'Potion of Life': 'Drop' };
const gold = realmeye.foodGold.items;
const foods = [], seen = new Set();
for (const o of objects) {
  const name = idOf(o);
  if (!name) continue;
  const isFood = /<PetFood\s*\/?>/.test(o);
  if (!isFood && !(name in GEAR)) continue;
  const stack = name.match(/^(.*) x(\d+)$/), base = stack ? stack[1] : name;
  if (seen.has(base) || (stack && stack[2] !== '1')) continue;
  const fp = Number(tag(o, 'feedPower'));
  // 'Feed' is the client's own debug item (50,000 FP), and the admin and test items are not food.
  if (!fp || /admin|test/i.test(name) || name === 'Feed') continue;
  const t = tag(o, 'Texture') || tag(o, 'AnimatedTexture');
  if (!t) continue;
  const sprite = still.get(tag(t, 'File')) && still.get(tag(t, 'File')).get(parseInt(tag(t, 'Index')));
  if (!sprite) continue;
  seen.add(base);
  const display = tag(o, 'DisplayId');
  const shown = (display && !/^\{/.test(display) ? display : base).replace(/ x1$/, '');
  const price = gold[shown] ? gold[shown][1] : 0;
  foods.push({ name: shown, fp, gold: price, where: price && !OBTAIN[shown] ? 'Nexus shop' : (OBTAIN[shown] || GEAR[base] || 'Event / drop'), food: isFood, sprite });
}
foods.sort((a, b) => a.fp - b.fp);
{
  const C = 16, K = 16, W = K * C, H = Math.ceil(foods.length / K) * C, buf = Buffer.alloc(W * H * 4);
  foods.forEach((f, i) => {
    const from = texture(f.sprite.sheet), r = f.sprite.rect, cx = (i % K) * C, cy = Math.floor(i / K) * C;
    const ox = cx + Math.floor((C - r.w) / 2), oy = cy + Math.floor((C - r.h) / 2);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const s = ((r.y + y) * from.width + r.x + x) * 4, d = ((oy + y) * W + ox + x) * 4;
      from.pixels.copy(buf, d, s, s + 4);
    }
    f.i = i; delete f.sprite;
  });
  fs.writeFileSync(path.join(OUT, 'foods.png'), writePng(W, H, buf));
}

const prov = (() => { try { return JSON.parse(fs.readFileSync(path.join(XML, 'provenance.json'), 'utf8')).from; } catch (e) { return null; } })();
const out = {
  built: new Date().toISOString(), client: prov,
  pets: { cell: CELL, cols: COLS, list: petList },
  foods: { cell: 16, cols: 16, list: foods },
  costs: {
    feed: realmeye.feedCost, fuse: realmeye.fuseCost, yard: realmeye.yardUpgrade,
    cap: realmeye.abilityCap, unlocked: realmeye.abilitiesUnlocked
  }
};
fs.writeFileSync(path.join(root, 'web', 'pet-fame-data.js'),
  '/* Written by tools/build-pet-fame.js. Do not edit by hand: run it again after a game update. */\n' +
  'var PetFameData = ' + JSON.stringify(out) + ';\n');
console.log(petList.length + ' pets, ' + frames + ' frames, ' + foods.length + ' foods → web/pet-fame-data.js, web/assets/pets/');
