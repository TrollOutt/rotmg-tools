'use strict';

/*
 * The small, format-specific part of reading a Realm map capture.
 *
 * RotMG leaves each frame's length and id in the clear.  RC4 applies only to
 * its body, continuously for the lifetime of one TCP connection.  UPDATE is
 * the packet that adds new ground to the client's visible world:
 *
 *   WorldPos (two big-endian float32s), level byte, compressed tile count,
 *   then count × (int16 x, int16 y, uint16 ground type).
 *
 * Keeping this separate from the pcap reader makes the protocol checks easy
 * to exercise without a live capture or a browser.
 */

const UPDATE_ID = 42;
const MAPINFO_ID = 92;
const FRAME_HEADER = 5;

class RC4 {
  constructor(key) {
    if (!Buffer.isBuffer(key) || !key.length) throw new TypeError('RC4 needs a non-empty Buffer key');
    this.state = Buffer.alloc(256);
    this.key = Buffer.from(key);
    this.reset();
  }

  reset() {
    for (let i = 0; i < 256; i++) this.state[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + this.state[i] + this.key[i % this.key.length]) & 255;
      [this.state[i], this.state[j]] = [this.state[j], this.state[i]];
    }
    this.i = 0;
    this.j = 0;
  }

  cipher(bytes) {
    for (let at = 0; at < bytes.length; at++) {
      this.i = (this.i + 1) & 255;
      this.j = (this.j + this.state[this.i]) & 255;
      [this.state[this.i], this.state[this.j]] = [this.state[this.j], this.state[this.i]];
      bytes[at] ^= this.state[(this.state[this.i] + this.state[this.j]) & 255];
    }
    return bytes;
  }

  clone() {
    const copy = Object.create(RC4.prototype);
    copy.state = Buffer.from(this.state);
    copy.key = this.key;
    copy.i = this.i;
    copy.j = this.j;
    return copy;
  }
}

function readCompressedInt(body, start) {
  let at = start;
  if (at >= body.length) throw new RangeError('compressed integer is truncated');
  let byte = body[at++];
  const negative = (byte & 64) !== 0;
  let value = byte & 63;
  let multiplier = 64;
  let used = 1;
  while (byte & 128) {
    if (used === 5 || at >= body.length) throw new RangeError('compressed integer is truncated or oversized');
    byte = body[at++];
    value += (byte & 127) * multiplier;
    multiplier *= 128;
    used++;
  }
  if (used > 1 && (byte & 127) === 0) throw new RangeError('compressed integer is overlong');
  if (value > (negative ? 0x80000000 : 0x7fffffff)) throw new RangeError('compressed integer is outside int32');
  return { value: negative ? -value : value, next: at };
}

// `StatData` has two *compressed* values: the primary value (or a UTF-8
// string for the listed kinds), then a secondary value.  This is crucial:
// treating a value as four bytes shifts the rest of UPDATE and turns every
// following object into nonsense.  The set is the client protocol's current
// string-stat table, not a visual/biome heuristic.
const STRING_STATS = new Set([6, 31, 38, 54, 62, 71, 72, 80, 82, 115, 121, 127, 128, 147, 155]);

