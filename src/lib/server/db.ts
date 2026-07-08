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

export type GenerationVisibility = "private" | "shared";

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
  /** Private by default; 'shared' opts the video into its share-by-link page. */
  visibility: GenerationVisibility;
  /** Unguessable slug behind /v/<slug>; set only while visibility = 'shared'. */
  share_slug: string | null;
  /** Soft delete — the row and its ledger trail survive, the blob does not. */
  deleted_at: string | null;
};

/** Terminal states — the reservation is settled, so the run can be deleted. */
export const TERMINAL_GENERATION_STATUSES: readonly GenerationStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

/** Start-generation refused because the wallet has no available credit. */
export class InsufficientCreditsError extends Error {
  constructor() {
    super("insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

/** Credit adjustment targeted a user without a wallet row. */
export class WalletNotFoundError extends Error {
  constructor() {
    super("wallet not found");
    this.name = "WalletNotFoundError";
  }
}

export type MediaAssetKind = "source_photo" | "reference_video" | "generated_video" | "poster";

/**
 * One record per stored object (PRD #54): source photo, reference video,
 * generated video, poster. Purging deletes the blob bytes and clears
 * blob_path while the hash and metadata survive for abuse/debugging.
 */
export type MediaAsset = {
  id: string;
  user_id: string;
  generation_id: string | null;
  kind: MediaAssetKind;
  blob_path: string | null;
  content_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  purged_at: string | null;
  created_at: string;
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
    // The delivered video becomes a private account asset (issue #59): one
    // media-asset record per stored object, kept until the user deletes it.
    await client.query(
      `insert into media_assets (user_id, generation_id, kind, blob_path, content_type, retention)
       values ($1, $2, 'generated_video', $3, 'video/mp4', 'keep_until_user_delete')`,
      [userId, id, blobPath],
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
    `select * from video_generations where id = $1 and user_id = $2 and deleted_at is null`,
    [id, userId],
  );
  return rows[0];
}

/** Look a generation up by id regardless of owner — callers enforce access. */
export async function getGenerationById(id: string): Promise<VideoGeneration | undefined> {
  const { rows } = await getPool().query<VideoGeneration>(
    `select * from video_generations where id = $1`,
    [id],
  );
  return rows[0];
}

/** The user's private library: delivered videos they have not deleted. */
export async function listLibraryGenerations(userId: string): Promise<VideoGeneration[]> {
  const { rows } = await getPool().query<VideoGeneration>(
    `select * from video_generations
     where user_id = $1 and status = 'completed' and deleted_at is null
     order by created_at desc`,
    [userId],
  );
  return rows;
}

/** Resolve a share slug to its generation — only while sharing is on. */
export async function getSharedGeneration(slug: string): Promise<VideoGeneration | undefined> {
  const { rows } = await getPool().query<VideoGeneration>(
    `select * from video_generations
     where share_slug = $1 and visibility = 'shared' and deleted_at is null`,
    [slug],
  );
  return rows[0];
}

/**
 * Toggle share-by-link (issue #59). Enabling mints the fresh slug passed in,
 * so a video re-shared after a toggle-off gets a new link and old links stay
 * dead. Only the owner's delivered, undeleted video can be shared. Returns
 * the updated row, or undefined when no such video exists for this user.
 */
export async function setGenerationSharing(
  id: string,
  userId: string,
  slug: string | null,
): Promise<VideoGeneration | undefined> {
  const { rows } = await getPool().query<VideoGeneration>(
    `update video_generations
     set visibility = case when $3::text is null then 'private' else 'shared' end,
         share_slug = $3
     where id = $1 and user_id = $2 and deleted_at is null and status = 'completed'
     returning *`,
    [id, userId, slug],
  );
  return rows[0];
}

/**
 * Soft-delete a delivered/terminal generation (issue #59): the row and its
 * ledger trail survive for audit, sharing is revoked, and the media-asset
 * records are marked deleted. Returns the blob path to remove from storage
 * (null when the run never produced one), or undefined when the video is not
 * the caller's, already deleted, or still holds an active reservation.
 */
export async function softDeleteGeneration(
  id: string,
  userId: string,
): Promise<{ blob_path: string | null } | undefined> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ blob_path: string | null }>(
      `update video_generations
       set deleted_at = now(), visibility = 'private', share_slug = null
       where id = $1 and user_id = $2 and deleted_at is null and status = any($3)
       returning blob_path`,
      [id, userId, [...TERMINAL_GENERATION_STATUSES]],
    );
    if (rows.length === 0) return undefined;
    await client.query(
      `update media_assets set deleted_at = now()
       where generation_id = $1 and deleted_at is null`,
      [id],
    );
    return rows[0];
  });
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

export type AdjustmentEntryType = "admin_adjustment" | "refund_reversal";

