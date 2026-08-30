/*
 * Builds a single self-contained HTML file that runs with no server and no
 * install: download it, double-click it, done.
 *
 *   node tools/build-standalone.js        ->  docs/
 *
 * Everything is inlined, because a page opened through file:// is not allowed
 * to fetch anything next to it:
 *   - the original enchantment / artifact / awakened-item text files,
 *   - every sprite the interface can ask for, as data: URIs,
 *   - style.css, engine.js and app.js.
 *
 * The result is handed to the page as window.ROTMG_BUNDLE; web/app.js detects
 * it and skips its fetch() path entirely.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web');
const dataRoot = path.join(root, 'data');
const gui = path.join(dataRoot, 'GUI Files');
// The only output. GitHub Pages serves this folder: index.html is the page
// under the name a web server looks for, and the copy under its download name
// is what the "keep a copy" link on the served page points at, so the offline
// file is the very one being served rather than a second build of it.
const pagesDir = path.join(root, 'docs');
const outFile = path.join(pagesDir, 'index.html');

/*
 * Line endings are normalised on the way in. These files are embedded verbatim
 * in the bundle, and git hands them to a Windows checkout with CRLF and to the
 * CI runner with LF — which produced two builds that behaved identically but
 * differed by 7,670 bytes, so the published page could never be checked against
 * a local one. The parser strips \r anyway; dropping it here makes the build
 * depend on the repository rather than on the machine.
 */
const readText = (...parts) =>
  fs.readFileSync(path.join(dataRoot, ...parts), 'utf8').replace(/\r\n/g, '\n');

/* ---------------------------------------------------------------- *
 * 1. Data                                                           *
 * ---------------------------------------------------------------- */

const sources = {
  clientModText: readText('Enchantment documents', 'client-enchantments.txt'),
  clientItemText: readText('Items', 'client-items.txt'),
  fameText: readText('Fame', 'client-fame.txt'),
  dungeonText: readText('Fame', 'dungeon-pages.txt'),
  overrideText: readText('Fame', 'availability-overrides.txt'),
  clientArtifactText: readText('Artifacts', 'client-artifacts.txt'),
  awakenText: readText('Awakened Items', 'awakenedItems.txt'),
};

/* ---------------------------------------------------------------- *
 * 2. Sprites                                                        *
 * ---------------------------------------------------------------- */

// Keyed exactly the way web/app.js builds a path with asset(), so the lookup
// in the browser is a plain map hit.
const assets = {};
let assetBytes = 0;

function embed(folder, file) {
  const absolute = path.join(gui, folder, file);
  if (!fs.existsSync(absolute)) return false;
  const bytes = fs.readFileSync(absolute);
  assetBytes += bytes.length;
  const kind = /.gif$/i.test(file) ? 'gif' : 'png';
  assets[`GUI Files/${folder}/${file}`] = `data:image/${kind};base64,${bytes.toString('base64')}`;
  return true;
}

function embedAll(folder, filter) {
  let added = 0;
  // Sorted explicitly: NTFS hands readdirSync a case-insensitive order and
  // ext4 does not, which put the same assets in a different order in the
  // bundle and made two correct builds differ.
  for (const file of fs.readdirSync(path.join(gui, folder)).sort()) {
    // The dungeon portals are animated where the game animates them, and an
    // animated PNG is not a thing the wiki serves, so GIFs come in too.
    if (!/.(png|gif)$/i.test(file)) continue;
    if (filter && !filter(file)) continue;
    if (embed(folder, file)) added++;
  }
  return added;
}

const counts = {
  // Artifact rows use the half-scale icons only.
  'Artifact Icons': embedAll('Artifact Icons', file => file.endsWith('-div2.png')),
  'Enchantment Icons': embedAll('Enchantment Icons'),
  'Dungeon Icons': embedAll('Dungeon Icons'),
  'Awakenable Items': embedAll('Awakenable Items'),
  'Dust Types': embedAll('Dust Types'),
  'Item Types': embedAll('Item Types'),
  // Rarity uses the 8x upscales.
  'Item Rarities': embedAll('Item Rarities', file => file.includes('_scaled_8x'))
};

/*
 * The pictures on the home page's way-in cards, whatever they happen to be.
 *
 * They are the one place the interface asks for an artifact icon at full size,
 * and the rule above embeds only the half-scale ones. A card whose picture is
 * missing from the bundle does not fall back to a relative path — app.js
 * removes the image — so the card simply lost its sprite on the published
 * site while still showing it from the repository. Reading the tags rather
 * than listing the files means changing a card's picture cannot bring that
 * back, and the build stops if one of them names a file that is not there.
 */
