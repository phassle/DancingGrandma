-- DancingGrandma schema: users, their video generations, and the credit wallet.
-- Applied automatically on first Postgres startup (Aspire WithInitFiles).
-- The operational balance lives in credit_wallets (a lockable transactional
-- projection); credit_ledger is the append-only audit log it must always
-- agree with. The legacy credit_balances view is reconciliation-only.

create extension if not exists pgcrypto;

create table users (
  id          uuid primary key default gen_random_uuid(),
  external_id text unique not null,             -- Keycloak subject (sub claim)
  email       text,
  display_name text,
  created_at  timestamptz not null default now(),
  -- Refreshed on every authenticated visit; drives 90-day credit expiry.
  last_activity_at timestamptz not null default now()
);

create table video_generations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  engine        text not null,                  -- engine id from src/lib/engines.ts, or 'sora-2'
  prompt        text,
  status        text not null default 'pending'
                check (status in ('pending', 'running', 'completed', 'failed')),
  video_url     text,                           -- provider URL while fresh
  blob_path     text,                           -- durable copy in the videos container
  credits_spent integer not null default 0 check (credits_spent >= 0),
  error         text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index video_generations_user_created
  on video_generations (user_id, created_at desc);

create table credit_transactions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references users(id) on delete cascade,
  amount        integer not null check (amount <> 0),  -- positive = top-up, negative = spend
  reason        text not null,                         -- 'topup' | 'generation' | 'refund' | ...
  generation_id uuid references video_generations(id),
  created_at    timestamptz not null default now()
);

create index credit_transactions_user on credit_transactions (user_id);

-- Legacy sum-the-ledger view. Reconciliation-only — never the operational read.
create view credit_balances as
  select user_id, coalesce(sum(amount), 0)::integer as balance
  from credit_transactions
  group by user_id;

-- ---------------------------------------------------------------------------
-- Credit wallet (PRD #54): one lockable row per user holding available and
-- reserved balances as a transactional projection of credit_ledger.
-- ---------------------------------------------------------------------------

create table credit_wallets (
  user_id    uuid primary key references users(id) on delete cascade,
  available  integer not null default 0 check (available >= 0),
  reserved   integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now()
);

-- Append-only audit log. Every entry records the deltas it applies to the
-- wallet's available and reserved balances, so the wallet row must equal the
-- per-user sum of the ledger (see credit_wallet_reconciliation).
create table credit_ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references users(id) on delete cascade,
  entry_type     text not null check (entry_type in (
                   'subscription_period_grant',
                   'purchase_grant',            -- reserved for future top-ups
                   'generation_reserve',
                   'generation_capture',
                   'generation_release',
                   'credit_expiration',
                   'admin_adjustment',
                   'refund_reversal'
                 )),
  available_delta integer not null,
  reserved_delta  integer not null,
  generation_id   uuid references video_generations(id),
  note            text,
  created_at      timestamptz not null default now(),
  check (available_delta <> 0 or reserved_delta <> 0)
);

create index credit_ledger_user on credit_ledger (user_id);

-- Ledger rows are never updated or deleted — enforced, not just assumed.
create function credit_ledger_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'credit_ledger is append-only';
end;
$$;

create trigger credit_ledger_append_only
  before update or delete on credit_ledger
  for each row execute function credit_ledger_forbid_change();

-- Reconciliation read: the wallet row and this view must always agree.
create view credit_wallet_reconciliation as
  select user_id,
         coalesce(sum(available_delta), 0)::integer as ledger_available,
         coalesce(sum(reserved_delta), 0)::integer  as ledger_reserved
  from credit_ledger
  group by user_id;
