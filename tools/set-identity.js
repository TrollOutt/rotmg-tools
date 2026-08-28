/*
 * Pins the git identity used for this repository, and installs a hook that
 * refuses any commit made under a different one.
 *
 *   node tools/set-identity.js "pseudo" "1234567+pseudo@users.noreply.github.com"
 *
 * Why this exists: the author name and email are copied into every commit and
 * pushed with it. Renaming a GitHub account afterwards does not rewrite them.
 * A single commit made under the wrong identity, once pushed to a public
 * repository, is effectively permanent — someone has already cloned it.
 *
 * The values are written to .git/config and .git/hooks/pre-commit, neither of
 * which is ever committed, so nothing here leaks into the published history.
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
 * The hook                                                         *
 * --------------------------------------------------------------- */

// It reads the pinned values from local git config rather than having them
// written into it, so arming the guard needs no identity yet: with nothing
// pinned it blocks every commit. Fail closed beats committing under a name
// chosen by accident.
const HOOK = `#!/bin/sh
# Installed by tools/set-identity.js. Delete this file to disable.
expected_name=$(git config --local --get rotmg.pinnedName)
expected_email=$(git config --local --get rotmg.pinnedEmail)
actual_name=$(git config user.name)
actual_email=$(git config user.email)

if [ -z "$expected_name" ] || [ -z "$expected_email" ]; then
  echo "" >&2
  echo "COMMIT BLOCKED - no identity has been pinned for this repository yet." >&2
  echo "" >&2
  echo "  git would record: $actual_name <$actual_email>" >&2
  echo "" >&2
  echo "Author details are permanent once pushed to a public repository." >&2
  echo "Choose deliberately, then run:" >&2
  echo "  node tools/set-identity.js \\"<handle>\\" \\"<id>+<handle>@users.noreply.github.com\\"" >&2
  echo "" >&2
  exit 1
fi

if [ "$actual_name" != "$expected_name" ] || [ "$actual_email" != "$expected_email" ]; then
  echo "" >&2
  echo "COMMIT BLOCKED - the git identity is not the one pinned for this repository." >&2
  echo "" >&2
  echo "  pinned : $expected_name <$expected_email>" >&2
  echo "  actual : $actual_name <$actual_email>" >&2
  echo "" >&2
  exit 1
fi
`;

function installHook() {
  const hookDir = path.join(root, '.git', 'hooks');
  fs.mkdirSync(hookDir, { recursive: true });
  const hookPath = path.join(hookDir, 'pre-commit');
  fs.writeFileSync(hookPath, HOOK, 'utf8');
  try { fs.chmodSync(hookPath, 0o755); } catch (error) { /* Windows ignores the mode */ }
  return hookPath;
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
console.log(`\n  pre-commit hook installed: ${path.relative(root, hookPath)}`);
console.log('  (lives in .git/, never committed, so it leaks nothing)');

if (warnings.length) {
  console.log('\nWarnings:');
  for (const line of warnings) console.log(`  ! ${line}`);
}

const authors = git('log', '--format=%an <%ae>').split('\n').filter(Boolean);
const unique = [...new Set(authors)];
console.log(`\nAuthors already in this history (${authors.length} commit(s)):`);
for (const author of unique) console.log(`  ${author}`);
console.log('');
