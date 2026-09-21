'use strict';
// Migration helper for literal HTML interface copy only. Game data is never read.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), localeRoot = path.join(root, 'web', 'locales');
const targets = { fr:'fr','pt-BR':'pt','pt-PT':'pt',es:'es',ru:'ru',pl:'pl',de:'de',tr:'tr',fi:'fi',it:'it',sv:'sv','zh-CN':'zh-CN',da:'da' };
const htmlFiles = ['web/index.html','web/skins/view.html','web/assets/atlas/index.html'];
const ignored = new Set(['I','II','III','IV','WASD','GPL-3.0','Realm Tools','Realm of the Mad God','Month of the Mad God','rotmg-enchant-calculator','by brendanbrubacher ·',', modified','(optional)','have?','your copy','Open →']);
const protectedTerms = ['Realm of the Mad God','RotMG','Fame','No Artifact','DEX','ATT','DEF','SPD','VIT','WIS','HP','MP'];
const dynamicUi = [
  'A build within your reach','Accessory','Accessory dye','All classes',
  'Ambiguous Index match — no automatic link','Basic starter gear','Beach · real Atlas area','Bug',
  'Choose a different class','Choose at least one dungeon.','Click to include','Client dye item sprite',
  'Clothing','Clothing dye','Color','Color dye','Dark','Empty','Empty setup','Explain these odds',
  'Facts','Gear','Gears','Consumables','Classes','Enemies','Biomes','Enchantments','Pools',
  'Included','Included by default','Index · selected','Keep at least one dungeon to continue.',
  'Keep it on your list','Keep this one','Kept - click to let it change','Kind of gear','Light','Links',
  'Loading…','New setup','No dye','No dye selected','No exact Index match',
  'No favorite combos yet. Select a skin and dyes, then use “Save combo”.',
  'No favorite matches this search.','No game client has been read against these numbers yet.',
  'No improvement','No skin','Nothing left in these that you have not set aside.','Nothing selected',
  'On the item','Open in Index','Optimizing...','Other','Other families',
  'Outside your selected loot sources','Remove favorite','Save progression','Search by name, slot or dust…',
  'Skin card not linked exactly yet.','Slot, dust and base all come from the item. Only the rarity is left to you.',
  'Start another setup','Start crafting','Studio · inspection room','Take it off your list','Textile',
  'The best possible build','The enchanting data could not be loaded. Reload this page before planning a build.',
  'The first choice — taking it off clears the rest',
  'The locked and wanted enchantments together need more slots than the item has.',
  'This copy of index.html needs the local server. Use the single-file build (Realm-Tools.html) to open it straight from disk.',
  'This enchantment is already on the item and you keep it. It removes candidates, costs a slot and doubles every reroll.',
  'This enchantment is not on the item yet — you want to roll it.','Tiered','Unassigned',
  'Unknown item. Set the slot, dust and base by hand below; the calculation itself is unaffected.',
  'Wanted','What would you like it to do?','animated','change','click the heading to close',
  'copy a link','could not send — it is still here, try again','nothing left to do','pause','play',
  'put back the way it was','sending…','trying things...'
  ,'{count} items','{count} items · slot, dust and base come with the choice',
  '{count} shown','{count} selectable','{count} available · {blocked} removed by the other slots',
  '{count} favorite','{count} favorites','{count} skin','{count} skins',
  '{count} clothing dyes','{count} accessory dyes','{count} dungeon selected','{count} dungeons selected',
  '{count} dungeon included','{count} dungeons included','{count} choices across all classes',
  '{count} not listed','{count} removed candidates','{count} states enumerated',
  '{count} thing','{count} things','{count} thing kept','{count} things kept',
  '{count} remaining slot','{count} remaining slots','{count} more','{count} minutes',
  'Damage','Range','Rate of Fire','Cooldown','MP Cost','XP Bonus','Feed Power','Shots',
  'Projectiles','Damage Reduction','Mana Cost Reduction','On Equip','On Hit','On Shoot',
  'On Ability','Consumed with use','Usable by','Dropped by','Artifact','Engraving','Enchantment',
  'each cast','each shot','casts a second','shots a second','goes through','ignores armour',
  'with a wiki page','with the selected item','click the padlock to keep one'
  ,'Berserk','Speedy','Healing','Energized','Damaging','Invisible','Invulnerable',
  'Invincible','Armored','Inspired','Stunned','Paralyzed','Armor Broken','Stasis',
  'Pet Stasis','Curse','Slowed','Quiet','Silenced','Confused','Unstable','Blind',
  'Darkness','Weak','Bleeding','Dazed','Sick','Exposed','Heal','Magic Heal','Electric',
  'Attack Far','Attack Mid','Attack Close','Savage','Decoy','Rising Fury'
];
// Runtime Index copy cannot be discovered by the HTML scanner.  These keys
// deliberately stay semantic: several carry values or are assembled in a
// redraw, where matching an English literal is fragile.
const indexUi = {
  'home.index.detail': 'Every item, class, creature, dungeon, set and enchantment the game declares, with its picture and what it is joined to.',
  'index.favourite.remove': 'Take it off your list',
  'index.favourite.keep': 'Keep it on your list',
  'index.results.firstOf': 'first {shown} of {total}',
  'index.results.oneThing': '{count} thing',
  'index.results.manyThings': '{count} things',
  'index.results.none': 'Nothing by that name.',
  'index.difficulty.ratingTitle': 'RealmEye difficulty rating',
  'index.difficulty.score': 'Difficulty {score} / 10',
  'index.difficulty.rating': 'difficulty rating',
  'index.hidden.title': 'Some tools do not offer this',
  'index.hidden.label': 'hidden',
  'index.hidden.toolsWarning': 'The other tools do not offer this',
  'index.choice.firstTitle': 'The first choice. Taking it off clears the rest.',
  'index.choice.removeTitle': 'Take this one off',
  'index.choice.firstLabel': 'first choice — clears the rest',
  'index.community.label': 'community',
  'index.section.facts': 'Facts',
  'index.section.whatItDoes': 'What it does',
  'index.section.clientDeclarations': 'Client declarations',
  'index.section.description': 'Description',
  'index.section.details': 'Details',
  'index.section.links': 'Links',
  'index.biome.lootAvailable': 'Loot available in this biome',
  'index.bench.unavailable': 'Not offered on the bench',
  'index.duplicate.warning': 'The game has more than one thing by this name. The words in brackets are how they differ.',
  'index.source.readFrom': 'Read from {source} in the game’s own files',
  'index.door.priceEnchantments': 'Price its enchantments',
  'index.door.priceEnchantmentsTitle': 'Open the calculator on this item',
  'index.door.buildClass': 'Build this class',
  'index.door.buildClassTitle': 'Open the bench on it',
  'index.door.fight': 'Fight it',
  'index.door.fightTitle': 'Use it as the target on the bench',
  'index.door.findOnMap': 'Find it on the map',
  'index.door.findOnMapTitle': 'Open the realm atlas',
  'index.missingData': 'The index is not built yet. Run node tools/build-index.js.',
  'index.built.summary': '{count} things, read from the client of {client}{wiki}',
  'index.built.wiki': ', {count} with a wiki page',
  'index.group.favourites': 'Favourites', 'index.group.class': 'Class', 'index.group.skins': 'Skins',
  'index.group.costume': 'Costume', 'index.group.gears': 'Gears', 'index.group.kindOfThing': 'Kind of thing',
  'index.group.enemies': 'Enemies', 'index.group.kindOfGear': 'Kind of gear', 'index.group.tier': 'Tier',
  'index.group.marks': 'Marks', 'index.group.season': 'Season', 'index.group.biome': 'Biome', 'index.group.dungeon': 'Dungeon',
  'index.note.skinSource': 'how you come by one', 'index.note.readOffName': 'read off the name, not declared',
  'index.note.clientBag': 'what the client puts in a bag', 'index.note.clientSeason': 'only where the client names one',
  'index.note.communityDrops': 'what players list it as dropping',
  'index.chip.starred': 'Starred', 'index.chip.fromUnlocker': 'From an unlocker', 'index.chip.fromSet': 'From a set',
  'index.chip.givenToYou': 'Given to you', 'index.chip.untiered': 'Untiered', 'index.chip.setTier': 'Set tier',
  'index.chip.soulbound': 'Soulbound', 'index.chip.shiny': 'Shiny', 'index.chip.reskin': 'Reskin', 'index.chip.noCategory': 'No Category',
  'index.answer.yes': 'yes',
  'index.fact.slot': 'slot', 'index.fact.kind': 'kind', 'index.fact.costume': 'costume',
  'index.fact.unlocksAtLevel': 'unlocks at level', 'index.fact.comesFrom': 'comes from', 'index.fact.tier': 'tier',
  'index.fact.soulbound': 'soulbound', 'index.fact.mana': 'mana', 'index.fact.rateOfFire': 'rate of fire',
  'index.fact.shots': 'shots', 'index.fact.shot': 'shot {count}', 'index.fact.damage': 'damage', 'index.fact.range': 'range',
  'index.fact.tiles': '{count} tiles', 'index.fact.ignoresArmour': 'ignores armour', 'index.fact.goesThrough': 'goes through',
  'index.fact.theShot': 'the shot', 'index.fact.fourPiecesGive': 'the four pieces give', 'index.fact.wearingIt': 'wearing it',
  'index.fact.life': 'life', 'index.fact.armour': 'armour', 'index.fact.howOftenItRolls': 'how often it rolls',
  'index.fact.goesOn': 'goes on', 'index.fact.neverOn': 'never on', 'index.fact.notBeside': 'not beside',
  'index.fact.itCanGive': 'it can give', 'index.fact.turnsYouInto': 'turns you into', 'index.fact.cameWith': 'came with',
  'index.fact.theName': 'the {name}', 'index.fact.ground': 'ground', 'index.fact.zone': 'zone',
  'index.fact.recommendedLevel': 'recommended level', 'index.fact.howBig': 'how big', 'index.fact.picture': 'picture',
  'index.fact.hp': 'life', 'index.fact.mp': 'magic', 'index.fact.att': 'attack', 'index.fact.def': 'defence',
  'index.fact.spd': 'speed', 'index.fact.dex': 'dexterity', 'index.fact.vit': 'vitality', 'index.fact.wis': 'wisdom',
  'index.fact.pieces': '{count} pieces', 'index.fact.forWearingAllFour': 'for wearing all four',
  'index.fact.nothingButTheLook': 'nothing but the look', 'index.fact.labels': 'labels',
  'index.worn.life': 'life', 'index.worn.magic': 'magic', 'index.worn.attack': 'attack', 'index.worn.defence': 'defence',
  'index.worn.speed': 'speed', 'index.worn.dexterity': 'dexterity', 'index.worn.vitality': 'vitality', 'index.worn.wisdom': 'wisdom',
  'index.picture.clientArt': "the game's own art", 'index.picture.givenSkin': 'the skin it gives you',
  'index.picture.piece': 'one of its pieces',
  'index.loot.tieredLoot': 'tiered loot', 'index.loot.untieredGear': 'untiered gear', 'index.loot.setTierGear': 'set-tier gear',
  'index.loot.dungeonEntrances': 'dungeon entrances', 'index.loot.tiered': 'tiered',
  'index.section.population': 'Population', 'index.section.loot': 'Loot', 'index.section.subBiomes': 'Sub-biomes',
  'index.population.notGenerating': 'No current generated population — {status}.',
  'index.population.noneForSubBiome': 'No population is currently listed for this sub-biome.',
  'index.relation.area': 'Area: {areas}', 'index.relation.from': 'from', 'index.relation.notableDrops': 'notable drops',
  'index.relation.guardian': 'guardian', 'index.relation.enemies': 'enemies', 'index.relation.heroesOfOryx': 'Heroes of Oryx',
  'index.relation.encounters': 'encounters', 'index.relation.items': 'items', 'index.relation.dungeonEntrances': 'dungeon entrances',
  'index.relation.areas': 'areas', 'index.relation.andMore': 'and {count} more', 'index.relation.mayHold': 'may hold',
  'index.relation.droppedBy': 'dropped by', 'index.relation.obtainedThrough': 'obtained through', 'index.relation.reskinOf': 'reskin of',
  'index.relation.reskins': 'reskins', 'index.relation.spawns': 'spawns', 'index.relation.spawnedBy': 'spawned by',
  'index.relation.setPieces': 'set pieces', 'index.relation.class': 'class', 'index.relation.bosses': 'bosses',
  'index.relation.minibosses': 'minibosses', 'index.relation.bossMinions': 'boss minions',
  'index.relation.treasureRoomBoss': 'treasure room boss', 'index.relation.hazards': 'hazards',
  'index.relation.dropsOfInterest': 'drops of interest', 'index.relation.regularEnemies': 'regular enemies',
  'index.relation.minions': 'minions', 'index.relation.heroMinions': 'Hero minions',
  'index.relation.encounterMinions': 'encounter minions', 'index.relation.beaconGuardian': 'beacon guardian',
  'index.relation.beaconMinions': 'beacon minions', 'index.relation.subBiomes': 'sub-biomes', 'index.relation.partOfBiome': 'part of biome',
  'index.relation.listedAsDropping': 'listed as dropping', 'index.relation.tierDropLocations': 'tier drop locations',
  'index.relation.foundIn': 'found in', 'index.relation.enemiesFoundHere': 'enemies found here',
  'index.relation.listedTierDrops': 'listed tier drops', 'index.relation.spawnsOrSpawnedBy': 'spawns, or is spawned by',
  'index.tooltip.area': 'Area: {areas}', 'index.tooltip.dropsFrom': 'Drops from {sources}', 'index.tooltip.showEvery': 'Show every {kind}',
  'index.source.archiveMerged': 'RealmEye source page ({count} archived pages are merged into this record)',
  'index.source.archivePage': 'Its archived RealmEye source page', 'index.source.communityPage': 'Its page on the community wiki',
  'index.source.communityFilesUnder': 'The community wiki files this one under {title} rather than giving it a page',
  'index.source.notDeclared': 'not declared in the client',
  'index.skin.clothingDye': 'clothing dye', 'index.skin.accessoryDye': 'accessory dye', 'index.skin.setSkin': 'set skin',
  'index.skin.skin': 'skin', 'index.door.skinViewer': 'Open in Skin Viewer',
  'index.door.skinViewerTitle': 'Open the exact linked {kind} in the local Skin Viewer'
};
// These are ROTMG taxonomy terms, not prose. Keep their familiar English
// spelling wherever the Index presents a category, chip, facet, or relation.
const canonicalIndexTaxonomy = {
  'index.group.tier': 'Tier',
  'index.chip.untiered': 'Untiered',
  'index.chip.setTier': 'Set tier',
  'index.chip.soulbound': 'Soulbound',
  'index.chip.shiny': 'Shiny',
  'index.fact.tier': 'Tier',
  'index.loot.tieredLoot': 'Tiered loot',
  'index.loot.untieredGear': 'Untiered gear',
  'index.loot.setTierGear': 'Set-tier gear',
  'index.loot.tiered': 'Tiered',
  'index.relation.setPieces': 'Set pieces',
  'index.relation.tierDropLocations': 'Tier drop locations',
  'index.relation.listedTierDrops': 'Listed Tier drops'
};

