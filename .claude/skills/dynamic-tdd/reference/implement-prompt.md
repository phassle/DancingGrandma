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

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

Use RGR (red-green-refactor) to complete the task. Tests sit beside the file (`*.test.js` / `*.test.jsx`).

1. RED: write one failing test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

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
