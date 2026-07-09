# TASK

You are on branch `{{BRANCH}}`, its work committed and simplified. Verify the change actually **works at runtime** — not just that tests pass. The change set is everything in `git diff origin/{{BASE}}...{{BRANCH}}`.

**Run it in Aspire.** Use the `observe-running-app` skill (Aspire AppHost) — that is how this project observes real browser console / network / JS errors, not just dev-server stdout.

This prompt is project-agnostic. Two placeholders are resolved per project before it runs
(from the project's `verify` skill, `SKILL.md`, or the AppHost config):

- `{{BOOT_SIGNAL}}` — the observable that proves the app booted and its main loop is live
  (e.g. a specific log line, a poller starting, a health route returning 200). If unknown,
  discover it during this run and persist it (see PERSIST THE RUN RECIPE).
- `{{KNOWN_ENV_NOISE}}` — the environmental, non-regression console/network noise this app
  tolerates by design (third-party feed rate-limits, self-signed-cert warnings, etc.).
  Everything **not** on this list is treated as a potential regression.

# PREFLIGHT — prove you are about to drive *this branch's* app

Do this **before** launching. In the PRD #54 run, verify wasted a round driving a
three-day-old stale server on an assumed port while Aspire's real web resource couldn't
bind — an HTTP 200 from the wrong process proves nothing.

1. **Settings parity.** Diff the committed settings example against the local file:
   ```
   git diff --no-index appsettings.Development.json.example appsettings.Development.json 2>/dev/null || true
   ```
   (Use whatever example/local pair this stack uses.) If the branch added parameters
   (`AddParameter`, new secrets/keys) that the gitignored local file lacks, **stop with a
   clear message** naming the missing keys — a non-interactive `aspire run` cannot prompt
   for them and will hang in `Waiting` forever. Do not launch until they're supplied.
2. **Clear the ports.** Detect stale dev servers or leftover worktree sessions squatting
   the app's ports (a previous run's `next start`, another worktree's Aspire). Report or
   kill them before launching — otherwise you may probe the wrong process.
3. **Discover the port dynamically.** Ports under Aspire are assigned at launch. **Never
   assume 3000.** Read the actual web port from the Aspire dashboard / process / proxy
   after launch, and use that for every probe below.
4. **Prove branch identity.** After launch, probe a route or behaviour that exists **only
   on this branch** and assert the branch-specific response (e.g. a new protected route
   returns **401, not 404**; a new endpoint responds at all). Only once the running app
   demonstrably contains this branch's code do you trust any log, screenshot, or test.

# VERIFY AT RUNTIME

1. Build: `npm run build` must succeed.
2. Launch the app via **Aspire** (`observe-running-app` skill) and confirm it **boots** —
   look for `{{BOOT_SIGNAL}}`.
3. **Verify the web logs.** Inspect the **browser console logs** captured by Aspire
   (browser-log capture / the Aspire dashboard). The change is only verified if the web
   logs show **no new app-level errors or warnings** introduced by the change. Quote the
   relevant log lines (or confirm they are clean) in your verdict.
   - **Ignore known environmental noise** — anything listed in `{{KNOWN_ENV_NOISE}}` is a
     tolerated, by-design condition (e.g. transient third-party feed rate-limits, dev-cert
     warnings), not a regression. Fail only on **app-level** errors: uncaught exceptions,
     framework/React errors, or new `console.error` / `console.warn` from app code.
   - **Re-check on a fresh reload** before calling something a bug — a live dev edit can
     log one-off React "change in the order of Hooks" / invalid-hook-call errors that
     vanish on a clean load (hot-reload state, not a defect).
4. Exercise each behaviour the change introduces and confirm it appears and behaves
   correctly in the running app, watching the web logs as you do.
5. **Browser tests.** If the change (or its issues — `gh issue view <id> --comments`)
   specifies checks that must run in the **browser / web** (manual steps, Playwright/e2e
   scenarios, "verify in the UI that…"), **run them now** against the Aspire-launched app —
   use the `playwright-cli` skill for scripted steps, or drive the UI manually and observe.
   Report each browser test and its result. A failing browser test means overall `FAIL`.

# AUTH GATE — a real IdP round trip is required for auth-touching diffs

If the change set touches **authentication** (sign-in, OIDC/OAuth, session, token
verification, redirect/callback URLs, or the identity provider config), a scripted
**browser register/sign-in round trip against the real IdP is a required gate — not
optional flow-exercising.** Route tests fake exactly the two seams where auth breaks
(token verification and the browser-facing redirect origin), so 100% green route tests can
sit on top of completely broken sign-in (this is what happened in the PRD #54 run).

- Drive a real register → sign-in → authenticated-page round trip through the browser
  (use `playwright-cli`) against the actually-running IdP, from the browser-facing host.
- Note for Aspire dev: the IdP and app use self-signed certs — the browser context needs
  `ignoreHTTPSErrors: true`.
- If the sign-in round trip fails, overall verdict is `FAIL`, regardless of test results.

# PERSIST THE RUN RECIPE

If you had to **discover** anything to run this app that a future verify run would otherwise
rediscover cold — the exact launch command, how to find the web port, the seeded/test user
and how to seed it, wizard/flow step labels, `{{BOOT_SIGNAL}}`, the `{{KNOWN_ENV_NOISE}}`
list, `ignoreHTTPSErrors` for dev certs — **append it to the project's `verify` skill**
(`.claude/skills/verify/SKILL.md`, canonical source `.agents/skills/verify/SKILL.md`), so
the next run skips the cold start. Keep it a concise, current recipe; don't duplicate what's
already there.

# OUTPUT

Report a concise **VERDICT**: what you checked (including the preflight branch-identity
proof and, if applicable, the auth round trip), what passed, and any runtime problems
found. State `PASS` or `FAIL` overall.

Do **not** commit and do **not** push. If you find a real runtime regression, describe it
precisely (steps, expected vs actual) so the orchestrator can decide whether to fix before
opening the PR.