const homeArt = [...fs.readFileSync(path.join(web, 'index.html'), 'utf8')
  .matchAll(/data-art="([^"/]+)\/([^"]+)"/g)]
  .map(([, folder, file]) => { embed(folder, file); return `GUI Files/${folder}/${file}`; });

/* ---------------------------------------------------------------- *
 * 2b. Item sprites                                                  *
 * ---------------------------------------------------------------- */

// Downloaded once by tools/fetch-item-sprites.js. Optional: without them the
// interface falls back to the slot icons, so a fresh clone still builds.
const itemSprites = {};
let itemSpriteBytes = 0;
const itemDir = path.join(web, 'assets', 'items');
const itemIndexPath = path.join(itemDir, 'index.json');
if (fs.existsSync(itemIndexPath)) {
  const index = JSON.parse(fs.readFileSync(itemIndexPath, 'utf8'));
  for (const [name, file] of Object.entries(index)) {
    const absolute = path.join(itemDir, file);
    if (!fs.existsSync(absolute)) continue;
    const bytes = fs.readFileSync(absolute);
    itemSpriteBytes += bytes.length;
    const mime = path.extname(file).toLowerCase() === '.gif' ? 'image/gif' : 'image/png';
    itemSprites[name] = `data:${mime};base64,${bytes.toString('base64')}`;
  }
}

// Realm Atlas creature portraits are individual, lazy-loaded files while the
// site is served. An offline copy has no directory beside it, so carry the
// same id -> data URI lookup the item picker already uses. They are small
// pixel sprites and are only read if the optional extraction has been run.
const realmMonsterSprites = {};
const realmSpriteDir = path.join(web, 'assets', 'realm-monsters');
const realmSpriteIndex = path.join(realmSpriteDir, 'index.json');
if (fs.existsSync(realmSpriteIndex)) {
  const index = JSON.parse(fs.readFileSync(realmSpriteIndex, 'utf8'));
  for (const [id, file] of Object.entries(index)) {
    const absolute = path.join(realmSpriteDir, file);
    if (!fs.existsSync(absolute)) continue;
    realmMonsterSprites[id] = `data:image/png;base64,${fs.readFileSync(absolute).toString('base64')}`;
  }
}

// Imported reference sprites cover encounter creatures that are absent from
// this installed client snapshot. They stay local just like client portraits.
const realmCatalogSprites = {};
const realmCatalogDir = path.join(web, 'assets', 'realm-catalog');
if (fs.existsSync(realmCatalogDir)) {
  for (const file of fs.readdirSync(realmCatalogDir).sort()) {
    if (!/\.(png|gif|webp)$/i.test(file)) continue;
    const kind = path.extname(file).slice(1).toLowerCase();
    realmCatalogSprites[file] = `data:image/${kind};base64,${fs.readFileSync(path.join(realmCatalogDir, file)).toString('base64')}`;
  }
}

// Animated Realm portraits are pre-cropped, lossless WebP loops. Shipping
// only those tiny loops keeps the offline page much smaller than embedding the
// full client character atlas.
const realmMonsterAnimations = {};
const realmAnimationDir = path.join(web, 'assets', 'realm-monster-animations');
const realmAnimationIndex = path.join(realmAnimationDir, 'index.json');
if (fs.existsSync(realmAnimationIndex)) {
  const index = JSON.parse(fs.readFileSync(realmAnimationIndex, 'utf8'));
  for (const [id, file] of Object.entries(index)) {
    const absolute = path.join(realmAnimationDir, file);
    if (!fs.existsSync(absolute)) continue;
    realmMonsterAnimations[id] = `data:image/webp;base64,${fs.readFileSync(absolute).toString('base64')}`;
  }
}

/* ---------------------------------------------------------------- *
 * 3. Check the bundle covers everything the UI can ask for          *
 * ---------------------------------------------------------------- */

// Parsing with the real engine keeps this check honest: if a new enchantment
// or artifact turns up in the data, a missing sprite fails the build.
const readWeb = file => fs.readFileSync(path.join(web, file), 'utf8').replace(/\r\n/g, '\n');
const engineSource = readWeb('engine.js');
const itemsSource = readWeb('items.js');
const fameSource = readWeb('fame.js');
const famePageSource = readWeb('fame-page.js');
const realmDataSource = readWeb('realm-data.js');
const realmMapSource = readWeb('realm-map.js');
const engine = require(path.join(web, 'engine.js'));
const dataset = engine.buildDataset(sources);

