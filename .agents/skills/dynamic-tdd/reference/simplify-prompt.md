# TASK

You are in the main worktree on branch `{{BRANCH}}`, with its work committed. Do a focused simplification pass over **only the code this branch changed** relative to `{{BASE}}`.

If the project has a `simplify` skill, follow it. Otherwise apply its intent directly.

# SCOPE

Limit yourself to the changed files:

```
git diff --name-only origin/{{BASE}}...{{BRANCH}}
```

Review them for: duplication / missed reuse, dead code, unnecessary complexity, inefficiency, and wrong altitude (logic living in the wrong layer). Apply only **safe, behaviour-preserving** cleanups.

Do **not**:

- change behaviour or public APIs,
- touch files outside the changed set,
- "improve" code unrelated to this change.

# GATE

After each cleanup run `npm run typecheck` and `npm test`. Both must stay green — revert any change that breaks them.

# COMMIT

If you made changes, commit them on `{{BRANCH}}`:

```
{{LABEL}}: simplify pass
```

…summarizing what you consolidated (`{{LABEL}}` defaults to `RALPH` or the feature name when none is given). If nothing genuinely needed simplifying, make **no** commit and say so. Do not push. Report what you changed (or that you changed nothing and why).
