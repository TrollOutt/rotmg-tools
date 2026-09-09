'use strict';
// Build-time projection; the browser keeps its existing compact text file.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const provenance = require('./provenance');
const meta = provenance.stamp(__filename, index.from, index.built);
const OUT = path.join(root, 'data', 'Artifacts', 'client-artifacts.txt');
const sorted = index.catalogues.artifacts.artifacts;
const pools = new Map(Object.entries(index.catalogues.artifacts.pools));
const lines = [
  '## Every artifact an installed RotMG client defines, and the rules of the',
  '## pool each one draws from.',
  '##',
  '## Written by tools/generate-artifacts.js. Do not edit by hand: run the',
  '## generator again after a game update and diff the result.',
  '##',
  '## artifact|name|pool|dustType|dustAmount|consumeProb|labels|description',
  '##   entry|includeLabelsOR|excludeLabelsOR      which enchantments the pool holds',
  '##   entry-name|<enchantment>                   one added by name',
  '##   weight|includeLabelsOR|excludeLabelsOR|mult=x or increment=n',
  '##   weight-name|<enchantment>|mult=x or increment=n',
  '##',
  '## Weight rules compound: each multiplies what the last one left.',
  ''
];

/*
 * Four of the 54 are not artifacts a player uses in the enchanter, and the
 * client says which: an artifact carries the ARTIFACT item label. Three are
 * developer test items — Awakened, Tier 4 and Unique Test Artifact — and the
 * fourth is Night Prince Engraving, whose own description says it "can be used
 * as an Artifact" but which the game does not label as one.
 *
 * All four cost nothing and are never consumed, so ranking them puts a free,
 * strictly better artifact at the top of every table. Night Prince also carries
 * a x999 on UNIQUE and a x9999 on AWAKENED, which made it the answer to every
 * question a player could ask.
 */
let ruleCount = 0;
let unknown = 0;
for (const artifact of sorted) {
  lines.push(['artifact', artifact.name, artifact.pool, artifact.dustType,
    artifact.dustAmount, artifact.consumeProb, artifact.labels.join(','), artifact.description].join('|'));
  for (const rule of pools.get(artifact.pool) || []) {
    lines.push('  ' + rule);
    ruleCount++;
    if (rule.startsWith('unknown|')) unknown++;
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, provenance.header(meta) + lines.join('\n') + '\n', 'utf8');
console.log('Projected artifacts from index build ' + index.from.build);
