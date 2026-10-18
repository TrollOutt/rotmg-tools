// ------------------------------------------------------------------ special gear: menu card, in-game HUD
// The menu HP/defence are those WITH the gear you already wear (armor + ring). A special piece replaces the worn one,
// so the max HP moves by (new piece - worn piece). The consumable goes first (it raises the ceiling), then armor, then ring.
const GEAR_SLOTS=[
 {slot:'nild',title:'Consumable',key:'3',options:[['none','None'],['blood','Blood Nildrop']]},
 {slot:'armor',title:'Armour',key:'1',options:[['none','None'],['matrix','Magic Protective Matrix'],['rags','Wretched Rags']]},
 {slot:'ring',title:'Ring',key:'2',options:[['none','None'],['amulet','Amulet of Restoration'],['circlet','Nightmatter Circlet']]},
];
const MODE_LABEL={start:'At start',auto:'Auto',manual:'Manual'};
const hpOf=id=>id&&id!=='none'&&ITEMS[id]?SETTINGS.itemHp[id]:0;
const nameOf=id=>id&&id!=='none'&&ITEMS[id]?ITEMS[id].name:'nothing';
function gearConfig(){ // what the game gets: only the slots that are in use
 const gear={};
 for(const {slot} of GEAR_SLOTS){const c=SETTINGS[slot];if(c&&c.id&&c.id!=='none'&&ITEMS[c.id])gear[slot]={id:c.id,mode:c.mode,at:c.at,hp:SETTINGS.itemHp[c.id],waitCur:!!c.waitCur}}
 return gear}
function curConfig(){const o={};for(const s of ['armor','ring']){const id=SETTINGS.cur[s];if(id&&id!=='none'&&ITEMS[id])o[s]={id,hp:SETTINGS.itemHp[id]}}return o}
function gearSig(gear){return Object.values(gear||{}).map(c=>c.id).join('+')}
function fmtPv(v){return Math.round(v)}
// max HP just before this slot is put on (earlier slots in the order consumable > armor > ring already done)
function maxBefore(slot){
 let M=SETTINGS.hp;const n=SETTINGS.nild;
 if(slot!=='nild'&&n.id!=='none'&&n.mode!=='manual')M+=hpOf(n.id);
 if(slot==='ring'){const a=SETTINGS.armor;if(a.id!=='none'&&a.mode!=='manual')M+=hpOf(a.id)-hpOf(SETTINGS.cur.armor)}
 return M}
function maxAfter(slot,c){return maxBefore(slot)-(slot==='nild'?0:hpOf(SETTINGS.cur[slot]))+hpOf(c.id)}
function setAllModes(m){
 for(const {slot} of GEAR_SLOTS){const c=SETTINGS[slot];if(!c||c.id==='none')continue;
  if(m==='auto'){const r=gearRec(slot,c);if(r&&r.mode==='auto'){c.mode='auto';c.at=r.at;if(r.waitCur!==undefined)c.waitCur=r.waitCur}else c.mode=r?r.mode:'start'}
  else c.mode=m}}
