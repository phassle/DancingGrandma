# TASK

You are on branch `{{BRANCH}}`, its work committed and simplified. Verify the change actually **works at runtime** — not just that tests pass. The change set is everything in `git diff origin/{{BASE}}...{{BRANCH}}`.

**Run it in Aspire.** Use the `observe-running-app` skill (Aspire AppHost) — that is how this project observes real browser console / network / JS errors, not just Vite stdout.

1. Build: `npm run build` must succeed.
2. Launch the SPA via **Aspire** (`observe-running-app` skill) and confirm it **boots** and the GTFS-RT polling runs.
3. **Verify the web logs.** Inspect the **browser console logs** captured by Aspire (browser-log capture / the Aspire dashboard). The change is only verified if the web logs show **no new app-level errors or warnings** introduced by the change. Quote the relevant log lines (or confirm they are clean) in your verdict.
   - **Ignore third-party feed noise** — transient `429` from Trafiklab GTFS-RT or CORS/`ERR_FAILED` from airplanes.live are environmental rate-limits the app tolerates by design, not regressions. Fail only on app-level errors: uncaught exceptions, React errors, or new `console.error`/`console.warn` from app code.
   - **Re-check on a fresh reload** before calling something a bug — a live dev edit can log one-off React "change in the order of Hooks" / invalid-hook-call errors that vanish on a clean load (hot-reload state, not a defect).
4. Exercise each behaviour the change introduces and confirm it appears and behaves correctly in the running app, watching the web logs as you do.
5. **Browser tests.** If the change (or its issues — `gh issue view <id> --comments`) specifies checks that must run in the **browser / web** (manual steps, Playwright/e2e scenarios, "verify in the UI that…"), **run them now** against the Aspire-launched app — use the `playwright-cli` skill for scripted steps, or drive the UI manually and observe. Report each browser test and its result. A failing browser test means overall `FAIL`.

# OUTPUT

Report a concise **VERDICT**: what you checked, what passed, and any runtime problems found. State `PASS` or `FAIL` overall.

Do **not** commit and do **not** push. If you find a real runtime regression, describe it precisely (steps, expected vs actual) so the orchestrator can decide whether to fix before opening the PR.
