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

# OUTPUT

Return your plan via the **structured-output tool** as `{ "issues": [ { "id", "title", "branch" } ] }`, where `id` is the issue number **as a string** (e.g. `"141"`) and `branch` is exactly `dynamic-tdd/issue-{id}`. (This supersedes any `<plan>` tag convention — emit the structured object, not tags.)

Include only **unblocked** issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies). If there is nothing to work on at all, return `{ "issues": [] }` so the run can exit cleanly.
