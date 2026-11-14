# rotmg-hooks:managed - shared library, sourced by the hooks next to it.
#
# Every commit that leaves this machine carries an author and a committer, and
# a public history does not forget them. The hooks below compare both with the
# identity pinned for this repository (git config --local rotmg.pinnedName and
# rotmg.pinnedEmail) and fail closed when nothing is pinned.
#
# Extra identities can be allowed locally, one per value:
#   git config --local --add rotmg.allowedIdentity "Name <email>"

rotmg_hooks_dir=$(cd "$(dirname "$0")" && pwd)

rotmg_load_identity() {
  expected_name=$(git config --local --get rotmg.pinnedName)
  expected_email=$(git config --local --get rotmg.pinnedEmail)
  if [ -z "$expected_name" ] || [ -z "$expected_email" ]; then
    echo "" >&2
    echo "BLOCKED - no identity has been pinned for this repository yet." >&2
    echo "  Run: node tools/hooks/install.js   (pins the project identity)" >&2
    echo "" >&2
    exit 1
  fi
  expected="$expected_name <$expected_email>"
}

# Prints "Name <email>" from a `git var` ident, without the timestamp.
rotmg_var() {
  git var "$1" 2>/dev/null | sed 's/ [0-9][0-9]* [-+][0-9][0-9]*$//'
}

# rotmg_allowed "Name <email>"  -> success when the identity may be published.
rotmg_allowed() {
  [ -n "$1" ] || return 1
  [ "$1" = "$expected" ] && return 0
  git config --local --get-all rotmg.allowedIdentity 2>/dev/null | grep -Fxq -- "$1"
}

# rotmg_check <label> "Name <email>"  -> prints a report and fails when foreign.
rotmg_check() {
  rotmg_allowed "$2" && return 0
  echo "  $1 is not the pinned identity: ${2:-<none>}" >&2
  return 1
}

# Checks the author and committer git is about to use, including --author,
# -c user.*, GIT_AUTHOR_* and GIT_COMMITTER_*.
rotmg_check_next_commit() {
  rotmg_fail=0
  rotmg_check author "$(rotmg_var GIT_AUTHOR_IDENT)" || rotmg_fail=1
  rotmg_check committer "$(rotmg_var GIT_COMMITTER_IDENT)" || rotmg_fail=1
  return $rotmg_fail
}

# Lists, one per line, the commits of a rev-list range whose author or
# committer is not allowed:  <sha> author|committer <ident>
rotmg_foreign_commits() {
  git log --format='%H%x09%an <%ae>%x09%cn <%ce>' "$@" | while IFS='	' read -r sha author committer; do
    rotmg_allowed "$author" || echo "$sha author $author"
    rotmg_allowed "$committer" || echo "$sha committer $committer"
  done
}

# Commits a merge in progress would bring in: MERGE_HEAD when it exists (a
# merge concluded with `git commit`), else the GITHEAD_<sha> variables git
# merge exports to its hooks. Only commits not yet on a remote are checked.
rotmg_foreign_merged() {
  rotmg_heads=$(
    git rev-parse -q --verify MERGE_HEAD >/dev/null && cat "$(git rev-parse --git-path MERGE_HEAD)"
    env | sed -n 's/^GITHEAD_\([0-9a-f]\{40,64\}\)=.*/\1/p'
  )
  for rotmg_head in $rotmg_heads; do
    rotmg_foreign_commits "HEAD..$rotmg_head" --not --remotes
  done
}

rotmg_blocked() {
  echo "" >&2
  echo "$1 BLOCKED - the identity is not the one pinned for this repository." >&2
  echo "  pinned: $expected" >&2
  echo "" >&2
  exit 1
}

# Runs the optional, unversioned <hook>.local next to the installed hooks.
rotmg_chain_local() {
  rotmg_local="$rotmg_hooks_dir/$1.local"
  shift
  [ -f "$rotmg_local" ] || return 0
  sh "$rotmg_local" "$@" || exit $?
}
