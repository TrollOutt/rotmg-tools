'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert/strict'), cp = require('child_process');
const root = path.join(__dirname, '..');
const provenance = require('../tools/provenance');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-projections-'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
try {
  fs.mkdirSync(path.join(temporary, 'tools'));
  fs.mkdirSync(path.join(temporary, 'data/Index'), { recursive: true });
  fs.copyFileSync(path.join(root, 'data/Index/index.json'), path.join(temporary, 'data/Index/index.json'));
  const generators = ['build-theorycraft', 'generate-item-art', 'generate-items', 'generate-enchantments', 'generate-artifacts', 'generate-fame'];
  for (const name of [...generators, 'index-model', 'provenance']) {
    fs.copyFileSync(path.join(root, 'tools', name + '.js'), path.join(temporary, 'tools', name + '.js'));
  }
  for (const name of generators) cp.execFileSync(process.execPath, [path.join(temporary, 'tools', name + '.js')]);
  // index.json and search.json are what build-index writes and what the
  // projections read; everything else in the list is projected from them.
  const projected = provenance.catalogues.filter(p =>
    !['Index/index.json', 'Index/search.json'].includes(p) && !p.startsWith('client-'));
  for (const relative of projected) {
    assert.equal(fs.readFileSync(path.join(temporary, 'data', relative), 'utf8'), read('data/' + relative), relative + ': committed projection drifted');
  }
  console.log('All six projections reproduce the shipped files with only the index present.');
  for (const relative of provenance.catalogues) {
    const target = path.join(temporary, 'data', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, read('data/' + relative));
  }
  assert.equal(provenance.check(temporary), 10);
  const target = path.join(temporary, 'data/Fame/client-fame.txt');
  const original = fs.readFileSync(target, 'utf8'), meta = provenance.read(target);
  meta.from = { ...meta.from, build: 'another-build', date: '2000-01-01' };
  fs.writeFileSync(target, original.replace(/^## provenance: .+\n/, provenance.header(meta)));
  assert.throws(() => provenance.check(temporary), error =>
    ['data/Index/index.json', 'data/Fame/client-fame.txt', '2000-01-01', 'another-build'].every(s => error.message.includes(s)));
  fs.writeFileSync(target, original.replace(/^## provenance: .+\n/, ''));
  assert.throws(() => provenance.check(temporary), /missing .*provenance/);
  fs.writeFileSync(target, original);

  /*
   * And the community join, which records the client it was joined against.
   * A join left behind by a game update is the failure this catches.
   */
  const join = path.join(temporary, 'data/Index/wiki.json');
  fs.copyFileSync(path.join(root, 'data/Index/wiki.json'), join);
  assert.equal(provenance.check(temporary), 10);
  const wiki = JSON.parse(fs.readFileSync(join, 'utf8'));
  assert.ok(wiki.from.joinedClient.build, 'The shipped join must say which client it was joined against');
  wiki.from = { ...wiki.from, joinedClient: { kind: 'client', build: 'an-older-build', date: '2000-01-01' } };
  fs.writeFileSync(join, JSON.stringify(wiki));
  assert.throws(() => provenance.check(temporary), error =>
    ['wiki.json', 'an-older-build', '2000-01-01'].every(s => error.message.includes(s)));
  fs.rmSync(join);
  const conditions = require('../tools/item-conditions');
  assert.deepEqual(conditions('<Projectile id="2"><ConditionEffect duration="2.5">Weak</ConditionEffect></Projectile>'),
    [{ on: 'hit', projectile: '2', effect: 'Weak', duration: '2.5' }]);
  assert.deepEqual(conditions('<Activate effect="Invincible" duration="86400">ConditionEffectSelf</Activate>'),
    [{ on: 'ConditionEffectSelf', trigger: 'Activate', effect: 'Invincible', duration: '86400' }]);
  console.log('Provenance mismatch, missing header, and observed condition shapes verified.');
} finally {
  // mkdtemp created this directory; never remove a caller-supplied path.
  assert.equal(path.dirname(fs.realpathSync(temporary)), fs.realpathSync(os.tmpdir()));
  assert(path.basename(temporary).startsWith('realm-projections-'));
  fs.rmSync(temporary, { recursive: true, force: true });
}
