async function sanitizedEnv() {
  const env = { ...process.env }

  for (const key of [
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
  ]) {
    const value = env[key]

    if (value && !(await Bun.file(value).exists())) {
      delete env[key]
    }
  }

  return env
}

async function runRaw(cmd, cwd, stdin) {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: await sanitizedEnv(),
  })

  if (stdin !== undefined) {
    proc.stdin.write(stdin)
    proc.stdin.end()
  }

  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()

  const code = await proc.exited
  const stdout = await stdoutPromise
  const stderr = await stderrPromise

  if (code !== 0) {
    const detail = [stderr.trim(), stdout.trim()]
      .filter(Boolean)
      .join("\n")

    throw new Error(
      detail || `Command failed with exit code ${code}: ${cmd.join(" ")}`,
    )
  }

  return stdout
}

async function run(cmd, cwd, stdin) {
  return (await runRaw(cmd, cwd, stdin)).trim()
}

// Review prompts can contain a full patch. Windows command lines have a
// small, shell-dependent limit, so they must never be passed as argv.
async function runReview(cmd, cwd, prompt) {
  return await runRaw(cmd, cwd, prompt)
}

function slash(path) {
  return String(path).replace(/\\/g, "/").replace(/\/+$/, "")
}

function rootPath(root, relative) {
  return `${slash(root)}/${relative}`
}

const APPDATA = process.env.APPDATA
  ? slash(process.env.APPDATA)
  : ""

const CODEX_BIN = APPDATA
  ? (
      process.arch === "arm64"
        ? `${APPDATA}/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe`
        : `${APPDATA}/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`
    )
  : ""

const CLAUDE_BIN = APPDATA
  ? `${APPDATA}/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe`
  : ""

const taskSchema = {
  type: "object",
  properties: {
    task_id: {
      type: "string",
      pattern: "^[A-Za-z0-9._-]+$",
      description: "Existing orchestration task ID.",
    },
    prompt: {
      type: "string",
      minLength: 1,
      description: "Instruction for the assigned worker.",
    },
  },
  required: ["task_id", "prompt"],
  additionalProperties: false,
}

const reviewSchema = {
  type: "object",
  properties: {
    task_id: {
      type: "string",
      pattern: "^[A-Za-z0-9._-]+$",
      description: "Existing orchestration task ID.",
    },
    profile: {
      type: "string",
      enum: ["fast", "standard", "expert"],
      description: "Bounded reviewer profile.",
    },
    focus: {
      type: "string",
      description: "Optional extra review focus.",
    },
  },
  required: ["task_id", "profile"],
  additionalProperties: false,
}

const analysisSchema = {
  type: "object",
  properties: {
    profile: {
      type: "string",
      enum: ["fast", "standard", "expert"],
      description: "Bounded Claude analysis profile.",
    },
    prompt: {
      type: "string",
      minLength: 1,
      description: "Read-only repository analysis instruction.",
    },
  },
  required: ["profile", "prompt"],
  additionalProperties: false,
}

const CLAUDE_PROFILES = {
  fast: {
    model: "haiku",
  },
  standard: {
    model: "sonnet",
  },
  expert: {
    model: "opus",
  },
}

const CODEX_PROFILES = {
  fast: {
    model: "gpt-5.6-luna",
    effort: "low",
  },
  standard: {
    model: "gpt-5.6-terra",
    effort: "medium",
  },
  expert: {
    model: "gpt-5.6-sol",
    effort: "high",
  },
}

function validateTaskId(taskId) {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) {
    throw new Error(`Invalid task id: ${taskId}`)
  }
}

async function readTask(root, taskId) {
  validateTaskId(taskId)

  const path = rootPath(root, `.ai/tasks/${taskId}.json`)
  const file = Bun.file(path)

  if (!(await file.exists())) {
    throw new Error(`Unknown orchestration task: ${taskId}`)
  }

  return await file.json()
}

