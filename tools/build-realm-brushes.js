'use strict';
/*
 * Learn paint brushes from decoded Realm ground placements.
 *
 *   node tools/build-realm-brushes.js [realm-map.json] [realm-brushes.json]
 *
 * The output deliberately records its evidence. It contains no guessed type:
 * a biome is omitted until a captured packet has supplied its floor type.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'client-data', 'capture', 'realm-map.json');
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'data', 'Realm', 'realm-brushes.json');
const map = JSON.parse(fs.readFileSync(input, 'utf8'));

const names = new Map();
for (const filename of fs.readdirSync(path.join(root, 'client-data')).filter(name => /^GroundTypes\./.test(name))) {
  const xml = fs.readFileSync(path.join(root, 'client-data', filename), 'utf8');
  for (const match of xml.matchAll(/<Ground\b([^>]*)>/g)) {
    const type = /\btype="([^"]+)"/.exec(match[1]);
    const id = /\bid="([^"]+)"/.exec(match[1]);
    if (type && id) names.set(Number(type[1]) & 0xffff, id[1]);
  }
}

const groups = [
  ['Shore', /shoreline/i], ['Low Forest', /low forest/i], ['Nature Ruins', /nature ruins/i],
  ['Desert', /desert/i], ['Sprite Forest', /sprite forest/i], ['Haunted Hallows', /haunted hallows/i],
  ['Dead Church', /dead church/i], ['Coral Reefs', /coral reefs/i], ['Castle', /castle|oryx castle/i]
];
const classify = name => groups.find(([, pattern]) => pattern.test(name || ''))?.[0] || null;
const byPosition = new Map(map.tiles.map(tile => [tile.x + ',' + tile.y, tile.type]));
const counts = new Map();
const neighbours = new Map();
for (const tile of map.tiles) {
  const name = names.get(tile.type) || '';
  const group = classify(name);
  if (!group) continue;
  if (!counts.has(group)) counts.set(group, new Map());
  const kind = /\broad\b/i.test(name) ? 'road' : /set ?piece|brick floor|rug|stone floor/i.test(name) ? 'feature' : 'ground';
  const key = kind + ':' + tile.type;
  counts.get(group).set(key, (counts.get(group).get(key) || 0) + 1);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const nearby = byPosition.get((tile.x + dx) + ',' + (tile.y + dy));
    if (nearby === undefined) continue;
    const pair = Math.min(tile.type, nearby) + ':' + Math.max(tile.type, nearby);
    if (!neighbours.has(group)) neighbours.set(group, new Map());
    neighbours.get(group).set(pair, (neighbours.get(group).get(pair) || 0) + 1);
  }
}

const normalize = entries => {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return entries.sort((a, b) => b.count - a.count || a.type - b.type)
    .map(entry => ({ ...entry, weight: entry.count / total }));
};
const brushes = {};
for (const [group, values] of counts) {
  const brush = { ground: [], road: [], feature: [], adjacency: [] };
  for (const [key, count] of values) {
    const [kind, text] = key.split(':');
    const type = Number(text);
    brush[kind].push({ type, name: names.get(type), count });
  }
  for (const kind of ['ground', 'road', 'feature']) brush[kind] = normalize(brush[kind]);
  brush.adjacency = [...(neighbours.get(group) || new Map())]
    .map(([pair, count]) => ({ pair: pair.split(':').map(Number), count }))
    .sort((a, b) => b.count - a.count);
  brushes[group] = brush;
}

const document = {
  schema: 1,
  source: path.basename(input),
  evidence: { tileCount: map.tileCount, bounds: map.bounds, map: map.map },
  brushes
};
fs.writeFileSync(output, JSON.stringify(document, null, 2) + '\n');
console.log(path.relative(root, output) + ': ' + Object.keys(brushes).length + ' learned brushes from ' + map.tileCount.toLocaleString('en-US') + ' tiles');
for (const [name, brush] of Object.entries(brushes)) console.log('  ' + name + ': ' + brush.ground.length + ' ground, ' + brush.road.length + ' road, ' + brush.feature.length + ' feature types');
