#!/bin/sh
# Replays the identity hook checks in a throwaway clone of this repository.
# Nothing in this repository changes; only made-up identities are used.
#
#   sh tools/hooks/test-hooks.sh
#
# Needs git (with its sh) and node. No network.
set -u
here=$(cd "$(dirname "$0")" && pwd)
src=$(git -C "$here" rev-parse --show-toplevel)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/rotmg-hooks-test.XXXXXX")

# Keep the account-wide git config out of the way: the tests must never fall
# back to whatever identity this machine has.
export GIT_CONFIG_GLOBAL="$tmp/empty-gitconfig"
: > "$GIT_CONFIG_GLOBAL"
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
export GIT_EDITOR=true GIT_MERGE_AUTOEDIT=no

me_name=hooks-test
me_email=hooks-test@example.invalid
other_name=someone-else
# Not a reserved example domain: messages naming it must be refused.
other_email=someone-else@elsewhere-mail.org

pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ok   - $1"; }
ko() { fail=$((fail + 1)); echo "  FAIL - $1"; sed 's/^/         /' "$tmp/out"; }
accepted() { d=$1; shift; if "$@" >"$tmp/out" 2>&1; then ok "accepted: $d"; else ko "should be accepted: $d"; fi; }
refused() { d=$1; shift; if "$@" >"$tmp/out" 2>&1; then ko "should be refused: $d"; else ok "refused:  $d"; fi; }
# Refused, or at least reported by a warning hook (for commands git runs
# without a blocking hook).
detected() {
  d=$1; shift
  if ! "$@" >"$tmp/out" 2>&1; then ok "refused:  $d"
  elif grep -q 'another identity' "$tmp/out"; then ok "warned:   $d"
  else ko "should be detected: $d"; fi
}
reset_to() { git cherry-pick --abort >/dev/null 2>&1; git merge --abort >/dev/null 2>&1; git rebase --abort >/dev/null 2>&1; git reset -q --hard "$1"; }
commit_file() { echo "$1" > "$1.txt" && git add "$1.txt" && shift && git commit -q -m "$@"; }

echo "Throwaway clone: $tmp/clone"
git clone -q --no-checkout "$src" "$tmp/clone" || exit 1
cd "$tmp/clone" || exit 1
hooks=$(git rev-parse --git-path hooks)
mkdir -p "$hooks"
printf '#!/bin/sh\nexit 0\n' > "$hooks/pre-push"   # a hook installed by hand before

echo "Install"
node "$here/install.js" >"$tmp/out" 2>&1 && ok "install.js runs" || ko "install.js runs"
for h in pre-commit commit-msg pre-merge-commit post-commit post-rewrite pre-push; do
  grep -q rotmg-hooks:managed "$hooks/$h" 2>/dev/null || { echo "missing $h" > "$tmp/out"; ko "hook $h installed"; }
done
grep -q "private list is empty" "$tmp/out" && ok "install.js warns that the private list is empty" || ko "install.js warns that the private list is empty"
terms="$(git rev-parse --git-common-dir)/rotmg-private-terms"
[ -f "$terms" ] && [ ! -s "$terms" ] && ok "install.js creates an empty private list" || ko "install.js creates an empty private list"
[ -f "$hooks/pre-push.local" ] && ok "previous pre-push kept as pre-push.local" || ko "previous pre-push kept as pre-push.local"
expected_pin=$(sed -n 's/^name=//p' "$here/project-identity")
[ "$(git config --local rotmg.pinnedName)" = "$expected_pin" ] && ok "project identity pinned from tools/hooks/project-identity" || ko "project identity pinned"

# From here on, a made-up project identity.
git config --local rotmg.pinnedName "$me_name"
git config --local rotmg.pinnedEmail "$me_email"
git config --local user.name "$me_name"
git config --local user.email "$me_email"
git switch -q --orphan hooks-test
git rm -rq --cached . >/dev/null 2>&1

echo "Commits"
accepted "commit with the project identity" commit_file a "a"
accepted "commit with a Claude Co-Authored-By trailer" git commit -q --allow-empty -m "t" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
accepted "commit message with reserved example addresses" git commit -q --allow-empty -m "see user@example.com, a@b.example.org, x@host.invalid, y@ci.test"
accepted "commit message with an ordinary 'at' (fail at index.html)" git commit -q --allow-empty -m "fix: fail at index.html when empty"
base=$(git rev-parse HEAD)
refused "commit with a foreign Co-authored-by trailer" git commit -q --allow-empty -m "t" -m "Co-authored-by: $other_name <$other_email>"
refused "commit message with a foreign address" git commit -q --allow-empty -m "write to $other_email"
git config --global user.name "Global Person"
git config --global user.email "global.person@example.invalid"
refused "commit message naming the account-wide git name" git commit -q --allow-empty -m "thanks Global Person"
git config --global --unset user.name
git config --global --unset user.email
echo "Zorblax Quux" > "$terms"
refused "commit message with a term of the private list (no global identity)" git commit -q --allow-empty -m "thanks zorblax quux"
refused "commit message with a full-width at sign" git commit -q --allow-empty -m "write to someone-else＠elsewhere-mail.org"
refused "commit message with %40" git commit -q --allow-empty -m "write to someone-else%40elsewhere-mail.org"
refused "commit message with [at] and [dot]" git commit -q --allow-empty -m "write to someone-else [at] elsewhere-mail [dot] org"
refused "commit message with 'at' and 'dot' spelled out" git commit -q --allow-empty -m "write to someone-else at elsewhere-mail dot org"
refused "commit with another user.name/user.email" git -c user.name=$other_name -c user.email=$other_email commit -q --allow-empty -m x
refused "commit --author with another identity" git commit -q --allow-empty --author="$other_name <$other_email>" -m x
refused "GIT_COMMITTER_* with another identity" env GIT_COMMITTER_NAME=$other_name GIT_COMMITTER_EMAIL=$other_email git commit -q --allow-empty -m x
refused "GIT_AUTHOR_* with another identity" env GIT_AUTHOR_NAME=$other_name GIT_AUTHOR_EMAIL=$other_email git commit -q --allow-empty -m x
git config --local --unset rotmg.pinnedName
refused "commit with no pinned identity (fail closed)" git commit -q --allow-empty -m x
git config --local rotmg.pinnedName "$me_name"
printf '#!/bin/sh\nexit 1\n' > "$hooks/pre-commit.local"
refused "commit refused by a local pre-commit.local guard" git commit -q --allow-empty -m x
rm -f "$hooks/pre-commit.local"
[ "$(git rev-parse HEAD)" = "$base" ] && ok "no refused commit was created" || { echo "HEAD moved" > "$tmp/out"; ko "no refused commit was created"; }

