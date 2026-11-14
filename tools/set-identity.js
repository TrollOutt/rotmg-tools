/*
 * Pins the git identity used for this repository, and installs a hook that
 * refuses any commit made under a different one.
 *
 *   node tools/set-identity.js "pseudo" "1234567+pseudo@users.noreply.github.com"
 *
 * Why this exists: the author name and email are copied into every commit and
 * are not rewritten afterwards, so a machine configured with a personal address
 * will put it in a public history the first time you forget. Pinning the
 * GitHub noreply address per repository makes that impossible rather than
 * merely unlikely, and the hook fails closed: with nothing pinned it refuses
 * every commit instead of guessing.
 *
 * The values are written to .git/config, which is never committed. The hooks
 * themselves come from tools/hooks (see tools/hooks/install.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const [name, email] = process.argv.slice(2);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/* --------------------------------------------------------------- *
 * The hooks                                                        *
 * --------------------------------------------------------------- */

// The hooks are versioned in tools/hooks and installed by tools/hooks/install.js
// into the hooks directory shared by every worktree. They read the pinned
// values from local git config rather than having them written into them, so
// arming the guard needs no identity yet: with nothing pinned they block every
// commit. Hooks already there that were not installed by it (local guards) are
// kept as <hook>.local and still run, so re-running this script never removes
// them.
const { installHooks } = require('./hooks/install');

function installHook() {
  return path.join(installHooks(root).hooksDir, 'pre-commit');
}

// `--arm` installs the guard before a pseudonym has been chosen, so no commit
// can slip through in the meantime.
if (process.argv.includes('--arm')) {
  const hookPath = installHook();
  console.log(`\nGuard armed: ${path.relative(root, hookPath)}`);
  console.log(`Without the guard git would record: ${git('config', 'user.name')} <${git('config', 'user.email')}>`);
  console.log('Every commit is blocked until an identity is pinned.\n');
  process.exit(0);
}

if (!name || !email) {
  fail([
    'Usage:  node tools/set-identity.js "<name>" "<email>"',
    '        node tools/set-identity.js --arm     (block commits until one is chosen)',
    '',
    'Do this AFTER renaming the GitHub account, not before: the no-reply address',
    'contains the username at the moment it is issued, and that string stays in',
    'every commit for good.',
    '',
    'Find the address at  GitHub -> Settings -> Emails -> "Keep my email addresses',
    'private". It looks like  1234567+yourname@users.noreply.github.com'
  ].join('\n'));
}

/* --------------------------------------------------------------- *
 * Sanity checks on the identity itself                             *
 * --------------------------------------------------------------- */

const warnings = [];
if (!/@/.test(email)) fail(`"${email}" is not an email address.`);
if (!email.endsWith('@users.noreply.github.com')) {
  warnings.push('The address is not a GitHub no-reply one, so your real mailbox will be');
  warnings.push('visible in every commit. Consider the no-reply address instead.');
}
if (/\s/.test(email)) fail('The email address contains a space.');

// A pseudonym that still contains a real-looking full name defeats the point.
if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name)) {
  warnings.push(`"${name}" is shaped like a real first name + surname.`);
  warnings.push('If you meant to stay anonymous, pick a handle instead.');
}

/* --------------------------------------------------------------- *
 * Apply                                                            *
 * --------------------------------------------------------------- */

// Local config beats the account-wide one, so this identity applies here only.
git('config', '--local', 'user.name', name);
git('config', '--local', 'user.email', email);
git('config', '--local', 'rotmg.pinnedName', name);
git('config', '--local', 'rotmg.pinnedEmail', email);
const hookPath = installHook();

/* --------------------------------------------------------------- *
 * Report                                                           *
 * --------------------------------------------------------------- */

console.log('\nIdentity pinned for this repository only:\n');
console.log(`  name  : ${git('config', 'user.name')}`);
console.log(`  email : ${git('config', 'user.email')}`);
console.log(`\n  account-wide value, now overridden here: ${git('config', '--global', 'user.name')}`);
console.log(`\n  identity hooks installed: ${path.relative(root, path.dirname(hookPath))}`);
console.log('  (from tools/hooks; also checks merges, rewrites and every push)');

if (warnings.length) {
  console.log('\nWarnings:');
  for (const line of warnings) console.log(`  ! ${line}`);
}

const authors = git('log', '--format=%an <%ae>').split('\n').filter(Boolean);
const unique = [...new Set(authors)];
console.log(`\nAuthors already in this history (${authors.length} commit(s)):`);
for (const author of unique) console.log(`  ${author}`);
console.log('');
