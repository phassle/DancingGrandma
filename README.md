# DancingGrandma 💃

Upload one photo of grandma, pick a trending TikTok dance, and get a
motion-transfer character-animation video of her following the reference dance —
music included.

![DancingGrandma landing page](docs/hero-screenshot.png)

A Monterro InfuseAI demo. The full flow (photo → reference motion video → engine
→ result) is live; real renders run for uploaded, imported, and curated
reference clips when provider credentials are configured. The production
pipeline is a reference-video motion-transfer path that defaults to
[Kling 2.6 Motion Control](https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control)
served via fal.ai, with [Wan 2.2 Animate 14B](https://github.com/Wan-Video/Wan2.2)
(Apache 2.0) still available as a selectable alternative. Generic image-to-video
is not treated as a wired engine unless it accepts the reference motion video and
performs character animation or replacement.

## Run it

The whole stack — Next.js app, Postgres, blob storage (Azurite), Keycloak — is
orchestrated by [Aspire](https://aspire.dev) (`apphost.cs`):

```bash
npm install
cp .env.example .env.local                                  # fill in provider keys for local Next.js runs
cp appsettings.Development.json.example appsettings.Development.json  # fill in Azure provider values if testing that path
aspire run
```

The Aspire dashboard opens with links to the app, logs, and telemetry for every
resource. Docker must be running. To run just the Next.js app without the
platform pieces:

```bash
cp .env.example .env.local  # fill in FAL_KEY or REPLICATE_API_TOKEN for real renders
npm run dev
```

Open http://localhost:3000.

### Testing payments locally (Stripe webhooks)

Fulfillment is **webhook-only** — credits are granted *solely* by Stripe's
`checkout.session.completed` / `invoice.paid` webhooks hitting
`/api/stripe/webhook` (see `apphost.cs`). Stripe cannot reach `localhost` on its
own, so **without a forwarder a paid checkout silently no-ops**: the payment
succeeds at Stripe but the app never grants credits and the subscription poll
spins forever.

Run the Stripe CLI listener alongside `aspire run`, in its own terminal, whenever
you test paying:

```bash
stripe login                                                   # once per machine
stripe listen --forward-to localhost:3000/api/stripe/webhook   # leave running
```

The listener prints `webhook signing secret is whsec_…` on startup — it **must
match** the `stripe-webhook-secret` parameter in `appsettings.Development.json`,
or the app rejects events with `400 invalid signature`. Then pay with test card
`4242 4242 4242 4242` (any future expiry / CVC); you'll see
`POST /api/stripe/webhook 200` in the `web` logs and credits appear.

> To seed credits without a real payment (e.g. for a generation smoke test), the
> dev-only `POST /api/dev/credits {"amount":N}` route skips Stripe entirely.

### What the apphost wires up

| Resource   | Local                        | Azure (`aspire publish`)          |
| ---------- | ---------------------------- | --------------------------------- |
| `web`      | `next dev`                   | Container App (standalone build)  |
| `postgres` | container + `db/init` schema | PostgreSQL Flexible Server        |
| `videos`   | Azurite blob container       | Storage account blob container    |
| `keycloak` | container + realm import     | Container App                     |
| Stripe | `STRIPE_*` env for payment webhooks | same, from deploy-time parameters |
| Front Door | —                            | `infra/frontdoor.bicep` → web     |

### Database & architecture

The database schema spans three migrations:
- **`001-schema.sql`**: core tables for **users**, **video generations**, and a **credits ledger** (balance = sum of transactions, preventing drift)
- **`002-stripe-subscriptions.sql`**: billing records for subscription tiers, invoices, and payment tracking
- **`003-media-library.sql`**: shared **video library** for curated reference clips and user-uploaded media

Server-side logic lives in `src/lib/server/`:
- `db.ts` — database queries and transaction helpers
- `auth.ts` — OIDC session management and user authentication
- `oidc.ts` — Keycloak OIDC provider integration
- `billing.ts` — Stripe subscription and invoice handling
- `stripe.ts` — Stripe API client and webhook processing
- `provider.ts` — video engine submission and result polling
- `blob.ts` — video and photo storage (Azurite / Azure Storage)
- `retention.ts` — purge source photos after generation is finalized

All routes have integration tests in `src/app/api/**/*.integration.test.ts` running against a real Postgres instance.

## Key features

**Authentication**: OIDC via Keycloak + secure session cookies  
**Billing**: Stripe-powered $9.99/month subscription tier with credit wallet  
**Generation API**: Create videos from photos + reference motion clips  
**Library**: Curated reference videos + user media gallery  
**Sharing**: Generate shareable links for video results  
**Maintenance**: Credit adjustments, photo retention cleanup, subscription sync

## Docs

- [CONTEXT.md](CONTEXT.md) — canonical product vocabulary
- [PRODUCT.md](PRODUCT.md) — brand strategy & design principles
- [DESIGN.md](DESIGN.md) — visual system (color, type, motion)
- `docs/adr/` — architecture decision records
- `docs/agents/` — agent workflow, issue tracker, triage labels
- `src/lib/engines.ts` — video-engine registry (Kling 2.6, Wan 2.2 Animate)

## Stack

**Frontend**: Next.js 16 (App Router) · React · Tailwind CSS v4 · TypeScript  
**Backend**: Node.js server functions · PostgreSQL · Stripe API  
**Auth**: Keycloak OIDC  
**Storage**: Azure Blob Storage (Azurite local)  
**Video engines**: Kling 2.6 Motion Control, Wan 2.2 Animate (via fal.ai)  
**Testing**: Vitest · integration tests on real Postgres  
**Design**: [impeccable](https://impeccable.style)

## Development

Workflow via GitHub Issues (PRDs → feature branches → PRs):
- Cut feature branches from `develop`, merge back via PR
- All work tracked in issues; use `/dynamic-tdd` for multi-issue orchestration
- Skills in `.agents/skills/` mirrored to `.claude/skills/` (sync with `scripts/sync-skills.sh`)
- Graphify knowledge graph in `graphify-out/` for codebase navigation
