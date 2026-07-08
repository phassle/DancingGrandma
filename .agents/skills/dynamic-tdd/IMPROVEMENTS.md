# dynamic-tdd — improvements learned from the PRD #54 run

Retrospective from the first full run (PRD #54, 6 child issues → `feature/paid-generation`,
July 2026). The pipeline worked end to end — plan → 6 TDD slices in worktrees → merges →
simplify → verify in Aspire → Codex review → blocker fixes — but every phase surfaced
something the skill should encode. Ranked by impact.

> **This document is frozen rationale, not a TODO list** (ADR 0001). Each section
> carries a `Status:` line; unapplied proposals live as tracked issues — the issue
> tracker, not this file, is the backlog. Do not edit sections to reflect later work;
> update the linked issue instead.

## What worked (keep)

- **Deterministic resume.** Two session-limit deaths (3 implementers + planner; later the
  simplify fork) cost nothing: `resumeFromRunId` replayed merged slices from cache, and a
  dead fork resumed via `SendMessage` with its context intact. Partial success is the
  normal case, not an error.
- **The gated tail earns its keep.** Simplify removed ~1,500 lines of cross-slice
  duplication; verify-in-Aspire caught a sign-in-breaking OIDC bug no route test could
  see; Codex review found four real money-path blockers (finalize race, stuck-reserved
  leak, expiry race, unscoped webhook grants). Each gate caught a different class of
  defect. None was redundant.

## 1. Parallel slices duplicate infrastructure — plan for shared seams

_Status: tracked as #78_
**Symptom:** 6 slices shipped two parallel API client modules (one dead on arrival), the
same 3-line 401 guard 11 times, per-file copies of the integration-test harness, and a
superseded credit path left beside its replacement.

**Change:**
- `reference/plan-prompt.md`: the planner must name the **shared infrastructure** (auth
  guard, test harness, DB transaction helper, client seam) and assign it to the first
  slice; later slices get an explicit "reuse, don't reinvent" list in their issue prompt.
