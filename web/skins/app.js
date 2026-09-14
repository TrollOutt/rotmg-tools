import { Renderer } from './renderer.js';
import { resolveExactTarget } from './contracts.mjs';

export const FRAME_MS=300;
export const ATTACK_PERIOD_MS=600;
export function attackAnchorX(worldX,frameWidth,bodyWidth,pixelScale,left=false){const extra=Math.max(0,frameWidth-bodyWidth);return worldX+(left?-1:1)*extra*pixelScale/2}
export function rankSequence(q){return[(q.set===0?0:1),(q.action==='idle'?0:q.action==='walk'?1:2),q.direction==='front'?0:q.direction==='side'?1:q.direction==='back'?2:3,q.set,q.actionRaw,q.directionRaw]}
export function initialSequence(sequences){return[...sequences].sort((a,b)=>{const x=rankSequence(a),y=rankSequence(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0})[0]}
export function dyeCategory(d){return d?.kind==='remove'?'remove':d?.animation?'animated':d?.kind==='textile'?'textiles':d?.kind==='color'?'colors':'other'}
export function filterDyes(dyes,target,query,category){query=String(query||'').toLowerCase();return dyes.filter(d=>d.target===target&&d.kind!=='remove'&&(!query||d.id.toLowerCase().includes(query))&&(category==='all'||dyeCategory(d)===category))}
export function directionFromPointer(px,py,x,y){const dx=px-x,dy=py-y;if(Math.abs(dx)>Math.abs(dy))return{raw:0,left:dx<0};return{raw:dy<0?3:2,left:false}}
export function familyOrder(a,b){if(a==='Other')return 1;if(b==='Other')return-1;if(a==='Set skins')return 1;if(b==='Set skins')return-1;return a.localeCompare(b)}

let mountedInstance=null,mountPromise=null;

export function mount(container=document.getElementById('skinViewerRoot'),options={}){
  if(!container)return Promise.reject(new Error('Skin Viewer mount container is missing'));
  if(mountPromise){mountedInstance?.setActive(true);return mountPromise}
  mountPromise=createViewer(container,options).then(instance=>{mountedInstance=instance;return instance}).catch(error=>{mountPromise=null;throw error});
  return mountPromise;
}
export function unmount(){if(!mountedInstance)return false;mountedInstance.setActive(false);return true}
export async function selectTarget(target){const instance=await (mountPromise||mount());return instance.select(target)}
export async function getState(){const instance=await (mountPromise||mount());return instance.getState()}

async function createViewer(host,options={}){
const root=host.shadowRoot||host.attachShadow({mode:'open'});
const [markup]=await Promise.all([
  fetch(new URL('./view.html',import.meta.url)).then(r=>{if(!r.ok)throw Error(`view.html: ${r.status}`);return r.text()})
]);
host.dataset.integrated=String(Boolean(options.integrated??host.dataset.integrated==='true'));
root.innerHTML=`<link rel="stylesheet" href="${new URL('./style.css',import.meta.url).href}">${markup}`;
let active=true;
const $=x=>root.getElementById(x);
const [skins,dyes,classes,realmAtlas]=await Promise.all(['assets/skins/generated/skins.json','assets/skins/generated/dyes.json','assets/skins/generated/classes.json','assets/atlas/atlas.json'].map(x=>fetch(x).then(r=>{if(!r.ok)throw Error(`${x}: ${r.status}`);return r.json()})));
const [realmCombat,realmThingIndex,realmThingBuffer]=await Promise.all([
  fetch('assets/atlas/combat.json').then(r=>r.ok?r.json():null).catch(()=>null),
  fetch('assets/atlas/things.json').then(r=>r.ok?r.json():null).catch(()=>null),
  fetch('assets/atlas/things.bin').then(r=>r.ok?r.arrayBuffer():null).catch(()=>null)
]);
const realmThings=realmThingIndex&&realmThingBuffer?{index:realmThingIndex,at:new Uint16Array(realmThingBuffer)}:null;
/* V313_INDEX_BRIDGE: lightweight exact links into the existing Index/wiki projection. */
const indexBridge=await fetch('assets/skins/generated/index-links.json').then(r=>r.ok?r.json():null).catch(()=>null);
const canvas=$('canvas'),worldBg=$('worldBg'),fxCanvas=$('fxCanvas'),renderer=new Renderer(canvas),bg=worldBg.getContext('2d'),fx=fxCanvas.getContext('2d'),CLASS_ORDER=['Wizard','Priest','Archer','Rogue','Warrior','Knight','Paladin','Assassin','Necromancer','Huntress','Mystic','Trickster','Sorcerer','Ninja','Samurai','Bard','Summoner','Kensei'];
classes.sort((a,b)=>{const ai=CLASS_ORDER.indexOf(a.name),bi=CLASS_ORDER.indexOf(b.name);return(ai<0?999:ai)-(bi<0?999:bi)||a.name.localeCompare(b.name)});
const S={skin:null,seq:null,index:0,left:false,dyes:{clothing:null,accessory:null},last:0,facingRaw:2,attackUntil:0,shooting:false,attackStart:0,attackSpeed:1,nextShotAt:0,projectiles:[],keys:new Set(),world:{x:canvas.width/2,y:canvas.height/2,scale:4},player:{x:0,y:0},spawn:{x:0,y:0},camera:{scale:realmAtlas.px*4},playArea:null,beachArea:null,studioArea:{x0:-20,y0:-13,x1:20,y1:13},beachBeacon:null,modeState:{beach:null,studio:{player:{x:0,y:0},spawn:{x:0,y:0},scale:realmAtlas.px*4}},mapDirty:true,lastMapDraw:0,pointer:{x:canvas.width/2,y:canvas.height/2},className:'',family:'',dyeTarget:'clothing',dyeCategory:'all'};
S.attackSpeed=Math.max(.25,Math.min(4,Number(localStorage.getItem('skinViewerAttackSpeed'))||1));
/* V312_COMBO_FAVORITES: exact local skin + dye combinations, user-named. */
const COMBO_FAVORITES_KEY='skinViewerComboFavoritesV1';
function normalizeComboDyeRef(ref){
  if(!ref)return null;
  if(typeof ref==='object')return ref;
  if(typeof ref!=='string')return null;
  const exact=dyes.filter(dye=>dye.id===ref);
  return exact.length===1?comboDyeRef(exact[0]):null;
}
function normalizeComboFavorite(favorite){
  if(!favorite||typeof favorite!=='object'||Array.isArray(favorite))return null;
  const skinId=typeof favorite.skinId==='string'?favorite.skinId:(typeof favorite.skin==='string'?favorite.skin:'');
  const clothing=normalizeComboDyeRef(favorite.clothing);
  const accessory=normalizeComboDyeRef(favorite.accessory);
  return {...favorite,skinId,clothing,accessory,signature:favorite.signature||comboSignature(skinId,clothing,accessory)};
}
function readComboFavorites(){try{const value=JSON.parse(localStorage.getItem(COMBO_FAVORITES_KEY)||'[]');return Array.isArray(value)?value.map(normalizeComboFavorite).filter(Boolean):[]}catch{return[]}}
let comboFavorites=readComboFavorites();
S.catalogMode=localStorage.getItem('skinViewerCatalogMode')==='favorites'?'favorites':'skins';

/* V311B_STUDIO_THEME */
S.studioTheme=localStorage.getItem('skinViewerStudioTheme')==='light'?'light':'dark';
/* V39_STUDIO_MODE: a neutral inspection background beside the real Beach pocket. */
S.worldMode=localStorage.getItem('skinViewerWorldMode')==='studio'?'studio':'beach';
bg.imageSmoothingEnabled=false;fx.imageSmoothingEnabled=false;
const atlasImages=new Map();
function atlas(sheet){if(!sheet)return null;if(!atlasImages.has(sheet)){const i=new Image();i.src=`assets/skins/textures/${sheet}.png`;atlasImages.set(sheet,i)}return atlasImages.get(sheet)}
function fitDraw(ctx,img,rect,size){if(!img||!img.complete||!img.naturalWidth||!rect)return false;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,size,size);const scale=Math.max(1,Math.floor(Math.min((size-4)/rect.w,(size-4)/rect.h))),w=rect.w*scale,h=rect.h*scale;ctx.drawImage(img,rect.x,rect.y,rect.w,rect.h,Math.floor((size-w)/2),Math.floor((size-h)/2),w,h);return true}
function makeThumb(source,size=40,extra=''){const c=document.createElement('canvas');c.width=c.height=size;c.className=`thumb ${extra}`.trim();const img=atlas(source?.sheet),draw=()=>fitDraw(c.getContext('2d'),img,source?.rect,size);if(!draw()&&img)img.addEventListener('load',draw,{once:true});return c}
function thumbFrame(s){return s.sequences.find(q=>q.set===0&&q.action==='idle'&&q.direction==='front')?.frames.find(f=>f.spriteAvailable)||s.sequences.find(q=>q.set===0&&q.action==='idle'&&q.direction==='side')?.frames.find(f=>f.spriteAvailable)||s.sequences.find(q=>q.set===0&&q.action==='walk'&&q.direction==='front')?.frames.find(f=>f.spriteAvailable)||s.frames.find(f=>f.spriteAvailable)}
function makeSpriteThumb(s,size=40){const f=thumbFrame(s);return makeThumb(f?{sheet:f.atlas,rect:f.rect}:null,size)}
/* V36_DYE_PREVIEW: color dyes keep their real client item sprite as the main preview, with a color swatch overlay. */
function makeDyeThumb(d,size=38){const wrap=document.createElement('span');wrap.className='dye-preview';let effect;if(d?.kind==='color'&&d?.icon){effect=makeThumb(d.icon,size,'dye-effect dye-item-icon')}else if(d?.textile){effect=makeThumb(d.textile,size,'dye-effect')}else if(d?.icon){effect=makeThumb(d.icon,size,'dye-effect dye-item-icon')}else{effect=document.createElement('span');effect.className='thumb dye-effect'}wrap.append(effect);if(d?.kind==='color'){const sw=document.createElement('span');sw.className='color-preview-swatch';sw.style.background=d.color||'#3c4352';sw.title=d.color||'Color dye';wrap.append(sw)}else if(d?.icon){const badge=makeThumb(d.icon,18,'dye-icon-badge');badge.title='Client dye item sprite';wrap.append(badge)}if(d?.animation){const mark=document.createElement('span');mark.className='anim-mark';mark.textContent='↻';mark.title=d.animation.type;wrap.append(mark)}return wrap}
function makeClassThumb(c,size=34){return makeThumb(c?.icon,size,'class-thumb')}
/* V314_SELECTED_INDEX_START */
let v314SelectedIndexQueued=false;

function v314IndexHref(id){return '#index?open='+encodeURIComponent(String(id||''))}
function v314RealmEyeHref(slug){return 'https://www.realmeye.com/wiki/'+encodeURIComponent(String(slug||''))}
function v314BridgeEntry(kind,item){
  if(!item||!indexBridge)return null;
  return kind==='skin'?(indexBridge.skins?.[item.id]||null):(indexBridge.dyes?.[item.id]||null);
}
function v314Text(value){return String(value==null?'':value).trim()}
function v314LegacyIndexStrip(){
  const hits=[];
  for(const node of root.querySelectorAll('div,section,aside')){
    const current=$('v314SelectedIndex');
    if(node.id==='v314SelectedIndex'||node.closest('#v314SelectedIndex')||(current&&node.contains(current)))continue;
    const text=v314Text(node.textContent).replace(/\s+/g,' ').toLowerCase();
    if((text.includes('selected · index')||text.includes('selected index'))&&text.includes('skin / clothing / accessory')&&text.length<320)hits.push(node);
  }
  hits.sort((a,b)=>v314Text(a.textContent).length-v314Text(b.textContent).length);
  if(hits[0])hits[0].remove();
}
function v314EnsureStyles(){
  if($('v314SelectedIndexStyles'))return;
  const style=document.createElement('style');
  style.id='v314SelectedIndexStyles';
  style.textContent=[
    '#v314SelectedIndex{width:min(92%,760px);margin:24px auto 48px;padding:0 8px;box-sizing:border-box}',
    '#v314SelectedIndex .v314-index-head{display:flex;align-items:center;gap:10px;margin:0 0 10px;color:var(--sk-dim);font-size:11.5px;font-weight:600;letter-spacing:.7px;text-transform:uppercase}',
    '#v314SelectedIndex .v314-index-head:after{content:"";height:1px;flex:1;background:var(--sk-line-soft)}',
    '#v314SelectedIndex .v314-index-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
    '#v314SelectedIndex .v314-index-card{min-width:0;border:1px solid var(--sk-line);border-radius:var(--sk-radius-sm);background:rgba(0,0,0,.22);padding:10px}',
    '#v314SelectedIndex .v314-index-top{display:grid;grid-template-columns:48px minmax(0,1fr);gap:9px;align-items:center}',
    '#v314SelectedIndex .v314-index-art{width:48px;height:48px;border:1px solid var(--sk-line-soft);border-radius:6px;background:var(--sk-bg);display:grid;place-items:center;overflow:hidden}',
    '#v314SelectedIndex .v314-index-art .thumb,#v314SelectedIndex .v314-index-art canvas{max-width:46px;max-height:46px}',
    '#v314SelectedIndex .v314-index-empty-art{font-size:24px;color:var(--sk-dim)}',
    '#v314SelectedIndex .v314-index-kind{font-size:10px;color:var(--sk-dim);text-transform:uppercase;letter-spacing:.08em;font-weight:600}',
    '#v314SelectedIndex .v314-index-name{margin-top:2px;color:var(--sk-text);font-size:13px;font-weight:650;line-height:1.15;overflow-wrap:anywhere}',
    '#v314SelectedIndex .v314-index-sub{margin-top:3px;color:var(--sk-muted);font-size:10px;line-height:1.25}',
    '#v314SelectedIndex .v314-index-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}',
    '#v314SelectedIndex .v314-index-open{display:inline-flex;align-items:center;min-height:27px;padding:0 10px;border:1px solid var(--sk-accent);border-radius:999px;background:var(--sk-accent);color:var(--sk-on-accent);text-decoration:none;font-size:11px;font-weight:650}',
    '#v314SelectedIndex .v314-index-open:hover{filter:brightness(1.12)}',
    '#v314SelectedIndex .v314-index-missing{font-size:10px;color:var(--sk-dim);line-height:1.25}',
    '#v314SelectedIndex .v314-index-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:6px;margin-top:8px;padding-top:7px;border-top:1px solid var(--sk-line-soft);font-size:10px}',
    '#v314SelectedIndex .v314-index-row>span:first-child{color:var(--sk-dim);font-weight:600}',
    '#v314SelectedIndex .v314-index-chips{display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
    '#v314SelectedIndex .v314-index-chip{display:inline-flex;max-width:100%;padding:2px 7px;border:1px solid var(--sk-line);border-radius:999px;background:rgba(255,255,255,.04);color:var(--sk-muted);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#v314SelectedIndex a.v314-index-chip:hover{border-color:var(--sk-accent);color:var(--sk-text)}',
    '@media(max-width:760px){#v314SelectedIndex .v314-index-grid{grid-template-columns:1fr}}'
  ].join('');
  root.append(style);
}
function v314SelectedAnchor(){
  if(!S.skin)return canvas.parentElement;
  const wanted=v314Text(S.skin.id);
  const cr=canvas.getBoundingClientRect();
  const cx=cr.left+cr.width/2;
  let rootNode=canvas.parentElement,best=null,bestScore=Infinity;
  for(let depth=0;rootNode&&rootNode!==host&&depth<8;depth++,rootNode=rootNode.parentElement){
    for(const node of rootNode.querySelectorAll('h1,h2,h3,h4,[id],[class]')){
      if(node.id==='v314SelectedIndex'||node.closest('#v314SelectedIndex'))continue;
      if(v314Text(node.textContent)!==wanted)continue;
      const r=node.getBoundingClientRect();
      if(r.top<cr.bottom-6)continue;
      const score=Math.abs((r.left+r.width/2)-cx)+Math.max(0,r.top-cr.bottom)*.08;
      if(score<bestScore){best=node;bestScore=score}
    }
    if(best&&depth>=2)break;
  }
  if(!best)return canvas.parentElement;
  let anchor=best;
  while(anchor.parentElement&&anchor.parentElement!==host&&!anchor.parentElement.contains(canvas)){
    const r=anchor.parentElement.getBoundingClientRect();
    if(r.width>cr.width*1.25)break;
    anchor=anchor.parentElement;
  }
  return anchor;
}
function v314Sprite(kind,item){
  if(!item)return null;
  if(kind==='skin')return makeSpriteThumb(item,44);
  return makeDyeThumb(item,40);
}
function v314AddOpen(into,id,label){
  if(!id)return null;
  const button=document.createElement('button');
  button.type='button';button.className='v314-index-open';button.dataset.indexId=id;button.textContent=label||'Open in Index';
  button.onclick=()=>window.openIndexRecord?.(id);
  into.append(button);return button;
}
function v314AddRelationRow(card,label,entries){
  const clean=(entries||[]).filter(Boolean);
  if(!clean.length)return;
  const row=document.createElement('div');row.className='v314-index-row';
  const key=document.createElement('span');key.textContent=label;row.append(key);
  const chips=document.createElement('div');chips.className='v314-index-chips';row.append(chips);
  const unique=new Map();
  for(const entry of clean){
    const name=v314Text(entry.name||entry.said||entry.pageTitle||entry.title||entry.id||entry.slug);
    const id=v314Text(entry.id);const href=entry.href||'';
    const token=(id?'id:'+id:(href?'href:'+href:'name:'+name));
    if(name&&!unique.has(token))unique.set(token,{name,id,href});
  }
  const values=[...unique.values()];
  for(const entry of values.slice(0,4)){
    const chip=document.createElement(entry.id?'button':entry.href?'a':'span');chip.className='v314-index-chip';chip.textContent=entry.name;
    if(entry.id){chip.type='button';chip.onclick=()=>window.openIndexRecord?.(entry.id)}
    else if(entry.href){chip.href=entry.href;chip.target='_blank';chip.rel='noopener noreferrer'}
    chips.append(chip);
  }
  if(values.length>4){const more=document.createElement('span');more.className='v314-index-chip';more.textContent='+'+(values.length-4);chips.append(more)}
  card.append(row);
}
function v314SelectedCard(kind,label,item){
  const card=document.createElement('article');card.className='v314-index-card';card.dataset.kind=kind;
  const top=document.createElement('div');top.className='v314-index-top';card.append(top);
  const art=document.createElement('div');art.className='v314-index-art';top.append(art);
  const sprite=v314Sprite(kind,item);if(sprite)art.append(sprite);else{const none=document.createElement('span');none.className='v314-index-empty-art';none.textContent='∅';art.append(none)}
  const copy=document.createElement('div');top.append(copy);
  const kindNode=document.createElement('div');kindNode.className='v314-index-kind';kindNode.textContent=label;copy.append(kindNode);
  const name=document.createElement('div');name.className='v314-index-name';name.textContent=item?.id||(kind==='skin'?'No skin':'No dye selected');copy.append(name);
  const sub=document.createElement('div');sub.className='v314-index-sub';
  sub.textContent=item?(kind==='skin'?[item.className,item.family].filter(Boolean).join(' · '):(kind==='clothing'?'Clothing dye':'Accessory dye')):'None';copy.append(sub);
  const actions=document.createElement('div');actions.className='v314-index-actions';card.append(actions);
  if(!item){const empty=document.createElement('span');empty.className='v314-index-missing';empty.textContent='Nothing selected';actions.append(empty);return card}
  const info=v314BridgeEntry(kind,item);
  if(info?.match){v314AddOpen(actions,info.match.id,'Open in Index')}
  else if(kind==='skin'&&info?.targetKind==='set'&&info?.target){
    const note=document.createElement('span');note.className='v314-index-missing';note.textContent='Skin card not linked exactly yet.';actions.append(note);
    v314AddOpen(actions,info.target.id,'Open set in Index');
  }else{
    const missing=document.createElement('span');missing.className='v314-index-missing';
    missing.textContent=info?.ambiguous?.length?'Ambiguous Index match — no automatic link':'No exact Index match';actions.append(missing);
  }
  if(kind==='skin'&&info){
    const sets=[...(info.sets||[])];
    if(info.targetKind==='set'&&info.target&&!sets.some(one=>one?.id===info.target.id))sets.unshift(info.target);
    v314AddRelationRow(card,'Set',sets);
    v314AddRelationRow(card,'Source',info.drops||[]);
    if(info.sourcePage?.slug)v314AddRelationRow(card,'Wiki',[{name:info.sourcePage.title||info.sourcePage.slug,href:v314RealmEyeHref(info.sourcePage.slug)}]);
  }
  return card;
}
function renderSelectedIndexPanel(){
  if(!host||!canvas)return;
  v314EnsureStyles();v314LegacyIndexStrip();
  let panel=$('v314SelectedIndex');
  if(!panel){panel=document.createElement('section');panel.id='v314SelectedIndex';panel.setAttribute('aria-label','Selected objects in ROTMG Tools Index')}
  const anchor=v314SelectedAnchor();
  if(anchor&&anchor.nextElementSibling!==panel)anchor.after(panel);
  panel.replaceChildren();
  const head=document.createElement('div');head.className='v314-index-head';head.textContent='Index · selected';panel.append(head);
  const grid=document.createElement('div');grid.className='v314-index-grid';panel.append(grid);
  grid.append(v314SelectedCard('skin','Skin',S.skin));
  grid.append(v314SelectedCard('clothing','Clothing',S.dyes.clothing));
  grid.append(v314SelectedCard('accessory','Accessory',S.dyes.accessory));
}
function scheduleSelectedIndexPanel(){
  if(v314SelectedIndexQueued)return;v314SelectedIndexQueued=true;
  queueMicrotask(()=>{v314SelectedIndexQueued=false;renderSelectedIndexPanel()});
}
root.addEventListener('click',scheduleSelectedIndexPanel);
root.addEventListener('change',scheduleSelectedIndexPanel);
setTimeout(scheduleSelectedIndexPanel,0);
/* V314_SELECTED_INDEX_END */
/* V315_SANDBOX_CONTROLS_FAVORITES_START */
let v315UiQueued=false;

function v315Text(value){return String(value==null?'':value).replace(/\s+/g,' ').trim()}
function v315Lower(node){return v315Text(node?.textContent).toLowerCase()}
function v315CanvasShell(){
  if(!canvas)return null;
  const cr=canvas.getBoundingClientRect();
  let node=canvas.parentElement,best=node;
  for(let depth=0;node&&node!==host&&depth<6;depth++,node=node.parentElement){
    const r=node.getBoundingClientRect();
    if(r.width>=cr.width*.92&&r.width<=cr.width*1.18&&r.height>=cr.height*.9&&r.height<=cr.height*1.55)best=node;
    else if(depth>0)break;
  }
  return best||canvas.parentElement;
}
function v315EnsureStyles(){
  if($('v315SandboxStyles'))return;
  const style=document.createElement('style');style.id='v315SandboxStyles';
  style.textContent=[
    '#v315SandboxBar{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:8px auto 4px;padding:8px 10px;border:1px solid var(--sk-line);border-radius:var(--sk-radius-sm);background:rgba(0,0,0,.22);color:var(--sk-muted);font-size:11px}',
    '#v315SandboxBar .v315-help{flex:1 1 245px;min-width:190px;color:var(--sk-muted);white-space:normal}',
    '#v315SandboxBar .v315-help b{color:var(--sk-text);font-weight:650}',
    '#v315SandboxBar .v315-speed{display:flex;align-items:center;gap:7px;white-space:nowrap;color:var(--sk-muted)}',
    '#v315SandboxBar .v315-speed strong{color:var(--sk-text);font-weight:650}',
    '#v315SandboxBar .v315-speed input{width:112px;border:0;background:transparent;padding:0;accent-color:var(--sk-accent)}',
    '#v315SandboxBar .v315-speed output{min-width:82px;color:var(--sk-muted);font-family:var(--sk-mono);font-variant-numeric:tabular-nums}',
    '#v315SandboxBar .v315-combos{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}',
    '#v315SandboxBar button{min-height:26px;padding:0 10px;border:1px solid var(--sk-line);border-radius:999px;background:rgba(255,255,255,.04);color:var(--sk-dim);font:inherit;font-size:11px;font-weight:600;cursor:pointer}',
    '#v315SandboxBar button:hover{color:var(--sk-text);border-color:var(--sk-accent)}',
    '#v315SandboxBar button.is-on{border-color:var(--sk-accent);background:var(--sk-accent);color:var(--sk-on-accent)}',
    '#v315SandboxBar .v315-save{color:var(--sk-gold)}',
    '#v315SandboxBar .v315-save:hover{border-color:var(--sk-gold);background:rgba(255,208,38,.11)}',
    '#v315SandboxBar .v315-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:rgba(0,0,0,.35);color:var(--sk-muted);font-size:10px}',
    '.combo-dialog-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(8,7,13,.8);backdrop-filter:blur(5px);box-sizing:border-box}',
    '.combo-dialog{width:min(92vw,390px);padding:18px;border:1px solid var(--sk-line);border-radius:var(--sk-radius);background:var(--sk-panel);color:var(--sk-text);box-shadow:0 24px 90px rgba(0,0,0,.6);box-sizing:border-box}',
    '.combo-dialog h2{margin:0 0 14px;font-size:18px}',
    '.combo-dialog label{display:grid;gap:6px;color:var(--sk-dim);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.7px}',
    '.combo-dialog input{box-sizing:border-box;width:100%;height:38px;padding:0 11px;border:1px solid var(--sk-line);border-radius:var(--sk-radius-sm);outline:none;background:rgba(0,0,0,.3);color:var(--sk-text);font:inherit;text-transform:none;letter-spacing:normal}',
    '.combo-dialog input:focus{border-color:var(--sk-accent);box-shadow:0 0 0 3px rgba(121,197,232,.14)}',
    '.combo-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
    '.combo-dialog-actions button{min-height:32px;padding:0 14px;border:1px solid var(--sk-line);border-radius:var(--sk-radius-sm);background:transparent;color:var(--sk-muted);font:inherit;font-size:13px;cursor:pointer}',
    '.combo-dialog-actions button:hover{color:var(--sk-text);border-color:var(--sk-accent)}',
    '.combo-dialog-actions .combo-dialog-save{border-color:var(--sk-accent);background:var(--sk-accent);color:var(--sk-on-accent);font-weight:650}',
    '@media(max-width:760px){#v315SandboxBar .v315-combos{margin-left:0;width:100%}#v315SandboxBar .v315-speed{width:100%}}'
  ].join('');
  root.append(style);
}
function v315HideLegacyHelp(){
  const candidates=[...root.querySelectorAll('div,span,p,small')].filter(node=>{
    if(node.closest('#v315SandboxBar'))return false;
    const t=v315Lower(node);
    return t.includes('wasd')&&t.includes('move')&&t.includes('aim')&&t.includes('attack')&&t.includes('zoom');
  }).sort((a,b)=>v315Text(a.textContent).length-v315Text(b.textContent).length);
  if(candidates[0])candidates[0].style.setProperty('display','none','important');
}
function v315HideLegacySpeed(){
  for(const range of root.querySelectorAll('input[type="range"]')){
    if(range.closest('#v315SandboxBar'))continue;
    let node=range.closest('label');
    if(node&&v315Lower(node).includes('attack speed')){node.style.setProperty('display','none','important');return}
    node=range.parentElement;
    let best=null;
    for(let depth=0;node&&node!==host&&depth<4;depth++,node=node.parentElement){
      if(v315Lower(node).includes('attack speed')&&!node.querySelector('button')){best=node;break}
    }
    if(best){best.style.setProperty('display','none','important');return}
  }
}
function v315AttackLabel(){
  const speed=Math.max(.25,Math.min(4,Number(S.attackSpeed)||1));
  let rate='';
  try{if(typeof baseAttackRate==='function')rate=' · '+(speed*baseAttackRate()).toFixed(2)+'/s'}catch{}
  return speed.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'×'+rate;
}
function setCatalogMode(mode){
  S.catalogMode=mode==='favorites'?'favorites':'skins';
  try{localStorage.setItem('skinViewerCatalogMode',S.catalogMode)}catch{}
  renderLibraryControls();renderCatalogueUI();
}
function v315LegacyButton(words){
  const wanted=words.map(x=>String(x).toLowerCase());
  return [...root.querySelectorAll('button')].find(button=>{
    if(button.closest('#v315SandboxBar'))return false;
    const text=v315Lower(button);
    return wanted.every(word=>text.includes(word));
  })||null;
}
function closeSaveComboDialog(){$('saveComboDialogBackdrop')?.remove()}
function openSaveComboDialog(){
  if(!S.skin)return;
  closeSaveComboDialog();
  const signature=currentComboSignature(),same=comboFavorites.find(f=>f.signature===signature);
  const proposed=same?.name||defaultComboName();
  const backdrop=document.createElement('div');backdrop.id='saveComboDialogBackdrop';backdrop.className='combo-dialog-backdrop';
  const dialog=document.createElement('form');dialog.className='combo-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','saveComboDialogTitle');
  const title=document.createElement('h2');title.id='saveComboDialogTitle';title.textContent='Save combo';
  const label=document.createElement('label');label.textContent='Combo name';
  const input=document.createElement('input');input.type='text';input.value=proposed;input.autocomplete='off';input.setAttribute('aria-label','Combo name');
  const actions=document.createElement('div');actions.className='combo-dialog-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const save=document.createElement('button');save.type='submit';save.className='combo-dialog-save';save.textContent='Save';
  label.append(input);actions.append(cancel,save);dialog.append(title,label,actions);backdrop.append(dialog);root.append(backdrop);
  const close=()=>closeSaveComboDialog();
  cancel.onclick=close;
  backdrop.addEventListener('pointerdown',event=>{if(event.target===backdrop)close()});
  backdrop.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close()}});
  dialog.addEventListener('submit',event=>{event.preventDefault();saveCurrentComboFavorite(input.value);close()});
  queueMicrotask(()=>{input.focus();input.select()});
}
function v315SaveCombo(){
  openSaveComboDialog();
}
function v315BuildBar(){
  let bar=$('v315SandboxBar');
  if(!bar){
    bar=document.createElement('section');bar.id='v315SandboxBar';bar.setAttribute('aria-label','Sandbox controls and combo favorites');
    const help=document.createElement('div');help.className='v315-help';help.innerHTML='<b>WASD</b> move · <b>mouse</b> aim · <b>hold click</b> attack · <b>wheel</b> zoom';bar.append(help);
    const speed=document.createElement('label');speed.className='v315-speed';speed.innerHTML='<strong>Attack speed</strong>';bar.append(speed);
    const slider=document.createElement('input');slider.type='range';slider.min='.25';slider.max='4';slider.step='.05';slider.setAttribute('aria-label','Attack speed');speed.append(slider);
    const out=document.createElement('output');speed.append(out);
    slider.addEventListener('input',()=>{S.attackSpeed=Math.max(.25,Math.min(4,Number(slider.value)||1));try{localStorage.setItem('skinViewerAttackSpeed',String(S.attackSpeed))}catch{}out.textContent=v315AttackLabel()});
    const combos=document.createElement('div');combos.className='v315-combos';bar.append(combos);
    const skinsButton=document.createElement('button');skinsButton.type='button';skinsButton.dataset.mode='skins';skinsButton.textContent='Skins';skinsButton.onclick=()=>setCatalogMode('skins');combos.append(skinsButton);
    const favoritesButton=document.createElement('button');favoritesButton.type='button';favoritesButton.dataset.mode='favorites';favoritesButton.innerHTML='★ Favorites <span class="v315-count">0</span>';favoritesButton.onclick=()=>setCatalogMode('favorites');combos.append(favoritesButton);
    const save=document.createElement('button');save.type='button';save.className='v315-save';save.textContent='☆ Save combo';save.onclick=v315SaveCombo;combos.append(save);
  }
  const shell=v315CanvasShell();
  if(shell){
    const r=shell.getBoundingClientRect();if(r.width>80)bar.style.width=Math.round(r.width)+'px';
    if(shell.nextElementSibling!==bar)shell.after(bar);
  }
  const slider=bar.querySelector('.v315-speed input');if(slider&&root.activeElement!==slider)slider.value=String(S.attackSpeed);
  const out=bar.querySelector('.v315-speed output');if(out)out.textContent=v315AttackLabel();
  for(const button of bar.querySelectorAll('[data-mode]'))button.classList.toggle('is-on',button.dataset.mode===S.catalogMode);
  const count=bar.querySelector('.v315-count');if(count)count.textContent=String(comboFavorites.length);
  return bar;
}
function v315EnsureUi(){
  if(!host||!canvas)return;
  v315EnsureStyles();
  v315BuildBar();
  v315HideLegacyHelp();
  v315HideLegacySpeed();
}
function v315ScheduleUi(){
  if(v315UiQueued)return;v315UiQueued=true;
  queueMicrotask(()=>{v315UiQueued=false;v315EnsureUi()});
}
root.addEventListener('click',v315ScheduleUi);
root.addEventListener('change',v315ScheduleUi);
window.addEventListener('resize',v315ScheduleUi);
setTimeout(v315ScheduleUi,0);
/* V315_SANDBOX_CONTROLS_FAVORITES_END */
function isMoving(){return['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'].some(k=>S.keys.has(k))}
function activityRaw(now=performance.now()){if(S.shooting||(S.attackUntil&&now<S.attackUntil))return 2;return isMoving()?1:0}
function classKit(){return realmAtlas.folk?.find(one=>one.name===S.skin?.className)||null}
function combatWeaponShots(){const exact=realmCombat?.folk?.[S.skin?.className]?.weapon;if(Array.isArray(exact)&&exact.length)return exact;const shot=classKit()?.weapon?.shot;return shot?[shot]:[]}
function baseAttackRate(){return Math.max(.1,Number(combatWeaponShots()[0]?.rate||classKit()?.weapon?.shot?.rate||1))}
function attackPeriod(){return ATTACK_PERIOD_MS/(S.attackSpeed*baseAttackRate())}
function attackFrame(now){if(S.seq?.actionRaw!==2)return;const playable=[];for(let i=0;i<S.seq.frames.length;i++)if(S.seq.frames[i].spriteAvailable)playable.push(i);if(!playable.length)return;const period=attackPeriod(),elapsed=Math.max(0,now-S.attackStart),phase=(elapsed%period)/period,next=playable[Math.min(playable.length-1,Math.floor(phase*playable.length))];if(next!==S.index)S.index=next}
function sequence(actionRaw=activityRaw(),directionRaw=S.facingRaw,set=S.seq?.set??0){const pool=S.skin?.sequences||[];return pool.find(q=>q.set===set&&q.actionRaw===actionRaw&&q.directionRaw===directionRaw&&q.frames.some(f=>f.spriteAvailable))||pool.find(q=>q.set===set&&q.actionRaw===actionRaw&&q.frames.some(f=>f.spriteAvailable))||pool.find(q=>q.set===set&&q.actionRaw===0&&q.directionRaw===directionRaw&&q.frames.some(f=>f.spriteAvailable))||pool.find(q=>q.set===set&&q.frames.some(f=>f.spriteAvailable))||pool[0]}
function useSequence(q,reset=true){if(!q)return;if(S.seq!==q){S.seq=q;if(reset){S.index=0;S.last=performance.now()}renderFrameState()}else if(reset){S.index=0;S.last=performance.now();renderFrameState()}}
function syncActivity(now=performance.now(),reset=true){const q=sequence(activityRaw(now),S.facingRaw,S.seq?.set??0);useSequence(q,reset)}
function select(s){if(!s)return;S.skin=s;const q=initialSequence(s.sequences);S.seq=q;S.facingRaw=q?.directionRaw??2;S.left=false;S.index=0;S.attackUntil=0;S.shooting=false;S.attackStart=0;S.nextShotAt=0;S.projectiles.length=0;syncRenderScale();syncActivity(performance.now(),true);renderFrameState();renderCatalogueUI();scheduleSelectedIndexPanel()}
function current(){return S.seq?.frames[S.index%Math.max(1,S.seq.frames.length)]}
function visibleSkins(){
  const q=$('search').value.toLowerCase();
  return skins.filter(s=>{
    const family=s.family||'Other';
    if(q&&!s.id.toLowerCase().includes(q))return false;
    if(S.className&&s.className!==S.className)return false;
    if(!S.family)return true;
    if(S.family===GLOBAL_OTHER_FAMILY)return !S.className&&!GLOBAL_FAMILY_WHITELIST.has(family);
    return family===S.family;
  });
}
function ensureVisibleSelection(){const list=visibleSkins();if(list.length&&(!S.skin||!list.includes(S.skin)))select(list[0]);else renderCatalogueUI()}
/* V38_BEACH_POCKET: one real Beach/shore slice around its recorded beacon. */
const realmLevels=new Map((realmAtlas.levels||[]).map(level=>[level.z,level]));
const realmHave=new Map((realmAtlas.levels||[]).map(level=>[level.z,new Set(level.chunks||[])]));
const realmImages=new Map(),projectileImages=new Map(),MAX_REALM_IMAGES=72,MAX_PROJECTILES=160;
const thingArt=new Image();if(realmThings){thingArt.decoding='async';thingArt.onload=()=>{S.mapDirty=true};thingArt.src='assets/atlas/things.png'}
const BEACH_WIDTH=52,BEACH_HEIGHT=36,BEACH_OFFSET_X=12,BEACH_VIEW_BIAS_X=4;
function beachBiome(){return (realmAtlas.biomes||[]).find(one=>String(one.name||'').toLowerCase()==='beach')||null}
function beachZones(){const biome=beachBiome();return (realmAtlas.zones||[]).filter(zone=>String(zone.name||'').toLowerCase()==='beach'||(biome&&zone.biome===biome.index))}
function beachBeacon(){const all=realmAtlas.beacons||[],zones=beachZones(),ids=new Set(zones.map(zone=>zone.id)),exact=all.filter(beacon=>ids.has(beacon.zone));if(exact.length)return exact.find(beacon=>beacon.state==='captured')||exact[0];const at=beachBiome()?.at;if(!at||!all.length)return all[0]||null;return [...all].sort((a,b)=>Math.hypot(a.x-at[0],a.y-at[1])-Math.hypot(b.x-at[0],b.y-at[1]))[0]}
function beachPocket(){const biome=beachBiome(),beacon=beachBeacon(),fallback=biome?.at||realmAtlas.focus?.slice(0,2)||[0,0],cx=(beacon?.x??fallback[0])+BEACH_OFFSET_X,cy=beacon?.y??fallback[1],bounds=realmAtlas.bounds||{};let x0=cx-BEACH_WIDTH/2,x1=cx+BEACH_WIDTH/2,y0=cy-BEACH_HEIGHT/2,y1=cy+BEACH_HEIGHT/2;const minX=Number.isFinite(bounds.minX)?bounds.minX:x0,minY=Number.isFinite(bounds.minY)?bounds.minY:y0,maxX=Number.isFinite(bounds.maxX)?bounds.maxX:x1,maxY=Number.isFinite(bounds.maxY)?bounds.maxY:y1;if(x0<minX){x1+=minX-x0;x0=minX}if(x1>maxX){x0-=x1-maxX;x1=maxX}if(y0<minY){y1+=minY-y0;y0=minY}if(y1>maxY){y0-=y1-maxY;y1=maxY}return{x0:Math.max(minX,x0),y0:Math.max(minY,y0),x1:Math.min(maxX,x1),y1:Math.min(maxY,y1),beacon,biome}}
function insidePlayArea(x,y,pad=0){const a=S.playArea;return !a||(x>=a.x0-pad&&x<=a.x1+pad&&y>=a.y0-pad&&y<=a.y1+pad)}
function minRealmScale(){if(S.playArea){const w=Math.max(1,S.playArea.x1-S.playArea.x0),h=Math.max(1,S.playArea.y1-S.playArea.y0);return Math.max(realmAtlas.px/2,Math.max(worldBg.width/w,worldBg.height/h)*1.02)}const last=Math.max(0,(realmAtlas.levels?.length||1)-1);return realmAtlas.px/(1<<last)}
function cameraCenter(){const a=S.playArea,bias=S.worldMode==='beach'?BEACH_VIEW_BIAS_X:0,targetX=S.player.x+bias;if(!a)return{x:targetX,y:S.player.y};const hx=worldBg.width/(2*S.camera.scale),hy=worldBg.height/(2*S.camera.scale),midX=(a.x0+a.x1)/2,midY=(a.y0+a.y1)/2,cx=(a.x1-a.x0)<=hx*2?midX:Math.max(a.x0+hx,Math.min(a.x1-hx,targetX)),cy=(a.y1-a.y0)<=hy*2?midY:Math.max(a.y0+hy,Math.min(a.y1-hy,S.player.y));return{x:cx,y:cy}}
function realmLevelFor(scale=S.camera.scale){const wanted=Math.log2(realmAtlas.px/Math.max(scale,1e-6)),last=Math.max(0,(realmAtlas.levels?.length||1)-1);return Math.max(0,Math.min(last,Math.round(wanted)))}
function realmChunkImage(z,name){const key=`${z}/${name}`;let img=realmImages.get(key);if(img){realmImages.delete(key);realmImages.set(key,img);return img}img=new Image();img.decoding='async';img.onload=()=>{S.mapDirty=true};img.src=`assets/atlas/z${z}/${name}.png`;realmImages.set(key,img);while(realmImages.size>MAX_REALM_IMAGES)realmImages.delete(realmImages.keys().next().value);return img}
function realmToScreen(x,y){const c=cameraCenter();return{x:worldBg.width/2+(x-c.x)*S.camera.scale,y:worldBg.height/2+(y-c.y)*S.camera.scale}}
function syncRenderScale(){const at=realmToScreen(S.player.x,S.player.y);S.world.x=at.x;S.world.y=at.y;S.world.scale=S.camera.scale/realmAtlas.px;S.pointer.x=Math.max(0,Math.min(canvas.width,S.pointer.x));S.pointer.y=Math.max(0,Math.min(canvas.height,S.pointer.y))}
function visibleRealm(margin=0){const c=cameraCenter(),hx=worldBg.width/(2*S.camera.scale)+margin,hy=worldBg.height/(2*S.camera.scale)+margin,a=S.playArea;return{x0:a?Math.max(a.x0-margin,c.x-hx):c.x-hx,x1:a?Math.min(a.x1+margin,c.x+hx):c.x+hx,y0:a?Math.max(a.y0-margin,c.y-hy):c.y-hy,y1:a?Math.min(a.y1+margin,c.y+hy):c.y+hy}}
function drawRealmLevel(z){const level=realmLevels.get(z),have=realmHave.get(z);if(!level||!have)return;const span=realmAtlas.chunk*(1<<z),box=visibleRealm(1),c0=Math.floor(box.x0/span),c1=Math.floor(box.x1/span),r0=Math.floor(box.y0/span),r1=Math.floor(box.y1/span);for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){const name=`${c}_${r}`;if(!have.has(name))continue;const img=realmChunkImage(z,name);if(!img.complete||!img.naturalWidth)continue;const p=realmToScreen(c*span,r*span),side=span*S.camera.scale;bg.drawImage(img,Math.floor(p.x),Math.floor(p.y),Math.ceil(side)+1,Math.ceil(side)+1)}}
function drawRealmThings(now){if(!realmThings||!thingArt.complete||!thingArt.naturalWidth||realmLevelFor()!==0)return;const a=realmThings.at,index=realmThings.index,pics=index.pics||[],ss=realmAtlas.ss||1,perPixel=S.camera.scale/(realmAtlas.px*ss),box=visibleRealm(14),span=realmAtlas.chunk,c0=Math.floor(box.x0/span)-1,c1=Math.floor(box.x1/span)+1,r0=Math.floor(box.y0/span)-1,r1=Math.floor(box.y1/span)+1,list=[];for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){const where=index.chunks?.[`${c}_${r}`];if(!where)continue;const[from,count]=where;for(let i=0;i<count;i++){const at=(from+i)*3,tx=a[at+1]/8,ty=a[at+2]/8;if(tx<box.x0||tx>box.x1||ty<box.y0||ty>box.y1||!insidePlayArea(tx,ty,2))continue;const pic=pics[a[at]];if(pic)list.push({tx,ty,pic})}}list.sort((p,q)=>p.ty-q.ty);for(const one of list){const pic=one.pic,size=(pic[4]||100)/100,wide=pic[2]*size*perPixel,tall=pic[3]*size*perPixel;if(wide<.5||tall<.5)continue;const foot=(pic[6]||0)*size*perPixel,p=realmToScreen(one.tx,one.ty+1),frames=pic[7]||1,run=pic[8]||800,sx=pic[0]+(frames>1?(Math.floor(now/(run/frames))%frames)*pic[2]:0),top=p.y-tall+foot-(pic[5]||0)/100*S.camera.scale;bg.drawImage(thingArt,sx,pic[1],pic[2],pic[3],p.x-wide/2,top,wide,tall)}}
function clipBeachPocket(){if(!S.playArea)return;const a=realmToScreen(S.playArea.x0,S.playArea.y0),b=realmToScreen(S.playArea.x1,S.playArea.y1);bg.beginPath();bg.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));bg.clip()}
function drawStudioBackground(){
  const W=worldBg.width,H=worldBg.height,a=S.studioArea||S.playArea||{x0:-20,y0:-13,x1:20,y1:13};
  const pal=S.studioTheme==='light'
    ?{outside:'#d8dee8',floor:'#f8fafc',grid:'rgba(22,30,42,.08)',major:'rgba(22,30,42,.16)',fence:'rgba(31,39,52,.55)',axis:'rgba(31,39,52,.2)'}
    :{outside:'#171b21',floor:'#2b313a',grid:'rgba(220,230,244,.06)',major:'rgba(220,230,244,.13)',fence:'rgba(210,220,235,.52)',axis:'rgba(220,230,244,.16)'};
  bg.fillStyle=pal.outside;bg.fillRect(0,0,W,H);
  const tl=realmToScreen(a.x0,a.y0),br=realmToScreen(a.x1,a.y1);
  const left=Math.min(tl.x,br.x),top=Math.min(tl.y,br.y),right=Math.max(tl.x,br.x),bottom=Math.max(tl.y,br.y);
  bg.fillStyle=pal.floor;bg.fillRect(left,top,right-left,bottom-top);
  bg.save();bg.beginPath();bg.rect(left,top,right-left,bottom-top);bg.clip();
  for(let x=Math.floor(a.x0)-1;x<=Math.ceil(a.x1)+1;x++){
    const sx=Math.round(realmToScreen(x,0).x)+.5;
    bg.strokeStyle=x%4===0?pal.major:pal.grid;bg.lineWidth=1;
    bg.beginPath();bg.moveTo(sx,top);bg.lineTo(sx,bottom);bg.stroke();
  }
  for(let y=Math.floor(a.y0)-1;y<=Math.ceil(a.y1)+1;y++){
    const sy=Math.round(realmToScreen(0,y).y)+.5;
    bg.strokeStyle=y%4===0?pal.major:pal.grid;bg.lineWidth=1;
    bg.beginPath();bg.moveTo(left,sy);bg.lineTo(right,sy);bg.stroke();
  }
  const origin=realmToScreen(0,0);bg.strokeStyle=pal.axis;bg.lineWidth=1;
  bg.beginPath();bg.moveTo(origin.x,top);bg.lineTo(origin.x,bottom);bg.stroke();
  bg.beginPath();bg.moveTo(left,origin.y);bg.lineTo(right,origin.y);bg.stroke();
  bg.restore();
  bg.strokeStyle=pal.fence;bg.lineWidth=2;bg.setLineDash([6,4]);
  bg.strokeRect(left+1,top+1,Math.max(0,right-left-2),Math.max(0,bottom-top-2));bg.setLineDash([]);
}

