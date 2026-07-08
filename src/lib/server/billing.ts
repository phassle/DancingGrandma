import "server-only";
import type { PoolClient } from "pg";
import { getPool, withTransaction } from "./db";
import type { StripeEvent } from "./stripe";

/** The $9.99/month plan grants 5 credits per paid billing period. */
export const PLAN_CREDITS = 5;

/**
 * Subscription billing state (PRD #54, issue #56): pending checkout rows,
 * webhook-driven fulfillment, and the exactly-once credit grant per paid
 * Stripe invoice.
 *
 * Idempotency model, all enforced by the database inside one transaction per
 * webhook event:
 *  - stripe_webhook_events.stripe_event_id  → replayed events are no-ops
 *  - subscription_credit_grants.stripe_invoice_id → one grant per invoice,
 *    even across distinct event ids for the same invoice
 *  - subscriptions.stripe_subscription_id   → out-of-order events converge
 *    on a single subscription row
 */

export type Subscription = {
  id: string;
  user_id: string;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  status: "pending" | "active" | "past_due" | "canceled";
};

const SUBSCRIPTION_COLUMNS =
  "id, user_id, stripe_subscription_id, stripe_checkout_session_id, status";

export async function setStripeCustomerId(userId: string, customerId: string): Promise<void> {
  await getPool().query(`update users set stripe_customer_id = $2 where id = $1`, [
    userId,
    customerId,
  ]);
}

/** Record the pending subscription before the browser leaves for Checkout. */
export async function createPendingSubscription(userId: string): Promise<Subscription> {
  const { rows } = await getPool().query<Subscription>(
    `insert into subscriptions (user_id) values ($1) returning ${SUBSCRIPTION_COLUMNS}`,
    [userId],
  );
  return rows[0];
}

export async function setCheckoutSessionId(
  subscriptionRowId: string,
  sessionId: string,
): Promise<void> {
  await getPool().query(`update subscriptions set stripe_checkout_session_id = $2 where id = $1`, [
    subscriptionRowId,
    sessionId,
  ]);
}

