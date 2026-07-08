-- Retention and expiration policies (PRD #54, issue #60).
--
-- Every stored object gets a media-asset record instead of piling URLs onto
-- the generation row. Source photos are personal data with a short retention
-- policy: their blob bytes are deleted once the generation reaches a terminal
-- state, while the record keeps a content hash and metadata for abuse and
-- support debugging. Purging clears blob_path and stamps purged_at — the row
-- itself is never deleted while its generation exists.

create table media_assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  generation_id uuid references video_generations(id) on delete cascade,
  kind          text not null check (kind in
                  ('source_photo', 'reference_video', 'generated_video', 'poster')),
  blob_path     text,                -- null once the bytes have been purged
  content_type  text,
  byte_size     integer check (byte_size >= 0),
  sha256        text,                -- survives purging, for abuse/debugging
  purged_at     timestamptz,         -- set when the blob bytes were deleted
  created_at    timestamptz not null default now()
);

create index media_assets_generation on media_assets (generation_id);

-- The retention sweep looks for photo bytes that outlived their generation.
create index media_assets_unpurged_source_photos
  on media_assets (created_at)
  where kind = 'source_photo' and purged_at is null;
