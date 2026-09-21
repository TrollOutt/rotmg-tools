'use strict';
/*
 * Decode captured server UPDATE packets into the exact ground placements the
 * client saw.
 *
 *   node tools/decode-realm-map.js --key <server-to-client-hex> [capture.pcapng]
 *   node tools/decode-realm-map.js --key <server-to-client-hex> --out client-data/capture/realm-map.json
 *   node tools/decode-realm-map.js --key <server-to-client-hex> --merge client-data/capture/realm-map.json --out client-data/capture/realm-map.json
 *
 * Start capturing before entering the realm.  RC4 has no packet boundary or
 * re-sync marker; a capture begun midway through a connection cannot be
 * rewound with the key alone.
 */
const fs = require('fs');
const path = require('path');
const capture = require('./read-capture.js');
const { decodeServerStream, mergeTiles, mergeObjects } = require('./realm-codec.js');

const root = path.join(__dirname, '..');
const CAPTURES = path.join(root, 'client-data', 'capture');
const args = process.argv.slice(2);
const valueOf = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const suppliedKey = valueOf('--key');
const out = valueOf('--out');
const mergeFile = valueOf('--merge');
const positional = args.find(arg => !arg.startsWith('--') && arg !== suppliedKey && arg !== out && arg !== mergeFile);

if (!suppliedKey || !/^[0-9a-f]{2,}$/i.test(suppliedKey) || suppliedKey.length % 2) {
  console.error('\n  Pass the server-to-client RC4 key as hexadecimal:\n    node tools/decode-realm-map.js --key <hex> [capture.pcapng]\n');
  process.exit(1);
}
const file = positional ? path.resolve(positional) : capture.newest(CAPTURES);
if (!file || !fs.existsSync(file)) {
  console.error('\n  No capture found.\n');
  process.exit(1);
}

const knownGroundTypes = new Set();
for (const name of fs.readdirSync(path.join(root, 'client-data')).filter(name => /^GroundTypes\./.test(name))) {
  const xml = fs.readFileSync(path.join(root, 'client-data', name), 'utf8');
  for (const match of xml.matchAll(/<Ground\b[^>]*type="([^"]+)"/g)) knownGroundTypes.add(Number(match[1]) & 0xffff);
}

console.log('\n  ' + path.relative(root, file));
console.log('  ' + knownGroundTypes.size.toLocaleString('en-US') + ' known ground types');

const key = Buffer.from(suppliedKey, 'hex');
const candidates = [];
for (const stream of capture.streamsOf(file, 2050)) {
  if (stream.fromPort !== 2050) continue;
  // MAPINFO is the first game-server packet. Without it, the capture began
  // mid-connection and an RC4 key cannot reconstruct the prior stream state.
  if (stream.bytes.length < 5 || stream.bytes[4] !== 92) {
    console.log('\n  ' + stream.name);
    console.log('    skipped: capture begins mid-connection (first clear id is ' + (stream.bytes[4] ?? 'none') + ', not MAPINFO 92)');
    continue;
  }
  const decoded = decodeServerStream(stream, key, knownGroundTypes);
  const merged = mergeTiles(decoded.updates);
  candidates.push({ stream, decoded, merged });
  console.log('\n  ' + stream.name);
  if (decoded.mapInfo) console.log('    map ' + decoded.mapInfo.width + '×' + decoded.mapInfo.height
    + (decoded.mapInfo.text ? ': ' + decoded.mapInfo.text : ''));
  console.log('    ' + decoded.frames + ' contiguous frames'
    + (decoded.recoveredFrames ? ' (plus ' + decoded.recoveredFrames + ' recovered score frames)' : '')
    + (decoded.recoveredBytes ? ' (plus ' + decoded.recoveredBytes + ' recovered cipher bytes)' : '')
    + ', stopped: ' + decoded.reason);
  console.log('    ' + decoded.updates.length + ' valid UPDATE packets, ' + merged.tiles.length.toLocaleString('en-US') + ' unique tiles');
  if (merged.bounds) console.log('    x ' + merged.bounds.minX + '…' + merged.bounds.maxX + ', y ' + merged.bounds.minY + '…' + merged.bounds.maxY);
}

const realmCandidates = candidates.filter(candidate => candidate.decoded.mapInfo?.text.includes('Realm of the Mad God'));
const ranked = (realmCandidates.length ? realmCandidates : candidates)
  .sort((a, b) => b.merged.tiles.length - a.merged.tiles.length);
