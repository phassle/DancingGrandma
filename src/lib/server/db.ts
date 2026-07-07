import "server-only";
import { Pool, type PoolClient } from "pg";

/**
 * Postgres access for users, video generations, and the credits ledger.
 * The schema lives in db/init/001-schema.sql and is applied by Aspire when
 * the Postgres container starts. The connection string arrives from the
 * apphost as ConnectionStrings__grandmadb in ADO.NET key=value form.
 */

function parseAdoConnectionString(raw: string): Record<string, string> {
  const entries = raw
    .split(";")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return [pair.slice(0, eq).trim().toLowerCase(), pair.slice(eq + 1).trim()] as const;
    });
  return Object.fromEntries(entries);
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  const raw = process.env.ConnectionStrings__grandmadb;
  if (!raw) {
    throw new Error("ConnectionStrings__grandmadb is not set — run the app via `aspire run`");
  }
  const kv = parseAdoConnectionString(raw);
  pool = new Pool({
    host: kv.host,
    port: kv.port ? Number(kv.port) : 5432,
    user: kv.username ?? kv["user id"],
    password: kv.password,
    database: kv.database ?? "grandmadb",
    ssl: kv.host && !["localhost", "127.0.0.1"].includes(kv.host) ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = undefined;
  await closing.end();
}

export type User = {
  id: string;
  external_id: string;
  email: string | null;
  display_name: string | null;
  last_activity_at: string;
  /** The user is a Stripe Customer under DancingGrandma's merchant account. */
  stripe_customer_id: string | null;
};

/** Operational credit balances — the lockable projection, not the ledger sum. */
export type Wallet = {
  available: number;
  reserved: number;
};

export type GenerationStatus =
  | "draft"
  | "awaiting_credit"
  | "reserved"
  | "submitted"
  | "running"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";

/** States in which a paid run still holds its reservation and can advance. */
export const ACTIVE_GENERATION_STATUSES: readonly GenerationStatus[] = [
  "reserved",
  "submitted",
  "running",
  "finalizing",
];

export type ReferenceSourceKind = "curated" | "upload" | "direct_url" | "imported_url";

export type VideoGeneration = {
  id: string;
  user_id: string;
  engine: string;
  prompt: string | null;
  status: GenerationStatus;
  provider: string | null;
  endpoint: string | null;
  provider_request_id: string | null;
  reference_source_kind: ReferenceSourceKind | null;
  credit_price: number;
  video_url: string | null;
  blob_path: string | null;
  credits_spent: number;
  error_kind: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

/** Start-generation refused because the wallet has no available credit. */
export class InsufficientCreditsError extends Error {
  constructor() {
    super("insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Find-or-create a user from their Keycloak identity (sub claim), refresh
 * their last-activity timestamp, and make sure their wallet row exists.
 * Called on every authenticated request, so activity tracking is automatic.
 */
export async function upsertUser(externalId: string, email?: string, displayName?: string): Promise<User> {
  const { rows } = await getPool().query<User>(
    `with u as (
       insert into users (external_id, email, display_name)
       values ($1, $2, $3)
       on conflict (external_id) do update
         set email = coalesce(excluded.email, users.email),
             display_name = coalesce(excluded.display_name, users.display_name),
             last_activity_at = now()
       returning *
     ), w as (
       insert into credit_wallets (user_id)
       select id from u
       on conflict (user_id) do nothing
     )
     select * from u`,
    [externalId, email ?? null, displayName ?? null],
  );
  return rows[0];
}

export async function getWallet(userId: string): Promise<Wallet> {
  const { rows } = await getPool().query<Wallet>(
    `select available, reserved from credit_wallets where user_id = $1`,
    [userId],
  );
  return rows[0] ?? { available: 0, reserved: 0 };
}

export async function listGenerations(userId: string): Promise<VideoGeneration[]> {
  const { rows } = await getPool().query<VideoGeneration>(
    `select * from video_generations where user_id = $1 order by created_at desc`,
    [userId],
  );
  return rows;
}

export async function createGeneration(userId: string, engine: string, prompt?: string): Promise<VideoGeneration> {
  const { rows } = await getPool().query<VideoGeneration>(
    `insert into video_generations (user_id, engine, prompt, status)
     values ($1, $2, $3, 'running') returning *`,
    [userId, engine, prompt ?? null],
  );
  return rows[0];
}

export async function completeGeneration(id: string, videoUrl: string, blobPath?: string): Promise<void> {
  await getPool().query(
    `update video_generations
     set status = 'completed', video_url = $2, blob_path = $3, completed_at = now()
     where id = $1`,
    [id, videoUrl, blobPath ?? null],
  );
}

export async function failGeneration(id: string, error: string): Promise<void> {
  await getPool().query(
    `update video_generations set status = 'failed', error = $2, completed_at = now() where id = $1`,
    [id, error],
  );
}

export async function getCreditBalance(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ balance: number }>(
    `select balance from credit_balances where user_id = $1`,
    [userId],
  );
  return rows[0]?.balance ?? 0;
}

export async function addCredits(userId: string, amount: number, reason = "topup"): Promise<void> {
  if (amount <= 0) throw new Error("top-up amount must be positive");
  await getPool().query(
    `insert into credit_transactions (user_id, amount, reason) values ($1, $2, $3)`,
    [userId, amount, reason],
  );
}

/** Run one function inside a transaction, releasing the client either way. */
async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The start-generation transaction (PRD #54): lock the wallet row, check
 * available ≥ price, create the job as `reserved`, move the credit from
 * available to reserved, and write the generation_reserve ledger entry —
 * all before any provider submission. Concurrent starts serialize on the
 * wallet lock, so two tabs with one credit reserve exactly once.
 */
export async function reserveGeneration(
  userId: string,
  params: {
    engine: string;
    provider: string;
    endpoint: string;
    referenceSourceKind: ReferenceSourceKind;
    prompt?: string;
  },
): Promise<VideoGeneration> {
  const price = 1;
  return withTransaction(async (client) => {
    const { rows: walletRows } = await client.query<{ available: number }>(
      `select available from credit_wallets where user_id = $1 for update`,
      [userId],
    );
    if ((walletRows[0]?.available ?? 0) < price) {
      throw new InsufficientCreditsError();
    }
    const { rows } = await client.query<VideoGeneration>(
      `insert into video_generations
         (user_id, engine, provider, endpoint, reference_source_kind, prompt, status, credit_price)
       values ($1, $2, $3, $4, $5, $6, 'reserved', $7)
       returning *`,
      [userId, params.engine, params.provider, params.endpoint, params.referenceSourceKind, params.prompt ?? null, price],
    );
    const generation = rows[0];
    await client.query(
      `update credit_wallets
       set available = available - $2, reserved = reserved + $2, updated_at = now()
       where user_id = $1`,
      [userId, price],
    );
    await client.query(
      `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta, generation_id)
       values ($1, 'generation_reserve', $2, $3, $4)`,
      [userId, -price, price, generation.id],
    );
    return generation;
  });
}

export async function markGenerationSubmitted(
  id: string,
  providerRequestId: string,
): Promise<VideoGeneration | undefined> {
  const { rows } = await getPool().query<VideoGeneration>(
    `update video_generations
     set status = 'submitted', provider_request_id = $2
     where id = $1 and status = 'reserved'
     returning *`,
    [id, providerRequestId],
  );
  return rows[0];
}

export async function markGenerationRunning(id: string): Promise<void> {
  await getPool().query(
    `update video_generations set status = 'running'
     where id = $1 and status in ('submitted', 'running')`,
    [id],
  );
}

export async function markGenerationFinalizing(id: string): Promise<void> {
  await getPool().query(
    `update video_generations set status = 'finalizing'
     where id = $1 and status in ('submitted', 'running', 'finalizing')`,
    [id],
  );
}

/**
 * Deliver a paid run: mark the job completed (video already persisted to
 * blob storage by the caller) and capture its reservation. Idempotent — if
 * the job is already terminal (a concurrent poll won the race) the wallet
 * is left untouched and `false` is returned.
 */
export async function captureGeneration(
  id: string,
  videoUrl: string,
  blobPath: string,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ user_id: string; credit_price: number }>(
      `update video_generations
       set status = 'completed', video_url = $2, blob_path = $3,
           credits_spent = credit_price, completed_at = now()
       where id = $1 and status in ('reserved', 'submitted', 'running', 'finalizing')
       returning user_id, credit_price`,
      [id, videoUrl, blobPath],
    );
    if (rows.length === 0) return false;
    const { user_id: userId, credit_price: price } = rows[0];
    await client.query(`select 1 from credit_wallets where user_id = $1 for update`, [userId]);
    await client.query(
      `update credit_wallets set reserved = reserved - $2, updated_at = now() where user_id = $1`,
      [userId, price],
    );
    await client.query(
      `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta, generation_id)
       values ($1, 'generation_capture', 0, $2, $3)`,
      [userId, -price, id],
    );
    return true;
  });
}

/**
 * Fail a paid run on technical/provider failure: record the error kind and
 * message and release the reservation back to available. Idempotent like
 * captureGeneration — an already-terminal job is left alone.
 */
export async function releaseGeneration(
  id: string,
  errorKind: string,
  errorMessage: string,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ user_id: string; credit_price: number }>(
      `update video_generations
       set status = 'failed', error_kind = $2, error = $3, completed_at = now()
       where id = $1 and status in ('reserved', 'submitted', 'running', 'finalizing')
       returning user_id, credit_price`,
      [id, errorKind, errorMessage],
    );
    if (rows.length === 0) return false;
    const { user_id: userId, credit_price: price } = rows[0];
    await client.query(`select 1 from credit_wallets where user_id = $1 for update`, [userId]);
    await client.query(
      `update credit_wallets
       set available = available + $2, reserved = reserved - $2, updated_at = now()
       where user_id = $1`,
      [userId, price],
    );
    await client.query(
      `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta, generation_id)
       values ($1, 'generation_release', $2, $3, $4)`,
      [userId, price, -price, id],
    );
    return true;
  });
}

