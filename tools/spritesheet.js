/*
 * The client's sprite registry, read once for everybody.
 *
 * `spritesheet.bin` is a FlatBuffers blob written by the game: for every one
 * of its atlases, where each sprite sits on which packed sheet, and for every
 * animated one, which frame of which action in which direction it is. It is
 * the only thing that says where a picture is, so the index cuts its artwork
 * from it and the Skin Viewer reads its animations out of it.
 *
 * There were two copies of this reader in the repository and a third about to
 * be written. That is how `png.js` came to exist, and the argument is the
 * same: two decoders of one format are two tools that will eventually
 * disagree about a pixel and nobody will know which is right.
 *
 * Nothing here interprets. It hands back what the blob says, in the order the
 * blob says it, and the callers decide what a standing frame is or which
 * frames belong to one animation.
 */
'use strict';

/* ---------------- just enough FlatBuffers ---------------- */
class Flat {
  constructor(b) { this.b = b; }
  u16(a) { return this.b.readUInt16LE(a); }
  i32(a) { return this.b.readInt32LE(a); }
  u32(a) { return this.b.readUInt32LE(a); }
  f32(a) { return this.b.readFloatLE(a); }
  root() { return this.u32(0); }
  fields(t) {
    const v = t - this.i32(t);
    const size = this.u16(v);
    const out = [];
    for (let slot = 0; slot * 2 + 4 < size; slot++) {
      const off = this.u16(v + 4 + slot * 2);
      out.push(off ? t + off : 0);
    }
    return out;
  }
  string(a) { const p = a + this.u32(a); const n = this.u32(p); return this.b.toString('utf8', p + 4, p + 4 + n); }
  vector(a) { const p = a + this.u32(a); return { at: p + 4, length: this.u32(p) }; }
  indirect(a) { return a + this.u32(a); }
}

/*
 * Which packed sheet a rectangle is on. The blob numbers them; these are the
 * three the extractor writes out beside it.
 *
 * The numbering is not written down anywhere and was worked out by sampling:
 * at a Wizard's own sprite the characters sheet gives eleven colours and the
 * objects sheet gives four of something else, and at the Grey Missile the
 * characters sheet gives flat white - which is a mask - while the objects
 * sheet gives grey, which is the missile. So two is characters and four is
 * objects, and getting that backwards is why every boss on the bench was once
 * the wrong picture.
 */
const SHEET_OF = { 1: 'groundTiles', 2: 'characters', 4: 'mapObjects' };
const sheetName = id => SHEET_OF[id] || 'mapObjects';

/*
 * A sprite's own record: where it is, where its dye mask is, and how much of
 * the rectangle is padding the game trims off.
 */
/*
 * The four floats are x, y, HEIGHT, width - in that order.
 *
 * Not width then height, which is what anybody writes down first and what the
 * two readers this replaces both assumed. It is invisible on the 107,287
 * square sprites and wrong on the 7,498 that are not: a 10x8 bolt of cloth
 * was cut 8 wide and 10 tall, taking two rows of nothing from below it and
 * losing two columns off its side.
 *
 * Proved on the pixels rather than argued: read as (h, w) the rectangle is
 * opaque to its last row, and read as (w, h) it runs off the bottom of the
 * sprite into empty sheet. A character's sideways attack frame - the one that
 * is twice as wide as it is tall, because the weapon swings out of the body -
 * comes out the right way round the same way.
 */
function spriteAt(flat, at) {
  const one = flat.fields(at);
  if (!one[0]) return null;
  const box = a => ({
    x: Math.round(flat.f32(a)), y: Math.round(flat.f32(a + 4)),
    h: Math.round(flat.f32(a + 8)), w: Math.round(flat.f32(a + 12))
  });
  return {
    rect: box(one[0]),
    mask: one[1] ? box(one[1]) : null,
    pad: one[2] ? flat.i32(one[2]) : 0,
    sheet: sheetName(one[7] ? flat.i32(one[7]) : 0)
  };
}

/*
 * Everything the blob holds, in its own order.
 *
 *   still     one entry per atlas, each with its sprites by declared index
 *   animated  one entry per frame, in the order the client wrote them
 *
 * An animated frame names its atlas and index - which is what an object's
 * <AnimatedTexture> points at - together with the action it belongs to, the
 * direction it faces, and which animation set it is part of.
 *
 * The set is the field nobody would guess: it is absent on all but 237 of the
 * 53,741 frames, so a scan of the first few thousand says it does not exist.
 * It is what separates a character's two different attacks from one attack of
 * twice as many frames.
 */
