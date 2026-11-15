# rotmg-hooks:managed - shared library, sourced by the hooks next to it.
#
# Every commit that leaves this machine carries an author and a committer, and
# a public history does not forget them. The hooks below compare both with the
# identity pinned for this repository (git config --local rotmg.pinnedName and
# rotmg.pinnedEmail) and fail closed when nothing is pinned.
#
# Commit and tag messages are checked too: no e-mail address other than the
# pinned one, those of allowed-message-addresses and of rotmg.allowedIdentity.
#
# Extra identities can be allowed locally, one per value:
#   git config --local --add rotmg.allowedIdentity "Name <email>"

rotmg_hooks_dir=$(cd "$(dirname "$0")" && pwd)

# Check the objects really sent, never their git replace substitutes.
GIT_NO_REPLACE_OBJECTS=1
export GIT_NO_REPLACE_OBJECTS

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
  git log --no-mailmap --format='%H%x09%an <%ae>%x09%cn <%ce>' "$@" | while IFS='	' read -r sha author committer; do
    rotmg_allowed "$author" || echo "$sha author $author"
    rotmg_allowed "$committer" || echo "$sha committer $committer"
  done
}

# Remote whose branches count as already published when merging: the remote of
# the current branch's upstream, else origin.
rotmg_merge_remote() {
  rotmg_branch=$(git symbolic-ref -q --short HEAD)
  rotmg_remote=$(git config --get "branch.$rotmg_branch.remote" 2>/dev/null)
  if [ -z "$rotmg_remote" ] || [ "$rotmg_remote" = "." ]; then rotmg_remote=origin; fi
  echo "$rotmg_remote"
}

# Commits a merge in progress would bring in: MERGE_HEAD when it exists (a
# merge concluded with `git commit`), else the GITHEAD_<sha> variables git
# merge exports to its hooks. Commits already on that remote are not checked.
rotmg_foreign_merged() {
  rotmg_heads=$(
    git rev-parse -q --verify MERGE_HEAD >/dev/null && cat "$(git rev-parse --git-path MERGE_HEAD)"
    env | sed -n 's/^GITHEAD_\([0-9a-f]\{40,64\}\)=.*/\1/p'
  )
  for rotmg_head in $rotmg_heads; do
    rotmg_foreign_commits "HEAD..$rotmg_head" --not --remotes="$(rotmg_merge_remote)/*"
  done
}

# rotmg_address_allowed <address>: the pinned address, an address of
# rotmg.allowedIdentity, or one listed in allowed-message-addresses (the
# versioned list of tool addresses, such as a co-author trailer's).
rotmg_address_allowed() {
  rotmg_addr=$(echo "$1" | tr 'A-Z' 'a-z')
  [ "$rotmg_addr" = "$(echo "$expected_email" | tr 'A-Z' 'a-z')" ] && return 0
  {
    git config --local --get-all rotmg.allowedIdentity 2>/dev/null | sed -n 's/.*<\(.*\)>.*/\1/p'
    grep -v '^#' "$rotmg_hooks_dir/allowed-message-addresses" 2>/dev/null
  } | tr 'A-Z' 'a-z' | tr -d '\r' | grep -Fxq -- "$rotmg_addr" && return 0
  # Domains reserved for examples (RFC 2606 / 6761) never reach anyone.
  case "${rotmg_addr#*@}" in
    example.com|example.org|example.net|*.example.com|*.example.org|*.example.net) return 0 ;;
    example|*.example|invalid|*.invalid|test|*.test) return 0 ;;
  esac
  return 1
}

# The local, unversioned list of private terms (a real name, a former
# handle...), one per line, filled by hand: .git/rotmg-private-terms, plus the
# values of git config --local rotmg.privateTerm.
rotmg_private_terms_file() {
  echo "$(git rev-parse --git-common-dir)/rotmg-private-terms"
}

rotmg_private_terms() {
  {
    tr -d '\r' < "$(rotmg_private_terms_file)" 2>/dev/null | grep -v '^[[:space:]]*#'
    git config --local --get-all rotmg.privateTerm 2>/dev/null
  } | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$'
}

