-- DancingGrandma schema: users, their video generations, and a credits ledger.
-- Applied automatically on first Postgres startup (Aspire WithInitFiles).
-- Balance is never stored — it is the sum of the ledger, so it can't drift.

create extension if not exists pgcrypto;

create table users (
  id          uuid primary key default gen_random_uuid(),
  external_id text unique not null,             -- Keycloak subject (sub claim)
  email       text,
  display_name text,
  created_at  timestamptz not null default now()
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

create view credit_balances as
  select user_id, coalesce(sum(amount), 0)::integer as balance
  from credit_transactions
  group by user_id;
