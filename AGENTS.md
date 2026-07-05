# Issue before implementation — ALWAYS

You must ALWAYS create a GitHub issue (via `gh`, see `docs/agents/issue-tracker.md`)
before implementing anything. No code, config, or infra change starts without an
issue describing the work. If a matching issue already exists, reference it instead
of creating a duplicate, and note the issue number in the branch name or PR.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
