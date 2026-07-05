# PRD — DancingGrandma

| | |
|---|---|
| **Status** | Draft v1 |
| **Date** | 2026-07-05 |
| **Owner** | Per Hässle (Monterro InfuseAI) |
| **Repo** | `InfuseAI-Demos/DancingGrandma` |

## 1. Summary

DancingGrandma is a consumer web app that turns **one photo of a person + one reference
dance video (a trending TikTok dance)** into a new AI-generated video where that person
performs the dance, music included. The emotional job: make the user laugh out loud and
share the clip in the family group chat.

The MVP ships with a fully designed end-to-end flow and **simulated generation**; this PRD
defines the path to real generation on a **multi-engine architecture**, starting with
Wan 2.2 Animate 14B via fal.ai.

## 2. Problem & opportunity

The "make grandma do the TikTok dance" meme format is proven viral material (Viggle AI's
growth was driven almost entirely by it). Existing tools are either locked inside consumer
apps with credit walls (Viggle, Kling app) or aimed at professionals (Runway). There is
room for a single-purpose, zero-friction web experience: photo in → dancing video out in
under a minute, no account needed to try.

## 3. Goals / Non-goals

**Goals**
1. Photo + dance → shareable vertical video (9:16, with music) in ≤ 90 s wall-clock.
2. Multi-engine backend: engines are swappable per generation, new engines addable
   without UI rework (registry-driven).
3. Cost per generated video known and surfaced internally (unit economics from day one).
4. Affectionate-humor brand: grandma is the hero, never the punchline.

**Non-goals (for now)**
- Native mobile apps, user accounts, feeds/galleries, or social features.
- Editing tools (trimming, captions, filters).
- Real-time/live generation.
- Self-serve engine choice for anonymous users beyond the curated list.

## 4. Users

Consumers 18–45, arriving from a TikTok/Instagram ad or a friend's clip, on mobile,
mid-scroll, with ~30 seconds of patience. Secondary: the family members who receive the
clip and become the next users.

## 5. User stories

1. As a visitor I upload one photo, pick a curated trending dance, and get a video of
   that person doing the dance with the original music.
2. As a visitor I can instead upload **my own reference dance video** (MP4/MOV) and have
   its motion + audio transferred.
3. As a visitor I can download the result and share a link.
4. As a visitor I understand what happens to my photo (used once, deleted).
5. As an operator I can switch the default engine, disable a broken engine, and see cost
   per generation, without a deploy (config/registry change).

## 6. Functional requirements

### 6.1 Shipped in MVP (mocked)
- Landing page with animated demo, 3-step explainer, FAQ (EN).
- Dance Studio wizard: photo upload (drag-drop, type/size validation, preview) → dance
  picker (5 curated dances) → **engine picker** → simulated generation with staged
  progress → 9:16 result preview with share/reset.
- Engine registry (`src/lib/engines.ts`): id, vendor, status
  (`recommended | available | coming-soon`), pricing, audio behavior, duration caps,
  endpoint. Coming-soon engines render disabled.
- WCAG 2.1 AA basics: focus management per wizard step, reduced-motion alternatives,
  keyboard-only path, ≥4.5:1 body contrast.

### 6.2 Phase 1 — real generation (next)
- **R1.** Wire fal.ai queue API via server-side proxy route (`/api/fal/proxy`) so the API
  key never reaches the client (reference: fal-ai-community/video-generator-demo).
- **R2.** Upload photo + reference video to object storage (fal storage or S3-compatible)
  and submit to the selected engine's endpoint; poll/webhook for completion.
- **R3.** Audio pipeline: for Wan engines, mux the reference video's audio track onto the
  generated video (ffmpeg step, server-side). For Kling, pass `keep_original_sound=true`
  and skip muxing.
- **R4.** Curated dances become real reference clips (licensed/owned recordings) stored
  with pre-extracted metadata.
- **R5.** Result page with real `<video>` playback, download, and a shareable URL.
- **R6.** Basic abuse guardrails: content moderation on uploaded photos, rate limiting
  per IP, consent checkbox ("I have permission to use this photo").

### 6.3 Phase 2 — hardening & growth
- Queue status page resilient to long generations (email/notification on completion).
- Payments (credits) once cost per video is validated.
- Additional engines flipped from `coming-soon` to `available` (see §7).
- Swedish localization (i18n scaffold exists via copy centralization).

