'use strict';
const fs = require('fs');
const path = require('path');

// `built` is generation time; `from` identifies the source, never a local path.
function stamp(tool, from, built = new Date().toISOString()) {
  if (!from || !from.build || from.build === 'unknown') throw new Error('A verified source build is required');
  return { built, from, tool: 'tools/' + path.basename(tool) };
}
function clientStamp(directory, tool) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
  return stamp(tool, manifest.from);
}
function header(meta) { return '## provenance: ' + JSON.stringify(meta) + '\n'; }
function read(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return JSON.parse(raw);
  const match = /^## provenance: (.+)$/m.exec(raw);
  return match ? JSON.parse(match[1]) : null;
}
const catalogues = [
  'Index/index.json', 'Index/search.json', 'TheoryCraft/theorycraft.json',
  'Items/client-items.txt', 'Enchantment documents/client-enchantments.txt',
  'Artifacts/client-artifacts.txt', 'Fame/client-fame.txt', 'client-snapshot.txt', 'client-changes.txt'
];
function check(root) {
  let first;
  const discovered = new Set(catalogues);
  /*
   * Only what the repository actually carries.
   *
   * data/ is also where a working copy accumulates its own scratch - a decoder
   * writes a json there, someone drops a capture in - and a file git has never
   * heard of is not one this repository is promising anything about. Asking git
   * what it tracks keeps the check honest about published data and stops it
   * failing on a machine that happens to have something else lying about. If
   * git cannot answer, everything is checked, which is the older behaviour.
   */
  let tracked = null;
  try {
    tracked = new Set(require('child_process')
      .execFileSync('git', ['-C', root, 'ls-files', 'data'], { encoding: 'utf8' })
      .split('\n').filter(Boolean));
  } catch (err) { tracked = null; }
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.(json|txt)$/.test(entry.name)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      if (!entry.name.endsWith('.json') && !/^## (?:provenance:|Written by tools\/)/m.test(raw)) continue;
      const relative = path.relative(path.join(root, 'data'), file).split(path.sep).join('/');
      if (tracked && !tracked.has('data/' + relative)) continue;
      const meta = read(file);
      if (!meta?.built || !meta?.tool || !meta?.from?.kind) throw new Error('data/' + relative + ': missing source provenance');
      if (meta.from.kind === 'client') discovered.add(relative);
    }
  }
  walk(path.join(root, 'data'));
  for (const relative of discovered) {
    const file = 'data/' + relative, meta = read(path.join(root, file));
    if (!meta?.built || !meta?.tool || meta?.from?.kind !== 'client' || !meta.from.build || !meta.from.date) {
      throw new Error(file + ': missing client provenance (built, from.build, from.date, tool)');
    }
    if (!first) first = { file, meta };
    if (meta.from.build !== first.meta.from.build || meta.from.date !== first.meta.from.date) {
      throw new Error(`Client provenance mismatch: ${first.file} (${first.meta.from.date}, ${first.meta.from.build}) versus ${file} (${meta.from.date}, ${meta.from.build}). Rebuild the catalogues from one client.`);
    }
    if (relative === 'client-snapshot.txt') {
      const build = /^build\|(.+)$/m.exec(fs.readFileSync(path.join(root, file), 'utf8'))?.[1].trim();
      if (build !== meta.from.build) throw new Error(file + ': header disagrees with snapshot build ' + build);
    }
  }
  return discovered.size;
}
module.exports = { stamp, clientStamp, header, read, check, catalogues };