function assertTask(task, provider) {
  if (task.mode !== "write") {
    throw new Error(
      `Task ${task.id} is mode=${task.mode}; CLI writers require mode=write`,
    )
  }

  if (task.writer !== provider) {
    throw new Error(
      `Task ${task.id} belongs to writer=${task.writer}, not ${provider}`,
    )
  }

  if (!["ready", "running"].includes(task.status)) {
    throw new Error(
      `Task ${task.id} must be ready or running; current status=${task.status}`,
    )
  }

  if (!task.worktree || !task.branch) {
    throw new Error(`Task ${task.id} has no attached worktree`)
  }

  if (!task.base?.commit) {
    throw new Error(`Task ${task.id} has no recorded base commit`)
  }

  if (
    !Array.isArray(task.write_scope) ||
    task.write_scope.length === 0
  ) {
    throw new Error(`Task ${task.id} has no write scope`)
  }

  const profiles =
    provider === "claude" ? CLAUDE_PROFILES : CODEX_PROFILES

  if (!profiles[task.profile]) {
    throw new Error(
      `Unsupported ${provider} profile for ${task.id}: ${task.profile}`,
    )
  }
}

function splitNull(text) {
  return text
    .split("\0")
    .map((x) => x.trim())
    .filter(Boolean)
}

function normalizeRepoPath(path) {
  return String(path)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
}

function pathWithinScope(file, scope) {
  file = normalizeRepoPath(file)
  scope = normalizeRepoPath(scope)

  return file === scope || file.startsWith(`${scope}/`)
}

async function changedFiles(task) {
  const cwd = slash(task.worktree)
  const base = task.base.commit

  const committed = splitNull(
    await runRaw(
      [
        "git",
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        base,
        "HEAD",
      ],
      cwd,
    ),
  )

  const working = splitNull(
    await runRaw(
      [
        "git",
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        "HEAD",
      ],
      cwd,
    ),
  )

  const untracked = splitNull(
    await runRaw(
      [
        "git",
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      cwd,
    ),
  )

  return [...new Set([...committed, ...working, ...untracked])]
}

async function assertScope(task) {
  const files = await changedFiles(task)

  const outside = files.filter(
    (file) =>
      !task.write_scope.some((scope) =>
        pathWithinScope(file, scope),
      ),
  )

  if (outside.length > 0) {
    throw new Error(
      [
        `OUT_OF_SCOPE_CHANGE for task ${task.id}`,
        `Allowed scope: ${task.write_scope.join(", ")}`,
        "Unexpected paths:",
        ...outside.map((x) => `  ${x}`),
        "",
        "Changes were preserved. Nothing was automatically reverted.",
      ].join("\n"),
    )
  }
}

function delegatedPrompt(task, prompt) {
  return [
    `Orchestration task: ${task.id}`,
    `Declared goal: ${task.goal}`,
    `Allowed write scope: ${task.write_scope.join(", ")}`,
    "",
    "Work only in the current task worktree.",
    "Follow AGENTS.md and the provider-specific project instructions.",
    "Do not push, merge, force-push, reset --hard, or clean the repository.",
    "Do not modify files outside the declared write scope.",
    "",
    "Requested work:",
    prompt,
  ].join("\n")
}

async function prepareTask(root, taskId, provider) {
  let task = await readTask(root, taskId)
  assertTask(task, provider)

  const taskctl = rootPath(root, ".ai/bin/taskctl.py")
  const contextSync = rootPath(root, ".ai/bin/context-sync.sh")

  await run(
    ["python", taskctl, "check", taskId],
    root,
  )

  await run(
    ["bash", contextSync, taskId],
    root,
  )

  task = await readTask(root, taskId)
  assertTask(task, provider)

  await assertScope(task)

  return task
}

async function recordSession(root, taskId, provider, sessionId) {
  const taskctl = rootPath(root, ".ai/bin/taskctl.py")
  const contextSync = rootPath(root, ".ai/bin/context-sync.sh")

  await run(
    [
      "python",
      taskctl,
      "session",
      taskId,
      provider,
      sessionId,
    ],
    root,
  )

  await run(
    ["bash", contextSync, taskId],
    root,
  )
}

async function markRunning(root, task) {
  if (task.status !== "ready") {
    return
  }

  const taskctl = rootPath(root, ".ai/bin/taskctl.py")
  const contextSync = rootPath(root, ".ai/bin/context-sync.sh")

  await run(
    ["python", taskctl, "status", task.id, "running"],
    root,
  )

  await run(
    ["bash", contextSync, task.id],
    root,
  )
}

function parseCodexJsonl(stdout) {
  let threadId = null
  const messages = []

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    let event

    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (
      event.type === "thread.started" &&
      typeof event.thread_id === "string"
    ) {
      threadId = event.thread_id
    }

    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      typeof event.item?.text === "string"
    ) {
      messages.push(event.item.text)
    }

    if (event.type === "error") {
      const message =
        event.message ||
        event.error?.message ||
        JSON.stringify(event)

      throw new Error(`Codex event error: ${message}`)
    }

    if (event.type === "turn.failed") {
      const message =
        event.error?.message ||
        event.message ||
        JSON.stringify(event)

      throw new Error(`Codex turn failed: ${message}`)
    }
  }

  return {
    threadId,
    content: messages.join("\n\n").trim(),
  }
}


