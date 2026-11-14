/*
 * Installs the identity hooks of tools/hooks into this repository.
 *
 *   node tools/hooks/install.js
 *
 * Run it once in every new clone. The hooks go into the hooks directory that
 * git shares between a repository and all its worktrees (or core.hooksPath
 * when it is set), so one run protects every worktree.
 *
 * - When no identity is pinned yet, it pins the project identity read from
 *   tools/hooks/project-identity (rotmg.pinnedName / rotmg.pinnedEmail, and
 *   user.name / user.email, all in the local config only).
 * - An existing hook that was not installed by this script is kept: it is
 *   renamed <hook>.local and the new hook runs it after its own checks.
 * - <hook>.local files are never overwritten: they hold local-only guards.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARKER = 'rotmg-hooks:managed';
const HOOKS = ['pre-commit', 'commit-msg', 'pre-merge-commit', 'post-commit', 'post-rewrite', 'pre-push'];
const FILES = ['rotmg-identity.sh', 'allowed-message-addresses', ...HOOKS];
const SOURCE = __dirname;

function git(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    return '';
  }
}

function readProjectIdentity() {
  const file = path.join(SOURCE, 'project-identity');
  if (!fs.existsSync(file)) return null;
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(name|email)\s*=\s*(.+?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values.name && values.email ? values : null;
}

function installHooks(cwd = process.cwd()) {
  const top = git(cwd, 'rev-parse', '--show-toplevel');
  if (!top) throw new Error('Not inside a git repository.');
  const hooksDir = path.resolve(top, git(top, 'rev-parse', '--git-path', 'hooks'));
  fs.mkdirSync(hooksDir, { recursive: true });
  const kept = [];

  for (const name of FILES) {
    const target = path.join(hooksDir, name);
    if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(MARKER)) {
      // A hook written by hand or by another tool: keep it and chain it.
      let keep = `${target}.local`;
      if (fs.existsSync(keep)) keep = `${target}.before-install-${Date.now()}`;
      fs.renameSync(target, keep);
      kept.push(path.basename(keep));
    }
    const content = fs.readFileSync(path.join(SOURCE, name), 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(target, content, 'utf8');
    try { fs.chmodSync(target, 0o755); } catch (error) { /* Windows ignores the mode */ }
  }
  return { top, hooksDir, kept };
}

function pinIfNeeded(top) {
  const pinnedName = git(top, 'config', '--local', '--get', 'rotmg.pinnedName');
  const pinnedEmail = git(top, 'config', '--local', '--get', 'rotmg.pinnedEmail');
  const project = readProjectIdentity();
  if (pinnedName && pinnedEmail) {
    if (project && (project.name !== pinnedName || project.email !== pinnedEmail)) {
      console.log('  note: the pinned identity differs from tools/hooks/project-identity (kept as is).');
    }
    return 'already pinned';
  }
  if (!project) return 'nothing pinned: every commit is blocked until node tools/set-identity.js is run';
  for (const [key, value] of [['rotmg.pinnedName', project.name], ['rotmg.pinnedEmail', project.email],
    ['user.name', project.name], ['user.email', project.email]]) {
    execFileSync('git', ['config', '--local', key, value], { cwd: top });
  }
  return `pinned the project identity from tools/hooks/project-identity (${project.name})`;
}

module.exports = { installHooks, pinIfNeeded };

if (require.main === module) {
  try {
    const { top, hooksDir, kept } = installHooks();
    console.log(`\nIdentity hooks installed in ${path.relative(top, hooksDir) || hooksDir}`);
    console.log(`  ${HOOKS.join(', ')}`);
    for (const name of kept) {
      if (name.endsWith('.local')) console.log(`  previous hook kept and chained: ${name}`);
      else console.log(`  WARNING: previous hook kept but no longer run: ${name} (a .local already existed; merge it by hand)`);
    }
    console.log(`  identity: ${pinIfNeeded(top)}\n`);
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}
