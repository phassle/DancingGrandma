# User accounts, credits, and paid generation research

Issue: [#50](https://github.com/phassle/DancingGrandma/issues/50)
Date: 2026-07-05

## Short answer

Use a logged-in account with an internal credit wallet, grant credits only from
verified payment webhooks, reserve one credit before submitting a generation,
consume it only when a final generated video is delivered, and release/refund it
when the run fails for technical or policy reasons before delivery.

For DancingGrandma's first paid version:

- Sell one Stripe monthly subscription: **$9.99/month**.
- Grant **5 credits per paid billing period** on that subscription.
- Price one completed generated dance video at **1 credit**.
- Let visitors build commitment first: select a photo and paste/import a
  reference video URL before account creation. Treat that as a **pre-account
  draft** held in the browser, not as owned product storage.
- Show a **generation gate** when the visitor clicks "Start generation": blur or
  dim the rest of the page, keep the prepared draft visible in context, and
  require account creation plus enough credits before provider submission.
- Store generated outputs in our Azure Blob Storage immediately after provider
  completion; treat fal/Replicate URLs as temporary and public transport URLs,
  not product URLs.
- Keep source photos and user-supplied reference clips private, short-lived, and
  deletable. Keep the final generated video until the user deletes it or a
  retention policy says otherwise.

The current repo already has the right rough ingredients: Keycloak, Postgres,
Azure Blob Storage, `users`, `video_generations`, and a `credit_transactions`
table. The schema is not yet strong enough for paid launch because it lacks
pre-account draft handling, subscription records, payment/invoice records,
reservations, provider run identity, idempotency records, stored input/output
metadata, and explicit privacy/retention state.

## What other AI generation services do

### Credits are the normal user-facing abstraction

AI media products commonly abstract variable GPU/provider cost into credits,
tokens, or fast GPU time. The user sees a balance and a per-action price; the
system maps that to model, resolution, duration, speed, priority, and feature
cost internally.

- Runway adds monthly credits by plan, lets paid users buy extra credits, and
  prices video by credit rate times duration. Gen-4.5 is documented as 12
  credits per second, so a 5 or 10 second render costs 60 or 120 credits.
  Purchased credits do not expire, while monthly credits usually expire at the
  billing date. Source: [Runway credits](https://help.runwayml.com/hc/en-us/articles/15124877443219-How-do-credits-work).
- Kling AI states that credits are deducted when generation starts and refunded
  if the generation fails. It also documents a standard purchase conversion of
  $1 = 66 credits and says credits with shorter validity are used first. Source:
  [Kling credits policy](https://kling.ai/docs/point-policy).
- Pika prices plans by monthly video credits and lists per-video credit costs by
  tool, model, duration, and resolution. It also makes credit packs part of the
  plan value, not a raw provider-cost pass-through. Source: [Pika pricing](https://pika.art/pricing).
- Luma Dream Machine uses monthly credits, top-up credits, model/resolution
  rates, and different handling for subscription credits versus top-ups. Monthly
  credits do not roll over, while top-ups last 12 months and are used after
  monthly credits. Source: [Luma credit system](https://lumalabs.ai/learning-hub/dream-machine-credit-system).
- Leonardo calls its internal currency tokens. Token cost varies by compute
  intensity, paid plans get monthly allowances, top-up tokens do not expire, and
  usage order distinguishes rollover, fast, and top-up tokens. Source:
  [Leonardo pricing](https://leonardo.ai/pricing) and
  [Leonardo top-up tokens](https://intercom.help/leonardo-ai/en/articles/11702713-top-up-tokens).
- Viggle's consumer plans include monthly credits, different concurrency and
  storage limits, and permanent asset storage on paid plans. Its API pricing is
  even more explicit: 1 credit per rendered video second, failed renders are
  refunded, and stored assets never expire. Sources:
  [Viggle pricing](https://viggle.ai/pricing) and
  [Viggle API pricing](https://docs.viggle.ai/pricing).
- Midjourney uses GPU time rather than credits, but the same pattern applies:
  plans include monthly fast time, extra fast time can be purchased, and slower
  relaxed generation is a separate usage mode. Source:
  [Midjourney GPU speed](https://docs.midjourney.com/hc/en-us/articles/32016412137741-GPU-Speed-Fast-Relax-Turbo).

The recurring pattern is: users do not pay per provider request directly. They
buy a product-level usage unit, and the product decides how much of that unit a
specific operation costs.

## Refund and failure behavior

The common distinction is between a technical generation failure and a completed
but disappointing result.

- Runway automatically returns credits only when the generation ends in a
  generation error. If it completes, credits are consumed even if the result is
  not what the user wanted. Source:
  [Runway credit refunds](https://help.runwayml.com/hc/en-us/articles/34266159290003-Can-I-have-credits-refunded).
- Kling deducts credits immediately when generation starts and refunds the
  corresponding credits if generation fails. Source:
  [Kling credits policy](https://kling.ai/docs/point-policy).
- Viggle API says failed renders are refunded. Source:
  [Viggle API pricing](https://docs.viggle.ai/pricing).

Recommendation for DancingGrandma: use "reserve at start, capture on delivery"
internally. The UI can show the credit as unavailable immediately, which matches
the consumer pattern, but the ledger can still distinguish pending reservations
from final consumption. This gives us a clean way to recover from queued jobs,
browser reloads, provider errors, and moderation failures.

Proposed policy:

- **Input rejected before provider submission**: no credit consumed.
- **Moderation/content-policy rejection before provider submission**: no credit
  consumed.
- **Provider submission accepted, then technical/provider failure**: release the
  reserved credit.
- **Generation completes and final video is copied to our storage**: consume the
  reserved credit.
- **Generation completes but quality is poor**: consume the credit; manual
  support can issue an adjustment if desired.
- **User closes the tab**: no effect on the run; reservation remains until the
  job reaches a terminal state.
- **User cancels**: only release the credit if we can cancel before provider
  billing or before the provider run is accepted. Otherwise consume on delivery
  or handle manually.

## Payment pattern

The normal safe payment pattern is not "client returns from checkout, then add
credits." For subscription ARR/MRR, the safe pattern is:

1. Authenticated user asks to start the monthly plan.
2. Server creates an internal pending subscription intent.
3. Server creates a Stripe Checkout Session in `subscription` mode for the
   `$9.99/month` price and puts the internal user/subscription id in metadata.
4. Stripe redirects the browser to hosted Checkout.
5. Stripe creates the subscription and invoice/payment lifecycle.
6. Webhook handler grants the period's credits exactly once after a successful
   subscription invoice payment.
7. Browser success page polls our backend for subscription status and credit
   availability.
8. The user can manage or cancel the subscription through the Stripe Customer
   Portal.

Important Stripe language: the user does **not** create a Stripe account. The
Stripe account belongs to DancingGrandma as the merchant. The buyer is modeled
as a Stripe `Customer`, with name/email and payment history attached to that
customer record.

Resolved during grilling: DancingGrandma owns and operates the Stripe merchant
account. A DancingGrandma user only creates a DancingGrandma account and pays
through Stripe; they do not create or manage a Stripe account.

Resolved during grilling: v1 uses a cancellable monthly subscription at
`$9.99/month`, not a one-time credit pack. The subscription grants 5 credits per
paid billing period. Users can cancel whenever they want through account
management/Stripe Customer Portal.

Stripe documents that Checkout Sessions represent one-time purchases or
subscriptions and should be created server-side. Checkout Sessions support
subscription mode; Stripe subscriptions handle recurring invoices, payment
collection, lifecycle states, and cancellation. Stripe's Customer Portal lets
customers cancel subscriptions immediately or at the end of the current billing
period. Stripe also documents webhooks for subscription status changes,
recurring payment success/failure, signature verification, retry behavior, and
the fact that events are not guaranteed to arrive in order. Sources:
[Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions),
[Stripe subscription overview](https://docs.stripe.com/billing/subscriptions/overview),
[Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[Stripe Customer Portal](https://docs.stripe.com/customer-management),
[Stripe subscription cancellation](https://docs.stripe.com/billing/subscriptions/cancel),
[Stripe Customer object](https://docs.stripe.com/api/customers/object),
[Stripe webhooks](https://docs.stripe.com/webhooks), and
[Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).

Implementation implications:

- Store `stripe_customer_id` on the user/account.
- Prefer creating or looking up the Stripe Customer from the authenticated app
  user, then pass that customer id into Checkout. Let Checkout collect payment
  details, not app code.
- Store `subscriptions` with `status`, `stripe_subscription_id`,
  `stripe_customer_id`, `current_period_start`, `current_period_end`,
  `cancel_at_period_end`, `canceled_at`, and timestamps.
- Store `subscription_credit_grants` or invoice-linked ledger ids so each paid
  billing period grants 5 credits exactly once.
- Store `credit_purchases` only if one-time top-ups are added later; they are no
  longer part of v1.
- Store processed webhook event ids so retries do not grant duplicate credits.
- Put unique constraints on `stripe_subscription_id`, Stripe invoice ids, and
  processed webhook event ids.
- Use idempotency keys when creating Stripe Checkout Sessions.
- Do not trust client-side checkout success for fulfillment.
- Add admin adjustment/refund entries instead of mutating historical ledger
  rows.

The business model is subscription ARR/MRR, not one-time top-up revenue. At
`$9.99/month`, one active subscriber has annualized recurring revenue of
`$119.88` before churn, taxes, refunds, payment fees, and provider costs.

## Auth and account model

The repo already points toward Keycloak in the Aspire stack. That is a good fit
for the first implementation because it avoids adding a second identity system.
Keycloak is an OpenID Connect/OAuth2 identity provider with user management,
social login, roles, sessions, and an account console. Sources:
[Keycloak server admin guide](https://www.keycloak.org/docs/latest/server_admin/index.html) and
[Keycloak OIDC endpoints](https://www.keycloak.org/securing-apps/oidc-layers).

Recommendation:

- Keep Keycloak as the identity provider for Phase 2.
- Treat Keycloak's `sub` claim as the external identity, not as the business
  account id.
- Keep product data in Postgres: profile copy, Stripe customer id, credits,
  purchases, generations, media records, and share visibility.
- Let anonymous visitors prepare a pre-account draft, but require login before
  any paid generation job is created or any provider call is made.
- Use a modal generation gate in the app shell for the first step of account
  creation, but redirect to Keycloak or use a Keycloak-backed embedded form for
  the actual credential flow. Do not store raw passwords in custom app tables.
- Defer organization/team accounts until there is a real B2B need. Several
  services support shared workspace/team credits, but DancingGrandma's stated
  flow is single-user.

## Conversion-first generation gate

The user flow should maximize commitment before asking for account/payment, but
it should not be deceptive. The product can delay the gate until the visitor has
selected a photo and reference motion source, then present a clear modal that
says generation requires an account and one credit. The blur/dimmed background
is a focus treatment, not a trick: it should preserve context, keep the prepared
draft visible, and give an honest path to continue or back out.

Normal flow:

1. Visitor lands in the studio without an account.
2. Visitor selects a person photo locally.
3. Visitor picks a curated dance, uploads a reference clip, or pastes/imports a
   video URL.
4. The app validates what it can locally and shows a ready-to-generate summary.
5. Visitor clicks "Start generation."
6. The app opens the generation gate as a modal and blurs/dims the studio behind
   it.
7. The modal collects the minimum account fields: name and email, then uses the
   identity provider for registration or email verification.
8. After authentication, the server creates or finds the internal user and
   Stripe Customer.
9. If the user has no active subscription or insufficient credits, the same flow
   continues into Stripe Checkout for the `$9.99/month` plan.
10. Stripe webhook confirms the subscription payment and grants the period's
    credits; the app polls subscription/credit status.
11. The generation starts only after the account exists and credits are
    available or reserved.

Implementation implications:

- Before auth, keep photo bytes in browser memory or IndexedDB only. Avoid
  uploading personal photos to server storage without an owner.
- A pasted URL can be stored as draft text before auth, but any server-side
  import/transcode should happen after auth unless there is a deliberately
  short-lived anonymous upload token and cleanup job.
- After auth, recreate the draft as a server-side generation draft tied to
  `user_id`.
- The modal should explain the transaction plainly: "Create an account to save
  your video. Generation uses 1 credit. The monthly plan is $9.99 and includes
  5 credits."
- Do not ask the user to "create a Stripe account." Say "Pay securely with
  Stripe" or "Start monthly plan."

Resolved during grilling: pre-account drafts stay browser-only in v1. Anonymous
visitors can prepare the photo/reference/engine choice before the gate, but no
personal photo or user-supplied reference video is uploaded to DancingGrandma
storage until the visitor has created or signed into an account.

Resolved during grilling: unused credits expire after 90 days of inactivity,
whether they came from a subscription period or a future one-time top-up.
"Active" means the user is logged into DancingGrandma. Any authenticated app
visit/session refresh should update `last_account_activity_at`; anonymous
pre-account draft activity does not keep credits alive.

Resolved during grilling: cancelling the subscription stops future monthly
credit grants, but it does not revoke credits already granted from paid billing
periods. Already-granted unused credits remain usable until their normal 90-day
inactivity expiration.

## Media and output storage pattern

Comparable products treat generated media as account assets.

- Runway stores uploads in an asset library, defaults uploaded/exported assets
  to private, puts generated assets in an "All Generations" area, and lets users
  deliberately share assets by link. Sources:
  [Runway managing assets](https://help.runwayml.com/hc/en-us/articles/4408611980563-Managing-assets),
  [Runway organize assets](https://help.runwayml.com/hc/en-us/articles/23998498329107-How-to-organize-assets), and
  [Runway share assets](https://help.runwayml.com/hc/en-us/articles/25562277393427-How-to-share-an-asset).
- Viggle's free plan lists 7-day asset and generation storage, while paid plans
  list permanent asset storage. Source:
  [Viggle pricing](https://viggle.ai/pricing).

Provider URLs should not be product storage:

- fal media URLs are public, available at least 7 days by default, and should be
  downloaded to private infrastructure if long-term or private storage is
  needed. fal request payloads default to 30-day storage unless disabled. Source:
  [fal FAQ](https://fal.ai/docs/documentation/model-apis/faq) and
  [fal data retention](https://fal.ai/docs/documentation/model-apis/media-expiration).
- Replicate output file URLs expire after one hour, and Replicate specifically
  recommends webhooks for persisting prediction data/files before deletion.
  Source: [Replicate output files](https://replicate.com/docs/topics/predictions/output-files) and
  [Replicate webhooks](https://replicate.com/docs/topics/webhooks).

Azure Blob Storage is the right durable store for the final video. Blob Storage
is object storage for unstructured data and supports client libraries including
Node.js. Microsoft documents uploads with the JavaScript client, private
containers by default, SAS URLs for delegated access, and lifecycle policies for
age or tag based deletion. Sources:
[Azure Blob introduction](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction),
[Azure upload with JavaScript](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload-javascript),
[Azure anonymous access](https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-configure),
[Azure SAS overview](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview), and
[Azure lifecycle deletion](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-policy-delete).

Recommended storage shape:

```text
videos/
  users/{user_id}/generations/{generation_id}/output/final.mp4
  users/{user_id}/generations/{generation_id}/output/poster.jpg
  users/{user_id}/generations/{generation_id}/input/photo-original.{ext}
  users/{user_id}/generations/{generation_id}/input/reference.{ext}
```

Do not expose blob containers publicly. Serve videos through an authenticated
app route or short-lived SAS URL. For public share links, expose an app-level
`/v/{share_slug}` page that checks generation visibility and then issues a
short-lived read URL or proxies the stream.

Source photo policy should be stricter than output policy:

- Keep input photo only as long as needed for moderation, provider submission,
  retry, and audit.
- Store a hash and metadata for abuse/debugging without keeping the image
  indefinitely.
- Delete source photos automatically after terminal generation unless the user
  explicitly opts into keeping them for retries/history.
- Keep user-uploaded reference clips according to a separate policy; curated
  reference clips are product assets, not user data.

## Recommended domain model

### User/account

- `users`: internal id, external identity provider id, email, display name,
  Stripe customer id, created/deleted timestamps.
- Later: `accounts` or `workspaces` only if team/shared-credit behavior is
  needed. Do not add it for the first consumer flow.

### Pre-account draft

Represents the visitor's prepared but not-yet-owned work before the generation
gate. In v1 this should be browser state, not a database table.

Fields:

- local photo file handle or browser object URL
- reference source: curated id, local reference file, pasted URL, or imported
  preview URL
- selected engine
- local validation status
- created_at in browser state

If later server-side anonymous drafts are introduced, they need expiration,
abuse controls, owner-claiming after login, and cleanup. Do not add that
complexity to the first paid version unless local/browser-only drafts are not
enough.

### Credit purchase

Represents the business event "the user bought a one-time pack." This is not
part of the v1 subscription model, but remains a useful future extension if
one-time top-ups are added later.

Fields:

- id
- user_id
- pack_code, e.g. `credits_5_usd_10`
- credits_granted = 5
- amount_minor = 1000
- currency = `usd`
- status: `pending`, `paid`, `credited`, `failed`, `refunded`
- Stripe checkout session id
- Stripe payment intent id
- created_at, paid_at, credited_at

### Subscription

Represents the user's recurring DancingGrandma membership.

Fields:

- id
- user_id
- status: `pending`, `active`, `past_due`, `canceled`, `incomplete`
- plan_code, e.g. `monthly_5_credits_usd_999`
- credits_per_period = 5
- amount_minor = 999
- currency = `usd`
- interval = `month`
- stripe_customer_id
- stripe_subscription_id
- current_period_start
- current_period_end
- cancel_at_period_end
- canceled_at
- created_at, updated_at

### Credit wallet and ledger

Use a ledger, but also use a lockable wallet/account row as the concurrency
boundary.

Current repo note: `db/init/001-schema.sql` says balance is never stored and
`src/lib/server/db.ts` tries to compute balance with `sum(amount) ... for
update`. That is not the shape I would ship. Production credit systems need an
append-only audit trail **and** a clear lock boundary for concurrent start
requests. A `credit_wallets` row can hold current available/reserved balances as
a transactional projection, while `credit_ledger_entries` remains the audit log.

Ledger entry types:

- `subscription_period_grant`: credits become available after a paid
  subscription invoice.
- `purchase_grant`: credits become available after verified one-time payment,
  if top-ups are added later.
- `generation_reserve`: move 1 credit from available to reserved.
- `generation_capture`: consume the reserved credit on completed delivery.
- `generation_release`: release a reserved credit after technical failure or
  pre-billing cancellation.
- `credit_expiration`: remove unused paid credits after the account has been
  inactive for the configured inactivity window.
- `admin_adjustment`: manual support correction.
- `refund_reversal`: remove or offset credits when a payment refund/dispute is
  accepted and unused credits remain.

Important invariants:

- Available credits cannot go below zero.
- Reserved credits cannot go below zero.
- A generation can have at most one active reservation.
- A completed generation captures exactly one reservation for the current
  product price.
- Credit expiration is a ledger event, not a mutation of the original purchase
  or grant row.
- Ledger rows are never updated or deleted; corrections are compensating rows.
- All external ids that can be retried have unique constraints.

### Generation job

A paid generation is a durable server-side job, not a browser-only promise.

Fields:

- id
- user_id
- status: `draft`, `awaiting_credit`, `reserved`, `submitted`, `running`,
  `finalizing`, `completed`, `failed`, `cancelled`
- engine_id, provider, provider_endpoint, provider_request_id
- source_photo_media_id
- reference_media_id or curated_reference_id
- reference_source: `curated`, `upload`, `direct_url`, `imported_url`
- credit_price = 1
- credit_reservation_id
- output_media_id
- share_slug, visibility: `private`, `link`
- started_at, submitted_at, completed_at
- error_kind, error_message
- provider_input_json/provider_output_json redacted of secrets

The existing `video_generations` table is close in spirit but too thin: it has
no provider request id, no reference/photo media records, no share/visibility,
no reservation id, no payment linkage, and only four statuses.

### Media asset

Use a separate media table rather than putting every URL directly on
`video_generations`.

Fields:

- id
- owner_user_id
- generation_id
- kind: `source_photo`, `reference_video`, `generated_video`, `poster`
- storage_provider: `azure_blob`, `provider_url`, `curated_static`
- blob_path
- original_url, if imported from URL
- content_type, size_bytes, checksum
- duration_ms, width, height
- privacy: `private`, `share_link`, `public_product_asset`
- retention_policy: `delete_after_generation`, `keep_until_user_delete`,
  `curated`
- deleted_at

## Proposed paid generation flow

1. Anonymous visitor selects a photo and reference motion source in the browser.
2. Visitor clicks "Start generation."
3. App opens the generation gate modal over the blurred/dimmed studio.
4. Visitor creates or signs into an account with name and email through the
   identity provider.
5. Server creates or updates the internal user and Stripe Customer.
6. If the user has no active subscription or insufficient credits, server
   creates a Stripe Checkout Session in subscription mode for the `$9.99/month`
   plan and records a pending subscription.
7. Stripe webhook marks the subscription active and grants 5 credits exactly
   once for the paid billing period.
8. Server creates a generation draft and stores private input blobs or validated
   external references tied to the user.
9. Server transaction:
   - lock wallet row
   - check available credits >= 1
   - create/update generation row
   - write `generation_reserve`
   - mark generation `reserved`
10. Server submits provider request.
11. Store provider request id and mark generation `submitted`/`running`.
12. Poll or receive provider webhook until terminal state.
13. On provider success:
   - download provider output immediately
   - finalize audio/watermark if needed
   - upload final MP4 to Azure Blob Storage
   - write media row for final output
   - mark generation `completed`
   - write `generation_capture`
14. On technical/provider failure:
   - mark generation `failed`
   - write `generation_release`
15. UI can resume by loading the user's latest non-terminal generation by id,
    not from `localStorage` alone.

The current `src/lib/generate.ts` still starts generation from the browser via a
fal proxy and returns a local object URL after `/api/video/finalize`. For paid
credits, start/track/finalize need to move behind authenticated server routes so
the DB transaction, provider submission, and blob copy are one durable workflow.

## Minimum viable implementation slices

1. Pre-account draft: browser-only photo/reference/engine state.
2. Generation gate: modal account prompt over the prepared studio state.
3. Auth gate: Keycloak login/registration and server-side user session.
4. Wallet read model: show credit balance in the app.
5. Stripe subscription: one `$9.99/month` Checkout subscription product; webhook
   grants 5 credits per paid billing period idempotently.
6. Generation reservation: server-side `start generation` endpoint checks and
   reserves one credit.
7. Durable run tracking: generation rows store provider request id and terminal
   status.
8. Blob persistence: copy completed provider output into Azure Blob Storage.
9. Library/share page: private generation history plus optional `/v/{share}`.
10. Cleanup: delete source photo blobs after terminal state unless retained for a
   specific user-visible reason.

## Open decisions for grilling

1. Should users be able to cancel a queued generation and get the credit back?
2. Should a completed but obviously bad output consume a credit, or do we offer
   one-click self-service refund/retry?
3. How long should generated videos remain in storage by default?
4. Are share links public-by-link forever, expiring, or revocable private links?
5. Should source photos be deleted immediately after completion, or retained
   briefly to support retry?
6. Should the first version support only single-user accounts, or also team
   credits/workspaces?

## Recommended answers before grilling

- Keep pre-account drafts browser-only. Let visitors prepare the experience
  before signup, but do not store personal photos server-side until the account
  exists.
- Unused credits expire after 90 days of inactivity. The expiration must be
  represented as a `credit_expiration` ledger entry, not by editing the original
  subscription grant, purchase, or grant row. "Active" means the user is logged
  into DancingGrandma, so authenticated visits refresh the expiration window.
- The v1 paid offer is a `$9.99/month` subscription that grants 5 credits per
  paid billing period. Use Stripe Customer Portal for cancel-anytime
  subscription management.
- Cancelling the subscription stops future credit grants but does not revoke
  already-granted credits. Those credits expire through the normal inactivity
  rule.
- Cancel only refunds if the provider run has not been accepted or can be
  cancelled without cost.
- Completed output consumes a credit; support can issue manual adjustments.
- Store generated videos until user deletion for paid users, then revisit
  automatic expiration after storage costs are measured.
- Use private-by-default assets with explicit share-by-link, mirroring Runway's
  asset pattern.
- Delete source photos after terminal state unless the user opts into retry
  storage.
- Keep v1 single-user. Add workspaces only after a team buyer asks for shared
  credits.