function iconFor(mod) {
  if (mod.tags.has('AWAKENED')) return mod.name;
  if (mod.tags.has('UNIQUE')) return mod.weight === 750 ? 'UNIQUEFROZEN' : 'UNIQUE';
  for (const tag of ['NEO_ALIEN', 'ALIEN', 'SINGLESTAT', 'DUALSTAT', 'PROC', 'REWARDBONUS', 'DAMAGE', 'WEAPONRANGE', 'CASTING', 'MANAREGEN', 'LIFEREGEN', 'DAMAGERESISTANCE', 'DUALREWARDBONUS']) {
    if (mod.tags.has(tag)) return tag;
  }
  return null;
}

const required = new Set();

/*
 * Artwork only exists for the 25 artifacts the original Qt assets covered. The
 * client defines 51, and the 26 it does not draw are still ranked, priced and
 * explained — the table simply shows them without a picture. Requiring an icon
 * for those would stop the build over something cosmetic, so they are listed
 * instead, and the interface leaves the space empty rather than breaking.
 */
const ARTIFACT_ART_ALIAS = { 'Premium Silver Card': 'Premium Silver Tarot Card' };
const withoutArt = [];
for (const artifact of dataset.artifacts) {
  const key = `GUI Files/Artifact Icons/${ARTIFACT_ART_ALIAS[artifact.name] || artifact.name}-div2.png`;
  if (assets[key]) required.add(key);
  else if (artifact.name !== 'No Artifact') withoutArt.push(artifact.name);
}
// Same as the artifacts: artwork covers what the Qt assets covered, and the
// client has since added enchantments that were never drawn here. They are
// listed and shown without a picture rather than stopping the build.
const enchantsWithoutArt = [];
for (const mod of dataset.enchants) {
  const icon = iconFor(mod);
  if (!icon) continue;
  const key = `GUI Files/Enchantment Icons/${icon}.png`;
  if (assets[key]) required.add(key);
  else enchantsWithoutArt.push(mod.name);
}
// Group artwork exists only for the names the Qt file lists; the wiki mapping
// adds a hundred items that carry their own sprite instead, and the interface
// never asks for a group picture for those.
for (const item of dataset.awokenArt) required.add(`GUI Files/Awakenable Items/${dataset.spriteAlias[item] || item}.png`);
for (const dust of ['Green', 'Red', 'Purple']) {
  required.add(`GUI Files/Dust Types/${dust}.png`);
  required.add(`GUI Files/Dust Types/${dust}-div2.png`);
}
for (const type of ['weapon', 'ability', 'armor', 'ring', 'SUMMONPOWERED', 'ALIEN', 'NEO_ALIEN']) required.add(`GUI Files/Item Types/${type}.png`);
for (const rarity of ['uncommon', 'rare', 'legendary', 'divine']) required.add(`GUI Files/Item Rarities/${rarity}_scaled_8x.png`);
for (const key of homeArt) required.add(key);

if (enchantsWithoutArt.length) {
  console.log(`  ${enchantsWithoutArt.length} enchantments have no artwork and render without one: ${enchantsWithoutArt.join(', ')}`);
}
if (withoutArt.length) {
  console.log(`  ${withoutArt.length} artifacts have no artwork in the Qt asset set and render without one:`);
  console.log(`    ${withoutArt.join(', ')}`);
}

const missing = [...required].filter(key => !assets[key]);

/* ---------------------------------------------------------------- *
 * 4. Assemble                                                       *
 * ---------------------------------------------------------------- */

// A literal "</script" inside an inlined source would close the surrounding tag.
const safe = text => text.replace(/<\/script/gi, '<\\/script');

// In the JSON blob "<" is escaped so no "</script" can form at all. U+2028 and
// U+2029 are legal inside a JSON string but are line terminators in JavaScript
// source, so they have to be escaped too.
const LINE_SEPARATORS = new RegExp('[\\u2028\\u2029]', 'g');
const jsonForScript = value => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(LINE_SEPARATORS, ch => ch.charCodeAt(0) === 0x2028 ? '\\u2028' : '\\u2029');

const css = readWeb('style.css');
const appSource = readWeb('app.js');
let page = readWeb('index.html');

