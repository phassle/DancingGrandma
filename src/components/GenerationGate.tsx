"use client";

import { useEffect, useRef } from "react";

type GenerationGateProps = {
  open: boolean;
  /** True while the draft is being stashed before the sign-in redirect. */
  busy?: boolean;
  onContinue: () => void;
  onDismiss: () => void;
};

/**
 * The generation gate (issue #58, PRD #54): the account, credit, and payment
 * boundary shown only when a visitor clicks "Start generation". It floats
 * over the dimmed, blurred studio so the prepared draft stays visible, states
 * the deal plainly, and always offers an honest way back to the draft.
 */
export default function GenerationGate({
  open,
  busy = false,
  onContinue,
  onDismiss,
}: GenerationGateProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm"
      onClick={busy ? undefined : onDismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generation-gate-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onDismiss();
        }}
        className="w-full max-w-md animate-pop-in rounded-3xl bg-surface p-6 shadow-[var(--shadow-float)] ring-1 ring-line outline-none sm:p-8"
      >
        <h3 id="generation-gate-title" className="font-display text-2xl sm:text-3xl">
          Save her big debut
        </h3>
        <p className="mt-3 text-ink">
          Create an account to save your video. Generation uses 1 credit. The monthly plan is
          $9.99 and includes 5 credits.
        </p>
        <p className="mt-3 text-sm text-muted">
          Your photo and clip stay in this browser until you&apos;re signed in — nothing has been
          uploaded yet, and your draft is waiting right behind this card.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="rounded-full bg-go px-7 py-3 font-display text-lg text-ink shadow-[var(--shadow-pop)] transition-transform enabled:hover:-translate-y-0.5 enabled:hover:bg-go-hover disabled:cursor-wait disabled:opacity-70"
          >
            {busy ? "Saving your draft…" : "Create account or sign in"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
          >
            Not now — keep my draft
          </button>
        </div>
      </div>
    </div>
  );
}
