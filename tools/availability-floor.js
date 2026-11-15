/*
 * The floor under data/Index/availability.json (ROT-B-03), shared by
 * check-index.js and its test.
 *
 * An empty list passes every per-record check, and that is exactly what a
 * change of layout on the RealmEye Unreleased page produces. 37 records are
 * listed at the time of writing; under 10 is a broken read, not a release.
 * ROTMG_ACCEPT_DATA_CHANGES=1 lets a list really that short through, and
 * says so.
 */
'use strict';

const MIN_RECORDS = 10;

/* "" when the list is believable, else why not. */
function floorProblem(availability) {
  const count = Object.keys((availability && availability.records) || {}).length;
  if (count < MIN_RECORDS) return `availability.json lists ${count} records (floor ${MIN_RECORDS}); the Unreleased page was probably misread`;
  for (const [status, page] of Object.entries((availability && availability.pages) || {})) {
    if (!(page.listed > 0 && page.records > 0)) return `availability.json: the ${status} page listed nothing`;
  }
  return '';
}

/* Throws on a problem unless accepted; returns the line to print when accepted. */
function checkFloor(availability, env = process.env) {
  const problem = floorProblem(availability);
  if (!problem) return '';
  if (env.ROTMG_ACCEPT_DATA_CHANGES === '1') return `warning: ${problem} (accepted by ROTMG_ACCEPT_DATA_CHANGES)`;
  throw new Error(problem + '. Check the page, or set ROTMG_ACCEPT_DATA_CHANGES=1 if the list really is that short.');
}

module.exports = { MIN_RECORDS, floorProblem, checkFloor };