# A foreign commit, as if made with --no-verify on another branch.
git switch -q -c foreign
echo f > f.txt && git add f.txt && git commit -q --no-verify --author="$other_name <$other_email>" -m foreign >/dev/null 2>&1
foreign=$(git rev-parse HEAD)
refused "amend keeping a foreign author" git commit -q --amend --allow-empty -m foreign2
git switch -q hooks-test

echo "Merge, cherry-pick, rebase"
refused "merge --no-ff of a foreign commit" git merge --no-ff -m merge foreign
reset_to "$base"
git merge -q --no-ff --no-commit foreign >/dev/null 2>&1
refused "merge concluded by git commit, bringing a foreign commit" git commit -q -m merge
reset_to "$base"
git merge -q --squash foreign >/dev/null 2>&1
refused "merge --squash copying a foreign Author: line" sh -c 'git commit -q --no-edit; s=$?; grep -q "message names" "$0" && exit $s; exit 0' "$tmp/out"
reset_to "$base"
detected "cherry-pick of a foreign commit" git cherry-pick --allow-empty "$foreign"
reset_to "$base"
git switch -q -c rebased foreign
commit_file b "b" --no-verify
detected "rebase replaying a foreign commit" git rebase -q --force-rebase "$base"
git switch -q hooks-test
reset_to "$base"

echo "Push"
git init -q --bare "$tmp/remote.git"
git remote add test "$tmp/remote.git"
accepted "push of commits made with the project identity" git push -q test hooks-test
refused "push of a branch with a foreign commit" git push -q test foreign
git update-ref refs/remotes/side/elsewhere "$foreign"
refused "push of a foreign commit known only to another remote" git push -q test foreign
git update-ref -d refs/remotes/side/elsewhere
git switch -q -c squashed hooks-test
git merge -q --squash foreign >/dev/null 2>&1
git commit -q --no-verify --no-edit >/dev/null 2>&1
refused "push of a squash commit whose message has a foreign Author: line" git push -q test squashed
git switch -q -c replaced hooks-test
git commit -q --no-verify --allow-empty --author="$other_name <$other_email>" -m replaced >/dev/null 2>&1
masked=$(git commit-tree "HEAD^{tree}" -p HEAD~1 -m replaced)
git replace HEAD "$masked"
refused "push of a foreign commit hidden by git replace" git push -q test replaced
git switch -q hooks-test
git -c user.name=$other_name -c user.email=$other_email tag -a v-foreign -m "foreign tagger"
refused "push of an annotated tag with a foreign tagger" git push -q test v-foreign
git tag -a v-message -m "ask $other_email"
refused "push of an annotated tag with a foreign address in its message" git push -q test v-message
git tag -a v-ok -m "project tag"
accepted "push of an annotated tag by the project identity" git push -q test v-ok
git -c user.name=$other_name -c user.email=$other_email tag -a v-inner -m "inner"
git tag -a v-outer -m "outer" v-inner
refused "push of a tag pointing to a tag with a foreign tagger" git push -q test refs/tags/v-outer
git notes add -m "contact $other_email" HEAD
refused "push of a git note naming a foreign address" git push -q test refs/notes/commits
git notes remove HEAD >/dev/null 2>&1
git update-ref -d refs/notes/commits
git notes add -m "zorblax quux was here" HEAD
refused "push of a git note with a term of the private list" git push -q test refs/notes/commits
git update-ref -d refs/notes/commits
git commit -q --no-verify --allow-empty -m "thanks Zorblax Quux"
refused "push of a commit message with a term of the private list" git push -q test hooks-test
git reset -q --hard HEAD~1
git update-ref refs/remotes/test/already-published "$foreign"
accepted "push of a foreign commit already on a remote" git push -q test foreign:refs/heads/foreign
git switch -q -c later hooks-test
commit_file c "c"
git commit -q --no-verify --allow-empty -m late-foreign --author="$other_name <$other_email>" >/dev/null 2>&1
refused "push updating a branch with a new foreign commit" git push -q test later:hooks-test
printf '#!/bin/sh\nexit 1\n' > "$hooks/pre-push.local"
git reset -q --hard HEAD~1
refused "push refused by a local pre-push.local guard" git push -q test later:hooks-test
rm -f "$hooks/pre-push.local"
accepted "same push once the guard allows it" git push -q test later:hooks-test

cd "$src" || exit 1
echo ""
echo "$pass passed, $fail failed  (clone left in $tmp)"
[ "$fail" -eq 0 ]
