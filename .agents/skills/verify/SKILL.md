---
name: verify
description: DancingGrandma's project verify recipe — how to launch this app in Aspire, discover its port, sign in against the real Keycloak, and what counts as boot vs. environmental noise. Resolves the {{BOOT_SIGNAL}} / {{KNOWN_ENV_NOISE}} placeholders in dynamic-tdd's verify-prompt.md so a verify run skips the cold start. Use when verifying a change against the running app or resolving those placeholders.
---

# Verify recipe — DancingGrandma

Persisted so a verify run doesn't rediscover the cold-start details every time
(dynamic-tdd IMPROVEMENTS.md §3). For a full paid end-to-end generation, use the
`run-local-e2e` skill — this file is the leaner "prove this change works at runtime" recipe
and the source for the verify prompt's project placeholders.

## Launch (Aspire, not bare `npm run dev`)

```bash
~/.aspire/bin/aspire run        # from repo root (apphost.cs)
```

A bare `npm run dev` on :3000 is **not** Aspire-wired (no DB / Keycloak / `FAL_KEY`) — never
verify against it. `aspire ps` lists AppHosts (pick `DancingGrandma/apphost.cs`);
`aspire describe` lists resources + URLs; `aspire logs <resource>` shows logs (strip ANSI;
macOS has **no** `timeout` — background the command and `kill` it after a few seconds).

## Port discovery — never assume 3000

The `web` resource currently serves http://localhost:3000, but **read the actual URL from
`aspire describe` / the dashboard** rather than assuming it — Aspire assigns ports at launch.
If something is already listening on the web port, kill it before launching (Aspire needs it).

## {{BOOT_SIGNAL}}

The `web` resource reaches **Running** in `aspire describe`/the dashboard **and** the app
responds at the discovered web URL (a request to `/` returns HTML, not a connection refusal).
There is no background polling loop to watch for. Prove branch identity before trusting it —
probe a route only this branch adds (expect 401, not 404, for a new protected route).

## {{KNOWN_ENV_NOISE}} (tolerated, not regressions)

- **Self-signed dev-cert warnings.** Keycloak on :8080 uses a self-signed cert — browser
  contexts need `ignoreHTTPSErrors: true` (Playwright) / `ignore_https_errors=True` (Python).
  TLS-trust warnings for the local IdP are expected.
- **Per-run random Postgres creds/db.** Connection details are randomized per run (db is
  `grandmadb`); "new credentials" log lines are normal, not a regression.

Everything **not** in this list — uncaught exceptions, React/framework errors, new
`console.error`/`console.warn` from app code — is a potential regression and fails verify.

## Auth round trip (required when the diff touches auth)

Realm `dancinggrandma`, test user **`grandma@example.com` / `grandma`**. Drive a browser to
`/api/auth/login` (302 → Keycloak form → back to the app; sets the `dg_session` cookie and
creates the user row). Use `ignore_https_errors=True`; fill `input#username` / `input#password`,
click `#kc-login`. A green route-test suite does **not** substitute for this round trip — the
sign-in seams (token verification, browser-facing redirect origin) are exactly what route
tests fake.

## Wizard labels / dev seams

- Dev-only credit seed: `POST /api/dev/credits {"amount": N}` (404 under production); 1 credit
  is reserved per generation.
- Curated reference dances live in `public/dances/*.mp4` (all 15s).
- Only **fal-provider** engines run server-side (e.g. `wan-animate-fal`); Replicate is
  registry-selectable but rejected server-side.
