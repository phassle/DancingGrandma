---
name: run-local-e2e
description: Drive a real end-to-end video generation locally — Aspire stack, Keycloak sign-in, dev-seeded credits, a real fal render, and verification. Use when asked to run the app for real, prove generation works, or reproduce a generation bug against the running stack.
---

# Run a real end-to-end generation locally

The only faithful way to prove the product works: bring up the real stack and drive
one paid generation from sign-in to a played-back MP4. This spends **real fal money**
(~$0.08/output-second; a 15s clip ≈ ~$1.20 and takes ~10 min). Confirm scope+cost with
the user once, then proceed.

Verified working 2026-07-09 (generation `0a003693…`).

## 1. Bring up the real stack

```bash
~/.aspire/bin/aspire run        # from repo root (apphost.cs)
```

- A bare `npm run dev` on :3000 is **not** Aspire-wired (no DB / Keycloak / `FAL_KEY`).
  If something is already listening on :3000, kill it first — Aspire needs that port
  for the `web` resource.
- `aspire ps` lists running AppHosts (there may be several — pick `DancingGrandma/apphost.cs`).
  `aspire describe` lists resources + URLs. `web` serves http://localhost:3000.
- `aspire logs <resource>` shows a resource's logs (strip ANSI; macOS has **no** `timeout` —
  background the command and `kill` it after a few seconds). `aspire otel` for traces.

## 2. Secrets & prerequisites

- **`FAL_KEY`** must be non-empty in gitignored `.env.local`. There is no fal parameter in
  `appsettings.Development.json` (only sora + Stripe test keys), so the key comes only from
  `.env.local`. `getFalClient()` throws *"FAL_KEY is not set"* if missing. This is a real
  secret the user supplies — never commit it.
- Postgres creds/db are per-run random (read them from the container env; db is `grandmadb`).

## 3. Sign in (real Keycloak)

Realm `dancinggrandma`, test user **`grandma@example.com` / `grandma`**. Drive a browser to
`/api/auth/login` (302 → Keycloak form → back to the app, sets the `dg_session` cookie and
creates the user row). Python Playwright + cached Chromium works; use
`ignore_https_errors=True` (Keycloak's cert on :8080 is self-signed). Fill `input#username`
/ `input#password`, click `#kc-login`.

## 4. Seed credits (dev only)

```
POST /api/dev/credits  {"amount": 5}
```

Dev-only (returns 404 when `NODE_ENV=production`); writes a proper `admin_adjustment`
ledger entry. 1 credit is reserved per generation.

## 5. Generate, poll, fetch

- `POST /api/generations` — multipart `{engineId, referenceSourceKind, photo, referenceVideo|referenceUrl}`.
  Only **fal-provider** engines run server-side (e.g. `wan-animate-fal`); Replicate is
  registry-selectable but rejected here. Curated dances live in `public/dances/*.mp4` (all 15s).
- Poll `GET /api/generations/{id}` until `status` is `completed` | `failed` | `cancelled`.
- On `completed`, fetch `GET /api/video/{id}` (blob-served MP4, h264 + AAC; the reference
  audio is muxed in and an AI watermark burned during finalize).

## 6. Verify — don't trust HTTP 200

- Extract frames (`ffmpeg -ss … -vframes 1`) and **look at them**. A 200 + a valid MP4 is
  not proof the result is good.
- **Quality gotcha:** Wan-Animate needs a **full-body / upper-body** subject photo. A
  face-only crop yields a tiny dancer with the source face smeared across the frame
  (guardrail tracked in issue #89).
- Corroborate the server path in `aspire logs web` (the `GET /api/generations/{id}` poll
  loop, the longer final poll = finalize, then `GET /api/video/{id}`). Note: there is no
  per-generation cost/latency log line yet (issue #8).
