'use strict';

/*
 * Beach-only prototype.  It deliberately does not stitch captured viewports.
 * The annotated realm topology supplies the shape (letter `t` = Beach); the
 * decrypted capture supplies the actual sand ground id and client sprite.
 *
 *   node tools/render-beach-prototype.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'client-data', 'capture', 'beach-prototype.html');
const capture = JSON.parse(fs.readFileSync(path.join(root, 'client-data', 'capture', 'realm-map.json'), 'utf8'));

class Flat {
  constructor(buffer) { this.b = buffer; }
  u16(at) { return this.b.readUInt16LE(at); } i32(at) { return this.b.readInt32LE(at); }
  u32(at) { return this.b.readUInt32LE(at); } f32(at) { return this.b.readFloatLE(at); }
  root() { return this.u32(0); }
  fields(table) { const vt = table - this.i32(table), size = this.u16(vt), out = []; for (let n = 0; n * 2 + 4 < size; n++) { const off = this.u16(vt + 4 + n * 2); out.push(off ? table + off : 0); } return out; }
  string(at) { const point = at + this.u32(at), size = this.u32(point); return this.b.toString('utf8', point + 4, point + 4 + size); }
  vector(at) { const point = at + this.u32(at); return { at: point + 4, length: this.u32(point) }; }
  indirect(at) { return at + this.u32(at); }
}

// Resolve the exact captured sand definition against the installed client's atlas.
const atlas = new Flat(fs.readFileSync(path.join(root, 'client-data', 'spritesheet.bin')));
const atlases = new Map();
const files = atlas.vector(atlas.fields(atlas.root())[0]);
for (let n = 0; n < files.length; n++) {
  const fields = atlas.fields(atlas.indirect(files.at + n * 4)); const sprites = atlas.vector(fields[2]); const entries = [];
  for (let i = 0; i < sprites.length; i++) {
    const fields = atlas.fields(atlas.indirect(sprites.at + i * 4));
    const sheetId = fields[7] ? atlas.i32(fields[7]) : 0;
    const sheet = sheetId === 1 ? 'groundTiles' : sheetId === 4 ? 'mapObjects' : null;
    entries.push(!fields[0] || !sheet ? null : { x: Math.round(atlas.f32(fields[0])), y: Math.round(atlas.f32(fields[0] + 4)), w: Math.round(atlas.f32(fields[0] + 8)), h: Math.round(atlas.f32(fields[0] + 12)), sheet });
  }
  atlases.set(atlas.string(fields[0]), entries);
}
const ground = new Map();
for (const file of fs.readdirSync(path.join(root, 'client-data')).filter(name => /^GroundTypes\./.test(name))) {
  const xml = fs.readFileSync(path.join(root, 'client-data', file), 'utf8');
  for (const match of xml.matchAll(/<Ground\b([^>]*)>([\s\S]*?)<\/Ground>/g)) {
    const type = /\btype="([^"]+)"/.exec(match[1]), id = /\bid="([^"]+)"/.exec(match[1]);
    if (!type || !id || id[1] !== 'Desert Rough Sand') continue;
    const variants = [];
    for (const texture of match[2].matchAll(/<Texture>([\s\S]*?)<\/Texture>/g)) {
      const file = /<File>([^<]+)<\/File>/.exec(texture[1]), index = /<Index>([^<]+)<\/Index>/.exec(texture[1]);
      const sprite = file && index && atlases.get(file[1])?.[Number(index[1])]; if (sprite) variants.push(sprite);
    }
    ground.set(id[1], variants);
  }
}
if (!ground.get('Desert Rough Sand')?.length) throw new Error('The installed client did not supply the captured sand ground sprite');

// Learn only static props which the capture placed on this exact sand type.
// The schematic calls the target region Beach but has no server-side type id;
// this is the most specific captured sand/prop evidence available.
const DESERT_SAND = 0x6583;
const tileAt = new Map(capture.tiles.map(tile => [tile.x + ',' + tile.y, tile.type]));
const observedTypes = new Set((capture.observedObjects || []).map(object => object.type));
const propDefs = new Map();
for (const file of fs.readdirSync(path.join(root, 'client-data')).filter(name => /^Objects\./.test(name))) {
  const xml = fs.readFileSync(path.join(root, 'client-data', file), 'utf8');
  for (const match of xml.matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const type = /\btype="([^"]+)"/.exec(match[1]); const id = /\bid="([^"]+)"/.exec(match[1]);
    if (!type || !id || !/^Desert /.test(id[1]) || !/<Static\s*\/>/.test(match[2])) continue;
    const numericType = Number(type[1]) & 0xffff;
    if (!observedTypes.has(numericType)) continue;
    const variants = [];
    for (const texture of match[2].matchAll(/<Texture>([\s\S]*?)<\/Texture>/g)) {
      const file = /<File>([^<]+)<\/File>/.exec(texture[1]), index = /<Index>([^<]+)<\/Index>/.exec(texture[1]);
      const sprite = file && index && atlases.get(file[1])?.[Number(index[1])]; if (sprite) variants.push(sprite);
    }
    if (variants.length) propDefs.set(numericType, { name: id[1], variants });
  }
}
const propCounts = new Map(); const seenProps = new Set();
for (const object of capture.observedObjects || []) {
  const definition = propDefs.get(object.type); const key = object.type + ':' + object.x + ':' + object.y;
  if (!definition || seenProps.has(key) || tileAt.get(Math.floor(object.x) + ',' + Math.floor(object.y)) !== DESERT_SAND) continue;
  seenProps.add(key); propCounts.set(object.type, (propCounts.get(object.type) || 0) + 1);
}
const propPalette = [...propCounts].map(([type, count]) => ({ type, count, weight: count, ...propDefs.get(type) }));
if (!propPalette.length) throw new Error('No observed desert props were found on Desert Rough Sand');

const rows = fs.readFileSync(path.join(root, 'data', 'Realm', 'realm-terrain.txt'), 'utf8').split(/\r?\n/).filter(line => /^[.a-zA-Z~=]{248}$/.test(line));
if (rows.length !== 258) throw new Error('Expected the 248×258 terrain topology');
let minX = 248, maxX = 0, minY = 258, maxY = 0;
for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === 't') { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const world = { width: 2048, height: 2048 };
const crop = {
  minX: Math.floor(minX * world.width / 248), maxX: Math.ceil((maxX + 1) * world.width / 248),
  minY: Math.floor(minY * world.height / 258), maxY: Math.ceil((maxY + 1) * world.height / 258)
};
const relativeTexture = sheet => path.relative(path.dirname(output), path.join(root, 'client-data', 'textures', sheet + '.png')).replace(/\\/g, '/');
const html = `<!doctype html>
<meta charset="utf-8"><title>Beach prototype — native tiles</title>
<style>
body{margin:20px;background:#10131a;color:#e8edf5;font:14px system-ui,sans-serif}p{max-width:900px}small{color:#aeb8c8}.viewport{width:min(1180px,calc(100vw - 40px));height:min(760px,calc(100vh - 190px));min-height:420px;overflow:hidden;background:#0d1721;cursor:grab;touch-action:none}.viewport.dragging{cursor:grabbing}canvas{display:block;image-rendering:pixelated;transform-origin:0 0}button{margin-right:8px;padding:5px 9px}code{color:#cfe4ff}
</style>
<h1>Plage — prototype de terrain</h1>
<p>Contour : zone <code>Beach</code> de la carte schématique. Sol : <code>Desert Rough Sand</code>, le sable réellement capturé. Les cactus, pierres et arbres secs proviennent uniquement des objets statiques observés sur ce sable.</p>
<p><button id="native">Échelle native (1×)</button><button id="fit">Voir toute la plage</button> Glisser pour déplacer · molette pour zoomer</p>
<div class="viewport" id="viewport"><canvas id="map" aria-label="Prototype de la zone plage"></canvas></div>
<small>La tuile fait exactement 8×8 pixels à l’échelle 1×. Les variantes de sable sont distribuées par zones continues et les objets sont semés à la densité mesurée dans la capture — sans quadrillage de décoration.</small>
<script>
const topology=${JSON.stringify(rows)}, crop=${JSON.stringify(crop)}, world=${JSON.stringify(world)}, sprites=${JSON.stringify(Object.fromEntries(ground))}, propPalette=${JSON.stringify(propPalette)};
const tile=8, cols=248, mapRows=258, width=crop.maxX-crop.minX, height=crop.maxY-crop.minY;
const canvas=document.querySelector('#map'), ctx=canvas.getContext('2d'), view=document.querySelector('#viewport'); canvas.width=width*tile;canvas.height=height*tile;ctx.imageSmoothingEnabled=false;
const images={}, sources={groundTiles:${JSON.stringify(relativeTexture('groundTiles'))},mapObjects:${JSON.stringify(relativeTexture('mapObjects'))}};let left=Object.keys(sources).length;for(const [name,url]of Object.entries(sources)){const image=new Image();image.onload=()=>{images[name]=image;if(!--left)draw()};image.src=url}
function hash(x,y){let v=Math.imul(x,0x45d9f3b)^Math.imul(y,0x119de1f3);v^=v>>>16;return v>>>0}
function fade(v){return v*v*(3-2*v)}
function noise(x,y){const lx=Math.floor(x),ty=Math.floor(y),fx=fade(x-lx),fy=fade(y-ty),a=hash(lx,ty)/4294967296,b=hash(lx+1,ty)/4294967296,c=hash(lx,ty+1)/4294967296,d=hash(lx+1,ty+1)/4294967296;return a*(1-fx)*(1-fy)+b*fx*(1-fy)+c*(1-fx)*fy+d*fx*fy}
function coarse(x,y){return [Math.min(cols-1,Math.floor(x*cols/world.width)),Math.min(mapRows-1,Math.floor(y*mapRows/world.height))]}
function drawSprite(set,x,y){const v=noise(x/11,y/11)*.72+noise(x/3.7,y/3.7)*.28,s=set[Math.min(set.length-1,Math.floor(v*set.length))];ctx.drawImage(images[s.sheet],s.x,s.y,s.w,s.h,x*tile,y*tile,tile,tile)}
function pickProp(x,y){let value=(hash(x+9187,y-313)&0xffff)/65536,total=propPalette.reduce((sum,p)=>sum+p.weight,0);for(const p of propPalette){value-=p.weight/total;if(value<=0)return p}return propPalette[propPalette.length-1]}
function scatterProps(){const placed=[];for(let gy=0;gy<height;gy+=5)for(let gx=0;gx<width;gx+=5){const h=hash(gx+731,gy-911);if(h%100>=76)continue;const px=gx+Math.floor(h/101)%5,py=gy+Math.floor(h/509)%5,[cx,cy]=coarse(px+crop.minX,py+crop.minY);if(topology[cy][cx]!=='t')continue;placed.push({x:px,y:py,prop:pickProp(px,py)})}return placed.sort((a,b)=>a.y-b.y||a.x-b.x)}
function draw(){for(let py=0;py<height;py++)for(let px=0;px<width;px++){const gx=px+crop.minX,gy=py+crop.minY,[cx,cy]=coarse(gx,gy);if(topology[cy][cx]!=='t')continue;drawSprite(sprites['Desert Rough Sand'],px,py)}for(const placed of scatterProps()){const set=placed.prop.variants,s=set[hash(placed.x+22,placed.y-71)%set.length],x=placed.x*tile+(tile-s.w)/2,y=placed.y*tile+tile-s.h;ctx.drawImage(images[s.sheet],s.x,s.y,s.w,s.h,Math.round(x),Math.round(y),s.w,s.h)}}
let zoom=1,panX=0,panY=0;function apply(){canvas.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')'}
function native(){zoom=1;panX=Math.round(view.clientWidth/2-width*tile/2);panY=Math.round(view.clientHeight/2-height*tile/2);apply()}
function fit(){zoom=Math.min(view.clientWidth/(width*tile),view.clientHeight/(height*tile))*0.94;panX=(view.clientWidth-width*tile*zoom)/2;panY=(view.clientHeight-height*tile*zoom)/2;apply()}
document.querySelector('#native').onclick=native;document.querySelector('#fit').onclick=fit;view.addEventListener('wheel',e=>{e.preventDefault();const before=zoom;zoom=Math.max(.08,Math.min(3,zoom*(e.deltaY<0?1.15:1/1.15)));const r=view.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;panX=x-(x-panX)*zoom/before;panY=y-(y-panY)*zoom/before;apply()},{passive:false});
let drag;view.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,px:panX,py:panY};view.setPointerCapture(e.pointerId);view.classList.add('dragging')});view.addEventListener('pointermove',e=>{if(!drag)return;panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;apply()});view.addEventListener('pointerup',()=>{drag=null;view.classList.remove('dragging')});native();
</script>`;
fs.writeFileSync(output, html, 'utf8');
console.log(path.relative(root, output) + `  (Beach mask ${minX}…${maxX}, ${minY}…${maxY}; native crop ${crop.maxX - crop.minX}×${crop.maxY - crop.minY} tiles)`);
