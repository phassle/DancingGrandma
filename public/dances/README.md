# Trending-dance reference clips

Every curated dance ships with a reference video here, so each card renders for
real on a fresh clone — no setup, no drop-in step. Each clip carries its own
audio, transcoded to an engine-friendly H.264/AAC MP4 (≤15 s, ≤720 px wide).

| File | Dance card |
| --- | --- |
| `griddy.mp4` | The Griddy |
| `renegade.mp4` | Renegade |
| `macarena.mp4` | Macarena Redux |
| `disco.mp4` | Disco Inferno |
| `woah.mp4` | The Woah |

## How they got here

Fetched with the in-app import pipeline (`yt-dlp` + `ffmpeg`, see
`src/lib/import-clip.ts`) from public dance clips, then transcoded with the
audio track preserved. To refresh or add one, drop a new `<id>.mp4` here and add
a matching entry to `DANCES` in `src/components/Studio.tsx`.

## Licensing note

This is a public repo, so these committed clips are other creators' content
published here for a demo. The repo owner accepted that tradeoff. For anything
shipped more broadly, prefer licensed/owned footage (e.g. Pexels/Pixabay) or
keep clips local via `.gitignore`.
