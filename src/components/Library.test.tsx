import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Library from "./Library";

// The private library (issue #59): rewatch, download, share by link, delete.
// The component trusts only /api/library — the same authenticated surface
// the route tests cover.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const video = {
  id: "11111111-1111-4111-8111-111111111111",
  engineId: "wan-animate-fal",
  createdAt: "2026-07-01T10:00:00Z",
  completedAt: "2026-07-01T10:05:00Z",
  videoUrl: "/api/video/11111111-1111-4111-8111-111111111111",
  downloadUrl: "/api/video/11111111-1111-4111-8111-111111111111?download=1",
  shared: false,
  shareUrl: null,
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("lists the signed-in user's videos with playback and download", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ videos: [video] }));

  render(<Library />);

  const player = await screen.findByLabelText(/your generated dance video/i);
  expect(player.getAttribute("src")).toBe(video.videoUrl);
  const download = screen.getByRole("link", { name: /download/i });
  expect(download.getAttribute("href")).toBe(video.downloadUrl);
  expect(fetchMock).toHaveBeenCalledWith("/api/library");
});

test("a signed-out visitor is asked to sign in", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthenticated" }, 401));

  render(<Library />);

  expect(await screen.findByRole("link", { name: /sign in/i })).toBeDefined();
});

test("an empty library says so instead of showing nothing", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ videos: [] }));

  render(<Library />);

  expect(await screen.findByText(/no videos yet/i)).toBeDefined();
});

test("turning sharing on shows the share link; turning it off hides it", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse({ videos: [video] }));

  render(<Library />);
  const shareButton = await screen.findByRole("button", { name: /share/i });

  fetchMock.mockResolvedValueOnce(
    jsonResponse({ shared: true, shareUrl: "/v/22222222-2222-4222-8222-222222222222" }),
  );
  await user.click(shareButton);

  const shareLink = await screen.findByRole("link", { name: /open share link/i });
  expect(shareLink.getAttribute("href")).toBe("/v/22222222-2222-4222-8222-222222222222");
  expect(fetchMock).toHaveBeenCalledWith(`/api/generations/${video.id}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shared: true }),
  });

  fetchMock.mockResolvedValueOnce(jsonResponse({ shared: false, shareUrl: null }));
  await user.click(screen.getByRole("button", { name: /stop sharing/i }));

  await waitFor(() => {
    expect(screen.queryByRole("link", { name: /open share link/i })).toBeNull();
  });
});

test("deleting a video removes it from the library", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(jsonResponse({ videos: [video] }));

  render(<Library />);
  const deleteButton = await screen.findByRole("button", { name: /delete/i });

  fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
  await user.click(deleteButton);

  await waitFor(() => {
    expect(screen.queryByLabelText(/your generated dance video/i)).toBeNull();
  });
  expect(fetchMock).toHaveBeenCalledWith(`/api/generations/${video.id}`, { method: "DELETE" });
  expect(await screen.findByText(/no videos yet/i)).toBeDefined();
});
