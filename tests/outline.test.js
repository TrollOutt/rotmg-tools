'use strict';
/*
 * One black line round every character and creature, on every page.
 *
 * The rule is two fifteenths of a sprite pixel, never under one screen pixel
 * (web/outline.js). It lives in four places that cannot import each other - the
 * shared script, the Skin Viewer's shader module, the Atlas page, and the
 * filters on the pages' CSS pictures - so this test holds them to one number,
 * and holds every place that draws someone to the one way of laying it on.
 *
 * It also holds the line OUT of the pictures: a line baked into a sheet has one
 * thickness at every zoom, cannot be told from black art afterwards, and would
 * be drawn twice beside the one the pages lay on.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readPng } = require('../tools/png');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { console.error('FAIL: ' + message); process.exit(1); };
const assert = (ok, message) => { if (!ok) fail(message); };

/* ---------------- one number ---------------- */
const shared = require('../web/outline.js');
assert(shared.RATIO === 2 / 15, 'web/outline.js: the line is two fifteenths of a sprite pixel');
const rendererSource = read('web/skins/renderer.js');
const renderer = 'data:text/javascript;base64,' + Buffer.from(rendererSource).toString('base64');
const probe = `import { OUTLINE_RATIO, outlinePixels } from ${JSON.stringify(renderer)};
  console.log(JSON.stringify({ ratio: OUTLINE_RATIO, at: [1, 3, 4, 6, 8, 15, 30, 60].map(s => outlinePixels(s)) }));`;
const theirs = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', probe], { encoding: 'utf8' }));
assert(theirs.ratio === shared.RATIO, 'web/skins/renderer.js carries another ratio than web/outline.js');
[1, 3, 4, 6, 8, 15, 30, 60].forEach((scale, i) => {
  assert(Math.abs(theirs.at[i] - shared.spritePixels(scale)) < 1e-12,
    'the Skin Viewer\'s line and web/outline.js\'s differ at ' + scale + ' screen pixels to a sprite pixel');
});
// A line is never thinner than a screen pixel, and is two fifteenths once that is more than one.
assert(shared.screenPixels(3) === 1 && shared.screenPixels(8) === 1 && shared.screenPixels(30) === 4 && shared.screenPixels(60) === 8,
  'whole-pixel widths: 1 up to 11 screen pixels to a sprite pixel, then two fifteenths of it');
for (const file of ['tools/atlas-viewer.html', 'web/assets/atlas/index.html']) {
  const page = read(file);
  assert(/const INK_RATIO = 2 \/ 15;/.test(page), file + ': the Atlas carries another ratio than web/outline.js');
  assert(/const inkPixels = scale => Math\.max\(1, Math\.round\(INK_RATIO \* Math\.max\(scale, 1e-6\)\)\);/.test(page),
    file + ': the Atlas rounds the line another way than web/outline.js');
}
assert(read('web/assets/atlas/index.html').includes('drawInked(img, frame * tile, 0, tile, height'),
  'web/assets/atlas/index.html is not built from tools/atlas-viewer.html: node tools/realm-atlas-build.js --page-only --publish');

/* ---------------- every place that draws someone lays the line on ---------------- */
const skinsApp = read('web/skins/app.js');
assert(/function fitDraw\(ctx,img,rect,size,inked=false\)/.test(skinsApp) && skinsApp.includes('window.RealmOutline.draw(ctx,img,rect.x'),
  'the Skin Viewer\'s thumbnails must lay the line on through RealmOutline.draw');
