#!/usr/bin/env bash
set -euo pipefail

task="${1:-}"

if [[ -z "$task" ]]; then
  echo "usage: $0 <task-id>" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
taskfile="$root/.ai/tasks/$task.json"

if [[ ! -f "$taskfile" ]]; then
  echo "unknown task: $task" >&2
  exit 1
fi

readarray -t meta < <(
  python - "$taskfile" <<'PY' | tr -d '\r'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    task = json.load(f)

print(task.get("worktree") or "")
print(task.get("branch") or "")
print(task.get("status") or "")
PY
)

worktree="${meta[0]}"
branch="${meta[1]}"
status="${meta[2]}"

if [[ -z "$worktree" || -z "$branch" ]]; then
  echo "task has no attached worktree: $task" >&2
  exit 1
fi

if [[ ! -d "$worktree" ]]; then
  echo "worktree does not exist: $worktree" >&2
  exit 1
fi

actual_branch="$(
  git -C "$worktree" symbolic-ref --short -q HEAD || true
)"

if [[ "$actual_branch" != "$branch" ]]; then
  echo "worktree branch mismatch" >&2
  echo "expected: $branch" >&2
  echo "actual:   ${actual_branch:-DETACHED}" >&2
  exit 1
fi

mkdir -p "$worktree/.ai/tasks"

cp "$root/AGENTS.md" "$worktree/AGENTS.md"
cp "$root/CLAUDE.md" "$worktree/CLAUDE.md"
cp "$root/.ai/STATE.md" "$worktree/.ai/STATE.md"
cp "$taskfile" "$worktree/.ai/tasks/$task.json"

echo "CONTEXT_SYNCED"
echo "task=$task"
echo "status=$status"
echo "branch=$branch"
echo "worktree=$worktree"
