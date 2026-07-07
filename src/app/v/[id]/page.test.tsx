import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Page, { generateMetadata } from "./page";

test("share page renders a 9:16 video player for the stored video", async () => {
  render(await Page({ params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }));

  const video = screen.getByLabelText("Shared generated dance video");
  expect(video.getAttribute("src")).toBe("/api/video/11111111-1111-4111-8111-111111111111");
  expect(video.getAttribute("controls")).not.toBeNull();
});

test("share page metadata includes open-graph video tags", async () => {
  const metadata = await generateMetadata({
    params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
  });

  expect(metadata.alternates?.canonical).toBe("/v/11111111-1111-4111-8111-111111111111");
  expect(metadata.openGraph?.videos).toEqual([
    {
      url: "/api/video/11111111-1111-4111-8111-111111111111",
      width: 720,
      height: 1280,
      type: "video/mp4",
    },
  ]);
});
