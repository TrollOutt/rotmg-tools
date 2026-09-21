# ROTMG Tools — Shared State

## Workspace

Active repository:
C:\Users\william\Documents\ROTMG

Branch at orchestration setup:
main

## Agents

### Orchestrator
- Host: OpenCode
- Model: GPT-5.6 Luna
- Reasoning: none
- Purpose: task decomposition, routing, coordination, state, validation

### Scout
- Agent: deepseek-worker
- Provider: DeepSeek
- Model: deepseek-flash
- Variant: low
- Purpose: inexpensive repository exploration and analysis
- Must not silently escalate model

### Claude CLI
- Tool: claude_cli
- Authentication: native Claude Code account
- Validated fast profile: Haiku
- Intended specialization: UI / UX / frontend visual work
- Active profiles: fast / standard / expert

### Codex CLI
- Tool: codex_cli
- Authentication: native Codex / ChatGPT account
- Validated fast profile: GPT-5.6 Luna / low
- Intended specialization: implementation, tests, backend/data/tooling
- Active profiles: fast / standard / expert

## Repository constraints

Large/local sources exist outside normal Git-tracked source:
- client-data/
- local/
- RealmEye-Wiki-Sync/
- backups/

Normal code tasks should not copy these into worktrees.

Data-refresh tasks will use a separate controlled lane.

## Safety

- No automatic push.
- No worker merge.
- No simultaneous writers on overlapping file scopes.
- Cache is not shared memory.
- Durable coordination uses files and Git.

## Orchestration baseline

Local orchestration baseline:
- Branch: orchestrator/baseline
- Commit: 553481ba6604981e36e002e530e26017d21e3372
- Purpose: common starting point for agent task worktrees
- Remote push: forbidden unless explicitly approved
- Targeted realm codec and brush engine tests passed at baseline creation

## Legacy worktrees

Pre-orchestrator Codex worktrees under `~/.codex/worktrees/` are legacy/unmanaged.

Rules:
- do not assign new orchestrated tasks to them;
- do not modify, remove, reset or clean them automatically;
- preserve dirty worktrees until their contents are reviewed manually.

All new orchestrated write tasks must use worktrees created under:
`C:\Users\william\Documents\ROTMG-worktrees`

## Persistent CLI sessions validated

Codex:
- native Windows executable
- task-bound worktree
- fast profile: GPT-5.6 Luna / low
- persistent thread capture and resume validated
- no automatic fallback/escalation

Claude:
- native Claude Code executable
- task-bound worktree
- fast profile: Haiku
- persistent UUID session and resume validated
- no automatic fallback/escalation

Both workers preserve a clean worktree when instructed not to edit.

## Orchestration pipeline validated

Validated locally:
- task-scoped Git worktrees
- persistent Codex writer sessions
- persistent Claude writer sessions
- exact-SHA checkpoints
- tests recorded against checkpoint SHA
- fresh ephemeral/read-only Codex reviews
- fresh non-persistent/read-only Claude reviews
- durable review history
- integration gate requiring clean worktree, tested checkpoint, and approved latest review
- controlled fast-forward-only integration dry-run
- no automatic push

Current limitation:
- if orchestrator/baseline advances after a task is created, integration intentionally stops with BASELINE_MOVED instead of rebasing automatically.

## Codex fast calibration

Codex fast (GPT-5.6 Luna / low) passed a real ROTMG implementation evaluation:
- respected declared two-file scope
- identified a signed int32 boundary bug in readCompressedInt
- produced a minimal implementation fix
- added focused boundary and malformed-input tests
- corrected its own bad test vector during the same task session
- targeted test passed
- independent boundary checks passed
- fresh Claude fast review approved the exact checkpoint

Use Codex fast as the default profile for small and ordinary backend/tooling/test tasks.
Do not escalate merely because a task is important; use standard only when task size or complexity justifies it.

Real fast-forward integration path validated locally on this reviewed task.
No automatic push was performed.

## Claude fast calibration

Claude fast (Haiku) passed a real ROTMG UI implementation evaluation:
- respected a CSS-only write scope
- added a localized keyboard focus-visible treatment
- matched the site's existing focus visual language
- preserved hover, layout, responsive behavior, markup, JavaScript and animation behavior
- exact checkpoint diff was clean
- deterministic CSS assertion passed
- fresh Claude fast UI review approved the exact checkpoint

Use Claude fast as the default profile for small and ordinary visual/UI/CSS/UX tasks.
Use standard only when UI scope, interactions, responsive complexity or cross-page reasoning materially justify it.
Do not escalate merely because a UI task is important.

## Index description localization blocker

`INDEX-I18N-DESCRIPTIONS` cannot safely complete its generated non-English
record-description overlay in the current environment. External translation
APIs are prohibited for this task. Its local-only runner, resumable cache,
coverage guard, and standalone embedding are implemented, but both authorized
cheap CLI workers are currently unusable for bulk generation: Codex Luna's
authenticated transport is blocked (`WSA 10013`), and direct Claude Haiku with
stdin produced no output and did not exit within a 120-second bounded
benchmark. The task rejects empty locale overlays rather than fabricating
translations. Completion requires an available authenticated local CLI worker.

## Fixed local UI preview

All human UI previews use exactly:

http://127.0.0.1:8001/web/

Never allocate another preview port.

Before starting a preview:
- stop any existing server listening on 127.0.0.1:8001;
- start the new task worktree server on 127.0.0.1:8001;
- store PID in .ai/ui-preview.pid;
- store log in .ai/ui-preview.log.

Only one task preview server may exist at a time.
Do not use ports 8000, 8002, 8003, 8004, or increment ports automatically.

## Provider recovery policy

An assigned writer/provider tooling failure is not by itself a human blocker.
Retry an apparently infrastructural writer failure once. If that provider still
cannot write its permitted task scope, preserve its worktree as read-only
reference and create or resume an equivalent successor task with the other
capable writer provider. Reuse useful partial work only as reference and retain
an independent review where possible. Report `BLOCKED` only when both viable
writer paths fail, or when a genuine product/architecture decision is needed.