function parseUpdateObjects(body, start) {
  let at = start;
  const count = readCompressedInt(body, at);
  if (count.value < 0 || count.value > 200000) throw new RangeError('UPDATE object count is implausible');
  at = count.next;
  const objects = [];
  for (let index = 0; index < count.value; index++) {
    if (at + 2 > body.length) throw new RangeError('UPDATE object type is truncated');
    const type = body.readUInt16BE(at); at += 2;
    const id = readCompressedInt(body, at); at = id.next;
    if (at + 8 > body.length) throw new RangeError('UPDATE object position is truncated');
    const x = body.readFloatBE(at), y = body.readFloatBE(at + 4); at += 8;
    const statCount = readCompressedInt(body, at); at = statCount.next;
    if (statCount.value < 0 || statCount.value > 2048) throw new RangeError('UPDATE stat count is implausible');
    for (let stat = 0; stat < statCount.value; stat++) {
      if (at >= body.length) throw new RangeError('UPDATE stat is truncated');
      const kind = body[at++];
      if (STRING_STATS.has(kind)) {
        if (at + 2 > body.length) throw new RangeError('UPDATE string stat is truncated');
        const length = body.readUInt16BE(at); at += 2 + length;
        if (at > body.length) throw new RangeError('UPDATE string stat value is truncated');
      } else {
        at = readCompressedInt(body, at).next;
      }
      at = readCompressedInt(body, at).next;
    }
    objects.push({ type, id: id.value, x, y });
  }
  const drops = readCompressedInt(body, at);
  if (drops.value < 0 || drops.value > 200000) throw new RangeError('UPDATE drop count is implausible');
  at = drops.next;
  const dropIds = new Array(drops.value);
  for (let index = 0; index < drops.value; index++) {
    const id = readCompressedInt(body, at);
    dropIds[index] = id.value;
    at = id.next;
  }
  // A legacy-compatible UPDATE may carry one optional byte after `drops`.
  if (at + 1 < body.length) throw new RangeError('UPDATE object data has trailing bytes');
  return { objects, drops: drops.value, dropIds, trailingByte: at < body.length ? body[at] : null };
}

function parseUpdateGround(body, knownGroundTypes) {
  // Position (8), level type (1), tile count, object count and drop count.
  // An ordinary tick can legitimately contain zero newly visible tiles.
  if (body.length < 12) throw new RangeError('UPDATE body is too short for ground data');
  const origin = { x: body.readFloatBE(0), y: body.readFloatBE(4) };
  const levelType = body[8];
  const count = readCompressedInt(body, 9);
  if (count.value < 0 || count.value > 200000) throw new RangeError('UPDATE tile count is implausible');
  const end = count.next + count.value * 6;
  if (end > body.length) throw new RangeError('UPDATE tile data is truncated');

  const tiles = new Array(count.value);
  let known = 0;
  for (let index = 0, at = count.next; index < count.value; index++, at += 6) {
    const tile = { x: body.readInt16BE(at), y: body.readInt16BE(at + 2), type: body.readUInt16BE(at + 4) };
    if (knownGroundTypes && knownGroundTypes.has(tile.type)) known++;
    tiles[index] = tile;
  }
  // Ground is independently self-describing and is the cryptographic proof
  // used for stream recovery. Keep it usable while the object schema is being
  // decoded version-by-version rather than rejecting a whole map on one
  // unfamiliar status field.
  let objectData = { objects: [], drops: 0, error: null };
  try { objectData = parseUpdateObjects(body, end); }
  catch (error) { objectData.error = error.message; }
  return {
    origin, levelType, tiles, known,
    knownShare: tiles.length ? known / tiles.length : 1,
    trailing: body.length - end,
    objects: objectData.objects,
    drops: objectData.drops,
    dropIds: objectData.dropIds || [],
    objectError: objectData.error
  };
}

function fullyCaptured(filled, from, length) {
  if (!filled) return true;
  for (let at = from; at < from + length; at++) if (!filled[at]) return false;
  return true;
}

function parseMapInfoSummary(body) {
  // The opening MAPINFO is version-dependent, but its first two fields have
  // remained the map dimensions. Keep the rest opaque and retain printable
  // text only for selecting the Realm rather than Nexus or a dungeon.
  const strings = body.toString('latin1').match(/[ -~]{3,}/g) || [];
  return {
    width: body.length >= 4 ? body.readInt32BE(0) : null,
    height: body.length >= 8 ? body.readInt32BE(4) : null,
    text: strings.join(' | ')
  };
}

