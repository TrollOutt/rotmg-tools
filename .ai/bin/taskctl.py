#!/usr/bin/env python3

import argparse
import json
import shutil
import os
import tempfile
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

STATUSES = {
    "planned",
    "ready",
    "running",
    "review",
    "blocked",
    "done",
    "cancelled",
    "archived",
}

TERMINAL = {"done", "cancelled", "archived"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def git(*args):
    return subprocess.check_output(
        ["git", *args],
        text=True,
        stderr=subprocess.DEVNULL,
    ).strip()


ROOT = Path(git("rev-parse", "--show-toplevel"))
TASKS = ROOT / ".ai" / "tasks"
TASKS.mkdir(parents=True, exist_ok=True)


def task_path(task_id):
    return TASKS / f"{task_id}.json"


def normalize_scope(raw):
    raw = raw.strip().replace("\\", "/")

    if not raw or raw.startswith("/"):
        raise ValueError(f"invalid repository-relative scope: {raw!r}")

    path = PurePosixPath(raw)

    if any(part in ("", ".", "..") for part in path.parts):
        raise ValueError(f"invalid scope: {raw!r}")

    return "/".join(path.parts)


def scopes_overlap(a, b):
    a = a.rstrip("/")
    b = b.rstrip("/")

    return (
        a == b
        or a.startswith(b + "/")
        or b.startswith(a + "/")
    )


def load(path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save(data):
    data["updated_at"] = now()
    path = task_path(data["id"])

    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def all_tasks():
    result = []

    for path in sorted(TASKS.glob("*.json")):
        try:
            result.append(load(path))
        except Exception as exc:
            raise RuntimeError(
                f"cannot read task registry file {path}: {exc}"
            )

    return result


def require(task_id):
    path = task_path(task_id)

    if not path.exists():
        raise RuntimeError(f"unknown task: {task_id}")

    return load(path)


def check_conflicts(task_id, scopes):
    conflicts = []

    for other in all_tasks():
        if other.get("id") == task_id:
            continue

        # A blocked task has no active writer. It retains its worktree and
        # metadata for later recovery, but must not indefinitely prevent a
        # separately scoped replacement task from being scheduled.
        if other.get("status") in TERMINAL or other.get("status") == "blocked":
            continue

        for ours in scopes:
            for theirs in other.get("write_scope", []):
                if scopes_overlap(ours, theirs):
                    conflicts.append(
                        (other["id"], ours, theirs, other.get("status"))
                    )

    return conflicts


def cmd_create(args):
    if task_path(args.task_id).exists():
        raise RuntimeError(f"task already exists: {args.task_id}")

    scopes = [normalize_scope(x) for x in args.scope]

    if args.mode == "write" and not scopes:
        raise RuntimeError("write tasks require at least one --scope")

    if args.mode != "write" and scopes:
        raise RuntimeError("--scope is only used by write tasks")

    conflicts = check_conflicts(args.task_id, scopes)

    if conflicts:
        print("SCOPE_CONFLICT", file=sys.stderr)

        for task, ours, theirs, status in conflicts:
            print(
                f"  requested {ours} conflicts with "
                f"{task}:{theirs} ({status})",
                file=sys.stderr,
            )

        sys.exit(3)

    data = {
        "id": args.task_id,
        "status": "planned",
        "mode": args.mode,
        "writer": args.writer,
        "profile": args.profile,
        "goal": args.goal,
        "base": {
            "branch": "orchestrator/baseline",
            "commit": git("rev-parse", "orchestrator/baseline"),
        },
        "write_scope": scopes,
        "depends_on": [],
        "worktree": None,
        "branch": None,
        "sessions": {
            "claude": None,
            "codex": None,
            "deepseek": None,
        },
        "tests": [],
        "reviews": [],
        "integration": {
            "status": "pending",
            "commit": None,
            "integrated_at": None,
            "baseline_before": None,
            "baseline_after": None,
        },
        "review": {
            "status": "pending",
            "reviewer": None,
            "profile": None,
            "commit": None,
            "reviewed_at": None,
            "result": None,
        },
        "created_at": now(),
        "updated_at": now(),
    }

    save(data)

    print("TASK_CREATED")
    print(f"id={data['id']}")
    print(f"mode={data['mode']}")
    print(f"writer={data['writer']}")
    print(f"profile={data['profile']}")

    for scope in scopes:
        print(f"scope={scope}")


def cmd_list(_args):
    tasks = all_tasks()

    if not tasks:
        print("NO_TASKS")
        return

    for task in tasks:
        scopes = ",".join(task.get("write_scope", [])) or "-"
        print(
            f"{task['id']}\t"
            f"{task.get('status', '?')}\t"
            f"{task.get('mode', '?')}\t"
            f"{task.get('writer', '?')}\t"
            f"{task.get('profile', '?')}\t"
            f"{scopes}"
        )


def cmd_show(args):
    print(json.dumps(require(args.task_id), indent=2, ensure_ascii=False))


def cmd_status(args):
    if args.status not in STATUSES:
        raise RuntimeError(f"invalid status: {args.status}")

    data = require(args.task_id)
    data["status"] = args.status
    save(data)

    print(f"TASK_STATUS {args.task_id} {args.status}")


def cmd_attach(args):
    data = require(args.task_id)
    data["worktree"] = args.worktree
    data["branch"] = args.branch

    if data["status"] == "planned":
        data["status"] = "ready"

    save(data)

    print(f"TASK_ATTACHED {args.task_id}")
    print(f"worktree={args.worktree}")
    print(f"branch={args.branch}")


def cmd_session(args):
    data = require(args.task_id)

    if args.provider not in data["sessions"]:
        raise RuntimeError(f"invalid provider: {args.provider}")

    data["sessions"][args.provider] = args.session_id
    save(data)

    print(
        f"TASK_SESSION {args.task_id} "
        f"{args.provider} {args.session_id}"
    )


def cmd_check(args):
    data = require(args.task_id)

    conflicts = check_conflicts(
        args.task_id,
        data.get("write_scope", []),
    )

    if conflicts:
        print("SCOPE_CONFLICT")

        for task, ours, theirs, status in conflicts:
            print(
                f"{ours} <-> {task}:{theirs} ({status})"
            )

        sys.exit(3)

    print("SCOPE_CLEAR")




def worktree_for(data):
    worktree = data.get("worktree")
    branch = data.get("branch")

    if not worktree or not branch:
        raise RuntimeError("task has no attached worktree/branch")

    wt = Path(worktree)

    if not wt.exists():
        raise RuntimeError(f"worktree does not exist: {worktree}")

    actual = subprocess.check_output(
        ["git", "-C", str(wt), "symbolic-ref", "--short", "-q", "HEAD"],
        text=True,
    ).strip()

    if actual != branch:
        raise RuntimeError(
            f"worktree branch mismatch: expected {branch}, found {actual}"
        )

    return wt


def changed_paths(data):
    wt = worktree_for(data)
    base = data.get("base", {}).get("commit")

    if not base:
        raise RuntimeError("task has no base commit")

    tracked = subprocess.check_output(
        [
            "git", "-C", str(wt),
            "diff", "--name-only", "-z",
            base,
        ]
    ).decode("utf-8").split("\0")

    untracked = subprocess.check_output(
        [
            "git", "-C", str(wt),
            "ls-files", "--others",
            "--exclude-standard", "-z",
        ]
    ).decode("utf-8").split("\0")

    return sorted({
        x.replace("\\", "/")
        for x in tracked + untracked
        if x
    })


def assert_task_scope(data):
    scopes = data.get("write_scope", [])
    outside = []

    for filename in changed_paths(data):
        if not any(
            scopes_overlap(filename, scope)
            for scope in scopes
        ):
            outside.append(filename)

    if outside:
        raise RuntimeError(
            "out-of-scope changes detected:\n  "
            + "\n  ".join(outside)
        )


def cmd_checkpoint(args):
    data = require(args.task_id)

    if data.get("mode") != "write":
        raise RuntimeError("only write tasks can create checkpoints")

    if data.get("status") not in {"ready", "running"}:
        raise RuntimeError(
            "task must be ready or running to checkpoint"
        )

    wt = worktree_for(data)
    assert_task_scope(data)

    scopes = data.get("write_scope", [])

    subprocess.run(
        # Orchestration metadata/plugins are deliberately ignored in task
        # worktrees.  The task registry has already bounded `scopes`, so
        # force-add only those paths rather than broadening what can stage.
        ["git", "-C", str(wt), "add", "-f", "-A", "--", *scopes],
        check=True,
    )

    staged = subprocess.run(
        ["git", "-C", str(wt), "diff", "--cached", "--quiet"]
    ).returncode != 0

    if staged:
        message = args.message or f"task({data['id']}): checkpoint"

        subprocess.run(
            ["git", "-C", str(wt), "commit", "-m", message],
            check=True,
        )

    head = subprocess.check_output(
        ["git", "-C", str(wt), "rev-parse", "HEAD"],
        text=True,
    ).strip()

    base = data.get("base", {}).get("commit")

    if head == base:
        raise RuntimeError(
            "checkpoint contains no changes relative to task base"
        )

    assert_task_scope(data)

    dirty = subprocess.check_output(
        ["git", "-C", str(wt), "status", "--porcelain"],
        text=True,
    )

    if dirty.strip():
        raise RuntimeError(
            "worktree is still dirty after checkpoint; "
            "checkpoint not recorded"
        )

    data["checkpoint"] = {
        "commit": head,
        "created_at": now(),
    }

    # Any new checkpoint invalidates current validation.
    # Historical reviews remain as immutable audit history.
    data["tests"] = []
    data.setdefault("reviews", [])
    data["review"] = {
        "status": "pending",
        "reviewer": None,
        "profile": None,
        "commit": None,
        "reviewed_at": None,
        "result": None,
    }

    save(data)

    print("TASK_CHECKPOINT")
    print(f"id={data['id']}")
    print(f"commit={head}")


def cmd_test(args):
    data = require(args.task_id)
    wt = worktree_for(data)

    checkpoint = data.get("checkpoint", {}).get("commit")

    if not checkpoint:
        raise RuntimeError(
            "task needs a checkpoint before tests can be recorded"
        )

    head = subprocess.check_output(
        ["git", "-C", str(wt), "rev-parse", "HEAD"],
        text=True,
    ).strip()

    if head != checkpoint:
        raise RuntimeError(
            "task HEAD changed after checkpoint; create a new checkpoint"
        )

    before = subprocess.check_output(
        ["git", "-C", str(wt), "status", "--porcelain"],
        text=True,
    )

    if before.strip():
        raise RuntimeError(
            "worktree must be clean before running recorded tests"
        )

    command = list(args.command)

    if command and command[0] == "--":
        command = command[1:]

    if not command:
        raise RuntimeError("missing test command")

    # Standalone output is generated, so its test is never meaningful against
    # a stale worktree. Keep this prerequisite here rather than asking a
    # writer/reviewer to remember it.
    standalone = command == ["node", "tests/standalone.test.js"]
    if standalone:
        build = subprocess.run(
            ["npm", "run", "build"], cwd=wt, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if build.returncode:
            raise RuntimeError(
                "standalone prerequisite failed: npm run build\n" +
                build.stderr[-2000:]
            )

    proc = subprocess.run(
        command,
        cwd=wt,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    after = subprocess.check_output(
        ["git", "-C", str(wt), "status", "--porcelain"],
        text=True,
    )

    result = {
        "commit": checkpoint,
        "command": command,
        "exit_code": proc.returncode,
        "passed": proc.returncode == 0,
        "dirty_after": bool(after.strip()),
        "ran_at": now(),
        "stdout_tail": proc.stdout[-4000:],
        "stderr_tail": proc.stderr[-4000:],
    }

    data.setdefault("tests", []).append(result)
    save(data)

    print("TASK_TEST")
    print(f"id={data['id']}")
    print(f"commit={checkpoint}")
    print(f"exit_code={proc.returncode}")
    print(f"dirty_after={str(bool(after.strip())).lower()}")

    if proc.stdout:
        print("--- stdout ---")
        print(proc.stdout[-4000:].rstrip())

    if proc.stderr:
        print("--- stderr ---")
        print(proc.stderr[-4000:].rstrip())

    if after.strip():
        raise RuntimeError(
            "test dirtied the worktree; changes were preserved"
        )

    if proc.returncode != 0:
        sys.exit(proc.returncode)


def canonical_root():
    """Return the baseline worktree as reported by Git, not by `.git` shape."""
    output = subprocess.check_output(
        ["git", "worktree", "list", "--porcelain"],
        cwd=ROOT,
        text=True,
    )
    entries = []
    current = {}
    for line in output.splitlines():
        if not line:
            if current:
                entries.append(current)
                current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = value
    if current:
        entries.append(current)

    # The orchestration baseline is the canonical checkout even when that
    # checkout itself is a linked worktree with a `.git` file.
    for entry in entries:
        if entry.get("branch") == "refs/heads/orchestrator/baseline":
            return Path(entry["worktree"]).resolve()
    if entries:
        return Path(entries[0]["worktree"]).resolve()
    raise RuntimeError("Git reported no worktrees")


def cmd_doctor(args):
    if ROOT.resolve() != canonical_root():
        raise RuntimeError(
            "doctor must run from the canonical orchestrator checkout "
            "(not a task worktree)"
        )
    data = require(args.task_id)
    wt = worktree_for(data)
    base = data.get("base", {}).get("commit")
    if not base or subprocess.run(["git", "cat-file", "-e", base + "^{commit}"], cwd=ROOT).returncode:
        raise RuntimeError("task base commit is missing or invalid")
    assert_task_scope(data)
    for executable in ("node", "python"):
        if not shutil.which(executable):
            raise RuntimeError(f"required executable not found: {executable}")
    for relative in (".ai/bin/taskctl.py", ".ai/bin/context-sync.sh"):
        if not (ROOT / relative).is_file():
            raise RuntimeError(f"required helper missing: {relative}")
    # Scope has already been validated above.  Use a short-lived untracked
    # worktree directory rather than a declared file path: many valid scopes
    # name a single file, and linked worktrees expose `.git` as a file.
    # Never probe inside Git metadata or a tracked product path.
    probe_dir = Path(tempfile.mkdtemp(prefix=".ai-doctor-probe-", dir=wt))
    try:
        probe = probe_dir / "write-delete-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError as exc:
        raise RuntimeError(f"scoped write/delete probe failed: {exc}")
    finally:
        shutil.rmtree(probe_dir, ignore_errors=True)
    if not (ROOT / ".ai/bin/preview.py").is_file():
        raise RuntimeError("required helper missing: .ai/bin/preview.py")
    package = ROOT / "package.json"
    if not package.is_file() or not (ROOT / "tests/standalone.test.js").is_file():
        raise RuntimeError("standalone test prerequisite missing (package.json or tests/standalone.test.js)")
    print("DOCTOR_OK")
    print(f"task={data['id']}")
    print("preview=http://127.0.0.1:8001/web/")




def review_target(data):
    if data.get("mode") != "write":
        raise RuntimeError("only write tasks can be reviewed")

    if data.get("status") not in {"ready", "running", "review"}:
        raise RuntimeError(
            "task must be ready, running, or review"
        )

    wt = worktree_for(data)

    checkpoint = data.get("checkpoint", {}).get("commit")
    if not checkpoint:
        raise RuntimeError(
            "task needs a checkpoint before review"
        )

    head = subprocess.check_output(
        ["git", "-C", str(wt), "rev-parse", "HEAD"],
        text=True,
    ).strip()

    if head != checkpoint:
        raise RuntimeError(
            "task HEAD differs from checkpoint; "
            "create a new checkpoint before review"
        )

    dirty = subprocess.check_output(
        ["git", "-C", str(wt), "status", "--porcelain"],
        text=True,
    )

    if dirty.strip():
        raise RuntimeError(
            "worktree must be clean before review"
        )

    assert_task_scope(data)

    tests = [
        t for t in data.get("tests", [])
        if t.get("commit") == checkpoint
    ]

    if not tests:
        raise RuntimeError(
            "no recorded test exists for the checkpoint"
        )

    failed = [
        t for t in tests
        if not t.get("passed") or t.get("dirty_after")
    ]

    if failed:
        raise RuntimeError(
            "checkpoint has failed or dirty recorded tests"
        )

    return wt, checkpoint, tests


def cmd_review_ready(args):
    data = require(args.task_id)
    _, checkpoint, tests = review_target(data)

    print("REVIEW_READY")
    print(f"id={data['id']}")
    print(f"commit={checkpoint}")
    print(f"tests={len(tests)}")


def cmd_review_record(args):
    data = require(args.task_id)
    _, checkpoint, _ = review_target(data)

    if args.commit != checkpoint:
        raise RuntimeError(
            f"review commit mismatch: expected {checkpoint}, "
            f"got {args.commit}"
        )

    result_path = Path(args.result)

    if not result_path.is_absolute():
        result_path = ROOT / result_path

    result_path = result_path.resolve()
    reviews_root = (ROOT / ".ai" / "reviews").resolve()

    try:
        result_path.relative_to(reviews_root)
    except ValueError:
        raise RuntimeError(
            "review result must live under .ai/reviews"
        )

    if not result_path.is_file():
        raise RuntimeError(
            f"review result does not exist: {result_path}"
        )

    result_rel = result_path.relative_to(ROOT).as_posix()

    history = data.setdefault("reviews", [])

    if any(
        item.get("result") == result_rel
        for item in history
        if isinstance(item, dict)
    ):
        raise RuntimeError(
            f"review result already recorded: {result_rel}"
        )

    review_entry = {
        "status": args.verdict,
        "reviewer": args.reviewer,
        "profile": args.profile,
        "commit": checkpoint,
        "reviewed_at": now(),
        "result": result_rel,
    }

    history.append(review_entry)
    data["review"] = dict(review_entry)

    if args.verdict == "approved":
        data["status"] = "review"
    else:
        data["status"] = "running"

    save(data)

    print("REVIEW_RECORDED")
    print(f"id={data['id']}")
    print(f"commit={checkpoint}")
    print(f"reviewer={args.reviewer}")
    print(f"profile={args.profile}")
    print(f"verdict={args.verdict}")
    print(f"result={result_rel}")




def effective_review_history(data):
    history = [
        dict(item)
        for item in data.get("reviews", [])
        if isinstance(item, dict)
    ]

    # Compatibility with tasks created before reviews[] existed.
    current = data.get("review")

    if (
        isinstance(current, dict)
        and current.get("status")
        in {"approved", "changes_requested"}
        and current.get("commit")
    ):
        identity = (
            current.get("result"),
            current.get("reviewer"),
            current.get("commit"),
            current.get("reviewed_at"),
        )

        existing = {
            (
                item.get("result"),
                item.get("reviewer"),
                item.get("commit"),
                item.get("reviewed_at"),
            )
            for item in history
        }

        if identity not in existing:
            history.append(dict(current))

    return history


def integration_gate(data):
    _, checkpoint, tests = review_target(data)

    history = effective_review_history(data)

    if history != data.get("reviews", []):
        data["reviews"] = history
        save(data)

    matching = [
        item
        for item in history
        if item.get("commit") == checkpoint
    ]

    if not matching:
        raise RuntimeError(
            "checkpoint has no recorded review"
        )

    latest = matching[-1]

    if latest.get("status") != "approved":
        raise RuntimeError(
            "latest review for checkpoint is not approved: "
            f"{latest.get('status')}"
        )

    result = latest.get("result")

    if not result:
        raise RuntimeError(
            "approved review has no result file"
        )

    result_path = (ROOT / result).resolve()
    reviews_root = (ROOT / ".ai" / "reviews").resolve()

    try:
        result_path.relative_to(reviews_root)
    except ValueError:
        raise RuntimeError(
            "approved review result is outside .ai/reviews"
        )

    if not result_path.is_file():
        raise RuntimeError(
            f"approved review result is missing: {result}"
        )

    return checkpoint, tests, matching, latest


def cmd_integrate_ready(args):
    data = require(args.task_id)

    checkpoint, tests, matching, latest = integration_gate(data)

    print("INTEGRATE_READY")
    print(f"id={data['id']}")
    print(f"commit={checkpoint}")
    print(f"tests={len(tests)}")
    print(f"reviews_for_commit={len(matching)}")
    print(f"reviewer={latest.get('reviewer')}")
    print(f"profile={latest.get('profile')}")
    print(f"result={latest.get('result')}")


def cmd_integrate(args):
    data = require(args.task_id)

    checkpoint, tests, matching, latest = integration_gate(data)

    expected_branch = "orchestrator/baseline"

    current_branch = subprocess.check_output(
        [
            "git",
            "symbolic-ref",
            "--short",
            "-q",
            "HEAD",
        ],
        cwd=ROOT,
        text=True,
    ).strip()

    if current_branch != expected_branch:
        raise RuntimeError(
            f"integration must run from {expected_branch}; "
            f"current branch is {current_branch or 'detached'}"
        )

    root_dirty = subprocess.check_output(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        text=True,
    )

    if root_dirty.strip():
        raise RuntimeError(
            "canonical baseline checkout is dirty; "
            "integration refused"
        )

    base = data.get("base", {}).get("commit")

    if not base:
        raise RuntimeError(
            "task has no recorded base commit"
        )

    baseline_before = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
    ).strip()

    if baseline_before != base:
        raise RuntimeError(
            "BASELINE_MOVED: task was created from "
            f"{base}, but orchestrator/baseline is now "
            f"{baseline_before}. Rebase/refresh must be "
            "handled explicitly before integration."
        )

    task_branch = data.get("branch")

    if not task_branch:
        raise RuntimeError(
            "task has no recorded branch"
        )

    branch_tip = subprocess.check_output(
        ["git", "rev-parse", task_branch],
        cwd=ROOT,
        text=True,
    ).strip()

    if branch_tip != checkpoint:
        raise RuntimeError(
            "task branch tip differs from reviewed checkpoint: "
            f"branch={branch_tip}, checkpoint={checkpoint}"
        )

    ancestry = subprocess.run(
        [
            "git",
            "merge-base",
            "--is-ancestor",
            base,
            checkpoint,
        ],
        cwd=ROOT,
    )

    if ancestry.returncode != 0:
        raise RuntimeError(
            "reviewed checkpoint is not a descendant "
            "of the recorded task base"
        )

    if args.dry_run:
        print("INTEGRATE_PLAN")
        print(f"id={data['id']}")
        print("mode=dry-run")
        print(f"baseline_before={baseline_before}")
        print(f"checkpoint={checkpoint}")
        print(f"task_branch={task_branch}")
        print(f"tests={len(tests)}")
        print(f"reviews_for_commit={len(matching)}")
        print(f"reviewer={latest.get('reviewer')}")
        print("strategy=fast-forward-only")
        return

    subprocess.run(
        [
            "git",
            "merge",
            "--ff-only",
            checkpoint,
        ],
        cwd=ROOT,
        check=True,
    )

    baseline_after = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
    ).strip()

    if baseline_after != checkpoint:
        raise RuntimeError(
            "integration completed but baseline HEAD "
            "does not equal reviewed checkpoint"
        )

    data["integration"] = {
        "status": "integrated",
        "commit": checkpoint,
        "integrated_at": now(),
        "baseline_before": baseline_before,
        "baseline_after": baseline_after,
    }

    data["status"] = "done"
    save(data)

    print("TASK_INTEGRATED")
    print(f"id={data['id']}")
    print(f"commit={checkpoint}")
    print(f"baseline_before={baseline_before}")
    print(f"baseline_after={baseline_after}")
    print("strategy=fast-forward-only")
    print("push=false")



def cmd_archive(args):
    data = require(args.task_id)

    if data.get("status") not in {"done", "cancelled", "archived"}:
        raise RuntimeError(
            "task must be done, cancelled, or archived before cleanup"
        )

    worktree = data.get("worktree")
    branch = data.get("branch")

    if not worktree or not branch:
        raise RuntimeError("task has no attached worktree/branch")

    wt = Path(worktree)

    if not wt.exists():
        raise RuntimeError(f"worktree path does not exist: {worktree}")

    history = ROOT / ".ai" / "history" / "tasks"
    history.mkdir(parents=True, exist_ok=True)
    destination = history / f"{data['id']}.json"

    if destination.exists():
        raise RuntimeError(
            f"archive already exists: {destination}"
        )

    proc = subprocess.run(
        [
            "git",
            "-C",
            str(wt),
            "symbolic-ref",
            "--short",
            "-q",
            "HEAD",
        ],
        text=True,
        capture_output=True,
    )

    if proc.returncode != 0:
        raise RuntimeError("refusing to archive a detached worktree")

    actual_branch = proc.stdout.strip()

    if actual_branch != branch:
        raise RuntimeError(
            f"worktree branch mismatch: expected {branch}, "
            f"found {actual_branch}"
        )

    dirty = subprocess.check_output(
        ["git", "-C", str(wt), "status", "--porcelain"],
        text=True,
    )

    if dirty.strip():
        raise RuntimeError(
            "worktree has tracked/untracked changes; "
            "cleanup refused"
        )

    # Remove only orchestration context injected by worktree-create.
    for name in ["AGENTS.md", "CLAUDE.md"]:
        q = wt / name
        if q.exists():
            q.unlink()

    ai = wt / ".ai"
    if ai.exists():
        shutil.rmtree(ai)

    subprocess.run(
        ["git", "worktree", "remove", str(wt)],
        cwd=ROOT,
        check=True,
    )

    base_commit = data.get("base", {}).get("commit")
    branch_deleted = False

    if base_commit:
        try:
            tip = git("rev-parse", branch)
        except Exception:
            tip = None

        integrated_commit = (
            data.get("integration", {}).get("commit")
        )

        integrated_and_merged = False

        if tip and integrated_commit == tip:
            merged = subprocess.run(
                [
                    "git",
                    "merge-base",
                    "--is-ancestor",
                    tip,
                    "orchestrator/baseline",
                ],
                cwd=ROOT,
            )
            integrated_and_merged = merged.returncode == 0

        # Delete an empty task branch, or an integrated task
        # branch whose exact reviewed tip is already in baseline.
        if tip == base_commit or integrated_and_merged:
            subprocess.run(
                ["git", "branch", "-d", branch],
                cwd=ROOT,
                check=True,
            )
            branch_deleted = True

    data["removed_worktree"] = worktree
    data["worktree"] = None
    data["status"] = "archived"
    data["archived_at"] = now()

    save(data)

    source = task_path(data["id"])
    source.replace(destination)

    print("TASK_ARCHIVED")
    print(f"id={data['id']}")
    print(f"branch={branch}")
    print(f"branch_deleted={str(branch_deleted).lower()}")
    print(f"history={destination}")



parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest="command", required=True)

p = sub.add_parser("create")
p.add_argument("task_id")
p.add_argument(
    "--mode",
    choices=["read", "write", "review"],
    required=True,
)
p.add_argument("--writer", required=True)
p.add_argument("--profile", required=True)
p.add_argument("--goal", required=True)
p.add_argument("--scope", action="append", default=[])
p.set_defaults(func=cmd_create)

p = sub.add_parser("list")
p.set_defaults(func=cmd_list)

p = sub.add_parser("show")
p.add_argument("task_id")
p.set_defaults(func=cmd_show)

p = sub.add_parser("status")
p.add_argument("task_id")
p.add_argument("status")
p.set_defaults(func=cmd_status)

p = sub.add_parser("attach")
p.add_argument("task_id")
p.add_argument("--worktree", required=True)
p.add_argument("--branch", required=True)
p.set_defaults(func=cmd_attach)

p = sub.add_parser("session")
p.add_argument("task_id")
p.add_argument(
    "provider",
    choices=["claude", "codex", "deepseek"],
)
p.add_argument("session_id")
p.set_defaults(func=cmd_session)

p = sub.add_parser("check")
p.add_argument("task_id")
p.set_defaults(func=cmd_check)

p = sub.add_parser("doctor")
p.add_argument("task_id")
p.set_defaults(func=cmd_doctor)

p = sub.add_parser("checkpoint")
p.add_argument("task_id")
p.add_argument("--message")
p.set_defaults(func=cmd_checkpoint)

p = sub.add_parser("test")
p.add_argument("task_id")
p.add_argument("command", nargs=argparse.REMAINDER)
p.set_defaults(func=cmd_test)

p = sub.add_parser("review-ready")
p.add_argument("task_id")
p.set_defaults(func=cmd_review_ready)

p = sub.add_parser("review-record")
p.add_argument("task_id")
p.add_argument("--reviewer", required=True, choices=["claude", "codex"])
p.add_argument("--profile", required=True, choices=["fast", "standard", "expert"])
p.add_argument("--commit", required=True)
p.add_argument(
    "--verdict",
    required=True,
    choices=["approved", "changes_requested"],
)
p.add_argument("--result", required=True)
p.set_defaults(func=cmd_review_record)

p = sub.add_parser("integrate-ready")
p.add_argument("task_id")
p.set_defaults(func=cmd_integrate_ready)

p = sub.add_parser("integrate")
p.add_argument("task_id")
p.add_argument("--dry-run", action="store_true")
p.set_defaults(func=cmd_integrate)

p = sub.add_parser("archive")
p.add_argument("task_id")
p.set_defaults(func=cmd_archive)

args = parser.parse_args()

try:
    args.func(args)
except RuntimeError as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    sys.exit(1)
except ValueError as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    sys.exit(1)
