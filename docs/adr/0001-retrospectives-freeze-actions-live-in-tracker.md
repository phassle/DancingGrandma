# ADR 0001: Retrospectives freeze as rationale; actions live in the issue tracker

Date: 2026-07-08
Status: Accepted

## Context

The first full dynamic-tdd run (PRD #54 → PR #76) produced a retrospective,
`.agents/skills/dynamic-tdd/IMPROVEMENTS.md`, mixing one already-applied change with
eight unapplied proposals phrased as edits to the skill's prompt files. A document
that doubles as a TODO list next to the files it critiques rots silently: the next
agent cannot tell applied from pending from rejected, and it competes with the
repo's canonical backlog (GitHub issues, per `docs/agents/issue-tracker.md`).

Considered: (a) keep the hybrid document; (b) freeze the document as rationale and
track each unapplied proposal as an issue; (c) apply all proposals immediately on
the retrospective branch. (c) was rejected because prompt-engineering changes need
their own validated runs, and (a) leaves silent rot.

## Decision

A retrospective document is **frozen rationale**. Every section carries a
`Status:` line — `applied (commit …)` or `tracked as #NN`. Unapplied proposals
become tracked issues at freeze time; the tracker is the only backlog. Later work
updates the linked issue, never the frozen section.

## Consequences

- Reading a retrospective always tells you what happened and where the follow-up
  lives; it never lies about the current state of the prompts.
- Costs a small issue-creation pass when freezing (PRD #54 retro: #78–#85).
- Skill prompts are only changed through their own issues and runs, keeping each
  prompt change individually validated.