/*
 * pktmon occasionally omits one or two whole 9-byte RealmScoreUpdate frames.
 * Their clear header is 5 bytes and their encrypted body is 4 bytes.  A stream
 * cipher can safely advance over that exact, bounded loss; anything larger or
 * less certain remains a hard stop rather than inventing an RC4 position.
 */
function recoverHeartbeatGap(stream, at, rc4) {
  if (!stream.frames || !stream.filled) return null;
  const next = stream.frames.find(frame => frame.at > at);
  if (!next) return null;
  const length = next.at - at;
  if (!length || length > 36 || length % 9) return null;
  if (fullyCaptured(stream.filled, at, length)) return null;
  for (let cursor = at; cursor < next.at; cursor++) if (stream.filled[cursor]) return null;
  rc4.cipher(Buffer.alloc(length / 9 * 4));
  return { next: next.at, frames: length / 9 };
}

function scoreContinuation(stream, start, rc4, knownGroundTypes) {
  let at = start;
  let score = 0;
  let checked = 0;
  while (at + FRAME_HEADER <= stream.bytes.length && checked < 240) {
    const length = stream.bytes.readUInt32BE(at);
    if (length < FRAME_HEADER || length > 262144 || at + length > stream.bytes.length) break;
    if (!fullyCaptured(stream.filled, at, length)) break;
    const id = stream.bytes[at + 4];
    const body = Buffer.from(stream.bytes.subarray(at + FRAME_HEADER, at + length));
    rc4.cipher(body);
    if (id === UPDATE_ID) {
      try {
        const update = parseUpdateGround(body, knownGroundTypes);
        // A multi-tile run whose ids all exist in this installed client is an
        // overwhelmingly strong check of the RC4 position. Empty updates are
        // deliberately not evidence: random data can imitate a zero count.
        if (update.tiles.length >= 4 && update.knownShare >= 0.98) score += 10 + Math.min(10, update.tiles.length / 500);
        // Empty Realm ticks are not normally evidence, but this particular
        // wire signature is: the server uses origin (0, 0), level type 15 or
        // 25 and a zero tile count. Two exact float zeros plus the level byte
        // make a random RC4 alignment vanishingly unlikely, while allowing us
        // to bridge between two otherwise separated visible-ground bursts.
        if (!update.tiles.length && update.origin.x === 0 && update.origin.y === 0
          && (update.levelType === 15 || update.levelType === 25)) score += 12;
      } catch (_) { return { score: -1000, next: at }; }
    }
    at += length;
    checked++;
  }
  return { score, next: at };
}

/*
 * When an entire run of TCP bytes is absent, its cipher advance is unknown
 * because frame headers are not encrypted.  Try each possible body-byte count
 * and accept one only when the following UPDATE packets independently prove it
 * by decoding to recognised ground ids.  This lets a passive capture survive a
 * dropped burst without ever using a merely plausible answer.
 */
function recoverValidatedGap(stream, at, rc4, knownGroundTypes, options = {}) {
  if (!stream.frames || !stream.filled) return null;
  const next = stream.frames.find(frame => frame.at > at);
  if (!next) return null;
  const gap = next.at - at;
  if (!gap || gap > (options.maximum || 4096)) return null;
  if (!options.allowCaptured) {
    for (let cursor = at; cursor < next.at; cursor++) if (stream.filled[cursor]) return null;
  }

  let winner = null;
  for (let skipped = 0; skipped <= gap; skipped++) {
    const trial = rc4.clone();
    trial.cipher(Buffer.alloc(skipped));
    const scored = scoreContinuation(stream, next.at, trial, knownGroundTypes);
    if (!winner || scored.score > winner.score) winner = { skipped, score: scored.score };
    else if (scored.score === winner.score) winner.tied = true;
  }
  if (!winner || winner.tied || winner.score < 10) return null;
  rc4.cipher(Buffer.alloc(winner.skipped));
  return { next: next.at, bytes: winner.skipped };
}

