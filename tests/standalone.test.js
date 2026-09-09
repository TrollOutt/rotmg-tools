'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), vm = require('vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function bundle(file) {
  const html = read(file);
  const match = /<script>window\.ROTMG_BUNDLE=([\s\S]*?);<\/script>/.exec(html);
  assert(match, file + ': no embedded bundle');
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    new vm.Script(script[1]); // Compile only; do not run a browser or contact a service.
  }
  return { html, data: JSON.parse(match[1]) };
}
const served = bundle('docs/index.html'), offline = bundle('docs/Realm-Tools.html');
for (const name of ['indexText', 'wikiText', 'theoryText']) {
  assert(!served.data.sources[name], name + ' must not increase calculator startup');
  assert(offline.data.sources[name], name + ' missing from the downloadable copy');
}
const index = read('data/Index/index.json').replace(/\r\n/g, '\n');
const theory = read('data/TheoryCraft/theorycraft.json').replace(/\r\n/g, '\n');
assert.equal(offline.data.sources.indexText.trim(), index.trim());
assert.equal(offline.data.sources.theoryText.trim(), theory.trim());
assert.equal(read('docs/assets/theory/theorycraft.json').trim(), theory.trim());
assert(offline.data.theorySheet.startsWith('data:image/png;base64,'));
assert(offline.data.indexSheet.startsWith('data:image/png;base64,'));
assert(Buffer.byteLength(served.html) <= 5256587, 'Calculator startup exceeds the measured pre-migration size');
console.log('Built scripts compile; download embeds index, theory, wiki and sheets; served startup stays below baseline.');
