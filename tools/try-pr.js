#!/usr/bin/env node
'use strict';
/*
 * Try someone's pull request on this machine before merging it.
 *
 *     npm run pr                 # the open pull requests
 *     npm run pr -- 18           # PR 18, merged with the latest main, served
 *     npm run pr -- 18 --clean   # done with it: remove its copy
 *
 * The pull request goes in a copy of the repository of its own
 * (../ROTMG-worktrees/PR-<n>), merged with origin/main without committing,
 * so what you see is what main would become. Your own checkout, its
 * uncommitted work and its preview server are left alone.
 *
 * The site is then served at http://127.0.0.1:5201/web/index.html and opened
 * in your browser (--no-open to skip that); Ctrl+C stops it. Its own address
 * means its own browser storage: ticks made while trying it do not reach the
 * site you use every day.
 *
 * Nothing here runs the pull request's Node code: the browser runs its page
 * scripts, inside the page. The tests run on GitHub (the "checks" job, read
 * only, no secrets); their result is printed below. A first-time contributor's
 * run waits until "Approve and run workflows" is clicked on the pull request.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TREES = path.resolve(ROOT, '..', 'ROTMG-worktrees');
const PORT = 5201;

const show = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const read = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
const tryRead = (cmd, args, cwd = ROOT) => {
  try { return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (error) { return ''; }
};
const fail = message => { console.error(message); process.exit(1); };

// gh would otherwise ask the upstream remote, which has none of these pull requests.
const repo = (read('git', ['remote', 'get-url', 'origin']).match(/github\.com[/:](.+?\/.+?)(?:\.git)?$/) || [])[1]
  || fail('origin is not a GitHub repository.');
const gh = (args, quiet) => quiet ? tryRead('gh', [...args, '--repo', repo]) : show('gh', [...args, '--repo', repo]);

const args = process.argv.slice(2);
const number = args.find(arg => !arg.startsWith('--'));
if (!number) {
  gh(['pr', 'list']);
  console.log('\nnpm run pr -- <number>   to try one');
  process.exit(0);
}
if (!/^\d+$/.test(number)) fail(`Not a pull request number: ${number}`);

const ref = `refs/pr/${number}`;
const tree = path.join(TREES, `PR-${number}`);

if (args.includes('--clean')) {
  if (fs.existsSync(tree)) show('git', ['worktree', 'remove', '--force', tree]);
  tryRead('git', ['update-ref', '-d', ref]);
  console.log(`PR ${number}: copy removed.`);
  process.exit(0);
}

show('git', ['fetch', '--quiet', 'origin', `+pull/${number}/head:${ref}`, '+main:refs/remotes/origin/main']);

if (fs.existsSync(tree)) {
  // A second look after the contributor pushed again: start over from their tip.
  tryRead('git', ['merge', '--abort'], tree);
  show('git', ['checkout', '--quiet', '--force', '--detach', ref], tree);
  show('git', ['clean', '-fdq'], tree);
} else {
  fs.mkdirSync(TREES, { recursive: true });
  show('git', ['worktree', 'add', '--quiet', '--detach', tree, ref]);
}

console.log('');
gh(['pr', 'view', number]);
console.log('\nFiles changed:');
show('git', ['diff', '--stat=100', `origin/main...${ref}`]);

try {
  read('git', ['merge', '--no-commit', '--no-ff', 'origin/main'], tree);
} catch (error) {
  fail(`\nPR ${number} conflicts with main; ask the contributor to update it.\n${error.stdout || ''}`);
}

console.log('\nTests on GitHub:');
console.log(gh(['pr', 'checks', number], true)
  ||'  none yet: click "Approve and run workflows" on the pull request if it asks for it.');

const url = `http://127.0.0.1:${PORT}/web/index.html`;
console.log(`\nPR ${number} merged with main, served at ${url}  (Ctrl+C to stop)`);
console.log(`To accept it: gh pr merge ${number} --merge --repo ${repo}   (or the Merge button on GitHub)`);
console.log(`To refuse it: gh pr close ${number} --repo ${repo} --comment "..."`);
console.log(`Afterwards:   npm run pr -- ${number} --clean\n`);

const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', tree],
  { stdio: 'ignore' });
server.on('exit', code => {
  if (code === 1) console.error(`The server stopped (exit ${code}): is port ${PORT} already in use by another try?`);
  process.exit(code || 0);
});
if (!args.includes('--no-open')) {
  setTimeout(() => spawn(process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref(), 800);
}
