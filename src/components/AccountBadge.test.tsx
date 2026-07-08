import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import AccountBadge from "./AccountBadge";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

test("offers sign-in when the visitor is anonymous", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }));

  render(<AccountBadge />);

  const link = await screen.findByRole("link", { name: /sign in/i });
  expect(link).toHaveProperty("href", expect.stringContaining("/api/auth/login"));
  expect(fetchMock).toHaveBeenCalledWith("/api/me");
});

test("shows the signed-in user and their credit balance", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        user: { id: "u1", email: "grandma@example.com", displayName: "Dancing Grandma" },
        wallet: { available: 5, reserved: 0 },
      }),
      { status: 200 },
    ),
  );

  render(<AccountBadge />);

  expect(await screen.findByText("Dancing Grandma")).toBeDefined();
  expect(screen.getByText("5 credits")).toBeDefined();
  expect(screen.getByRole("link", { name: /sign out/i })).toHaveProperty(
    "href",
    expect.stringContaining("/api/auth/logout"),
  );
});

test("falls back to the email and singular credit copy", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        user: { id: "u1", email: "grandma@example.com", displayName: null },
        wallet: { available: 1, reserved: 0 },
      }),
      { status: 200 },
    ),
  );

  render(<AccountBadge />);

  expect(await screen.findByText("grandma@example.com")).toBeDefined();
  expect(screen.getByText("1 credit")).toBeDefined();
});

test("treats a failed balance lookup as anonymous", async () => {
  fetchMock.mockRejectedValue(new TypeError("network down"));

  render(<AccountBadge />);

  expect(await screen.findByRole("link", { name: /sign in/i })).toBeDefined();
});
