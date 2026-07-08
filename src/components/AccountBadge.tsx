"use client";

import { useEffect, useState } from "react";
import { fetchAccount } from "@/lib/server-generation";

type BadgeState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "signed-in"; name: string; credits: number };

/**
 * Signed-in indicator for the studio header: who you are and how many
 * credits you can spend. Anonymous visitors get a quiet sign-in link —
 * the hard sell only ever happens at the generation gate.
 */
export default function AccountBadge() {
  const [state, setState] = useState<BadgeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const account = await fetchAccount();
      if (cancelled) return;
      setState(
        account.status === "signed-in"
          ? { status: "signed-in", name: account.name ?? "Signed in", credits: account.credits }
          : { status: "anonymous" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return null;

  if (state.status === "anonymous") {
    return (
      <a
        href="/api/auth/login"
        className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium text-brand-bright ring-1 ring-line transition-colors hover:bg-surface-raised hover:text-ink"
      >
        Sign in
      </a>
    );
  }

  return (
    <p className="flex shrink-0 items-center gap-2 rounded-full bg-surface-raised py-1 pl-3.5 pr-1.5 text-sm ring-1 ring-line/60">
      <span className="max-w-[16ch] truncate font-medium">{state.name}</span>
      <span className="rounded-full bg-butter px-2.5 py-0.5 font-display text-xs text-butter-ink">
        {state.credits} credit{state.credits === 1 ? "" : "s"}
      </span>
      <a
        href="/api/auth/logout"
        className="rounded-full px-2 py-0.5 text-xs text-muted transition-colors hover:text-ink"
      >
        Sign out
      </a>
    </p>
  );
}