/**
 * Support corrections and refund reversals (PRD #54, issue #60): always a
 * new compensating ledger entry plus the matching wallet mutation in one
 * transaction — history is never edited. A negative delta may not drive the
 * available balance below zero.
 */
export async function adjustCredits(
  userId: string,
  delta: number,
  entryType: AdjustmentEntryType,
  note: string,
): Promise<Wallet> {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error("adjustment delta must be a nonzero integer");
  }
  if (entryType === "refund_reversal" && delta >= 0) {
    throw new Error("a refund reversal must remove credits");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query<Wallet>(
      `select available, reserved from credit_wallets where user_id = $1 for update`,
      [userId],
    );
    if (rows.length === 0) throw new WalletNotFoundError();
    if (rows[0].available + delta < 0) throw new InsufficientCreditsError();
    const { rows: updated } = await client.query<Wallet>(
      `update credit_wallets
       set available = available + $2, updated_at = now()
       where user_id = $1
       returning available, reserved`,
      [userId, delta],
    );
    await client.query(
      `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta, note)
       values ($1, $2, $3, 0, $4)`,
      [userId, entryType, delta, note],
    );
    return updated[0];
  });
}

/**
 * Manual credit grant (support / dev seeding): a positive admin_adjustment.
 */
export async function grantAdminCredits(
  userId: string,
  amount: number,
  note: string,
): Promise<Wallet> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("adjustment amount must be a positive integer");
  }
  return adjustCredits(userId, amount, "admin_adjustment", note);
}

/** Credits expire after this many days without an authenticated visit. */
export const CREDIT_EXPIRY_DAYS = 90;

/**
 * Expire unused credits of users inactive for 90+ days (PRD #54 story 27):
 * an explicit credit_expiration ledger entry per wallet — never an edit to
 * the original grant — zeroing only the available balance. Reserved credits
 * belong to a non-terminal generation and are never touched; upsertUser
 * refreshes last_activity_at on every authenticated visit, so any visit
 * inside the window resets the clock.
 */
export async function expireStaleCredits(): Promise<{
  expiredWallets: number;
  expiredCredits: number;
}> {
  return withTransaction(async (client) => {
    const { rows: stale } = await client.query<{ user_id: string; available: number }>(
      `select w.user_id, w.available
       from credit_wallets w
       join users u on u.id = w.user_id
       where w.available > 0
         and u.last_activity_at < now() - make_interval(days => $1)
       for update of w`,
      [CREDIT_EXPIRY_DAYS],
    );
    for (const { user_id: userId, available } of stale) {
      await client.query(
        `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta, note)
         values ($1, 'credit_expiration', $2, 0, $3)`,
        [userId, -available, `expired after ${CREDIT_EXPIRY_DAYS} days of inactivity`],
      );
      await client.query(
        `update credit_wallets set available = 0, updated_at = now() where user_id = $1`,
        [userId],
      );
    }
    return {
      expiredWallets: stale.length,
      expiredCredits: stale.reduce((sum, row) => sum + row.available, 0),
    };
  });
}

/**
 * Record the user's source photo as a media asset while its generation is
 * in flight; the bytes are purged as soon as the run reaches a terminal
 * state (PRD #54 story 38).
 */
export async function createSourcePhotoAsset(params: {
  userId: string;
  generationId: string;
  blobPath: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}): Promise<MediaAsset> {
  const { rows } = await getPool().query<MediaAsset>(
    `insert into media_assets (user_id, generation_id, kind, blob_path, content_type, byte_size, sha256)
     values ($1, $2, 'source_photo', $3, $4, $5, $6)
     returning *`,
    [params.userId, params.generationId, params.blobPath, params.contentType, params.byteSize, params.sha256],
  );
  return rows[0];
}

/** Source photos of one generation whose bytes still exist. */
export async function unpurgedSourcePhotoAssets(generationId: string): Promise<MediaAsset[]> {
  const { rows } = await getPool().query<MediaAsset>(
    `select * from media_assets
     where generation_id = $1 and kind = 'source_photo' and purged_at is null`,
    [generationId],
  );
  return rows;
}

/** Source photos that outlived their terminal generation (sweep input). */
export async function unpurgedTerminalSourcePhotoAssets(): Promise<MediaAsset[]> {
  const { rows } = await getPool().query<MediaAsset>(
    `select m.* from media_assets m
     join video_generations g on g.id = m.generation_id
     where m.kind = 'source_photo' and m.purged_at is null
       and g.status in ('completed', 'failed', 'cancelled')`,
  );
  return rows;
}

/** The blob bytes are gone: clear the path, keep hash and metadata. */
export async function markMediaAssetPurged(id: string): Promise<void> {
  await getPool().query(
    `update media_assets set blob_path = null, purged_at = now() where id = $1`,
    [id],
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
