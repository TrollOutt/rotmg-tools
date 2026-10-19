// Compact Index catalogue, only loaded on the training page.
const EQUIPMENT_HANDS=['ability','armor','ring'];
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function chosenClass(){return TRAINING_CATALOG.classes.find(c=>c.id===SETTINGS.classId)||null}
function availableGear(hand){const c=chosenClass();return c?TRAINING_CATALOG.equipment.filter(it=>EQUIPMENT_HANDS.includes(it.hand)&&c.slots[EQUIPMENT_HANDS.indexOf(it.hand)+1]===it.slot&&(!hand||it.hand===hand)):[]}
function selectionOptions(){return{classId:SETTINGS.classId,swaps:{...SETTINGS.swaps},consumableId:SETTINGS.consumableId,seedKey:String(SETTINGS.seed??'').trim(),rules:'index-v3-swaps-postHit',catalogBuild:TRAINING_CATALOG.from.build}}
function selectionSummary(){return EQUIPMENT_HANDS.map(h=>SETTINGS.swaps[h]).filter(Boolean).map(id=>TRAINING_CATALOG.equipment.find(it=>it.id===id)?.name).filter(Boolean).concat(SETTINGS.consumableId?[TRAINING_CATALOG.consumables.find(it=>it.id===SETTINGS.consumableId)?.name]:[])}
function validateSelections(){
 const removed=[];
 if(!chosenClass()&&SETTINGS.classId){removed.push('unavailable class');SETTINGS.classId=''}
 if(!SETTINGS.swaps||typeof SETTINGS.swaps!=='object'||Array.isArray(SETTINGS.swaps))SETTINGS.swaps={};
 for(const hand of Object.keys(SETTINGS.swaps)){const id=SETTINGS.swaps[hand];if(!EQUIPMENT_HANDS.includes(hand)||!availableGear(hand).some(it=>it.id===id)){if(id)removed.push(TRAINING_CATALOG.equipment.find(it=>it.id===id)?.name||String(id).replace(/^item:/,''));delete SETTINGS.swaps[hand]}}
 if(!TRAINING_CATALOG.consumables.some(it=>it.id===SETTINGS.consumableId))SETTINGS.consumableId='';
 if(removed.length)selectionMessage='Ignored incompatible choices: '+removed.join(', ')+'. Choose compatible swaps in Equipment. Your character stats are unchanged.';
 return removed;
}
function effectDescription(it){
 const trigger=it.simulation==='manual'?'Space: ability activation; '+it.cost+' MP':'After a hit of at least '+it.damageThreshold+' damage, below '+(it.below*100)+'% HP (after damage)';
 return trigger+'. Invulnerable '+it.duration+' s · cooldown '+it.cooldown+' s.';
}
function iconHtml(it){if(!it.icon)return '<span class="index-icon missing" aria-hidden="true">◇</span>';const [x,y,w,h]=it.icon;
 return '<span class="index-icon" aria-hidden="true" style="width:'+w*3+'px;height:'+h*3+'px;background-position:-'+x*3+'px -'+y*3+'px"></span>'}