assert(skinsApp.includes("return makeThumb(f?{sheet:f.atlas,rect:f.rect}:null,size,'',true)}")
  && skinsApp.includes("return makeThumb(c?.icon,size,'class-thumb',true)}")
  && skinsApp.includes('fitDraw(c.getContext(\'2d\'),img,frame.rect,size,true)'),
'a skin\'s thumbnail, a class\'s and a favourite\'s are someone: they are drawn inked');
assert(!/makeThumb\(d\.icon,size,'dye-effect dye-item-icon'(,true)/.test(skinsApp), 'a dye\'s icon is an item, not someone');

const fiches = read('web/fiches-c.js');
assert(!/pen\.drawImage\(\s*skins,/.test(fiches) && !/pen\.drawImage\(theory, classPic/.test(fiches)
  && /RealmOutline\.draw\(pen, skins,/.test(fiches) && /RealmOutline\.draw\(pen, theory, classPic/.test(fiches)
  && /RealmOutline\.draw\(\s*pen,\s*sheet,/.test(fiches),
'the fiche\'s shooter, class and skin canvases lay the line on through RealmOutline.draw');
assert(fiches.includes("r.kind === 'skin' || r.kind === 'class' || r.kind === 'enemy'"),
  'the fiche\'s pictures of skins, classes and creatures wear the line by kind');

const theory = read('web/theorycraft.js');
assert(/function put\(pen, img, sx, sy, sw, sh, dx, dy, dw, dh, inked\)/.test(theory)
  && theory.includes('drawPiece(pen, bolt, frame, -wide / 2, high / 2, high, false, false)'),
'the duel draws the class and the target inked and a bolt bare');
assert(theory.includes('face.style.filter = window.RealmOutline.filter(portrait.zoom)')
  && theory.includes("' style=\"' + inkOf(zoom) + 'width:' + fit.width"),
'the class portrait and the target icons wear the line');

for (const file of ['web/index-browse.js', 'web/index-page.js']) {
  assert(read(file).includes("one.kind === 'skin' || one.kind === 'class' || one.kind === 'enemy'")
    || read(file).includes("r.kind === 'skin' || r.kind === 'class' || r.kind === 'enemy'"),
  file + ': pictures of skins, classes and creatures wear the line by kind');
}
assert(read('web/whats-new.js').includes("t.__kind === 'Creature'") && read('web/whats-new.js').includes("facts.class === 'Skin'"),
  'What\'s New: a skin and a creature wear the line');

const atlas = read('tools/atlas-viewer.html');
assert(/if \(inked\) drawInked\(img, frame \* tile, 0, tile, height/.test(atlas)
  && /if \(inked\) drawInked\(img, frame \* sprite\.tile, 0, sprite\.tile, sprite\.height/.test(atlas)
  && atlas.includes('const inked = !sprite.combat;'),
'the Atlas draws every creature but a combat picture (which arrives with its line) through drawInked');
assert(atlas.includes('drawInked(held.img, held.box.x, held.box.y, held.box.w, held.box.h,'),
  'the Atlas draws a landmark\'s boss inked');
assert((atlas.match(/filter:url\(#ink-1\)/g) || []).length >= 2, 'the Atlas\'s panel pictures of creatures wear the line');

const index = read('web/index.html');
assert(/<script src="outline\.js"><\/script>/.test(index) && index.indexOf('outline.js') < index.indexOf('engine.js'),
  'outline.js must load before the pages that draw with it');
assert(read('tools/build-standalone.js').includes('outlineSource'), 'the standalone build must carry outline.js');

/* ---------------- no line in the pictures ---------------- */
{
  /*
   * A creature's own strip, with a line baked in, has flat black on every pixel
   * of its edge. Bare, only the art's own black is there: well under a fifth of
   * an edge over the whole set (a sprite drawn mostly in black has more of its own).
   */
  const dir = path.join(root, 'web/assets/atlas/life');
  let edge = 0, black = 0;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.png'))) {
    const { width: w, height: h, pixels: p } = readPng(fs.readFileSync(path.join(dir, name)));
    const clear = (x, y) => x < 0 || y < 0 || x >= w || y >= h || p[(y * w + x) * 4 + 3] === 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] < 200 || !(clear(x - 1, y) || clear(x + 1, y) || clear(x, y - 1) || clear(x, y + 1))) continue;
      edge++;
      if (p[i] + p[i + 1] + p[i + 2] < 12) black++;
    }
  }
  assert(edge > 0, 'no creature strips found in web/assets/atlas/life');
  assert(black / edge < 0.2, 'the creatures\' files carry a baked line (' + Math.round(100 * black / edge)
    + '% of their edges are flat black): the page draws it - node tools/recover-life.js --write');
  assert(read('tools/refine-outline.js').includes('const out = bared(readPng(readFile(file)));'),
    'tools/refine-outline.js must leave the creatures bare');
}

console.log('Outline: one rule (two fifteenths of a sprite pixel, one screen pixel at least) in the shared script, the Skin Viewer, the Atlas and the page filters; every place that draws someone lays it on; no creature file carries a line.');
