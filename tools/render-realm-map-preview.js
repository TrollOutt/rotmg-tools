'use strict';
/*
 * Render an extracted ground grid using the installed client's source tiles.
 *
 *   node tools/render-realm-map-preview.js client-data/capture/realm-map.json
 *
 * The server sends the exact ground type at every coordinate. RandomTexture
 * variants are a client-side cosmetic choice, so the preview picks one stably
 * from its coordinate and never pretends that choice came from the packet.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'client-data', 'capture', 'realm-map.json');
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(input), 'realm-map-preview.html');
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
    const vtable = table - this.i32(table);
    const size = this.u16(vtable);
    const fields = [];
    for (let slot = 0; slot * 2 + 4 < size; slot++) {
      const offset = this.u16(vtable + 4 + slot * 2);
      fields.push(offset ? table + offset : 0);
    }
    return fields;
  }
  string(at) { const point = at + this.u32(at); const size = this.u32(point); return this.b.toString('utf8', point + 4, point + 4 + size); }
  vector(at) { const point = at + this.u32(at); return { at: point + 4, length: this.u32(point) }; }
  indirect(at) { return at + this.u32(at); }
}

const SHEET_OF = { 1: 'groundTiles', 4: 'mapObjects' };
const registry = new Flat(fs.readFileSync(path.join(root, 'client-data', 'spritesheet.bin')));
const atlases = new Map();
{
  const list = registry.vector(registry.fields(registry.root())[0]);
  for (let index = 0; index < list.length; index++) {
    const fields = registry.fields(registry.indirect(list.at + index * 4));
    const sprites = registry.vector(fields[2]);
    const entries = [];
    for (let spriteIndex = 0; spriteIndex < sprites.length; spriteIndex++) {
      const sprite = registry.fields(registry.indirect(sprites.at + spriteIndex * 4));
      if (!sprite[0] || !sprite[7]) { entries.push(null); continue; }
      entries.push({
        x: Math.round(registry.f32(sprite[0])), y: Math.round(registry.f32(sprite[0] + 4)),
        w: Math.round(registry.f32(sprite[0] + 8)), h: Math.round(registry.f32(sprite[0] + 12)),
        sheet: SHEET_OF[registry.i32(sprite[7])] || null
      });
    }
    atlases.set(registry.string(fields[0]), entries);
  }
}

const needed = new Set(map.tiles.map(tile => tile.type));
const ground = new Map();
for (const filename of fs.readdirSync(path.join(root, 'client-data')).filter(name => /^GroundTypes\./.test(name))) {
  const xml = fs.readFileSync(path.join(root, 'client-data', filename), 'utf8');
  for (const match of xml.matchAll(/<Ground\b([^>]*)>([\s\S]*?)<\/Ground>/g)) {
    const type = /\btype="([^"]+)"/.exec(match[1]);
    if (!type || !needed.has(Number(type[1]) & 0xffff)) continue;
    const variants = [];
    for (const texture of match[2].matchAll(/<Texture>([\s\S]*?)<\/Texture>/g)) {
      const file = /<File>([^<]+)<\/File>/.exec(texture[1]);
      const index = /<Index>([^<]+)<\/Index>/.exec(texture[1]);
      const rect = file && index && atlases.get(file[1])?.[Number(index[1])];
      if (rect?.sheet && rect.w && rect.h) variants.push(rect);
    }
    if (variants.length) ground.set(Number(type[1]) & 0xffff, variants);
  }
}

const missing = [...needed].filter(type => !ground.has(type));
if (missing.length) throw new Error('No sprite found for ground types: ' + missing.map(type => '0x' + type.toString(16)).join(', '));

const width = map.bounds.maxX - map.bounds.minX + 1;
const height = map.bounds.maxY - map.bounds.minY + 1;
const tileSize = 8;
const relativeTexture = sheet => path.relative(path.dirname(output), path.join(root, 'client-data', 'textures', sheet + '.png')).replace(/\\/g, '/');
const title = `Realm ground preview — ${map.tileCount.toLocaleString('en-US')} exact server placements`;
const html = `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>body{margin:24px;background:#10131a;color:#e8edf5;font:14px system-ui,sans-serif}canvas{display:block;margin-top:14px;image-rendering:pixelated;border:1px solid #465264;background:#0d1721}small{color:#aeb8c8}</style>
<h1>${title}</h1>
<p>Map ${map.map.width}×${map.map.height}; displayed window x=${map.bounds.minX}…${map.bounds.maxX}, y=${map.bounds.minY}…${map.bounds.maxY}.</p>
<small>Ground types and coordinates are exact packet data. Where a ground type has multiple <code>RandomTexture</code> sprites, this preview selects a stable visual variant from its coordinate; the server does not send that cosmetic sub-choice.</small>
<canvas id="map" width="${width * tileSize}" height="${height * tileSize}"></canvas>
<script>
const bounds=${JSON.stringify(map.bounds)};
const tiles=${JSON.stringify(map.tiles)};
const variants=${JSON.stringify(Object.fromEntries([...ground].map(([type, values]) => [type, values])))};
const sources={groundTiles:${JSON.stringify(relativeTexture('groundTiles'))},mapObjects:${JSON.stringify(relativeTexture('mapObjects'))}};
const images={}; let waiting=Object.keys(sources).length;
for(const [sheet,url] of Object.entries(sources)){const image=new Image();image.onload=()=>{images[sheet]=image;if(!--waiting)draw()};image.onerror=()=>{throw new Error('Cannot load '+url)};image.src=url}
function choice(x,y,n){let v=Math.imul(x,0x45d9f3b)^Math.imul(y,0x119de1f3);v^=v>>>16;return (v>>>0)%n}
function draw(){const ctx=document.querySelector('#map').getContext('2d');ctx.imageSmoothingEnabled=false;for(const tile of tiles){const set=variants[tile.type],sprite=set[choice(tile.x,tile.y,set.length)],image=images[sprite.sheet];ctx.drawImage(image,sprite.x,sprite.y,sprite.w,sprite.h,(tile.x-bounds.minX)*8,(tile.y-bounds.minY)*8,8,8)}}
</script>`;
fs.writeFileSync(output, html, 'utf8');
console.log(path.relative(root, output) + '  (' + width + '×' + height + ' tiles, ' + ground.size + ' ground types)');
