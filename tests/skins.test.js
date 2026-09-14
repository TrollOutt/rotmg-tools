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
    assert(Number.isInteger(action) && Number.isInteger(direction));
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
  assert(undrawable.length > 0 && undrawable.length < 40,
    'a handful of skins have no picture, not none and not most');
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

console.log('Skin Viewer: ' + catalogue.skins.length + ' skins and '
  + dyeCatalogue.dyes.length + ' dyes projected from the index, of which '
  + catalogue.skins.filter(one => one.drawn).length
  + ' the client holds a picture of; '
  + frames.toLocaleString('en-US') + ' frames on one '
  + sheet.wide + '×' + sheet.tall + ' sheet, no guessed links.');
