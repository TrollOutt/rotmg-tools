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
function translateAll(target, rows) {
  const output=[];
  for(let at=0;at<rows.length;){const chunk=[];let size=0;while(at<rows.length&&size+rows[at].value.length<650){chunk.push(rows[at++]);size+=chunk.at(-1).value.length+1}
    const lines=translate(target,chunk.map(row=>row.value).join('\n')).split('\n').map(x=>x.trim());
    if(lines.length!==chunk.length)throw new Error(`${target}: expected ${chunk.length} translated lines, got ${lines.length}`);
    lines.forEach((line,i)=>output.push(restore(line,chunk[i].terms)));
  } return output;
}
const catalogues={}; for(const locale of ['en',...Object.keys(targets)])catalogues[locale]=JSON.parse(fs.readFileSync(path.join(localeRoot,locale,'common.json'),'utf8'));
const known=new Set(Object.values(catalogues.en)), used=new Map();
for(const [key,value] of Object.entries(catalogues.en))used.set(key,value);
const rows=strings().filter(value=>!known.has(value)).map(source=>{let slug=source.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).slice(0,7).join('.')||'label';let key='static.'+slug;if(used.has(key)&&used.get(key)!==source)key+='.'+crypto.createHash('sha1').update(source).digest('hex').slice(0,7);used.set(key,source);return{key,source,...mask(source)}});
rows.forEach(row=>catalogues.en[row.key]=row.source);
for(const [locale,target] of Object.entries(targets)){const translated=translateAll(target,rows);rows.forEach((row,i)=>catalogues[locale][row.key]=translated[i]);console.log(`${locale}: ${rows.length}`)}
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
