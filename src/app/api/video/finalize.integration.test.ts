import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { beforeEach, expect, test, vi } from "vitest";
import { POST } from "./finalize/route";

const execFileAsync = promisify(execFile);
const blobMocks = vi.hoisted(() => ({
  saveVideoBytes: vi.fn(),
}));

vi.mock("@/lib/server/blob", () => ({
  saveVideoBytes: blobMocks.saveVideoBytes,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function videoDataUrl(bytes: Buffer): string {
  return `data:video/mp4;base64,${bytes.toString("base64")}`;
}

test("delivered Wan-style output has an audio stream when the reference clip has one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dg-finalize-it-"));
  const generatedPath = join(dir, "generated.mp4");
  const referencePath = join(dir, "reference.mp4");
  const outputPath = join(dir, "output.mp4");

  try {
    let persisted: Buffer | undefined;
    blobMocks.saveVideoBytes.mockImplementation(async (_id: string, bytes: Buffer) => {
      persisted = bytes;
      return "stored.mp4";
    });
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x284:d=1:r=10",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      generatedPath,
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x284:d=1:r=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      referencePath,
    ]);

    const res = await POST(
      new Request("http://localhost/api/video/finalize", {
        method: "POST",
        body: JSON.stringify({
          videoUrl: videoDataUrl(await readFile(generatedPath)),
          referenceVideoUrl: videoDataUrl(await readFile(referencePath)),
          carriesAudio: false,
        }),
      }),
    );

    expect(res.status, await res.clone().text()).toBe(200);
    await expect(res.json()).resolves.toEqual({
      videoUrl: expect.stringMatching(/^\/api\/video\/[0-9a-f-]{36}$/),
      shareUrl: expect.stringMatching(/^\/v\/[0-9a-f-]{36}$/),
    });
    expect(persisted).toBeDefined();
    await writeFile(outputPath, persisted!);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "json",
      outputPath,
    ]);
    expect(JSON.parse(stdout).streams).toEqual([
      expect.objectContaining({ codec_type: "audio" }),
    ]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
