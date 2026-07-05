"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GrandmaDancer from "./GrandmaDancer";
import { DEFAULT_ENGINE, ENGINES, type Engine } from "@/lib/engines";
import { GenerationError, submitDanceVideo, trackDanceVideo } from "@/lib/generate";

type Step = "photo" | "dance" | "generating" | "done" | "closed";

type Dance = {
  id: string;
  name: string;
  emoji: string;
  bpm: number;
  spice: 1 | 2 | 3;
  blurb: string;
  /** Local reference video under public/ — when the file exists, this dance
   * renders for real instead of simulating. See public/dances/README.md. */
  referenceClip?: string;
};

const DANCES: Dance[] = [
  { id: "griddy", name: "The Griddy", emoji: "🏈", bpm: 140, spice: 2, blurb: "Arms pumping, knees flying. Touchdown energy.", referenceClip: "/dances/griddy.mp4" },
  { id: "renegade", name: "Renegade", emoji: "🔥", bpm: 128, spice: 3, blurb: "The classic. Eight counts of pure chaos.", referenceClip: "/dances/renegade.mp4" },
  { id: "macarena", name: "Macarena Redux", emoji: "🙌", bpm: 103, spice: 1, blurb: "She already knows this one. Trust.", referenceClip: "/dances/macarena.mp4" },
  { id: "disco", name: "Disco Inferno", emoji: "🪩", bpm: 118, spice: 2, blurb: "Point up, point down, own the room.", referenceClip: "/dances/disco.mp4" },
  { id: "woah", name: "The Woah", emoji: "🎯", bpm: 145, spice: 2, blurb: "One move. Perfectly timed. Devastating.", referenceClip: "/dances/woah.mp4" },
];

// Fetched reference clips, cached per path so a retry reuses the same File
// (and the seam's upload memoization keeps holding).
const clipFiles = new Map<string, Promise<File>>();

function referenceClipFile(path: string): Promise<File> {
  let file = clipFiles.get(path);
  if (!file) {
    file = fetch(path)
      .then((res) => res.arrayBuffer())
      .then((buf) => new File([buf], path.split("/").pop()!, { type: "video/mp4" }));
    clipFiles.set(path, file);
    file.catch(() => clipFiles.delete(path));
  }
  return file;
}

const GENERATION_STAGES = [
  "Studying the choreography…",
  "Teaching grandma the moves…",
  "Warming up the hips…",
  "Syncing to the beat…",
  "Adding disco lighting…",
  "Final dress rehearsal…",
];

const MAX_PHOTO_MB = 10;
const PENDING_RUN_KEY = "dg:pending-run";
const PENDING_RUN_TTL_MS = 24 * 60 * 60 * 1000;

type PendingRun = {
  requestId: string;
  engineId: string;
  danceName: string;
  startedAt: number;
};

