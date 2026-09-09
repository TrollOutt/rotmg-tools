'use strict';
// A compact runtime projection of the index. Source extraction belongs to
// build-index; this command also works in a clone with no installed game.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const out = { ...require('./provenance').stamp(__filename, index.from, index.built),
  ...require('./index-model').project(index, true) };
if (index.theorySheet) out.sheet = index.theorySheet;
const file = path.join(root, 'data/TheoryCraft/theorycraft.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log(`${out.items.length} items projected from index build ${index.from.build}`);