- `reference/implement-prompt.md`: before writing a new helper/module, grep for an
  existing seam (and the sibling slices' branches) — extend rather than fork it.
- `reference/merge-prompt.md`: the merger reconciles *semantics*, not just conflicts —
  after merging, check for two implementations of the same concern and file/fix the
  loser. (The `media_assets` reconciliation commit shows this working when prompted.)

## 2. Verify must prove it is driving *this branch's* app

_Status: tracked as #79_
**Symptom:** the first verify round drove a three-day-old stale `next start` on :3000
(pre-branch build → misleading 404s) while Aspire's real web resource couldn't bind.
Separately, Aspire's `web` hung forever in `Waiting` because the branch added new
`AddParameter`s missing from the gitignored local settings — non-interactive `aspire run`
cannot prompt.

**Change to `reference/verify-prompt.md`:**
- Preflight: diff `appsettings.Development.json.example` against the local file; stop
  with a clear message if the branch added parameters the local file lacks.
- Preflight: detect stale dev servers / worktree sessions squatting the app's ports;
  kill or report them before launching.
- After launch: **prove branch identity** — probe a route that only exists on this
  branch (expect e.g. 401, not 404) before trusting any log or screenshot.
- Ports are dynamic under Aspire: discover the web port from the process/proxy, don't
  assume 3000.

## 3. The verify prompt was another project's prompt

_Status: tracked as #80_
**Symptom:** `verify-prompt.md` instructs checking "GTFS-RT polling" and tolerating
"Trafiklab 429 / airplanes.live CORS" noise — copied verbatim from a different repo.
An agent following it literally would hunt for transit feeds in a dance-video app.

**Change:** rewrite the prompt's app-specific lines as placeholders
(`{{BOOT_SIGNAL}}`, `{{KNOWN_ENV_NOISE}}`) resolved from the project, or move them to a
per-repo verify skill. Add to the tail: **persist the discovered run recipe** (launch
command, port discovery, seeded test user, wizard step labels, `ignoreHTTPSErrors` for
Aspire's self-signed dev certs) into `.claude/skills/verify/SKILL.md` so the next run
skips the cold start — this run burned real time rediscovering CTA labels and cert
quirks that are now known.

## 4. Auth flows need one real round trip — route tests can't see them

_Status: tracked as #81_
**Symptom:** 168 green route tests, yet sign-in was completely broken: Keycloak rejects
port-wildcard redirect URIs, and Next 16 pins `request.url` to the server's bind address
(not the browser-facing host), so the built `redirect_uri` was doubly wrong. Both seams
(token verification, browser redirect) are exactly what route tests fake.

**Change:**
- `reference/verify-prompt.md`: when the diff touches auth, a scripted **browser
  register/sign-in round trip against the real IdP is a required gate**, not optional
  flow-exercising.
- `reference/implement-prompt.md`: flag "absolute URLs built server-side" (OIDC
  callbacks, payment success/return URLs) as proxy-sensitive; derive from
  `x-forwarded-host`/`host`, never from `request.url` origin.

## 5. Money paths deserve an invariant checklist at implement time

_Status: tracked as #82_
**Symptom:** Codex found blockers that TDD-with-faked-externals happily shipped:
concurrent polls could double-run finalization and refund a delivered video; a crash
between reserve and submit stranded the credit forever; the expiry sweep raced activity
refresh; any paid invoice on the merchant account granted plan credits.

**Change to `reference/implement-prompt.md`** — when a slice touches credits/payments,
require tests for: two concurrent workers on every settling transition (claim/lease
semantics, not just idempotent UPDATEs); a crash between every pair of adjacent steps
(who recovers the money?); scoping of external triggers (webhook grants tied to *our*
price/subscription, not "any paid event"); and lock ordering across every wallet-touching
transaction. The Codex review stays — but these classes should not survive to it.

## 6. Codify the interrupted-run cleanup

_Status: tracked as #83_
**Symptom:** after the session-limit death, three issue branches and two worktrees sat at
feature-HEAD with uncommitted partial work. The right call (verify zero commits → discard
→ let fresh TDD redo) was improvised.

**Change to SKILL.md's resume notes:** on resume, for each `dynamic-tdd/issue-*`
straggler: commits ahead of the feature branch → keep and let the merger handle it;
zero commits (only dirty files) → `git worktree remove --force` + `git branch -D` and
re-run the slice. Never hand a half-done uncommitted worktree to a fresh implementer.

## 7. Token exhaustion is a first-class event — handle it, don't just survive it

_Status: tracked as #84_
**Symptom:** the run hit the session limit twice mid-flight ("You've hit your session
limit · resets HH:MM"). The pipeline degraded gracefully by accident — dead agents came
back as failures, `mergedIssues` reported the completed subset — but everything after
that was manual: spotting the failure reason, waiting for the reset, cleaning stragglers,
re-invoking with `resumeFromRunId`, and separately resuming a dead fork.

**Change — the skill must own the out-of-tokens path end to end:**
- **Workflow script:** distinguish "agent failed on its task" from "runtime out of
  tokens" (the error text carries the reset time). On token exhaustion, stop launching
  new agents immediately and return a structured pause —
  `{ pausedAt, resetsAt, resumeFromRunId, remainingIssues }` — alongside the partial
  result, instead of letting the remaining wave die one by one.
- **SKILL.md orchestrator instructions:** on a token-limit pause, (1) leave committed
  worktrees alone and apply the §6 straggler rule to uncommitted ones, (2) print the
  exact resume invocation (`Workflow({scriptPath, resumeFromRunId, args})`), and
  (3) schedule/offer the resume for just after the reported reset time instead of
  relying on the user to remember it.
- **Budget before the wave, not after:** the planner knows the wave size; warn when the
  remaining budget plausibly cannot fund the next wave (N implementers × observed
  per-slice cost — this run averaged ~120k tokens per slice, ~1.3M total including the
  tail) and prefer fewer slices per wave over dying mid-implementation.
- **Forks too:** the PR-prep tail's forks (simplify, blocker fixes) die the same way.
  PR-PREP.md should say: a fork killed by the session limit is *resumed* by messaging
  the same agent (its context and uncommitted working-tree state survive) — never
  respawned from scratch, which re-reads everything and pays twice.

## 8. The PR must ship a reviewer test schema (implemented)

_Status: applied — PR-PREP.md step 4 (commit 9560042), format shipped in PR #76_
**Symptom:** a 70+-file PR closing six issues is unreviewable from the diff alone — the
reviewer has no path from "what was built" to "how do I see it working".

**Change (already applied to PR-PREP.md step 4):** the PR body must end with a
`## Review checklist` — how to run the stack, then per merged issue a numbered
checkbox list of concrete action → expected observable result steps (including the
negative/edge cases the tests cover), `⚠ needs <X>` markers for steps requiring real
keys/spend with the covering evidence named, and an `### Automated coverage` footer so
the reviewer only spends time on what machines haven't checked.

## 9. Smaller frictions

_Status: tracked as #85_
- **Poller/JSON contracts:** the tail's Codex status polling read `status` at the top
  level; it lives at `job.status`. Pin the field paths in PR-PREP.md.
- **Cost signalling:** SKILL.md's cost note should set expectations up front:
  large PRDs will hit session limits; the run is designed to pause and resume (§7).
- **`.claude/workflows/` artifacts:** the saved dynamic workflow file lands untracked in
  the repo during the run; the tail's commits must exclude it (the simplify/fix commits
  did so explicitly — encode that in the prompts' commit instructions).
- **Keycloak dev realm + dynamic ports don't mix:** if the stack includes an IdP with a
  redirect whitelist, the plan phase should pin the app's dev port in the AppHost from
  the start (issue #55's slice could have owned this).
