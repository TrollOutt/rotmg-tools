import subprocess
import sys
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TASKCTL = ROOT / ".ai/bin/taskctl.py"
PREVIEW = ROOT / ".ai/bin/preview.py"
DELEGATES = ROOT / ".opencode/plugins/cli-delegates.ts"


class OrchestrationTests(unittest.TestCase):
    def command(self, args):
        return subprocess.run(args, cwd=ROOT, text=True, capture_output=True)

    def test_doctor_is_canonical_root_only_and_clear(self):
        result = self.command([sys.executable, str(TASKCTL), "doctor", "ORCHESTRATION-HARDENING"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical orchestrator checkout", result.stderr)

    def test_doctor_healthy_and_write_probe_cleans_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / ".ai/bin").mkdir(parents=True)
            (root / ".ai/tasks").mkdir(parents=True)
            shutil.copy2(TASKCTL, root / ".ai/bin/taskctl.py")
            (root / ".ai/bin/context-sync.sh").write_text("#!/bin/sh\n")
            shutil.copy2(PREVIEW, root / ".ai/bin/preview.py")
            (root / "package.json").write_text("{}")
            (root / "tests").mkdir()
            (root / "tests/standalone.test.js").write_text("")
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"], cwd=root, check=True)
            head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
            task = {"id":"T", "worktree":str(root), "branch":"master", "base":{"commit":head}, "write_scope":[".ai"]}
            (root / ".ai/tasks/T.json").write_text(json.dumps(task))
            result = subprocess.run([sys.executable, str(root / ".ai/bin/taskctl.py"), "doctor", "T"], cwd=root, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("DOCTOR_OK", result.stdout)
            self.assertFalse((root / ".ai-doctor-probe").exists())

    def test_doctor_accepts_canonical_git_file_worktree(self):
        with tempfile.TemporaryDirectory() as tmp:
            primary = Path(tmp) / "primary"
            primary.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=primary, check=True)
            subprocess.run(["git", "config", "user.name", "t"], cwd=primary, check=True)
            subprocess.run(["git", "config", "user.email", "t@t"], cwd=primary, check=True)
            (primary / ".ai/bin").mkdir(parents=True)
            shutil.copy2(TASKCTL, primary / ".ai/bin/taskctl.py")
            subprocess.run(["git", "add", "."], cwd=primary, check=True)
            subprocess.run(["git", "commit", "-qm", "base"], cwd=primary, check=True)
            canonical = Path(tmp) / "canonical"
            subprocess.run(["git", "worktree", "add", "-q", "-b", "orchestrator/baseline", str(canonical)], cwd=primary, check=True)
            self.assertTrue((canonical / ".git").is_file())
            result = subprocess.run([sys.executable, str(canonical / ".ai/bin/taskctl.py"), "doctor", "missing"], cwd=canonical, text=True, capture_output=True)
            self.assertNotIn("canonical orchestrator checkout", result.stderr)
            self.assertIn("unknown task: missing", result.stderr)

    def test_preview_is_canonical_root_only(self):
        result = self.command([sys.executable, str(PREVIEW), str(ROOT)])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical orchestrator checkout", result.stderr)

    def test_checkpoint_force_stages_declared_ignored_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.email", "t@t"], cwd=root, check=True)
            (root / ".ai/bin").mkdir(parents=True)
            (root / ".ai/tasks").mkdir(parents=True)
            shutil.copy2(TASKCTL, root / ".ai/bin/taskctl.py")
            (root / ".gitignore").write_text("/.ai/\n")
            (root / "seed").write_text("base")
            subprocess.run(["git", "add", "-f", "."], cwd=root, check=True)
            subprocess.run(["git", "commit", "-qm", "base"], cwd=root, check=True)
            subprocess.run(["git", "worktree", "add", "-q", "-b", "worker", str(root / "worker")], cwd=root, check=True)
            worker = root / "worker"
            head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
            task = {"id":"T", "status":"ready", "mode":"write", "worktree":str(worker), "branch":"worker", "base":{"commit":head}, "write_scope":[".ai/result.txt"], "tests":[], "reviews":[]}
            (root / ".ai/tasks/T.json").write_text(json.dumps(task))
            (worker / ".ai").mkdir(exist_ok=True)
            (worker / ".ai/result.txt").write_text("ignored but declared")
            result = subprocess.run([sys.executable, str(root / ".ai/bin/taskctl.py"), "checkpoint", "T"], cwd=root, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            names = subprocess.check_output(["git", "show", "--format=", "--name-only", "HEAD"], cwd=worker, text=True)
            self.assertIn(".ai/result.txt", names.splitlines())

    def test_standalone_prerequisite_is_deterministic(self):
        source = TASKCTL.read_text(encoding="utf-8")
        self.assertIn('command == ["node", "tests/standalone.test.js"]', source)
        self.assertIn('["npm", "run", "build"]', source)

    def test_review_transport_uses_stdin_not_argv(self):
        source = DELEGATES.read_text(encoding="utf-8")
        self.assertIn("async function runReview", source)
        self.assertIn("runReview(\n    cmd,\n    cwd,\n    prompt,", source)
        self.assertNotIn('"--",\n    prompt,', source)

    def test_preview_has_single_listener_convention(self):
        source = PREVIEW.read_text(encoding="utf-8")
        self.assertIn("127.0.0.1:8001", source)
        self.assertIn("taskkill", source)
        self.assertIn("/web/", source)


if __name__ == "__main__":
    unittest.main()
