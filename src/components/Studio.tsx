"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GrandmaDancer from "./GrandmaDancer";
import { DEFAULT_ENGINE, ENGINES, type Engine } from "@/lib/engines";
import { generateDanceVideo } from "@/lib/generate";

type Step = "photo" | "dance" | "generating" | "done";

type Dance = {
  id: string;
  name: string;
  emoji: string;
  bpm: number;
  spice: 1 | 2 | 3;
  blurb: string;
};

const DANCES: Dance[] = [
  { id: "griddy", name: "The Griddy", emoji: "🏈", bpm: 140, spice: 2, blurb: "Arms pumping, knees flying. Touchdown energy." },
  { id: "renegade", name: "Renegade", emoji: "🔥", bpm: 128, spice: 3, blurb: "The classic. Eight counts of pure chaos." },
  { id: "macarena", name: "Macarena Redux", emoji: "🙌", bpm: 103, spice: 1, blurb: "She already knows this one. Trust." },
  { id: "disco", name: "Disco Inferno", emoji: "🪩", bpm: 118, spice: 2, blurb: "Point up, point down, own the room." },
  { id: "woah", name: "The Woah", emoji: "🎯", bpm: 145, spice: 2, blurb: "One move. Perfectly timed. Devastating." },
];

const GENERATION_STAGES = [
  "Studying the choreography…",
  "Teaching grandma the moves…",
  "Warming up the hips…",
  "Syncing to the beat…",
  "Adding disco lighting…",
  "Final dress rehearsal…",
];

const MAX_PHOTO_MB = 10;

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
  const [danceError, setDanceError] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>(DEFAULT_ENGINE);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Real generation runs when the user brought their own reference clip and
  // the chosen engine has a wired adapter; curated dances stay simulated.
  const isRealRun = customVideo !== null && Boolean(engine.endpoint);
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
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

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
    (async () => {
      try {
        const url = await generateDanceVideo(photoFile!, customVideo!, engine, (msg) => {
          if (!cancelled) setGenStatus(msg);
        });
        if (!cancelled) {
          setResultUrl(url);
          setStep("done");
        }
      } catch (err) {
        if (!cancelled) {
          setGenError(
            err instanceof Error
              ? `The engine tripped over its own feet: ${err.message}. Nothing was charged twice — try again.`
              : "Something went wrong on the dance floor. Try again.",
          );
          setStep("dance");
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
    if (!file.type.startsWith("video/")) {
      setDanceError("That's not a video. MP4 or MOV of the dance, please.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setDanceError("That clip is over 100 MB. Trim it down — 10–30 seconds is the sweet spot.");
      return;
    }
    setCustomVideo(file);
    setDance(null);
    setDanceError(null);
    setGenError(null);
  };

  const reset = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setPhotoUrl(null);
    setPhotoFile(null);
    setPhotoName(null);
    setPhotoError(null);
    setDance(null);
    setCustomVideo(null);
    setDanceError(null);
    setGenStatus(null);
    setGenError(null);
    setResultUrl(null);
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
                          }}
                          className="sr-only"
                        />
                        <span aria-hidden="true" className="text-3xl">{d.emoji}</span>
                        <span className="flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-display text-xl">{d.name}</span>
                            <SpiceMeter level={d.spice} />
                          </span>
                          <span className={`mt-1 block text-sm ${selected ? "text-butter-ink/80" : "text-muted"}`}>
                            {d.blurb} · {d.bpm} BPM
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  <label
                    className={`flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed p-4 transition-colors ${
                      customVideo ? "border-butter bg-butter/10 text-ink" : "border-line text-muted hover:border-muted"
                    }`}
                  >
                    <span aria-hidden="true" className="text-3xl">🎬</span>
                    <span className="text-sm">
                      <span className="font-medium text-ink">
                        {customVideo ? `“${customVideo.name}” loaded` : "Got your own dance video?"}
                      </span>{" "}
                      {customVideo
                        ? "— this clip's moves (and music) go to the real generator."
                        : "Upload a reference clip (MP4/MOV, 10–30 s) and the real AI engine renders it."}
                    </span>
                    <input
                      type="file"
                      accept="video/*"
                      className="sr-only"
                      aria-label="Upload your own reference dance video"
                      onChange={(e) => acceptDanceVideo(e.target.files?.[0])}
                    />
                  </label>
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
                    const soon = e.status === "coming-soon";
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
                  {engine.pricing} · {engine.audio} · max length: {engine.maxDuration}
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
                  disabled={!dance && !customVideo}
                  onClick={() => {
                    setStageIndex(0);
                    setGenError(null);
                    setGenStatus(null);
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

          {/* STEP 4 — DONE */}
          {step === "done" && (
            <div className="animate-pop-in">
              <h3 ref={headingRef} tabIndex={-1} className="font-display text-3xl sm:text-4xl outline-none">
                She ate. 🔥
              </h3>
              <p className="mt-2 max-w-[55ch] text-muted">
                {dance ? `“${dance.name}” — performed flawlessly on the first take.` : "Performed flawlessly on the first take."}
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
                      {resultUrl ? "● Rendered" : "● Preview"}
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
                  <p className="mt-6 rounded-2xl bg-bg-deep/50 p-4 text-sm text-muted">
                    <span className="font-bold text-butter">Demo mode.</span> This preview is
                    simulated — in production this run goes to{" "}
                    <span className="text-ink">{engine.name}</span> ({engine.vendor}),{" "}
                    {engine.pricing.toLowerCase()}, and turns the real photo + dance video into
                    the real thing, music included.
                  </p>
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