# Rewrites simple disguised addresses as plain ones: full-width at sign, %40,
# &#64;, [at] (at) {at}, [dot] (dot) {dot}, and "name at domain dot tld".
# A bare "word at word.tld" is left alone: it is too common in ordinary text.
rotmg_unmask_addresses() {
  sed -e 's/＠/@/g' -e 's/%40/@/g' -e 's/&#64;/@/g' \
      -e 's/ *[[({][Aa][Tt][])}] */@/g' -e 's/ *[[({][Dd][Oo][Tt][])}] */./g' \
      -e 's/\([A-Za-z0-9._-]\{1,\}\) \{1,\}[Aa][Tt] \{1,\}\([A-Za-z0-9-]\{1,\}\) \{1,\}[Dd][Oo][Tt] \{1,\}\([A-Za-z]\{2,\}\)/\1@\2.\3/g'
}

# Reads a commit or tag message on stdin and prints one line per problem: an
# e-mail address that is not allowed (the "Author: Name <address>" lines of
# git merge --squash, a foreign Co-authored-by or Signed-off-by trailer...), or
# this machine's account-wide git name or address when they differ from the
# pinned identity, or a term of the local private list. Values are masked in
# the report.
#
# The text is scanned verbatim, lines starting with "#" included: git keeps
# them in commits made with -m or -F (cleanup "whitespace") or with
# --cleanup=verbatim, so they can be published. Only commit-msg passes
# "editing": the diff that `git commit -v` appends below the scissors line is
# then left out, since git never stores it. pre-push scans what is stored.
rotmg_message_problems() {
  if [ "${1:-}" = editing ]; then
    rotmg_msg=$(tr -d '\r' | sed -e '/^# -\{24\} >8 -\{24\}$/,$d')
  else
    rotmg_msg=$(tr -d '\r')
  fi
  rotmg_private_terms | while IFS= read -r rotmg_t; do
    echo "$rotmg_msg" | grep -qiF -- "$rotmg_t" && echo "a term of the private list ($(rotmg_private_terms_file))"
  done | sort -u
  echo "$rotmg_msg" | rotmg_unmask_addresses | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u | while read -r rotmg_a; do
    rotmg_address_allowed "$rotmg_a" || echo "address $(echo "$rotmg_a" | cut -c1)***@${rotmg_a#*@}"
  done
  rotmg_gname=$(git config --global --get user.name 2>/dev/null)
  rotmg_gmail=$(git config --global --get user.email 2>/dev/null)
  if [ -n "$rotmg_gname" ] && [ "$rotmg_gname" != "$expected_name" ] && echo "$rotmg_msg" | grep -qiF -- "$rotmg_gname"; then
    echo "the account-wide git name (git config --global user.name)"
  fi
  if [ -n "$rotmg_gmail" ] && ! rotmg_address_allowed "$rotmg_gmail" && echo "$rotmg_msg" | grep -qiF -- "$rotmg_gmail"; then
    echo "the account-wide git address (git config --global user.email)"
  fi
}

rotmg_message_blocked() {
  echo "" >&2
  echo "$1 BLOCKED - the message names an identity that must not be published:" >&2
  echo "$2" | head -10 | sed 's/^/    /' >&2
  echo "  Allowed addresses: the pinned one, tools/hooks/allowed-message-addresses," >&2
  echo "  and rotmg.allowedIdentity. Edit the message (e.g. drop the Author: lines" >&2
  echo "  that git merge --squash writes)." >&2
  echo "" >&2
  exit 1
}

rotmg_blocked() {
  echo "" >&2
  echo "$1 BLOCKED - the identity is not the one pinned for this repository." >&2
  echo "  pinned: $expected" >&2
  echo "" >&2
  exit 1
}

# rotmg_run_local <file> [args]: runs a preserved hook as git would, through
# its own interpreter (#! line) when it is executable, else with sh.
rotmg_run_local() {
  if [ -x "$1" ]; then "$@"; else sh "$@"; fi
}

# Runs the optional, unversioned <hook>.local next to the installed hooks.
rotmg_chain_local() {
  rotmg_local="$rotmg_hooks_dir/$1.local"
  shift
  [ -f "$rotmg_local" ] || return 0
  rotmg_run_local "$rotmg_local" "$@" || exit $?
}
