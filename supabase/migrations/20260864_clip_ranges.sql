-- ─── Clips as ranges over the room recording ─────────────────────────
-- A clip no longer needs its own uploaded video: start/end seconds
-- over the room's VOD are enough — the player seeks the range inside
-- the existing HLS recording. Uploaded-file clips keep working
-- (video_url set, range null).

alter table public.clips
  add column if not exists start_seconds integer,
  add column if not exists end_seconds integer;

-- Replay discussion posts no longer carry the "watch the replay at
-- /agora/…" sentence — the thread embeds the video itself now.
create or replace function public.strip_replay_post_body() returns void
language sql security definer set search_path = public as $$
  update public.community_posts
  set body = null
  where body like 'Discussion for %watch the replay at /agora/%';
$$;
select public.strip_replay_post_body();
drop function public.strip_replay_post_body();

-- ensure_debate_discussion also stops writing that sentence for new
-- threads (patched in place over whatever version is live).
do $$
declare def text;
begin
  select pg_get_functiondef(oid) into def from pg_proc
  where proname = 'ensure_debate_discussion' and pronamespace = 'public'::regnamespace;
  def := replace(def,
    'format(''Discussion for "%s" — watch the replay at /agora/%s'',
           left(v_room.motion, 300), v_slug)',
    'null');
  execute def;
end $$;