function ensureStudioThemeControls(){
  let box=$('studioThemeControls');
  if(box)return box;
  const modes=root.querySelector('.world-mode');
  if(!modes)return null;
  box=document.createElement('div');box.id='studioThemeControls';box.className='studio-theme-controls';
  const dark=document.createElement('button');dark.type='button';dark.dataset.studioTheme='dark';dark.textContent='Dark';
  const light=document.createElement('button');light.type='button';light.dataset.studioTheme='light';light.textContent='Light';
  dark.onclick=()=>setStudioTheme('dark');light.onclick=()=>setStudioTheme('light');
  box.append(dark,light);modes.insertAdjacentElement('afterend',box);return box;
}
function renderStudioTheme(){
  const box=ensureStudioThemeControls();if(!box)return;
  box.hidden=S.worldMode!=='studio';
  box.querySelectorAll('[data-studio-theme]').forEach(b=>b.classList.toggle('selected',b.dataset.studioTheme===S.studioTheme));
}
function setStudioTheme(theme){
  S.studioTheme=theme==='light'?'light':'dark';
  localStorage.setItem('skinViewerStudioTheme',S.studioTheme);
  renderStudioTheme();
  if(S.worldMode==='studio'){S.mapDirty=true;drawRealmWorld(performance.now(),true)}
}