function buildGear(){
 for(const b of $$('#gearCtl button'))b.onclick=()=>{setAllModes(b.dataset.v);refreshMenu()};
 const grid=document.getElementById('gearGrid');grid.innerHTML='';
 for(const gs of GEAR_SLOTS){
  const col=document.createElement('div');col.className='gcol';col.dataset.slot=gs.slot;
  const hasCur=gs.slot!=='nild';
  col.innerHTML=
   '<div class="ghead"><span class="gt">'+gs.title+'</span><span class="cap">'+gs.key+'</span></div>'+
   (hasCur?'<label class="glab">Currently worn</label><select class="gcur">'+gs.options.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select>':'')+
   '<label class="glab">'+(hasCur?'Swap in':'Drink')+'</label>'+
   '<select class="gsel">'+gs.options.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select>'+
   '<div class="ginfo"><div class="gchips"></div></div>'+
   '<div class="gbody">'+
    '<label class="gfield"><span>Bonus max HP</span><input class="ghp" type="number" step="5"></label>'+
    '<div class="seg gmode">'+['start','auto','manual'].map(m=>'<button data-v="'+m+'">'+MODE_LABEL[m]+'</button>').join('')+'</div>'+
    '<div class="gat"><div class="gat-l"></div><input type="range" min="5" max="95" step="1"></div>'+
    (hasCur?'<label class="gwait"><input type="checkbox"><span>after the Circlet heal</span></label>':'')+
    '<div class="grec"><span></span><button class="chip">apply</button></div>'+
   '</div>';
  grid.appendChild(col);
  const c=()=>SETTINGS[gs.slot];
  $('.gsel',col).addEventListener('change',e=>{c().id=e.target.value;refreshMenu()});
  if(hasCur)$('.gcur',col).addEventListener('change',e=>{SETTINGS.cur[gs.slot]=e.target.value;refreshMenu()});
  for(const b of $$('.gmode button',col))b.addEventListener('click',()=>{c().mode=b.dataset.v;refreshMenu()});
  $('.gat input',col).addEventListener('input',e=>{c().at=+e.target.value;refreshMenu()});
  if(hasCur)$('.gwait input',col).addEventListener('change',e=>{c().waitCur=e.target.checked;refreshMenu()});
  $('.grec .chip',col).addEventListener('click',()=>{const r=gearRec(gs.slot,c());if(r){c().mode=r.mode;if(r.at)c().at=r.at;if(r.waitCur!==undefined)c().waitCur=r.waitCur;refreshMenu()}});
  $('.ghp',col).addEventListener('change',e=>{const id=c().id;if(id&&id!=='none'){SETTINGS.itemHp[id]=Math.round(+e.target.value||0);refreshMenu()}});
 }
}
// what happens when the piece goes on: max HP moves, current HP never goes up, the excess is lost when the max drops
function gearAnalysis(slot,c,it){
 const M=maxBefore(slot),Mn=maxAfter(slot,c),T=it.eff?it.eff.below:null,out=[];
 if(slot==='nild')out.push('Max HP '+M+' → '+Mn+'. It goes first, raising the HP cap before the other swaps.');
 else{const cu=SETTINGS.cur[slot],hc=hpOf(cu);out.push('Replaces '+nameOf(cu)+' ('+(hc?'−'+hc+' HP max':'no HP max')+') with '+it.name+' : HP max '+M+' → '+Mn+'.')}
 if(c.mode==='start')out.push('Worn before the run: full HP at '+Mn+'.'+(T?' Triggers below '+fmtPv(Mn*T)+' HP.':''));
 else if(c.mode==='auto'){
  const H=M*c.at/100,loss=Math.max(0,H-Mn);
  out.push('Equipped at '+fmtPv(H)+' HP : '+(loss>0.5?'you lose '+fmtPv(loss)+' HP (max drops to '+Mn+').':'no HP lost.'));
  if(T){const pct=Math.min(H,Mn)/Mn;out.push('Then '+Math.round(pct*100)+' % HP : '+(pct<T?'armed; the next hit triggers the effect.':'not armed yet; drop below '+fmtPv(Mn*T)+' HP.'))}
 }else{
  out.push('Press '+(slot==='armor'?'1':slot==='ring'?'2':'3')+' (press again to restore your worn item).'+(Mn<M?' With '+Mn+' HP or less, no HP is lost.':''));
  if(T)out.push('Triggers below '+fmtPv(Mn*T)+' HP.');
 }
 return out.join(' ')}
// advice, computed from the max-HP bookkeeping (no simulation involved)
function gearRec(slot,c){
 const it=c.id!=='none'?ITEMS[c.id]:null;if(!it)return null;
 const M=maxBefore(slot),Mn=maxAfter(slot,c),T=it.eff?it.eff.below:null;
 if(slot==='nild')return{mode:'start',text:'First, before the run: +'+hpOf(c.id)+' HP max.'};
 const cu=SETTINGS.cur[slot],curIt=cu&&cu!=='none'?ITEMS[cu]:null;
 if(Mn>=M)return{mode:'start',text:'Before the run: max HP '+M+' → '+Mn+'.'};
 const at=Math.max(5,Math.min(95,Math.floor(Mn/M*100))),wait=!!(curIt&&curIt.eff);
 return{mode:'auto',at,waitCur:wait,text:'Equip when HP ≤ '+Mn+' (0 HP lost)'+(T?' · triggers below '+fmtPv(Mn*T):'')+(wait?' · after healing from '+curIt.name.split(' ')[0]:'')+'.'}}
function refreshGear(){
 const used=GEAR_SLOTS.map(s=>SETTINGS[s.slot]).filter(c=>c.id!=='none');
 for(const b of $$('#gearCtl button'))b.classList.toggle('on',used.length>0&&used.every(c=>c.mode===b.dataset.v));
 for(const col of $$('#gearGrid .gcol')){
  const slot=col.dataset.slot,c=SETTINGS[slot],it=c.id!=='none'?ITEMS[c.id]:null;
  $('.gsel',col).value=c.id;
  const gc=$('.gcur',col);if(gc)gc.value=SETTINGS.cur[slot];
  col.classList.toggle('off',!it);
    const hp=it?SETTINGS.itemHp[c.id]:0;
  $('.gchips',col).innerHTML=it?[hp?'<i>'+(hp>0?'+':'')+hp+' HP max</i>':'',it.def?'<i>+'+it.def+' DEF</i>':'',it.spd?'<i>+'+it.spd+' speed</i>':'',it.eff&&it.eff.invuln?'<i class="g">invulnerable '+String(it.eff.invuln/60).replace('.',',')+' s</i>':'',it.eff&&it.eff.heal?'<i class="g">heals '+it.eff.heal+'</i>':''].join(''):'';
  const hpEl=$('.ghp',col);if(document.activeElement!==hpEl)hpEl.value=it?hp:'';hpEl.disabled=!it;
  for(const b of $$('.gmode button',col)){b.classList.toggle('on',b.dataset.v===c.mode);b.disabled=!it}
  const at=$('.gat',col),M=it?maxBefore(slot):SETTINGS.hp;at.hidden=!(it&&c.mode==='auto');
  $('input',at).value=c.at;$('input',at).style.setProperty('--p',((c.at-5)/90*100)+'%');
  $('.gat-l',at).innerHTML='equip when HP ≤ <b>'+c.at+' %</b> of max <em>('+fmtPv(M*c.at/100)+' HP)</em>';
  const w=$('.gwait',col);if(w){const cu=SETTINGS.cur[slot],ci=cu&&cu!=='none'?ITEMS[cu]:null,can=!!(ci&&ci.eff)&&c.mode==='auto';w.hidden=!can;$('input',w).checked=!!c.waitCur;
   $('span',w).textContent='after healing from '+(ci?ci.name.split(' ')[0]:'the worn item')}
  const rec=it?gearRec(slot,c):null,rr=$('.grec',col);rr.hidden=!rec;
  if(rec){$('span',rr).textContent=rec.text;const same=c.mode===rec.mode&&(!rec.at||c.at===rec.at)&&(rec.waitCur===undefined||!!c.waitCur===rec.waitCur);$('.chip',rr).hidden=same;rr.classList.toggle('ok',same)}
 }
}
// ---------------- in game
const toasts=[];let toastIdx=0;
function gearReset(){toasts.length=0;toastIdx=0}
const advOk={};
function gearPump(){
 for(const gs of GEAR_SLOTS){const c=g.gear[gs.slot];if(!c||c.mode!=='manual'||g.eq[gs.slot]||gs.slot==='nild'){advOk[gs.slot]=false;continue}
  const a=manualAdvice(gs.slot,c);if(a.ok&&advOk[gs.slot]===false){beep(988);toasts.push({text:'You can equip '+(gs.slot==='armor'?'armour':'ring')+' : press '+gs.key+' (0 HP lost)',t:performance.now()})};advOk[gs.slot]=a.ok}while(toastIdx<g.events.length){toasts.push({text:g.events[toastIdx].text.replace(/ → /g,' > ').replace(/’/g,"'"),t:performance.now()});toastIdx++}}
function manualAdvice(slot,c){ // for a piece you put on yourself: is it a good moment?
 const key=slot==='armor'?'1':slot==='ring'?'2':'3',it=g.itemOf(slot);
 if(slot==='nild')return{ok:true,key,slot,it,mn:g.previewMax(slot),txt:'press 3 · drink before other swaps',col:'#7bff8a',why:'+'+it.hp+' HP max, no HP lost'};
 const cu=g.curOf(slot),mn=g.previewMax(slot),T=it.eff?it.eff.below:0;
 const base={key,slot,it,mn,T,arm:T?Math.round(mn*T):0};
 if(c.waitCur&&cu&&cu.eff&&!(g.cdItem[cu.id]>0))return{...base,ok:false,wait:true,txt:'press '+key+' · wait for '+cu.name.split(' ')[0]+' to heal',col:'#ffcc66'};
 if(mn>=g.maxHp)return{...base,ok:true,txt:'press '+key+' · raises max HP',col:'#7bff8a',why:'Max HP '+g.maxHp+' → '+mn};
 if(g.hp<=mn)return{...base,ok:true,txt:'press '+key+' · now, 0 HP lost',col:'#7bff8a',why:'Max HP '+g.maxHp+' → '+mn+', 0 HP lost'+(T?' · triggers below '+base.arm+' HP':'')};
 return{...base,ok:false,txt:'press '+key+' · wait: HP > '+mn+' (−'+Math.round(g.hp-mn)+')',col:'#ffcc66'}}
let audio=null;
function beep(f=880){try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();const o=audio.createOscillator(),v=audio.createGain();o.frequency.value=f;o.type='square';v.gain.value=.05;o.connect(v);v.connect(audio.destination);o.start();v.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.18);o.stop(audio.currentTime+.2)}catch(e){}}
// the guide: a wide HP bar with the press-here lines, and a loud banner when it is time
function drawGearGuide(){
 const pend=GEAR_SLOTS.map(gs=>({gs,c:g.gear[gs.slot]})).filter(r=>r.c&&r.c.mode==='manual'&&!g.eq[r.gs.slot]&&!(r.gs.slot==='nild'&&g.eq.nild)).map(r=>manualAdvice(r.gs.slot,r.c));
 if(!pend.length)return;
 const W=620,H=24,x=GW/2-W/2,y=22,mx=g.maxHp,now=performance.now()/1000;
 cx.fillStyle='rgba(6,8,13,.8)';cx.fillRect(x-10,y-16,W+20,H+44);cx.strokeStyle='rgba(255,255,255,.16)';cx.lineWidth=2;cx.strokeRect(x-9,y-15,W+18,H+42);
 cx.fillStyle='#10141f';cx.fillRect(x,y,W,H);
 cx.fillStyle=g.hp/mx<.25?'#e8573a':'#62e448';cx.fillRect(x,y,Math.max(0,W*Math.min(1,g.hp/mx)),H);
 for(const a of pend){ if(a.slot==='nild')continue;
  const px=x+W*Math.min(1,Math.max(0,a.mn/mx));
  cx.fillStyle=a.ok?'#7bff8a':'#ffcc66';cx.fillRect(px-2,y-8,4,H+16);
  cx.fillStyle='#2a2f40';cx.fillRect(px-13,y-30,26,22);cx.strokeStyle=a.ok?'#7bff8a':'#ffcc66';cx.lineWidth=2;cx.strokeRect(px-12,y-29,24,20);
  drawText(px,y-19,a.key,{sc:.32,h:'c',v:'m'});
  if(a.arm){const ax=x+W*Math.min(1,a.arm/mx);cx.fillStyle='#ff7a5c';cx.fillRect(ax-1,y+H,2,10);}
 }
 drawText(x+W/2,y+H/2+1,Math.max(0,Math.round(g.hp))+' / '+mx+' HP',{sc:.34,h:'c',v:'m'});
 drawText(x,y+H+22,'green/yellow: equip without HP loss · orange: effect triggers below',{sc:.24,v:'m',color:'#9aa1b5'});
 // banner: the first piece that is ready, in the order consumable > armor > ring
 const ready=pend.find(a=>a.ok);
 if(ready){const t=(Math.sin(now*9)+1)/2,w=Math.max(640,textW('EQUIP '+ready.it.name,.5)+80),by=GH*.22;
  cx.globalAlpha=.55+.45*t;cx.fillStyle='#16351c';cx.fillRect(GW/2-w/2,by,w,86);cx.strokeStyle='#7bff8a';cx.lineWidth=3;cx.strokeRect(GW/2-w/2+1,by+1,w-2,84);cx.globalAlpha=1;
  cx.fillStyle='#2a2f40';cx.fillRect(GW/2-w/2+16,by+16,54,54);cx.strokeStyle='#7bff8a';cx.strokeRect(GW/2-w/2+17,by+17,52,52);drawText(GW/2-w/2+43,by+43,ready.key,{sc:.9,h:'c',v:'m'});
  drawText(GW/2-w/2+86,by+25,(ready.slot==='nild'?'DRINK ':'EQUIP ')+ready.it.name.toUpperCase(),{sc:.5,v:'m',color:'#b9ffc4'});
  drawText(GW/2-w/2+86,by+60,ready.why||'',{sc:.3,v:'m',color:'#e8efe9'});
 }else{const w0=pend.find(a=>a.wait);if(w0){drawText(GW/2,GH*.22+20,'Wait for '+g.curOf(w0.slot).name+' to heal, then press '+w0.key,{sc:.34,h:'c',v:'m',color:'#ffcc66'})}}
}
function slotState(slot){
 const c=g.gear[slot];if(!c)return null;
 if(g.eq[slot]){
  if(slot==='nild')return{txt:'used',col:'#9ad0ff'};
  const it=g.itemOf(slot),cd=g.cdOf(slot);
  if(cd>0)return{txt:cd>3600?'effect used':'cooldown '+Math.ceil(cd/60)+' s',col:'#ff9f6b'};
  return{txt:it.eff?'equipped · ready':'equipped',col:'#7bff8a'}}
 if(c.mode==='auto')return{txt:'auto below '+c.at+' %',col:'#ffcc66'};
 if(c.mode==='manual'){const a=manualAdvice(slot,c);return{txt:a.txt,col:a.col}}
 return{txt:'stored',col:'#8d95a8'}}
