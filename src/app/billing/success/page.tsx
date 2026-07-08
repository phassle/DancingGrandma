import type { Metadata } from "next";
import Link from "next/link";
import CheckoutSuccess from "@/components/CheckoutSuccess";

export const metadata: Metadata = {
  title: "Subscription — DancingGrandma",
};

/**
 * Landing page after Stripe Checkout. Purely presentational — the client
 * component polls the backend until the webhook has granted the credits,
 * so this page can never show credits that aren't real yet.
 */
export default function BillingSuccessPage() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-6">
        <Link href="/" className="font-display text-xl sm:text-2xl">
          Dancing<span className="text-butter">Grandma</span>
        </Link>
      </header>
      <div className="flex flex-1 items-center px-4 py-12 sm:px-6">
        <CheckoutSuccess />
      </div>
    </main>
  );
}
