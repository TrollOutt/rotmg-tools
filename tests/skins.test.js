/*
 * The Skin Viewer's two halves, and that they still meet.
 *
 * What a skin is called, whose class it is, which costume it belongs to and
 * what unlocks it are facts about a thing and live on its index record.
 * Where each of its frames sits is geometry and lives beside it. The viewer
 * joins them on the client's own type, and nothing else holds that join
 * together - so if a generator changes shape, this is what says so.
 *
 * It used to be one eighteen-megabyte catalogue that nothing could rebuild,
 * with a bridge of name matches back to the index.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = where => JSON.parse(fs.readFileSync(path.join(root, where), 'utf8'));
const generated = 'web/assets/skins/generated/';

const index = read('data/Index/index.json');
const catalogue = read(generated + 'skins.json');
const dyeCatalogue = read(generated + 'dyes.json');
const classCatalogue = read(generated + 'classes.json');
const looks = read(generated + 'looks.json');

const records = new Map(index.records.map(one => [one.id, one]));
const typeOf = one => (one.from && one.from[1]) || '';

/* ---------------- the live silhouette outline ---------------- */
{
  /* This is deliberately pure: it is the same cardinal-neighbour rule the
     renderer's shader applies to alpha, without requiring WebGL in CI. */
  const rendererSource = fs.readFileSync(path.join(root, 'web/skins/renderer.js'), 'utf8');
  const renderer = 'data:text/javascript;base64,' + Buffer.from(rendererSource).toString('base64');
  const check = `import { OUTLINE_RATIO, outlinePixels, isOutlinePixel, quadAt, frameTexel } from ${JSON.stringify(renderer)};
    if(OUTLINE_RATIO!==2/15)throw Error('the outline is two fifteenths of a sprite pixel, as the original viewer draws it');
    if(outlinePixels(30)!==2/15||outlinePixels(8)!==2/15)throw Error('a large character keeps the proportional outline');
    if(outlinePixels(6)!==1/6||outlinePixels(3)!==1/3)throw Error('a small character keeps an outline of at least one screen pixel');
    if(outlinePixels(8)*8>1.07)throw Error('the outline must stay about one screen pixel at the default zoom');
    if([isOutlinePixel(0,1,0,0,0),isOutlinePixel(0,0,1,0,0),isOutlinePixel(0,0,0,1,0),isOutlinePixel(0,0,0,0,1)].some(value=>!value))throw Error('each cardinal neighbour outlines');
    if(isOutlinePixel(0,0,0,0,0)||isOutlinePixel(1,1,1,1,1))throw Error('clear-only rule');
    const plain=quadAt({w:8,h:8},100,100,50,60,4),outlined=quadAt({w:8,h:8},100,100,50,60,4,outlinePixels(4));
    const band=outlinePixels(4)*4/100*2,originalEdges=[plain[0],plain[2],plain[5],plain[1]],outlinedEdges=[outlined[0]+band,outlined[2]-band,outlined[5]-band,outlined[1]+band];
    if(!outlinedEdges.every((value,index)=>Math.abs(value-originalEdges[index])<1e-9))throw Error('outline quad keeps source position anchored');
    const rect={x:19,y:23,w:3,h:2};
    for(const [local,expected] of [[{x:0,y:0},{x:19,y:23}],[{x:2.99,y:1.99},{x:21,y:24}]]){const got=frameTexel(rect,local);if(got.x!==expected.x||got.y!==expected.y)throw Error('frame texel escaped its source rectangle');}
    if(frameTexel(rect,{x:-.01,y:0})||frameTexel(rect,{x:3,y:0})||frameTexel(rect,{x:0,y:2}))throw Error('a frame sampled its packed neighbour');
    const outlineFor=(rows,x,y)=>{const h=rows.length,w=rows[0].length,alphaAt=(px,py)=>px>=0&&py>=0&&px<w&&py<h&&rows[Math.floor(py)][Math.floor(px)]==='1'?1:0;return isOutlinePixel(alphaAt(x,y),alphaAt(x-.5,y),alphaAt(x+.5,y),alphaAt(x,y-.5),alphaAt(x,y+.5));};
    const expectOutline=(rows,yes,no,label)=>{if(!yes.every(([x,y])=>outlineFor(rows,x,y)))throw Error(label+' missed a cardinal outline');if(!no.every(([x,y])=>!outlineFor(rows,x,y)))throw Error(label+' drew a non-cardinal outline');};
    expectOutline(['000','010','000'],[[.75,1.25],[2.25,1.25],[1.25,.75],[1.25,2.25]],[[1.25,1.25],[.75,.75]],'isolated pixel');
    expectOutline(['000','010','010','000'],[[.75,1.25],[.75,2.25],[2.25,1.25],[2.25,2.25],[1.25,.75],[1.25,3.25]],[[1.25,1.25],[1.25,2.25],[.75,.75]],'vertical run');
    expectOutline(['0000','0110','0000'],[[.75,1.25],[3.25,1.25],[1.25,.75],[2.25,.75],[1.25,2.25],[2.25,2.25]],[[1.25,1.25],[2.25,1.25],[.75,.75]],'horizontal run');
    expectOutline(['0000','0100','0010','0000'],[[1.25,.75],[.75,1.25]],[[.75,.75],[1.25,1.25],[2.25,2.25]],'diagonal pair');
    expectOutline(['111','101','111'],[[1.25,1.25]],[[.25,.25],[1.25,.75],[.75,.75]],'hole');
    expectOutline(['11','11'],[[ -.25,.25],[2.25,.25],[.25,-.25],[.25,2.25]],[[ -.75,.25],[.25,-.75],[-.25,-.25]],'frame boundary');
    const alphaAt=local=>frameTexel(rect,local)?1:0,outlineAt=local=>isOutlinePixel(alphaAt(local),alphaAt({x:local.x-.5,y:local.y}),alphaAt({x:local.x+.5,y:local.y}),alphaAt({x:local.x,y:local.y-.5}),alphaAt({x:local.x,y:local.y+.5}));
    if(outlineAt({x:1.25,y:.75}))throw Error('an opaque frame centre cannot become outline');
    if(![{x:-.25,y:.75},{x:3.25,y:.75},{x:1.25,y:-.25},{x:1.25,y:2.25}].every(outlineAt))throw Error('each half-texel frame edge must receive its cardinal outline');
    if(outlineAt({x:-.25,y:-.25}))throw Error('a diagonal outside a frame cannot become outline');`;
  execFileSync(process.execPath, ['--input-type=module', '--eval', check], { stdio: 'pipe' });
  assert(rendererSource.includes('local+vec2(-ol,0.)') && rendererSource.includes('local+vec2(ol,0.)')
    && rendererSource.includes('local+vec2(0.,-ol)') && rendererSource.includes('local+vec2(0.,ol)'),
  'the shader must use cardinal neighbours, not diagonal or rectangular borders');
  assert(rendererSource.includes('if(any(lessThan(local,vec2(0.)))||any(greaterThanEqual(local,r.zw)))return vec4(0.);'),
    'out-of-frame samples must be transparent so packed frames cannot bleed');
  assert(rendererSource.includes('floor(local)+vec2(.5)'),
    'WebGL must sample the centre of an integer source texel');
  assert(rendererSource.includes('baseRect.zw+vec2(2.*ol))-vec2(ol)'),
    'the UV mapping must expose only the outline band, as wide as the probes reach');
  assert(rendererSource.includes('vec2 q=5.*local*baseRect.zw/max(r.zw,vec2(1.));'),
    'a cloth is laid down five cloth pixels to a sprite pixel, as the original viewer reads it');
  assert(rendererSource.includes('if(m.a<=.003)m=vec4(0.);'),
    'a mask pixel that is clear carries no dye, whatever colour the client left under it');
}

