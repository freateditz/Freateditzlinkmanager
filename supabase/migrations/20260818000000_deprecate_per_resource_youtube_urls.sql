-- V1: Global YouTube configuration
--
-- youtube_channel_url and youtube_video_url used to live on each resource row.
-- They are now global site configuration (NEXT_PUBLIC_YOUTUBE_CHANNEL_URL /
-- NEXT_PUBLIC_YOUTUBE_VIDEO_URL) read at runtime, not stored per resource.
--
-- This migration:
--   1. Confirms both columns are already nullable (they were never NOT NULL).
--   2. Adds a comment marking them as deprecated/legacy so future contributors
--      don't read or write them.
--
-- No data is deleted. Old resource rows keep whatever YouTube URLs were saved.
-- The application code (sessionActions, resourceActions, Gateway UI) has
-- already been updated to ignore these columns entirely.
--
-- When we are confident no production code depends on them we can drop them
-- in a separate, later migration.

comment on column public.downloads.youtube_channel_url is
  'LEGACY: no longer read or written. YouTube channel URL is now global site config (NEXT_PUBLIC_YOUTUBE_CHANNEL_URL).';

comment on column public.downloads.youtube_video_url is
  'LEGACY: no longer read or written. YouTube video URL is now global site config (NEXT_PUBLIC_YOUTUBE_VIDEO_URL).';
