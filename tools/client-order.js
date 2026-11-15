/*
 * Is the client about to be read older than the one the published data came
 * from? (ROT-B-07)
 *
 * Without ROTMG_CLIENT the extraction reads whatever client is installed, and
 * provenance only checks that the files agree with each other, so a scrape on
 * a machine whose game has not updated rewrote all of data/ from an older
 * build, consistently, and every check passed. data/client-snapshot.txt, which
 * every scrape rewrites, opens with the provenance of the published data.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SNAPSHOT = path.join(__dirname, '..', 'data', 'client-snapshot.txt');

/* The {build, date} of the published data, from the snapshot's first line. */
function publishedClient(text) {
  const line = String(text || '').split(/\r?\n/, 1)[0];
  const match = /^## provenance: (\{.*\})\s*$/.exec(line);
  if (!match) return null;
  try {
    const from = JSON.parse(match[1]).from;
    return from && from.build && /^\d{4}-\d{2}-\d{2}$/.test(from.date || '') ? { build: from.build, date: from.date } : null;
  } catch (_) {
    return null;
  }
}

/* "" when the candidate may replace the published client, else why not. */
function olderProblem(candidate, published) {
  if (!published || !candidate || !candidate.date) return '';
  if (candidate.date < published.date) {
    return `this client (build ${candidate.build || '?'}, ${candidate.date}) is older than the one the published data `
      + `comes from (build ${published.build}, ${published.date})`;
  }
  return '';
}

function checkNotOlder(candidate, { allow = false, snapshot = SNAPSHOT } = {}) {
  const published = fs.existsSync(snapshot) ? publishedClient(fs.readFileSync(snapshot, 'utf8')) : null;
  const problem = olderProblem(candidate, published);
  if (problem && !allow) {
    throw new Error(problem + '. Update the game, or use node tools/fetch-client.js --scrape; '
      + 'to go back on purpose, pass --allow-older or set ROTMG_ALLOW_OLDER_CLIENT=1.');
  }
  return problem;
}

module.exports = { publishedClient, olderProblem, checkNotOlder };