function reviewerProfiles(provider) {
  return provider === "claude"
    ? CLAUDE_PROFILES
    : CODEX_PROFILES
}

function assertReviewTask(task, provider, profileName) {
  if (task.mode !== "write") {
    throw new Error(
      `Task ${task.id} must be a write task before review`,
    )
  }

  if (!["ready", "running", "review"].includes(task.status)) {
    throw new Error(
      `Task ${task.id} is not reviewable; status=${task.status}`,
    )
  }

  if (!task.worktree || !task.branch) {
    throw new Error(
      `Task ${task.id} has no attached worktree`,
    )
  }

  if (!task.base?.commit) {
    throw new Error(
      `Task ${task.id} has no recorded base commit`,
    )
  }

  if (!task.checkpoint?.commit) {
    throw new Error(
      `Task ${task.id} has no recorded checkpoint`,
    )
  }

  const profiles = reviewerProfiles(provider)

  if (!profiles[profileName]) {
    throw new Error(
      `Unsupported ${provider} review profile: ${profileName}`,
    )
  }
}

async function prepareReview(
  root,
  taskId,
  provider,
  profileName,
) {
  let task = await readTask(root, taskId)

  assertReviewTask(
    task,
    provider,
    profileName,
  )

  const taskctl = rootPath(
    root,
    ".ai/bin/taskctl.py",
  )

  const contextSync = rootPath(
    root,
    ".ai/bin/context-sync.sh",
  )

  await run(
    [
      "python",
      taskctl,
      "review-ready",
      taskId,
    ],
    root,
  )

  await run(
    [
      "bash",
      contextSync,
      taskId,
    ],
    root,
  )

  task = await readTask(root, taskId)

  assertReviewTask(
    task,
    provider,
    profileName,
  )

  // Re-check after context synchronization.
  await run(
    [
      "python",
      taskctl,
      "review-ready",
      taskId,
    ],
    root,
  )

  await assertScope(task)

  return task
}

async function assertReviewUnchanged(task) {
  const cwd = slash(task.worktree)
  const checkpoint = task.checkpoint.commit

  const head = await run(
    ["git", "rev-parse", "HEAD"],
    cwd,
  )

  if (head !== checkpoint) {
    throw new Error(
      `REVIEW_TARGET_CHANGED for ${task.id}: ` +
      `expected ${checkpoint}, found ${head}`,
    )
  }

  const dirty = await runRaw(
    ["git", "status", "--porcelain"],
    cwd,
  )

  if (dirty.trim()) {
    throw new Error(
      `REVIEW_DIRTY_WORKTREE for ${task.id}. ` +
      "Review was not recorded.",
    )
  }
}