const best = ranked[0];
if (!best || !best.merged.tiles.length) {
  console.error('\n  No valid tile placements. The key is wrong, or the capture does not start at a new TCP connection.\n');
  process.exit(2);
}

// A Realm can reconnect during one recording. Combine only captures that
// independently agree on at least one shared coordinate: that guards against
// accidentally mixing two generations or a Nexus/dungeon with matching ids.
const sources = [best];
const reference = new Map(best.merged.tiles.map(tile => [tile.x + ',' + tile.y, tile.type]));
for (const candidate of ranked.slice(1)) {
  let shared = 0;
  let conflicts = 0;
  for (const tile of candidate.merged.tiles) {
    const type = reference.get(tile.x + ',' + tile.y);
    if (type === undefined) continue;
    shared++;
    if (type !== tile.type) conflicts++;
  }
  if (shared && !conflicts) sources.push(candidate);
}
let combined = mergeTiles(sources.flatMap(candidate => candidate.decoded.updates));
let combinedObjects = mergeObjects(sources.flatMap(candidate => candidate.decoded.updates));
// Unlike a live client snapshot, the reconstruction needs every prop seen
// during the walk: a beacon teleport legitimately drops the old viewport.
// Keep that evidence separately; the renderer de-duplicates static props by
// type and coordinate rather than throwing earlier biome samples away.
let observedObjects = sources.flatMap(candidate => candidate.decoded.updates.flatMap(update => update.objects || []));
if (sources.length > 1) console.log('\n  combined ' + sources.length + ' corroborating Realm connections: '
  + combined.tiles.length.toLocaleString('en-US') + ' unique tiles');

let previousConnections = [];
if (mergeFile) {
  const previousPath = path.resolve(mergeFile);
  let previous;
  try { previous = JSON.parse(fs.readFileSync(previousPath, 'utf8')); }
  catch (error) {
    console.error('\n  Cannot read the map to merge: ' + error.message + '\n');
    process.exit(3);
  }
  const sameSize = previous.map && best.decoded.mapInfo
    && previous.map.width === best.decoded.mapInfo.width
    && previous.map.height === best.decoded.mapInfo.height;
  if (!sameSize || !Array.isArray(previous.tiles)) {
    console.error('\n  Refusing to merge: the existing file is not a map of the same dimensions.\n');
    process.exit(3);
  }
  const oldTypes = new Map(previous.tiles.map(tile => [tile.x + ',' + tile.y, tile.type]));
  let shared = 0;
  let conflicts = 0;
  for (const tile of combined.tiles) {
    const type = oldTypes.get(tile.x + ',' + tile.y);
    if (type === undefined) continue;
    shared++;
    if (type !== tile.type) conflicts++;
  }
  if (!shared || conflicts) {
    console.error('\n  Refusing to merge: expected an overlapping, identical patch; found '
      + shared + ' shared coordinates and ' + conflicts + ' conflicts.\n');
    process.exit(3);
  }
  previousConnections = previous.connections || (previous.connection ? [previous.connection] : []);
  combined = mergeTiles([{ tiles: previous.tiles }, { tiles: combined.tiles }]);
  combinedObjects = mergeObjects([{ objects: previous.objects || [] }, { objects: combinedObjects }]);
  observedObjects = [...(previous.observedObjects || []), ...observedObjects];
  console.log('  merged with ' + path.relative(root, previousPath) + ': '
    + combined.tiles.length.toLocaleString('en-US') + ' unique tiles (' + shared.toLocaleString('en-US') + ' confirmed overlap)');
}

if (out) {
  const document = {
    schema: 1,
    source: path.basename(file),
    connection: best.stream.name,
    connections: [...new Set([...previousConnections, ...sources.map(candidate => candidate.stream.name)])],
    map: best.decoded.mapInfo,
    completePrefix: sources.every(candidate => candidate.decoded.reason === 'end of stream'),
    stopReason: mergeFile || sources.length > 1
      ? 'partial capture across corroborating connections'
      : best.decoded.reason,
    tileCount: combined.tiles.length,
    objectCount: combinedObjects.length,
    observedObjectCount: observedObjects.length,
    bounds: combined.bounds,
    tiles: combined.tiles,
    objects: combinedObjects,
    observedObjects
  };
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(document) + '\n', 'utf8');
  console.log('\n  exact placements -> ' + path.relative(root, target));
}
console.log('');