function drawGearHud(){
 drawGearGuide();
 const rows=GEAR_SLOTS.map(gs=>({gs,st:slotState(gs.slot)})).filter(r=>r.st);
 if(rows.length){
  const x=10,w=640,rh=58,h=rows.length*rh+12,y=GH-h-10;
  cx.fillStyle='rgba(6,8,13,.78)';cx.fillRect(x,y,w,h);cx.strokeStyle='rgba(255,255,255,.14)';cx.lineWidth=2;cx.strokeRect(x+1,y+1,w-2,h-2);
  rows.forEach((r,i)=>{const yy=y+8+i*rh;
   cx.fillStyle='#2a2f40';cx.fillRect(x+10,yy+4,34,34);drawText(x+27,yy+21,r.gs.key,{sc:.46,h:'c',v:'m'});
   drawText(x+56,yy+12,({matrix:'Magic Protective Matrix',rags:'Wretched Rags',amulet:'Amulet of Restoration',circlet:'Nightmatter Circlet',blood:'Blood Nildrop'})[g.gear[r.gs.slot].id],{sc:.34,v:'m'});
   drawText(x+56,yy+38,r.st.txt,{sc:.3,v:'m',color:r.st.col})})}
 if(g.invuln>0){const s=g.invuln/60;drawText(GW/2,GH/2-90,'INVULNERABLE '+s.toFixed(1).replace('.',','),{sc:.42,h:'c',v:'m',color:'#7fe9ff'})}
 const now=performance.now();for(let i=toasts.length-1;i>=0;i--)if(now-toasts[i].t>3600)toasts.splice(i,1);
 toasts.slice(-3).forEach((t,i)=>{const a=Math.min(1,(3600-(now-t.t))/500);cx.globalAlpha=Math.max(0,a);const w=textW(t.text,.34)+34;
  cx.fillStyle='rgba(10,12,20,.82)';cx.fillRect(GW/2-w/2,100+i*40,w,32);cx.strokeStyle='#f2c14e';cx.lineWidth=2;cx.strokeRect(GW/2-w/2+1,101+i*40,w-2,30);
  drawText(GW/2,116+i*40,t.text,{sc:.34,h:'c',v:'m'});cx.globalAlpha=1})}
function drawInvulnHalo(rot){
 if(g.invuln<=0)return;const t=performance.now()/1000;cx.save();cx.translate(g.px,g.py);
 cx.strokeStyle='rgba(127,233,255,'+(.55+.25*Math.sin(t*10))+')';cx.lineWidth=.9;cx.beginPath();cx.arc(0,0,8+Math.sin(t*8)*.6,0,6.283);cx.stroke();
 cx.fillStyle='rgba(127,233,255,.12)';cx.fill();cx.restore()}
