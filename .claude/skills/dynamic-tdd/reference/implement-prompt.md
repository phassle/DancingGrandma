# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view {{TASK_ID}} --comments`. Its parent is **PRD #{{PRD}}** — pull that in too (`gh issue view {{PRD}}`).

Only work on the issue specified.

You are in a **fresh, isolated git worktree** branched off the feature branch. As your **first action**, create the work branch:

```
git switch -c {{BRANCH}}
```

Work on `{{BRANCH}}`. Make commits and run tests. Never touch `{{BASE}}`, `develop`, or `main`.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

```
git log -n 10 --format="%H%n%ad%n%B---" --date=short
```

</recent-commits>

# REUSE — extend shared seams, don't fork them

The planner assigned the shared infrastructure for this wave. **You must reuse these seams
rather than write your own copy:**

{{REUSE}}

Before writing **any** new helper, module, guard, client, or test harness, **grep for an
existing seam first** — search the repo and the sibling `dynamic-tdd/issue-*` branches:

```
git grep -n "<concept>"                 # e.g. auth guard, fetch client, tx helper
git branch --list 'dynamic-tdd/issue-*' # sibling slices whose seams you can extend
```

If a seam already exists (or is listed above), import and extend it. Add a new module only
when nothing suitable exists — and if you do, keep it small and single-purpose so a sibling
slice can reuse it too. Two implementations of the same concern is a defect the merger will
have to reconcile; don't create one.

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

Use RGR (red-green-refactor) to complete the task. Tests sit beside the file (`*.test.js` / `*.test.jsx`).

1. RED: write one failing test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

## Proxy-sensitive absolute URLs

Any absolute URL built **server-side** — OIDC callback / `redirect_uri`, payment
success/return URLs, anything sent to an external service that must point back at the
browser-facing host — is proxy-sensitive. Behind Aspire / a reverse proxy, `request.url`
(and Next's `request.nextUrl`) resolve to the server's *bind* address, not the host the
browser used, so a URL built from that origin is wrong in every deployed topology.

- **Derive the external origin from `x-forwarded-host` / `x-forwarded-proto` (falling back
  to `host`), never from the `request.url` origin.** (This is exactly the seam the PRD #54
  sign-in bug lived in — 168 green route tests, sign-in totally broken.)
- Write a test that asserts the built URL uses the forwarded host, not the bind address.
- The real round trip is proven later in verify (see verify-prompt.md's auth gate) — your
  job here is to build the URL from the right header.

## Money-path invariant checklist

If this slice touches **credits, wallets, or payments**, the faked-externals TDD below is
not enough — these classes survived TDD in the PRD #54 run and were only caught by the
Codex review. Write tests (RED first) for **each that applies**:

- **Concurrency on every settling transition.** Two workers hitting the same
  claim/finalize/refund at once must not double-run it. Assert claim/lease semantics
  (a conditional `UPDATE ... WHERE state = 'x' RETURNING`, row lock, or equivalent) — a
  merely-idempotent UPDATE is not enough; prove the second worker is rejected or no-ops.
- **A crash between every pair of adjacent steps.** For each step boundary (reserve →
  submit → finalize → deliver), assert that a crash there leaves the money recoverable —
  who un-reserves the credit / refunds / retries? No step may strand funds forever.
- **Scoping of external triggers.** A webhook/callback that grants credit must be tied to
  *our* price/product/subscription id — assert that an unrelated paid event on the same
  merchant account grants nothing.
- **Lock ordering** across every wallet-touching transaction, so concurrent transactions
  that take the same locks can't deadlock or interleave into a lost update.

# FEEDBACK LOOPS

You are in a **fresh worktree**, so `node_modules/` will be missing. Install dependencies first:

```
[ -d node_modules ] || npm install
```

Then, before committing, run `npm run typecheck` and `npm test` to ensure everything passes. **Both must pass before you commit.**

# COMMIT

Make a git commit on `{{BRANCH}}`. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD reference (#{{PRD}})
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise. Make at least one commit if you produced any passing progress.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do **not** close the issue — completion is handled later when the feature PR merges.

# OUTPUT

Return `{ id, branch, committed, summary }` via the **structured-output tool** — `committed` is `true` if you made at least one commit on `{{BRANCH}}`. (This supersedes the `<promise>COMPLETE</promise>` convention.)

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
