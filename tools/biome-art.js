'use strict';

const fs = require('fs');
const path = require('path');

/* A biome is represented by the captured beacon that marks that terrain in
 * the Realm. Run this after sprite decoration (or after restoring a prior
 * sheet) so the place reuses the exact same rectangle as its beacon. */
module.exports = function biomeArt(facts, options = {}) {
  const records = new Map(facts.records.map(one => [one.id, one]));
  const beaconFor = {
    'Deep Sea Abyss': 'enemy:Captured Abyssal Beacon',
    Carboniferous: 'enemy:Captured Prehistoric Beacon',
    'Runic Tundra': 'enemy:Captured Frozen Beacon',
    'Ancient City': 'enemy:Captured Abandoned Beacon',
    'Dead Church': 'enemy:Captured Gothic Beacon',
    'Haunted Hallows': 'enemy:Captured Haunted Beacon',
    'Low Forest': 'enemy:Captured Forest Beacon',
    'Sanguine Forest': 'enemy:Captured Sanguine Beacon',
    'Coral Reef': 'enemy:Captured Reefs Beacon',
    'Undead Forest': 'enemy:Captured Gloomy Beacon',
    'Nature Ruins': 'enemy:Captured Forest Beacon',
    'Shipwreck Cove': 'enemy:Captured Shipwrecked Beacon',
    'Risen Hell': 'enemy:Captured Hell Beacon',
    'Sprite Forest': 'enemy:Captured Fey Beacon',
    Desert: 'enemy:Captured Arid Beacon'
  };
  // These two captured-beacon definitions are invisible attack anchors in
  // the client. Runic Tundra's visible beacon is its large teleport portal.
  // Carboniferous is a map object rather than an indexed enemy, so its exact
  // rendered sprite is carried as a tiny dedicated asset.
  const visibleFor = {
    'Runic Tundra': 'enemy:Legion Principal Portal#Beacon Guardian Runic Tundra Big Portal'
  };
  const carbonFile = options.root && path.join(options.root,
    'web', 'assets', 'index', 'biomes', 'carboniferous.png');
  const carbonIcon = carbonFile && fs.existsSync(carbonFile)
    ? 'data:image/png;base64,' + fs.readFileSync(carbonFile).toString('base64') : null;
  for (const place of facts.records.filter(one => one.kind === 'place')) {
    const beacon = records.get(beaconFor[place.name]);
    const visible = records.get(visibleFor[place.name]) || beacon;
    if (!beacon) continue;
    if (place.name === 'Carboniferous' && carbonIcon) {
      delete place.art;
      delete place.beaconArt;
      place.icon = carbonIcon;
      place.beacon = beacon.id;
      continue;
    }
    if (!visible || !visible.art) continue;
    delete place.icon;
    place.art = visible.art;
    place.beacon = beacon.id;
    if (visible !== beacon) place.beaconArt = visible.id;
    else delete place.beaconArt;
  }
  return facts;
};