function renderWorldMode(){root.querySelectorAll('[data-world-mode]').forEach(button=>button.classList.toggle('selected',button.dataset.worldMode===S.worldMode));const hint=$('worldModeHint');if(hint)hint.textContent=S.worldMode==='studio'?'Studio · inspection room':'Beach · real Atlas area';renderStudioTheme()}
function rememberWorldMode(){const slot=S.modeState[S.worldMode]||{};slot.player={...S.player};slot.scale=S.camera.scale;if(!slot.spawn)slot.spawn={...S.player};S.modeState[S.worldMode]=slot}
function setWorldMode(mode,initial=false){const next=mode==='studio'?'studio':'beach';if(!initial)rememberWorldMode();S.worldMode=next;localStorage.setItem('skinViewerWorldMode',S.worldMode);S.playArea=next==='studio'?S.studioArea:S.beachArea;const slot=S.modeState[next];if(slot?.player)S.player={...slot.player};else if(next==='studio')S.player={x:0,y:0};else if(S.beachArea)S.player={x:(S.beachArea.x0+S.beachArea.x1)/2,y:(S.beachArea.y0+S.beachArea.y1)/2};S.spawn={...(slot?.spawn||S.player)};S.camera.scale=Math.max(minRealmScale(),slot?.scale||realmAtlas.px*4);S.projectiles.length=0;S.keys.clear();S.attackUntil=0;S.shooting=false;S.mapDirty=true;syncRenderScale();renderWorldMode();drawRealmWorld(performance.now(),true)}
function resetWorldMode(){const slot=S.modeState[S.worldMode],spawn=slot?.spawn||{x:0,y:0};S.player={...spawn};S.camera.scale=Math.max(minRealmScale(),realmAtlas.px*4);S.projectiles.length=0;S.keys.clear();S.attackUntil=0;S.shooting=false;if(slot){slot.player={...S.player};slot.scale=S.camera.scale}S.mapDirty=true;syncRenderScale();drawRealmWorld(performance.now(),true)}
function drawRealmWorld(now,force=false){if(S.worldMode==='studio'){if(!force&&!S.mapDirty)return;bg.clearRect(0,0,worldBg.width,worldBg.height);drawStudioBackground();S.mapDirty=false;S.lastMapDraw=now;return}const z=realmLevelFor();if(!force&&!S.mapDirty&&!(z===0&&now-S.lastMapDraw>=100))return;bg.clearRect(0,0,worldBg.width,worldBg.height);bg.fillStyle='#10151a';bg.fillRect(0,0,worldBg.width,worldBg.height);bg.save();clipBeachPocket();drawRealmLevel(z);if(z===0)drawRealmThings(now);bg.restore();S.mapDirty=false;S.lastMapDraw=now}
function loadBeachArea(){const area=beachPocket();S.beachArea=area;S.playArea=area;S.beachBeacon=area.beacon;const cx=area.beacon?.x??(area.x0+area.x1)/2,cy=area.beacon?.y??(area.y0+area.y1)/2,pad=1.5;S.player.x=Math.max(area.x0+pad,Math.min(area.x1-pad,cx+2));S.player.y=Math.max(area.y0+pad,Math.min(area.y1-pad,cy+3));S.spawn={x:S.player.x,y:S.player.y};S.camera.scale=Math.max(minRealmScale(),realmAtlas.px*4);S.modeState.beach={player:{...S.player},spawn:{...S.spawn},scale:S.camera.scale};S.projectiles.length=0;S.mapDirty=true;syncRenderScale()}
const projectileArt=v=>{if(!v?.file)return null;let img=projectileImages.get(v.file);if(!img){img=new Image();img.decoding='async';img.src=`assets/atlas/combat/${v.file}`;projectileImages.set(v.file,img)}return img};
function projectileDirection(){let dx=S.pointer.x-S.world.x,dy=S.pointer.y-S.world.y,len=Math.hypot(dx,dy);if(len<1){if(S.facingRaw===0){dx=S.left?-1:1;dy=0}else{dx=0;dy=S.facingRaw===3?-1:1}len=1}return{x:dx/len,y:dy/len}}
function spawnProjectile(){const aim=projectileDirection(),base=Math.atan2(aim.y,aim.x),defs=combatWeaponShots(),usable=defs.length?defs:[{fast:18,reach:8.5,many:1,fan:0,rate:1}];for(const def of usable){const many=Math.max(1,Number(def.many)||1),gap=(Number(def.fan)||0)*Math.PI/180;for(let i=0;i<many;i++){const angle=base+(i-(many-1)/2)*gap,fast=Math.max(.1,Number(def.fast)||18),life=Math.max(.08,Number(def.life)||(Number(def.reach)||8.5)/fast);S.projectiles.push({x:S.player.x+Math.cos(angle)*.35,y:S.player.y+Math.sin(angle)*.35,vx:Math.cos(angle)*fast,vy:Math.sin(angle)*fast,age:0,life,definition:def,visual:def.visual||null})}}if(S.projectiles.length>MAX_PROJECTILES)S.projectiles.splice(0,S.projectiles.length-MAX_PROJECTILES)}
function updateProjectiles(dt,now){if(S.shooting&&now>=S.nextShotAt){spawnProjectile();S.nextShotAt=now+attackPeriod()}for(const p of S.projectiles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.age+=dt;p.life-=dt}S.projectiles=S.projectiles.filter(p=>p.life>0&&insidePlayArea(p.x,p.y,.75))}
function renderProjectiles(){fx.clearRect(0,0,fxCanvas.width,fxCanvas.height);fx.imageSmoothingEnabled=false;for(const p of S.projectiles){const at=realmToScreen(p.x,p.y);if(at.x<-30||at.y<-30||at.x>fxCanvas.width+30||at.y>fxCanvas.height+30)continue;const v=p.visual,img=projectileArt(v);if(v&&img?.complete&&img.naturalWidth){const frames=Math.max(1,v.frames||1),frame=Math.floor(p.age*8)%frames,sw=v.width||img.naturalWidth/frames,sh=v.height||img.naturalHeight,visualScale=((p.definition?.motion?.size)||100)/100,wide=Math.max(3,S.camera.scale*sw*visualScale/8),tall=wide*sh/sw;fx.save();fx.translate(at.x,at.y);const spin=v.rotation?p.age*1000/v.rotation:0;fx.rotate(Math.atan2(p.vy,p.vx)+(v.angle||0)*Math.PI/4+spin);fx.drawImage(img,frame*sw,0,sw,sh,-wide/2,-tall/2,wide,tall);fx.restore()}else{const tail=realmToScreen(p.x-p.vx*.045,p.y-p.vy*.045);fx.strokeStyle='#ffe078';fx.lineWidth=Math.max(2,S.camera.scale/12);fx.beginPath();fx.moveTo(tail.x,tail.y);fx.lineTo(at.x,at.y);fx.stroke()}}}

