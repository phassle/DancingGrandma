import "server-only";
import { Pool } from "pg";

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
};

/** Operational credit balances — the lockable projection, not the ledger sum. */
export type Wallet = {
  available: number;
  reserved: number;
};

export type VideoGeneration = {
  id: string;
  user_id: string;
  engine: string;
  prompt: string | null;
  status: "pending" | "running" | "completed" | "failed";
  video_url: string | null;
  blob_path: string | null;
  credits_spent: number;
  created_at: string;
  completed_at: string | null;
};

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
