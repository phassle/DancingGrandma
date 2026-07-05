# DancingGrandma 💃

Upload one photo of grandma, pick a trending TikTok dance, and get an AI-generated
video of her nailing every move — music included.

![DancingGrandma landing page](docs/hero-screenshot.png)

A Monterro InfuseAI demo. The full flow (photo → dance → engine → result) is live with
**simulated generation**; the production pipeline is designed around
[Wan 2.2 Animate 14B](https://github.com/Wan-Video/Wan2.2) (Apache 2.0) served via
[fal.ai](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/move), with Kling 2.6 Motion
Control as a selectable alternative.

## Run it

The whole stack — Next.js app, Postgres, blob storage (Azurite), Keycloak — is
orchestrated by [Aspire](https://aspire.dev) (`apphost.cs`):

```bash
npm install
cp appsettings.Development.json.example appsettings.Development.json  # fill in Sora values
aspire run
```

The Aspire dashboard opens with links to the app, logs, and telemetry for every
resource. Docker must be running. To run just the Next.js app without the
platform pieces:

```bash
npm run dev
```

Open http://localhost:3000.

### What the apphost wires up

| Resource   | Local                        | Azure (`aspire publish`)          |
| ---------- | ---------------------------- | --------------------------------- |
| `web`      | `next dev`                   | Container App (standalone build)  |
| `postgres` | container + `db/init` schema | PostgreSQL Flexible Server        |
| `videos`   | Azurite blob container       | Storage account blob container    |
| `keycloak` | container + realm import     | Container App                     |
| Sora       | `SORA_*` env from parameters | same, from deploy-time parameters |
| Front Door | —                            | `infra/frontdoor.bicep` → web     |

The database schema (`db/init/001-schema.sql`) holds **users**, their
**video generations**, and a **credits ledger** (balance = sum of transactions,
so it can't drift). Server-side access lives in `src/lib/server/`
(`db.ts`, `blob.ts`, `sora.ts`).

## Docs

- [Epic #3](https://github.com/phassle/DancingGrandma/issues/3) — full context & tracking; PRDs in [#1](https://github.com/phassle/DancingGrandma/issues/1) (product) and [#2](https://github.com/phassle/DancingGrandma/issues/2) (Phase 1 remaining work)
- [PRODUCT.md](PRODUCT.md) — brand strategy & design principles
- [DESIGN.md](DESIGN.md) — visual system (color, type, motion)
- `src/lib/engines.ts` — the video-engine registry (add/flip engines here)

## Stack

Next.js 16 (App Router) · Tailwind CSS v4 · TypeScript. Designed with
[impeccable](https://impeccable.style).