function renderClassPicker(){const box=$('classes'),frag=document.createDocumentFragment();const all=document.createElement('button');all.className='class-pick all-pick'+(!S.className?' chosen':'');all.innerHTML='<span class="all-glyph">✦</span><span>All</span>';all.onclick=()=>{S.className='';renderLibraryControls();renderClassPicker();renderFamilies();ensureVisibleSelection()};frag.append(all);for(const c of classes){const b=document.createElement('button');b.className='class-pick'+(S.className===c.name?' chosen':'');b.title=c.name;b.append(makeClassThumb(c));const name=document.createElement('span');name.textContent=c.name;b.append(name);b.onclick=()=>{S.className=c.name;if(S.family&&!familyAvailableInClass(S.family,c.name))S.family='';renderClassPicker();renderFamilies();ensureVisibleSelection()};frag.append(b)}box.replaceChildren(frag)}
/* V310_GLOBAL_FAMILIES: family is a first-class filter even when Class = All. */
/* V311B_GLOBAL_FAMILIES */
const GLOBAL_FAMILY_ORDER=['2-Bit','Antinomy','Classic','Construction','Cozy','Exalted','Insight','Kogbold','Legion','Mystery','Oryxmas','Stone','Syndicate Henchman','Set skins'];
const GLOBAL_FAMILY_WHITELIST=new Set(GLOBAL_FAMILY_ORDER);
const GLOBAL_OTHER_FAMILY='__other_families__';
function globalFamilyRank(name){const i=GLOBAL_FAMILY_ORDER.indexOf(name);return i<0?9999:i}
function familyRows(){
  const pool=skins.filter(s=>!S.className||s.className===S.className),count=new Map();
  let other=0;
  for(const s of pool){
    const name=s.family||'Other';
    if(!S.className&&!GLOBAL_FAMILY_WHITELIST.has(name)){other++;continue}
    count.set(name,(count.get(name)||0)+1);
  }
  const rows=[...count];
  if(!S.className&&other)rows.push([GLOBAL_OTHER_FAMILY,other]);
  return rows.sort((a,b)=>{
    if(!S.className){
      if(a[0]===GLOBAL_OTHER_FAMILY)return 1;
      if(b[0]===GLOBAL_OTHER_FAMILY)return-1;
      const d=globalFamilyRank(a[0])-globalFamilyRank(b[0]);
      if(d)return d;
    }
    return familyOrder(a[0],b[0]);
  });
}
function familyAvailableInClass(name,className){
  if(name===GLOBAL_OTHER_FAMILY)return false;
  return skins.some(s=>(!className||s.className===className)&&(s.family||'Other')===name);
}
function renderFamilies(){
  const box=$('families'),rows=familyRows(),frag=document.createDocumentFragment();
  if(!S.className&&S.family!==GLOBAL_OTHER_FAMILY&&S.family&&!GLOBAL_FAMILY_WHITELIST.has(S.family))S.family='';
  const total=skins.filter(s=>!S.className||s.className===S.className).length;
  const all=document.createElement('button');
  all.className='filter-chip'+(!S.family?' chosen':'');
  all.textContent=`All ${total}`;
  all.onclick=()=>{S.family='';renderFamilies();ensureVisibleSelection()};
  frag.append(all);
  for(const [name,count]of rows){
    const b=document.createElement('button');
    b.className='filter-chip'+(S.family===name?' chosen':'');
    b.textContent=`${name===GLOBAL_OTHER_FAMILY?'Other families':name} ${count}`;
    b.onclick=()=>{S.family=S.family===name?'':name;renderFamilies();ensureVisibleSelection()};
    frag.append(b);
  }
  box.replaceChildren(frag);
}