/** The user's most relevant subscription: a live one if any, else the newest. */
export async function getCurrentSubscription(userId: string): Promise<Subscription | null> {
  const { rows } = await getPool().query<Subscription>(
    `select ${SUBSCRIPTION_COLUMNS} from subscriptions
     where user_id = $1
     order by (status in ('active', 'past_due')) desc, created_at desc
     limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Apply one verified Stripe event. The whole application — event-id record,
 * subscription state, credit grant, ledger entry, wallet update — commits or
 * rolls back atomically, so a crash mid-processing lets Stripe's retry redo
 * the work and a replay of an applied event does nothing.
 */
export async function processStripeEvent(event: StripeEvent): Promise<void> {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `insert into stripe_webhook_events (stripe_event_id, event_type)
       values ($1, $2) on conflict (stripe_event_id) do nothing`,
      [event.id, event.type],
    );
    if (rowCount === 0) {
      // Replay of an already-applied event.
      return;
    }

    const object = event.data.object;
    switch (event.type) {
      case "checkout.session.completed":
        await applyCheckoutCompleted(client, object);
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
        await applyInvoicePaid(client, object);
        break;
      case "invoice.payment_failed":
        await applyStatusFromStripe(client, invoiceSubscriptionId(object), "past_due");
        break;
      case "customer.subscription.deleted":
        await applyStatusFromStripe(client, str(object.id), "canceled", true);
        break;
      default:
        // Recorded but otherwise ignored event type.
        break;
    }
  });
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Invoice → Stripe subscription id, across Stripe API shapes (basil and older). */
function invoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  const parent = (invoice.parent as Record<string, unknown> | undefined)?.subscription_details as
    | Record<string, unknown>
    | undefined;
  return str(parent?.subscription) ?? str(invoice.subscription);
}

/** Invoice → our user id, from the subscription metadata set at checkout. */
function invoiceUserId(invoice: Record<string, unknown>): string | null {
  const parent = (invoice.parent as Record<string, unknown> | undefined)?.subscription_details as
    | Record<string, unknown>
    | undefined;
  const metadata = (parent?.metadata ?? invoice.subscription_details_metadata ?? {}) as Record<
    string,
    unknown
  >;
  return str(metadata.user_id);
}

/**
 * Link the Stripe subscription id to the pending row created at checkout.
 * If an out-of-order invoice webhook already created the subscription row,
 * fold the pending row into it instead of leaving two.
 */
async function applyCheckoutCompleted(
  client: PoolClient,
  session: Record<string, unknown>,
): Promise<void> {
  const sessionId = str(session.id);
  const stripeSubscriptionId = str(session.subscription);
  if (!sessionId || !stripeSubscriptionId) return;

  const claimed = await client.query(
    `update subscriptions set stripe_subscription_id = $1, updated_at = now()
     where stripe_checkout_session_id = $2
       and stripe_subscription_id is null
       and not exists (select 1 from subscriptions where stripe_subscription_id = $1)`,
    [stripeSubscriptionId, sessionId],
  );
  if (claimed.rowCount === 0) {
    // The invoice webhook won the race: merge the pending row away and stamp
    // the session id onto the row it created.
    await client.query(
      `delete from subscriptions
       where stripe_checkout_session_id = $2 and stripe_subscription_id is null
         and exists (select 1 from subscriptions where stripe_subscription_id = $1)`,
      [stripeSubscriptionId, sessionId],
    );
    await client.query(
      `update subscriptions
       set stripe_checkout_session_id = coalesce(stripe_checkout_session_id, $2), updated_at = now()
       where stripe_subscription_id = $1`,
      [stripeSubscriptionId, sessionId],
    );
  }
}

/**
 * Fulfillment: mark the subscription active and grant PLAN_CREDITS exactly
 * once for this invoice — grant row, ledger entry, and wallet update in the
 * caller's transaction. Cancellation is never undone by a late paid event.
 */
async function applyInvoicePaid(
  client: PoolClient,
  invoice: Record<string, unknown>,
): Promise<void> {
  const invoiceId = str(invoice.id);
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  if (!invoiceId || !stripeSubscriptionId) return; // not a subscription invoice

  // Find the subscription row; create it if this event arrived before
  // checkout.session.completed (resolving the user from subscription
  // metadata, falling back to the Stripe customer id).
  let sub = await findByStripeSubscriptionId(client, stripeSubscriptionId);
  if (!sub) {
    const userId =
      invoiceUserId(invoice) ?? (await userIdByCustomer(client, str(invoice.customer)));
    if (!userId) {
      throw new Error(
        `invoice ${invoiceId}: cannot resolve a user for subscription ${stripeSubscriptionId}`,
      );
    }
    const { rows } = await client.query<Subscription>(
      `insert into subscriptions (user_id, stripe_subscription_id, status)
       values ($1, $2, 'pending')
       on conflict (stripe_subscription_id) do nothing
       returning ${SUBSCRIPTION_COLUMNS}`,
      [userId, stripeSubscriptionId],
    );
    sub = rows[0] ?? (await findByStripeSubscriptionId(client, stripeSubscriptionId));
    if (!sub) throw new Error(`invoice ${invoiceId}: subscription row vanished`);
  }

  // Paid ⇒ active, unless the subscription was already canceled (a late or
  // out-of-order paid event must not resurrect it — but it still grants).
  await client.query(
    `update subscriptions
     set status = case when status = 'canceled' then 'canceled' else 'active' end,
         updated_at = now()
     where id = $1`,
    [sub.id],
  );

  // Exactly-once grant per paid invoice: the unique constraint on
  // stripe_invoice_id is the anchor; ledger + wallet only move when the
  // grant row is new.
  const granted = await client.query(
    `insert into subscription_credit_grants (subscription_id, user_id, stripe_invoice_id, credits)
     values ($1, $2, $3, $4)
     on conflict (stripe_invoice_id) do nothing`,
    [sub.id, sub.user_id, invoiceId, PLAN_CREDITS],
  );
  if (granted.rowCount === 0) return;

  await client.query(
    `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta, note)
     values ($1, 'subscription_period_grant', $2, 0, $3)`,
    [sub.user_id, PLAN_CREDITS, `stripe invoice ${invoiceId}`],
  );
  await client.query(
    `update credit_wallets set available = available + $2, updated_at = now()
     where user_id = $1`,
    [sub.user_id, PLAN_CREDITS],
  );
}

/**
 * Status transitions driven by Stripe (payment failed, subscription deleted).
 * Never touches the wallet: a past-due or canceled subscription keeps every
 * credit already granted.
 */
async function applyStatusFromStripe(
  client: PoolClient,
  stripeSubscriptionId: string | null,
  status: "past_due" | "canceled",
  force = false,
): Promise<void> {
  if (!stripeSubscriptionId) return;
  await client.query(
    `update subscriptions
     set status = case when status = 'canceled' and not $3 then 'canceled' else $2 end,
         updated_at = now()
     where stripe_subscription_id = $1`,
    [stripeSubscriptionId, status, force],
  );
}

async function findByStripeSubscriptionId(
  client: PoolClient,
  stripeSubscriptionId: string,
): Promise<Subscription | null> {
  const { rows } = await client.query<Subscription>(
    `select ${SUBSCRIPTION_COLUMNS} from subscriptions where stripe_subscription_id = $1`,
    [stripeSubscriptionId],
  );
  return rows[0] ?? null;
}

async function userIdByCustomer(
  client: PoolClient,
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null;
  const { rows } = await client.query<{ id: string }>(
    `select id from users where stripe_customer_id = $1`,
    [customerId],
  );
  return rows[0]?.id ?? null;
}