## 7. Engine strategy (multi-model)

All engines perform the same contract: `(characterImage, referenceVideo) → video`.
Decision basis: deep-research pass 2026-07-05, 23 source-verified claims.

| Engine | Status | Why / terms |
|---|---|---|
| **Wan 2.2 Animate 14B** (fal.ai, `fal-ai/wan/v2.2-14b/animate/move`) | **Default** | Best verified quality (beat Runway Act-Two & DreamActor-M1 in user studies); Apache 2.0, no rights claimed on output; $0.08/video-second @720p (~$1.20 per 15 s clip); commercial use explicitly allowed on fal.ai. Audio muxed in post. |
| **Kling 2.6 Motion Control** (fal.ai / Replicate) | Selectable | $0.07/s standard ($0.12/s pro); `keep_original_sound` built in (no ffmpeg step); caps: 10 s (photo orientation) / 30 s (video orientation); commercial use allowed (partner model). |
| **Wan 2.2 Animate 14B self-hosted** (ComfyUI/Diffusers) | Coming soon | Same weights (HF: `Wan-AI/Wan2.2-Animate-14B`), no per-video fee; requires GPU fleet + preprocessing (pose extraction, segmentation). Unlocks at volume. |
| **Runway Act-Two** | Coming soon | Closed API; strongest facial performance; evaluate for a "premium" tier. |
| **Viggle AI** | Coming soon | Category-defining consumer product; API access to be evaluated. |

Rejected: MimicMotion & UniAnimate (research/non-commercial licenses), Animate Anyone
(no released code/weights).

**Routing rules:** default = Wan-on-fal. If the user's reference clip ≤ 30 s and audio
fidelity matters more than length, Kling is the better pick — surface this as a hint.
Engine failures fall back to the next `available` engine with user consent.

## 8. Technical architecture

- **Frontend:** Next.js 16 (App Router, Tailwind v4), static-rendered marketing page +
  client wizard. Design system per `DESIGN.md`, strategy per `PRODUCT.md`.
- **Generation:** fal.ai queue API through a server route (key server-side only),
  webhook completion → result stored + link minted.
- **Media:** object storage for uploads/results with short TTL for source photos
  (privacy promise: used once, deleted after generation).
- **Audio:** ffmpeg mux step (serverless job) for engines without native audio carry.
- **Observability:** log engine, duration, cost, latency per generation.

## 9. Unit economics (verified pricing)

15-second clip: Wan @720p ≈ **$1.20**; Kling standard ≈ **$1.05**; Kling pro ≈ $1.80.
Implication: free tier must be capped (e.g. 1 free video, watermarked) — pricing/credits
decision gate before public launch.

## 10. Legal, privacy, safety

- Likeness consent: user must affirm permission for the uploaded photo; block minors'
  photos in moderation policy.
- GDPR: source photos deleted post-generation; results deleted on request; no training
  on user data.
- Output labeling: generated videos watermarked "AI" (aligns with EU AI Act
  transparency requirements for synthetic media).
- Dance audio: curated clips must use licensed/cleared music; user-uploaded reference
  audio is the user's responsibility (ToS) — revisit before scale.

## 11. Success metrics

- **Activation:** ≥ 40 % of visitors who upload a photo reach a finished video.
- **Share rate:** ≥ 25 % of finished videos downloaded or share-linked.
- **Time-to-video:** p50 ≤ 90 s from "Make her dance" to playable result.
- **Cost:** ≤ $1.50 per generated video blended.
- **K-factor proxy:** ≥ 15 % of sessions arrive via a shared result link.

## 12. Milestones

1. **M0 (done):** Designed end-to-end flow, mocked generation, engine registry, brand.
2. **M1:** Real generation on Wan-on-fal incl. audio mux + storage + moderation (~1–2 w).
3. **M2:** Kling selectable in production, engine fallback, shareable result pages.
4. **M3:** Payments/credits, watermarking, launch.

## 13. Open questions

1. Music licensing model for curated dances (record label clips vs. royalty-free sound-alikes)?
2. Free tier size and watermark policy?
3. Self-host break-even volume for Wan 14B (GPU cost vs. $0.08/s) — needs a load test.
4. Brand/legal review of the name "DancingGrandma" and ad claims.
