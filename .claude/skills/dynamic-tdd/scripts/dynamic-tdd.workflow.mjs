export const meta = {
  name: 'dynamic-tdd',
  description: 'Plan → parallel TDD implement (isolated worktrees) → merge each issue branch into the feature branch, looping over all open issues under a PRD',
  phases: [
    { title: 'Plan', detail: 'Opus builds a dependency graph over the PRD child issues; picks unblocked ones' },
    { title: 'Implement', detail: 'one TDD red-green-refactor agent per unblocked issue, each in its own worktree' },
    { title: 'Merge', detail: 'merge the branches that produced commits into the feature branch' },
  ],
}

// args (passed by the orchestrator): { prd, featureBranch, base?, maxIterations?, maxParallel? }
// Tolerate args arriving as a JSON-encoded string (the Workflow tool may stringify it).
let _args = args
if (typeof _args === 'string') { try { _args = JSON.parse(_args) } catch { _args = {} } }
const { prd, featureBranch, base = 'develop', maxIterations = 10, maxParallel = 6 } = _args || {}
if (!prd || !featureBranch) throw new Error('dynamic-tdd: args.prd and args.featureBranch are required')

const PLAN_SCHEMA = {
  type: 'object',
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'branch'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          branch: { type: 'string' },
          // Shared seams this slice must reuse (empty for a seam-owning slice).
          // See plan-prompt.md "SHARED SEAMS"; injected into the implementer as {{REUSE}}.
          reuse: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  required: ['id', 'branch', 'committed'],
  properties: {
    id: { type: 'string' },
    branch: { type: 'string' },
    committed: { type: 'boolean' },
    summary: { type: 'string' },
  },
}

const REF = '.agents/skills/dynamic-tdd/reference'
const done = new Set()   // issue ids already attempted this run — never re-plan
const mergedIssues = []
let dryRounds = 0

// Token exhaustion is a first-class pause/resume event (IMPROVEMENTS.md §7), not a crash.
// The PRD #54 run averaged ~120k output tokens per TDD slice; budget the wave up front so
// we start only what the remaining budget can fund and defer the rest to a resumed run,
// rather than launching a wave that dies mid-implementation.
const PER_SLICE_TOKENS = 120_000

// A structured pause returned instead of the normal result. The orchestrator (SKILL.md)
// fills pausedAt/resetsAt/resumeFromRunId from the tool result + any limit-error text and
// schedules the resume; the script supplies what it can compute (the remaining work).
const pause = (reason, remainingIssues) => ({
  prd, featureBranch, base, mergedIssues,
  paused: true,
  pauseReason: reason,
  pausedAt: null,          // stamped by the orchestrator (Date.now() is unavailable here)
  resetsAt: null,          // parsed by the orchestrator from the session-limit error text
  resumeFromRunId: null,   // read by the orchestrator from this run's tool result
  remainingIssues,
  iterations: mergedIssues.length ? 'paused-after-merges' : 'paused-no-merges',
})

// Was an error a runtime token/session-limit exhaustion (resumable) rather than a task
// failure? The session-limit error text carries a reset time.
const isTokenExhaustion = (err) =>
  /token|session limit|usage limit|rate limit|budget|resets? (at|in)/i.test(String((err && err.message) || err || ''))

