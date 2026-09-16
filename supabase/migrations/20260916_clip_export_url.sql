-- The clip, rendered upright as a file someone can post. Written by the
-- export route with the service role; read by anyone who can read the
-- clip, so a second person gets the same file instead of a second render.
alter table public.clips
  add column if not exists export_url text;