/* ---------------- the guessed bridge is gone ---------------- */
assert(!fs.existsSync(path.join(root, generated, 'index-links.json')),
  'the name-matched index bridge must not come back: the index states the joins');

/* ---------------- the catalogue is the index ---------------- */
const skinRecords = index.records.filter(one => one.kind === 'skin');
assert.equal(catalogue.skins.length, skinRecords.length,
  'every skin the index declares must be offered to the viewer');

for (const one of catalogue.skins) {
  const record = records.get(one.id);
  assert(record && record.kind === 'skin', one.id + ' is not a skin in the index');
  assert.equal(one.type, typeOf(record), one.id + ' must carry the client type it is keyed by');
  assert.equal(one.name, record.name);
  assert.equal(one.look, record.look || undefined,
    one.id + ': the costume must be the index’s, not worked out twice');
  /* Every join is the client's, carried through the index rather than matched. */
  const worn = (record.out || []).find(([how]) => how === 'worn by');
  assert.equal(one.wears, worn ? records.get(worn[1]).name : undefined);
  const mine = how => (record.in || []).filter(([said]) => said === how).map(([, from]) => from);
  assert.deepEqual(one.unlockers || [], mine('unlocks'),
    one.id + ': every thing that hands it over, not whichever was read last');
  assert.deepEqual(one.sets || [], mine('dresses you as'));
  for (const to of [...(one.unlockers || []), ...(one.sets || [])]) {
    assert(records.has(to), one.id + ' names ' + to + ', which the index does not hold');
  }
}

