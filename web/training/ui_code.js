// ------------------------------------------------------------------ state
const DEFAULTS={seed:'',spd:57,hp:1245,def:43,lvl:5,mode:0,hard:false,rspeed:0,chases:4,layout:'azerty',ghost:1,
 hLose:false,loseAt:20,hDmg:false,dmgMult:1.5,hHits:false,maxHits:10,
 classId:TRAINING_CATALOG.classes.find(c=>c.name==='Wizard')?.id||TRAINING_CATALOG.classes[0].id,equipment:{},consumableId:''};
const SETTINGS=JSON.parse(JSON.stringify(DEFAULTS));
let RETURNING=false;
try{const raw=localStorage.getItem('rotmg:training:patience:settings:v2')||localStorage.getItem('rotmg:training:patience:settings:v1');RETURNING=!!raw;
 const sv=JSON.parse(raw||'{}');if(sv&&typeof sv==='object')for(const k of Object.keys(DEFAULTS))if(Object.hasOwn(sv,k))SETTINGS[k]=sv[k];
}catch(e){}
const MODES=['solo','group','rails'];
let scene='menu',g=null,zoom=1,lastResult=null;
const VW=[18.23*8,23.5*8,31*8],VH=[12.8*8,16.5*8,21.77*8];
const keys={},pressed={};
let pAnim=0,ghostAnim=[0,0,0],countdown=0;
const LIM={spd:[0,100,1],def:[0,100,1],hp:[5,2000,1],lvl:[1,10,1],loseAt:[5,95,5],dmgMult:[.25,4,.25],maxHits:[1,99,1],chases:[3,6,1]};
function clampSettings(){for(const k in LIM){const [a,b,s]=LIM[k];let v=+SETTINGS[k];if(!isFinite(v))v=DEFAULTS[k];v=Math.round(v/s)*s;SETTINGS[k]=Math.round(Math.max(a,Math.min(b,v))*100)/100}
 if(SETTINGS.layout!=='qwerty')SETTINGS.layout='azerty';validateSelections()}
function save(){try{localStorage.setItem('rotmg:training:patience:settings:v2',JSON.stringify(SETTINGS))}catch(e){}}
// key map, by the letter printed on the key (event.key)
const KEYMAPS={
 azerty:{up:'z',left:'q',down:'s',right:'d',rotL:'a',rotR:'e',resetAll:'w',resetRot:'c',offset:'x',zoomIn:'p',zoomOut:'o'},
 qwerty:{up:'w',left:'a',down:'s',right:'d',rotL:'q',rotR:'e',resetAll:'z',resetRot:'c',offset:'x',zoomIn:'p',zoomOut:'o'}};
let KM=KEYMAPS[SETTINGS.layout]||KEYMAPS.azerty;
function startGame(){clampSettings();save();KM=KEYMAPS[SETTINGS.layout];
 const rawSeed=String(SETTINGS.seed ?? '').trim();
 const runSeed=rawSeed!=='' && /^\d+$/.test(rawSeed) && Number(rawSeed)<=4294967295 ? Number(rawSeed) : Math.floor(Math.random()*4294967295);
 g=new Game(runSeed,{hp:SETTINGS.hp,def:SETTINGS.def,spd:SETTINGS.spd,lvl:SETTINGS.lvl,hard:SETTINGS.hard,mode:MODES[SETTINGS.mode],rspeed:SETTINGS.rspeed,chases:SETTINGS.chases,...selectionOptions(),
  loseAt:SETTINGS.hLose?SETTINGS.loseAt/100:0,dmgMult:SETTINGS.hDmg?SETTINGS.dmgMult:1,maxHits:SETTINGS.hHits?SETTINGS.maxHits:0});
 g.seed=runSeed;document.getElementById('gameMenu').textContent='Pause';
 for(const k in keys)keys[k]=false;for(const k in pressed)pressed[k]=false;
 scene='arena';countdown=180;pAnim=0;ghostAnim=[0,0,0];zoom=1;acc=0;beginRun();
 menuEl.hidden=true;cv.classList.remove('dim');cv.focus()}
