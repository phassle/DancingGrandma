import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

/**
 * Server-side clip import: download any yt-dlp-supported page (YouTube,
 * TikTok, …) and transcode it into a fal-friendly reference clip.
 *
 * The output is H.264/AAC MP4, capped at 15 s and 720 px wide — a format the
 * generation engines accept, and short enough to keep a render around $1.
 * Files land in a temp folder; they're throwaway, not repo content.
 */

const IMPORTS_DIR = join(tmpdir(), "dg-imports");
const MAX_SECONDS = 15;
const MAX_WIDTH = 720;
const STEP_TIMEOUT_MS = 120_000;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // Array args (no shell) — the user-supplied URL can't inject a command.
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, STEP_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${cmd} is not installed`)
          : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").pop() || `${cmd} exited with ${code}`));
    });
  });
}

export type ImportedClip = {
  name: string;
  bytes: ArrayBuffer;
};

export async function importClip(url: string): Promise<ImportedClip> {
  await mkdir(IMPORTS_DIR, { recursive: true });
  const dir = await mkdtemp(join(IMPORTS_DIR, "clip-"));

  // Download the best ≤720p stream; the title becomes the filename.
  await run("yt-dlp", [
    "-f",
    "bv*[height<=1280]+ba/b[height<=1280]/b",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "-o",
    join(dir, "%(title).60s.%(ext)s"),
    url,
  ]);

  const downloaded = (await readdir(dir))[0];
  if (!downloaded) throw new Error("Nothing was downloaded from that link");
  const source = join(dir, downloaded);
  const out = join(dir, "clip.mp4");

  await run("ffmpeg", [
    "-y",
    "-i",
    source,
    "-t",
    String(MAX_SECONDS),
    "-vf",
    `scale='min(${MAX_WIDTH},iw)':-2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    out,
  ]);

  const slug = basename(downloaded, extname(downloaded)).replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "clip";
  const buf = await readFile(out);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { name: `${slug}.mp4`, bytes };
}