export async function getGenerationForUser(
  id: string,
  userId: string,
): Promise<VideoGeneration | undefined> {
  const { rows } = await getPool().query<VideoGeneration>(
    `select * from video_generations where id = $1 and user_id = $2`,
    [id, userId],
  );
  return rows[0];
}

/** The user's latest non-terminal paid run, for resume-after-reload. */
export async function latestActiveGeneration(userId: string): Promise<VideoGeneration | undefined> {
  const { rows } = await getPool().query<VideoGeneration>(
    `select * from video_generations
     where user_id = $1 and status = any($2)
     order by created_at desc limit 1`,
    [userId, [...ACTIVE_GENERATION_STATUSES]],
  );
  return rows[0];
}

/**
 * Manual credit adjustment (support / dev seeding): wallet mutation plus an
 * explicit admin_adjustment ledger entry in one transaction.
 */
export async function grantAdminCredits(
  userId: string,
  amount: number,
  note: string,
): Promise<Wallet> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("adjustment amount must be a positive integer");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query<Wallet>(
      `update credit_wallets
       set available = available + $2, updated_at = now()
       where user_id = $1
       returning available, reserved`,
      [userId, amount],
    );
    if (rows.length === 0) throw new Error("wallet not found");
    await client.query(
      `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta, note)
       values ($1, 'admin_adjustment', $2, 0, $3)`,
      [userId, amount, note],
    );
    return rows[0];
  });
}

/**
 * Spend credits atomically against the ledger; throws if the balance would
 * go negative, so a generation can be refused before it starts.
 */
export async function spendCredits(userId: string, amount: number, generationId: string): Promise<void> {
  if (amount <= 0) throw new Error("spend amount must be positive");
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ balance: number }>(
      `select coalesce(sum(amount), 0)::integer as balance
       from credit_transactions where user_id = $1 for update`,
      [userId],
    );
    if ((rows[0]?.balance ?? 0) < amount) {
      throw new Error("insufficient credits");
    }
    await client.query(
      `insert into credit_transactions (user_id, amount, reason, generation_id)
       values ($1, $2, 'generation', $3)`,
      [userId, -amount, generationId],
    );
    await client.query(
      `update video_generations set credits_spent = $2 where id = $1`,
      [generationId, amount],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
