'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/index.json'), 'utf8'));
const file = process.argv[2] || 'data/TheoryCraft/theorycraft.json';
const theory = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
assert.deepEqual(index.from, theory.from, 'Compare only files from the same client');
const projected = require('./index-model').project(index, true);
let compared = 0;
const off = [];
for (const group of Object.keys(projected)) {
  if (projected[group].length !== theory[group].length) off.push(`${group}: ${projected[group].length} versus ${theory[group].length} records`);
  for (let i = 0; i < projected[group].length; i++) {
    const ours = projected[group][i], theirs = theory[group][i];
    const a = { ...ours }, b = { ...theirs };
    try { assert.deepEqual(a, b); } catch { off.push(`${group}/${ours.id || ours.name}: ${JSON.stringify(a)} versus ${JSON.stringify(b)}`); }
    compared++;
  }
}
assert.equal(index.records.filter(r => r.kind === 'item' && r.bench).length, projected.items.length);
for (const r of index.records.filter(r => r.kind === 'item' && !r.bench)) {
  assert(r.hidden?.length || r.benchWhy, r.id + ': no explanation for bench exclusion');
}
assert.deepEqual(theory.sheet, index.theorySheet, 'Theory artwork must come from the index');
assert.deepEqual(theory.iconSheet, index.sheet, 'Item pictures must come from the index sheet');

/*
 * Every module draws an item from the index's sheet, so an item the index has
 * a picture of must arrive at every module with it. This is the check that was
 * missing: fifty items came back to the bench without their artwork following,
 * and nothing said so until somebody opened the page and saw an empty square.
 */
const art = JSON.parse(fs.readFileSync(path.join(root, 'data/Index/item-art.json'), 'utf8'));
assert.deepEqual(art.from, index.from, 'Compare only files from the same client');
assert.deepEqual(art.sheet, index.sheet, 'Item pictures must come from the index sheet');
const noIcon = projected.items.filter(one => !one.icon);
assert.equal(noIcon.length, 0, noIcon.length + ' bench items have no picture: '
  + noIcon.slice(0, 5).map(one => one.name).join(', '));
const enchantable = fs.readFileSync(path.join(root, 'data/Items/client-items.txt'), 'utf8')
  .split(/\n/).filter(line => line.startsWith('item|')).map(line => line.split('|')[1]);
const unpictured = enchantable.filter(name => !art.art[name]);
assert.equal(unpictured.length, 0,
  unpictured.length + ' enchantable items have no picture: ' + unpictured.slice(0, 6).join(', '));
/*
 * And that nobody hops backwards when they swing.
 *
 * A character's attack frame is wider than the character: seventeen of the
 * nineteen classes draw an eight-pixel body standing still and a sixteen-
 * pixel rectangle when they swing, the body still eight wide at the left of
 * it and the weapon reaching out to the right. Centre that rectangle in its
 * cell, which is the obvious thing to do and what this sheet used to do, and
 * the body sits four pixels further back on the swing than at rest - so the
 * figure hops backwards on every shot while nothing about it has moved.
 *
 * The layout is the fix (tools/spritesheet.js states the rule), and this is
 * what says if it ever comes undone: in a run that reaches forward, the
 * drawing must begin in the same column in every frame of it.
 */
{
  const { readPng } = require('./png');
  const sheet = readPng(fs.readFileSync(path.join(root, 'web/assets/theory/sheet.png')));
  const firstColumn = (pic, slot) => {
    const x0 = pic.x + slot * pic.w;
    for (let x = 0; x < pic.w; x++) {
      for (let y = 0; y < pic.h; y++) {
        if (sheet.pixels[((pic.y + y) * sheet.width + x0 + x) * 4 + 3] > 8) return x;
      }
    }
    return -1;
  };
  /*
   * A pixel or two is the drawing, not the layout.
   *
   * Some front-facing swings begin one column further in than the same
   * character standing still, because that is how they were drawn. What this
   * is looking for is the layout fault, which moves the body by half the
   * difference in width - four pixels on a class, and more on anything
   * wider. Two is comfortably above the art and far below that.
   */
  const ART = 2;
  let watched = 0, worst = 0;
  const wandering = [];
  for (const [key, pic] of Object.entries(theory.sheet.pics)) {
    if (!key.startsWith('c:') || !pic.poses) continue;
    /* Where the body starts at rest, and where it starts mid-swing. */
    for (const facing of new Set(Object.keys(pic.poses).map(at => at.split('/')[0]))) {
      const still = (pic.poses[facing + '/0'] || [])[0];
      const swings = pic.poses[facing + '/2'] || [];
      if (still === undefined || !swings.length) continue;
      const rest = firstColumn(pic, still);
      if (rest < 0) continue;
      watched++;
      for (const slot of swings) {
        const mid = firstColumn(pic, slot);
        if (mid < 0) continue;
        const moved = Math.abs(mid - rest);
        if (moved > worst) worst = moved;
        if (moved > ART) {
          wandering.push(key + ' facing ' + facing + ': stands at column ' + rest
            + ' and swings from column ' + mid + ', ' + moved + ' across');
        }
      }
    }
  }
  assert(watched > 30, 'the classes must have a resting pose and a swing to compare');
  assert.equal(wandering.length, 0, wandering.length
    + ' class pose(s) move sideways between standing and swinging:\n  '
    + wandering.slice(0, 6).join('\n  '));
  console.log(watched + ' class poses keep the body still between standing and swinging'
    + ' (worst drift ' + worst + 'px, the art itself)');
}

console.log(`${projected.items.length} bench items and all ${enchantable.length} `
  + 'enchantable items draw from the index sheet');
console.log(`${compared} index/theory records compared; ${off.length} disagreements`);
for (const line of off.slice(0, 8)) console.error(line);
process.exitCode = off.length ? 1 : 0;
