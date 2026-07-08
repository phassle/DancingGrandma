-- Stripe subscription billing (PRD #54, issue #56): the $9.99/month plan
-- granting 5 credits per paid billing period. Fulfillment happens only from
-- verified Stripe webhooks; unique constraints on Stripe subscription,
-- invoice, and event ids make retries and out-of-order delivery converge.

-- The user is a Stripe Customer under DancingGrandma's merchant account.
alter table users add column stripe_customer_id text unique;

create table subscriptions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references users(id) on delete cascade,
  -- Null while the checkout session is pending; set by webhooks.
  stripe_subscription_id     text unique,
  stripe_checkout_session_id text unique,
  status                     text not null default 'pending'
                             check (status in ('pending', 'active', 'past_due', 'canceled')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index subscriptions_user on subscriptions (user_id, created_at desc);

-- One credit grant per paid Stripe invoice — the idempotency anchor for
-- fulfillment. Replayed or duplicate webhook deliveries hit the unique
-- constraint and grant nothing.
create table subscription_credit_grants (
  id                bigint generated always as identity primary key,
  subscription_id   uuid not null references subscriptions(id) on delete cascade,
  user_id           uuid not null references users(id) on delete cascade,
  stripe_invoice_id text unique not null,
  credits           integer not null check (credits > 0),
  created_at        timestamptz not null default now()
);

-- Every processed webhook event id, persisted inside the same transaction as
-- its effects, so redelivery of an already-applied event is a no-op.
create table stripe_webhook_events (
  stripe_event_id text primary key,
  event_type      text not null,
  processed_at    timestamptz not null default now()
);
