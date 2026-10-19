// Compact Index catalogue, only loaded on the training page.
const EQUIPMENT_HANDS=['ability','armor','ring'];
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function chosenClass(){return TRAINING_CATALOG.classes.find(c=>c.id===SETTINGS.classId)||TRAINING_CATALOG.classes[0]}
function availableGear(hand){const c=chosenClass();return TRAINING_CATALOG.equipment.filter(it=>c.slots.includes(it.slot)&&(!hand||it.hand===hand))}
function selectionOptions(){return{classId:SETTINGS.classId,equipment:{...SETTINGS.equipment},consumableId:SETTINGS.consumableId,seedKey:String(SETTINGS.seed??'').trim(),rules:'index-v2-postHit',catalogBuild:TRAINING_CATALOG.from.build}}
function selectionSummary(){return Object.values(SETTINGS.equipment).filter(Boolean).map(id=>TRAINING_CATALOG.equipment.find(it=>it.id===id)?.name).filter(Boolean).concat(SETTINGS.consumableId?[TRAINING_CATALOG.consumables.find(it=>it.id===SETTINGS.consumableId)?.name]:[])}
function validateSelections(){
 const removed=[];SETTINGS.classId=chosenClass().id;
 if(!SETTINGS.equipment||typeof SETTINGS.equipment!=='object'||Array.isArray(SETTINGS.equipment))SETTINGS.equipment={};
 for(const hand of Object.keys(SETTINGS.equipment)){const id=SETTINGS.equipment[hand];if(id&&!availableGear(hand).some(it=>it.id===id)){removed.push(id.replace(/^item:/,''));delete SETTINGS.equipment[hand]}}
 if(!TRAINING_CATALOG.consumables.some(it=>it.id===SETTINGS.consumableId))SETTINGS.consumableId='';
 return removed;
}
function effectDescription(it){
 const trigger=it.simulation==='manual'?'Space: ability activation; '+it.cost+' MP':'After a hit of at least '+it.damageThreshold+' damage, below '+(it.below*100)+'% HP (after damage)';
 return trigger+'. Invulnerable '+it.duration+' s · cooldown '+it.cooldown+' s.';
}
function iconHtml(it){if(!it.icon)return '<span class="index-icon missing" aria-hidden="true">◇</span>';const [x,y,w,h]=it.icon;
 return '<span class="index-icon" aria-hidden="true" style="width:'+w*3+'px;height:'+h*3+'px;background-position:-'+x*3+'px -'+y*3+'px"></span>'}
