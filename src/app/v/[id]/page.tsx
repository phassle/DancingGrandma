import type { Metadata } from "next";

type PageProps = {
  params: Promise<{ id: string }>;
};

function pathsFor(id: string) {
  return {
    page: `/v/${id}`,
    video: `/api/video/${id}`,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const paths = pathsFor(id);
  return {
    title: "DancingGrandma video",
    description: "Watch this generated dance video.",
    alternates: {
      canonical: paths.page,
    },
    openGraph: {
      title: "DancingGrandma video",
      description: "Watch this generated dance video.",
      url: paths.page,
      type: "video.other",
      videos: [
        {
          url: paths.video,
          width: 720,
          height: 1280,
          type: "video/mp4",
        },
      ],
    },
  };
}

export default async function ShareVideoPage({ params }: PageProps) {
  const { id } = await params;
  const paths = pathsFor(id);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-4 py-8">
      <div className="w-full rounded-3xl bg-bg-deep p-3 shadow-[var(--shadow-float)] ring-1 ring-line">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[1.5rem] bg-black">
          <video
            src={paths.video}
            controls
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
            aria-label="Shared generated dance video"
          />
        </div>
      </div>
    </main>
  );
}
