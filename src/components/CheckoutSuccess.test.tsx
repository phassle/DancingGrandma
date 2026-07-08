import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CheckoutSuccess from "./CheckoutSuccess";

// The success page never trusts the redirect from Stripe: it polls
// /api/billing/subscription until the webhook has really granted credits.

function subscriptionResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Advance fake time and flush the resulting fetches and state updates. */
async function elapse(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

test("shows a finalizing state — never credits — while the webhook has not landed", async () => {
  fetchMock.mockResolvedValue(
    subscriptionResponse({
      subscription: { status: "pending" },
      wallet: { available: 0, reserved: 0 },
    }),
  );

  render(<CheckoutSuccess />);
  await elapse();

  expect(screen.getByText(/finalizing your subscription/i)).toBeDefined();
  expect(screen.queryByText(/credits/i)).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith("/api/billing/subscription");
});

test("keeps polling until the subscription is active, then shows the granted credits", async () => {
  fetchMock
    .mockResolvedValueOnce(
      subscriptionResponse({
        subscription: { status: "pending" },
        wallet: { available: 0, reserved: 0 },
      }),
    )
    .mockResolvedValueOnce(
      subscriptionResponse({
        subscription: { status: "active" },
        wallet: { available: 5, reserved: 0 },
      }),
    );

  render(<CheckoutSuccess />);
  await elapse();
  expect(screen.getByText(/finalizing your subscription/i)).toBeDefined();

  await elapse(2000);

  expect(screen.getByText(/you're subscribed/i)).toBeDefined();
  expect(screen.getByText(/5 credits/i)).toBeDefined();

  // Active is terminal — no further polls.
  const callsAfterActive = fetchMock.mock.calls.length;
  await elapse(5000);
  expect(fetchMock.mock.calls.length).toBe(callsAfterActive);
});

test("the subscribed state links to the Stripe Customer Portal for self-service cancellation", async () => {
  fetchMock.mockResolvedValueOnce(
    subscriptionResponse({
      subscription: { status: "active" },
      wallet: { available: 5, reserved: 0 },
    }),
  );

  render(<CheckoutSuccess />);
  await elapse();

  fetchMock.mockResolvedValueOnce(
    subscriptionResponse({ url: "https://billing.stripe.com/p/session/test_1" }),
  );
  screen.getByRole("button", { name: /manage subscription/i }).click();
  await elapse();

  expect(fetchMock).toHaveBeenCalledWith("/api/billing/portal", { method: "POST" });
});

test("a signed-out visitor is asked to sign in instead of polling forever", async () => {
  fetchMock.mockResolvedValue(subscriptionResponse({ error: "unauthenticated" }, 401));

  render(<CheckoutSuccess />);
  await elapse();

  expect(screen.getByRole("link", { name: /sign in/i })).toBeDefined();
  await elapse(5000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