for (let iter = 1; iter <= maxIterations; iter++) {
  // --- Phase 1: Plan -------------------------------------------------------
  phase('Plan')
  let plan
  try {
    plan = await agent(
      `You are the PLANNER. Read and follow ${REF}/plan-prompt.md exactly.
Substitutions: {{PRD}} = ${prd}; {{DONE}} = ${[...done].join(', ') || '(none yet)'}.
Return the plan via the structured-output tool per the file's OUTPUT section.`,
      { label: `plan:iter-${iter}`, phase: 'Plan', schema: PLAN_SCHEMA },
    )
  } catch (err) {
    if (isTokenExhaustion(err)) { log(`Iteration ${iter}: token exhaustion during planning — pausing.`); return pause('token-exhaustion', []) }
    throw err
  }

  const unblocked = (plan?.issues || []).filter((i) => !done.has(String(i.id)))
  let todo = unblocked.slice(0, maxParallel)
  if (!todo.length) { log(`Iteration ${iter}: no unblocked issues left — stopping.`); break }

  // Budget the wave up front (IMPROVEMENTS.md §7): start only what the remaining token
  // budget can fund; defer the rest to a resumed run instead of dying mid-implementation.
  let deferred = unblocked.slice(maxParallel).map((i) => String(i.id))
  if (budget.total) {
    const affordable = Math.max(0, Math.floor(budget.remaining() / PER_SLICE_TOKENS))
    if (affordable < todo.length) {
      deferred = todo.slice(affordable).map((i) => String(i.id)).concat(deferred)
      todo = todo.slice(0, affordable)
      log(`Token budget (~${Math.round(budget.remaining() / 1000)}k left, ~${PER_SLICE_TOKENS / 1000}k/slice) funds ${todo.length} slice(s); deferring ${deferred.length} to a resumed run.`)
      if (!todo.length) { log(`Iteration ${iter}: budget cannot fund another slice — pausing.`); return pause('token-budget', deferred) }
    }
  }
  log(`Iteration ${iter}: implementing ${todo.length} issue(s): ${todo.map((i) => '#' + i.id).join(', ')}`)

  // --- Phase 2: Implement (parallel, isolated worktrees) -------------------
  // Barrier is intentional: the merge phase needs ALL completed branches together.
  let built
  try {
    built = await parallel(
      todo.map((issue) => () =>
        agent(
          `You are an IMPLEMENTER. Read and follow ${REF}/implement-prompt.md exactly.
Substitutions:
  {{TASK_ID}} = ${issue.id}; {{ISSUE_TITLE}} = ${issue.title}; {{BRANCH}} = ${issue.branch}; {{PRD}} = ${prd}; {{BASE}} = ${base}.
  {{REUSE}} =
${(issue.reuse && issue.reuse.length) ? issue.reuse.map((r) => `  - ${r}`).join('\n') : '  (none — you may own new shared seams for this wave)'}
You are in a fresh isolated git worktree branched off ${featureBranch}. Work ONLY on issue #${issue.id}.
Return {id, branch, committed, summary} via the structured-output tool per the file's OUTPUT section.`,
          { label: `tdd:#${issue.id}`, phase: 'Implement', schema: IMPL_SCHEMA, isolation: 'worktree' },
        ),
      ),
    )
  } catch (err) {
    if (isTokenExhaustion(err)) { log(`Iteration ${iter}: token exhaustion during implement — pausing.`); return pause('token-exhaustion', todo.map((i) => String(i.id)).concat(deferred)) }
    throw err
  }

  todo.forEach((i) => done.add(String(i.id)))
  const committed = built.filter(Boolean).filter((b) => b.committed)
  if (!committed.length) {
    dryRounds++
    log(`Iteration ${iter}: no commits produced.`)
    if (dryRounds >= 2) { log('Two dry rounds — stopping.'); break }
    continue
  }
  dryRounds = 0

  // --- Phase 3: Merge into the feature branch ------------------------------
  // Runs with NO isolation, in the main worktree which the orchestrator has
  // checked out to ${featureBranch}. Serial merges so conflicts resolve cleanly.
  phase('Merge')
  try {
    await agent(
      `You are the MERGER. Read and follow ${REF}/merge-prompt.md exactly.
Substitutions:
  {{FEATURE_BRANCH}} = ${featureBranch}; {{BASE}} = ${base}.
  {{BRANCHES}} =
${committed.map((b) => `  - ${b.branch}  (issue #${b.id})`).join('\n')}
  {{ISSUES}} =
${committed.map((b) => `  - #${b.id}: ${b.summary || ''}`).join('\n')}
You are in the main worktree on branch ${featureBranch}.`,
      { label: `merge:iter-${iter}`, phase: 'Merge' },
    )
  } catch (err) {
    // The committed branches survive as stragglers; the orchestrator's straggler rule
    // (SKILL.md resume notes) keeps commits-ahead worktrees for the resumed merger.
    if (isTokenExhaustion(err)) { log(`Iteration ${iter}: token exhaustion during merge — pausing.`); return pause('token-exhaustion', committed.map((b) => String(b.id)).concat(deferred)) }
    throw err
  }
  mergedIssues.push(...committed.map((b) => b.id))
  log(`Iteration ${iter}: merged ${committed.length} branch(es) into ${featureBranch}.`)
}

return { prd, featureBranch, base, mergedIssues, iterations: mergedIssues.length ? 'completed' : 'no-merges' }
