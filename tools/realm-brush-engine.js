'use strict';

/*
 * Deterministic terrain brush engine.
 *
 * A brush is learned from a captured map: it contains the observed ground
 * types, their frequencies, the road types and feature/setpiece floor types.
 * The engine never needs a server map once those brushes are available. A
 * caller supplies the biome mask, road mask and optional neighbour biome for
 * every target cell; the engine returns the ground type to paint there.
 */

const mix = value => {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
};
const hash = (x, y, seed) => mix(Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ seed) / 0x100000000;
const smooth = value => value * value * (3 - 2 * value);
function valueNoise(x, y, seed) {
  const left = Math.floor(x), top = Math.floor(y);
  const fx = smooth(x - left), fy = smooth(y - top);
  const a = hash(left, top, seed), b = hash(left + 1, top, seed);
  const c = hash(left, top + 1, seed), d = hash(left + 1, top + 1, seed);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

function field(x, y, seed) {
  // Broad patches with a smaller variation: a brush must read as terrain,
  // not independent dice rolls on a chessboard.
  return valueNoise(x / 18, y / 18, seed) * 0.68 + valueNoise(x / 4.5, y / 4.5, seed ^ 0x9e3779b9) * 0.32;
}

function weighted(entries, value) {
  let cursor = 0;
  for (const entry of entries) {
    cursor += entry.weight;
    if (value < cursor) return entry.type;
  }
  return entries[entries.length - 1]?.type ?? null;
}

class RealmBrushEngine {
  constructor(brushes, seed = 0x524f544d) {
    this.brushes = brushes;
    this.seed = seed >>> 0;
  }

  paint({ biome, x, y, road = false, boundary = 0, neighbour = null }) {
    const brush = this.brushes[biome];
    if (!brush) throw new RangeError('No learned brush for biome: ' + biome);
    const tileField = field(x, y, this.seed);

    if (road && brush.road.length) return weighted(brush.road, tileField);

    // On a supplied boundary mask, borrow a small, deterministic proportion
    // of the adjacent brush. This makes an interleaving band instead of a
    // hard cut while leaving the caller in control of its width and shape.
    const other = neighbour && this.brushes[neighbour];
    if (other && boundary > 0 && boundary < 1 && other.ground.length) {
      const ratio = Math.min(0.45, (1 - boundary) * 0.45);
      if (hash(x, y, this.seed ^ 0x17d44) < ratio) return weighted(other.ground, field(x, y, this.seed ^ 0x5bd1e995));
    }
    return weighted(brush.ground, tileField);
  }
}

module.exports = { RealmBrushEngine, field, weighted };
