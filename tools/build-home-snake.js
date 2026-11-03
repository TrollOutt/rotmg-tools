'use strict';
/* Client poses: side idle/swim/swim/attack, front/back idle and front/back attack. */
const fs = require('fs');
const path = require('path');
const registry = require('./spritesheet');
const { readPng, writePng } = require('./png');

const root = path.join(__dirname, '..');
const source = process.env.ROTMG_CLIENT_DATA || path.join(root, 'client-data');
const frames = registry.read(fs.readFileSync(path.join(source, 'spritesheet.bin'))).animated;
const characters = readPng(fs.readFileSync(path.join(source, 'textures', 'characters.png')));
const ids = [1, 6, 11]; // Objects.167.xml: LNY The White Snake, Segment, Tail
const cell = 16;
const pixels = Buffer.alloc(ids.length * cell * cell * 8 * 4);

ids.forEach((index, slot) => {
  const matching = frames.filter(one => one.atlas === 'whiteSnakeChars16x16' && one.index === index);
  const pick = (direction, action) => matching.find(one => one.direction === direction
    && one.action === action && one.rect.w === cell);
  const idle = pick(0, 0);
  const swimming = matching.filter(one => one.direction === 0 && one.action === 1);
  if (!idle || swimming.length !== 2) throw new Error(`Missing White Snake swimming frames ${index}`);
  const poses = [idle, ...swimming, pick(0, 2) || idle,
    pick(3, 0) || idle, pick(2, 0) || idle, pick(3, 2) || idle, pick(2, 2) || idle];
  const bounds = { left: cell, top: cell, right: -1, bottom: -1 };
  for (const frame of poses) {
    if (!frame || frame.sheet !== 'characters' || frame.rect.w !== cell || frame.rect.h !== cell) {
      throw new Error(`Invalid White Snake sprite ${index} in the local client`);
    }
    for (let row = 0; row < cell; row++) for (let col = 0; col < cell; col++) {
      const from = ((frame.rect.y + row) * characters.width + frame.rect.x + col) * 4;
      if (!characters.pixels[from + 3]) continue;
      bounds.left = Math.min(bounds.left, col); bounds.right = Math.max(bounds.right, col);
      bounds.top = Math.min(bounds.top, row); bounds.bottom = Math.max(bounds.bottom, row);
    }
  }
  // Client frames stand on their bottom edge. Centre each part's visible
  // drawing on the spine, using one shared anchor for all of its poses.
  const ox = Math.floor((cell - bounds.right + bounds.left - 1) / 2) - bounds.left;
  const oy = Math.floor((cell - bounds.bottom + bounds.top - 1) / 2) - bounds.top;
  poses.forEach((frame, pose) => {
    const { x, y } = frame.rect;
    for (let row = bounds.top; row <= bounds.bottom; row++) for (let col = bounds.left; col <= bounds.right; col++) {
      const from = ((y + row) * characters.width + x + col) * 4;
      const to = ((pose * cell + row + oy) * ids.length * cell + slot * cell + col + ox) * 4;
      characters.pixels.copy(pixels, to, from, from + 4);
    }
  });
});

const out = path.join(root, 'web', 'assets', 'home', 'white-snake.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, writePng(ids.length * cell, cell * 8, pixels));
console.log(`White Snake sprites -> ${path.relative(root, out)}`);
