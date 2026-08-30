'use strict';
/*
 * Pull the game's own texture sheets out of an installed client.
 *
 *   node tools/extract-client-textures.js [name ...]
 *
 * Everything the realm is drawn with is in there — the ground, the objects,
 * the characters — as plain uncompressed textures. Getting at them needs a
 * reader for Unity's serialized asset format, which is what most of this file
 * is: a header, a list of types, a table of a hundred and eight thousand
 * objects, and then the two hundred and thirty-seven of them that are
 * textures.
 *
 * The sheets that matter, in an Exalt client of August 2026:
 *
 *   groundTiles      2048 x 2048    every tile the ground is made of
 *   mapObjects       4096 x 8192    trees, rocks, walls, everything on it
 *   characters       4096 x 8192    every creature
 *   characters_masks 2048 x 2048    their masks
 *
 * All four are RGBA32, which is to say raw pixels — no block compression to
 * undo. They are written out as PNG, bottom-up flipped to the way the rest of
 * the world reads an image.
 *
 * What this does NOT give you is which tile is which: that mapping lives in
 * the "spritesheet" text asset, a FlatBuffers blob, and is a separate job.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'client-data', 'textures');

const DEFAULT_CLIENTS = [
  path.join(process.env.LOCALAPPDATA || '', 'RealmOfTheMadGod', 'Production'),
  'C:/Program Files (x86)/Steam/steamapps/common/Realm of the Mad God Exalt'
];
const WANTED = ['groundTiles', 'mapObjects', 'characters', 'characters_masks'];

/* ---------------------------------------------------------------- *
 * Enough of Unity's serialized format to find a texture             *
 * ---------------------------------------------------------------- */
class Reader {
  constructor(buffer, big) { this.b = buffer; this.at = 0; this.big = Boolean(big); }
  u8() { return this.b[this.at++]; }
  bool() { return this.u8() !== 0; }
  i16() { const v = this.big ? this.b.readInt16BE(this.at) : this.b.readInt16LE(this.at); this.at += 2; return v; }
  i32() { const v = this.big ? this.b.readInt32BE(this.at) : this.b.readInt32LE(this.at); this.at += 4; return v; }
  u32() { const v = this.big ? this.b.readUInt32BE(this.at) : this.b.readUInt32LE(this.at); this.at += 4; return v; }
  i64() { const v = this.big ? this.b.readBigInt64BE(this.at) : this.b.readBigInt64LE(this.at); this.at += 8; return Number(v); }
  bytes(n) { const v = this.b.subarray(this.at, this.at + n); this.at += n; return v; }
  cstring() { const end = this.b.indexOf(0, this.at); const v = this.b.toString('latin1', this.at, end); this.at = end + 1; return v; }
  string() { const n = this.i32(); const v = this.b.toString('utf8', this.at, this.at + n); this.at += n; this.align(); return v; }
  align(to = 4) { this.at = Math.ceil(this.at / to) * to; }
}

/*
 * The object table, which is all this needs. The type tree is switched off in
 * a shipped build, so the types are read past rather than understood — an
 * object's class is enough to know a texture when one goes by.
 */
function openAssets(file) {
  const buffer = fs.readFileSync(file);
  const head = new Reader(buffer, true);           // the header is big-endian
  let metadataSize = head.u32();
  let fileSize = head.u32();
  const version = head.u32();
  let dataOffset = head.u32();
  let endianness = 0;
  if (version >= 9) { endianness = head.u8(); head.bytes(3); }
  if (version >= 22) { metadataSize = head.u32(); fileSize = head.i64(); dataOffset = head.i64(); head.i64(); }

  const r = new Reader(buffer, endianness === 1);
  r.at = head.at;
  const unityVersion = r.cstring();
  r.i32();                                         // target platform
  const hasTypeTree = version >= 13 ? r.bool() : false;
  if (hasTypeTree) throw new Error('this client ships a type tree; this reader expects a stripped build');

  const typeCount = r.i32();
  const classes = [];
  for (let i = 0; i < typeCount; i++) {
    const classID = r.i32();
    if (version >= 16) r.bool();
    if (version >= 17) r.i16();
    if (version >= 13) {
      if ((version < 16 && classID < 0) || (version >= 16 && classID === 114)) r.bytes(16);
      r.bytes(16);
    }
    classes.push(classID);
  }

  const objectCount = r.i32();
  const objects = [];
  for (let i = 0; i < objectCount; i++) {
    r.align();
    r.i64();                                       // path id
    const byteStart = version >= 22 ? r.i64() : r.u32();
    const byteSize = r.u32();
    const typeIndex = r.i32();
    objects.push({ byteStart: dataOffset + byteStart, byteSize, classID: classes[typeIndex] });
  }
  return { buffer, unityVersion, endianness, objects };
}

