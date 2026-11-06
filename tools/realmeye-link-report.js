'use strict';
/*
 * Which Index records still have no RealmEye page, said after every scrape.
 *
 *   node tools/realmeye-link-report.js
 *
 * Two lists, because they call for different work:
 *   - the records of the latest update (What's New) with no page: the pages a
 *     targeted RealmEye refresh should fetch, tools/watch-realmeye.js --seed;
 *   - every record a tool shows (Theory Crafting's gear and creatures, the
 *     portals) with no page: gaps the matching rules do not cover yet.
 * A record RealmEye lists as unreleased is left out of both: it has no page
 * yet for a reason. The wiki address given is the likely one, a guess to
 * check, never a link the data relies on.
 *
 * It only reports and always exits 0: a missing page is RealmEye's to write,
 * not a reason to stop an update.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function report(index, enrichment, availability, whatsNew) {
  const linked = new Set(Object.entries(enrichment.records)
    .filter(([, record]) => !record.communityOnly).map(([id]) => id));
  const unreleased = new Set(Object.keys(availability.records || {}));
  const byId = new Map(index.records.map(record => [record.id, record]));
  const missing = id => !linked.has(id) && !unreleased.has(id);

  const theory = index.views.theory;
  const shown = [
    ['Theory gear', theory.items],
    ['Theory creatures', theory.bosses],
    ['Portals', index.records.filter(r => r.kind === 'portal' && !r.hidden).map(r => r.id)]
  ].map(([label, ids]) => {
    const wanted = ids.filter(id => !unreleased.has(id));
    return { label, total: wanted.length, without: wanted.filter(missing) };
  });

  // What's New names things as the game shows them; one name can be several records.
  const byName = new Map();
  for (const record of index.records) {
    for (const name of new Set([record.name, record.said])) {
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(record.id);
    }
  }
  const latest = { made: whatsNew.made, total: 0, without: [], outsideIndex: 0 };
  const seen = new Set();
  for (const drawer of Object.values(whatsNew.drawers)) {
    for (const entry of [...(drawer.added || []), ...(drawer.changed || [])]) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const ids = (byName.get(entry.id) || []).filter(id => !unreleased.has(id));
      if (!ids.length) { latest.outsideIndex++; continue; }
      latest.total++;
      if (!ids.some(id => linked.has(id))) latest.without.push(ids[0]);
    }
  }
  return { latest, shown };
}

function print({ latest, shown }, index) {
  const line = id => {
    const record = index.records.find(r => r.id === id);
    return `    ${id.padEnd(58)} realmeye.com/wiki/${slugOf(record.name || id.split(':')[1])} ?`;
  };
  console.log(`\n  RealmEye links, Index build ${index.from.build}\n`);
  console.log(`  Latest update (What's New ${latest.made}): ${latest.total - latest.without.length}/${latest.total} with a page`
    + (latest.outsideIndex ? `, ${latest.outsideIndex} not in the Index` : ''));
  for (const id of latest.without) console.log(line(id));
  for (const group of shown) {
    console.log(`\n  ${group.label}: ${group.total - group.without.length}/${group.total} with a page`);
    for (const id of group.without) console.log(line(id));
  }
  console.log('');
}

module.exports = { report, slugOf };

if (require.main === module) {
  const index = read('data/Index/index.json');
  print(report(index, read('data/Index/realmeye-enrichment.json'), read('data/Index/availability.json'),
    read('web/assets/whats-new/index.json')), index);
}