const styleTag = '<link rel="stylesheet" href="style.css">';
const scriptTags = '<script src="engine.js"></script>\n<script src="items.js"></script>\n'
  + '<script src="fame.js"></script>\n<script src="fame-page.js"></script>\n<script src="realm-data.js"></script>\n<script src="realm-map.js"></script>\n<script src="app.js"></script>';
if (!page.includes(styleTag) || !page.includes(scriptTags)) {
  console.error('Build failed: web/index.html no longer contains the tags this script replaces.');
  process.exit(1);
}

// The tab and the app-mode window title bar get the original Qt icon, inlined
// like everything else so the file still depends on nothing.
const iconBytes = fs.readFileSync(path.join(dataRoot, 'appicon.ico'));
const faviconTag = `<link rel="icon" href="data:image/x-icon;base64,${iconBytes.toString('base64')}">`;

const built = new Date().toISOString().slice(0, 10);

// What tools/read-client.js last saw in an installed game client. Carried into
// the file so an offline copy can still say which build its numbers were
// checked against; absent if nobody has run the reader yet.
const changesPath = path.join(dataRoot, 'client-changes.txt');
const changes = fs.existsSync(changesPath) ? fs.readFileSync(changesPath, 'utf8') : '';

page = page
  .replace('</title>', `</title>\n  ${faviconTag}`)
  .replace(styleTag, `<style>\n${css}\n</style>`)
  .replace(scriptTags, [
    `<script>window.ROTMG_BUNDLE=${jsonForScript({ built, changes, sources, assets, itemSprites, realmMonsterSprites, realmCatalogSprites, realmMonsterAnimations })};</script>`,
    `<script>\n${safe(engineSource)}\n</script>`,
    `<script>\n${safe(itemsSource)}\n</script>`,
    `<script>\n${safe(fameSource)}\n</script>`,
    `<script>\n${safe(famePageSource)}\n</script>`,
    `<script>\n${safe(realmDataSource)}\n</script>`,
    `<script>\n${safe(realmMapSource)}\n</script>`,
    `<script>\n${safe(appSource)}\n</script>`
  ].join('\n'))
  .replace('</head>', `  <meta name="generator" content="rotmg-enchant-calculator standalone build ${built}">\n</head>`);

// Refuse before writing, so a failed build never leaves a broken artifact
// behind for someone to pick up and ship.
if (missing.length) {
  console.error(`\nBuild failed: ${missing.length} sprite(s) the interface can request are not in the bundle:`);
  for (const key of missing) console.error(`  - ${key}`);
  console.error('\nNothing was written.\n');
  process.exit(1);
}

fs.mkdirSync(pagesDir, { recursive: true });
fs.writeFileSync(outFile, page, 'utf8');
fs.writeFileSync(path.join(pagesDir, 'RotMG-Enchant-Calculator.html'), page, 'utf8');
// Without this GitHub Pages runs Jekyll over the folder, which ignores files
// and folders starting with an underscore and rewrites some content.
fs.writeFileSync(path.join(pagesDir, '.nojekyll'), '');

/* ---------------------------------------------------------------- *
 * 5. Report                                                         *
 * ---------------------------------------------------------------- */

const kb = bytes => `${(bytes / 1024).toFixed(0)} KB`;
console.log(`\nStandalone build -> ${path.relative(root, pagesDir)}/\n`);
for (const [folder, added] of Object.entries(counts)) console.log(`  ${String(added).padStart(3)} sprites  ${folder}`);
console.log(`\n  ${dataset.enchants.length} enchantments - ${dataset.artifacts.length} artifacts - ${dataset.awakenings.size} awakenable items`);
console.log(`  sprites ${kb(assetBytes)} raw -> ${kb(JSON.stringify(assets).length)} inlined`);
  console.log(`  items   ${Object.keys(itemSprites).length} sprites, ${kb(itemSpriteBytes)} raw -> ${kb(JSON.stringify(itemSprites).length)} inlined`);
console.log(`  realm   ${Object.keys(realmMonsterSprites).length} client sprites + ${Object.keys(realmCatalogSprites).length} imported sprites + ${Object.keys(realmMonsterAnimations).length} animated loops inlined`);
console.log(`  total   ${kb(fs.statSync(outFile).size)}`);
console.log('  every sprite the interface can request is embedded.');
console.log('  served as index.html, downloadable as RotMG-Enchant-Calculator.html\n');