function itemHtml(it){return '<div class="index-item">'+iconHtml(it)+'<div><b>'+escapeText(it.name)+'</b><p>'+escapeText(effectDescription(it))+'</p><small>'+escapeText(it.clientId)+' · '+escapeText(it.clientType||'')+'</small></div></div>'}
function buildGear(){
 const cl=$('#trainingClass');cl.innerHTML=TRAINING_CATALOG.classes.map(c=>'<option value="'+escapeText(c.id)+'">'+escapeText(c.name)+'</option>').join('');
 cl.addEventListener('change',()=>{SETTINGS.classId=cl.value;const removed=validateSelections();$('#selectionNotice').textContent=removed.length?'Removed incompatible equipment: '+removed.join(', ')+'. Your character stats are unchanged.':'Class changed. Your character stats are unchanged.';refreshMenu()});
 $('#classDefaults').addEventListener('click',()=>{const c=chosenClass();for(const key of ['hp','def','spd'])if(Number.isFinite(c.stats[key+'Top']))SETTINGS[key]=c.stats[key+'Top'];refreshMenu()});
 const grid=$('#gearGrid');grid.innerHTML=EQUIPMENT_HANDS.map(hand=>'<label class="index-field">'+({ability:'Ability',armor:'Armour',ring:'Ring'})[hand]+'<select data-hand="'+hand+'" aria-label="'+hand+' equipment"></select><span class="index-effect"></span></label>').join('');
 for(const el of $$('#gearGrid select'))el.addEventListener('change',()=>{if(el.value)SETTINGS.equipment[el.dataset.hand]=el.value;else delete SETTINGS.equipment[el.dataset.hand];refreshMenu()});
 $('#trainingConsumable').addEventListener('change',e=>{SETTINGS.consumableId=e.target.value;refreshMenu()});
 showLegacyRecords();
}
function refreshGear(){
 const c=chosenClass();$('#trainingClass').value=c.id;
 $('#classInfo').textContent='Index stat caps: '+['hp','def','spd'].map(k=>k.toUpperCase()+' '+(c.stats[k+'Top']??'unknown')).join(' · ')+'. Apply these explicitly or keep your editable totals.';
 for(const el of $$('#gearGrid select')){const list=availableGear(el.dataset.hand);el.innerHTML='<option value="">None</option>'+list.map(it=>'<option value="'+escapeText(it.id)+'">'+escapeText(it.name)+'</option>').join('');el.value=SETTINGS.equipment[el.dataset.hand]||'';el.disabled=!list.length;
  const it=list.find(it=>it.id===el.value);el.nextElementSibling.innerHTML=it?itemHtml(it):list.length?'Optional. Equipped before the run.':'No compatible temporary-invulnerability item in this slot.'}
 $('#gearEmpty').hidden=availableGear().length>0;
 $('#thresholdNote').hidden=!availableGear().some(it=>it.simulation==='postHit');
 const unsupported=TRAINING_CATALOG.excluded.filter(it=>it.hand&&c.slots.includes(it.slot));
 $('#unsupportedGear').innerHTML=unsupported.length?'<details><summary>Not simulatable ('+unsupported.length+')</summary>'+unsupported.map(it=>'<p><b>'+escapeText(it.name)+'</b> — '+escapeText(it.reason)+'</p>').join('')+'</details>':'';
 const list=TRAINING_CATALOG.consumables;$('#trainingConsumable').innerHTML='<option value="">None</option>'+list.map(it=>'<option value="'+escapeText(it.id)+'">'+escapeText(it.name)+' (+'+it.bonus+' max HP, '+it.duration+' s)</option>').join('');$('#trainingConsumable').value=SETTINGS.consumableId;$('#trainingConsumable').disabled=!list.length;
 $('#consumableInfo').textContent=list.length?'Choose at most one. Used once before combat; expires in combat time; current HP is capped when it expires.':'No consumable can be offered: the current Index omits the stat, amount and duration of StatBoostSelf / StatBoostAura. Tincture of Life, Effusion of Life and Blood Nildrop are excluded. Instant healing and permanent stat potions are excluded too.';
 $('#resourceInfo').textContent='HP / DEF / SPD are your total equipped stats; selecting gear does not add its worn bonuses again. Ability MP reserve: '+(c.stats.mpTop??c.stats.mp??'unknown')+' (Index cap). No MP regeneration is modelled. Healing uses Index status data and the class WIS cap ('+(c.stats.wisTop??c.stats.wis??'unknown')+'). Shooting, offensive effects and party auras on ghosts are not modelled.';
}
function showLegacyRecords(){
 const list=$('#legacyRecords');if(!list)return;list.replaceChildren();
 try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||!key.startsWith('rotmg:training:patience:best:v1:'))continue;
  try{const b=JSON.parse(localStorage.getItem(key));if(!b||!Number.isFinite(b.frames))continue;const p=document.createElement('p');p.textContent=bestLine(b)+' · '+key.slice('rotmg:training:patience:best:v1:'.length);list.appendChild(p)}catch(e){}}
 }catch(e){}
 if(!list.childNodes.length)list.textContent='No legacy records stored in this browser.';
}
const toasts=[];let toastIdx=0;
function gearReset(){toasts.length=0;toastIdx=0}
function gearPump(){while(toastIdx<g.events.length){toasts.push({text:g.events[toastIdx++].text,t:performance.now()})}while(toasts.length&&performance.now()-toasts[0].t>3600)toasts.shift()}
function drawGearHud(){
 const lines=g.selectedItems.map(it=>it.name+' · '+(g.cooldown(it)>0?'cooldown '+(g.cooldown(it)/60).toFixed(1)+' s':it.simulation==='manual'?'Space · ready ('+it.cost+' MP)':'hit proc ready'));
 if(g.selectedItems.some(it=>it.simulation==='manual'))lines.push('MP '+g.mana+' · no MP regeneration');
 if(g.selectedConsumable)lines.push(g.selectedConsumable.name+' · '+(g.consumableUntil>0?'+'+g.selectedConsumable.bonus+' max HP · '+Math.max(0,(g.consumableUntil-g.frames)/60).toFixed(1)+' s':'used · expired'));
 lines.push(Math.max(0,Math.round(g.hp))+' / '+g.maxHp+' HP');
 const x=10,y=GH-lines.length*32-15;cx.fillStyle='rgba(6,8,13,.82)';cx.fillRect(x,y-15,700,lines.length*32+20);
 lines.forEach((line,i)=>drawText(x+12,y+i*32,line,{sc:.32,color:'#dfe5f2'}));
 if(g.invuln>0)drawText(GW/2,GH/2-90,'INVULNERABLE '+(g.invuln/60).toFixed(1)+' s',{sc:.42,h:'c',v:'m',color:'#7fe9ff'});
 toasts.slice(-2).forEach((t,i)=>drawText(GW/2,120+i*35,t.text,{sc:.29,h:'c',v:'m',color:'#f2c14e'}));
}
function drawInvulnHalo(){if(g.invuln<=0)return;cx.save();cx.strokeStyle='#7fe9ff';cx.lineWidth=.9;cx.beginPath();cx.arc(g.px,g.py,8,0,Math.PI*2);cx.stroke();cx.restore()}
