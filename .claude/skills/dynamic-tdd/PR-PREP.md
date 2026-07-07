# PR-prep tail

The gated **pre-PR quality tail** for a feature branch whose work is already committed:

**simplify → verify in Aspire (web logs) → local Codex PR review → create PR.**

Each step delegates to an existing skill, runs in order, and **must pass** before the next — a failed verify (dirty web logs / failing browser test) or an unresolved Codex blocker stops the run **before** the PR. Never push to `main`/`develop`; always a PR (see CLAUDE.md).

Part of the [dynamic-tdd](SKILL.md) skill, which runs this tail after its plan→implement→merge fan-out (step 5). Also runnable **standalone** on any feature branch — "prep this branch for a PR".

## Inputs

- **base** — branch to diff against and target the PR at (default `develop`).
- **branch** — the feature branch to prep (default: the current branch).
- **closes** — optional issue numbers to `Closes #<id>` in the PR body (dynamic-tdd passes the issues it merged).
- **label** — optional short tag for the simplify commit / PR (e.g. a PRD number or feature name). **If absent, derive a name from the code** (see step 0).

### Naming when there's no PRD/label

When no `label` is given, name the branch and PR from **what the change actually did**: read `git diff --stat origin/<base>...HEAD` and `git log origin/<base>..HEAD --oneline`, identify the dominant theme, and write a concise kebab slug (e.g. `aircraft-dead-reckoning`, `webcam-clustering`). Use it for the `feature/<slug>` branch name (if one must be created) and the PR title.

Phase prompts: [reference/simplify-prompt.md](reference/simplify-prompt.md), [reference/verify-prompt.md](reference/verify-prompt.md). The agents read and follow them (placeholders: `{{BRANCH}}`, `{{BASE}}`, `{{LABEL}}`).

## Run

0. **Preflight + branch.**
   ```bash
   git fetch origin
   git branch --show-current
   git log origin/<base>..HEAD --oneline          # work to prep (commits ahead of base)
   git diff --name-only origin/<base>...HEAD       # the change set the tail operates on
   git status --short                              # uncommitted work?
   ```
   - **If the current branch is `develop` or `main`:** never open a PR from trunk into itself. Derive a `feature/<slug>` name from the change set (see *Naming* above) and move the work onto it — `git switch -c feature/<slug>` carries both the commits ahead of `base` and any uncommitted changes. Continue the tail on that branch. (If `base` defaulted to the trunk you were on, keep it as the PR target; the new branch's commits ahead of it become the PR.) Tell the user the name you chose.
   - **Otherwise** (already on a feature branch): use it as `branch`.
   - Then ensure the working tree is clean (commit or stash WIP — the steps below add their own commits) and that there are commits ahead of `base`. If nothing is ahead of `base`, stop and tell the user.

1. **Simplify.** Run the `simplify` skill (`/simplify`) over the changed files, following [reference/simplify-prompt.md](reference/simplify-prompt.md). Safe, behaviour-preserving cleanups only, scoped to the change set. Keep `npm test` + `npm run typecheck` green. Commit `<label>: simplify pass` — or make **no** commit if there was nothing to do.

2. **Verify in Aspire.** Run the `observe-running-app` skill (or `/verify`) per [reference/verify-prompt.md](reference/verify-prompt.md): `npm run build`, launch the SPA via **Aspire**, and **verify the browser/web logs are clean** (no new app errors/warnings) while exercising the change. **Run any browser tests the change calls for** (use `playwright-cli` for scripted steps). If the web logs show a regression or a browser test fails, fix it on `branch` (tests green) before continuing.

3. **Local Codex PR review.** Ensure Codex is ready (`/codex:setup`), then review the diff (`git diff origin/<base>...HEAD`) via the `codex:rescue` skill — ask it to review the changes like a PR. Address any **blocking** findings on `branch` (commit fixes, keep tests green) and re-run the relevant checks; record nits in the PR body.

4. **Create the PR — only when 1–3 all pass.** Open ONE PR via the `create-pr` skill (or `gh pr create`) with base `<base>`. Title from `label`, or the slug derived in step 0 when there's no PRD/label. Include `Closes #<id>` for each `closes` issue and a test-plan summary (which gates ran and their results, including the Codex outcome).

## Notes

- **Gated tail:** simplify → verify → Codex review → PR run in sequence and each must pass.
- **Third-party noise is not a regression.** Transient rate-limit errors from external feeds (Trafiklab GTFS-RT `429`, airplanes.live CORS / `ERR_FAILED`) are environmental — the app is built to tolerate them silently. Don't fail the verify on them; only fail on app-level errors (uncaught exceptions, React errors, new `console.error`/`warn` from app code).
- **Distinguish HMR artifacts from real bugs.** A live edit to a running dev server can log one-off React "change in the order of Hooks" / invalid-hook-call errors. Re-check on a **fresh page load** — if it's gone, it was hot-reload state, not a bug.
- **Standalone vs dynamic-tdd.** Invoked by dynamic-tdd, the inputs come from the workflow result (`branch`=feature/<prd-slug>, `base`, `closes`=merged issues, `label`=PRD #). Standalone, infer `branch`=current, `base`=`develop` (ask if ambiguous), and build the PR body from the commit log.

## Unresolved questions

- Should the PR be opened automatically at step 4, or always left for the user to confirm? (Current: open it after 1–3 pass.)
- Should simplify be skippable via an input flag for branches that have already been simplified?
