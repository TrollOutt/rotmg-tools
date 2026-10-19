'use strict';

// All declarations and numbers below are SYNTHETIC parser fixtures.
// They are not evidence about any RotMG item and are never published as data.
const assert = require('assert/strict');
const boostsOf = require('../tools/item-stat-boosts');
const model = require('../tools/index-model');

const body = `
  <Item /><Consumable />
  <Activate amount="17">Heal</Activate>
  <Activate channel="synthetic-channel" duration="2.5" amount="37" stat="MAXHP">StatBoostSelf</Activate>
  <Activate stat="VIT" amount="-3" duration="4" range="9" onlyIn="synthetic-area"
    requiredConditions="Synthetic Condition" maxTargets="2">StatBoostAura</Activate>
  <OnPlayerHitActivate proc="0.25" cooldown="11" hpMinThresholdRelative="0.4"
    stat="HP" amount="0.2" duration="6" statRelativeTo="MAXHP" future-flag="opaque">
    StatBoostSelf
  </OnPlayerHitActivate>
  <Activate stat='MAXMP' duration='8' multiplier='1.2'>StatBoostSelf</Activate>
  <Activate stat="MAXHP" amount="99">IncrementStat</Activate>
  <Activate effect="Healing" duration="3">ConditionEffectSelf</Activate>
  <!-- <Activate stat="MAXHP" amount="999">StatBoostSelf</Activate> -->
`;
const expected = [
  { on: 'StatBoostSelf', trigger: 'Activate', attributes: {
    channel: 'synthetic-channel', duration: '2.5', amount: '37', stat: 'MAXHP' } },
  { on: 'StatBoostAura', trigger: 'Activate', attributes: {
    stat: 'VIT', amount: '-3', duration: '4', range: '9', onlyIn: 'synthetic-area',
    requiredConditions: 'Synthetic Condition', maxTargets: '2' } },
  { on: 'StatBoostSelf', trigger: 'OnPlayerHitActivate', attributes: {
    proc: '0.25', cooldown: '11', hpMinThresholdRelative: '0.4', stat: 'HP',
    amount: '0.2', duration: '6', statRelativeTo: 'MAXHP', 'future-flag': 'opaque' } },
  { on: 'StatBoostSelf', trigger: 'Activate', attributes: {
    stat: 'MAXMP', duration: '8', multiplier: '1.2' } }
];
for (const boost of expected) boost.otherActivations = [
  { on: 'Heal', trigger: 'Activate' }, { on: 'IncrementStat', trigger: 'Activate' },
  { on: 'ConditionEffectSelf', trigger: 'Activate' }
];
assert.deepEqual(boostsOf(body), expected, 'all boosts retain raw attributes and their trigger in source order');
assert.equal(Object.hasOwn(expected[3].attributes, 'amount'), false, 'no amount is inferred for proportional or incomplete declarations');
assert.deepEqual(boostsOf('<Activate>StatBoostSelf</Activate>'), [
  { on: 'StatBoostSelf', trigger: 'Activate', attributes: {} }
], 'missing stat, amount and duration are not filled in');
assert.deepEqual(boostsOf('<Activate stat="MAXHP" amount="NaN" duration="-1">StatBoostSelf</Activate>')[0].attributes,
  { stat: 'MAXHP', amount: 'NaN', duration: '-1' }, 'extraction preserves invalid declarations for consumers to reject');
assert.deepEqual(boostsOf('<Activate stat="MAXHP">StatBoostSelf</ActivateOnEquip>'), [], 'mismatched tags do not form an activation');
assert.deepEqual(boostsOf(''), []);

