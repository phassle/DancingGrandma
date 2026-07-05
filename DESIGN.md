# Design

Visual system for DancingGrandma. Strategic context lives in [PRODUCT.md](PRODUCT.md).

## Theme

"Kitchen disco at grandma's 80th" — a deep dance-floor green surface (drenched color
strategy: the green IS the brand surface), lit by butter-yellow sparkle and a hot-pink
go-color. Dark theme by design: the audience is mid-scroll on a phone at night, and the
product output is a vertical video that belongs on a dark stage.

## Color (OKLCH only)

Defined in `src/app/globals.css` and mapped to Tailwind via `@theme inline`.

| Token | Value | Role |
|---|---|---|
| `--bg` | `oklch(0.24 0.052 152)` | Body surface (drenched brand green) |
| `--bg-deep` | `oklch(0.19 0.045 152)` | Recessed panels, phone bezels, footer |
| `--surface` | `oklch(0.29 0.058 152)` | Cards, the Studio shell |
| `--surface-raised` | `oklch(0.33 0.06 152)` | Hover/raised surfaces, secondary buttons |
| `--ink` | `oklch(0.975 0.008 120)` | Body text (≥7:1 on bg) |
| `--muted` | `oklch(0.80 0.035 150)` | Secondary text (≥3.5:1 on bg) |
| `--brand` / `--brand-bright` | `oklch(0.60 0.158 150)` / `oklch(0.72 0.17 148)` | Brand green — floor glow, links, marquee |
| `--go` | `oklch(0.60 0.21 5)` | THE action color. Primary CTAs only; white/ink text on it |
| `--butter` | `oklch(0.87 0.15 95)` | Sparkle: active steps, highlights, stickers; dark ink text on it |
| `--line` | `oklch(0.40 0.055 152)` | Hairline borders/rings |

Rules: pink `--go` is reserved for the primary action per screen. Butter marks "where you
are / what's lit". Never introduce hex values; extend the ramp in OKLCH at hue ~150.

## Typography

- **Display**: Lilita One (400) via `next/font` → `--font-display` / `font-display`.
  Headings, buttons, stickers. Uppercase only in the hero and marquee.
- **Body**: Schibsted Grotesk (400/500/700) → `--font-sans`. Light-on-dark compensation
  is baked into `body`: line-height 1.6 + letter-spacing 0.01em.
- Hero scale: `clamp(2.75rem, 7vw, 5.5rem)`, leading 0.95. Section headings ~2.25–3rem.
- `text-wrap: balance` on h1–h3, `pretty` on paragraphs. Measures capped at 36–60ch.

## Components & patterns

- **Buttons**: pill-shaped (`rounded-full`), font-display labels, hard drop shadow
  (`--shadow-pop`, a solid 4px offset in `--bg-deep`) and a `-translate-y-0.5` hover lift.
- **Stickers**: small rotated pills/polaroids (`rotate-[-6deg]`-ish) used for hero chips
  and the "starring" polaroid. Polaroids: ink-white frame, padded bottom, display caption.
- **Phone frame**: `rounded-[2.5rem]` bezel in `--bg-deep`, 9:16 screen with a vertical
  green gradient stage; the illustrated `GrandmaDancer` SVG is the resident imagery.
- **Studio wizard**: one raised `--surface` shell, step pills in the header
  (butter = current, check = done), one obvious next action per step.
- Cards only where content is truly selectable (dance picker); no nested cards.

## Motion

Keyframes live in `globals.css`: `bob`, `sway`, `arm-left/right`, `hip` (the dancer),
`note-rise`, `disco-spin`, `floor-pulse` (ambience), `pop-in` (step transitions),
`marquee`. Snappy exponential ease (`--ease-snap`). Every animation collapses under
`prefers-reduced-motion: reduce` (global override — the dancer freezes into a pose).

## Voice

Cheeky, affectionate, meme-literate; grandma is the hero, never the punchline.
Buttons speak the product ("Make grandma dance", "Share the chaos"), errors stay warm
and specific. English UI.
