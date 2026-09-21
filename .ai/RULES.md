# Stable orchestration invariants

- Run canonical-root `taskctl`; task worktrees intentionally lack `.ai/bin`.
- Never push, reset, or clean automatically. A blocked task reserves no scope.
- Use the sole preview at `http://127.0.0.1:8001/web/`; `preview.py` replaces its listener.
- Run deterministic tests before fresh, read-only review. The same writer repairs findings; recover a failed provider once, then use the other capable writer.
- Review transport must not place large prompts or diffs in Windows argv. Generated payload may be omitted only with an explicit notice; never silently truncate source changes.
- Google Translate is forbidden. Translation work remains standby and English-only unless an approved local capability exists.
- Record incidents in `LESSONS.md`, then turn recurring failures into a rule, preflight, or regression test.
