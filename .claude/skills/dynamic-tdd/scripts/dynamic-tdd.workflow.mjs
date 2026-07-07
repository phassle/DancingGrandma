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

for (let iter = 1; iter <= maxIterations; iter++) {
  // --- Phase 1: Plan -------------------------------------------------------
  phase('Plan')
  const plan = await agent(
    `You are the PLANNER. Read and follow ${REF}/plan-prompt.md exactly.
Substitutions: {{PRD}} = ${prd}; {{DONE}} = ${[...done].join(', ') || '(none yet)'}.
Return the plan via the structured-output tool per the file's OUTPUT section.`,
    { label: `plan:iter-${iter}`, phase: 'Plan', schema: PLAN_SCHEMA },
  )

  const todo = (plan?.issues || []).filter((i) => !done.has(String(i.id))).slice(0, maxParallel)
  if (!todo.length) { log(`Iteration ${iter}: no unblocked issues left — stopping.`); break }
  log(`Iteration ${iter}: implementing ${todo.length} issue(s): ${todo.map((i) => '#' + i.id).join(', ')}`)

  // --- Phase 2: Implement (parallel, isolated worktrees) -------------------
  // Barrier is intentional: the merge phase needs ALL completed branches together.
  const built = await parallel(
    todo.map((issue) => () =>
      agent(
        `You are an IMPLEMENTER. Read and follow ${REF}/implement-prompt.md exactly.
Substitutions: {{TASK_ID}} = ${issue.id}; {{ISSUE_TITLE}} = ${issue.title}; {{BRANCH}} = ${issue.branch}; {{PRD}} = ${prd}; {{BASE}} = ${base}.
You are in a fresh isolated git worktree branched off ${featureBranch}. Work ONLY on issue #${issue.id}.
Return {id, branch, committed, summary} via the structured-output tool per the file's OUTPUT section.`,
        { label: `tdd:#${issue.id}`, phase: 'Implement', schema: IMPL_SCHEMA, isolation: 'worktree' },
      ),
    ),
  )

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
  mergedIssues.push(...committed.map((b) => b.id))
  log(`Iteration ${iter}: merged ${committed.length} branch(es) into ${featureBranch}.`)
}

return { prd, featureBranch, base, mergedIssues, iterations: mergedIssues.length ? 'completed' : 'no-merges' }
