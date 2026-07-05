import { beforeEach, expect, test, vi } from "vitest";
import { POST } from "./route";

const execMocks = vi.hoisted(() => ({
  execFile: vi.fn((_cmd, _args, callback: (error: Error | null) => void) => {
    callback(null);
  }),
}));

const fsMocks = vi.hoisted(() => ({
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("child_process", () => ({
  default: { execFile: execMocks.execFile },
  execFile: execMocks.execFile,
}));

vi.mock("fs/promises", () => ({
  default: fsMocks,
  ...fsMocks,
}));

beforeEach(() => {
  vi.clearAllMocks();
  fsMocks.mkdtemp.mockResolvedValue("/tmp/dg-video-test");
  fsMocks.writeFile.mockResolvedValue(undefined);
  fsMocks.readFile.mockResolvedValue(Buffer.from("final"));
  fsMocks.rm.mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return new Response(url.includes("reference") ? "audio" : "video", { status: 200 });
    }),
  );
});

function finalizeRequest(body: unknown): Request {
  return new Request("http://localhost/api/video/finalize", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

test("burns in the AI watermark and muxes reference audio when the provider has no audio", async () => {
  const res = await POST(
    finalizeRequest({
      videoUrl: "https://provider.example/video.mp4",
      referenceVideoUrl: "https://provider.example/reference.mp4",
      carriesAudio: false,
    }),
  );

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("video/mp4");
  await expect(res.text()).resolves.toBe("final");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fsMocks.writeFile).toHaveBeenCalledWith(
    "/tmp/dg-video-test/input.mp4",
    expect.any(Buffer),
  );
  expect(fsMocks.writeFile).toHaveBeenCalledWith(
    "/tmp/dg-video-test/reference.mp4",
    expect.any(Buffer),
  );
  expect(fsMocks.writeFile).toHaveBeenCalledWith(
    "/tmp/dg-video-test/watermark.png",
    expect.any(Buffer),
  );
  expect(execMocks.execFile).toHaveBeenCalledWith(
    "ffmpeg",
    expect.arrayContaining([
      "-i",
      "/tmp/dg-video-test/watermark.png",
      "-filter_complex",
      "[0:v][2:v]overlay=W-w-24:24:format=auto[v]",
      "-map",
      "1:a:0?",
      "-shortest",
      "/tmp/dg-video-test/output.mp4",
    ]),
    expect.any(Function),
  );
});

test("preserves provider audio when the engine already carries audio", async () => {
  await POST(
    finalizeRequest({
      videoUrl: "https://provider.example/video.mp4",
      referenceVideoUrl: "https://provider.example/reference.mp4",
      carriesAudio: true,
    }),
  );

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fsMocks.writeFile).toHaveBeenCalledTimes(2);
  expect(execMocks.execFile).toHaveBeenCalledWith(
    "ffmpeg",
    expect.arrayContaining([
      "-i",
      "/tmp/dg-video-test/watermark.png",
      "-filter_complex",
      "[0:v][1:v]overlay=W-w-24:24:format=auto[v]",
      "-map",
      "0:a:0?",
      "-c:a",
      "copy",
    ]),
    expect.any(Function),
  );
  expect(execMocks.execFile.mock.calls[0][1]).not.toContain("1:a:0?");
});

test("requires a provider video URL", async () => {
  const res = await POST(finalizeRequest({}));

  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toMatchObject({
    kind: "provider",
    error: "videoUrl is required",
  });
  expect(execMocks.execFile).not.toHaveBeenCalled();
});
