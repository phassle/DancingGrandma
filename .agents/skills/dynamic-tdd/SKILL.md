---
name: dynamic-tdd
description: Build every open issue under a PRD automatically — a dynamic Workflow plans (dependency graph) → implements each issue with TDD in isolated worktrees → merges each into one feature branch (deleting each merged worktree) → then simplify → verify in Aspire (web logs) → local Codex PR review → open one PR into develop. Use when the user runs /dynamic-tdd <PRD#>, wants to auto-build a PRD's child issues, or asks to orchestrate issues with the Workflow tool / sandcastle-style flow. The PR-prep tail (PR-PREP.md) is also standalone-runnable — use it when the user says "prep this branch for a PR" or wants the pre-PR quality gates on a feature branch.
---

# dynamic-tdd

Replaces the `.sandcastle` plan→implement→merge loop with the **Workflow tool**, integrating into a feature branch instead of pushing to trunk.

**Branch model:** `develop` → `feature/<prd-slug>` → per-issue worktrees (`dynamic-tdd/issue-<id>`) → merge each back into the feature branch (then delete that worktree) → **one PR** `feature/<prd-slug>` → `develop`. Never push to `develop`/`main` directly (see CLAUDE.md).

**Pipeline:** plan → implement (parallel TDD, isolated worktrees) → merge + delete merged worktree → **[PR-prep tail](PR-PREP.md)** (simplify → verify in Aspire → local Codex PR review → create PR). The **Workflow tool** runs the first three (the fan-out, step 4); **[PR-PREP.md](PR-PREP.md)** runs the whole gated tail (step 5).

Fan-out phase prompts live in [reference/](reference/) (`plan-prompt.md`, `implement-prompt.md`, `merge-prompt.md`), adapted from `.sandcastle/*-prompt.md`. The tail's prompts (`simplify-prompt.md`, `verify-prompt.md`) live there too, used by [PR-PREP.md](PR-PREP.md). The agents read and follow them.

## Run

1. **Resolve the PRD.** Take the number from `/dynamic-tdd <PRD#>`; if absent, ask. Read it and list its open children:
   ```bash
   gh issue view <PRD#> --json number,title,body
   # Children = issues whose ## Parent section names #<PRD#> as the PRIMARY (first) parent:
   gh issue list --state open --json number,title,body --jq '[.[] | select(.body | test("(?i)## *parent")) | {number,title,body}]'
   ```
   Keep only those whose `## Parent` section lists `#<PRD#>` first — exclude prose mentions, soft deps, and other PRDs' slices. If there are zero children, stop and tell the user.

2. **Confirm scope + branch name with the user** (this run will create commits and merges). Derive a slug from the PRD title → `feature/<prd-slug>`. Show the PRD, the child issues, and the branch name; get a go-ahead.

3. **Prep git** (must end on the feature branch in the main worktree — the merger and worktree bases depend on it):
   ```bash
   git fetch origin
   git switch -c feature/<prd-slug> origin/develop   # base off latest develop
   ```
   If the branch already exists, `git switch feature/<prd-slug>` and reuse it (the run is resumable — branch names are deterministic).

4. **Run the Workflow** (it loops plan→implement→merge until nothing is unblocked; the merge phase deletes each worktree once its branch is merged — see `merge-prompt.md`):
   ```
   Workflow({
     scriptPath: ".agents/skills/dynamic-tdd/scripts/dynamic-tdd.workflow.mjs",
     args: { prd: "<PRD#>", featureBranch: "feature/<prd-slug>", base: "develop", maxIterations: 10, maxParallel: 6 }
   })
   ```
   Wait for the `<task-notification>`; watch live with `/workflows`. It returns `{ mergedIssues, ... }`. Confirm `git worktree list` shows only the main worktree afterwards (prune any stragglers: `git worktree prune` + `git worktree remove`).

   The tail runs **only if `mergedIssues` is non-empty**. Stop and report if it fails — do not open the PR.

5. **Run the PR-prep tail** per [PR-PREP.md](PR-PREP.md) with the workflow result:
   - `branch: feature/<prd-slug>`, `base: develop`, `closes: <mergedIssues>`, `label: PRD #<PRD#>`.

   It runs **simplify → verify in Aspire (web logs) → local Codex PR review → open one PR into `develop`** (with `Closes #<id>` for each merged issue), each step gated — a failed verify or unresolved Codex blocker stops it before the PR. See [PR-PREP.md](PR-PREP.md) for the step detail and its `reference/` prompts.

## Notes

- **Isolation:** each implementer runs with `isolation: 'worktree'` so parallel agents never collide; they share the git object store, so the `dynamic-tdd/issue-<id>` branches are visible to the merger. The merger runs with **no** isolation (in the main worktree, on the feature branch).
- **Worktree cleanup:** the merge phase removes each issue worktree and deletes its branch right after merging it (the Workflow keeps committed worktrees otherwise). After the run, only the main worktree should remain.
- **Gated tail:** [PR-PREP.md](PR-PREP.md) runs simplify → verify → Codex review → PR in sequence, each gated; a failed verify (dirty web logs or a failing browser test) or an unresolved Codex blocker stops it before the PR. The tail is also runnable standalone on any feature branch — follow PR-PREP.md directly.
- **Per-iteration incrementality:** later iterations branch off the feature branch's *current* HEAD, so issues unblocked by earlier merges build on top of them.
- **Issues are not closed mid-run** — completion happens when the single feature PR merges.
- **Cost:** one Opus planner + N Opus implementers (full TDD) + one merger per iteration. Scale `maxParallel`/`maxIterations` to the backlog; warn the user for large PRDs.
- **Resumable:** re-running with the same PRD reuses the feature branch and deterministic issue branches; the planner skips ids already merged.

## Unresolved questions

- Should the final feature→develop PR be opened automatically, or always left to the user? (Current: orchestrator opens it in step 5 after review.)
- Mono-PRD only — cross-PRD batching isn't handled.