/*
 * A Texture2D, read by where its fields sit rather than by name — there is no
 * type tree to ask. After the name come the fallback format, the width, the
 * height and the size of the image; the pixels are at the end of the object,
 * with m_StreamData's sixteen bytes after them.
 */
const RGBA32 = 4;
function readTexture(file, object) {
  const r = new Reader(file.buffer, file.endianness === 1);
  r.at = object.byteStart;
  const name = r.string();
  const base = r.at;
  const at = offset => file.buffer.readInt32LE(base + offset);
  const texture = {
    name,
    width: at(4),
    height: at(8),
    imageSize: at(12),
    format: at(20),
    mipCount: at(24)
  };
  texture.dataStart = object.byteStart + object.byteSize - texture.imageSize - 16;
  const sane = texture.width > 0 && texture.height > 0
    && texture.imageSize === texture.width * texture.height * 4
    && texture.dataStart > object.byteStart;
  return sane ? texture : null;
}

/* ---------------------------------------------------------------- *
 * PNG out                                                           *
 * ---------------------------------------------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(kind, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function writePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------------------------------------------------------- *
 * Do it                                                             *
 * ---------------------------------------------------------------- */
function findClient() {
  for (const base of DEFAULT_CLIENTS) {
    const assets = path.join(base, 'RotMG Exalt_Data', 'resources.assets');
    if (fs.existsSync(assets)) return assets;
  }
  return null;
}

const assets = findClient();
if (!assets) {
  console.error('\n  No installed client found. Looked in:');
  for (const base of DEFAULT_CLIENTS) console.error('    ' + base);
  console.error('');
  process.exit(1);
}

const wanted = process.argv.slice(2);
const names = new Set(wanted.length ? wanted : WANTED);

console.log('\n  reading ' + path.basename(assets) + ' ('
  + (fs.statSync(assets).size / 1048576).toFixed(0) + ' MB)');
const file = openAssets(assets);
console.log('  unity ' + file.unityVersion + ', ' + file.objects.length.toLocaleString('en-US') + ' objects');

fs.mkdirSync(OUT, { recursive: true });
let written = 0;
const missing = new Set(names);
for (const object of file.objects) {
  if (object.classID !== 28) continue;
  const texture = readTexture(file, object);
  if (!texture || !names.has(texture.name)) continue;
  missing.delete(texture.name);
  if (texture.format !== RGBA32) {
    console.log('    ' + texture.name.padEnd(20) + 'format ' + texture.format + ', not raw pixels — skipped');
    continue;
  }
  // Unity keeps a texture bottom-up; everything else reads top-down.
  const source = file.buffer.subarray(texture.dataStart, texture.dataStart + texture.imageSize);
  const flipped = Buffer.alloc(source.length);
  const stride = texture.width * 4;
  for (let y = 0; y < texture.height; y++) {
    source.copy(flipped, y * stride, (texture.height - 1 - y) * stride, (texture.height - y) * stride);
  }
  const out = path.join(OUT, texture.name + '.png');
  fs.writeFileSync(out, writePng(texture.width, texture.height, flipped));
  written++;
  console.log('    ' + texture.name.padEnd(20) + texture.width + 'x' + texture.height
    + '  ' + (fs.statSync(out).size / 1048576).toFixed(1) + ' MB  -> ' + path.relative(root, out));
}
console.log('\n  ' + written + ' written'
  + (missing.size ? ', not found: ' + [...missing].join(', ') : '') + '\n');
