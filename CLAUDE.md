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