function read(buffer) {
  const flat = new Flat(buffer);
  const rootFields = flat.fields(flat.root());

  const still = [];
  {
    const list = flat.vector(rootFields[0]);
    for (let i = 0; i < list.length; i++) {
      const atlas = flat.fields(flat.indirect(list.at + i * 4));
      const sprites = flat.vector(atlas[2]);
      const mine = [];
      for (let n = 0; n < sprites.length; n++) {
        const at = flat.indirect(sprites.at + n * 4);
        const one = flat.fields(at);
        const drawn = spriteAt(flat, at);
        if (!drawn) continue;
        mine.push(Object.assign({ index: one[3] ? flat.i32(one[3]) : 0 }, drawn));
      }
      still.push({ name: flat.string(atlas[0]), sprites: mine });
    }
  }

  const animated = [];
  {
    const list = flat.vector(rootFields[1]);
    for (let i = 0; i < list.length; i++) {
      const one = flat.fields(flat.indirect(list.at + i * 4));
      if (!one[0] || !one[5]) continue;
      const drawn = spriteAt(flat, flat.indirect(one[5]));
      if (!drawn) continue;
      animated.push(Object.assign({
        atlas: flat.string(one[0]),
        index: one[1] ? flat.i32(one[1]) : 0,
        set: one[2] ? flat.i32(one[2]) : 0,
        direction: one[3] ? flat.i32(one[3]) : 0,
        action: one[4] ? flat.i32(one[4]) : 0
      }, drawn));
    }
  }

  return { still, animated };
}

/*
 * What the client's own numbers mean, as far as anybody knows.
 *
 * Three of the actions are plain from watching them and the fourth is not:
 * action 3 never appears at all and action 4 appears on a handful of skins
 * doing something nobody has named. Left as holes rather than filled with a
 * guess - a reader who sees "Action 4" knows they are looking at something
 * unidentified, and a reader who sees "special" does not.
 *
 * Direction 1 is never used either. The client counts side, then a slot it
 * does not fill, then front and back.
 */
const ACTION = ['idle', 'walk', 'attack', undefined, undefined];
const DIRECTION = ['side', undefined, 'front', 'back'];
const sayAction = n => ACTION[n] || 'action ' + n;
const sayDirection = n => DIRECTION[n] || 'direction ' + n;

/* ---------------- where a swing is anchored ---------------- *
 *
 * A character's attack frame is wider than the character.
 *
 * Seventeen of the nineteen classes draw an eight-pixel body standing still
 * and a sixteen-pixel rectangle when they swing - the body still eight wide
 * at the left of it, and the weapon reaching out to the right. The extra
 * width is the weapon, not the person.
 *
 * So whatever lays those frames out has to decide where the wide one goes,
 * and the obvious answer is wrong. Centre the rectangle on the character and
 * the body slides four pixels back every time the swing comes round, which
 * on screen reads as the character hopping backwards on each shot. Nothing
 * about the body has moved; the rectangle around it grew forward, and
 * centring shares that growth out to both sides.
 *
 * The rule is: anchor the body and let the weapon extend forward. Vertically
 * the same argument already applies and is already applied - a frame is
 * stood on the floor of its cell rather than centred in it, because a
 * rectangle taller than its drawing would otherwise make the figure leap.
 *
 * Two places need it in two different ways. Something drawing a frame at a
 * position moves the position (see attackAnchorX in web/skins/app.js);
 * something packing frames into a strip of fixed cells lays them out from
 * the leading edge instead of the middle (see tools/theory-sprites.js). Both
 * are the same rule, which is why it is written down here rather than twice.
 */
const ATTACK = 2;

/*
 * How wide the body is: the narrowest frame that is not a swing. A run where
 * everything is one width has nothing to correct.
 */
function bodyWidth(frames) {
  const still = frames.filter(one => one.doing !== ATTACK && one.action !== ATTACK);
  const mine = (still.length ? still : frames).map(one => one.w || (one.rect && one.rect.w));
  return mine.length ? Math.min(...mine.filter(Boolean)) : 0;
}

/*
 * Whether a run reaches forward when it swings, and so must be laid out from
 * its leading edge rather than from its middle.
 */
function reachesForward(frames) {
  const body = bodyWidth(frames);
  if (!body) return false;
  return frames.some(one => (one.doing === ATTACK || one.action === ATTACK)
    && (one.w || (one.rect && one.rect.w)) > body);
}

module.exports = {
  Flat, read, sheetName, SHEET_OF,
  ACTION, DIRECTION, sayAction, sayDirection,
  ATTACK, bodyWidth, reachesForward
};