// Exercise the same attachment path used by build-index / the SQLite source.
// The existing compact Theory projection must not gain this new Index field.
function attach(xml) {
  const record = { id: 'item:Synthetic fixture', kind: 'item', name: 'Synthetic fixture' };
  const records = new Map([[record.id, record]]);
  const mechanics = { items: [{ id: record.name, name: record.name, does: 'Heal' }], classes: [], enchants: [], sets: [], bosses: [],
    itemOf: () => ({ id: record.name, does: 'Heal' }) };
  const theory = model.attach(records, mechanics, [{ id: record.name, body: xml }]);
  return { records: [record], views: { theory } };
}
const index = attach(body);
assert.deepEqual(index.records[0].statBoosts, expected);
assert.equal(index.records[0].activate, 'Heal', 'the existing first activation verb stays compatible');
assert.equal(index.records[0].conditions[0].effect, 'Healing', 'status extraction stays intact');
const baseline = attach(body.replace(/<(\w*Activate\w*)\b[^>]*>\s*StatBoost(?:Self|Aura)\s*<\/\1>/g, ''));
assert.deepEqual(model.project(index), model.project(baseline), 'stat boosts remain additive Index data, outside the Theory runtime schema');
assert.equal(Object.hasOwn(baseline.records[0], 'statBoosts'), false, 'objects without boosts gain no field');
assert.deepEqual(boostsOf('<Activate on="raw" trigger="raw" target="raw">StatBoostAura</Activate>'), [
  { on: 'StatBoostAura', trigger: 'Activate', attributes: { on: 'raw', trigger: 'raw', target: 'raw' } }
], 'opaque attributes cannot replace the activation identity or invent aura recipients');

const enrich = require('../tools/index-stat-boost-enrichment');
const prior = { built: 'synthetic-original', from: { kind: 'client', build: 'synthetic-build', date: '2000-01-01' }, records: [{ id: 'synthetic' }] };
const candidate = { ...prior, built: 'synthetic-regenerated', from: { ...prior.from, date: '2000-01-02' }, records: [{ id: 'synthetic', statBoosts: expected }] };
const enriched = enrich(prior, candidate, new Map([['Synthetic.xml', body]]));
assert.doesNotThrow(() => enrich(prior, { ...candidate, optional: undefined }, new Map()), 'absent JSON optionals are not fact changes');
assert.deepEqual(enriched.from, prior.from, 'same-build enrichment preserves the original catalogue source date');
assert.equal(enriched.built, prior.built);
assert.deepEqual(enriched.statBoostSource.from, candidate.from, 'the extraction date is recorded separately, never disguised');
assert.equal(enriched.statBoostSource.documents[0].sha256, require('crypto').createHash('sha256').update(body).digest('hex'));
assert.equal(Object.hasOwn(prior.records[0], 'statBoosts'), false, 'the comparison never mutates its baseline');
assert.throws(() => enrich(prior, { ...candidate, from: { ...candidate.from, build: 'other' } }, new Map()), /different client build/);
assert.throws(() => enrich(prior, { ...candidate, records: [{ ...candidate.records[0], unexpected: true }] }, new Map()), /differs beyond/);

// Optional local acceptance gate: compare every real item declaration with its
// generated Index record. CI uses the committed projection and synthetic tests.
if (process.env.ROTMG_CLIENT_DATA) {
  const fs = require('fs'), path = require('path');
  const source = process.env.ROTMG_CLIENT_DATA;
  const realIndex = require('../data/Index/index.json');
  const meta = JSON.parse(fs.readFileSync(path.join(source, 'provenance.json'), 'utf8'));
  assert.equal(meta.from.build, realIndex.from.build);
  const byClient = new Map(realIndex.records.filter(r => r.kind === 'item').map(r => [r.clientId || r.alias || r.name, r]));
  let checked = 0;
  for (const file of realIndex.statBoostSource.documents) {
    const xml = fs.readFileSync(path.join(source, file.file), 'utf8');
    assert.equal(require('crypto').createHash('sha256').update(xml).digest('hex'), file.sha256);
    for (const m of xml.matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
      const id = /\bid="([^"]*)"/.exec(m[1])?.[1], record = byClient.get(id);
      if (!record || !/<Item\s*\/>/.test(m[2])) continue;
      const extracted = boostsOf(m[2]);
      assert.deepEqual(record.statBoosts || [], extracted, record.id + ': real XML boost extraction');
      if (extracted.length) checked++;
    }
  }
  assert(checked > 0);
  console.log('Real XML boost declarations checked against the Index: ' + checked + ' (build ' + meta.from.build + ').');
}
console.log('Index stat boosts: extraction, conditions, source guards and projection compatibility passed.');
