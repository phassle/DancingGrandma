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

Phase prompts: [reference/simplify-prompt.md](reference/simplify-prompt.md), [reference/verify-prompt.md](reference/verify-prompt.md). The agents read and follow them (placeholders: `{{BRANCH}}`, `{{BASE}}`, `{{LABEL}}`). `verify-prompt.md` also uses `{{BOOT_SIGNAL}}` (the observable that proves the app booted) and `{{KNOWN_ENV_NOISE}}` (the environmental console/network noise this app tolerates by design) — resolve both per project from the `verify` skill / `SKILL.md` / AppHost config before running verify; everything not on the noise list is treated as a potential regression.

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

3. **Local Codex PR review.** Ensure Codex is ready (`/codex:setup`), then review the diff (`git diff origin/<base>...HEAD`) via the `codex:rescue` skill — ask it to review the changes like a PR. When polling the Codex companion's job JSON, the run **status lives at `job.status`** (not a top-level `status`) — read that field path explicitly, or the poller silently never sees completion. Address any **blocking** findings on `branch` (commit fixes, keep tests green) and re-run the relevant checks; record nits in the PR body.

4. **Create the PR — only when 1–3 all pass.** Open ONE PR via the `create-pr` skill (or `gh pr create`) with base `<base>`. Title from `label`, or the slug derived in step 0 when there's no PRD/label. Include `Closes #<id>` for each `closes` issue and a test-plan summary (which gates ran and their results, including the Codex outcome).

   **The PR body MUST end with a `## Review checklist` section** — a step-by-step test
   schema over everything the branch built, so a reviewer can verify the work without
   reverse-engineering the diff. Build it from the merged issues' acceptance criteria
   plus what the verify step actually exercised:

   - **How to run** first: exact commands to boot the stack locally (launcher, required
     local params/secrets file, seeded test user, app URL).
   - One `### <issue title> (#<id>)` subsection per merged issue with numbered `- [ ]`
     checkbox steps: concrete action → expected observable result ("Start a generation
     with 1 credit → balance shows 0 available / 1 reserved"). Include the negative and
     edge steps the tests cover (double-click, replayed webhook, unauthenticated call) —
     those are exactly what human reviews miss.
   - Steps the reviewer cannot run locally (real Stripe keys, real provider spend) are
     kept but marked `⚠ needs <X>`, naming the evidence that covers them instead (the
     integration test, or the verify step's captured result).
   - Close with `### Automated coverage`: test count, which externals are faked, where
     the integration tests live — so the reviewer spends time only on what machines
     haven't already checked.

   **Scale the checklist to what exists** (ADR 0002). With `closes` issues (a
   dynamic-tdd run): the full per-issue format above. Standalone with no linked
   issues: still end with a checklist, but minimal — the *How to run* block plus one
   flat action → expected-result list derived from the diff; the coverage footer only
   if tests changed. Either way, **never emit a checkbox that neither a runnable human
   step nor named evidence backs** — an unverifiable checkbox trains reviewers to skip
   the list. Quote UI labels only when the verify step actually observed them.

5. **After the PR merges into `develop` — close the referenced issues explicitly.**
   GitHub only honours `Closes/Fixes/Resolves #N` on merges into the **default branch**
   (`main`). This repo is gitflow — feature PRs merge into `develop`, so the keyword
   **never auto-closes** at feature-merge time (the PR #76 → `develop` merge left all of
   #55–#60 open until manual triage). So once the PR is merged into `develop`, parse the
   `Closes #N` references from the PR body and close each with a comment pointing at the PR:
   ```bash
   pr=<pr-number>
   # Only after the PR is actually merged (idempotent — safe to re-run).
   merged=$(gh pr view "$pr" --json mergedAt --jq '.mergedAt // empty')
   [ -n "$merged" ] || { echo "PR #$pr not merged yet — skipping close."; exit 0; }
   url=$(gh pr view "$pr" --json url --jq .url)
   # Grab every #N on a line carrying a closing keyword (handles grouped "Closes #55, #56").
   gh pr view "$pr" --json body --jq '.body' \
     | grep -iE '(clos|fix|resolv)[a-z]*' | grep -oE '#[0-9]+' | tr -d '#' | sort -u \
   | while read -r n; do
       state=$(gh issue view "$n" --json state --jq '.state')
       [ "$state" = "OPEN" ] || { echo "#$n already $state — skipping."; continue; }
       gh issue close "$n" --comment "Resolved by $url (merged into develop)."
     done
   ```
   Do this whether the merge was agent-driven or a manual PR merge into `develop`. (This
   is the manual counterpart to the automation tracked in #88; until that lands, the flow
   owns the close.) The final feature→`develop` merge closes the child issues; the eventual
   `develop`→`main` release merge is where GitHub's own auto-close would otherwise fire.

## Notes

- **Gated tail:** simplify → verify → Codex review → PR run in sequence and each must pass.
- **Known environmental noise is not a regression.** Whatever is listed in the project's `{{KNOWN_ENV_NOISE}}` (e.g. transient third-party feed rate-limits, dev-cert warnings) is environmental — the app tolerates it by design. Don't fail the verify on it; only fail on app-level errors (uncaught exceptions, framework/React errors, new `console.error`/`warn` from app code). Everything not on the noise list is a potential regression.
- **Distinguish HMR artifacts from real bugs.** A live edit to a running dev server can log one-off React "change in the order of Hooks" / invalid-hook-call errors. Re-check on a **fresh page load** — if it's gone, it was hot-reload state, not a bug.
- **Exclude `.claude/workflows/` from every tail commit.** The saved dynamic workflow file lands untracked in the repo during a run; the simplify commit (step 1) and any Codex-fix commits (step 3) must **not** stage it (`git add` specific paths, or `git restore --staged .claude/workflows/` before committing). It is a run artifact, not part of the change set.
- **A tail fork killed by the session limit is resumed, not respawned.** simplify and blocker-fix forks die the same way the fan-out does; resume them by messaging the same agent (`SendMessage`) — its context and uncommitted working-tree state survive — never spawn a fresh one, which re-reads everything and pays twice.
- **Standalone vs dynamic-tdd.** Invoked by dynamic-tdd, the inputs come from the workflow result (`branch`=feature/<prd-slug>, `base`, `closes`=merged issues, `label`=PRD #). Standalone, infer `branch`=current, `base`=`develop` (ask if ambiguous), and build the PR body from the commit log.

## Unresolved questions

- Should the PR be opened automatically at step 4, or always left for the user to confirm? (Current: open it after 1–3 pass.)
- Should simplify be skippable via an input flag for branches that have already been simplified?
