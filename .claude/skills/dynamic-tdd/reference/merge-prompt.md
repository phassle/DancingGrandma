# TASK

You are in the main worktree on the **feature branch `{{FEATURE_BRANCH}}`**. Merge the following branches into it:

{{BRANCHES}}

For each branch, **one at a time, in order**:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct combined behavior
3. After resolving conflicts, run `npm run typecheck` and `npm test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch
5. **Once the branch is merged and tests pass, delete its worktree and the branch** (see CLEANUP) — don't leave stale worktrees behind.

After all branches are merged, make a single commit summarizing the merge if one is needed.

# CLEANUP — remove each merged worktree

Each issue branch was built in its own git worktree. As soon as a branch is successfully merged (step 5 above), remove its worktree and delete the now-merged branch:

1. Locate the worktree for the branch:
   ```
   git worktree list --porcelain
   ```
   Find the entry whose `branch refs/heads/<branch>` matches, and note its `worktree <path>`.
2. Remove the worktree:
   ```
   git worktree remove --force <worktree-path>
   ```
3. Delete the merged branch:
   ```
   git branch -d <branch>     # use -D only if you have confirmed it is merged
   ```

Do this for **every** branch you merge. Never remove the main worktree (the one on `{{FEATURE_BRANCH}}`) or its branch.

# DO NOT CLOSE ISSUES

Unlike a direct-to-trunk flow, this build integrates into a feature branch. **Do not close any issue here** — the issues are completed when the single feature PR (`{{FEATURE_BRANCH}}` → `{{BASE}}`) is merged later by the orchestrator.

Here are the issues whose branches you merged (for reference only):

{{ISSUES}}

# CONSTRAINTS

- Do **not** push.
- Do **not** merge into `{{BASE}}`, `develop`, or `main` — only into `{{FEATURE_BRANCH}}`.

When you've merged everything you can, report which branches merged cleanly and any you had to skip (with the reason).