function showMenu(){
 document.getElementById('gameMenu').textContent='Settings';
 scene='menu';paused=false;ovEl.hidden=true;menuEl.hidden=false;showStep(5);cv.classList.add('dim');for(const k in keys)keys[k]=false;refreshMenu()}
function mousePos(e){const r=cv.getBoundingClientRect();return[(e.clientX-r.left)*GW/r.width,(e.clientY-r.top)*GH/r.height]}
cv.addEventListener('mousedown',()=>{cv.focus()});
// ------------------------------------------------------------------ HTML menu
const menuEl=document.getElementById('menu');
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const fmt={spd:v=>v,hp:v=>v,def:v=>v,lvl:v=>v,loseAt:v=>v+' %',dmgMult:v=>'×'+String(v),maxHits:v=>v};
function setRange(r,key){const [a,b,s]=LIM[key];r.min=a;r.max=b;r.step=s;r.value=SETTINGS[key];r.style.setProperty('--p',((SETTINGS[key]-a)/(b-a)*100)+'%')}
function cap(t,cls=''){return '<span class="cap '+cls+'">'+t.toUpperCase()+'</span>'}
function refreshMenu(){
 clampSettings();save();
 for(const el of $$('.stat')){const k=el.dataset.key;const inp=$('.num input',el);if(document.activeElement!==inp)inp.value=SETTINGS[k];setRange($('input[type=range]',el),k)}
 for(const s of $$('.seg')){const key=s.dataset.set;const cur=key==='hard'?(SETTINGS.hard?'1':'0'):String(SETTINGS[key]);for(const b of $$('button',s))b.classList.toggle('on',b.dataset.v===cur)}
 const hb=SETTINGS.hard?20:0;
 for(const el of $$('.hc')){const on=SETTINGS[el.dataset.on],k=el.dataset.key;el.classList.toggle('off',!on);$('.switch',el).classList.toggle('on',on);
  $('.v',el).textContent=fmt[k](SETTINGS[k]);const r=$('input[type=range]',el);setRange(r,k);r.disabled=!on;
  let s='';
  if(k==='loseAt')s=on?'defeat at '+Math.round(SETTINGS.hp*SETTINGS.loseAt/100)+' HP':'';
  if(k==='dmgMult')s=on?'blue arrow '+Math.round((45+hb)*SETTINGS.dmgMult)+' · red spike '+Math.round(Math.max(100+hb-SETTINGS.def,(100+hb)/10)*SETTINGS.dmgMult):'';
  if(k==='maxHits')s=on?'defeat at la '+SETTINGS.maxHits+' hits':'';
  $('.sum',el).textContent=s}
 // keyboard
 const m=KEYMAPS[SETTINGS.layout];
 $('#cluster').innerHTML=cap(m.rotL,'cam')+cap(m.up,'mv')+cap(m.rotR,'cam')+cap(m.left,'mv')+cap(m.down,'mv')+cap(m.right,'mv');
 $('#binds').innerHTML=
  '<span class="k">'+cap(m.up)+cap(m.left)+cap(m.down)+cap(m.right)+'</span><span>move</span>'+
  '<span class="k">'+cap(m.rotL)+cap(m.rotR)+'</span><span>rotate camera</span>'+
  '<span class="k">'+cap(m.zoomOut)+cap(m.zoomIn)+'</span><span>zoom</span>'+
  '<span class="k">'+cap('Space')+'</span><span>ability (when equipped)</span>'+
  '<span class="k">'+cap('r')+cap('Esc')+'</span><span>restart · pause</span>';
 // facts
 const mult=SETTINGS.hDmg?SETTINGS.dmgMult:1,goal=SETTINGS.chases;
 const red=Math.max(100+hb-SETTINGS.def,(100+hb)/10)*mult,blue=(70+hb)*mult;
 const budget=SETTINGS.hp-(SETTINGS.hLose?Math.round(SETTINGS.hp*SETTINGS.loseAt/100):0);
 const walk=8*(4+5.6*(SETTINGS.spd/75))/60*60/8;
 $('#facts').innerHTML=
  '<div class="fact"><b class="acc">'+goal*10+' s</b><span>'+goal+' chases</span></div>'+
  '<div class="fact"><b>'+walk.toFixed(1)+'</b><span>tiles per second</span></div>'+
  '<div class="fact"><b class="red">'+Math.round(red)+' / '+Math.round(blue)+'</b><span>spike red / blue</span></div>'+
  '<div class="fact"><b>'+budget+' HP</b><span>HP before defeat</span></div>';
 const b=loadBest(recordOptions());
 $('#recInfo').textContent=(SETTINGS.hard?'hard':'normal')+' '+MODES[SETTINGS.mode]+' '+SETTINGS.chases+' chases : '+(b?(b.win?'win, '+b.lost+' HP lost':fmtS(b.frames)+' survived'):'no best yet');$('#recClear').hidden=!b;
 refreshGear();
 const hl=[SETTINGS.hLose?'HP threshold '+SETTINGS.loseAt+' %':'',SETTINGS.hDmg?'damage ×'+String(SETTINGS.dmgMult):'',SETTINGS.hHits?SETTINGS.maxHits+' max hits':''].filter(Boolean);
 const gl=selectionSummary().map(escapeText);
 const rc=[['2','Character',escapeText(chosenClass().name)+' · Speed <b>'+SETTINGS.spd+'</b> · HP <b>'+SETTINGS.hp+'</b> · DEF <b>'+SETTINGS.def+'</b> · Lv <b>'+SETTINGS.lvl+'</b>'],
  ['3','Mode','<b>'+(SETTINGS.hard?'hard':'normal')+'</b> · '+MODES[SETTINGS.mode]+' · <b>'+SETTINGS.chases+'</b> chases'],
  ['4','Handicap',hl.length?hl.join(' · '):'<span class="no">none</span>'],
  ['1','Loadout',gl.length?gl.join(' · '):'<span class="no">none</span>']];
 $('#recap').innerHTML=rc.map(([n,t,v])=>'<button class="rc" data-step="'+n+'"><span class="rt">'+t+'</span><span class="rv">'+v+'</span><i>edit</i></button>').join('');
 const L=$('#last');
 if(!lastResult)L.innerHTML='&nbsp;';
 else if(lastResult.win)L.innerHTML='<span class="win">Last run: '+(lastResult.hard?'hard':'normal')+' cleared</span> with '+lastResult.hp+' / '+lastResult.max+' HP, '+lastResult.hits+' hits';
 else L.innerHTML='<span class="lose">Last run: '+(lastResult.lost==='hp'?'defeat below HP threshold':lastResult.lost==='hits'?'hit-limit defeat':'death')+'</span> at '+lastResult.secs+' s, '+lastResult.hits+' hits';
}
let step=1;
function showStep(n){step=Math.max(1,Math.min(5,n));
 for(const b of $$('#steps button')){const k=+b.dataset.step;b.classList.toggle('on',k===step);b.classList.toggle('done',k<step)}
 for(const p of $$('.pane'))p.classList.toggle('on',+p.dataset.pane===step);
 $('#navBack').hidden=step===1;$('#navNext').hidden=step===5;menuEl.classList.toggle('s5',step===5)}
