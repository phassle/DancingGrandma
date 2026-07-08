-- Private library, share links, and retention (PRD #54, issues #59 and #60).
--
-- Generated Dance Videos are private account assets: visible only to their
-- owner, kept until the user deletes them, optionally opted into a
-- share-by-link page via an unguessable share slug. Every stored object gets
-- a media-asset record instead of piling URLs onto the generation row.

-- Videos are private by default; share-by-link flips visibility to 'shared'
-- and mints a fresh slug. Turning sharing off clears the slug, so old links
-- stop resolving. Deletion is a soft delete (ledger rows reference the
-- generation, and the audit trail must survive), paired with blob removal.
alter table video_generations
  add column visibility text not null default 'private'
    check (visibility in ('private', 'shared')),
  add column share_slug text unique,
  add column deleted_at timestamptz;

-- A shared generation always carries a slug; a private one never does.
alter table video_generations
  add constraint video_generations_share_slug_matches_visibility
    check ((visibility = 'shared') = (share_slug is not null));

-- One record per stored object (source photo, reference video, generated
-- video, poster): storage location, content metadata, privacy level, and
-- retention policy. Curated clips are product assets; user uploads are the
-- user's private data.
--
-- Source photos are personal data with a short retention policy (issue #60):
-- their blob bytes are deleted once the generation reaches a terminal state,
-- while the record keeps a content hash and metadata for abuse and support
-- debugging. Purging clears blob_path and stamps purged_at — the row itself
-- is never deleted while its generation exists.
create table media_assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  generation_id    uuid references video_generations(id) on delete cascade,
  kind             text not null check (kind in
                     ('source_photo', 'reference_video', 'generated_video', 'poster')),
  storage_provider text not null default 'azure_blob',
  blob_path        text,                -- null once the bytes have been purged
  content_type     text not null,
  byte_size        integer check (byte_size >= 0),
  sha256           text,                -- survives purging, for abuse/debugging
  privacy          text not null default 'private'
                   check (privacy in ('private', 'shared_via_link', 'product_asset')),
  retention        text not null default 'delete_on_terminal'
                   check (retention in
                     ('delete_on_terminal',      -- source photos
                      'keep_until_user_delete',  -- generated videos
                      'product')),               -- curated clips
  purged_at        timestamptz,         -- set when the blob bytes were deleted
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index media_assets_generation on media_assets (generation_id);
create index media_assets_user on media_assets (user_id, created_at desc);

-- The retention sweep looks for photo bytes that outlived their generation.
create index media_assets_unpurged_source_photos
  on media_assets (created_at)
  where kind = 'source_photo' and purged_at is null;