function firstUnusableFrame(stream, start, limit = 240) {
  let at = start;
  let seen = 0;
  while (at + FRAME_HEADER <= stream.bytes.length && seen < limit) {
    if (!fullyCaptured(stream.filled, at, FRAME_HEADER)) return at;
    const length = stream.bytes.readUInt32BE(at);
    if (length < FRAME_HEADER || length > 262144 || at + length > stream.bytes.length) return at;
    if (!fullyCaptured(stream.filled, at, length)) return at;
    at += length;
    seen++;
  }
  return at;
}

function advanceCapturedBodies(stream, start, end, rc4) {
  let at = start;
  while (at < end) {
    const length = stream.bytes.readUInt32BE(at);
    if (length < FRAME_HEADER || at + length > end || !fullyCaptured(stream.filled, at, length)) return false;
    rc4.cipher(Buffer.alloc(length - FRAME_HEADER));
    at += length;
  }
  return at === end;
}

/*
 * A pair of short capture holes is common in pktmon output: score/status
 * traffic lands between them, so neither individual hole has a nearby ground
 * UPDATE to validate it. Search the two unknown cipher advances together and
 * accept only the unique pair proven by the UPDATE run after the second gap.
 */
function recoverAcrossTwoGaps(stream, at, rc4, knownGroundTypes) {
  if (!stream.frames || !stream.filled) return null;
  const first = stream.frames.find(frame => frame.at > at);
  if (!first) return null;
  const firstGap = first.at - at;
  if (!firstGap || firstGap > 2048) return null;
  const breakAt = firstUnusableFrame(stream, first.at);
  const second = stream.frames.find(frame => frame.at > breakAt);
  if (!second) return null;
  const secondGap = second.at - breakAt;
  if (!secondGap || secondGap > 2048) return null;

  let winner = null;
  for (let skippedFirst = 0; skippedFirst <= firstGap; skippedFirst++) {
    const middle = rc4.clone();
    middle.cipher(Buffer.alloc(skippedFirst));
    if (!advanceCapturedBodies(stream, first.at, breakAt, middle)) continue;
    for (let skippedSecond = 0; skippedSecond <= secondGap; skippedSecond++) {
      const trial = middle.clone();
      trial.cipher(Buffer.alloc(skippedSecond));
      const scored = scoreContinuation(stream, second.at, trial, knownGroundTypes);
      if (!winner || scored.score > winner.score) winner = { skippedFirst, skippedSecond, score: scored.score };
      else if (scored.score === winner.score) winner.tied = true;
    }
  }
  if (!winner || winner.tied || winner.score < 10) return null;
  rc4.cipher(Buffer.alloc(winner.skippedFirst));
  if (!advanceCapturedBodies(stream, first.at, breakAt, rc4)) return null;
  rc4.cipher(Buffer.alloc(winner.skippedSecond));
  return { next: second.at, bytes: winner.skippedFirst + winner.skippedSecond };
}

/*
 * Decode the contiguous, captured prefix of one server connection.  We stop at
 * the first missing TCP byte: RC4 is a stream cipher, so carrying on past a
 * gap would silently produce false tiles.
 */