async function buildReviewPrompt(
  task,
  provider,
  profileName,
  focus,
) {
  const cwd = slash(task.worktree)
  const base = task.base.commit
  const checkpoint = task.checkpoint.commit

  const diff = await runRaw(
    [
      "git",
      "diff",
      "--no-ext-diff",
      "--no-renames",
      "--unified=40",
      base,
      checkpoint,
      "--",
    ],
    cwd,
  )

  if (!diff.trim()) {
    throw new Error(
      `Task ${task.id} has no diff between base and checkpoint`,
    )
  }

  // Source changes are never truncated. Generated material is deliberately
  // omitted when enormous, with an explicit review notice instead.
  const generated = /^(?:diff --git a\/|\+\+\+ b\/)(?:web\/assets\/|client-data\/|local\/|backups\/)/m
  let reviewDiff = diff
  if (diff.length > 200000 && generated.test(diff)) {
    const sourceDiff = await runRaw(
      [
        "git", "diff", "--no-ext-diff", "--no-renames", "--unified=40",
        base, checkpoint, "--",
        ":(exclude)web/assets/**", ":(exclude)client-data/**",
        ":(exclude)local/**", ":(exclude)backups/**",
      ],
      cwd,
    )
    reviewDiff = [
      "[Generated payload omitted because it exceeds review transport budget.]",
      "[All non-generated source changes follow; none were truncated.]",
      sourceDiff,
    ].join("\n")
  }

  const tests = (task.tests || [])
    .filter((x) => x.commit === checkpoint)
    .map((x) => {
      const command = JSON.stringify(
        x.command || [],
      )

      return (
        `- exit=${x.exit_code} ` +
        `dirty_after=${Boolean(x.dirty_after)} ` +
        `command=${command}`
      )
    })

  return [
    "Independent code review only.",
    "",
    `Task: ${task.id}`,
    `Goal: ${task.goal}`,
    `Reviewer provider: ${provider}`,
    `Reviewer profile: ${profileName}`,
    `Base commit: ${base}`,
    `Checkpoint commit: ${checkpoint}`,
    `Declared scope: ${task.write_scope.join(", ")}`,
    "",
    "The checkpoint is immutable for this review.",
    "Do not edit, create, delete, rename, commit, reset, clean, merge, or push anything.",
    "Do not act as the writer.",
    "",
    "Review for concrete correctness problems, regressions, unsafe behavior, broken assumptions, missing validation, and test gaps.",
    "Do not request changes for purely stylistic preferences unless they create a concrete maintenance or correctness risk.",
    "",
    "Begin the response immediately with exactly one of these verdict lines:",
    "VERDICT: APPROVED",
    "VERDICT: CHANGES_REQUESTED",
    "Do not put a heading, greeting, explanation, bullet, quote, or markdown formatting before the verdict.",
    "",
    "After the verdict, report findings concisely.",
    "For blocking findings, identify the relevant file and line/area and explain the concrete failure mode.",
    "If approved, mention any meaningful residual risks without converting non-blocking observations into requested changes.",
    "",
    focus
      ? `Additional review focus: ${focus}`
      : "Additional review focus: none",
    "",
    "Recorded tests for this checkpoint:",
    ...tests,
    "",
    "PATCH UNDER REVIEW:",
    "----- BEGIN PATCH -----",
    reviewDiff,
    "----- END PATCH -----",
  ].join("\n")
}

function parseReviewVerdict(content) {
  const lines = content
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)

  // Allow a very small amount of harmless model preamble, while
  // still requiring an explicit, unambiguous verdict near the top.
  const head = lines.slice(0, 8)

  const hits = head.filter(
    (line) =>
      line === "VERDICT: APPROVED" ||
      line === "VERDICT: CHANGES_REQUESTED",
  )

  const unique = [...new Set(hits)]

  if (unique.length === 1) {
    return unique[0] === "VERDICT: APPROVED"
      ? "approved"
      : "changes_requested"
  }

  const preview = head
    .join(" | ")
    .slice(0, 1200)

  throw new Error(
    "Reviewer output must contain exactly one explicit verdict " +
    "within its first 8 non-empty lines: " +
    "VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED. " +
    `Received: ${preview || "<empty output>"}`,
  )
}

async function persistReview(
  root,
  task,
  provider,
  profileName,
  content,
) {
  const verdict = parseReviewVerdict(content)
  const checkpoint = task.checkpoint.commit

  const reviewDirRel = ".ai/reviews"
  const reviewDir = rootPath(
    root,
    reviewDirRel,
  )

  await run(
    [
      "python",
      "-c",
      "from pathlib import Path; import sys; " +
        "Path(sys.argv[1]).mkdir(parents=True, exist_ok=True)",
      reviewDir,
    ],
    root,
  )

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")

  const relative =
    `${reviewDirRel}/${task.id}-` +
    `${checkpoint.slice(0, 12)}-` +
    `${provider}-${stamp}.txt`

  const absolute = rootPath(
    root,
    relative,
  )

  const record = [
    `Task: ${task.id}`,
    `Reviewer: ${provider}`,
    `Profile: ${profileName}`,
    `Base: ${task.base.commit}`,
    `Checkpoint: ${checkpoint}`,
    "",
    content.trim(),
    "",
  ].join("\n")

  await Bun.write(
    absolute,
    record,
  )

  const taskctl = rootPath(
    root,
    ".ai/bin/taskctl.py",
  )

  await run(
    [
      "python",
      taskctl,
      "review-record",
      task.id,
      "--reviewer",
      provider,
      "--profile",
      profileName,
      "--commit",
      checkpoint,
      "--verdict",
      verdict,
      "--result",
      relative,
    ],
    root,
  )

  const contextSync = rootPath(
    root,
    ".ai/bin/context-sync.sh",
  )

  await run(
    [
      "bash",
      contextSync,
      task.id,
    ],
    root,
  )

  return {
    verdict,
    result: relative,
  }
}


