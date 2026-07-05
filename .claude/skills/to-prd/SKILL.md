---
name: to-prd
description: Turn the current project state (code, docs, research, decisions) into a complete PRD.md — or update the existing one. Use when the user asks for a PRD, product requirements, "/to-prd", or wants product decisions documented.
user-invocable: true
argument-hint: "[optional: focus area or one-line product summary]"
---

Generate or update `PRD.md` at the project root from everything actually known about the
project — never from the prompt alone.

## Step 1: Gather the real state

Read, in this order (skip what doesn't exist):

1. `PRD.md` — if present, this is an **update**, not a rewrite. Preserve decisions and
   status history; bump the version and date in the header table.
2. `PRODUCT.md` and `DESIGN.md` — brand strategy, users, design principles.
3. `README.md`, `package.json` — stack and run instructions.
4. Key source files that encode product decisions (for this project:
   `src/lib/engines.ts` — the video-engine registry — and `src/components/Studio.tsx`
   — the user flow). Requirements must match what the code actually does.
5. Any research results, verified claims, or decision logs in the conversation or repo.

Facts must be sourced: pricing, licensing, and model claims come from verified research
or provider docs, not memory. If a load-bearing fact is unverified, mark it
`(unverified)` in the PRD rather than asserting it.

## Step 2: Interview only for true gaps

If goals, target users, or monetization intent are genuinely unknown, ask 2–3 pointed
questions (AskUserQuestion when available). Don't ask about anything discoverable from
the repo.

## Step 3: Write the PRD

Everything in **English**, regardless of the prompt language. Use this structure
(the proven shape of this project's PRD):

```markdown
# PRD — <Product name>

| | |
|---|---|
| **Status** | Draft vN |
| **Date** | <today> |
| **Owner** | <from git config / user> |
| **Repo** | <repo path> |

## 1. Summary            — what it is + the emotional/functional job, 2 short paragraphs
## 2. Problem & opportunity
## 3. Goals / Non-goals  — numbered goals; explicit non-goals to cut scope debates
## 4. Users              — who, arrival context, patience budget
## 5. User stories       — numbered "As a … I …"
## 6. Functional requirements
###  6.1 Shipped         — what exists today (be honest about mocks/simulations)
###  6.2 Phase 1         — next buildable increment, R1/R2/… numbered
###  6.3 Phase 2         — hardening & growth
## 7. <Core strategy section>  — the project's central decision table (for this
                                 project: engine strategy with status/pricing/licensing
                                 per model and routing/fallback rules)
## 8. Technical architecture   — frontend, backend, media, observability
## 9. Unit economics           — cost per unit with verified prices; the pricing gate
## 10. Legal, privacy, safety  — consent, GDPR, output labeling (EU AI Act), licensing
## 11. Success metrics         — 4-6 measurable targets with thresholds
## 12. Milestones              — M0 (done) → M3, rough sizes
## 13. Open questions          — numbered, each one an actual decision someone must make
```

Rules of quality:

- Every requirement is testable; every metric has a number.
- Distinguish **shipped / next / later** honestly — a mocked feature is "shipped (mocked)".
- Rejected alternatives get one line each with the reason (license, quality, availability).
- Keep it under ~150 lines; a PRD nobody reads is a PRD that doesn't exist.

## Step 4: Commit

Show the user a 3-bullet summary of what changed. If the repo has a remote and the user
has asked for PRDs to live in GitHub, commit `PRD.md` on `main` with a descriptive
message and push.
