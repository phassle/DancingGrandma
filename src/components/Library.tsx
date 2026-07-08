"use client";

import { useEffect, useState } from "react";
import type { LibraryVideoDto } from "@/app/api/library/dto";

type ViewState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "ready"; videos: LibraryVideoDto[] };

/**
 * The private library (issue #59, PRD #54): every Generated Dance Video the
 * signed-in user has paid for — rewatch, download, share by link, delete.
 * Videos are private by default; the share toggle mints (or revokes) the
 * unguessable /v/<slug> link server-side.
 */
export default function Library() {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/library");
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        if (res.ok) {
          const { videos } = (await res.json()) as { videos: LibraryVideoDto[] };
          if (!cancelled) setState({ status: "ready", videos });
        }
      } catch {
        // Transient failure — leave the loading state; a reload retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchVideo = (id: string, patch: Partial<LibraryVideoDto>) => {
    setState((prev) =>
      prev.status === "ready"
        ? { ...prev, videos: prev.videos.map((v) => (v.id === id ? { ...v, ...patch } : v)) }
        : prev,
    );
  };

  const toggleShare = async (video: LibraryVideoDto) => {
    const res = await fetch(`/api/generations/${video.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: !video.shared }),
    });
    if (!res.ok) return;
    const { shared, shareUrl } = (await res.json()) as { shared: boolean; shareUrl: string | null };
    patchVideo(video.id, { shared, shareUrl });
  };

  const deleteVideo = async (video: LibraryVideoDto) => {
    const res = await fetch(`/api/generations/${video.id}`, { method: "DELETE" });
    if (!res.ok) return;
    setState((prev) =>
      prev.status === "ready"
        ? { ...prev, videos: prev.videos.filter((v) => v.id !== video.id) }
        : prev,
    );
  };

  if (state.status === "loading") {
    return (
      <section aria-busy="true" className="mx-auto max-w-md p-8 text-center text-sm text-muted">
        Loading your videos&hellip;
      </section>
    );
  }

  if (state.status === "signed-out") {
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl bg-surface-raised p-8 text-center ring-1 ring-line">
        <h1 className="font-display text-2xl">Your library</h1>
        <p className="text-sm text-muted">Sign in to see the videos you&apos;ve generated.</p>
        <a
          href="/api/auth/login"
          className="rounded-full bg-butter px-5 py-2 font-medium text-butter-ink transition-colors hover:brightness-95"
        >
          Sign in
        </a>
      </section>
    );
  }

  if (state.videos.length === 0) {
    return (
      <section className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl bg-surface-raised p-8 text-center ring-1 ring-line">
        <h1 className="font-display text-2xl">Your library</h1>
        <p className="text-sm text-muted">No videos yet — your finished dances will land here.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-2xl">Your library</h1>
      <ul className="grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2">
        {state.videos.map((video) => (
          <li
            key={video.id}
            className="flex flex-col gap-3 rounded-3xl bg-bg-deep p-3 shadow-[var(--shadow-float)] ring-1 ring-line"
          >
            <div className="relative aspect-[9/16] overflow-hidden rounded-[1.25rem] bg-black">
              <video
                src={video.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
                aria-label="Your generated dance video"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a
                href={video.downloadUrl}
                download
                className="rounded-full px-4 py-1.5 font-medium text-brand-bright ring-1 ring-line transition-colors hover:bg-surface hover:text-ink"
              >
                Download
              </a>
              <button
                type="button"
                onClick={() => void toggleShare(video)}
                className="rounded-full px-4 py-1.5 font-medium ring-1 ring-line transition-colors hover:bg-surface"
              >
                {video.shared ? "Stop sharing" : "Share"}
              </button>
              <button
                type="button"
                onClick={() => void deleteVideo(video)}
                className="rounded-full px-4 py-1.5 font-medium text-muted ring-1 ring-line transition-colors hover:bg-surface hover:text-ink"
              >
                Delete
              </button>
            </div>
            {video.shared && video.shareUrl ? (
              <a
                href={video.shareUrl}
                className="truncate text-xs text-muted underline underline-offset-4 transition-colors hover:text-ink"
                aria-label="Open share link"
              >
                {video.shareUrl}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
