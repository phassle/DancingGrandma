import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { deflateSync } from "zlib";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type FinalizeRequest = {
  videoUrl?: string;
  referenceVideoUrl?: string;
  carriesAudio?: boolean;
};

function errorResponse(error: string, status = 502): Response {
  return Response.json({ kind: "provider", error }, { status });
}

function logFinalizeError(body: FinalizeRequest | null, err: unknown) {
  console.error("[dg:finalize-error]", {
    videoUrl: body?.videoUrl,
    referenceVideoUrl: body?.referenceVideoUrl,
    carriesAudio: body?.carriesAudio,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function aiWatermarkPng(): Buffer {
  const width = 72;
  const height = 44;
  const scale = 4;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 150;
    }
  }

  const drawBitmap = (bitmap: string[], left: number, top: number) => {
    bitmap.forEach((row, rowIndex) => {
      [...row].forEach((cell, columnIndex) => {
        if (cell !== "1") return;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = left + columnIndex * scale + dx;
            const y = top + rowIndex * scale + dy;
            const offset = (y * width + x) * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = 255;
          }
        }
      });
    });
  };

  drawBitmap(["01110", "10001", "10001", "11111", "10001", "10001", "10001"], 10, 8);
  drawBitmap(["111", "010", "010", "010", "010", "010", "111"], 42, 8);

  const rawRows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    rawRows[rowOffset] = 0;
    pixels.copy(rawRows, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rawRows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed for ${url}: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as FinalizeRequest | null;
  if (!body?.videoUrl) {
    return errorResponse("videoUrl is required", 400);
  }

  const dir = await mkdtemp(join(tmpdir(), "dg-video-"));
  const inputPath = join(dir, "input.mp4");
  const referencePath = join(dir, "reference.mp4");
  const watermarkPath = join(dir, "watermark.png");
  const outputPath = join(dir, "output.mp4");

  try {
    await writeFile(inputPath, await download(body.videoUrl));
    await writeFile(watermarkPath, aiWatermarkPng());
    const shouldMuxReferenceAudio = !body.carriesAudio && Boolean(body.referenceVideoUrl);
    if (shouldMuxReferenceAudio && body.referenceVideoUrl) {
      await writeFile(referencePath, await download(body.referenceVideoUrl));
    }

    const args = shouldMuxReferenceAudio
      ? [
          "-y",
          "-i",
          inputPath,
          "-i",
          referencePath,
          "-i",
          watermarkPath,
          "-filter_complex",
          "[0:v][2:v]overlay=W-w-24:24:format=auto[v]",
          "-map",
          "[v]",
          "-map",
          "1:a:0?",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-c:a",
          "aac",
          "-shortest",
          outputPath,
        ]
      : [
          "-y",
          "-i",
          inputPath,
          "-i",
          watermarkPath,
          "-filter_complex",
          "[0:v][1:v]overlay=W-w-24:24:format=auto[v]",
          "-map",
          "[v]",
          "-map",
          "0:a:0?",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-c:a",
          "copy",
          outputPath,
        ];

    await execFileAsync("ffmpeg", args);
    const output = await readFile(outputPath);
    return new Response(output, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `inline; filename="dancing-grandma-${randomUUID()}.mp4"`,
      },
    });
  } catch (err) {
    logFinalizeError(body, err);
    return errorResponse(err instanceof Error ? err.message : String(err));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