async function analyzeClaude(root, profileName, prompt) {
  const profile = CLAUDE_PROFILES[profileName]

  if (!profile) {
    throw new Error(`Unsupported Claude analysis profile: ${profileName}`)
  }

  const before = await runRaw(
    ["git", "status", "--porcelain"],
    root,
  )

  if (before.trim()) {
    throw new Error(
      "claude_analyze requires a clean canonical checkout",
    )
  }

  const content = await run(
    [
      CLAUDE_BIN,
      "-p",
      "--model",
      profile.model,
      "--safe-mode",
      "--no-session-persistence",
      "--tools",
      "Read,Grep,Glob",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--output-format",
      "text",
      "--",
      [
        "Read-only repository analysis.",
        "Do not edit, create, delete, rename, format, or generate files.",
        "Do not run commands that modify the repository.",
        "Read AGENTS.md, CLAUDE.md and .ai/STATE.md when useful.",
        "Distinguish verified repository facts from runtime/UI inferences.",
        "",
        prompt,
      ].join("\n"),
    ],
    root,
  )

  const after = await runRaw(
    ["git", "status", "--porcelain"],
    root,
  )

  if (after !== before) {
    throw new Error(
      "READ_ONLY_VIOLATION: repository state changed during Claude analysis",
    )
  }

  return content
}

async function delegateClaude(root, taskId, prompt) {
  const task = await prepareTask(root, taskId, "claude")
  const profile = CLAUDE_PROFILES[task.profile]
  const cwd = slash(task.worktree)

  let sessionId = task.sessions?.claude || null
  const isNew = !sessionId

  if (isNew) {
    sessionId = crypto.randomUUID()
  }

  const cmd = [
    CLAUDE_BIN,
    "-p",
    "--model",
    profile.model,
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--output-format",
    "text",
  ]

  if (isNew) {
    cmd.push("--session-id", sessionId)
  } else {
    cmd.push("--resume", sessionId)
  }

  cmd.push("--", delegatedPrompt(task, prompt))

  const content = await run(cmd, cwd)

  await assertScope(task)

  if (isNew) {
    await recordSession(
      root,
      task.id,
      "claude",
      sessionId,
    )
  }

  await markRunning(root, task)

  return content
}

async function delegateCodex(root, taskId, prompt) {
  const task = await prepareTask(root, taskId, "codex")
  const profile = CODEX_PROFILES[task.profile]
  const cwd = slash(task.worktree)

  const sessionId = task.sessions?.codex || null

  const common = [
    "--json",
    "-m",
    profile.model,
    "-c",
    `model_reasoning_effort=${profile.effort}`,
    "-c",
    "sandbox_mode=workspace-write",
    "-c",
    "approval_policy=never",
  ]

  let cmd

  if (sessionId) {
    cmd = [
      CODEX_BIN,
      "exec",
      "resume",
      ...common,
      "--",
      sessionId,
      delegatedPrompt(task, prompt),
    ]
  } else {
    cmd = [
      CODEX_BIN,
      "exec",
      ...common,
      "--",
      delegatedPrompt(task, prompt),
    ]
  }

  const stdout = await runRaw(cmd, cwd)
  const parsed = parseCodexJsonl(stdout)

  await assertScope(task)

  if (!sessionId) {
    if (!parsed.threadId) {
      throw new Error(
        `Codex completed task ${task.id} but returned no thread_id`,
      )
    }

    await recordSession(
      root,
      task.id,
      "codex",
      parsed.threadId,
    )
  }

  if (!parsed.content) {
    throw new Error(
      `Codex returned no agent_message for task ${task.id}`,
    )
  }

  await markRunning(root, task)

  return parsed.content
}


async function reviewClaude(
  root,
  taskId,
  profileName,
  focus,
) {
  const task = await prepareReview(
    root,
    taskId,
    "claude",
    profileName,
  )

  const profile =
    CLAUDE_PROFILES[profileName]

  const cwd = slash(task.worktree)

  const prompt = await buildReviewPrompt(
    task,
    "claude",
    profileName,
    focus,
  )

  const cmd = [
    CLAUDE_BIN,
    "-p",
    "--model",
    profile.model,
    "--safe-mode",
    "--no-session-persistence",
    "--tools",
    "Read,Grep,Glob",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--output-format",
    "text",
  ]

  const content = await runReview(
    cmd,
    cwd,
    prompt,
  )

  await assertReviewUnchanged(task)

  await persistReview(
    root,
    task,
    "claude",
    profileName,
    content,
  )

  return content
}