function saveComboFavorites(){localStorage.setItem(COMBO_FAVORITES_KEY,JSON.stringify(comboFavorites))}
function comboDyeRef(dye){return dye?{id:dye.id??null,type:dye.type??null}:null}
function resolveComboDye(ref){if(!ref)return null;return dyes.find(d=>(ref.id!=null&&d.id===ref.id)||(ref.type!=null&&d.type===ref.type))||null}
function comboSignature(skinId,clothing,accessory){return JSON.stringify([skinId,clothing?.id??clothing?.type??null,accessory?.id??accessory?.type??null])}
function currentComboSignature(){return comboSignature(S.skin?.id,S.dyes.clothing,S.dyes.accessory)}
function defaultComboName(){
  if(!S.skin)return'Favorite combo';
  const parts=[S.skin.id];
  if(S.dyes.clothing)parts.push(S.dyes.clothing.id||'Clothing dye');
  if(S.dyes.accessory)parts.push(S.dyes.accessory.id||'Accessory dye');
  return parts.join(' + ');
}
function saveCurrentComboFavorite(name){
  if(!S.skin)return;
  const signature=currentComboSignature(),same=comboFavorites.find(f=>f.signature===signature);
  const proposed=same?.name||defaultComboName(),clean=v315Text(name)||proposed,entry={
    id:same?.id||`fav-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    name:clean,
    signature,
    skinId:S.skin.id,
    clothing:comboDyeRef(S.dyes.clothing),
    accessory:comboDyeRef(S.dyes.accessory),
    createdAt:same?.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
  if(same)Object.assign(same,entry);else comboFavorites.unshift(entry);
  saveComboFavorites();
  S.catalogMode='favorites';
  try{localStorage.setItem('skinViewerCatalogMode','favorites')}catch{}
  renderLibraryControls();renderCatalogueUI();
}
function removeComboFavorite(id){
  comboFavorites=comboFavorites.filter(f=>f.id!==id);
  saveComboFavorites();renderLibraryControls();if(S.catalogMode==='favorites')renderCatalogueUI();
}
function applyComboFavorite(fav){
  const skin=skins.find(s=>s.id===fav.skinId);if(!skin)return;
  select(skin);
  S.dyes.clothing=resolveComboDye(fav.clothing);
  S.dyes.accessory=resolveComboDye(fav.accessory);
  renderDyePanel();renderFrameState();
}
function makeFavoriteSkinThumb(s,size=44){
  const frame=s?.frames?.find(f=>f.spriteAvailable&&f.rect);
  const c=document.createElement('canvas');c.width=c.height=size;c.className='favorite-skin-thumb';
  if(!frame)return c;
  const img=atlas(frame.atlas);
  const draw=()=>fitDraw(c.getContext('2d'),img,frame.rect,size);
  if(img?.complete&&img.naturalWidth)draw();else if(img)img.addEventListener('load',draw,{once:true});
  return c;
}
function favoriteDyeSummary(dye,label){
  const row=document.createElement('span');row.className='favorite-dye-summary';
  if(dye){row.append(makeDyeThumb(dye,24));const text=document.createElement('span');text.textContent=dye.id||label;row.append(text)}
  else row.textContent=`${label}: none`;
  return row;
}
function renderFavoritesCatalogueUI(){
  const query=$('search').value.trim().toLowerCase();
  const list=comboFavorites.filter(f=>{
    const clothing=resolveComboDye(f.clothing),accessory=resolveComboDye(f.accessory);
    return !query||[f.name,f.skinId,clothing?.id,accessory?.id].filter(Boolean).some(x=>String(x).toLowerCase().includes(query));
  });
  $('count').textContent=`${list.length} favorite${list.length===1?'':'s'}`;
  const frag=document.createDocumentFragment();
  if(!list.length){
    const empty=document.createElement('div');empty.className='favorite-empty';
    empty.textContent=comboFavorites.length?'No favorite matches this search.':'No favorite combos yet. Select a skin and dyes, then use “Save combo”.';
    frag.append(empty);
  }
  for(const fav of list){
    const skin=skins.find(s=>s.id===fav.skinId),clothing=resolveComboDye(fav.clothing),accessory=resolveComboDye(fav.accessory);
    const card=document.createElement('div');card.className='favorite-card';
    const main=document.createElement('button');main.type='button';main.className='favorite-main';main.onclick=()=>applyComboFavorite(fav);
    main.append(makeFavoriteSkinThumb(skin));
    const info=document.createElement('span');info.className='favorite-info';
    const title=document.createElement('b');title.textContent=fav.name;
    const sub=document.createElement('small');sub.textContent=skin?.id||fav.skinId;
    const dyesBox=document.createElement('span');dyesBox.className='favorite-dyes';
    dyesBox.append(favoriteDyeSummary(clothing,'Clothing'),favoriteDyeSummary(accessory,'Accessory'));
    info.append(title,sub,dyesBox);main.append(info);
    const remove=document.createElement('button');remove.type='button';remove.className='favorite-remove';remove.title='Remove favorite';remove.textContent='×';remove.onclick=e=>{e.stopPropagation();removeComboFavorite(fav.id)};
    card.append(main,remove);frag.append(card);
  }
  $('skins').replaceChildren(frag);
}
function renderCatalogueUI(){return S.catalogMode==='favorites'?renderFavoritesCatalogueUI():renderBrowseCatalogueUI()}
function renderLibraryControls(){
  host.classList.toggle('favorites-mode',S.catalogMode==='favorites');
  v315ScheduleUi();
}

function renderBrowseCatalogueUI(){const a=visibleSkins();$('count').textContent=`${a.length} skin${a.length===1?'':'s'}`;const frag=document.createDocumentFragment();for(const s of a){const b=document.createElement('button');b.className='skin card'+(s===S.skin?' chosen':'');b.append(makeSpriteThumb(s));const text=document.createElement('span');text.className='card-copy';const name=document.createElement('b');name.textContent=s.id;const meta=document.createElement('small');meta.textContent=`${s.className||'Unassigned'} · ${s.family||'Other'}`;text.append(name,meta);b.append(text);b.onclick=()=>select(s);frag.append(b)}$('skins').replaceChildren(frag)}
function selectedDyeSlot(target){const d=S.dyes[target],b=document.createElement('button');b.className='dye-slot'+(S.dyeTarget===target?' active':'');b.dataset.target=target;if(d)b.append(makeDyeThumb(d,32));else{const blank=document.createElement('span');blank.className='empty-dye';blank.textContent='∅';b.append(blank)}const copy=document.createElement('span');copy.className='slot-copy';const title=document.createElement('b');title.textContent=target==='clothing'?'Clothing':'Accessory';const name=document.createElement('small');name.textContent=d?.id||'No dye';copy.append(title,name);b.append(copy);b.onclick=()=>{S.dyeTarget=target;S.dyeCategory='all';renderDyePanel()};return b}
function categoryRows(){const target=S.dyeTarget,rows=[['all','All'],['colors','Colors'],['textiles','Textiles'],['animated','Animated']];return rows.map(([key,label])=>[key,label,filterDyes(dyes,target,'',key).length])}
function renderDyePanel(){const slots=$('dyeSlots');slots.replaceChildren(selectedDyeSlot('clothing'),selectedDyeSlot('accessory'));const cats=$('dyeCategories'),frag=document.createDocumentFragment();for(const[key,label,count]of categoryRows()){const b=document.createElement('button');b.className='filter-chip'+(S.dyeCategory===key?' chosen':'');b.textContent=`${label} ${count}`;b.onclick=()=>{S.dyeCategory=key;renderDyePanel()};frag.append(b)}cats.replaceChildren(frag);const target=S.dyeTarget,a=filterDyes(dyes,target,$('dyeSearch').value,S.dyeCategory);$('dyeCount').textContent=`${a.length} ${target==='clothing'?'clothing':'accessory'} dyes`;const list=document.createDocumentFragment();for(const d of a){const b=document.createElement('button');b.className='dye card'+(S.dyes[target]===d?' chosen':'');b.append(makeDyeThumb(d));const text=document.createElement('span');text.className='card-copy';const name=document.createElement('b');name.textContent=d.id;const meta=document.createElement('small');meta.textContent=d.animation?`Animated · ${d.animation.type}`:d.kind==='textile'?'Textile':'Color';text.append(name,meta);b.append(text);if(d.color){const sw=document.createElement('span');sw.className='color-dot';sw.style.background=d.color;b.append(sw)}b.onclick=()=>{S.dyes[target]=S.dyes[target]===d?null:d;renderDyePanel();renderIndexBridge()};list.append(b)}$('dyeList').replaceChildren(list);$('clearDye').disabled=!S.dyes[target]}

/* V314_SELECTED_INDEX_SHORTCUTS: only the current skin + chosen dyes. */
let indexBridgeOpen='',indexBridgeSignature='';
function indexBridgeEntry(kind,id){return id&&indexBridge?.[kind]?.[id]||null}
function indexBridgeTarget(kind,id){const entry=indexBridgeEntry(kind,id);return entry?.target||entry?.match||null}
function ensureIndexBridgeBox(){
  let box=$('indexBridge');
  if(box)return box;
  box=document.createElement('section');box.id='indexBridge';box.className='index-bridge selected-index-bridge';
  const anchor=canvas.closest('.sandbox')||canvas.closest('.world-stage')||canvas.closest('.world')||canvas.parentElement;
  if(anchor?.parentElement)anchor.insertAdjacentElement('afterend',box);
  else $('meta')?.insertAdjacentElement('beforebegin',box);
  return box;
}
function selectedIndexThumb(kind,source){
  return kind==='skins'?makeSpriteThumb(source,32):makeDyeThumb(source,32)
}
function selectedIndexCard(label,kind,source){
  const entry=indexBridgeEntry(kind,source?.id),target=entry?.target||entry?.match||null;
  const key=`${kind}:${source?.id||''}`;
  const button=document.createElement('button');button.type='button';button.className='selected-index-card';
  if(indexBridgeOpen===key)button.classList.add('is-open');
  button.append(selectedIndexThumb(kind,source));
  const text=document.createElement('span'),name=document.createElement('b'),sub=document.createElement('small');
  name.textContent=source?.id||label;
  if(target){
    const mapped=target.said||target.name||target.id;
    const via=entry?.targetReason==='exact-set-skin-family'?'Set in Index':'Index';
    sub.textContent=`${via} · ${mapped}`;
    button.classList.add('is-linked');
    button.title=`Show the linked Index record: ${mapped}`;
  }else{
    sub.textContent=entry?.ambiguous?.length?'Ambiguous Index match':'No exact Index link';
    button.classList.add('is-unlinked');
    button.title=sub.textContent;
  }
  text.append(name,sub);button.append(text);
  const mark=document.createElement('em');mark.textContent=target?'Index ›':'—';button.append(mark);
  button.onclick=()=>{
    if(!target)return;
    indexBridgeOpen=indexBridgeOpen===key?'':key;
    indexBridgeSignature='';
    renderIndexBridge();
  };
  return button;
}
function selectedIndexDetail(kind,source){
  const entry=indexBridgeEntry(kind,source?.id),target=entry?.target||entry?.match;
  if(!target)return null;
  const detail=document.createElement('div');detail.className='selected-index-detail';
  const head=document.createElement('div'),title=document.createElement('b'),type=document.createElement('small');
  title.textContent=target.said||target.name||target.id;
  type.textContent=[target.kind,target.family].filter(Boolean).join(' · ')||'Index record';
  head.append(title,type);detail.append(head);
  const add=(label,items)=>{
    if(!items?.length)return;
    const row=document.createElement('p'),key=document.createElement('strong'),values=document.createElement('span');
    key.textContent=label;
    for(const one of items){
      const chip=document.createElement('i');chip.textContent=one.said||one.name||one.pageTitle||one.id;values.append(chip);
    }
    row.append(key,values);detail.append(row);
  };
  add('Drops',entry.drops);
  add('Sets',entry.sets);
  if(!entry.drops?.length&&!entry.sets?.length){
    const none=document.createElement('p');none.className='is-muted';none.textContent='No drop/set relation in the current Index projection.';detail.append(none);
  }
  return detail;
}
function renderIndexBridge(){
  const box=ensureIndexBridgeBox();if(!box)return;
  const pieces=[];
  if(S.skin)pieces.push(['Skin','skins',S.skin]);
  if(S.dyes.clothing)pieces.push(['Clothing','dyes',S.dyes.clothing]);
  if(S.dyes.accessory)pieces.push(['Accessory','dyes',S.dyes.accessory]);

  const sig=JSON.stringify([
    S.skin?.id||'',S.dyes.clothing?.id||'',S.dyes.accessory?.id||'',indexBridgeOpen,
    indexBridge?.built||''
  ]);
  if(sig===indexBridgeSignature&&box.childElementCount)return;
  indexBridgeSignature=sig;box.replaceChildren();

  const head=document.createElement('div');head.className='selected-index-head';
  const title=document.createElement('b');title.textContent='Selected · Index';
  const note=document.createElement('small');note.textContent='skin / clothing / accessory';
  head.append(title,note);box.append(head);

  const rail=document.createElement('div');rail.className='selected-index-rail';
  for(const [label,kind,source]of pieces)rail.append(selectedIndexCard(label,kind,source));
  box.append(rail);

  if(indexBridgeOpen){
    const found=pieces.find(([,kind,source])=>`${kind}:${source?.id||''}`===indexBridgeOpen);
    const detail=found&&selectedIndexDetail(found[1],found[2]);
    if(detail)box.append(detail);
  }
}

function renderFrameState(){const f=current();$('missing').hidden=!!f?.spriteAvailable;$('name').textContent=S.skin?.id||'No skin';$('meta').textContent=S.skin&&f?`${S.skin.className||'Unassigned'} · ${S.skin.family||'Other'} · ${f.rect.w}×${f.rect.h}px${!f.maskAvailable?' · dye mask unavailable':''}`:'';renderIndexBridge()}
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
function rememberPointer(e){const p=point(e);S.pointer=p;return p}
function movementDirection(){let x=0,y=0;if(S.keys.has('ArrowLeft')||S.keys.has('KeyA'))x--;if(S.keys.has('ArrowRight')||S.keys.has('KeyD'))x++;if(S.keys.has('ArrowUp')||S.keys.has('KeyW'))y--;if(S.keys.has('ArrowDown')||S.keys.has('KeyS'))y++;if(x)return{raw:0,left:x<0};if(y)return{raw:y<0?3:2,left:false};return null}
function applyFacing(d){if(!d)return false;const left=d.raw===0?!!d.left:false,changed=d.raw!==S.facingRaw||left!==S.left;S.facingRaw=d.raw;S.left=left;return changed}
function applyMovementFacing(){return applyFacing(movementDirection())}
function aimAttackPoint(p){S.pointer=p;const target=directionFromPointer(p.x,p.y,S.world.x,S.world.y),changed=applyFacing(target);if(!S.shooting||!changed)return;const q=sequence(2,S.facingRaw,S.seq?.set??0);if(q?.actionRaw===2&&q!==S.seq){const i=S.index;S.seq=q;S.index=i%Math.max(1,q.frames.length);renderFrameState()}}
function attack(e){if(e.button!==undefined&&e.button!==0)return;const now=performance.now(),p=rememberPointer(e);applyFacing(directionFromPointer(p.x,p.y,S.world.x,S.world.y));const q=sequence(2,S.facingRaw,S.seq?.set??0);if(!q||q.actionRaw!==2)return;S.shooting=true;S.attackStart=now;S.attackUntil=Infinity;S.nextShotAt=now;S.facingRaw=q.directionRaw;S.left=q.directionRaw===0?(p.x<S.world.x):false;S.seq=q;S.index=0;S.last=now;renderFrameState();if(e.pointerId!==undefined)canvas.setPointerCapture?.(e.pointerId)}
function releaseAttack(e){if(!S.shooting)return;const now=performance.now(),period=attackPeriod(S.seq),elapsed=Math.max(0,now-S.attackStart);S.shooting=false;S.attackUntil=S.attackStart+(Math.floor(elapsed/period)+1)*period;if(e?.pointerId!==undefined&&canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId)}
function advance(){if(!S.seq?.frames.length)return;let n=(S.index+1)%S.seq.frames.length;if(S.seq.frames.some(x=>x.spriteAvailable)){let guard=0;while(!S.seq.frames[n].spriteAvailable&&guard++<S.seq.frames.length)n=(n+1)%S.seq.frames.length}S.index=n}
function updateMovement(dt){let x=0,y=0;if(S.keys.has('ArrowLeft')||S.keys.has('KeyA'))x--;if(S.keys.has('ArrowRight')||S.keys.has('KeyD'))x++;if(S.keys.has('ArrowUp')||S.keys.has('KeyW'))y--;if(S.keys.has('ArrowDown')||S.keys.has('KeyS'))y++;if(!x&&!y)return;if(x&&y){x*=Math.SQRT1_2;y*=Math.SQRT1_2}const speed=6,a=S.playArea,b=realmAtlas.bounds||{},minX=(a?.x0??b.minX??-Infinity)+1,maxX=(a?.x1??b.maxX??Infinity)-1,minY=(a?.y0??b.minY??-Infinity)+1,maxY=(a?.y1??b.maxY??Infinity)-1;S.player.x=Math.max(minX,Math.min(maxX,S.player.x+x*speed*dt));S.player.y=Math.max(minY,Math.min(maxY,S.player.y+y*speed*dt));S.mapDirty=true;syncRenderScale()}
function setKey(e,down){if(!active||host.closest('[hidden]'))return;if(/^(INPUT|SELECT|TEXTAREA)$/.test(root.activeElement?.tagName||''))return;const moving=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'];if(!moving.includes(e.code))return;if(down&&e.repeat){e.preventDefault();return}if(down)S.keys.add(e.code);else S.keys.delete(e.code);if(!S.attackUntil){applyMovementFacing();syncActivity(performance.now(),true)}e.preventDefault()}
function zoomWheel(e){e.preventDefault();const factor=Math.exp(-e.deltaY*.0015);S.camera.scale=Math.max(minRealmScale(),Math.min(64,S.camera.scale*factor));syncRenderScale();S.mapDirty=true;$('zoomValue').textContent=`${(S.camera.scale/realmAtlas.px).toFixed(2)}×`}

renderClassPicker();renderFamilies();loadBeachArea();select(skins.find(s=>s.frames.some(f=>f.spriteAvailable))||skins[0]);renderDyePanel();renderLibraryControls();root.querySelectorAll('[data-world-mode]').forEach(button=>button.onclick=()=>setWorldMode(button.dataset.worldMode));setWorldMode(S.worldMode,true);
const attackSpeed=$('attackSpeed'),attackSpeedValue=$('attackSpeedValue');function renderAttackSpeed(){const period=attackPeriod();attackSpeed.value=String(S.attackSpeed);attackSpeedValue.textContent=`${S.attackSpeed.toFixed(2)}× · ${(1000/period).toFixed(2)}/s`}renderAttackSpeed();attackSpeed.oninput=()=>{S.attackSpeed=Math.max(.25,Math.min(4,Number(attackSpeed.value)||1));localStorage.setItem('skinViewerAttackSpeed',String(S.attackSpeed));const now=performance.now();if(S.shooting){S.attackStart=now;S.nextShotAt=now}renderAttackSpeed()};
$('search').oninput=()=>{renderCatalogueUI()};$('dyeSearch').oninput=renderDyePanel;$('clearDye').onclick=()=>{S.dyes[S.dyeTarget]=null;renderDyePanel();renderIndexBridge()};$('resetWorld').onclick=()=>{resetWorldMode();$('zoomValue').textContent=`${(S.camera.scale/realmAtlas.px).toFixed(2)}×`};
canvas.addEventListener('pointermove',e=>{const p=point(e);if(S.shooting)aimAttackPoint(p);else S.pointer=p});canvas.addEventListener('pointerdown',e=>{canvas.focus();attack(e)});canvas.addEventListener('pointerup',releaseAttack);canvas.addEventListener('pointercancel',releaseAttack);canvas.addEventListener('wheel',zoomWheel,{passive:false});canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>setKey(e,true));window.addEventListener('keyup',e=>setKey(e,false));window.addEventListener('blur',()=>{S.keys.clear();S.shooting=false;S.attackUntil=0;applyMovementFacing();syncActivity(performance.now(),true)});
function referenceBodyWidth(){const f=current();if(!f)return 8;const set=S.seq?.set??0,dir=S.seq?.directionRaw??S.facingRaw,pool=S.skin?.sequences||[];for(const actionRaw of[0,1]){const q=pool.find(q=>q.set===set&&q.actionRaw===actionRaw&&q.directionRaw===dir&&q.frames.some(f=>f.spriteAvailable));const widths=q?.frames.filter(f=>f.spriteAvailable&&f.rect?.w).map(f=>f.rect.w)||[];if(widths.length)return Math.min(...widths)}return Math.min(f.rect.w,f.rect.h)||f.rect.w||8}
function anchoredWorld(){const f=current();if(!f||S.seq?.actionRaw!==2)return S.world;const bodyWidth=referenceBodyWidth();if(f.rect.w<=bodyWidth)return S.world;return{...S.world,x:attackAnchorX(S.world.x,f.rect.w,bodyWidth,S.world.scale,S.left)}}
let previous=performance.now();function tick(now){const dt=Math.min(.05,(now-previous)/1000);previous=now;if(active&&!host.closest('[hidden]')){updateMovement(dt);updateProjectiles(dt,now);drawRealmWorld(now);if(!S.shooting&&S.attackUntil&&now>=S.attackUntil){S.attackUntil=0;applyMovementFacing();syncActivity(now,true)}const attacking=S.seq?.actionRaw===2&&(S.shooting||(S.attackUntil&&now<S.attackUntil)),f=current();if(attacking)attackFrame(now);else if(f&&now-S.last>=FRAME_MS){advance();S.last=now}renderer.draw(current(),S.dyes,now,S.left,anchoredWorld());renderProjectiles()}requestAnimationFrame(tick)}requestAnimationFrame(tick);

function selectExactTarget(target){
  const resolved=resolveExactTarget(target,skins,dyes);
  if(!resolved)return false;
  if(resolved.kind==='skin'){
    select(resolved.item);
    return true;
  }
  if(resolved.kind==='dye'){
    S.dyeTarget=resolved.target;
    S.dyes[resolved.target]=resolved.item;
    renderDyePanel();renderFrameState();scheduleSelectedIndexPanel();
    return true;
  }
  return false;
}
function snapshot(){return{skin:S.skin?.id||null,clothing:S.dyes.clothing?.id||null,accessory:S.dyes.accessory?.id||null,dyeTarget:S.dyeTarget,favorites:comboFavorites.map(f=>({id:f.id,name:f.name,skinId:f.skinId,clothing:f.clothing,accessory:f.accessory}))}}
const api={
  select:selectExactTarget,
  getState:snapshot,
  setActive(value){active=Boolean(value);if(!active){S.keys.clear();S.shooting=false;S.attackUntil=0}return active},
  root,
  host
};
window.dispatchEvent(new CustomEvent('skinviewerready',{detail:{api}}));
return api;
}

if(typeof window!=='undefined'){
  window.SkinViewer={mount,unmount,select:selectTarget,getState};
  const autoHost=document.getElementById('skinViewerRoot');
  if(autoHost)mount(autoHost,{integrated:autoHost.dataset.integrated==='true'}).catch(error=>console.error('Skin Viewer failed to mount',error));
}
