'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const registry = require('../tools/spritesheet');
const theorySprites = require('../tools/theory-sprites');

/* ------------------------------------------------------------------ *
 * Shared sprite geometry                                              *
 * ------------------------------------------------------------------ */

{
  const frames = [
    { doing: 0, w: 8 },
    { doing: 1, w: 8 },
    { doing: registry.ATTACK, w: 16 }
  ];

  assert.equal(
    registry.bodyWidth(frames),
    8,
    'SPRITE-001 body width comes from non-attack frames'
  );

  assert(
    registry.reachesForward(frames),
    'SPRITE-002 a wider attack frame must extend forward'
  );
}

{
  const sameWidth = [
    { action: 0, rect: { w: 8 } },
    { action: registry.ATTACK, rect: { w: 8 } }
  ];

  assert.equal(
    registry.bodyWidth(sameWidth),
    8,
    'SPRITE-001 rect-backed frames use the same body-width rule'
  );

  assert.equal(
    registry.reachesForward(sameWidth),
    false,
    'SPRITE-002 equal-width attacks must not invent forward reach'
  );
}

{
  const attacksOnly = [
    { doing: registry.ATTACK, w: 16 },
    { doing: registry.ATTACK, w: 12 }
  ];

  assert.equal(
    registry.bodyWidth(attacksOnly),
    12,
    'SPRITE-003 attack-only runs fall back to their narrowest frame'
  );
}

assert.equal(registry.FRONT, 3, 'SPRITE-004 client direction 3 is front');
assert.equal(registry.BACK, 2, 'SPRITE-004 client direction 2 is back');
assert.equal(registry.SIDE, 0, 'SPRITE-004 client direction 0 is side');
assert.equal(registry.sayAction(2), 'attack', 'SPRITE-004 action 2 is attack');

/* ------------------------------------------------------------------ *
 * Alpha slicing                                                       *
 * ------------------------------------------------------------------ */

{
  const width = 4;
  const height = 4;
  const pixels = Buffer.alloc(width * height * 4);
  const alpha = (x, y, value) => {
    pixels[(y * width + x) * 4 + 3] = value;
  };

  alpha(1, 1, 8);

  assert.equal(
    theorySprites.cellAlphaBounds(
      pixels,
      width,
      { x: 0, y: 0, w: width, h: height }
    ),
    null,
    'SPRITE-010 alpha <= 8 remains transparent'
  );

  alpha(2, 1, 9);

  assert.deepEqual(
    theorySprites.cellAlphaBounds(
      pixels,
      width,
      { x: 0, y: 0, w: width, h: height }
    ),
    { x: 2, y: 1, w: 1, h: 1 },
    'SPRITE-010 alpha > 8 enters the visible bounds'
  );
}

{
  const stride = 8;
  const width = stride * 3;
  const height = 8;
  const pixels = Buffer.alloc(width * height * 4);

  const paint = (cell, x, y, w, h) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const absoluteX = cell * stride + px;
        pixels[(py * width + absoluteX) * 4 + 3] = 255;
      }
    }
  };

  paint(0, 2, 2, 3, 3);
  /* middle frame deliberately blank */
  paint(2, 1, 4, 5, 2);

  const cells = [0, 1, 2].map(cell => ({
    x: cell * stride,
    y: 0,
    w: stride,
    h: height
  }));

  assert.deepEqual(
    theorySprites.visibleBounds(pixels, width, cells),
    { x: 1, y: 2, w: 5, h: 4 },
    'SPRITE-011 animation visibility is the union in frame-local coordinates'
  );
}

/* ------------------------------------------------------------------ *
 * Live renderer / animation helpers                                   *
 * ------------------------------------------------------------------ */

