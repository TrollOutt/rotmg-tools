'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
// Every page script is parsed, not a list kept by hand: a new file in web/ or
// web/training/ is covered the day it lands (ROT-C-14).
const scripts = dir => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js')).sort().map(f => dir + '/' + f);
const classic = [
  ...scripts('web'), ...scripts('web/training'),
  'tools/build-training.js', 'tools/training-catalog.js', 'tests/training-index.test.js',
  'tools/build-i18n.js', 'tools/check-i18n.js', 'tests/i18n.test.js'
];
// The Skin Viewer is shipped as ES modules (web/skins is copied as is): every
// .js and .mjs file in it, subfolders included, not only its entry point.
const moduleFiles = (dir = 'web/skins') => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? moduleFiles(dir + '/' + entry.name)
    : /\.m?js$/.test(entry.name) ? [dir + '/' + entry.name] : [])
  .sort();
// Returns node's error output when the source does not parse as a module.
const moduleProblem = source => {
  const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
  return check.status === 0 ? '' : (check.stderr || 'does not parse');
};
module.exports = { moduleFiles, moduleProblem };

if (require.main === module) {
  for (const file of classic) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  const modules = moduleFiles();
  for (const file of modules) {
    const problem = moduleProblem(fs.readFileSync(path.join(root, file), 'utf8'));
    if (problem) {
      process.stderr.write(file + '\n' + problem);
      process.exit(1);
    }
  }
  console.log(`${classic.length} classic scripts and ${modules.length} Skin Viewer modules parse successfully.`);
}
