# ADR 0002: Every prepared PR ends with a reviewer test checklist, scaled to what exists

Date: 2026-07-08
Status: Accepted

## Context

PR #76 (PRD #54) closed six issues across 70+ files. A diff that size is
unreviewable without a path from "what was built" to "how do I see it working" —
reviewers either rubber-stamp or reverse-engineer. The dynamic-tdd tail already
knows the merged issues' acceptance criteria and what its verify step actually
exercised, so it can emit that path mechanically.

The counter-pressure: a mandatory heavyweight template on a two-file standalone
branch invites boilerplate, and boilerplate checkboxes train reviewers to skip
checklists exactly where they matter.

## Decision

The PR-prep tail (PR-PREP.md step 4) must end every PR body with a
`## Review checklist`:

- **With linked issues** (a dynamic-tdd run): a *How to run* block, then one
  subsection per merged issue of numbered `- [ ]` steps — concrete action →
  expected observable result, including the negative/edge cases the tests cover.
  Steps needing real keys or paid spend stay listed, marked `⚠ needs <X>`, naming
  the evidence that covers them. An `### Automated coverage` footer states test
  count, faked externals, and test locations.
- **Standalone, no linked issues:** minimal form — *How to run* plus one flat
  action → expected-result list derived from the diff; coverage footer only if
  tests changed.
- **Invariant:** never emit a checkbox that neither a runnable human step nor
  named evidence backs; quote UI labels only when the verify step observed them.

## Consequences

- Review effort goes where machines have not already checked; the ⚠ markers make
  the un-runnable steps auditable instead of invisible.
- The checklist is generated from acceptance criteria + verify evidence, so a
  drifting UI label points at a stale verify run, not at reviewer imagination.
- Small PRs pay a small cost (a short list), not a template.
