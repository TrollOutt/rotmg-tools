#!/usr/bin/env python3
"""The only supported local UI preview launcher (127.0.0.1:8001)."""
import argparse
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


def root():
    return Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())


def canonical_root():
    """Return the orchestration baseline worktree from Git metadata."""
    here = root()
    output = subprocess.check_output(
        ["git", "worktree", "list", "--porcelain"],
        cwd=here,
        text=True,
    )
    entries, current = [], {}
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
    for entry in entries:
        if entry.get("branch") == "refs/heads/orchestrator/baseline":
            return Path(entry["worktree"]).resolve()
    if entries:
        return Path(entries[0]["worktree"]).resolve()
    raise RuntimeError("Git reported no worktrees")


def listeners():
    output = subprocess.check_output(["netstat", "-ano", "-p", "tcp"], text=True, errors="replace")
    return sorted({int(m.group(1)) for line in output.splitlines()
                   if "127.0.0.1:8001" in line and "LISTENING" in line
                   for m in [re.search(r"\s(\d+)\s*$", line)] if m})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("worktree")
    p.add_argument("command", nargs=argparse.REMAINDER)
    args = p.parse_args()
    canonical = root().resolve()
    if canonical != canonical_root():
        raise SystemExit("ERROR: preview must run from the canonical orchestrator checkout")
    wt = Path(args.worktree).resolve()
    if not (wt / "web").is_dir():
        raise SystemExit("ERROR: supplied worktree has no web directory")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        command = [sys.executable, "-m", "http.server", "8001", "--bind", "127.0.0.1"]
    for pid in listeners():
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log = canonical / ".ai" / "ui-preview.log"
    pidfile = canonical / ".ai" / "ui-preview.pid"
    with log.open("w", encoding="utf-8") as out:
        proc = subprocess.Popen(command, cwd=wt, stdout=out, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    pidfile.write_text(str(proc.pid) + "\n", encoding="ascii")
    url = "http://127.0.0.1:8001/web/"
    for _ in range(30):
        if proc.poll() is not None: break
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if 200 <= response.status < 400:
                    print(f"PREVIEW_OK {url} pid={proc.pid}")
                    return
        except OSError: time.sleep(.2)
    proc.terminate()
    raise SystemExit(f"ERROR: preview failed validation; see {log}")


if __name__ == "__main__": main()