function strings() {
  const out = new Set(), add = raw => {
    const value = raw.replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&hellip;/g,'…').replace(/&[a-z]+;/gi,' ').replace(/\s+/g,' ').trim();
    if (/[A-Za-z]/.test(value) && !ignored.has(value)) out.add(value);
  };
  for (const relative of htmlFiles) {
    const source = fs.readFileSync(path.join(root, relative),'utf8').replace(/<!--[\s\S]*?-->/g,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<script[\s\S]*?<\/script>/gi,'');
    for (const match of source.matchAll(/>([^<>]+)</g)) add(match[1]);
    for (const match of source.matchAll(/(?:aria-label|aria-description|placeholder|title)="([^"]+)"/g)) add(match[1]);
  }
  dynamicUi.forEach(value => out.add(value));
  return [...out].sort();
}
function mask(source) {
  const terms=[]; let value=source;
  for (const term of protectedTerms) if (value.includes(term)) { const token=`{RT${terms.length}}`; value=value.split(term).join(token); terms.push(term); }
  return { value, terms };
}
function restore(value, terms) { terms.forEach((term,i)=>{value=value.split(`{RT${i}}`).join(term)}); return value; }
function translate(target, text) {
  const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl='+encodeURIComponent(target)+'&dt=t&q='+encodeURIComponent(text);
  const call=spawnSync('curl.exe',['-sS',url],{encoding:'utf8',maxBuffer:1024*1024});
  if(call.status!==0)throw new Error(call.stderr||`curl exited ${call.status}`);
  const parsed=JSON.parse(call.stdout); return parsed[0].map(part=>part[0]).join('');
}
function translatedExisting(catalogue, source) {
  const english = catalogues.en;
  const key = Object.keys(english).find(name => english[name] === source);
  return key && catalogue[key];
}
function translateAll(target, rows, fallbackLocale) {
  const output=[];
  for(let at=0;at<rows.length;){const chunk=[];let size=0;while(at<rows.length&&size+rows[at].value.length<650){chunk.push(rows[at++]);size+=chunk.at(-1).value.length+1}
    let lines;
    try {
      lines=translate(target,chunk.map(row=>row.value).join('\n')).split('\n').map(x=>x.trim());
    } catch (error) {
      // Offline contributors can still regenerate the complete bundle. Exact
      // existing strings retain their reviewed translations; genuinely new
      // copy falls back to English until the translation service is reachable.
      console.warn(`${target}: ${error.message.trim()} (using available catalogue values)`);
      lines=chunk.map(row => translatedExisting(catalogues[fallbackLocale], row.source) || row.source);
    }
    if(lines.length!==chunk.length)throw new Error(`${target}: expected ${chunk.length} translated lines, got ${lines.length}`);
    lines.forEach((line,i)=>output.push(restore(line,chunk[i].terms)));
  } return output;
}
const catalogues={}; for(const locale of ['en',...Object.keys(targets)])catalogues[locale]=JSON.parse(fs.readFileSync(path.join(localeRoot,locale,'common.json'),'utf8'));
const indexRows = Object.entries(indexUi).map(([key, source]) => ({ key, source, ...mask(source) }));
for (const row of indexRows) catalogues.en[row.key] = row.source;
for (const [key, value] of Object.entries(canonicalIndexTaxonomy)) catalogues.en[key] = value;
for (const [locale, target] of Object.entries(targets)) {
  const translated = translateAll(target, indexRows, locale);
  indexRows.forEach((row, index) => {
    catalogues[locale][row.key] = canonicalIndexTaxonomy[row.key] || translated[index];
  });
  console.log(`${locale}: ${indexRows.length} Index UI keys`);
}
const known=new Set(Object.values(catalogues.en)), used=new Map();
for(const [key,value] of Object.entries(catalogues.en))used.set(key,value);
const rows=strings().filter(value=>!known.has(value)).map(source=>{let slug=source.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).slice(0,7).join('.')||'label';let key='static.'+slug;if(used.has(key)&&used.get(key)!==source)key+='.'+crypto.createHash('sha1').update(source).digest('hex').slice(0,7);used.set(key,source);return{key,source,...mask(source)}});
rows.forEach(row=>catalogues.en[row.key]=row.source);
for(const [locale,target] of Object.entries(targets)){const translated=translateAll(target,rows,locale);rows.forEach((row,i)=>catalogues[locale][row.key]=translated[i]);console.log(`${locale}: ${rows.length}`)}
// Translation engines sometimes translate placeholder names or elide a leading
// placeholder in highly inflected languages. Restore their identity and count.
for(const locale of Object.keys(targets))for(const [key,source] of Object.entries(catalogues.en)){
  const wanted=[...source.matchAll(/\{(\w+)\}/g)].map(match=>match[1]); if(!wanted.length)continue;
  let value=catalogues[locale][key], at=0;
  value=value.replace(/\{\w+\}/g,()=>`{${wanted[Math.min(at++,wanted.length-1)]}}`);
  if(at<wanted.length)value=wanted.slice(at).map(name=>`{${name}}`).join(' ')+' '+value;
  catalogues[locale][key]=value;
}
for(const [locale,catalogue] of Object.entries(catalogues))fs.writeFileSync(path.join(localeRoot,locale,'common.json'),JSON.stringify(catalogue,null,2)+'\n');
console.log(`Added ${rows.length} static UI keys; machine-assisted prose requires human review.`);
