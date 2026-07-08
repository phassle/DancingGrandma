"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SubscriptionState = {
  subscription: { status: "pending" | "active" | "past_due" | "canceled" } | null;
  wallet: { available: number; reserved: number };
};

type ViewState =
  | { status: "finalizing" }
  | { status: "active"; credits: number }
  | { status: "signed-out" };

const POLL_INTERVAL_MS = 1500;

/** Cancellation is self-service: hand the browser to the Stripe Customer Portal. */
async function openCustomerPortal() {
  const res = await fetch("/api/billing/portal", { method: "POST" });
  if (!res.ok) return;
  const { url } = (await res.json()) as { url: string };
  window.location.assign(url);
}

/**
 * After Stripe Checkout redirects here, the backend is the only truth:
 * this polls /api/billing/subscription until the webhook has marked the
 * subscription active and granted the credits. You paid securely with
 * Stripe — the page just refuses to celebrate before the money is real.
 */
export default function CheckoutSuccess() {
  const [state, setState] = useState<ViewState>({ status: "finalizing" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch("/api/billing/subscription");
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        if (res.ok) {
          const body = (await res.json()) as SubscriptionState;
          if (cancelled) return;
          if (body.subscription?.status === "active") {
            setState({ status: "active", credits: body.wallet.available });
            return;
          }
        }
      } catch {
        // Transient failure — keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (state.status === "signed-out") {
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl bg-surface-raised p-8 text-center ring-1 ring-line">
        <h1 className="font-display text-2xl">Almost there</h1>
        <p className="text-sm text-muted">
          Your payment went through Stripe, but this browser isn&apos;t signed in. Sign in to see
          your subscription and credits.
        </p>
        <a
          href="/api/auth/login"
          className="rounded-full bg-butter px-5 py-2 font-medium text-butter-ink transition-colors hover:brightness-95"
        >
          Sign in
        </a>
      </section>
    );
  }

  if (state.status === "active") {
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl bg-surface-raised p-8 text-center ring-1 ring-line">
        <h1 className="font-display text-2xl">You&apos;re subscribed!</h1>
        <p className="text-sm text-muted">
          Payment confirmed with Stripe. Your monthly plan is active and your wallet is topped up.
        </p>
        <p className="rounded-full bg-butter px-4 py-1.5 font-display text-butter-ink">
          {state.credits} credits ready
        </p>
        <Link
          href="/"
          className="rounded-full px-5 py-2 text-sm font-medium text-brand-bright ring-1 ring-line transition-colors hover:bg-surface hover:text-ink"
        >
          Back to the studio
        </Link>
        <button
          type="button"
          onClick={openCustomerPortal}
          className="text-xs text-muted underline underline-offset-4 transition-colors hover:text-ink"
        >
          Manage subscription
        </button>
      </section>
    );
  }

  return (
    <section
      aria-busy="true"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl bg-surface-raised p-8 text-center ring-1 ring-line"
    >
      <h1 className="font-display text-2xl">Finalizing your subscription&hellip;</h1>
      <p className="text-sm text-muted">
        Stripe has your payment. We&apos;re waiting for the confirmation to land — this usually
        takes a few seconds.
      </p>
    </section>
  );
}
