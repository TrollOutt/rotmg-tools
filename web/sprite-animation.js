/*
 * How a picture from the client moves: which of its poses to show, which way
 * it faces, and which frame of the pose. Every page that draws a character or
 * a creature asks here - the Realm Atlas, Theory Crafting, the Index cards -
 * so an attack looks the same wherever it is drawn.
 *
 * The client files a thing's frames by facing and action, "facing/doing":
 * facing 0 right, 1 left, 2 away, 3 towards; doing 0 standing, 1 walking,
 * 2 attacking. There is seldom a left: the right-hand picture is turned over.
 *
 * An attack is not a loop on the page's clock. It is played the way the
 * client plays it: once over the attack's own length - the gap between two
 * shots for a character, GameObject.ATTACK_PERIOD for a creature - its frames
 * spread over that length, the first as the shot leaves and the last as it
 * ends, facing what was shot at. When it is over the thing walks or stands.
 */
var SpriteAnimation = (function () {
  'use strict';

  const ATTACK_PERIOD = 0.3;   // seconds a creature's attack is shown (GameObject.ATTACK_PERIOD)
  const MOVING = 0.35;         // tiles a second below which a thing is standing
  const WALK_BEAT = 6;         // walking frames a second
  const STAND_BEAT = 2;        // standing frames a second, for the few that breathe

  /**
   * The frames of one pose, or the nearest the picture has.
   * @param {Object<string, number[]>} poses
   * @param {number} facing
   * @param {number} doing
   * @returns {number[]}
   */
  function framesOf(poses, facing, doing) {
    if (!poses) return [0];
    return poses[facing + '/' + doing] || poses['0/' + doing] || poses['3/' + doing]
      || poses[facing + '/0'] || poses['0/0'] || poses['3/0']
      || poses[Object.keys(poses)[0]] || [0];
  }

  /**
   * Which way a thing looking along (dx, dy) faces, y growing downwards.
   * @returns {{ facing: number, flip: boolean }}
   */
  function facingOf(dx, dy) {
    if (Math.abs(dy) > Math.abs(dx)) return { facing: dy < 0 ? 2 : 3, flip: false };
    return { facing: 0, flip: dx < 0 };
  }

  /**
   * Starts an attack: shown for `length` seconds (a creature's period when
   * none is given), facing `aim` radians. Only the drawing reads these.
   */
  function startAttack(one, aim, length) {
    one.aim = aim;
    one.swingFor = Math.max(0.05, length || ATTACK_PERIOD);
    one.swing = one.swingFor;
  }

  /** How far through its attack a thing is, 0 at the shot to just under 1; null when not attacking. */
  function attackProgress(one) {
    if (!(one.swing > 0)) return null;
    const length = one.swingFor || ATTACK_PERIOD;
    return Math.min(0.9999, Math.max(0, 1 - one.swing / length));
  }

  /** The frame of an attack pose at `progress` through it. */
  function attackFrame(list, progress) {
    return list[Math.max(0, Math.min(list.length - 1, Math.floor(progress * list.length)))];
  }

  /** The frame of a standing or walking pose at `clock` seconds. */
  function loopFrame(list, clock, doing) {
    const beat = doing === 1 ? WALK_BEAT : STAND_BEAT;
    return list[Math.floor(Math.max(0, clock) * beat) % list.length];
  }

  /**
   * The whole decision for something with a velocity (vx, vy), a clock
   * (phase) and perhaps an attack under way (swing, swingFor, aim).
   * @returns {{ frame: number, flip: boolean, doing: number }}
   */
  function pose(one, poses) {
    const vx = one.vx || 0, vy = one.vy || 0;
    const moving = Math.hypot(vx, vy) > MOVING;
    const progress = attackProgress(one);
    const attacking = progress !== null;
    const doing = attacking ? 2 : (moving ? 1 : 0);
    const aimed = attacking && Number.isFinite(one.aim);
    let way = { facing: 0, flip: false };
    if (aimed) way = facingOf(Math.cos(one.aim), Math.sin(one.aim));
    else if (moving) way = facingOf(vx, vy);
    let flip = way.flip, list = null;
    // A picture that does keep a left of its own is shown as it is.
    if (flip && poses && poses['1/' + doing]) { list = poses['1/' + doing]; flip = false; }
    list = list || framesOf(poses, way.facing, doing);
    const frame = attacking ? attackFrame(list, progress) : loopFrame(list, one.phase || 0, doing);
    return { frame, flip, doing };
  }

  return { ATTACK_PERIOD, framesOf, facingOf, startAttack, attackProgress, attackFrame, loopFrame, pose };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SpriteAnimation;
