// @vitest-environment node
import { expect, test } from "vitest";
import { GET } from "./route";

test("clears the session cookie and sends the visitor home", async () => {
  const res = await GET(new Request("http://localhost:3000/api/auth/logout"));

  expect(res.status).toBe(303);
  expect(res.headers.get("Location")).toBe("http://localhost:3000/");
  expect(res.headers.get("Set-Cookie")).toContain("dg_session=;");
  expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
});
