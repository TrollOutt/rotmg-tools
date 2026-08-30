'use strict';
/*
 * Build the small browser dataset used by the Realm Atlas.
 *
 * The layout of a procedurally generated realm cannot be recovered from the
 * client, but the things which make a zone meaningful can: terrain ids,
 * encounter odds, beacon families and every monster's declared terrain,
 * health, defence, experience and spawn probability.  Keep that part sourced
 * from the installed client, then keep the illustrative atlas topology in the
 * browser layer where it is clearly a presentation choice.
 *
 *   node tools/extract-client.js && node tools/generate-realm.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const input = path.join(root, 'client-data');
const output = path.join(root, 'web', 'realm-data.js');
const spriteIndex = path.join(root, 'web', 'assets', 'realm-monsters', 'index.json');
const animationIndex = path.join(root, 'web', 'assets', 'realm-monster-animations', 'index.json');
const realmEyePath = path.join(root, 'web', 'realmeye-data.json');
const spriteFiles = fs.existsSync(spriteIndex) ? JSON.parse(fs.readFileSync(spriteIndex, 'utf8')) : {};
const animationFiles = fs.existsSync(animationIndex) ? JSON.parse(fs.readFileSync(animationIndex, 'utf8')) : {};
const realmEye = fs.existsSync(realmEyePath) ? JSON.parse(fs.readFileSync(realmEyePath, 'utf8')) : null;

// This is deliberately a small, explicit editorial layer over the client
// terrain ids.  The game client supplies the entities and encounter values;
// it does not supply a permanent realm layout or player-facing zone names.
// Keeping this list here makes those presentation choices reviewable and
// prevents a visual region from being accidentally wired to an unrelated
// legacy terrain (as happened with Mountains / Abandoned City).
const ZONE_CATALOG = [
  { id: 'shore-plains', name: 'Beach', terrains: ['Beach', 'ShorePlains'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'shore-sand', name: 'Undead Forest', terrains: ['UndeadForest', 'ShoreSand'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'low-forest', name: 'Low Forest', terrains: ['LowForest'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'low-plains', name: 'Mid Plains', terrains: ['MidPlains'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'low-desert', name: 'Low Desert', terrains: ['LowSand'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'mid-forest', name: 'Nature Ruins', terrains: ['MidForest'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'mid-plains', name: 'Mid Desert', terrains: ['MidDesert', 'MidSand'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'mid-desert', name: 'Unclassified terrain', terrains: ['MidPlains'], kind: 'biome', difficulty: 'Rookie' },
  { id: 'high-forest', name: 'High Forest', terrains: ['HighForest'], kind: 'biome', difficulty: 'Highlands' },
  { id: 'high-plains', name: 'High Plains', terrains: ['HighPlains'], kind: 'biome', difficulty: 'Highlands' },
  { id: 'high-desert', name: 'High Desert', terrains: ['HighSand', 'HighDesert'], kind: 'biome', difficulty: 'Highlands' },
  { id: 'coral-reefs', name: 'Coral Reefs', terrains: ['CoralReefs'], kind: 'encounter', difficulty: 'Adept' },
  { id: 'shipwreck-cove', name: 'Shipwreck Cove', terrains: ['ShipWreck'], kind: 'encounter', difficulty: 'Adept' },
  { id: 'haunted-hallows', name: 'Haunted Hallows', terrains: ['HauntedHallows'], kind: 'encounter', difficulty: 'Adept' },
  { id: 'abandoned-city', name: 'Abandoned City', terrains: ['Abandoned', 'Abandoned2'], kind: 'encounter', difficulty: 'Adept' },
  { id: 'risen-hell', name: 'Risen Hell', terrains: ['RisenHell'], kind: 'encounter', difficulty: 'Adept' },
  { id: 'dead-church', name: 'Dead Church', terrains: ['DeadChurch'], kind: 'encounter', difficulty: 'Adept' },
  { id: 'sprite-forest', name: 'Sprite Forest', terrains: ['SpriteForest'], kind: 'encounter', difficulty: 'Adept' },
  { id: 'deep-sea-abyss', name: 'Deep Sea Abyss', terrains: ['DeepSea'], kind: 'encounter', difficulty: 'Veteran' },
  { id: 'floral-escape', name: 'Floral Escape', terrains: ['FloralEscape'], kind: 'encounter', difficulty: 'Veteran' },
  { id: 'carboniferous', name: 'Carboniferous', terrains: ['Carboniferous'], kind: 'encounter', difficulty: 'Veteran' },
  { id: 'sanguine-forest', name: 'Sanguine Forest', terrains: ['SanguineForest'], kind: 'encounter', difficulty: 'Veteran' },
  { id: 'runic-tundra', name: 'Runic Tundra', terrains: ['RunicTundra'], kind: 'encounter', difficulty: 'Veteran' },
  { id: 'eternal-frost', name: 'Eternal Frost', terrains: ['EternalFrost'], kind: 'seasonal', difficulty: 'Seasonal' },
  { id: 'spring-of-meaning', name: 'Relentless Springs', terrains: ['SpringMeaning'], kind: 'seasonal', difficulty: 'Seasonal' }
];

if (!fs.existsSync(path.join(input, 'TerrainTypes.xml'))) {
  console.error('client-data is missing TerrainTypes.xml. Run node tools/extract-client.js first.');
  process.exit(1);
}

const decode = value => String(value || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (body, name) => {
  const found = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(body);
  return found ? decode(found[1]).trim() : '';
};
const attr = (attrs, name) => {
  const found = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return found ? decode(found[1]) : '';
};
const number = value => {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
};
const compareName = value => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'").replace(/[^a-z0-9]+/g, '');

const terrains = new Map();
const clientEnemies = new Map();
const terrainXml = fs.readFileSync(path.join(input, 'TerrainTypes.xml'), 'utf8');
for (const match of terrainXml.matchAll(/<Terrain\s+([^/>]*)\/?>(?:<\/Terrain>)?/g)) {
  const attrs = match[1];
  const id = attr(attrs, 'id');
  if (!id || id === 'None' || id === 'Unknown' || id === 'Water') continue;
  terrains.set(id, {
    id,
    encounterScore: number(attr(attrs, 'encounterScore')),
    encounterChance: number(attr(attrs, 'encounterChance')),
    monsters: [],
    phaseCreatures: [],
    spawners: []
  });
}

for (const file of fs.readdirSync(input).filter(name => /^Objects\.\d+\.xml$/.test(name))) {
  const xml = fs.readFileSync(path.join(input, file), 'utf8');
  for (const match of xml.matchAll(/<Object\s+([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const attrs = match[1];
    const body = match[2];
    if (!/<Enemy\s*\/>/.test(body)) continue;
    const terrain = tag(body, 'Terrain');
    const id = attr(attrs, 'id');
    if (!id || /(?:Projectile|Shot|Blast|Helper|Anchor|Decoy|Portal|Minion)$/i.test(id)) continue;
    const display = tag(body, 'DisplayId');
    const texture = /<(AnimatedTexture|Texture)>\s*<File>([^<]+)<\/File>\s*<Index>([^<]+)<\/Index>\s*<\/(?:AnimatedTexture|Texture)>/.exec(body);
    const effects = [...body.matchAll(/<ConditionEffect\b[^>]*>([^<]+)<\/ConditionEffect>/g)].map(entry => decode(entry[1]).trim());
    const specialSpawns = [...body.matchAll(/<SpecialSpawn\b([^>]*)>([^<]+)<\/SpecialSpawn>/g)].map(entry => ({
      category: attr(entry[1], 'category'), name: decode(entry[2]).trim()
    }));
    const spawnGroup = /<Spawn>\s*([\s\S]*?)<\/Spawn>/.exec(body);
    const loot = [...body.matchAll(/<Loot\b([^>]*)>([^<]+)<\/Loot>/g)].map(entry => ({
      item: decode(entry[2]).trim(), tier: number(attr(entry[1], 'tier')), probability: number(attr(entry[1], 'prob'))
    }));
    const record = {
      id,
      name: display && !/^\{.+\}$/.test(display) ? display : id,
      hp: number(tag(body, 'MaxHitPoints')),
      defense: number(tag(body, 'Defense')),
      exp: number(tag(body, 'Exp')),
      spawn: number(tag(body, 'SpawnProb')),
      score: number((/<RealmScore\b[^>]*>([\s\S]*?)<\/RealmScore>/.exec(body) || [])[1]),
      description: tag(body, 'Description'),
      labels: tag(body, 'Labels').split(',').map(value => value.trim()).filter(Boolean),
      effects: [...new Set(effects)].sort(),
      specialSpawns,
      spawnGroup: spawnGroup ? {
        mean: number(tag(spawnGroup[1], 'Mean')), stdDev: number(tag(spawnGroup[1], 'StdDev')),
        min: number(tag(spawnGroup[1], 'Min')), max: number(tag(spawnGroup[1], 'Max'))
      } : null,
      loot,
      sprite: texture ? { animated: texture[1] === 'AnimatedTexture', file: texture[2], index: texture[3] } : null
    };
    record.rank = record.labels.includes('VETERAN') ? 'Veteran' : record.labels.includes('ADEPT') ? 'Adept' : '';
    record.role = record.score >= 45 ? 'zoneBoss' : record.score >= 30 ? 'elite' : record.spawn > 0 ? 'native' : 'phaseOrSummon';
    if (spriteFiles[id]) record.art = spriteFiles[id];
    if (animationFiles[id]) record.animation = animationFiles[id];
    // Some names exist both in legacy dungeons and in the New Realm.  Prefer
    // the explicit Realm-score variant (then the more substantial stat block)
    // so an imported Realm entry cannot accidentally bind to an old dungeon
    // clone such as the legacy Scout Colony.
    const recordKey = compareName(record.name);
    const previousRecord = clientEnemies.get(recordKey);
    if (!previousRecord || record.score > previousRecord.score || (record.score === previousRecord.score && record.hp > previousRecord.hp)) {
      clientEnemies.set(recordKey, record);
    }
    // Terrain-tagged zero-HP entities are not creatures. They are still useful
    // to a future map (ores, seasonal events, dungeon initiators), so retain
    // them in their own relationship rather than showing them as enemies.
    if (terrains.has(terrain)) {
      if (record.hp > 0 && record.spawn > 0) terrains.get(terrain).monsters.push(record);
      else if (record.hp > 0) terrains.get(terrain).phaseCreatures.push(record);
      else if (/Spawner|Initiator|Announcer/i.test(id)) terrains.get(terrain).spawners.push({ id, name: record.name, spawn: record.spawn, specialSpawns });
    }
  }
}

for (const terrain of terrains.values()) {
  const seen = new Set();
  terrain.monsters = terrain.monsters
    .filter(monster => !seen.has(monster.id) && seen.add(monster.id))
    .sort((a, b) => b.spawn - a.spawn || b.score - a.score || a.name.localeCompare(b.name));
  terrain.phaseCreatures = terrain.phaseCreatures
    .filter(monster => !seen.has(monster.id) && seen.add(monster.id))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  terrain.spawners = terrain.spawners
    .sort((a, b) => b.spawn - a.spawn || a.name.localeCompare(b.name));
}

const zoneData = ZONE_CATALOG.map(zone => {
  const sources = zone.terrains.map(id => terrains.get(id)).filter(Boolean);
  const creatures = sources.flatMap(source => source.monsters);
  const phaseCreatures = sources.flatMap(source => source.phaseCreatures);
  const encounterChance = Math.max(0, ...sources.map(source => source.encounterChance));
  const encounterScore = Math.max(0, ...sources.map(source => source.encounterScore));
  const allCreatures = [...creatures, ...phaseCreatures];
  const byName = new Map([...clientEnemies, ...allCreatures.map(creature => [compareName(creature.name), creature])]);
  const wikiBiome = realmEye && realmEye.biomes && realmEye.biomes[zone.id];
  const wikiGroups = {};
  if (wikiBiome) for (const [group, entries] of Object.entries(wikiBiome.groups || {})) {
    wikiGroups[group] = entries.map(entry => {
      const wikiCreature = realmEye.creatures && realmEye.creatures[entry.path];
      const matched = byName.get(compareName(entry.name));
      const reference = wikiCreature ? { detail: wikiCreature.detail || null } : null;
      return matched ? { ...matched, ...(matched.art || matched.animation ? {} : { catalogArt: wikiCreature && wikiCreature.art }), reference }
        : { name: entry.name, catalogArt: wikiCreature && wikiCreature.art, reference };
    });
  }
  return {
    ...zone,
    encounterChance,
    encounterScore,
    monsters: creatures.sort((a, b) => b.spawn - a.spawn || b.score - a.score || a.name.localeCompare(b.name)),
    elites: creatures.filter(creature => creature.role === 'elite' || creature.role === 'zoneBoss'),
    phaseCreatures,
    spawners: sources.flatMap(source => source.spawners),
    reference: wikiBiome ? { rank: wikiBiome.rank } : null,
    wikiGroups
  };
});

const beacons = [];
for (const file of fs.readdirSync(input).filter(name => /^Objects\.\d+\.xml$/.test(name))) {
  const xml = fs.readFileSync(path.join(input, file), 'utf8');
  for (const match of xml.matchAll(/<Object\s+([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const id = attr(match[1], 'id');
    if (!/^Beacon Guardian /.test(id)) continue;
    if (/(?:Attack Anchor|Patrol Point|Helper|Orb|Beam|Minion|Decoy|Teleport Point|Portal|Invul)/i.test(id)) continue;
    const name = id.replace(/^Beacon Guardian /, '').replace(/ (?:Attack Anchor|Patrol Point|Orb Helper|Light Orb|Dark Orb|Light Beam|Dark Beam|Minion)$/i, '');
    if (!beacons.some(beacon => beacon.name === name)) beacons.push({ name, hp: number(tag(match[2], 'MaxHitPoints')) });
  }
}

const data = {
  schema: 3,
  generatedAt: new Date().toISOString().slice(0, 10),
  notes: {
    topology: 'Map placement is a presentation layer; the client generates each realm.',
    loot: 'The client does not attach direct loot entries to terrain monsters. Imported reference loot facts are retained on local creature records; unmatched or unverified drops are not inferred.',
    roles: 'Native creatures have a positive terrain SpawnProb. Zero-probability creatures are kept separately as phase/summoned candidates; MINION alone is not treated as an invocation because the New Realm uses it on normal biome fauna.'
  },
  terrains: [...terrains.values()].sort((a, b) => a.id.localeCompare(b.id)),
  zones: zoneData,
  beacons: beacons.sort((a, b) => a.name.localeCompare(b.name))
};

fs.writeFileSync(output, `/* Generated from the installed RotMG client; run tools/generate-realm.js. */\nvar RealmData = ${JSON.stringify(data)};\n`, 'utf8');
console.log(`Realm data -> web/realm-data.js (${data.terrains.length} terrains, ${data.terrains.reduce((sum, zone) => sum + zone.monsters.length, 0)} terrain monsters, ${data.beacons.length} beacon guardians)`);
