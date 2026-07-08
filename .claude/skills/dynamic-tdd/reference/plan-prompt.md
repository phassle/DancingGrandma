# ISSUES

You are planning a TDD build of **PRD #{{PRD}}**. Discover its open child work-issues:

<issues-json>

```
gh issue view {{PRD}} --json number,title,body
# Pre-filter to issues that have a "## Parent" section (drops PRDs and loose mentions).
# --limit 200: the default is 30 and will silently truncate larger backlogs.
gh issue list --state open --limit 200 --json number,title,body,labels,comments \
  --jq '[.[] | select(.body | test("(?i)## *parent")) | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'
```

A work-issue belongs to PRD **#{{PRD}}** only when the **first issue reference in its `## Parent` section is `#{{PRD}}`** (its primary parent). A leading `PRD #NNN —` token counts as that reference; refs later on the line or in parentheses are secondary. EXCLUDE issues that:

- merely mention `#{{PRD}}` in prose or in a parenthetical aside,
- list `#{{PRD}}` only as a *secondary* / *soft* dependency (not the first ref in `## Parent`),
- have a different PRD as their primary parent, or
- are themselves a PRD (title starts with `[PRD]`).

</issues-json>

Exclude any issue ids already attempted this run: **{{DONE}}**.

# TASK

Analyze the open child issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open child issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

**Resolve blocker state — do not infer from absence.** Issues often encode dependencies as free text (`## Blocked by #NNN`). Such a dependency is **live only if `#NNN` is itself an OPEN child in this set**. A blocker that is **closed/merged is already satisfied — ignore it.** Check the state of any referenced blocker explicitly (`gh issue view #NNN --json state`) rather than assuming it is open. **Soft / secondary dependencies never block.**

An issue is **unblocked** if it has zero *live* blocking dependencies on other open child issues.

For each unblocked issue, assign a branch name using the exact format `dynamic-tdd/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

# SHARED SEAMS — assign them to the first slice, tell the rest to reuse

Parallel slices reinvent shared infrastructure when nobody owns it (the PRD #54 run
shipped two API-client modules, the same 401 guard 11 times, and per-file copies of the
integration-test harness). Prevent it at plan time:

1. **Name the shared infrastructure** every slice in this wave will touch — the auth
   guard, the integration-test harness, the API/client seam, the DB transaction helper,
   config/DI wiring, and any other cross-cutting module the issues imply.
2. **Assign each shared seam to exactly one slice — the first (lowest-id, earliest
   unblocked) slice that needs it — and say so in that slice's plan.** That slice owns
   creating the seam; serializing wave 1 on the seam owner is an accepted trade-off. When
   the wave is wide and the seams are obvious, a seam-stub commit before fan-out is an
   allowed alternative — note it in the plan if you choose it.
3. **Every other slice gets an explicit `reuse` list** naming the seam and the module/path
   it will live at, so its implementer extends the shared seam instead of forking a rival
   copy. The seam-owning slice's `reuse` list is empty (it may create new seams).
4. **IdP + dynamic ports:** if the stack includes an identity provider with a
   redirect-URI whitelist (e.g. Keycloak), the app's dev port cannot float — a wildcard
   redirect URI is rejected and non-deterministic ports break the whitelist. Add "pin the
   app's dev port in the AppHost" to the **first** slice's plan (and its `reuse`/ownership
   note), so every later slice inherits a stable, whitelisted redirect URI.

# OUTPUT

Return your plan via the **structured-output tool** as
`{ "issues": [ { "id", "title", "branch", "reuse" } ] }`, where `id` is the issue number
**as a string** (e.g. `"141"`), `branch` is exactly `dynamic-tdd/issue-{id}`, and `reuse`
is an array of short strings — each naming a shared seam this slice must reuse and where
it lives (e.g. `"reuse the auth guard at src/server/auth/guard.ts — do not add another"`).
Use `[]` for a seam-owning slice. (This supersedes any `<plan>` tag convention — emit the
structured object, not tags.)

Include only **unblocked** issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies). If there is nothing to work on at all, return `{ "issues": [] }` so the run can exit cleanly.
