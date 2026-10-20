'use strict';
/*
 * Pull everything the Pet Fame calculator needs out of the client's own XML.
 *
 *   node tools/extract-pets.js
 *
 * Reads client-data/Objects.*.xml and spritesheet.bin, writes
 * data/Pets/pets.json. Nothing here is guessed: every field is a tag the
 * client declares, and what the client does not declare (feed-power curve,
 * feeding cost, fuse cost) is left out and listed in docs/PET-RESEARCH.md.
 */
const fs = require('fs');
const path = require('path');
const registry = require('./spritesheet');

const root = path.join(__dirname, '..');
const XML = process.env.ROTMG_CLIENT_DATA || path.join(root, 'client-data');
const OUT = path.join(root, 'data', 'Pets', 'pets.json');

const objects = [];
for (const f of fs.readdirSync(XML).filter(n => /^Objects\.\d+\.xml$/.test(n)).sort()) {
  const text = fs.readFileSync(path.join(XML, f), 'utf8');
  for (const m of text.matchAll(/<Object\s[^>]*?>[\s\S]*?<\/Object>/g)) objects.push(m[0]);
}

const attr = (o, n) => (o.match(new RegExp('<Object[^>]*\\b' + n + '="([^"]*)"')) || [])[1];
const tag = (o, n) => (o.match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i')) || [])[1];
const has = (o, n) => new RegExp('<' + n + '[\\s/>]').test(o);
const num = s => (s === undefined || s === '' ? undefined : Number(s));
const cls = o => tag(o, 'Class');
const anim = o => {
  const a = tag(o, 'AnimatedTexture');
  return a ? { file: tag(a, 'File'), index: Number(tag(a, 'Index')) } : undefined;
};
const idOf = o => ({ id: attr(o, 'id'), type: attr(o, 'type') });

const sheet = registry.read(fs.readFileSync(path.join(XML, 'spritesheet.bin')));
const frames = new Map();
for (const f of sheet.animated) {
  const k = f.atlas + '#' + f.index;
  if (!frames.has(k)) frames.set(k, []);
  frames.get(k).push({ set: f.set, direction: f.direction, action: f.action, x: f.x, y: f.y, w: f.w, h: f.h });
}
const framesOf = a => (a && frames.get(a.file + '#' + a.index)) || [];

const pick = (list, c) => list.filter(o => cls(o) === c);

const skins = pick(objects, 'PetSkin').map(o => {
  const a = anim(o);
  const fr = framesOf(a);
  return {
    ...idOf(o), display: tag(o, 'DisplayId'), family: tag(o, 'Family'), rarity: tag(o, 'Rarity'),
    tier: num(tag(o, 'ItemTier')), group: tag(o, 'Group'), animation: a,
    actions: [...new Set(fr.map(f => registry.sayAction(f.action)))],
    frames: fr.length
  };
});

const pets = pick(objects, 'Pet').map(o => ({
  ...idOf(o), family: tag(o, 'Family'), rarity: tag(o, 'Rarity'), tier: num(tag(o, 'ItemTier')),
  defaultSkin: tag(o, 'DefaultSkin'), firstAbility: tag(o, 'FirstAbility'),
  basic: has(o, 'BasicPet'), noHatchOrFuse: has(o, 'NoHatchOrFuse')
}));

const abilities = pick(objects, 'PetAbility').map(o => ({
  ...idOf(o), group: tag(o, 'Group'), description: tag(o, 'Description')
}));

const behaviors = pick(objects, 'PetBehavior').map(o => ({
  ...idOf(o), base: (o.match(/<BaseBehavior id="([^"]*)"/) || [])[1],
  parameters: (tag(o, 'Parameters') || '').replace(/\s+/g, ' ').trim()
}));

const yardUpgraders = pick(objects, 'YardUpgrader').map(o => ({
  ...idOf(o), yardType: num(tag(o, 'PetYardType')), gold: num(tag(o, 'Price')), fame: num(tag(o, 'Fame'))
}));

/* every Equipment object that can be fed: the client states feedPower on it */
const item = o => ({
  ...idOf(o), display: tag(o, 'DisplayId'), feedPower: num(tag(o, 'feedPower')), petFood: has(o, 'PetFood'),
  soulbound: has(o, 'Soulbound'), bag: num(tag(o, 'BagType')), tier: num(tag(o, 'Tier')),
  rarity: tag(o, 'Rarity'), family: tag(o, 'PetFamily'), description: tag(o, 'Description')
});
const equipment = objects.filter(o => cls(o) === 'Equipment' && has(o, 'Item'));
const feedable = equipment.filter(o => has(o, 'feedPower')).map(item);
const petFood = equipment.filter(o => has(o, 'PetFood')).map(item);
const eggs = equipment.filter(o => tag(o, 'Activate') === 'CreatePet').map(item);
const stones = equipment.filter(o => /UnlockPetSkin/.test(o)).map(o => ({
  ...item(o), skinType: (o.match(/skinType="(\d+)"/) || [])[1]
}));
const consumables = equipment.filter(o => /Pet Saddlebag|Pet Form Stone|Mystery Pet Skin|Pet Takeout|Pet Rock/.test(attr(o, 'id'))).map(item);

const prov = (() => { try { return JSON.parse(fs.readFileSync(path.join(XML, 'provenance.json'), 'utf8')); } catch (e) { return null; } })();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  built: new Date().toISOString(), client: prov && prov.from, tool: 'tools/extract-pets.js',
  counts: { pets: pets.length, skins: skins.length, abilities: abilities.length, behaviors: behaviors.length,
    feedable: feedable.length, petFood: petFood.length, eggs: eggs.length, stones: stones.length },
  yardUpgraders, abilities, behaviors, pets, skins, eggs, petFood, stones, consumables, feedable
}, null, 1));
console.log('wrote', path.relative(root, OUT), JSON.stringify({ pets: pets.length, skins: skins.length, eggs: eggs.length, petFood: petFood.length, feedable: feedable.length }));
