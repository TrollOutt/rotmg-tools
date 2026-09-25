# ROTMG Tools — Shared Agent Instructions

## Source of truth

This repository is the active ROTMG Tools workspace.

Stable project state and orchestration metadata live under `.ai/`.

Before substantial work:
1. Read `.ai/STATE.md`.
2. Read the task file under `.ai/tasks/` when one exists.
3. Inspect the current Git state before editing.

## Generated / large data

Do not recursively inspect or edit these unless the task explicitly requires it:

- `client-data/`
- `local/`
- `backups/`
- `RealmEye-Wiki-Sync/`
- `web/assets/`
- large generated JSON datasets

Generated outputs must normally be changed through their source or generator rather than edited directly.

## Collaboration

Multiple agents may work on this repository.

Never assume another agent's conversational context is available to you.

The shared sources of truth are:
- repository files;
- Git commits/diffs;
- `.ai/STATE.md`;
- the active `.ai/tasks/<task>.json`.

Never rely on model cache or prior conversational memory for correctness.

## Concurrency

Read-only exploration may happen in parallel.

Writing may happen in parallel only when tasks have disjoint file scopes.

Never modify a file owned by another active task.

If scopes overlap, work sequentially.

## Git safety

Allowed when relevant:
- git status
- git diff
- git log
- commits on an assigned task branch

Forbidden unless the user explicitly authorizes it:
- git push
- force push
- git reset --hard
- git clean
- rewriting unrelated history

Workers do not merge their own work into the integration branch.

## Validation

A coding task is not complete only because code was written.

It should include, when applicable:
- relevant targeted tests;
- inspection of the resulting diff;
- a fresh review for meaningful changes.

## Routing principles

UI, visual design, CSS, layout, responsive behavior and UX:
- Claude is the preferred writer.

Repository exploration, dependency discovery, logs and high-volume reading:
- DeepSeek Flash is the preferred scout.

General implementation, JavaScript logic, Node tooling, tests, Python and data pipelines:
- Codex is the preferred writer.

The orchestrator chooses task profiles but must never silently escalate to a more expensive model after failure.

A failed delegation must be reported instead of automatically substituting another model.

## Client update / scraping contract

For a game-client update, read `HANDOVER-SOURCE.md` before changing data.

The client Index is the build-time source of truth. New client declarations
must enter through the Index and then reach downstream tools through their
normal projections. Do not add a new gear item independently to Theory Crafting,
the Enchant Calculator, or another generated catalogue.

After an update, verify every new or changed equipment record at the boundaries
where it is eligible:
- present in the Index with canonical display name and client alias/id;
- present in Theory Crafting when compatible with a class;
- searchable in the manual Theory picker even when progression provenance is unknown;
- present in enchanting data only when the client marks it enchantable;
- represented canonically in What's New;
- served by the browser preview, not merely present in generated files.

RealmEye is a separate community source. Never infer Blueprint acquisition from
the gear's ordinary Drops From relation. Only explicit Blueprint Drops From or
Blueprint Obtained Through evidence may create acquisition relations for a
Blueprint.

For an ordinary client update, do not run a recursive/full-site RealmEye crawl.
Fetch only exact pages justified by new or changed records unless the user
explicitly requests a full refresh.