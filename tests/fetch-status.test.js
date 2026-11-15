'use strict';
// A page that is not there is not data. Every fetch the site reads checks the
// HTTP status first, so a 404 or a 500 takes the same path as a failed request
// (the tool's own catch: an empty state or its "could not read" note) instead
// of an error page being parsed as JSON or shown as text.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { run, flush } = require('./fiches-harness');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web');

// 1. No reader takes a response body without looking at its status.
const unchecked = /\.then\(\(?(\w+)\)?\s*=>\s*\1\.(?:text|json|blob|arrayBuffer)\(\)\s*\)/g;
const offenders = [];
let checked = 0;
for (const file of fs.readdirSync(web).filter(f => f.endsWith('.js')).sort()) {
  const source = fs.readFileSync(path.join(web, file), 'utf8');
  for (const m of source.matchAll(unchecked)) {
    offenders.push(`web/${file}:${source.slice(0, m.index).split('\n').length}: ${m[0]}`);
  }
  checked += (source.match(/\.ok \? \w+\.(?:text|json|blob)\(\) : Promise\.reject\(/g) || []).length;
}
assert.deepEqual(offenders, [], 'fetch bodies read without a status check:\n' + offenders.join('\n'));
assert(checked >= 20, `expected the status-checked readers to stay in place, found ${checked}`);

// 2. On the cards: a 404 for the enrichment and the forge table leaves the
// same empty state as a request that failed outright, and its body is never read.
(async () => {
  const notFound = () => Promise.resolve({ ok: false, status: 404,
    json: () => assert.fail('a 404 body must not be read as data'),
    text: () => assert.fail('a 404 body must not be read as text') });
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));
  const served = url => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
    url.endsWith('client-forge.json') ? JSON.parse(fs.readFileSync(path.join(web, 'assets/index/client-forge.json'), 'utf8')) : {}) });

  const missing = run({ bundle: null, answer: notFound });
  const failed = run({ bundle: null, answer: offline });
  const working = run({ bundle: null, answer: served });
  await flush();
  assert.deepEqual(missing.fetched.filter(u => /client-forge|realmeye-enrichment/.test(u)).sort(),
    ['assets/index/client-forge.json', 'assets/index/realmeye-enrichment.json']);
  assert.deepEqual(JSON.stringify(missing.fiches.forgeExtra()), JSON.stringify(failed.fiches.forgeExtra()), 'a 404 forge table reads as no forge table');
  assert.deepEqual(JSON.stringify(missing.fiches.communityRecords()), JSON.stringify(failed.fiches.communityRecords()), 'a 404 enrichment reads as no enrichment');
  assert.notDeepEqual(JSON.stringify(working.fiches.forgeExtra()), JSON.stringify(failed.fiches.forgeExtra()), 'the harness tells a served table from a missing one');
  console.log(`Fetch status: ${checked} readers check the HTTP status before the body; a 404 leaves the cards' empty state, like a failed request.`);
})().catch(error => { console.error(error); process.exit(1); });
