import type { Metadata } from "next";
import Library from "@/components/Library";

export const metadata: Metadata = {
  title: "Your library — DancingGrandma",
  description: "Your private Generated Dance Videos: rewatch, download, share, delete.",
};

export default function LibraryPage() {
  return (
    <main className="flex min-h-screen w-full items-start justify-center">
      <Library />
    </main>
  );
}