function parsePendingRun(raw: string | null): PendingRun | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingRun>;
    if (
      typeof parsed.requestId !== "string" ||
      typeof parsed.engineId !== "string" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }
    return {
      requestId: parsed.requestId,
      engineId: parsed.engineId,
      danceName: typeof parsed.danceName === "string" ? parsed.danceName : "Custom dance",
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function SpiceMeter({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span aria-label={`Spice level ${level} of 3`} role="img" className="text-sm">
      {"🌶️".repeat(level)}
      <span className="opacity-25">{"🌶️".repeat(3 - level)}</span>
    </span>
  );
}

export default function Studio() {
  const [step, setStep] = useState<Step>("photo");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dance, setDance] = useState<Dance | null>(null);
  const [customVideo, setCustomVideo] = useState<File | null>(null);
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [importing, setImporting] = useState(false);
  const [danceError, setDanceError] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>(DEFAULT_ENGINE);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [resultDanceName, setResultDanceName] = useState<string | null>(null);
  const [resultIsGoldenClip, setResultIsGoldenClip] = useState(false);

  // Curated dances whose reference clip actually exists under public/dances/.
  const [liveClipIds, setLiveClipIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const checks = await Promise.all(
        DANCES.filter((d) => d.referenceClip).map(async (d) => {
          try {
            const res = await fetch(d.referenceClip!, { method: "HEAD" });
            return res.ok ? d.id : null;
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) setLiveClipIds(new Set(checks.filter((id) => id !== null)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Real generation runs when there's a reference clip to hand the engine —
  // the user's own upload or link, or a curated dance whose bundled clip
  // exists — and the chosen engine has a wired adapter. Everything else
  // simulates. Link clips are only wired for Wan.
  const danceHasLiveClip = dance !== null && liveClipIds.has(dance.id);
  const isRealRun =
    pendingRun !== null ||
    ((customVideo !== null || customUrl !== null || danceHasLiveClip) &&
      Boolean(engine.endpoint));
  const [stageIndex, setStageIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Move focus to the step heading on step changes (not on initial page load)
  // so keyboard/screen-reader users follow along
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: false });
  }, [step]);

  useEffect(() => {
    const stored = parsePendingRun(localStorage.getItem(PENDING_RUN_KEY));
    if (!stored || Date.now() - stored.startedAt > PENDING_RUN_TTL_MS) {
      localStorage.removeItem(PENDING_RUN_KEY);
      return;
    }
    const storedEngine = ENGINES.find((e) => e.id === stored.engineId);
    if (!storedEngine?.endpoint) {
      localStorage.removeItem(PENDING_RUN_KEY);
      return;
    }
    const resumeTimer = window.setTimeout(() => {
      setPendingRun(stored);
      setGenerationStartedAt(stored.startedAt);
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - stored.startedAt) / 1000)));
      setResultDanceName(stored.danceName);
      setEngine(storedEngine);
      setStep("generating");
    }, 0);
    return () => window.clearTimeout(resumeTimer);
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (step !== "generating" || !isRealRun || !generationStartedAt) return;
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [generationStartedAt, isRealRun, step]);

  useEffect(() => {
    if (step !== "generating" || !isRealRun) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isRealRun, step]);

  useEffect(() => {
    if (step !== "generating") return;
    const stageTimer = setInterval(() => {
      setStageIndex((i) => (i + 1) % GENERATION_STAGES.length);
    }, 1600);

    if (!isRealRun) {
      const doneTimer = setTimeout(() => setStep("done"), 6800);
      return () => {
        clearInterval(stageTimer);
        clearTimeout(doneTimer);
      };
    }

    let cancelled = false;
    let activeEngineForRun = engine;
    (async () => {
      try {
        const activeEngine =
          pendingRun !== null
            ? (ENGINES.find((e) => e.id === pendingRun.engineId) ?? engine)
            : engine;
        activeEngineForRun = activeEngine;
        const requestId =
          pendingRun?.requestId ??
          (await (async () => {
            const referenceVideo =
              customVideo ?? customUrl ?? (await referenceClipFile(dance!.referenceClip!));
            const id = await submitDanceVideo(photoFile!, referenceVideo, activeEngine);
            const run = {
              requestId: id,
              engineId: activeEngine.id,
              danceName: dance?.name ?? customVideo?.name ?? "Custom dance",
              startedAt: generationStartedAt ?? Date.now(),
            };
            localStorage.setItem(PENDING_RUN_KEY, JSON.stringify(run));
            if (!cancelled) {
              setPendingRun(run);
              setResultDanceName(run.danceName);
            }
            return id;
          })());
        const url = await trackDanceVideo(requestId, activeEngine, (msg) => {
          if (!cancelled) setGenStatus(msg);
        });
        if (!cancelled) {
          localStorage.removeItem(PENDING_RUN_KEY);
          setPendingRun(null);
          setResultUrl(url);
          setResultIsGoldenClip(false);
          setStep("done");
          setGenerationStartedAt(null);
        }
      } catch (err) {
        if (!cancelled) {
          localStorage.removeItem(PENDING_RUN_KEY);
          setPendingRun(null);
          setGenerationStartedAt(null);
          if (err instanceof GenerationError && err.kind === "unavailable") {
            if (activeEngineForRun.goldenClip) {
              setResultUrl(activeEngineForRun.goldenClip);
              setResultIsGoldenClip(true);
              setStep("done");
            } else {
              setStep("closed");
            }
          } else {
            setGenError(
              err instanceof GenerationError && err.kind === "timeout"
                ? "That render took too long — the floor was packed. Your photo and clip are still loaded, so just try again."
                : err instanceof Error
                  ? `The engine tripped over its own feet: ${err.message}. Your photo and clip are still loaded — try again.`
                  : "Something went wrong on the dance floor. Try again.",
            );
            setStep("dance");
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(stageTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inputs are frozen when the run starts
  }, [step]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const acceptPhoto = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("That's not a photo. Grandma deserves a real picture — JPG, PNG or WebP.");
      return;
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      setPhotoError(`That photo is over ${MAX_PHOTO_MB} MB. Pick a smaller one — her moves are big enough already.`);
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPhotoUrl(url);
    setPhotoFile(file);
    setPhotoName(file.name);
    setPhotoError(null);
  }, []);

  const acceptDanceVideo = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && file.type !== "image/gif") {
      setDanceError("That's not a video. MP4, MOV, WebM, M4V or GIF of the dance, please.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setDanceError("That clip is over 100 MB. Trim it down — 10–30 seconds is the sweet spot.");
      return;
    }
    setCustomVideo(file);
    setCustomUrl(null);
    setDance(null);
    setDanceError(null);
    setGenError(null);
  };

  const acceptDanceUrl = async (raw: string) => {
    const trimmed = raw.trim();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      setDanceError("That link doesn't look like a URL. Paste a video link or a direct file link.");
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      setDanceError("That link doesn't look like a URL. Paste a video link or a direct file link.");
      return;
    }

    // A direct video file goes straight to the engine (fal fetches it
    // server-side). Anything else is a page — hand it to the importer, which
    // downloads and transcodes it into a clip we can upload.
    if (/\.(mp4|mov|webm|m4v|gif)($|\?)/i.test(url.pathname)) {
      setCustomUrl(trimmed);
      setCustomVideo(null);
      setDance(null);
      setDanceError(null);
      setGenError(null);
      // Link clips are only wired for Wan — snap back if another engine was picked.
      setEngine(DEFAULT_ENGINE);
      return;
    }

    setImporting(true);
    setDanceError(null);
    setGenError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!res.ok) {
        const detail = await res
          .json()
          .then((b) => (b as { error?: string }).error)
          .catch(() => null);
        throw new Error(detail || `import failed (${res.status})`);
      }
      const name = decodeURIComponent(res.headers.get("X-Clip-Name") || "imported-clip.mp4");
      const blob = await res.blob();
      acceptDanceVideo(new File([blob], name, { type: "video/mp4" }));
    } catch (err) {
      setDanceError(
        `Couldn't import that link: ${err instanceof Error ? err.message : "unknown error"}. Try another link, or save the video and drop the file here instead.`,
      );
    } finally {
      setImporting(false);
    }
  };

  // On the dance step, ⌘V works too: a copied video file loads directly,
  // copied text goes through the link path.
  useEffect(() => {
    if (step !== "dance") return;
    const onPaste = (e: Event) => {
      const clipboard = (e as ClipboardEvent).clipboardData;
      const file = clipboard?.files?.[0];
      if (file) {
        acceptDanceVideo(file);
        return;
      }
      const text = clipboard?.getData("text");
      if (text?.trim()) acceptDanceUrl(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accept* handlers only touch stable setters
  }, [step]);

  const reset = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setPhotoUrl(null);
    setPhotoFile(null);
    setPhotoName(null);
    setPhotoError(null);
    setDance(null);
    setCustomVideo(null);
    setCustomUrl(null);
    setUrlDraft("");
    setDanceError(null);
    setGenStatus(null);
    setGenError(null);
    setResultUrl(null);
    setPendingRun(null);
    setGenerationStartedAt(null);
    setElapsedSeconds(0);
    setResultDanceName(null);
    setResultIsGoldenClip(false);
    localStorage.removeItem(PENDING_RUN_KEY);
    setStep("photo");
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        resultUrl ?? "https://dancinggrandma.example/v/grandma-goes-viral",
      );
      setToast(
        resultUrl
          ? "Video link copied. The group chat is not ready. 💃"
          : "Demo link copied — real links arrive with real renders. 💃",
      );
    } catch {
      setToast("Couldn't reach the clipboard — copy the URL from the address bar instead.");
    }
  };

  const stepNumber = step === "photo" ? 1 : step === "dance" ? 2 : 3;

  return (
    <section id="studio" aria-labelledby="studio-title" className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
      <div className="rounded-[2rem] bg-surface shadow-[var(--shadow-float)] ring-1 ring-line/60 overflow-hidden">
        {/* Studio header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line/60 bg-bg-deep/40 px-6 py-5 sm:px-10">
          <h2 id="studio-title" className="font-display text-2xl sm:text-3xl">
            The Dance Studio
          </h2>
          <ol className="flex items-center gap-2 text-sm font-medium" aria-label="Progress">
            {(["Photo", "Dance", "Showtime"] as const).map((label, i) => {
              const active = stepNumber === i + 1;
              const complete = stepNumber > i + 1;
              return (
                <li
                  key={label}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
                    active
                      ? "bg-butter text-butter-ink"
                      : complete
                        ? "text-brand-bright"
                        : "text-muted"
                  }`}
                >
                  <span aria-hidden="true">{complete ? "✓" : i + 1}</span>
                  {label}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="px-6 py-10 sm:px-10 sm:py-12">
          {/* STEP 1 — PHOTO */}
          {step === "photo" && (
            <div className="animate-pop-in">
              <h3 ref={headingRef} tabIndex={-1} className="font-display text-3xl sm:text-4xl outline-none">
                Who&apos;s the star?
              </h3>
              <p className="mt-2 max-w-[55ch] text-muted">
                Upload one clear photo — face and a bit of body works best. Grandma, grandpa,
                your landlord. Anyone who deserves the spotlight.
              </p>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  acceptPhoto(e.dataTransfer.files[0]);
                }}
                className={`mt-8 rounded-3xl border-2 border-dashed p-8 sm:p-12 text-center transition-colors ${
                  dragging ? "border-butter bg-butter/10" : "border-line bg-bg-deep/30"
                }`}
              >
                {photoUrl ? (
                  <div className="flex flex-col items-center gap-5">
                    <figure className="rotate-[-3deg] rounded-md bg-ink p-3 pb-10 shadow-[var(--shadow-float)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                      <img
                        src={photoUrl}
                        alt={`Your uploaded photo${photoName ? `: ${photoName}` : ""}`}
                        className="h-48 w-40 rounded-sm object-cover"
                      />
                      <figcaption className="mt-3 font-display text-sm text-bg-deep">the legend</figcaption>
                    </figure>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-sm font-medium text-brand-bright underline underline-offset-4 hover:text-ink"
                    >
                      Swap the photo
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <span aria-hidden="true" className="text-5xl">📸</span>
                    <p className="font-medium">Drag a photo here, or</p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-full bg-go px-7 py-3 font-display text-lg text-ink shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5 hover:bg-go-hover active:translate-y-0"
                    >
                      Choose a photo
                    </button>
                    <p className="text-sm text-muted">JPG, PNG or WebP · up to {MAX_PHOTO_MB} MB</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="Upload a photo of the star"
                  onChange={(e) => acceptPhoto(e.target.files?.[0])}
                />
              </div>

              {photoError && (
                <p role="alert" className="mt-4 rounded-xl bg-go/15 px-4 py-3 text-sm font-medium text-ink">
                  ⚠️ {photoError}
                </p>
              )}

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  disabled={!photoUrl}
                  onClick={() => setStep("dance")}
                  className="rounded-full bg-butter px-8 py-3 font-display text-lg text-butter-ink shadow-[var(--shadow-pop)] transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Pick her dance →
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — DANCE */}
          {step === "dance" && (
            <div className="animate-pop-in">
              <h3 ref={headingRef} tabIndex={-1} className="font-display text-3xl sm:text-4xl outline-none">
                Pick the choreography
              </h3>
              <p className="mt-2 max-w-[55ch] text-muted">
                This week&apos;s most-requested dances. The music comes along for free.
              </p>

              <fieldset className="mt-8">
                <legend className="sr-only">Choose a dance</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {DANCES.map((d) => {
                    const selected = dance?.id === d.id;
                    return (
                      <label
                        key={d.id}
                        className={`flex cursor-pointer items-start gap-4 rounded-2xl p-4 ring-2 transition-all ${
                          selected
                            ? "bg-butter text-butter-ink ring-butter"
                            : "bg-bg-deep/40 ring-transparent hover:ring-line"
                        }`}
                      >
                        <input
                          type="radio"
                          name="dance"
                          value={d.id}
                          checked={selected}
                          onChange={() => {
                            setDance(d);
                            setCustomVideo(null);
                            setCustomUrl(null);
                          }}
                          className="sr-only"
                        />
                        <span aria-hidden="true" className="text-3xl">{d.emoji}</span>
                        <span className="flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-display text-xl">
                              {d.name}
                              {liveClipIds.has(d.id) && (
                                <span className={`ml-2 rounded-full px-2 py-0.5 align-middle font-sans text-xs font-bold ${selected ? "bg-butter-ink/15" : "bg-brand/40 text-brand-bright"}`}>
                                  real render
                                </span>
                              )}
                            </span>
                            <SpiceMeter level={d.spice} />
                          </span>
                          <span className={`mt-1 block text-sm ${selected ? "text-butter-ink/80" : "text-muted"}`}>
                            {d.blurb} · {d.bpm} BPM
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      acceptDanceVideo(e.dataTransfer.files[0]);
                    }}
                    className={`rounded-2xl border border-dashed p-4 transition-colors sm:col-span-2 ${
                      customVideo || customUrl
                        ? "border-butter bg-butter/10 text-ink"
                        : "border-line text-muted hover:border-muted"
                    }`}
                  >
                    <label className="flex cursor-pointer items-center gap-4">
                      <span aria-hidden="true" className="text-3xl">🎬</span>
                      <span className="text-sm">
                        <span className="font-medium text-ink">
                          {customVideo
                            ? `“${customVideo.name}” loaded`
                            : customUrl
                              ? "Link loaded"
                              : "Got your own dance video?"}
                        </span>{" "}
                        {customVideo || customUrl
                          ? "— this clip's moves (and music) go to the real generator."
                          : "Drag a clip here, pick a file, paste one (⌘V), or drop a link below — a file link, or a YouTube/TikTok page we'll download for you (MP4, MOV, WebM, M4V or GIF, 10–30 s)."}
                      </span>
                      <input
                        type="file"
                        accept="video/*,image/gif"
                        className="sr-only"
                        aria-label="Upload your own reference dance video"
                        onChange={(e) => acceptDanceVideo(e.target.files?.[0])}
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        type="url"
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        disabled={importing}
                        aria-label="Paste a video link"
                        placeholder="https:// — video file, or a YouTube / TikTok link"
                        className="min-w-0 flex-1 rounded-full bg-bg-deep/60 px-4 py-2 text-sm text-ink ring-1 ring-line placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-butter disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => acceptDanceUrl(urlDraft)}
                        disabled={importing || !urlDraft.trim()}
                        aria-live="polite"
                        className="rounded-full bg-surface-raised px-5 py-2 text-sm font-medium text-ink ring-1 ring-line transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-50"
                      >
                        {importing ? "Importing…" : "Use this link"}
                      </button>
                    </div>
                  </div>
                </div>
              </fieldset>

              {/* Engine picker — Wan is the default; more engines join over time */}
              <fieldset className="mt-10">
                <legend className="font-display text-xl">Pick the engine</legend>
                <p className="mt-1 text-sm text-muted">
                  Same grandma, different AI under the hood. We default to the best one.
                </p>
                <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Video generation engine">
                  {ENGINES.map((e) => {
                    const selected = engine.id === e.id;
                    // Link clips are only wired for Wan; a pasted link pins the engine.
                    const soon =
                      e.status === "coming-soon" ||
                      (customUrl !== null && e.id !== DEFAULT_ENGINE.id);
                    return (
                      <label
                        key={e.id}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ring-2 transition-all ${
                          soon
                            ? "cursor-not-allowed text-muted/60 ring-line/40"
                            : selected
                              ? "cursor-pointer bg-butter text-butter-ink ring-butter"
                              : "cursor-pointer bg-bg-deep/40 ring-transparent hover:ring-line"
                        }`}
                      >
                        <input
                          type="radio"
                          name="engine"
                          value={e.id}
                          checked={selected}
                          disabled={soon}
                          onChange={() => setEngine(e)}
                          className="sr-only"
                        />
                        {e.name}
                        {e.status === "recommended" && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${selected ? "bg-butter-ink/15" : "bg-brand/40 text-brand-bright"}`}>
                            our pick
                          </span>
                        )}
                        {soon && (
                          <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs">soon</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 text-sm text-muted" aria-live="polite">
                  <span className="font-bold text-ink">{engine.name}</span> ({engine.vendor}) ·{" "}
                  {engine.pricing} ·{" "}
                  {engine.carriesAudio
                    ? "carries reference audio"
                    : "reference audio added after generation"}{" "}
                  · max length: {engine.maxDuration}
                  <span className="mt-1 block text-xs text-muted">{engine.howWired}</span>
                </p>
              </fieldset>

              {(danceError || genError) && (
                <p role="alert" className="mt-4 rounded-xl bg-go/15 px-4 py-3 text-sm font-medium text-ink">
                  ⚠️ {danceError ?? genError}
                </p>
              )}

              <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setStep("photo")}
                  className="font-medium text-muted underline underline-offset-4 hover:text-ink"
                >
                  ← Back to the photo
                </button>
                <button
                  type="button"
                  disabled={!dance && !customVideo && !customUrl}
                  onClick={() => {
                    setStageIndex(0);
                    setGenError(null);
                    setGenStatus(null);
                    setElapsedSeconds(0);
                    setResultUrl(null);
                    setResultIsGoldenClip(false);
                    setGenerationStartedAt(Date.now());
                    setResultDanceName(dance?.name ?? customVideo?.name ?? "Custom dance");
                    setStep("generating");
                  }}
                  className="rounded-full bg-go px-9 py-3.5 font-display text-xl text-ink shadow-[var(--shadow-pop)] transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Make her dance 💃
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — GENERATING */}
          {step === "generating" && (
            <div className="animate-pop-in flex flex-col items-center py-6 text-center">
              <h3 ref={headingRef} tabIndex={-1} className="font-display text-3xl sm:text-4xl outline-none">
                Hold my knitting.
              </h3>
              <div className="mt-8 w-44">
                <GrandmaDancer className="w-full" title="Grandma rehearsing her dance" />
              </div>
              <p aria-live="polite" className="mt-6 min-h-[1.75rem] font-medium text-brand-bright">
                {isRealRun && genStatus ? genStatus : GENERATION_STAGES[stageIndex]}
              </p>
              <p className="mt-1 text-sm text-muted">
                Rendering on {engine.name}
                {isRealRun ? " — a real run can take a few minutes" : ""}
              </p>
              {isRealRun && (
                <p className="mt-1 text-sm font-medium text-ink">
                  Elapsed: {formatElapsed(elapsedSeconds)}
                </p>
              )}
              <div
                role="progressbar"
                aria-label="Generating the video"
                aria-valuemin={0}
                aria-valuemax={GENERATION_STAGES.length}
                aria-valuenow={isRealRun ? undefined : stageIndex + 1}
                className="mt-4 h-3 w-full max-w-sm overflow-hidden rounded-full bg-bg-deep"
              >
                <div
                  className={`h-full rounded-full bg-butter transition-[width] duration-700 ease-out ${
                    isRealRun ? "animate-pulse" : ""
                  }`}
                  style={{
                    width: isRealRun
                      ? "100%"
                      : `${((stageIndex + 1) / GENERATION_STAGES.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* PROVIDER UNAVAILABLE — the dance floor is closed */}
          {step === "closed" && (
            <div className="animate-pop-in flex flex-col items-center py-6 text-center">
              <h3 ref={headingRef} tabIndex={-1} className="font-display text-3xl sm:text-4xl outline-none">
                The dance floor is closed 🪩
              </h3>
              <p className="mt-3 max-w-[45ch] text-muted">
                Our engine room ran out of juice mid-party. We&apos;re topping it up —
                back soon. Your photo and clip are safe right here.
              </p>
              <div className="mt-8 w-44 opacity-60">
                <GrandmaDancer className="w-full" title="Grandma waiting for the dance floor to reopen" />
              </div>
              <button
                type="button"
                onClick={() => setStep("dance")}
                className="mt-8 rounded-full bg-butter px-8 py-3 font-display text-lg text-butter-ink shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5"
              >
                Back to the studio
              </button>
            </div>
          )}

          {/* STEP 4 — DONE */}
          {step === "done" && (
            <div className="animate-pop-in">
              <h3 ref={headingRef} tabIndex={-1} className="font-display text-3xl sm:text-4xl outline-none">
                She ate. 🔥
              </h3>
              <p className="mt-2 max-w-[55ch] text-muted">
                {resultDanceName || dance
                  ? `“${resultDanceName ?? dance!.name}” — performed flawlessly on the first take.`
                  : "Performed flawlessly on the first take."}
              </p>

              <div className="mt-8 flex flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-center">
                {/* 9:16 phone preview */}
                <div className="relative w-56 shrink-0 rounded-[2rem] bg-bg-deep p-3 shadow-[var(--shadow-float)] ring-1 ring-line">
                  <div className="relative aspect-[9/16] overflow-hidden rounded-[1.5rem] bg-[linear-gradient(180deg,oklch(0.3_0.07_152),oklch(0.2_0.05_152))]">
                    {resultUrl ? (
                      <video
                        src={resultUrl}
                        controls
                        playsInline
                        loop
                        className="absolute inset-0 h-full w-full object-cover"
                        aria-label="Your generated video"
                      />
                    ) : (
                      <GrandmaDancer className="absolute inset-x-0 bottom-0 mx-auto h-[88%]" title="Your generated video: grandma performing the dance" />
                    )}
                    <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-go px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-ink">
                      {resultIsGoldenClip ? "● Sample" : resultUrl ? "● Rendered" : "● Preview"}
                    </span>
                  </div>
                  {photoUrl && (
                    <figure className="absolute -left-6 -top-6 w-20 -rotate-6 rounded-sm bg-ink p-1.5 pb-5 shadow-[var(--shadow-float)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                      <img src={photoUrl} alt="The original photo, pinned to the corner" className="aspect-square w-full rounded-[2px] object-cover" />
                      <figcaption className="mt-1 text-center font-display text-[0.6rem] leading-none text-bg-deep">
                        starring
                      </figcaption>
                    </figure>
                  )}
                </div>

                <div className="max-w-sm">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={share}
                      className="rounded-full bg-go px-7 py-3 font-display text-lg text-ink shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5 hover:bg-go-hover"
                    >
                      Share the chaos
                    </button>
                    {resultUrl && (
                      <a
                        href={resultUrl}
                        download="dancing-grandma.mp4"
                        className="rounded-full bg-butter px-7 py-3 font-display text-lg text-butter-ink shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5"
                      >
                        Download
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-full bg-surface-raised px-7 py-3 font-display text-lg text-ink ring-1 ring-line transition-transform hover:-translate-y-0.5"
                    >
                      Make another
                    </button>
                  </div>
                  {!resultUrl && (
                    <p className="mt-6 rounded-2xl bg-bg-deep/50 p-4 text-sm text-muted">
                      <span className="font-bold text-butter">Demo mode.</span> This preview is
                      simulated — in production this run goes to{" "}
                      <span className="text-ink">{engine.name}</span> ({engine.vendor}),{" "}
                      {engine.pricing.toLowerCase()}, and turns the real photo + dance video into
                      the real thing, music included.
                    </p>
                  )}
                  {resultIsGoldenClip && (
                    <p className="mt-6 rounded-2xl bg-bg-deep/50 p-4 text-sm text-muted">
                      <span className="font-bold text-butter">Pre-rendered sample.</span> The
                      selected provider is unavailable, so this keeps the demo moving without
                      pretending it is a fresh render.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
        {toast && (
          <p className="animate-pop-in rounded-full bg-butter px-6 py-3 font-medium text-butter-ink shadow-[var(--shadow-float)]">
            {toast}
          </p>
        )}
      </div>
    </section>
  );
}