{
  const rendererSource = fs.readFileSync(
    path.join(root, 'web/skins/renderer.js'),
    'utf8'
  );

  const appSource = fs.readFileSync(
    path.join(root, 'web/skins/app.js'),
    'utf8'
  );

  const pureEnd = appSource.indexOf('let mountedInstance');
  assert(pureEnd > 0, 'SPRITE-020 Skin Viewer pure-helper boundary exists');

  const pureApp = appSource
    .slice(0, pureEnd)
    .replace(/^import .*;$/gm, '');

  const rendererUrl =
    'data:text/javascript;base64,'
    + Buffer.from(rendererSource).toString('base64');

  const appUrl =
    'data:text/javascript;base64,'
    + Buffer.from(pureApp).toString('base64');

  const check = `
    import {
      MODE, dyeMode, phase, composition
    } from ${JSON.stringify(rendererUrl)};

    import {
      attackAnchorX,
      initialSequence,
      directionFromPointer,
      FACE_AWAY,
      FACE_YOU,
      FACE_SIDE
    } from ${JSON.stringify(appUrl)};

    const ok = (condition, message) => {
      if (!condition) throw new Error(message);
    };

    ok(dyeMode(null) === MODE.NONE,
      'RENDER-001 missing dye means no dye mode');

    ok(dyeMode({kind:'color'}) === MODE.COLOR,
      'RENDER-001 color dye selects color mode');

    ok(dyeMode({
      kind:'textile',
      animation:{type:'horizontal'}
    }) === MODE.HORIZONTAL,
      'RENDER-001 horizontal textile selects horizontal mode');

    ok(dyeMode({
      kind:'textile',
      animation:{type:'vertical'}
    }) === MODE.VERTICAL,
      'RENDER-001 vertical textile selects vertical mode');

    ok(dyeMode({
      kind:'textile',
      animation:{type:'spinning'}
    }) === MODE.SPINNING,
      'RENDER-001 spinning textile selects spinning mode');

    ok(Math.abs(
      phase({animation:{speed:2.5}}, 4000) - 10
    ) < 1e-12,
      'ANIM-001 textile phase is speed multiplied by elapsed seconds');

    ok(phase(null, 4000) === 0,
      'ANIM-001 non-animated dye has zero phase');

    ok(composition(.7, 0, .4, MODE.COLOR) === .7,
      'RENDER-002 zero mask preserves the original sprite');

    ok(Math.abs(
      composition(.7, .5, .4, MODE.COLOR) - .2
    ) < 1e-12,
      'RENDER-002 active dye contribution is dye multiplied by mask');

    ok(
      attackAnchorX(100, 16, 8, 4, false) === 116,
      'SPRITE-021 right-facing wide attack keeps body anchored'
    );

    ok(
      attackAnchorX(100, 16, 8, 4, true) === 84,
      'SPRITE-021 left-facing wide attack mirrors the anchor'
    );

    ok(
      attackAnchorX(100, 8, 8, 4, false) === 100,
      'SPRITE-021 equal-width attack does not move the body'
    );

    ok(
      directionFromPointer(50, 10, 50, 50).raw === FACE_AWAY,
      'ANIM-002 aiming upward shows the back'
    );

    ok(
      directionFromPointer(50, 90, 50, 50).raw === FACE_YOU,
      'ANIM-002 aiming downward shows the front'
    );

    const left = directionFromPointer(10, 50, 50, 50);
    ok(left.raw === FACE_SIDE && left.left === true,
      'ANIM-002 aiming left selects mirrored side facing');

    const first = initialSequence([
      {
        set:1, action:'idle', direction:'front',
        actionRaw:0, directionRaw:3
      },
      {
        set:0, action:'walk', direction:'front',
        actionRaw:1, directionRaw:3
      },
      {
        set:0, action:'idle', direction:'side',
        actionRaw:0, directionRaw:0
      },
      {
        set:0, action:'idle', direction:'front',
        actionRaw:0, directionRaw:3
      }
    ]);

    ok(
      first.set === 0
      && first.action === 'idle'
      && first.direction === 'front',
      'ANIM-003 initial sequence prefers primary idle facing the reader'
    );
  `;

  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', check],
    { stdio: 'pipe' }
  );
}

console.log('sprite / animation contract: ok');