const dyeRecords = index.records.filter(one => one.family === 'dye' && !one.folded);
assert.equal(dyeCatalogue.dyes.length, dyeRecords.length, 'every dye the index holds must be offered');
assert.equal(classCatalogue.classes.length, 19, 'the nineteen classes');

/* ---------------- the geometry meets it ---------------- */
const sheet = looks.sheet;
assert(sheet && sheet.wide > 0 && sheet.tall > 0, 'the geometry must name the sheet it packed');
const png = path.join(root, 'web/assets/skins/textures', sheet.file);
assert(fs.existsSync(png), 'the packed sheet must exist at ' + sheet.file);
{
  const bytes = fs.readFileSync(png);
  assert.equal(bytes.readUInt32BE(16), sheet.wide, 'the sheet is not the width the geometry claims');
  assert.equal(bytes.readUInt32BE(20), sheet.tall, 'the sheet is not the height the geometry claims');
}
for (const name of ['characters.png', 'characters_masks.png', 'mapObjects.png']) {
  assert(!fs.existsSync(path.join(root, 'web/assets/skins/textures', name)),
    name + ' must not come back: thirty-seven megabytes of it to draw characters');
}

let frames = 0, withGeometry = 0;
for (const one of catalogue.skins) {
  const drawn = looks.skins[one.type];
  if (!drawn) continue;                    // the client declares some it does not hold
  withGeometry++;
  for (const row of drawn.frames) {
    frames++;
    assert.equal(row.length, looks.row.length, one.id + ': a frame row of the wrong width');
    const [set, action, direction, x, y, w, h, maskX, maskY] = row;
    assert(Number.isInteger(set) && set >= 0, one.id + ': an animation set must be a number');
    assert(Number.isInteger(action) && Number.isInteger(direction)
      && Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(w) && Number.isInteger(h),
    one.id + ': source rectangles must be integer texel coordinates');
    assert(w > 0 && h > 0, one.id + ': a frame with no size');
    assert(x >= 0 && y >= 0 && x + w <= sheet.wide && y + h <= sheet.tall,
      one.id + ': a frame that falls off the packed sheet');
    if (maskX >= 0) {
      assert(maskX + w <= sheet.wide && maskY + h <= sheet.tall,
        one.id + ': a dye mask that falls off the packed sheet');
    }
  }
}
assert(withGeometry > 1400, 'nearly every skin must have its frames');
assert(frames > 28000, 'every frame of every animation');

