import { expect, test } from "vitest";
import { classifyFalError, falDetailToMessage } from "./provider";

/**
 * fal surfaces validation failures from `queue.result()` as HTTP 422 with a
 * FastAPI-style `body.detail` ARRAY of `{loc, msg}` (issue #95). The old
 * classifier only read `detail` when it was a string, so those failures reached
 * the user as a bare "Unprocessable Entity" with no reason. These lock in that
 * the structured detail is rendered into an actionable message.
 */

test("falDetailToMessage renders a FastAPI validation array as field: msg pairs", () => {
  const detail = [
    { type: "missing", loc: ["body", "image_url"], msg: "Field required" },
    { type: "missing", loc: ["body", "video_url"], msg: "Field required" },
  ];
  expect(falDetailToMessage(detail)).toBe("image_url: Field required; video_url: Field required");
});

test("falDetailToMessage passes a string detail through unchanged", () => {
  expect(falDetailToMessage("User is locked")).toBe("User is locked");
});

test("falDetailToMessage returns empty string for absent/unusable detail", () => {
  expect(falDetailToMessage(undefined)).toBe("");
  expect(falDetailToMessage(null)).toBe("");
  expect(falDetailToMessage({})).toBe("");
});

test("falDetailToMessage tolerates array items missing loc or msg", () => {
  expect(falDetailToMessage([{ msg: "Something went wrong" }])).toBe("Something went wrong");
  expect(falDetailToMessage([{ loc: ["body", "resolution"] }])).toBe("resolution");
});

test("classifyFalError surfaces array-form 422 detail in the message (kind=provider)", () => {
  const err = Object.assign(new Error("Unprocessable Entity"), {
    status: 422,
    body: { detail: [{ loc: ["body", "image_url"], msg: "Field required" }] },
  });
  const out = classifyFalError(err);
  expect(out.kind).toBe("provider");
  expect(out.message).toContain("image_url: Field required");
  expect(out.message).not.toBe("Unprocessable Entity");
});

test("classifyFalError falls back to the error message when there is no detail", () => {
  const err = Object.assign(new Error("boom"), { status: 500, body: {} });
  const out = classifyFalError(err);
  expect(out.kind).toBe("provider");
  expect(out.message).toBe("boom");
});

test("classifyFalError keeps the locked-account mapping (kind=unavailable)", () => {
  const err = Object.assign(new Error("locked"), {
    status: 403,
    body: { detail: "User is locked. Please contact support." },
  });
  expect(classifyFalError(err).kind).toBe("unavailable");
});

test("classifyFalError maps timeouts (kind=timeout)", () => {
  expect(classifyFalError(Object.assign(new Error("t"), { status: 504 })).kind).toBe("timeout");
  expect(classifyFalError(Object.assign(new Error("t"), { timeoutType: "request" })).kind).toBe("timeout");
});

test("classifyFalError passes through an already-classified providerError", () => {
  const pre = Object.assign(new Error("already"), { kind: "provider" as const });
  expect(classifyFalError(pre)).toBe(pre);
});