function decodeServerStream(stream, key, knownGroundTypes) {
  const bytes = stream.bytes;
  const rc4 = new RC4(key);
  const updates = [];
  let at = 0;
  let frames = 0;
  let recoveredFrames = 0;
  let recoveredBytes = 0;
  let reason = 'end of stream';
  let mapInfo = null;

  while (at + FRAME_HEADER <= bytes.length) {
    if (!fullyCaptured(stream.filled, at, FRAME_HEADER)) {
      const recovered = recoverHeartbeatGap(stream, at, rc4);
      if (recovered) { at = recovered.next; recoveredFrames += recovered.frames; continue; }
      const validated = recoverValidatedGap(stream, at, rc4, knownGroundTypes);
      if (validated) { at = validated.next; recoveredBytes += validated.bytes; continue; }
      // A loss can include a few unrelated TCP fragments. Once the clear
      // header itself is incomplete those bytes cannot form a trustworthy
      // frame; recover only if the next complete UPDATE run proves one unique
      // RC4 advance.
      const corrupt = recoverValidatedGap(stream, at, rc4, knownGroundTypes, { allowCaptured: true, maximum: 8192 });
      if (corrupt) { at = corrupt.next; recoveredBytes += corrupt.bytes; continue; }
      const twoGaps = recoverAcrossTwoGaps(stream, at, rc4, knownGroundTypes);
      if (twoGaps) { at = twoGaps.next; recoveredBytes += twoGaps.bytes; continue; }
      reason = 'missing TCP bytes in a frame header'; break;
    }
    const length = bytes.readUInt32BE(at);
    if (length < FRAME_HEADER || length > 262144 || at + length > bytes.length) {
      // pktmon can leave a short, unusable payload fragment immediately before
      // the next resynchronised frame. It is not an encrypted body we can
      // trust, but a uniquely validated continuation can still recover the
      // stream state. This is deliberately stricter than normal resync: no
      // candidate is accepted without subsequent recognised ground packets.
      const recovered = recoverValidatedGap(stream, at, rc4, knownGroundTypes, { allowCaptured: true, maximum: 8192 });
      if (recovered) { at = recovered.next; recoveredBytes += recovered.bytes; continue; }
      const twoGaps = recoverAcrossTwoGaps(stream, at, rc4, knownGroundTypes);
      if (twoGaps) { at = twoGaps.next; recoveredBytes += twoGaps.bytes; continue; }
      reason = 'invalid or incomplete frame length'; break;
    }
    if (!fullyCaptured(stream.filled, at, length)) {
      // The clear header tells us exactly how many RC4 bytes were skipped, so
      // unlike a missing header this case is safe to advance over.
      rc4.cipher(Buffer.alloc(length - FRAME_HEADER));
      at += length;
      recoveredBytes += length - FRAME_HEADER;
      continue;
    }

    const id = bytes[at + 4];
    const body = Buffer.from(bytes.subarray(at + FRAME_HEADER, at + length));
    rc4.cipher(body);
    frames++;
    if (id === MAPINFO_ID && !mapInfo) mapInfo = parseMapInfoSummary(body);
    if (id === UPDATE_ID) {
      try {
        const update = parseUpdateGround(body, knownGroundTypes);
        // A wrong key turns this shape into noise.  Ground ids are the most
        // useful, build-specific discriminator we have, so reject it early.
        if (update.tiles.length && update.knownShare < 0.98) {
          reason = `UPDATE ground types do not match the installed client (${(update.knownShare * 100).toFixed(1)}%)`;
          break;
        }
        updates.push(update);
      } catch (error) {
        reason = 'UPDATE did not parse: ' + error.message;
        break;
      }
    }
    at += length;
  }
  return { frames, recoveredFrames, recoveredBytes, bytes: at, updates, reason, mapInfo };
}

function mergeTiles(updates) {
  const tiles = new Map();
  for (const update of updates) for (const tile of update.tiles) tiles.set(tile.x + ',' + tile.y, tile.type);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const values = [...tiles].map(([key, type]) => {
    const [x, y] = key.split(',').map(Number);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    return { x, y, type };
  });
  values.sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    tiles: values,
    bounds: values.length ? { minX, maxX, minY, maxY } : null
  };
}

function mergeObjects(updates) {
  const objects = new Map();
  for (const update of updates) {
    // Additions and drops belong to one visible-world transaction.  A dropped
    // id must not linger in a visual snapshot.
    for (const object of update.objects || []) objects.set(object.id, object);
    for (const id of update.dropIds || []) objects.delete(id);
  }
  return [...objects.values()].sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
}

module.exports = { UPDATE_ID, RC4, readCompressedInt, parseUpdateGround, decodeServerStream, mergeTiles, mergeObjects };