for (const one of dyeCatalogue.dyes) {
  const made = looks.dyes[one.type];
  if (!made) continue;
  assert(['color', 'cloth', 'remove'].includes(made.kind), one.id + ': unknown dye kind');
  assert(['clothing', 'accessory'].includes(made.on), one.id + ': a dye goes on one of two things');
  if (made.kind === 'color') assert(/^#[0-9a-f]{6}$/.test(made.color), one.id + ': a colour must be a colour');
  if (made.kind === 'cloth') {
    const r = made.cloth.rect;
    assert(r.w > 0 && r.h > 0 && r.x + r.w <= sheet.wide && r.y + r.h <= sheet.tall,
      one.id + ': its cloth falls off the packed sheet');
  }
  if (made.moves) {
    assert(['horizontal', 'vertical', 'spinning'].includes(made.moves.how),
      one.id + ': cloth moves one of three ways');
  }
}

/*
 * Both halves were read from the same client. If a scrape ever writes one and
 * not the other, the viewer would join a new catalogue to old rectangles.
 */
assert.equal(looks.from.build, index.from.build,
  'the geometry and the index must come from one client build');
assert.equal(catalogue.from.build, index.from.build,
  'the catalogue and the index must come from one client build');


/*
 * Which way is the front.
 *
 * The client numbers a character's facings 0 side, 2 away and 3 towards you,
 * and the catalogue this replaced had the last two the wrong way round. That
 * one mistake opened every skin showing its back and made walking up and down
 * the screen turn the character the wrong way out.
 *
 * Two things settle it and they must keep agreeing. Drawn large, direction 2
 * has no eyes on it and direction 3 has two. And tools/index-sprites.js has
 * been picking "standing, facing the reader" out of the same registry since
 * long before any of this, by asking for direction 3 - so if that ever ranks a
 * different facing best, or this table renames one, they have drifted apart
 * and somebody is about to ship a page full of backs.
 */
const registry = require(path.join(root, 'tools/spritesheet.js'));
assert.equal(registry.DIRECTION[registry.FRONT], 'front');
assert.equal(registry.DIRECTION[registry.BACK], 'back');
assert.equal(registry.FRONT, 3, 'three is the face');
assert.equal(registry.BACK, 2, 'two is the back');
/* JSON has no `undefined`, so the unused slot arrives as null. */
assert.deepEqual(looks.directions.map(one => one || undefined), registry.DIRECTION,
  'the published geometry must carry the same table the reader uses');

const spriteSource = fs.readFileSync(path.join(root, 'tools/index-sprites.js'), 'utf8');
assert(/one\.direction === 3 \? 0/.test(spriteSource),
  'index-sprites must still rank direction 3 as the one facing the reader');

const viewerSource = fs.readFileSync(path.join(root, 'web/skins/app.js'), 'utf8');
assert(viewerSource.includes('ctx.drawImage(img,rect.x,rect.y,rect.w,rect.h,'),
  'list thumbnails must continue to use their exact source rectangle');
assert(/FACE_AWAY=2,FACE_YOU=3/.test(viewerSource),
  'the viewer must name the facings the way the client numbers them');
assert(/dy<0\?FACE_AWAY:FACE_YOU/.test(viewerSource),
  'aiming up must show the back: up the screen is away from you');
assert(/y<0\?FACE_AWAY:FACE_YOU/.test(viewerSource),
  'walking up must show the back: up the screen is away from you');

/* And a skin opens on its face, which is what the ranking is for. */
{
  const front = [], back = [];
  for (const one of catalogue.skins.slice(0, 400)) {
    const drawn = looks.skins[one.type];
    if (!drawn) continue;
    const idle = d => drawn.frames.find(row => row[1] === 0 && row[2] === d);
    if (idle(registry.FRONT)) front.push(one.name);
    if (idle(registry.BACK)) back.push(one.name);
  }
  assert(front.length > 300, 'a skin standing still must have a frame facing the reader');
  assert(back.length > 300, 'and one facing away');
}


/*
 * The viewer is not offered what it cannot draw.
 *
 * Nineteen skins - every 2-Bit class - are declared with an <AnimatedTexture>
 * the client's own sprite registry has no entry for. They belong in the index,
 * which records what the game declares; they were nineteen blank rows in the
 * viewer that opened onto "missing sprite frame".
 *
 * The index's `art` is the same nineteen, so the projection carries it as
 * `drawn` and both the list and the door into it go by that.
 */
{
  const drawable = catalogue.skins.filter(one => one.drawn);
  const undrawable = catalogue.skins.filter(one => !one.drawn);
  assert.equal(drawable.length + undrawable.length, catalogue.skins.length);
  /* The client's registry of 2026-09-09 draws the 2-Bit classes too, so none may be left - but never most. */
  assert(undrawable.length < 40, 'at most a handful of skins have no picture, never most');
  for (const one of drawable) {
    assert(looks.skins[one.type], one.id + ' is offered but has no frames');
  }
  for (const one of undrawable) {
    assert(!looks.skins[one.type], one.id + ' has frames but is marked undrawable');
    assert(!records.get(one.id).art, one.id + ': the index and the projection disagree');
  }
  const pageSource = fs.readFileSync(path.join(root, 'web/index-page.js'), 'utf8');
  assert(/if \(!one\.drawn\) continue;/.test(pageSource),
    'the index must not offer a door into a skin the viewer does not list');
  const viewer = fs.readFileSync(path.join(root, 'web/skins/app.js'), 'utf8');
  assert(/skinCatalogue\.skins\.filter\(one=>looks\.skins\[one\.type\]\)/.test(viewer),
    'the viewer must list only what it has frames for');
}

/*
 * The reworked browser gives the catalogue room instead of permanently
 * stacking both ways of filtering it.
 */
{
  const markup = fs.readFileSync(path.join(root, 'web/skins/view.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  assert(markup.includes('data-skin-filter-mode="class"')
    && markup.includes('data-skin-filter-mode="family"'),
  'the skin browser must explicitly choose Class or Family');

  assert(viewerSource.includes("skinViewerSkinFilterMode")
    && viewerSource.includes("function setSkinFilterMode(mode)"),
  'the chosen skin browsing mode must be stateful');

  assert(markup.includes('id="dyeSlots" class="dye-target-switch"')
    && viewerSource.includes("className='dye-target-tab'"),
  'Clothing and Accessory must be explicit alternate dye targets');

  assert(style.includes('#skins.browse-grid')
    && style.includes('#dyeList.browse-grid'),
  'skins and dyes must keep the gallery layout that gives choices more room');
}

/*
 * Rework V2: browse choices collapse after selection, SET comes from the
 * client's actual equipment-set relation, and either browser can temporarily
 * borrow width from the sandbox.
 */
{
  const markup = fs.readFileSync(path.join(root, 'web/skins/view.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  const setSkins = catalogue.skins.filter(one =>
    Array.isArray(one.sets) && one.sets.length
  );

  assert(setSkins.length > 0,
    'the catalogue must contain skins granted by complete equipment sets');

  assert(viewerSource.includes("const SET_FAMILY='__set__'")
    && viewerSource.includes("familyDisplayName(name)")
    && viewerSource.includes("if(name===SET_FAMILY)return'SET'"),
  'SET must be a dedicated family backed by set relations');

  assert(viewerSource.includes('familyOpen:true')
    && viewerSource.includes('dyeCategoryOpen:true')
    && style.includes('.filter-choice-folded'),
  'Family and Dye Type choices must collapse after selection');

}

/*
 * Rework V3: Saved combos are a permanent shelf, not an alternate catalogue.
 */
{
  const markup = fs.readFileSync(path.join(root, 'web/skins/view.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  assert(!markup.includes('data-catalog-mode="favorites"')
    && !markup.includes('id="favoriteCount"'),
  'Saved combos must not replace the skin catalogue');

  assert(markup.includes('id="comboShelf"')
    && markup.includes('id="comboCount"')
    && /function\s+renderComboShelf\s*\(\s*\)/.test(viewerSource)
    && /function\s+renderCatalogueUI\s*\(\s*\)\s*\{\s*return\s+renderBrowseCatalogueUI\s*\(\s*\)\s*;?\s*\}/s.test(viewerSource),
  'saved combos must live in their own permanent shelf');

  }

/*
 * Expansion is sticky and explicit: only its own handle closes a browser.
 */
{
}

/*
 * Side browsers use the same interaction as Atlas: their shared boundary is
 * draggable, both widths are independent, and double-click restores default.
 */
{
  const markup = fs.readFileSync(path.join(root, 'web/skins/view.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  assert(markup.includes('id="skinResizeGrip"')
    && markup.includes('id="dyeResizeGrip"')
    && !markup.includes('id="expandSkins"')
    && !markup.includes('id="expandDyes"'),
  'skin and dye browsers must use draggable borders, not arrow buttons');

  assert(viewerSource.includes("bindPanelResize($('skinResizeGrip'),'skins',1)")
    && viewerSource.includes("bindPanelResize($('dyeResizeGrip'),'dyes',-1)")
    && viewerSource.includes('setPointerCapture(event.pointerId)')
    && viewerSource.includes("addEventListener('pointermove'")
    && viewerSource.includes("addEventListener('dblclick'"),
  'both browser boundaries must drag independently and reset on double-click');

  assert(viewerSource.includes('skinViewerSkinsPanelWidth')
    && viewerSource.includes('skinViewerDyesPanelWidth'),
  'chosen browser widths must survive a reload');

  assert(style.includes('.panel-resize-grip')
    && style.includes('cursor: col-resize')
    && style.includes('--skin-browser-width')
    && style.includes('--dye-browser-width'),
  'the resize boundary must expose the Atlas-style resize interaction');
}

/*
 * Saved combos are direct choices: clicking the card applies it. Selection is
 * visual only; Use / Current buttons are deliberately absent.
 */
{
  {
  const comboClickStart=viewerSource.indexOf(
    'function renderComboShelf(){'
  );

  const comboClickEnd=viewerSource.indexOf(
    '\nfunction renderFavoritesCatalogueUI(){',
    comboClickStart
  );

  const comboShelfSource=viewerSource.slice(
    comboClickStart,
    comboClickEnd
  );

  assert(
    comboClickStart>=0
      &&comboShelfSource.includes(
        "select.className='combo-saved-select'"
      )
      &&comboShelfSource.includes(
        'select.onclick=()=>{'
      )
      &&comboShelfSource.includes(
        'applyComboFavorite(fav);'
      ),
    'clicking a saved combo skin must apply that combo'
  );
}

  const comboStart = viewerSource.indexOf('function renderComboShelf(){');
  const comboEnd = viewerSource.indexOf('\nfunction renderFavoritesCatalogueUI(){', comboStart);
  const comboSource = viewerSource.slice(comboStart, comboEnd);

  assert(!comboSource.includes("textContent=active?'Current':'Use'")
    && !comboSource.includes("textContent='Use'")
    && !comboSource.includes("textContent='Current'"),
  'saved combos must not expose Use or Current buttons');
}

/*
 * Class and Family are independent browse memories.
 * Switching mode must not reset either to All; only the active mode filters.
 */
{
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  const modeStart = viewerSource.indexOf('function setSkinFilterMode(mode){');
  const modeEnd = viewerSource.indexOf(
    "\nfor(const button of root.querySelectorAll('[data-skin-filter-mode]'))",
    modeStart
  );
  const modeSource = viewerSource.slice(modeStart, modeEnd);

  assert(modeStart >= 0
    && !modeSource.includes("S.className=''")
    && !modeSource.includes("S.family=''"),
  'switching Class / Family must preserve the previous selection of each mode');

  const visibleStart = viewerSource.indexOf('function visibleSkins(){');
  const visibleEnd = viewerSource.indexOf(
    '\nfunction ensureVisibleSelection()',
    visibleStart
  );
  const visibleSource = viewerSource.slice(visibleStart, visibleEnd);

  assert(visibleSource.includes("if(S.skinFilterMode==='class')")
    && visibleSource.includes("if(!S.family)return true"),
  'only the active Class or Family browse mode may filter skins');

  assert(viewerSource.includes('const pool=skins;'),
  'Family counts must not be narrowed by an inactive remembered Class');

  assert(style.includes(
    'var(--skin-browser-width, clamp(260px, 28.5vw, 620px))'
  ) && style.includes(
    'var(--dye-browser-width, clamp(260px, 28.5vw, 620px))'
  ),
  'fullscreen default must give both catalogues roughly 29% of the viewer');

  assert(viewerSource.includes('skinViewerSkinsPanelWidthV2')
    && viewerSource.includes('skinViewerDyesPanelWidthV2'),
  'the new default widths must not be hidden by widths saved by the old prototype');
}

/*
 * Filter controls use full-width themed boxes. Dye Type always exposes All
 * when reopened and consumes the complete width of its rail.
 */
{
  const markup = fs.readFileSync(path.join(root, 'web/skins/view.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  assert(markup.includes('class="filter-box skin-browse-box"')
    && markup.includes('class="filter-box dye-target-box"')
    && markup.includes('class="filter-box dye-type-box"'),
  'browse filters must use the viewer theme box hierarchy');

  assert(viewerSource.includes("['all','All'")
    && viewerSource.includes("['colors','Colors'")
    && viewerSource.includes("['textiles','Textiles'")
    && viewerSource.includes("['animated','Animated'"),
  'reopening Dye Type must always expose All and every subtype');

  assert(style.includes(
    '.dye-type-box #dyeCategories:not(.is-folded)'
  ) && style.includes(
    'repeat(4, minmax(0, 1fr))'
  ),
  'Dye Type choices must use the complete available row');
}

/*
 * Opening a folded chooser means choosing again from All.
 */
{
  assert(viewerSource.includes("S.className='';")
    && viewerSource.includes("S.family='';")
    && viewerSource.includes("S.dyeCategory='all';"),
  'Change controls must return Class, Family and Dye Type to All');
}

/*
 * Catalogue rendering stays on the normal DOM path.
 *
 * Selecting a skin or dye must update state without rebuilding hundreds of
 * catalogue cards. Filter/search changes are what rebuild a catalogue.
 */
{
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  assert(!viewerSource.includes('renderVirtualGrid(')
    && !viewerSource.includes('renderProgressiveGrid(')
    && !viewerSource.includes('CATALOGUE_BATCH_SIZE'),
  'experimental virtual/progressive catalogue engines must stay out of the mount path');

  assert(viewerSource.includes('function syncSkinCatalogueSelection()')
    && viewerSource.includes('function syncDyeCatalogueSelection('),
  'skin and dye selection must update existing cards');

  const selectStart=viewerSource.indexOf('function select(s){');
  const selectEnd=viewerSource.indexOf('\nfunction current(){',selectStart);
  const selectSource=viewerSource.slice(selectStart,selectEnd);

  assert(selectSource.includes('syncSkinCatalogueSelection()')
    && !selectSource.includes('renderCatalogueUI()'),
  'selecting one skin must not rebuild the complete skin catalogue');

  assert(
  /renderCatalogueWindow\s*\(\s*\$\(['"]skins['"]\)/s.test(viewerSource)
    && /renderCatalogueWindow\s*\(\s*\$\(['"]dyeList['"]\)/s.test(viewerSource),
  'both catalogues must use the capped windowed DOM rendering path'
);

  assert(
  !style.includes('content-visibility: auto')
    && /#skins\s*,\s*#dyeList\s*\{\s*contain\s*:\s*layout\s*;\s*\}/s.test(style),
  'catalogues should use one layout containment boundary per list'
);
}

/*
 * Clothing and Accessory can be cleared directly from Index · Selected.
 */
{
  const style = fs.readFileSync(path.join(root, 'web/skins/style.css'), 'utf8');

  const selectedStart = viewerSource.indexOf('function v314SelectedCard(');
  const selectedEnd = viewerSource.indexOf(
    '\nfunction renderSelectedIndexPanel()',
    selectedStart
  );
  const selectedSource = viewerSource.slice(selectedStart, selectedEnd);

  assert(selectedSource.includes(
      "if(kind==='clothing'||kind==='accessory')"
    )
    && selectedSource.includes("S.dyes[kind]=null")
    && selectedSource.includes("remove.className='chosen-remove'")
    && selectedSource.includes("remove.textContent='Remove'"),
  'Index selected Clothing and Accessory cards must expose Remove');

  assert(selectedSource.includes('renderDyeSlots?.()')
    && selectedSource.includes('syncDyeCatalogueSelection?.()')
    && selectedSource.includes('renderComboShelf?.()'),
  'removing a selected dye must update the viewer state without rebuilding the catalogue');

  assert(style.includes('.chosen-remove'),
  'the selected dye remove action must use the viewer theme');
}

/*
 * PERF V3: large catalogues are appended in stable groups of 96.
 *
 * Cards already on screen are never virtualized away. Selection therefore
 * stays independent from catalogue loading.
 */
{


  const selectStart=viewerSource.indexOf('function select(s){');
  const selectEnd=viewerSource.indexOf(
    '\nfunction current(){',
    selectStart
  );
  const selectSource=viewerSource.slice(selectStart,selectEnd);

  }

/*
 * The Remove action styling must never leak onto skin catalogue cards.
 */
{
  const style = fs.readFileSync(
    path.join(root, 'web/skins/style.css'),
    'utf8'
  );

  assert(
    !/#skins\s+\.skin\.card\s*,\s*#dyeList\s+\.dye\.card[\s\S]{0,180}\.chosen-remove\s*\{/s.test(style),
    'chosen-remove styling must not leak onto skin cards'
  );

  assert(
    /\/\*\s*Remove a selected Clothing \/ Accessory dye directly from Index · Selected\.\s*\*\/\s*\.chosen-remove\s*\{/s.test(style),
    'chosen-remove must remain a standalone control style'
  );
}


/*
 * The remove-dye button style must never leak onto the skin/dye catalogue cards.
 */
{
  const style = fs.readFileSync(
    path.join(root, 'web/skins/style.css'),
    'utf8'
  );

  assert(
    !/#skins\s+\.skin\.card\s*,\s*#dyeList\s+\.dye\.card[\s\S]{0,220}\.chosen-remove\s*\{/s.test(style),
    'chosen-remove styling must not leak onto catalogue cards'
  );

  assert(
    /\/\*\s*Remove a selected Clothing \/ Accessory dye directly from Index · Selected\.\s*\*\/\s*\.chosen-remove\s*\{/s.test(style),
    'chosen-remove must stay a standalone control style'
  );
}


/*
 * Centre column hierarchy:
 * selected Index first, Saved combos second, sandbox third.
 */
{
  const markup = fs.readFileSync(
    path.join(root, 'web/skins/view.html'),
    'utf8'
  );

  const selectedAt=markup.indexOf(
    'id="selectedIndex"'
  );

  const comboAt=markup.indexOf(
    'class="combo-workbench combo-workbench-top"'
  );

  const stageAt=markup.indexOf(
    'class="stage-body"'
  );

  assert(
    selectedAt>=0
      &&comboAt>=0
      &&stageAt>=0
      &&selectedAt<comboAt
      &&comboAt<stageAt,
    'Index selected must appear above Saved combos and the sandbox'
  );

  assert(
    viewerSource.includes(
      'makeFavoriteSkinThumb(skin,64)'
    ),
    'Saved combo skins must use a large recognizable thumbnail'
  );
}

/*
 * Saved combo controls must not overlap: the skin selection button and
 * deletion action occupy separate grid columns.
 */
{
  const style = fs.readFileSync(
    path.join(root, 'web/skins/style.css'),
    'utf8'
  );

  const comboStart=viewerSource.indexOf(
    'function renderComboShelf(){'
  );

  const comboEnd=viewerSource.indexOf(
    '\nfunction renderFavoritesCatalogueUI(){',
    comboStart
  );

  const comboSource=viewerSource.slice(
    comboStart,
    comboEnd
  );

  assert(
    comboSource.includes(
      "select.className='combo-saved-select'"
    )
      &&comboSource.includes(
        "remove.className='combo-delete combo-delete-compact'"
      )
      &&comboSource.includes(
        'card.append(select,remove)'
      ),
    'Saved combo select and delete controls must be separate elements'
  );

  }

/*
 * Saved combos have exactly one interaction frame: the skin-select button.
 * The article wrapper and sprite preview must not add competing outlines.
 */
{
  const style = fs.readFileSync(
    path.join(root, 'web/skins/style.css'),
    'utf8'
  );


  }

/*
 * Saved combo final visual model: one complete selectable tile.
 */
{
  const style=fs.readFileSync(
    path.join(root,'web/skins/style.css'),
    'utf8'
  );

  const comboStart=viewerSource.indexOf(
    'function renderComboShelf(){'
  );

  const comboEnd=viewerSource.indexOf(
    '\nfunction renderFavoritesCatalogueUI(){',
    comboStart
  );

  const comboSource=viewerSource.slice(
    comboStart,
    comboEnd
  );

  assert(
    comboSource.includes(
      "select.className='combo-saved-select'"
    )
      &&comboSource.includes(
        "remove.className='combo-delete combo-delete-compact'"
      )
      &&comboSource.includes(
        'card.append(select,remove)'
      ),
    'Saved combo tile must keep select and delete as sibling controls'
  );

  assert(
    style.includes(
      'padding: 5px 17px 5px 5px'
    )
      &&style.includes(
        '.combo-saved-card.current .combo-saved-select'
      )
      &&style.includes(
        '.combo-saved-card:has(.combo-delete-compact:hover) .combo-saved-select'
      ),
    'Saved combo must use one complete selectable outline'
  );
}

/*
 * Saved combo has one visual interaction frame, on the outer article.
 */
{
  const style = fs.readFileSync(
    path.join(root, 'web/skins/style.css'),
    'utf8'
  );

  assert(
    style.includes('FINAL_COMBO_SINGLE_OUTER_FRAME')
      && style.includes(
        '.combo-workbench-top .combo-saved-card.combo-saved-skin-only:hover'
      ),
    'Saved combo hover frame must belong to the outer combo'
  );

  assert(
    style.includes('border: 0 !important;')
      && style.includes('background: transparent !important;'),
    'Saved combo inner skin must remain frameless'
  );
}

/*
 * Current catalogue implementation is V4 capped windowing.
 */
{
  assert(
    viewerSource.includes(
      'const CATALOGUE_WINDOW_OVERSCAN_ROWS=8'
    )
      && viewerSource.includes(
        'function renderCatalogueWindow('
      ),
    'large catalogues must use V4 capped windowing'
  );
}

/*
 * Attack speed is a viewer-wide multiplier. Changing skins/classes/sets may
 * change projectile visuals, but never the firing period represented by the
 * slider.
 */
{
  const periodStart=viewerSource.indexOf(
    'function attackPeriod(){'
  );

  const periodEnd=viewerSource.indexOf(
    '\nfunction attackShotsPerSecond(){',
    periodStart
  );

  const periodSource=viewerSource.slice(
    periodStart,
    periodEnd
  );

  assert(
    periodStart>=0
      &&periodSource.includes(
        'ATTACK_PERIOD_MS/attackSpeedMultiplier()'
      )
      &&!periodSource.includes(
        'combatWeaponShots'
      )
      &&!periodSource.includes(
        'baseAttackRate'
      ),
    'Attack period must be independent from selected skin weapon rate'
  );

  assert(
    !viewerSource.includes(
      'function baseAttackRate()'
    )
      &&!viewerSource.includes(
        'S.rateSkin'
      ),
    'Skin changes must not alter or refresh attack cadence'
  );

  assert(
  /attackSpeedValue\.textContent\s*=\s*attackSpeedLabel\s*\(\s*\)\s*;?/s.test(viewerSource),
  'Attack speed UI must use the same cadence calculation as shooting'
);
}

console.log('Skin Viewer: ' + catalogue.skins.length + ' skins and '
  + dyeCatalogue.dyes.length + ' dyes projected from the index, of which '
  + catalogue.skins.filter(one => one.drawn).length
  + ' the client holds a picture of; '
  + frames.toLocaleString('en-US') + ' frames on one '
  + sheet.wide + '×' + sheet.tall + ' sheet, no guessed links.');
