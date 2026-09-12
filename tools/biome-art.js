'use strict';

const fs = require('fs');
const path = require('path');

/*
 * A biome keeps its client beacon as its semantic/entity relationship.
 *
 * For presentation, however, a locally imported RealmEye beacon is preferred
 * when available. This avoids relying on invisible anchors, guardian sprites,
 * portals, or unrelated Atlas rectangles just to represent the biome.
 *
 * RealmEye artwork is imported locally by:
 *
 *   node tools/fetch-realmeye-biomes.js
 *
 * Nothing is hotlinked by the browser.
 */

function normalized(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }

  return 'image/png';
}

function importedBeacons(root) {
  const result = new Map();

  if (!root) return result;

  const dir = path.join(
    root,
    'web',
    'assets',
    'realm-biomes'
  );

  const manifestFile = path.join(
    dir,
    'index.json'
  );

  if (!fs.existsSync(manifestFile)) {
    return result;
  }

  let manifest;

  try {
    manifest = JSON.parse(
      fs.readFileSync(
        manifestFile,
        'utf8'
      )
    );
  } catch (error) {
    throw new Error(
      `Invalid RealmEye biome manifest: ${error.message}`
    );
  }

  for (const [name, entry] of Object.entries(
    manifest.beacons || {}
  )) {
    if (
      !entry ||
      typeof entry.file !== 'string'
    ) {
      continue;
    }

    /*
     * Importer-generated files are flat files in this directory.
     * Refuse path traversal if the manifest is ever hand-edited.
     */
    if (path.basename(entry.file) !== entry.file) {
      throw new Error(
        `Unsafe RealmEye biome asset path: ${entry.file}`
      );
    }

    const file = path.join(
      dir,
      entry.file
    );

    if (!fs.existsSync(file)) {
      throw new Error(
        `Missing RealmEye biome asset: ${entry.file}`
      );
    }

    const bytes = fs.readFileSync(file);

    result.set(
      normalized(name),
      {
        name,
        file: entry.file,
        icon:
          `data:${mimeFor(file)};base64,` +
          bytes.toString('base64')
      }
    );
  }

  return result;
}

/*
 * The Index's place names and RealmEye headings mostly agree.
 *
 * Keep the small naming boundary explicit where they do not.
 */
const REALMEYE_NAME = {
  'Ancient City': 'Abandoned City',
  'Coral Reef': 'Coral Reefs'
};

module.exports = function biomeArt(
  facts,
  options = {}
) {
  const records = new Map(
    facts.records.map(one => [one.id, one])
  );

  const realmBeacons = importedBeacons(
    options.root
  );

  const beaconFor = {
    'Deep Sea Abyss':
      'enemy:Captured Abyssal Beacon',

    Carboniferous:
      'enemy:Captured Prehistoric Beacon',

    'Runic Tundra':
      'enemy:Captured Frozen Beacon',

    'Ancient City':
      'enemy:Captured Abandoned Beacon',

    'Dead Church':
      'enemy:Captured Gothic Beacon',

    'Haunted Hallows':
      'enemy:Captured Haunted Beacon',

    'Low Forest':
      'enemy:Captured Forest Beacon',

    'Sanguine Forest':
      'enemy:Captured Sanguine Beacon',

    'Coral Reef':
      'enemy:Captured Reefs Beacon',

    'Undead Forest':
      'enemy:Captured Gloomy Beacon',

    'Nature Ruins':
      'enemy:Captured Forest Beacon',

    'Shipwreck Cove':
      'enemy:Captured Shipwrecked Beacon',

    'Risen Hell':
      'enemy:Captured Hell Beacon',

    'Sprite Forest':
      'enemy:Captured Fey Beacon',

    Desert:
      'enemy:Captured Arid Beacon'
  };

  /*
   * Client-only fallback.
   *
   * Some captured-beacon definitions are invisible attack anchors.
   * These records remain useful when the RealmEye import is absent.
   */
  const visibleFor = {
    'Runic Tundra':
      'enemy:Legion Principal Portal#Beacon Guardian Runic Tundra Big Portal'
  };

  /*
   * Historical Carboniferous fallback. Keep it so a completely offline
   * build made without the RealmEye manifest still produces a usable icon.
   */
  const carbonFile =
    options.root &&
    path.join(
      options.root,
      'web',
      'assets',
      'index',
      'biomes',
      'carboniferous.png'
    );

  const carbonIcon =
    carbonFile &&
    fs.existsSync(carbonFile)
      ? 'data:image/png;base64,' +
        fs.readFileSync(carbonFile).toString('base64')
      : null;

  for (
    const place of facts.records.filter(
      one => one.kind === 'place'
    )
  ) {
    const beacon = records.get(
      beaconFor[place.name]
    );

    if (!beacon) continue;

    /*
     * Presentation authority:
     *
     *     imported RealmEye beacon
     *            ↓
     *     client-visible fallback
     *
     * `place.beacon` still points to the client entity either way.
     */
    const realmName =
      REALMEYE_NAME[place.name] ||
      place.name;

    const realm = realmBeacons.get(
      normalized(realmName)
    );

    if (realm) {
      delete place.art;
      delete place.beaconArt;

      place.icon = realm.icon;
      place.beacon = beacon.id;

      continue;
    }

    if (
      place.name === 'Carboniferous' &&
      carbonIcon
    ) {
      delete place.art;
      delete place.beaconArt;

      place.icon = carbonIcon;
      place.beacon = beacon.id;

      continue;
    }

    const visible =
      records.get(visibleFor[place.name]) ||
      beacon;

    if (!visible || !visible.art) {
      continue;
    }

    delete place.icon;

    place.art = visible.art;
    place.beacon = beacon.id;

    if (visible !== beacon) {
      place.beaconArt = visible.id;
    } else {
      delete place.beaconArt;
    }
  }

  return facts;
};
