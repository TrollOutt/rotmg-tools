import { Renderer } from './renderer.js';
import { resolveExactTarget } from './contracts.mjs';

export const FRAME_MS=300;
export const ATTACK_PERIOD_MS=600;
/*
 * Where a swing is anchored.
 *
 * A character's attack frame is wider than the character: an eight-pixel body
 * standing still, a sixteen-pixel rectangle when it swings, the body still
 * eight wide at the left of it and the weapon reaching out to the front. The
 * extra width is the weapon, not the person - so centring the rectangle on
 * where the character is standing slides the body half that width backwards
 * every time the swing comes round, and it reads as the character hopping.
 *
 * Moving the position forward by half the extra puts the body back exactly
 * where it stands at rest and lets the weapon reach out in front of it. The
 * vertical anchor is not touched: the feet stay on the ground.
 *
 * The same rule is written out in tools/spritesheet.js, and applied there by
 * the thing that packs these frames into strips for the bench - which lays a
 * run out from its leading edge rather than from its middle, for exactly this
 * reason.
 */
export function attackAnchorX(worldX,frameWidth,bodyWidth,pixelScale,left=false){const extra=Math.max(0,frameWidth-bodyWidth);return worldX+(left?-1:1)*extra*pixelScale/2}
export function rankSequence(q){return[(q.set===0?0:1),(q.action==='idle'?0:q.action==='walk'?1:2),q.direction==='front'?0:q.direction==='side'?1:q.direction==='back'?2:3,q.set,q.actionRaw,q.directionRaw]}
export function initialSequence(sequences){return[...sequences].sort((a,b)=>{const x=rankSequence(a),y=rankSequence(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0})[0]}
export function dyeCategory(d){return d?.kind==='remove'?'remove':d?.animation?'animated':d?.kind==='textile'?'textiles':d?.kind==='color'?'colors':'other'}
export function filterDyes(dyes,target,query,category){query=String(query||'').toLowerCase();return dyes.filter(d=>d.target===target&&d.kind!=='remove'&&(!query||d.id.toLowerCase().includes(query))&&(category==='all'||dyeCategory(d)===category))}
/*
 * Which way a character is facing, as the client numbers them: 0 to the side,
 * 2 away from you, 3 towards you.
 *
 * Walking up the screen is walking away, so it shows the back; walking down
 * is walking towards you, so it shows the face. These had it the other way
 * round, from a direction table that called two the front - which also meant
 * every skin opened showing its back.
 */
export const FACE_AWAY=2,FACE_YOU=3,FACE_SIDE=0;
export function directionFromPointer(px,py,x,y){const dx=px-x,dy=py-y;if(Math.abs(dx)>Math.abs(dy))return{raw:FACE_SIDE,left:dx<0};return{raw:dy<0?FACE_AWAY:FACE_YOU,left:false}}
export function familyOrder(a,b){if(a==='Other')return 1;if(b==='Other')return-1;if(a==='Set skins')return 1;if(b==='Set skins')return-1;return a.localeCompare(b)}

function storageGet(key){try{return localStorage.getItem(key)}catch{return null}}
function storageSet(key,value){try{localStorage.setItem(key,value);return true}catch{return false}}

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
window.RealmI18n?.observe(root);
let active=true;
const $=x=>root.getElementById(x);
/*
 * Two files, joined on the client's own type.
 *
 * What a skin is called, whose class it belongs to, which costume it is part
 * of and what unlocks it are facts about a thing, and they live on its index
 * record like every other fact on this site. Where each of its frames sits on
 * the client's packed sheet is geometry, which the index has no use for, and
 * lives beside it.
 *
 * This viewer used to carry both in one eighteen-megabyte catalogue that
 * nothing in the repository could rebuild, with a bridge back to the index
 * that matched records up by name. Both halves are generated now -
 * tools/generate-skins.js projects the first out of the index and
 * tools/build-skin-looks.js reads the second out of the client - and the
 * bridge is gone, because the index states the joins outright.
 *
 * Everything below this point still sees the shape it always saw.
 */
const [skinCatalogue,dyeCatalogue,classCatalogue,looks,realmAtlas]=await Promise.all([
  'assets/skins/generated/skins.json','assets/skins/generated/dyes.json',
  'assets/skins/generated/classes.json','assets/skins/generated/looks.json',
  'assets/atlas/atlas.json'
].map(x=>fetch(x).then(r=>{if(!r.ok)throw Error(`${x}: ${r.status}`);return r.json()})));

/* A frame row is [set, action, direction, x, y, w, h, maskX, maskY, padding]. */
const SAY_ACTION=looks.actions||[],SAY_DIRECTION=looks.directions||[];
function framesOf(geometry){
  if(!geometry)return{sequences:[],frames:[]};
  const sequences=[],byKey=new Map(),flat=[];
  for(const row of geometry.frames){
    const[set,action,direction,x,y,w,h,maskX,maskY]=row;
    const frame={
      set,actionRaw:action,directionRaw:direction,
      action:SAY_ACTION[action]||('action '+action),
      direction:SAY_DIRECTION[direction]||('direction '+direction),
      atlas:'looks',rect:{x,y,w,h},
      maskRect:maskX<0?null:{x:maskX,y:maskY,w,h},
      spriteAvailable:true,maskAvailable:maskX>=0
    };
    flat.push(frame);
    /* One sequence per animation, in the order the client wrote them. */
    const key=set+'|'+action+'|'+direction;
    let sequence=byKey.get(key);
    if(!sequence){
      sequence={set,actionRaw:action,directionRaw:direction,
        action:frame.action,direction:frame.direction,frames:[]};
      byKey.set(key,sequence);sequences.push(sequence);
    }
    frame.frame=sequence.frames.length;
    sequence.frames.push(frame);
  }
  return{sequences,frames:flat};
}

/*
 * Only what there is a picture of.
 *
 * The client declares nineteen skins - every 2-Bit class - whose
 * <AnimatedTexture> its own sprite registry has no entry for, so there is
 * nothing to draw. They belong in the index, which records what the game
 * declares; they do not belong in a list of things to look at, where they
 * were nineteen blank rows that opened onto "missing sprite frame".
 *
 * They are left out here rather than greyed out: a viewer offering something
 * it cannot show is worse than a viewer that is one line shorter.
 */
const undrawn=skinCatalogue.skins.filter(one=>!looks.skins[one.type]);
const skins=skinCatalogue.skins.filter(one=>looks.skins[one.type]).map(one=>{
  const drawn=framesOf(looks.skins[one.type]);
  return{
    id:one.name,indexId:one.id,type:Number.parseInt(one.type,16),
    className:one.wears||null,
    /* The costume, which the index marks as read off the name rather than
       declared. Anything no second skin shares a stem with is its own. */
    family:one.look||'Other',
    tier:one.tier,level:one.level,given:one.given,pick:one.pick,
    unlockers:one.unlockers||[],sets:one.sets||[],hidden:one.hidden,
    sequences:drawn.sequences,frames:drawn.frames
  };
});

const dyes=[];
for(const one of dyeCatalogue.dyes){
  const made=looks.dyes[one.type];
  if(!made)continue;
  dyes.push({
    id:one.name,indexId:one.id,type:Number.parseInt(one.type,16),
    target:made.on,
    kind:made.kind==='cloth'?'textile':made.kind,
    color:made.color||null,
    textile:made.cloth?{atlas:made.cloth.atlas,index:made.cloth.index,
      sheet:'looks',rect:made.cloth.rect}:null,
    animation:made.moves?{type:made.moves.how,speed:made.moves.speed,
      pivotX:made.moves.pivotX,pivotY:made.moves.pivotY}:null,
    icon:made.icon?{sheet:'looks',rect:made.icon.rect}:null
  });
}

const classes=classCatalogue.classes.map(one=>{
  const drawn=looks.classes[one.type];
  return{name:one.name,indexId:one.id,type:Number.parseInt(one.type,16),
    icon:drawn?{sheet:'looks',rect:drawn.rect}:null};
});
const [realmCombat,realmThingIndex,realmThingBuffer]=await Promise.all([
  fetch('assets/atlas/combat.json').then(r=>r.ok?r.json():null).catch(()=>null),
  fetch('assets/atlas/things.json').then(r=>r.ok?r.json():null).catch(()=>null),
  fetch('assets/atlas/things.bin').then(r=>r.ok?r.arrayBuffer():null).catch(()=>null)
]);
const realmThings=realmThingIndex&&realmThingBuffer?{index:realmThingIndex,at:new Uint16Array(realmThingBuffer)}:null;
/*
 * The way through to the index, carried on the record rather than guessed.
 *
 * There was a file of 864 name matches here. The index states 1,431 of the
 * same joins outright - the unlocker names its skin by type, the set names
 * its skin by type - so each skin and each dye simply knows its own index id
 * and the ids of what it is joined to.
 */
const indexBridge={
  skins:Object.fromEntries(skins.map(one=>[one.id,{
    target:{kind:'index',id:one.indexId},
    match:{kind:'index',id:one.indexId},
    unlockers:one.unlockers,sets:one.sets,reason:'declared by the client'
  }])),
  dyes:Object.fromEntries(dyes.map(one=>[one.id,{
    target:{kind:'index',id:one.indexId},
    match:{kind:'index',id:one.indexId},reason:'declared by the client'
  }])),
  reverse:{}
};
for(const one of skins){
  for(const to of [one.indexId,...one.unlockers,...one.sets].filter(Boolean)){
    (indexBridge.reverse[to]||(indexBridge.reverse[to]=[]))
      .push({kind:'skin',id:one.id,type:one.type,reason:'declared by the client'});
  }
}
const canvas=$('canvas'),worldBg=$('worldBg'),fxCanvas=$('fxCanvas'),renderer=new Renderer(canvas),bg=worldBg.getContext('2d'),fx=fxCanvas.getContext('2d'),CLASS_ORDER=['Wizard','Priest','Archer','Rogue','Warrior','Knight','Paladin','Assassin','Necromancer','Huntress','Mystic','Trickster','Sorcerer','Ninja','Samurai','Bard','Summoner','Kensei'];
classes.sort((a,b)=>{const ai=CLASS_ORDER.indexOf(a.name),bi=CLASS_ORDER.indexOf(b.name);return(ai<0?999:ai)-(bi<0?999:bi)||a.name.localeCompare(b.name)});
const S={skin:null,seq:null,index:0,left:false,dyes:{clothing:null,accessory:null},last:0,facingRaw:FACE_YOU,attackUntil:0,shooting:false,attackStart:0,attackSpeed:1,nextShotAt:0,projectiles:[],keys:new Set(),world:{x:canvas.width/2,y:canvas.height/2,scale:4},player:{x:0,y:0},spawn:{x:0,y:0},camera:{scale:realmAtlas.px*4},playArea:null,beachArea:null,studioArea:{x0:-20,y0:-13,x1:20,y1:13},beachBeacon:null,modeState:{beach:null,studio:{player:{x:0,y:0},spawn:{x:0,y:0},scale:realmAtlas.px*4}},mapDirty:true,lastMapDraw:0,pointer:{x:canvas.width/2,y:canvas.height/2},className:'',family:'',dyeTarget:'clothing',dyeCategory:'all',classOpen:true};
S.attackSpeed=Math.max(.25,Math.min(4,Number(storageGet('skinViewerAttackSpeed'))||1));
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
function readComboFavorites(){try{const value=JSON.parse(storageGet(COMBO_FAVORITES_KEY)||'[]');return Array.isArray(value)?value.map(normalizeComboFavorite).filter(Boolean):[]}catch{return[]}}
let comboFavorites=readComboFavorites();
S.catalogMode=storageGet('skinViewerCatalogMode')==='favorites'?'favorites':'skins';

/* V311B_STUDIO_THEME */
S.studioTheme=storageGet('skinViewerStudioTheme')==='light'?'light':'dark';
/* V39_STUDIO_MODE: a neutral inspection background beside the real Beach pocket. */
S.worldMode=storageGet('skinViewerWorldMode')==='studio'?'studio':'beach';
bg.imageSmoothingEnabled=false;fx.imageSmoothingEnabled=false;
const atlasImages=new Map(),atlasWork=new WeakMap();
const THUMB_BATCH=96;

function atlas(sheet){
  if(!sheet)return null;
  if(!atlasImages.has(sheet)){
    const image=new Image();
    const work={jobs:[],ready:null,finish:null};
    work.ready=new Promise(resolve=>{work.finish=resolve});

    const drain=()=>{
      const batch=work.jobs.splice(0,THUMB_BATCH);
      for(const draw of batch)draw();
      if(work.jobs.length){
        requestAnimationFrame(drain);
        return;
      }
      work.finish(true);
    };

    image.addEventListener('load',()=>requestAnimationFrame(drain),{once:true});
    image.addEventListener('error',()=>{
      work.jobs.length=0;
      work.finish(false);
    },{once:true});

    atlasWork.set(image,work);
    atlasImages.set(sheet,image);
    image.src=`assets/skins/textures/${sheet}.png`;
  }
  return atlasImages.get(sheet);
}

function queueAtlasDraw(img,draw){
  if(!img)return false;
  if(img.complete&&img.naturalWidth)return draw();
  const work=atlasWork.get(img);
  if(!work)return false;
  work.jobs.push(draw);
  return true;
}

function fitDraw(ctx,img,rect,size){if(!img||!img.complete||!img.naturalWidth||!rect)return false;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,size,size);const scale=Math.max(1,Math.floor(Math.min((size-4)/rect.w,(size-4)/rect.h))),w=rect.w*scale,h=rect.h*scale;ctx.drawImage(img,rect.x,rect.y,rect.w,rect.h,Math.floor((size-w)/2),Math.floor((size-h)/2),w,h);return true}
function makeThumb(source,size=40,extra=''){const c=document.createElement('canvas');c.width=c.height=size;c.className=`thumb ${extra}`.trim();const img=atlas(source?.sheet),draw=()=>fitDraw(c.getContext('2d'),img,source?.rect,size);if(!draw()&&img)queueAtlasDraw(img,draw);return c}
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
function v314Sprite(kind,item){
  if(!item)return null;
  if(kind==='skin')return makeSpriteThumb(item,44);
  return makeDyeThumb(item,40);
}
function v314AddOpen(into,id,label){
  if(!id)return null;
  const button=document.createElement('button');
  button.type='button';button.className='chosen-open';button.dataset.indexId=id;button.textContent=label||'Open in Index';
  button.onclick=()=>window.openIndexRecord?.(id);
  into.append(button);return button;
}
function v314AddRelationRow(card,label,entries){
  const clean=(entries||[]).filter(Boolean);
  if(!clean.length)return;
  const row=document.createElement('div');row.className='chosen-row';
  const key=document.createElement('span');key.textContent=label;row.append(key);
  const chips=document.createElement('div');chips.className='chosen-chips';row.append(chips);
  const unique=new Map();
  for(const entry of clean){
    const name=v314Text(entry.name||entry.said||entry.pageTitle||entry.title||entry.id||entry.slug);
    const id=v314Text(entry.id);const href=entry.href||'';
    const token=(id?'id:'+id:(href?'href:'+href:'name:'+name));
    if(name&&!unique.has(token))unique.set(token,{name,id,href});
  }
  const values=[...unique.values()];
  for(const entry of values.slice(0,4)){
    const chip=document.createElement(entry.id?'button':entry.href?'a':'span');chip.className='chosen-chip';chip.textContent=entry.name;
    if(entry.id){chip.type='button';chip.onclick=()=>window.openIndexRecord?.(entry.id)}
    else if(entry.href){chip.href=entry.href;chip.target='_blank';chip.rel='noopener noreferrer'}
    chips.append(chip);
  }
  if(values.length>4){const more=document.createElement('span');more.className='chosen-chip';more.textContent='+'+(values.length-4);chips.append(more)}
  card.append(row);
}
function v314SelectedCard(kind,label,item){
  const card=document.createElement('article');card.className='chosen-card';card.dataset.kind=kind;
  const top=document.createElement('div');top.className='chosen-top';card.append(top);
  const art=document.createElement('div');art.className='chosen-art';top.append(art);
  const sprite=v314Sprite(kind,item);if(sprite)art.append(sprite);else{const none=document.createElement('span');none.className='chosen-empty-art';none.textContent='∅';art.append(none)}
  const copy=document.createElement('div');top.append(copy);
  const kindNode=document.createElement('div');kindNode.className='chosen-kind';kindNode.textContent=label;copy.append(kindNode);
  const name=document.createElement('div');name.className='chosen-name';name.textContent=item?.id||(kind==='skin'?'No skin':'No dye selected');copy.append(name);
  const sub=document.createElement('div');sub.className='chosen-sub';
  sub.textContent=item?(kind==='skin'?[item.className,item.family].filter(Boolean).join(' · '):(kind==='clothing'?'Clothing dye':'Accessory dye')):'None';copy.append(sub);
  const actions=document.createElement('div');actions.className='chosen-actions';card.append(actions);
  if(!item){const empty=document.createElement('span');empty.className='chosen-missing';empty.textContent='Nothing selected';actions.append(empty);return card}
  const info=v314BridgeEntry(kind,item);
  if(info?.match){v314AddOpen(actions,info.match.id,'Open in Index')}
  else if(kind==='skin'&&info?.targetKind==='set'&&info?.target){
    const note=document.createElement('span');note.className='chosen-missing';note.textContent='Skin card not linked exactly yet.';actions.append(note);
    v314AddOpen(actions,info.target.id,'Open set in Index');
  }else{
    const missing=document.createElement('span');missing.className='chosen-missing';
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
  const panel=$('selectedIndex');
  if(!panel)return;
  panel.replaceChildren();
  const head=document.createElement('div');head.className='chosen-head';head.textContent='Index · selected';panel.append(head);
  const grid=document.createElement('div');grid.className='chosen-grid';panel.append(grid);
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

/* One line of whatever somebody typed. */
function oneLine(value){return String(value==null?'':value).replace(/\s+/g,' ').trim()}
function setCatalogMode(mode){
  S.catalogMode=mode==='favorites'?'favorites':'skins';
  try{storageSet('skinViewerCatalogMode',S.catalogMode)}catch{}
  /* While the shortlist is what the panel shows, the two ways of narrowing
     the whole catalogue have nothing to narrow. */
  host.classList.toggle('favorites-mode',S.catalogMode==='favorites');
  renderSandboxBar();renderCatalogueUI();
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
/*
 * The sandbox bar, bound to the markup rather than built beside it.
 *
 * This used to be assembled in script, positioned by measuring the canvas's
 * ancestors until one was about the right size, and kept in step by rebuilding
 * itself on every click, change and resize - while hiding the markup it was
 * duplicating by searching every node for the words "wasd" and "attack speed".
 * It is in view.html now, with ids, and this only keeps it current.
 */
function attackSpeedLabel(){
  const speed=Math.max(.25,Math.min(4,Number(S.attackSpeed)||1));
  let rate='';
  try{if(typeof baseAttackRate==='function')rate=' · '+RealmI18n.number(speed*baseAttackRate(),{maximumFractionDigits:2})+'/s'}catch{}
  return RealmI18n.number(speed,{maximumFractionDigits:2})+'×'+rate;
}
function renderSandboxBar(){
  const slider=$('attackSpeed'),out=$('attackSpeedValue');
  if(slider&&root.activeElement!==slider)slider.value=String(S.attackSpeed);
  if(out)out.textContent=attackSpeedLabel();
  for(const button of root.querySelectorAll('[data-catalog-mode]')){
    button.classList.toggle('is-on',button.dataset.catalogMode===S.catalogMode);
  }
  const count=$('favoriteCount');
  if(count)count.textContent=String(comboFavorites.length);
}
$('attackSpeed').addEventListener('input',event=>{
  S.attackSpeed=Math.max(.25,Math.min(4,Number(event.target.value)||1));
  try{storageSet('skinViewerAttackSpeed',String(S.attackSpeed))}catch{}
  const now=performance.now();
  if(S.shooting){S.attackStart=now;S.nextShotAt=now}
  renderSandboxBar();
});
for(const button of root.querySelectorAll('[data-catalog-mode]')){
  button.addEventListener('click',()=>setCatalogMode(button.dataset.catalogMode));
}
$('saveCombo').addEventListener('click',openSaveComboDialog);
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
function select(s){if(!s)return;S.skin=s;const q=initialSequence(s.sequences);S.seq=q;S.facingRaw=q?.directionRaw??FACE_YOU;S.left=false;S.index=0;S.attackUntil=0;S.shooting=false;S.attackStart=0;S.nextShotAt=0;S.projectiles.length=0;syncRenderScale();syncActivity(performance.now(),true);renderFrameState();renderCatalogueUI();scheduleSelectedIndexPanel()}
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
  storageSet('skinViewerStudioTheme',S.studioTheme);
  renderStudioTheme();
  if(S.worldMode==='studio'){S.mapDirty=true;drawRealmWorld(performance.now(),true)}
}

function renderWorldMode(){root.querySelectorAll('[data-world-mode]').forEach(button=>button.classList.toggle('selected',button.dataset.worldMode===S.worldMode));const hint=$('worldModeHint');if(hint)hint.textContent=S.worldMode==='studio'?'Studio · inspection room':'Beach · real Atlas area';renderStudioTheme()}
function rememberWorldMode(){const slot=S.modeState[S.worldMode]||{};slot.player={...S.player};slot.scale=S.camera.scale;if(!slot.spawn)slot.spawn={...S.player};S.modeState[S.worldMode]=slot}
function setWorldMode(mode,initial=false){const next=mode==='studio'?'studio':'beach';if(!initial)rememberWorldMode();S.worldMode=next;storageSet('skinViewerWorldMode',S.worldMode);S.playArea=next==='studio'?S.studioArea:S.beachArea;const slot=S.modeState[next];if(slot?.player)S.player={...slot.player};else if(next==='studio')S.player={x:0,y:0};else if(S.beachArea)S.player={x:(S.beachArea.x0+S.beachArea.x1)/2,y:(S.beachArea.y0+S.beachArea.y1)/2};S.spawn={...(slot?.spawn||S.player)};S.camera.scale=Math.max(minRealmScale(),slot?.scale||defaultScale());S.projectiles.length=0;S.keys.clear();S.attackUntil=0;S.shooting=false;S.mapDirty=true;syncRenderScale();renderWorldMode();drawRealmWorld(performance.now(),true)}
function resetWorldMode(){const slot=S.modeState[S.worldMode],spawn=slot?.spawn||{x:0,y:0};S.player={...spawn};S.camera.scale=defaultScale();S.projectiles.length=0;S.keys.clear();S.attackUntil=0;S.shooting=false;if(slot){slot.player={...S.player};slot.scale=S.camera.scale}S.mapDirty=true;syncRenderScale();drawRealmWorld(performance.now(),true)}
function drawRealmWorld(now,force=false){if(S.worldMode==='studio'){if(!force&&!S.mapDirty)return;bg.clearRect(0,0,worldBg.width,worldBg.height);drawStudioBackground();S.mapDirty=false;S.lastMapDraw=now;return}const z=realmLevelFor();if(!force&&!S.mapDirty&&!(z===0&&now-S.lastMapDraw>=100))return;bg.clearRect(0,0,worldBg.width,worldBg.height);bg.fillStyle='#10151a';bg.fillRect(0,0,worldBg.width,worldBg.height);bg.save();clipBeachPocket();drawRealmLevel(z);if(z===0)drawRealmThings(now);bg.restore();S.mapDirty=false;S.lastMapDraw=now}
function loadBeachArea(){const area=beachPocket();S.beachArea=area;S.playArea=area;S.beachBeacon=area.beacon;const cx=area.beacon?.x??(area.x0+area.x1)/2,cy=area.beacon?.y??(area.y0+area.y1)/2,pad=1.5;S.player.x=Math.max(area.x0+pad,Math.min(area.x1-pad,cx+2));S.player.y=Math.max(area.y0+pad,Math.min(area.y1-pad,cy+3));S.spawn={x:S.player.x,y:S.player.y};S.camera.scale=defaultScale();S.modeState.beach={player:{...S.player},spawn:{...S.spawn},scale:S.camera.scale};S.projectiles.length=0;S.mapDirty=true;syncRenderScale()}
const projectileArt=v=>{if(!v?.file)return null;let img=projectileImages.get(v.file);if(!img){img=new Image();img.decoding='async';img.src=`assets/atlas/combat/${v.file}`;projectileImages.set(v.file,img)}return img};
function projectileDirection(){let dx=S.pointer.x-S.world.x,dy=S.pointer.y-S.world.y,len=Math.hypot(dx,dy);if(len<1){if(S.facingRaw===FACE_SIDE){dx=S.left?-1:1;dy=0}else{dx=0;dy=S.facingRaw===FACE_AWAY?-1:1}len=1}return{x:dx/len,y:dy/len}}
function spawnProjectile(){const aim=projectileDirection(),base=Math.atan2(aim.y,aim.x),defs=combatWeaponShots(),usable=defs.length?defs:[{fast:18,reach:8.5,many:1,fan:0,rate:1}];for(const def of usable){const many=Math.max(1,Number(def.many)||1),gap=(Number(def.fan)||0)*Math.PI/180;for(let i=0;i<many;i++){const angle=base+(i-(many-1)/2)*gap,fast=Math.max(.1,Number(def.fast)||18),life=Math.max(.08,Number(def.life)||(Number(def.reach)||8.5)/fast);S.projectiles.push({x:S.player.x+Math.cos(angle)*.35,y:S.player.y+Math.sin(angle)*.35,vx:Math.cos(angle)*fast,vy:Math.sin(angle)*fast,age:0,life,definition:def,visual:def.visual||null})}}if(S.projectiles.length>MAX_PROJECTILES)S.projectiles.splice(0,S.projectiles.length-MAX_PROJECTILES)}
function updateProjectiles(dt,now){if(S.shooting&&now>=S.nextShotAt){spawnProjectile();S.nextShotAt=now+attackPeriod()}for(const p of S.projectiles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.age+=dt;p.life-=dt}S.projectiles=S.projectiles.filter(p=>p.life>0&&insidePlayArea(p.x,p.y,.75))}
function renderProjectiles(){fx.clearRect(0,0,fxCanvas.width,fxCanvas.height);fx.imageSmoothingEnabled=false;for(const p of S.projectiles){const at=realmToScreen(p.x,p.y);if(at.x<-30||at.y<-30||at.x>fxCanvas.width+30||at.y>fxCanvas.height+30)continue;const v=p.visual,img=projectileArt(v);if(v&&img?.complete&&img.naturalWidth){const frames=Math.max(1,v.frames||1),frame=Math.floor(p.age*8)%frames,sw=v.width||img.naturalWidth/frames,sh=v.height||img.naturalHeight,visualScale=((p.definition?.motion?.size)||100)/100,wide=Math.max(3,S.camera.scale*sw*visualScale/8),tall=wide*sh/sw;fx.save();fx.translate(at.x,at.y);const spin=v.rotation?p.age*1000/v.rotation:0;fx.rotate(Math.atan2(p.vy,p.vx)+(v.angle||0)*Math.PI/4+spin);fx.drawImage(img,frame*sw,0,sw,sh,-wide/2,-tall/2,wide,tall);fx.restore()}else{const tail=realmToScreen(p.x-p.vx*.045,p.y-p.vy*.045);fx.strokeStyle='#ffe078';fx.lineWidth=Math.max(2,S.camera.scale/12);fx.beginPath();fx.moveTo(tail.x,tail.y);fx.lineTo(at.x,at.y);fx.stroke()}}}

/*
 * The classes fold away once one has been picked.
 *
 * Nineteen buttons and a row of families take most of the panel, and past the
 * first choice nobody is reading them - they are reading the list of skins
 * underneath, which had a fifth of the height left for it. So the grid folds
 * to the choice itself, with a way to take it back, the way the index's rail
 * folds past its first category.
 *
 * Choosing "All" folds it too: it is a choice like any other, and the reader
 * who wants the whole catalogue wants the room for it most of all.
 */
function renderClassPicker(){
  const box=$('classes');
  box.classList.toggle('is-folded',!S.classOpen);
  if(!S.classOpen){
    const mine=classes.find(c=>c.name===S.className);
    const b=document.createElement('button');
    b.className='class-pick class-folded';
    b.title='Choose a different class';
    if(mine)b.append(makeClassThumb(mine));
    else{const g=document.createElement('span');g.className='all-glyph';g.textContent='✦';b.append(g)}
    const name=document.createElement('span');name.textContent=S.className||'All classes';
    const back=document.createElement('em');back.textContent='change';
    b.append(name,back);
    b.onclick=()=>{S.classOpen=true;renderClassPicker()};
    box.replaceChildren(b);
    return;
  }
  const frag=document.createDocumentFragment();
  const pick=name=>{
    S.className=name;
    if(name&&S.family&&!familyAvailableInClass(S.family,name))S.family='';
    S.classOpen=false;
    renderSandboxBar();renderClassPicker();renderFamilies();ensureVisibleSelection();
  };
  const all=document.createElement('button');
  all.className='class-pick all-pick'+(!S.className?' chosen':'');
  all.innerHTML='<span class="all-glyph">✦</span><span>All</span>';
  all.onclick=()=>pick('');
  frag.append(all);
  for(const c of classes){
    const b=document.createElement('button');
    b.className='class-pick'+(S.className===c.name?' chosen':'');
    b.title=c.name;
    b.append(makeClassThumb(c));
    const name=document.createElement('span');name.textContent=c.name;
    b.append(name);
    b.onclick=()=>pick(c.name);
    frag.append(b);
  }
  box.replaceChildren(frag);
}
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

function saveComboFavorites(){storageSet(COMBO_FAVORITES_KEY,JSON.stringify(comboFavorites))}
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
  const proposed=same?.name||defaultComboName(),clean=oneLine(name)||proposed,entry={
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
  try{storageSet('skinViewerCatalogMode','favorites')}catch{}
  renderSandboxBar();renderCatalogueUI();
}
function removeComboFavorite(id){
  comboFavorites=comboFavorites.filter(f=>f.id!==id);
  saveComboFavorites();renderSandboxBar();if(S.catalogMode==='favorites')renderCatalogueUI();
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
  if(img)queueAtlasDraw(img,draw);
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

function renderBrowseCatalogueUI(){const a=visibleSkins();$('count').textContent=`${a.length} skin${a.length===1?'':'s'}`;const frag=document.createDocumentFragment();for(const s of a){const b=document.createElement('button');b.className='skin card'+(s===S.skin?' chosen':'');b.append(makeSpriteThumb(s));const text=document.createElement('span');text.className='card-copy';const name=document.createElement('b');name.textContent=s.id;const meta=document.createElement('small');meta.textContent=`${s.className||'Unassigned'} · ${s.family||'Other'}`;text.append(name,meta);b.append(text);b.onclick=()=>select(s);frag.append(b)}$('skins').replaceChildren(frag)}
function selectedDyeSlot(target){const d=S.dyes[target],b=document.createElement('button');b.className='dye-slot'+(S.dyeTarget===target?' active':'');b.dataset.target=target;if(d)b.append(makeDyeThumb(d,32));else{const blank=document.createElement('span');blank.className='empty-dye';blank.textContent='∅';b.append(blank)}const copy=document.createElement('span');copy.className='slot-copy';const title=document.createElement('b');title.textContent=target==='clothing'?'Clothing':'Accessory';const name=document.createElement('small');name.textContent=d?.id||'No dye';copy.append(title,name);b.append(copy);b.onclick=()=>{S.dyeTarget=target;S.dyeCategory='all';renderDyePanel()};return b}
function categoryRows(){const target=S.dyeTarget,rows=[['all','All'],['colors','Colors'],['textiles','Textiles'],['animated','Animated']];return rows.map(([key,label])=>[key,label,filterDyes(dyes,target,'',key).length])}
function renderDyePanel(){const slots=$('dyeSlots');slots.replaceChildren(selectedDyeSlot('clothing'),selectedDyeSlot('accessory'));const cats=$('dyeCategories'),frag=document.createDocumentFragment();for(const[key,label,count]of categoryRows()){const b=document.createElement('button');b.className='filter-chip'+(S.dyeCategory===key?' chosen':'');b.textContent=`${label} ${count}`;b.onclick=()=>{S.dyeCategory=key;renderDyePanel()};frag.append(b)}cats.replaceChildren(frag);const target=S.dyeTarget,a=filterDyes(dyes,target,$('dyeSearch').value,S.dyeCategory);$('dyeCount').textContent=`${a.length} ${target==='clothing'?'clothing':'accessory'} dyes`;const list=document.createDocumentFragment();for(const d of a){const b=document.createElement('button');b.className='dye card'+(S.dyes[target]===d?' chosen':'');b.append(makeDyeThumb(d));const text=document.createElement('span');text.className='card-copy';const name=document.createElement('b');name.textContent=d.id;const meta=document.createElement('small');meta.textContent=d.animation?`Animated · ${d.animation.type}`:d.kind==='textile'?'Textile':'Color';text.append(name,meta);b.append(text);if(d.color){const sw=document.createElement('span');sw.className='color-dot';sw.style.background=d.color;b.append(sw)}b.onclick=()=>{S.dyes[target]=S.dyes[target]===d?null:d;renderDyePanel();scheduleSelectedIndexPanel();};list.append(b)}$('dyeList').replaceChildren(list);$('clearDye').disabled=!S.dyes[target]}

/* V314_SELECTED_INDEX_SHORTCUTS: only the current skin + chosen dyes. */
/*
 * What the index holds about the three things chosen right now.
 *
 * There were two of these, from two passes that each added the same answer:
 * one strip wedged under the stage by asking the canvas for the first
 * ancestor it recognised, and one grid placed by comparing every node's text
 * to the skin's name. They said the same thing about the same three objects.
 * The one that is left is the one that leads somewhere - each card opens its
 * record in the index - and it renders into a container view.html gives it.
 */
function renderFrameState(){const f=current();$('missing').hidden=!!f?.spriteAvailable;$('name').textContent=S.skin?.id||'No skin';$('meta').textContent=S.skin&&f?`${S.skin.className||'Unassigned'} · ${S.skin.family||'Other'} · ${f.rect.w}×${f.rect.h}px${!f.maskAvailable?' · dye mask unavailable':''}`:'';scheduleSelectedIndexPanel();}
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
function rememberPointer(e){const p=point(e);S.pointer=p;return p}
function movementDirection(){let x=0,y=0;if(S.keys.has('ArrowLeft')||S.keys.has('KeyA'))x--;if(S.keys.has('ArrowRight')||S.keys.has('KeyD'))x++;if(S.keys.has('ArrowUp')||S.keys.has('KeyW'))y--;if(S.keys.has('ArrowDown')||S.keys.has('KeyS'))y++;if(x)return{raw:FACE_SIDE,left:x<0};if(y)return{raw:y<0?FACE_AWAY:FACE_YOU,left:false};return null}
function applyFacing(d){if(!d)return false;const left=d.raw===FACE_SIDE?!!d.left:false,changed=d.raw!==S.facingRaw||left!==S.left;S.facingRaw=d.raw;S.left=left;return changed}
function applyMovementFacing(){return applyFacing(movementDirection())}
function aimAttackPoint(p){S.pointer=p;const target=directionFromPointer(p.x,p.y,S.world.x,S.world.y),changed=applyFacing(target);if(!S.shooting||!changed)return;const q=sequence(2,S.facingRaw,S.seq?.set??0);if(q?.actionRaw===2&&q!==S.seq){const i=S.index;S.seq=q;S.index=i%Math.max(1,q.frames.length);renderFrameState()}}
function attack(e){if(e.button!==undefined&&e.button!==0)return;const now=performance.now(),p=rememberPointer(e);applyFacing(directionFromPointer(p.x,p.y,S.world.x,S.world.y));const q=sequence(2,S.facingRaw,S.seq?.set??0);if(!q||q.actionRaw!==2)return;S.shooting=true;S.attackStart=now;S.attackUntil=Infinity;S.nextShotAt=now;S.facingRaw=q.directionRaw;S.left=q.directionRaw===FACE_SIDE?(p.x<S.world.x):false;S.seq=q;S.index=0;S.last=now;renderFrameState();if(e.pointerId!==undefined)canvas.setPointerCapture?.(e.pointerId)}
function releaseAttack(e){if(!S.shooting)return;const now=performance.now(),period=attackPeriod(S.seq),elapsed=Math.max(0,now-S.attackStart);S.shooting=false;S.attackUntil=S.attackStart+(Math.floor(elapsed/period)+1)*period;if(e?.pointerId!==undefined&&canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId)}
function advance(){if(!S.seq?.frames.length)return;let n=(S.index+1)%S.seq.frames.length;if(S.seq.frames.some(x=>x.spriteAvailable)){let guard=0;while(!S.seq.frames[n].spriteAvailable&&guard++<S.seq.frames.length)n=(n+1)%S.seq.frames.length}S.index=n}
function updateMovement(dt){let x=0,y=0;if(S.keys.has('ArrowLeft')||S.keys.has('KeyA'))x--;if(S.keys.has('ArrowRight')||S.keys.has('KeyD'))x++;if(S.keys.has('ArrowUp')||S.keys.has('KeyW'))y--;if(S.keys.has('ArrowDown')||S.keys.has('KeyS'))y++;if(!x&&!y)return;if(x&&y){x*=Math.SQRT1_2;y*=Math.SQRT1_2}const speed=6,a=S.playArea,b=realmAtlas.bounds||{},minX=(a?.x0??b.minX??-Infinity)+1,maxX=(a?.x1??b.maxX??Infinity)-1,minY=(a?.y0??b.minY??-Infinity)+1,maxY=(a?.y1??b.maxY??Infinity)-1;S.player.x=Math.max(minX,Math.min(maxX,S.player.x+x*speed*dt));S.player.y=Math.max(minY,Math.min(maxY,S.player.y+y*speed*dt));S.mapDirty=true;syncRenderScale()}
function setKey(e,down){if(!active||host.closest('[hidden]'))return;if(/^(INPUT|SELECT|TEXTAREA)$/.test(root.activeElement?.tagName||''))return;const moving=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'];if(!moving.includes(e.code))return;if(down&&e.repeat){e.preventDefault();return}if(down)S.keys.add(e.code);else S.keys.delete(e.code);if(!S.attackUntil){applyMovementFacing();syncActivity(performance.now(),true)}e.preventDefault()}
function zoomWheel(e){e.preventDefault();const factor=Math.exp(-e.deltaY*.0015);S.camera.scale=Math.max(minRealmScale(),Math.min(64,S.camera.scale*factor));syncRenderScale();S.mapDirty=true;renderZoom()}

/*
 * The stage is as big as the room it is given.
 *
 * All three canvases were 640 by 420 whatever the window was, stretched to
 * whatever width the middle column happened to be - so half a wide screen
 * went to blur, and a narrow one drew more pixels than it could show. The
 * world's geometry is all derived from worldBg's size at the moment it is
 * asked, so resizing the three and telling it to redraw is enough.
 *
 * Resizing a canvas resets its 2D context, which is why the smoothing flag is
 * set again here rather than once at the start.
 */
/*
 * How close the camera sits by default: near enough that a character is worth
 * looking at. Written as a share of the stage rather than a number of pixels
 * per tile, so a big window shows the same amount of ground as a small one
 * and draws it larger - which is the point of giving it the room.
 */
const STAGE_TILES=14;
function defaultScale(){
  return Math.max(minRealmScale(),Math.min(64,(worldBg.height||420)/STAGE_TILES));
}

function fitStage(){
  const box=$('stageBody');
  if(!box)return;
  const r=box.getBoundingClientRect();
  const wide=Math.max(200,Math.round(r.width)),tall=Math.max(160,Math.round(r.height));
  if(worldBg.width===wide&&worldBg.height===tall)return;
  /* However much ground was on screen, the same amount stays on screen. */
  const showing=worldBg.height&&S.camera.scale?worldBg.height/S.camera.scale:0;
  for(const one of [worldBg,canvas,fxCanvas]){one.width=wide;one.height=tall}
  bg.imageSmoothingEnabled=false;fx.imageSmoothingEnabled=false;
  if(showing)S.camera.scale=tall/showing;
  S.camera.scale=Math.max(minRealmScale(),Math.min(64,S.camera.scale));
  S.pointer.x=wide/2;S.pointer.y=tall/2;
  S.mapDirty=true;
  syncRenderScale();
  renderZoom();
  drawRealmWorld(performance.now(),true);
}
function renderZoom(){
  const out=$('zoomValue');
  if(out)out.textContent=`${RealmI18n.number(S.camera.scale/realmAtlas.px,{maximumFractionDigits:2})}×`;
}
if(typeof ResizeObserver==='function'){
  new ResizeObserver(()=>fitStage()).observe($('stageBody'));
}else window.addEventListener('resize',fitStage);

renderClassPicker();renderFamilies();loadBeachArea();select(skins.find(s=>s.frames.some(f=>f.spriteAvailable))||skins[0]);renderDyePanel();renderSandboxBar();root.querySelectorAll('[data-world-mode]').forEach(button=>button.onclick=()=>setWorldMode(button.dataset.worldMode));setWorldMode(S.worldMode,true);fitStage();
const attackSpeed=$('attackSpeed'),attackSpeedValue=$('attackSpeedValue');function renderAttackSpeed(){const period=attackPeriod();attackSpeed.value=String(S.attackSpeed);attackSpeedValue.textContent=`${RealmI18n.number(S.attackSpeed,{minimumFractionDigits:2,maximumFractionDigits:2})}× · ${RealmI18n.number(1000/period,{minimumFractionDigits:2,maximumFractionDigits:2})}/s`}renderAttackSpeed();attackSpeed.oninput=()=>{S.attackSpeed=Math.max(.25,Math.min(4,Number(attackSpeed.value)||1));storageSet('skinViewerAttackSpeed',String(S.attackSpeed));const now=performance.now();if(S.shooting){S.attackStart=now;S.nextShotAt=now}renderAttackSpeed()};
$('search').oninput=()=>{renderCatalogueUI()};$('dyeSearch').oninput=renderDyePanel;$('clearDye').onclick=()=>{S.dyes[S.dyeTarget]=null;renderDyePanel();scheduleSelectedIndexPanel();};$('resetWorld').onclick=()=>{resetWorldMode();renderZoom()};
canvas.addEventListener('pointermove',e=>{const p=point(e);if(S.shooting)aimAttackPoint(p);else S.pointer=p});canvas.addEventListener('pointerdown',e=>{canvas.focus();attack(e)});canvas.addEventListener('pointerup',releaseAttack);canvas.addEventListener('pointercancel',releaseAttack);canvas.addEventListener('wheel',zoomWheel,{passive:false});canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>setKey(e,true));window.addEventListener('keyup',e=>setKey(e,false));window.addEventListener('blur',()=>{S.keys.clear();S.shooting=false;S.attackUntil=0;applyMovementFacing();syncActivity(performance.now(),true)});
function referenceBodyWidth(){const f=current();if(!f)return 8;const set=S.seq?.set??0,dir=S.seq?.directionRaw??S.facingRaw,pool=S.skin?.sequences||[];for(const actionRaw of[0,1]){const q=pool.find(q=>q.set===set&&q.actionRaw===actionRaw&&q.directionRaw===dir&&q.frames.some(f=>f.spriteAvailable));const widths=q?.frames.filter(f=>f.spriteAvailable&&f.rect?.w).map(f=>f.rect.w)||[];if(widths.length)return Math.min(...widths)}return Math.min(f.rect.w,f.rect.h)||f.rect.w||8}
function anchoredWorld(){const f=current();if(!f||S.seq?.actionRaw!==2)return S.world;const bodyWidth=referenceBodyWidth();if(f.rect.w<=bodyWidth)return S.world;return{...S.world,x:attackAnchorX(S.world.x,f.rect.w,bodyWidth,S.world.scale,S.left)}}
/*
 * The catalogue shares one texture between thousands of tiny canvases. Let
 * their first draws drain in bounded batches before mount() declares the page
 * ready; otherwise one image load fires thousands of draw handlers at once
 * exactly while the navigation cover is opening.
 */
await Promise.all(
  [...atlasImages.values()]
    .map(image=>atlasWork.get(image)?.ready)
    .filter(Boolean)
);

let previous=performance.now(),animationFrame=0;
function tick(now){
  animationFrame=0;
  if(!active)return;
  const dt=Math.min(.05,(now-previous)/1000);
  previous=now;
  if(!host.closest('[hidden]')){
    updateMovement(dt);
    updateProjectiles(dt,now);
    drawRealmWorld(now);
    if(!S.shooting&&S.attackUntil&&now>=S.attackUntil){
      S.attackUntil=0;
      applyMovementFacing();
      syncActivity(now,true);
    }
    const attacking=S.seq?.actionRaw===2&&(S.shooting||(S.attackUntil&&now<S.attackUntil)),f=current();
    if(attacking)attackFrame(now);
    else if(f&&now-S.last>=FRAME_MS){advance();S.last=now}
    renderer.draw(current(),S.dyes,now,S.left,anchoredWorld());
    renderProjectiles();
  }
  animationFrame=requestAnimationFrame(tick);
}
function startLoop(){
  if(active&&!animationFrame){
    previous=performance.now();
    animationFrame=requestAnimationFrame(tick);
  }
}
startLoop();

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
  setActive(value){
    const next=Boolean(value);
    if(next===active){
      if(active)startLoop();
      return active;
    }
    active=next;
    if(!active){
      S.keys.clear();
      S.shooting=false;
      S.attackUntil=0;
      if(animationFrame){cancelAnimationFrame(animationFrame);animationFrame=0}
    }else startLoop();
    return active;
  },
  root,
  host
};
window.dispatchEvent(new CustomEvent('skinviewerready',{detail:{api}}));
return api;
}

if(typeof window!=='undefined'){
  window.SkinViewer={mount,unmount,select:selectTarget,getState};
  const autoHost=document.getElementById('skinViewerRoot');
  if(autoHost&&!autoHost.closest('[hidden]'))mount(autoHost,{integrated:autoHost.dataset.integrated==='true'}).catch(error=>console.error('Skin Viewer failed to mount',error));
}
