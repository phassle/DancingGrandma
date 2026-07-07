@AGENTS.md

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `phassle/DancingGrandma` (via the `gh` CLI). External PRs are also a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Git workflow — gitflow, always

- `main` is release-only; never commit to it directly.
- `develop` is the integration branch — all work lands here first.
- New work happens on `feature/<short-name>` branches cut from `develop`, merged back
  into `develop` (PRs welcome). Releases: merge `develop` → `main`.
- Hotfixes: `hotfix/<name>` from `main`, merged to both `main` and `develop`.
- Agent worktrees (`.claude/worktrees/`, `EnterWorktree`, `isolation: worktree`) must be
  cut from `develop`, never `main`. Keep the primary checkout on `develop` so new
  worktrees start there by default.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
