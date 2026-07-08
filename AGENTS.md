# Issue before implementation — ALWAYS

You must ALWAYS create a GitHub issue (via `gh`, see `docs/agents/issue-tracker.md`)
before implementing anything. No code, config, or infra change starts without an
issue describing the work. If a matching issue already exists, reference it instead
of creating a duplicate, and note the issue number in the branch name or PR.

# Verify for real, and keep the tracker honest

When asked to verify, test, or prove something works, drive the **full running app**
end to end — real services, not mocks or the test suite alone. If it spends money
(e.g. a real fal render), confirm scope and cost with the maintainer once, then
proceed. Corroborate behaviour with `aspire logs <resource>` and **look at the
actual output** (frames, responses) — an HTTP 200 is not proof of a good result.
For a local end-to-end generation, use the `run-local-e2e` skill.

Keep the issue tracker in sync with reality: close issues that merged work resolves,
proactively, rather than leaving completed work open.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