function bindMenu(){
 for(const b of $$('#steps button'))b.setAttribute('aria-label',b.dataset.step+'. '+$('span',b).textContent);
 menuEl.addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(b)showStep(+b.dataset.step)});
 $('#navBack').addEventListener('click',()=>showStep(step-1));$('#navNext').addEventListener('click',()=>showStep(step+1));
 showStep(RETURNING?5:1);
 for(const el of $$('.stat')){const k=el.dataset.key;
  for(const b of $$('.num button',el)){let t=null,iv=null;
   const step=e=>{SETTINGS[k]=+SETTINGS[k]+(+b.dataset.d)*LIM[k][2]*(e&&e.shiftKey?5:1);refreshMenu()};
   b.addEventListener('pointerdown',e=>{step(e);t=setTimeout(()=>{iv=setInterval(()=>step(e),70)},380)});
   const stop=()=>{clearTimeout(t);clearInterval(iv)};b.addEventListener('pointerup',stop);b.addEventListener('pointerleave',stop)}
  const inp=$('.num input',el);inp.id='training-'+k;$('label',el).htmlFor=inp.id;$('input[type=range]',el).setAttribute('aria-label',$('label',el).textContent+' slider');
  inp.addEventListener('change',()=>{SETTINGS[k]=+inp.value;refreshMenu()});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){inp.blur();e.stopPropagation()}});
  inp.addEventListener('wheel',e=>{e.preventDefault();SETTINGS[k]=+SETTINGS[k]-Math.sign(e.deltaY)*LIM[k][2]*(e.shiftKey?5:1);refreshMenu()},{passive:false});
  $('input[type=range]',el).addEventListener('input',e=>{SETTINGS[k]=+e.target.value;refreshMenu()})}
 for(const s of $$('.seg'))for(const b of $$('button',s))b.addEventListener('click',()=>{const key=s.dataset.set,v=b.dataset.v;
  if(key==='hard')SETTINGS.hard=v==='1';else if(key==='layout')SETTINGS.layout=v;else SETTINGS[key]=+v;refreshMenu()});
 for(const el of $$('.hc')){const on=el.dataset.on,k=el.dataset.key;
  $('.hc-head',el).addEventListener('click',()=>{SETTINGS[on]=!SETTINGS[on];refreshMenu()});
  $('input[type=range]',el).addEventListener('input',e=>{SETTINGS[k]=+e.target.value;refreshMenu()})}
 for(const c of $$('.chip[data-preset]'))c.addEventListener('click',()=>{Object.assign(SETTINGS,c.dataset.preset==='game'?{spd:60,hp:800,def:40,lvl:5}:{spd:57,hp:1245,def:43,lvl:5});refreshMenu()});
 $('#start').addEventListener('click',startGame);
 $('#recClear').addEventListener('click',()=>{try{localStorage.removeItem(recKey(recordOptions()))}catch(e){}refreshMenu()});
 // title in the game's own pixel font
 const tc=$('#titleCanvas'),tk=tc.getContext('2d'),tt='You test the patience of a GOD!',F='28px "Press Start 2P",monospace';
 tk.font=F;tc.width=Math.ceil(tk.measureText(tt).width)+10;tc.height=46;tk.font=F;tk.textBaseline='top';tk.fillStyle='#000';tk.fillText(tt,7,6);tk.fillStyle='#fff';tk.fillText(tt,4,3);

 const seedInput=$('#seed');seedInput.value=SETTINGS.seed || (SETTINGS.seed===0?'0':'');seedInput.addEventListener('change',()=>{SETTINGS.seed=seedInput.value;save()});
 $('#gameMenu').addEventListener('click',()=>{if(scene==='arena'){if(g.ended)showMenu();else setPause(!paused)}});
 buildGear();refreshMenu();
}

function recordOptions(){return {hard:SETTINGS.hard,mode:MODES[SETTINGS.mode],chases:SETTINGS.chases,hp:SETTINGS.hp,def:SETTINGS.def,spd:SETTINGS.spd,lvl:SETTINGS.lvl,rspeed:SETTINGS.rspeed,loseAt:SETTINGS.hLose?SETTINGS.loseAt/100:0,dmgMult:SETTINGS.hDmg?SETTINGS.dmgMult:1,maxHits:SETTINGS.hHits?SETTINGS.maxHits:0,...selectionOptions()}}