async function reviewCodex(
  root,
  taskId,
  profileName,
  focus,
) {
  const task = await prepareReview(
    root,
    taskId,
    "codex",
    profileName,
  )

  const profile =
    CODEX_PROFILES[profileName]

  const cwd = slash(task.worktree)

  const prompt = await buildReviewPrompt(
    task,
    "codex",
    profileName,
    focus,
  )

  const cmd = [
    CODEX_BIN,
    "exec",
    "--json",
    "--ephemeral",
    "-m",
    profile.model,
    "-c",
    `model_reasoning_effort=${profile.effort}`,
    "-c",
    "sandbox_mode=read-only",
    "-c",
    "approval_policy=never",
  ]

  // No positional prompt is appended: `runReview` streams the complete
  // review prompt through stdin, avoiding Windows argv limits.

  const stdout = await runReview(
    cmd,
    cwd,
    prompt,
  )

  const parsed =
    parseCodexJsonl(stdout)

  if (!parsed.content) {
    throw new Error(
      `Codex reviewer returned no agent_message for task ${task.id}`,
    )
  }

  await assertReviewUnchanged(task)

  await persistReview(
    root,
    task,
    "codex",
    profileName,
    parsed.content,
  )

  return parsed.content
}


export default {
  id: "local.cli-delegates",

  async setup(ctx) {
    const root = slash(
      ctx.location?.directory || process.cwd(),
    )

    if (!APPDATA) {
      throw new Error(
        "APPDATA is unavailable; cannot resolve native CLI entrypoints",
      )
    }

    if (!(await Bun.file(CODEX_BIN).exists())) {
      throw new Error(
        `Codex native executable not found: ${CODEX_BIN}`,
      )
    }

    if (!(await Bun.file(CLAUDE_BIN).exists())) {
      throw new Error(
        `Claude native executable not found: ${CLAUDE_BIN}`,
      )
    }

    const required = [
      ".ai/bin/taskctl.py",
      ".ai/bin/context-sync.sh",
      ".ai/STATE.md",
    ]

    for (const relative of required) {
      if (!(await Bun.file(rootPath(root, relative)).exists())) {
        throw new Error(
          `local.cli-delegates must run from the canonical orchestrator checkout; missing ${relative}`,
        )
      }
    }

    await ctx.tool.transform((tools) => {
      tools.add({
        name: "claude_analyze",
        description:
          "Fresh stateless read-only Claude repository analysis. No worktree, edits or persistent session.",
        input: analysisSchema,
        options: {
          codemode: false,
        },
        execute: async ({ profile, prompt }) => ({
          content: await analyzeClaude(
            root,
            profile,
            prompt,
          ),
        }),
      })

      tools.add({
        name: "claude_cli",
        description:
          "Delegate an existing Claude-owned orchestration task to Claude Code. Requires task_id; worktree, profile and session are resolved from the canonical task registry.",
        input: taskSchema,
        options: {
          codemode: false,
        },
        execute: async ({ task_id, prompt }) => ({
          content: await delegateClaude(
            root,
            task_id,
            prompt,
          ),
        }),
      })

      tools.add({
        name: "codex_cli",
        description:
          "Delegate an existing Codex-owned orchestration task to Codex. Requires task_id; worktree, profile, sandbox and persistent session are resolved from the canonical task registry.",
        input: taskSchema,
        options: {
          codemode: false,
        },
        execute: async ({ task_id, prompt }) => ({
          content: await delegateCodex(
            root,
            task_id,
            prompt,
          ),
        }),
      })

      tools.add({
        name: "claude_review",
        description:
          "Fresh independent Claude review of an exact tested task checkpoint. No session resume or persistence; file tools are read-only.",
        input: reviewSchema,
        options: {
          codemode: false,
        },
        execute: async ({
          task_id,
          profile,
          focus,
        }) => ({
          content: await reviewClaude(
            root,
            task_id,
            profile,
            focus,
          ),
        }),
      })

      tools.add({
        name: "codex_review",
        description:
          "Fresh independent Codex review of an exact tested task checkpoint. Uses ephemeral session and read-only sandbox.",
        input: reviewSchema,
        options: {
          codemode: false,
        },
        execute: async ({
          task_id,
          profile,
          focus,
        }) => ({
          content: await reviewCodex(
            root,
            task_id,
            profile,
            focus,
          ),
        }),
      })
    })
  },
}
