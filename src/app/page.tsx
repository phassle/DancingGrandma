import GrandmaDancer from "@/components/GrandmaDancer";
import Studio from "@/components/Studio";

const MARQUEE_WORDS = ["make grandma dance", "one photo in", "one legend out", "music included"];

function Marquee() {
  const run = [...MARQUEE_WORDS, ...MARQUEE_WORDS];
  return (
    <div aria-hidden="true" className="overflow-hidden border-y border-line/60 bg-bg-deep/50 py-3">
      <div className="animate-marquee flex w-max gap-8 whitespace-nowrap font-display text-lg uppercase tracking-[0.06em] text-brand-bright">
        {run.map((w, i) => (
          <span key={i} className="flex items-center gap-8">
            {w} <span className="text-go">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: "1",
    title: "Upload the photo",
    body: "One good picture of grandma. Sunday-best cardigan encouraged, not required.",
  },
  {
    n: "2",
    title: "Pick the dance",
    body: "Choose a trending TikTok dance — or bring your own reference clip. The music tags along.",
  },
  {
    n: "3",
    title: "Watch her go viral",
    body: "The AI maps every move onto her, frame by frame. Download it, post it, brace yourself.",
  },
];

const FAQS = [
  {
    q: "Does grandma know about this?",
    a: "That's between you and grandma. We recommend showing her first — in our experience she asks for the spicier choreography.",
  },
  {
    q: "What happens to the photo I upload?",
    a: "In this demo, nothing leaves your browser — the photo never touches a server. In production, photos are used once for generation and deleted right after.",
  },
  {
    q: "Which AI actually makes the video?",
    a: "The pipeline is built for Wan 2.2 Animate (Alibaba's open-source motion-transfer model, Apache 2.0) served via fal.ai, with Kling 2.6 Motion Control as the fallback. Both take exactly one photo + one reference video and return her doing the dance.",
  },
  {
    q: "Can I use someone who isn't a grandma?",
    a: "Grandpas, uncles, coworkers, hockey coaches — anyone who'd bring the house down. Just use a photo you have permission to use.",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      {/* Header */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <p className="font-display text-2xl">
          Dancing<span className="text-butter">Grandma</span>
        </p>
        <a
          href="#studio"
          className="rounded-full bg-go px-6 py-2.5 font-display text-lg text-ink shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5 hover:bg-go-hover"
        >
          Make one
        </a>
      </header>

      {/* Hero */}
      <section aria-labelledby="hero-title" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-20 pt-10 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-6">
        <div>
          <h1
            id="hero-title"
            className="font-display text-[clamp(2.75rem,7vw,5.5rem)] uppercase leading-[0.95]"
          >
            Your grandma.
            <br />
            <span className="text-butter">Their dance.</span>
            <br />
            <span className="text-go">One video.</span>
          </h1>
          <p className="mt-6 max-w-[48ch] text-lg text-muted">
            Upload one photo, pick a trending TikTok dance, and the AI puts her in it —
            every move, every beat, music included. Sixty seconds from cardigan to icon.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <a
              href="#studio"
              className="rounded-full bg-go px-9 py-4 font-display text-xl text-ink shadow-[var(--shadow-pop)] transition-transform hover:-translate-y-0.5 hover:bg-go-hover"
            >
              Make grandma dance
            </a>
            <a
              href="#how"
              className="font-medium text-brand-bright underline underline-offset-4 hover:text-ink"
            >
              How does it work?
            </a>
          </div>
        </div>

        {/* Phone preview — the demo is the pitch */}
        <div className="relative mx-auto w-64 sm:w-72">
          <div className="rounded-[2.5rem] bg-bg-deep p-3 shadow-[var(--shadow-float)] ring-1 ring-line">
            <div className="relative aspect-[9/16] overflow-hidden rounded-[2rem] bg-[linear-gradient(180deg,oklch(0.31_0.07_152),oklch(0.2_0.05_152))]">
              <GrandmaDancer className="absolute inset-x-0 bottom-0 mx-auto h-[92%]" />
            </div>
          </div>
          <p className="absolute -left-10 top-10 -rotate-6 rounded-xl bg-butter px-3.5 py-2 font-display text-sm text-butter-ink shadow-[var(--shadow-pop)] max-lg:-left-2">
            📸 one photo in
          </p>
          <p className="absolute -right-8 bottom-14 rotate-3 rounded-xl bg-surface-raised px-3.5 py-2 font-display text-sm text-ink shadow-[var(--shadow-pop)] ring-1 ring-line max-lg:-right-2">
            💃 one legend out
          </p>
        </div>
      </section>

      <Marquee />

      {/* How it works — a real 3-step sequence */}
      <section id="how" aria-labelledby="how-title" className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <h2 id="how-title" className="font-display text-4xl sm:text-5xl">
          From fridge magnet to <span className="text-go">for-you page</span>
        </h2>
        <ol className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((s) => (
            <li key={s.n} className="relative">
              <span aria-hidden="true" className="font-display text-6xl text-butter/90">
                {s.n}
              </span>
              <h3 className="mt-3 font-display text-2xl">{s.title}</h3>
              <p className="mt-2 max-w-[36ch] text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <Studio />

      {/* FAQ */}
      <section aria-labelledby="faq-title" className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-24">
        <h2 id="faq-title" className="font-display text-4xl sm:text-5xl">
          The sensible questions
        </h2>
        <div className="mt-10 space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl bg-surface px-6 py-4 ring-1 ring-line/60 open:bg-surface-raised"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-xl [&::-webkit-details-marker]:hidden">
                {f.q}
                <span
                  aria-hidden="true"
                  className="text-butter transition-transform duration-200 group-open:rotate-45"
                >
                  ＋
                </span>
              </summary>
              <p className="mt-3 max-w-[60ch] text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line/60 bg-bg-deep/50">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-10 text-sm text-muted">
          <p className="font-display text-lg text-ink">
            Dancing<span className="text-butter">Grandma</span>
          </p>
          <p className="max-w-[52ch]">
            A Monterro InfuseAI demo. Video generation designed around{" "}
            <a
              href="https://github.com/Wan-Video/Wan2.2"
              className="text-brand-bright underline underline-offset-4 hover:text-ink"
            >
              Wan 2.2 Animate
            </a>{" "}
            (Apache 2.0) served via fal.ai — integration coming next.
          </p>
          <p>Be kind to your grandma. 💚</p>
        </div>
      </footer>
    </main>
  );
}