function itemHtml(it){return '<div class="index-item">'+iconHtml(it)+'<div><b>'+escapeText(it.name)+'</b><p>'+escapeText(effectDescription(it))+'</p></div></div>'}
function buildGear(){
 const cl=$('#trainingClass');cl.innerHTML='<option value="">Choose a class...</option>'+TRAINING_CATALOG.classes.map(c=>'<option value="'+escapeText(c.id)+'">'+escapeText(c.name)+'</option>').join('');
 cl.addEventListener('change',()=>{SETTINGS.classId=cl.value;selectionMessage='Class changed. Your character stats are unchanged.';validateSelections();refreshMenu()});
 $('#classDefaults').addEventListener('click',()=>{const c=chosenClass();if(!c)return;for(const key of ['hp','def','spd'])if(Number.isFinite(c.stats[key+'Top']))SETTINGS[key]=c.stats[key+'Top'];refreshMenu()});
 const grid=$('#gearGrid');grid.innerHTML=EQUIPMENT_HANDS.map(hand=>'<label class="index-field">'+({ability:'Ability',armor:'Armor',ring:'Ring'})[hand]+'<select data-hand="'+hand+'" aria-label="'+hand+' swap"></select><span class="index-effect"></span></label>').join('');
 for(const el of $$('#gearGrid select'))el.addEventListener('change',()=>{if(el.value)SETTINGS.swaps[el.dataset.hand]=el.value;else delete SETTINGS.swaps[el.dataset.hand];refreshMenu()});
 $('#trainingConsumable').addEventListener('change',e=>{SETTINGS.consumableId=e.target.value;refreshMenu()});
 showLegacyRecords();
}
function refreshGear(){
 const c=chosenClass();$('#trainingClass').value=c?.id||'';
 $('#classInfo').textContent=c?'Index stat caps: '+['hp','def','spd'].map(k=>k.toUpperCase()+' '+(c.stats[k+'Top']??'unknown')).join(' · ')+'. Apply these explicitly or keep your editable totals.':'Choose one of the 19 ROTMG classes before starting. Your class determines the available swaps.';
 $('#classDefaults').disabled=!c;$('#start').disabled=!c;stepGate();
 $('#launchNotice').textContent=c?'':'Choose a ROTMG class in Character before starting training.';
 $('#selectionNotice').textContent=selectionMessage;$('#equipmentNotice').textContent=selectionMessage;
 for(const el of $$('#gearGrid select')){const list=availableGear(el.dataset.hand);el.parentElement.hidden=!list.length;el.innerHTML='<option value="">None</option>'+list.map(it=>'<option value="'+escapeText(it.id)+'">'+escapeText(it.name)+'</option>').join('');el.value=SETTINGS.swaps[el.dataset.hand]||'';
  const it=list.find(it=>it.id===el.value);el.nextElementSibling.innerHTML=it?itemHtml(it):'Optional. Prepared before combat; activates only when its trigger is met.'}
 $('#gearEmpty').hidden=availableGear().length>0;
 $('#gearEmpty').textContent=c?'No compatible invulnerability swaps for this class. You can train without swaps.':'Choose your class in Character to see compatible swaps.';
 $('#thresholdNote').hidden=!availableGear().some(it=>it.simulation==='postHit');
 const list=TRAINING_CATALOG.consumables;$('#trainingConsumable').innerHTML='<option value="">None</option>'+list.map(it=>'<option value="'+escapeText(it.id)+'">'+escapeText(it.name)+' (+'+it.bonus+' max HP, '+it.duration+' s)</option>').join('');$('#trainingConsumable').value=SETTINGS.consumableId;$('#trainingConsumable').disabled=!list.length;
 const consumable=list.find(it=>it.id===SETTINGS.consumableId);
 $('#consumableInfo').innerHTML=(consumable?'<div class="index-item">'+iconHtml(consumable)+'<div><b>'+escapeText(consumable.name)+'</b><p>+'+consumable.bonus+' max HP · '+consumable.duration+' s</p></div></div>':'')+'<span class="opt">Choose at most one. Used once before combat; current HP is unchanged. Duration uses combat time, including no time while paused. On expiry, current HP is capped to the restored maximum. Auras with unverified caster inclusion and additional unmodelled effects are excluded.</span>';
 $('#resourceInfo').textContent='HP / DEF / SPD are your editable totals. Swaps add no item stats, Healing or other secondary effects. Ability MP reserve: '+(c?.stats.mpTop??c?.stats.mp??'choose a class')+' (Index cap). No MP regeneration is modelled. Each selected swap has its own cooldown. On the same surviving hit, Armor then Ring are evaluated; overlapping protection ends at the latest expiry, without adding durations. An already protected hit triggers neither. Shooting and party effects are not modelled.';
}
function showLegacyRecords(){
 const list=$('#legacyRecords');if(!list)return;list.replaceChildren();
 try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key)continue;
  const v1=key.startsWith('rotmg:training:patience:best:v1:');
  const v2=key.startsWith('rotmg:training:patience:best:v2:');
  if(!v1&&!v2)continue;
  try{if(v2&&JSON.parse(key.slice('rotmg:training:patience:best:v2:'.length))[0]==='index-v3-swaps-postHit')continue;
   const b=JSON.parse(localStorage.getItem(key));if(!b||!Number.isFinite(b.frames))continue;const p=document.createElement('p');p.textContent=(v1?'Archive · ':'TG2 / TG3 · ')+bestLine(b)+' · '+key.split('best:')[1];list.appendChild(p)}catch(e){}}
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
function drawInvulnHalo(x=g.px,y=g.py){if(g.invuln<=0)return;cx.save();cx.strokeStyle='#7fe9ff';cx.lineWidth=.9;cx.beginPath();cx.arc(x,y,8,0,Math.PI*2);cx.stroke();cx.restore()}
