/*
 * What the RealmEye sprite cache accepts (ROT-B-15): an image, from RealmEye,
 * after at most a few redirects. tools/fetch-realmeye-index-sprites.js used to
 * follow any redirect anywhere and write whatever came back under a .png name,
 * so an error page answered with a 200 would have been published as a sprite.
 */
'use strict';

const MAX_REDIRECTS = 5;

/* "png", "gif", "webp" or "jpeg" from the first bytes, or null. */
function imageKind(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head = bytes.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

/* realmeye.com or one of its subdomains, over https. */
function isRealmEye(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'realmeye.com' || parsed.hostname.endsWith('.realmeye.com'));
  } catch (_) {
    return false;
  }
}

/* The next URL of a redirect, or an error when it leaves RealmEye or goes on too long. */
function redirectTarget(location, current, hops) {
  if (hops >= MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects: ${current}`);
  if (!location) throw new Error(`redirect without a location: ${current}`);
  const next = new URL(location, current).href;
  if (!isRealmEye(next)) throw new Error(`redirect away from RealmEye: ${next}`);
  return next;
}

/* get(url, options, callback) - https.get - called only for a RealmEye address; throws before any request otherwise. */
function realmEyeGet(get, url, options, callback) {
  if (!isRealmEye(url)) throw new Error(`not a RealmEye address, not requested: ${url}`);
  return get(url, options, callback);
}

module.exports = { MAX_REDIRECTS, imageKind, isRealmEye, redirectTarget, realmEyeGet };
