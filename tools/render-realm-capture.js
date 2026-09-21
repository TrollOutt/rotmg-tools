'use strict';

/*
 * Render a decoded Realm capture at the game's own 8px-per-tile scale.
 *
 *   node tools/render-realm-capture.js client-data/capture/realm-map.json
 *
 * Ground ids and static-object positions are copied from decrypted UPDATE
 * packets.  Only RandomTexture frame selection remains cosmetic/client-side;
 * the server transmits an object/ground type, not a particular random frame.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'client-data', 'capture', 'realm-map.json');
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(input), 'realm-capture.html');
const map = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(map.tiles) || !map.bounds) throw new Error('Expected a decoded realm-map.json with tiles and bounds');

class Flat {
  constructor(buffer) { this.b = buffer; }
  u16(at) { return this.b.readUInt16LE(at); }
  i32(at) { return this.b.readInt32LE(at); }
  u32(at) { return this.b.readUInt32LE(at); }
  f32(at) { return this.b.readFloatLE(at); }
  root() { return this.u32(0); }
  fields(table) {
    const vtable = table - this.i32(table); const size = this.u16(vtable); const fields = [];
    for (let slot = 0; slot * 2 + 4 < size; slot++) { const offset = this.u16(vtable + 4 + slot * 2); fields.push(offset ? table + offset : 0); }
    return fields;
  }
  string(at) { const point = at + this.u32(at); const size = this.u32(point); return this.b.toString('utf8', point + 4, point + 4 + size); }
  vector(at) { const point = at + this.u32(at); return { at: point + 4, length: this.u32(point) }; }
  indirect(at) { return at + this.u32(at); }
}

const sheetOf = { 1: 'groundTiles', 4: 'mapObjects' };
const registry = new Flat(fs.readFileSync(path.join(root, 'client-data', 'spritesheet.bin')));
const atlases = new Map();
{
  const list = registry.vector(registry.fields(registry.root())[0]);
  for (let index = 0; index < list.length; index++) {
    const fields = registry.fields(registry.indirect(list.at + index * 4));
    const sprites = registry.vector(fields[2]); const entries = [];
    for (let spriteIndex = 0; spriteIndex < sprites.length; spriteIndex++) {
      const sprite = registry.fields(registry.indirect(sprites.at + spriteIndex * 4));
      if (!sprite[0] || !sprite[7]) { entries.push(null); continue; }
      entries.push({ x: Math.round(registry.f32(sprite[0])), y: Math.round(registry.f32(sprite[0] + 4)), w: Math.round(registry.f32(sprite[0] + 8)), h: Math.round(registry.f32(sprite[0] + 12)), sheet: sheetOf[registry.i32(sprite[7])] || null });
    }
    atlases.set(registry.string(fields[0]), entries);
  }
}

function number(text) { return Number(text) & 0xffff; }
function textures(body) {
  const result = [];
  for (const match of body.matchAll(/<Texture>([\s\S]*?)<\/Texture>/g)) {
    const file = /<File>([^<]+)<\/File>/.exec(match[1]); const index = /<Index>([^<]+)<\/Index>/.exec(match[1]);
    const sprite = file && index && atlases.get(file[1])?.[Number(index[1])];
    if (sprite?.sheet && sprite.w && sprite.h) result.push(sprite);
  }
  return result;
}

const wantedGround = new Set(map.tiles.map(tile => tile.type));
const ground = new Map();
const objectDefs = new Map();
for (const filename of fs.readdirSync(path.join(root, 'client-data')).filter(name => /^(GroundTypes|Objects)\./.test(name))) {
  const xml = fs.readFileSync(path.join(root, 'client-data', filename), 'utf8');
  for (const match of xml.matchAll(/<Ground\b([^>]*)>([\s\S]*?)<\/Ground>/g)) {
    const type = /\btype="([^"]+)"/.exec(match[1]); if (!type || !wantedGround.has(number(type[1]))) continue;
    const variants = textures(match[2]); if (variants.length) ground.set(number(type[1]), variants);
  }
  for (const match of xml.matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const type = /\btype="([^"]+)"/.exec(match[1]); if (!type) continue;
    const body = match[2];
    // Static is supplied by the client data.  This deliberately excludes
    // monsters and players from a terrain/prop reconstruction.
    if (!/<Static\s*\/>/.test(body)) continue;
    const variants = textures(body); if (!variants.length) continue;
    const id = /\bid="([^"]+)"/.exec(match[1]);
    objectDefs.set(number(type[1]), { id: id ? id[1] : 'unnamed', variants });
  }
}
const missingGround = [...wantedGround].filter(type => !ground.has(type));
if (missingGround.length) throw new Error('No sprite found for ground ids: ' + missingGround.map(type => '0x' + type.toString(16)).join(', '));

const allObserved = map.observedObjects || map.objects || [];
const seenProps = new Set(); const props = [];
for (const object of allObserved) {
  const def = objectDefs.get(object.type); if (!def) continue;
  // A prop can re-enter the viewport after teleporting.  It is one placement,
  // not several objects, so suppress only exact type/coordinate duplicates.
  const key = object.type + ':' + object.x + ':' + object.y;
  if (seenProps.has(key)) continue;
  seenProps.add(key); props.push({ ...object, name: def.id, variants: def.variants });
}
props.sort((a, b) => a.y - b.y || a.x - b.x || a.type - b.type);

const width = map.bounds.maxX - map.bounds.minX + 1;
const height = map.bounds.maxY - map.bounds.minY + 1;
const tileSize = 8;
const relative = sheet => path.relative(path.dirname(output), path.join(root, 'client-data', 'textures', sheet + '.png')).replace(/\\/g, '/');
const sourceCounts = new Map(props.map(prop => [prop.name, 0])); for (const prop of props) sourceCounts.set(prop.name, sourceCounts.get(prop.name) + 1);
const html = `<!doctype html>
<meta charset="utf-8"><title>Realm capture — exact tiles and props</title>
<style>body{margin:24px;background:#10131a;color:#e8edf5;font:14px system-ui,sans-serif}canvas{display:block;margin-top:14px;max-width:100%;height:auto;image-rendering:pixelated;border:1px solid #465264;background:#0d1721}small{color:#aeb8c8}details{margin-top:12px}summary{cursor:pointer}</style>
<h1>Realm capture — exact ground and static props</h1>
<p>${map.tileCount.toLocaleString('en-US')} decrypted ground placements; ${props.length.toLocaleString('en-US')} distinct static prop placements.</p>
<p>Window: x=${map.bounds.minX}…${map.bounds.maxX}, y=${map.bounds.minY}…${map.bounds.maxY}; native resolution: ${width * tileSize}×${height * tileSize}px (${width}×${height} game tiles).</p>
<small>The floor ids and prop coordinates/types come from the server’s decrypted <code>UPDATE</code> packets. RandomTexture is selected deterministically for preview only, because that animation/cosmetic frame is not sent by the server.</small>
<canvas id="map" width="${width * tileSize}" height="${height * tileSize}"></canvas>
<details><summary>Static prop types (${sourceCounts.size})</summary><pre>${[...sourceCounts].sort((a,b)=>b[1]-a[1]).map(([name,count]) => count + ' × ' + name).join('\n')}</pre></details>
<script>
const bounds=${JSON.stringify(map.bounds)}, tiles=${JSON.stringify(map.tiles)}, ground=${JSON.stringify(Object.fromEntries(ground))}, props=${JSON.stringify(props)};
const sources={groundTiles:${JSON.stringify(relative('groundTiles'))},mapObjects:${JSON.stringify(relative('mapObjects'))}};
const images={};let waiting=Object.keys(sources).length;
for(const [sheet,url] of Object.entries(sources)){const image=new Image();image.onload=()=>{images[sheet]=image;if(!--waiting)draw()};image.onerror=()=>{throw Error('Cannot load '+url)};image.src=url}
function pick(x,y,n){let v=Math.imul(Math.floor(x*2),0x45d9f3b)^Math.imul(Math.floor(y*2),0x119de1f3);v^=v>>>16;return (v>>>0)%n}
function draw(){const ctx=document.querySelector('#map').getContext('2d');ctx.imageSmoothingEnabled=false;
  for(const tile of tiles){const set=ground[tile.type],s=set[pick(tile.x,tile.y,set.length)];ctx.drawImage(images[s.sheet],s.x,s.y,s.w,s.h,(tile.x-bounds.minX)*8,(tile.y-bounds.minY)*8,8,8)}
  for(const prop of props){const set=prop.variants,s=set[pick(prop.x,prop.y,set.length)],x=(prop.x-bounds.minX)*8-s.w/2,y=(prop.y-bounds.minY)*8-s.h+4;ctx.drawImage(images[s.sheet],s.x,s.y,s.w,s.h,Math.round(x),Math.round(y),s.w,s.h)}
}
</script>`;
fs.writeFileSync(output, html, 'utf8');
console.log(path.relative(root, output) + '  (' + width + '×' + height + ' tiles, ' + props.length + ' static props across ' + sourceCounts.size + ' types)');
