'use strict';

const { isDeepStrictEqual } = require('util');
const { createHash } = require('crypto');
const boostsOf = require('./item-stat-boosts');

// A same-build enrichment must not relabel or change the existing catalogues.
// Compare a complete rebuild first; record the re-extraction's own date/hash
// separately because a launcher can rewrite an asset without changing its GUID.
module.exports = (prior, candidate, documents) => {
  if (!prior.from?.build || prior.from.build !== candidate.from?.build) {
    throw new Error('Refusing stat-boost enrichment from a different client build');
  }
  const existingFacts = index => {
    // Compare the public JSON representation: the constructor carries optional
    // undefined properties which are absent from the committed JSON by design.
    const { built, statBoostSource, from, records, ...rest } = JSON.parse(JSON.stringify(index));
    const { date, ...identity } = from;
    return { ...rest, from: identity, records: records.map(record => {
      const { statBoosts, ...facts } = record;
      return facts;
    }) };
  };
  if (!isDeepStrictEqual(existingFacts(prior), existingFacts(candidate))) {
    throw new Error('Refusing stat-boost enrichment: rebuilt Index differs beyond statBoosts and source timestamps');
  }
  const records = prior.records.map((record, i) => {
    const { statBoosts, ...facts } = record;
    const boosts = candidate.records[i].statBoosts;
    return boosts?.length ? { ...facts, statBoosts: boosts } : facts;
  });
  return { ...prior, records, statBoostSource: {
    built: candidate.built, from: candidate.from, tool: 'tools/build-index.js --enrich-stat-boosts',
    documents: [...documents].filter(([, xml]) => boostsOf(xml).length).map(([file, xml]) => ({
      file, sha256: createHash('sha256').update(xml).digest('hex')
    }))
  } };
};
