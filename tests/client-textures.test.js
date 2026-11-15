'use strict';
// R7 / ROT-B-09: a texture missing or not in raw pixels fails the extraction.
// Offline: the rule only; reading a real client needs the game.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { texturesProblem } = require('../tools/extract-client-textures.js');

assert.strictEqual(texturesProblem(new Set(), new Set()), '');
assert.match(texturesProblem(new Set(['characters_masks']), new Set()), /not found: characters_masks/);
assert.match(texturesProblem(new Set(), new Set(['groundTiles'])), /not raw RGBA32 pixels: groundTiles/);

// The extractor fails (exit 1) and writes no provenance when the rule finds a problem.
const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'extract-client-textures.js'), 'utf8');
const end = source.slice(source.indexOf('const problem = texturesProblem(missing, skipped);'));
assert.ok(end.indexOf('process.exitCode = 1') < end.indexOf('fs.writeFileSync(provenanceFile'), 'exit before the provenance is written');
assert.ok(source.includes('skipped.add(texture.name)'), 'a texture in another format is counted');

// A run limited to some textures ([name ...]) leaves the directory uncertified.
const { certifiesAll } = require('../tools/extract-client-textures.js');
assert.strictEqual(certifiesAll(new Set(['groundTiles', 'mapObjects', 'characters', 'characters_masks'])), true);
assert.strictEqual(certifiesAll(new Set(['groundTiles'])), false);
assert.ok(end.indexOf('if (!certifiesAll(names))') < end.indexOf('fs.writeFileSync(provenanceFile'), 'partial run returns before the provenance is written');

console.log('client textures: ok');
