-- ============================================================
-- 20260851_debate_recordings.sql
--
-- Ended debates stop being dead ends: every recorded debate becomes a
-- replay page (/agora/<slug>-<short8>, same URL as the live room) with
-- its HLS VOD recording, the stage transcript, and a discussion thread.
--
--   debate_rooms.recording_url         — the persisted VOD playlist
--                                        (<HLS_PUBLIC_BASE_URL>/<room>/index.m3u8)
--                                        set by /api/egress start_hls and
--                                        KEPT when the stream stops (hls_url
--                                        is the live playlist and is nulled)
--   debate_rooms.recording_started_at  — when egress began; transcript
--                                        offsets are relative to this
--   debate_rooms.recording_ended_at    — when egress stopped (null if the
--                                        cron reaped it — still a recording)
--   debate_rooms.discussion_post_id    — lazily created community post
--                                        that hosts the post-debate thread
--
--   System community "Debates" (stable id) owns the discussion posts of
--   rooms that weren't hosted inside a community.
--
--   RPCs: get_debate_replay, get_debate_transcript, ensure_debate_discussion
--
-- Idempotent; run in the Supabase SQL editor.
-- ============================================================

-- ─── 1. Columns ──────────────────────────────────────────────
alter table public.debate_rooms
  add column if not exists recording_url text,
  add column if not exists recording_started_at timestamptz,
  add column if not exists recording_ended_at timestamptz,
  add column if not exists discussion_post_id uuid
    references public.community_posts(id) on delete set null;

create index if not exists idx_debate_rooms_recorded
  on public.debate_rooms (ended_at desc)
  where status = 'ended' and recording_url is not null;

-- ─── 2. The "Debates" system community ───────────────────────
-- Stable id so the RPCs (and any later migration) can refer to it.
-- Owned by the moderator account when one exists; created_by is nullable
-- so the row still lands on a fresh database.
do $$
declare
  v_owner uuid;
begin
  select id into v_owner
    from public.users
   where is_moderator = true
   order by (username = 'jordan') desc, created_at asc
   limit 1;

  insert into public.communities (id, name, kind, description, color, created_by, is_private)
  values (
    '00000000-0000-4000-8000-00000000deba',
    'Debates',
    'topic-circle',
    'Every recorded debate on AgoraSphere gets its discussion thread here. Watch the replay, read the transcript, then make your case.',
    '#3b6cf6',
    v_owner,
    false
  )
  on conflict (id) do update
    set name        = excluded.name,
        description = excluded.description,
        is_private  = false,
        created_by  = coalesce(public.communities.created_by, excluded.created_by);

  if v_owner is not null then
    insert into public.community_members (community_id, user_id, role)
    values ('00000000-0000-4000-8000-00000000deba', v_owner, 'owner')
    on conflict (community_id, user_id) do update set role = 'owner';
  end if;
end $$;

-- ─── 3. get_debate_replay ────────────────────────────────────
-- Rooms are public performances (debate_rooms select policy), so the
-- replay header reads through RLS as the caller; the function is NOT a
-- definer. Private rooms hidden from the caller come back as null.
drop function if exists public.get_debate_replay(uuid);
create function public.get_debate_replay(p_room uuid)
returns jsonb
language sql stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'id', r.id,
    'motion', r.motion,
    'topic_key', r.topic_key,
    'status', r.status,
    'created_at', r.created_at,
    'started_at', r.started_at,
    'ended_at', r.ended_at,
    'viewer_count', r.viewer_count,
    'community_id', r.community_id,
    'thumbnail_url', r.thumbnail_url,
    'host', (
      select jsonb_build_object(
        'id', u.id, 'username', u.username,
        'display_name', u.display_name, 'avatar_url', u.avatar_url)
      from public.users u where u.id = r.host_id
    ),
    'speakers', coalesce((
      select jsonb_agg(s - 'rank' order by s->>'rank', s->>'username')
      from (
        select distinct on (p.user_id) jsonb_build_object(
          'id', u.id, 'username', u.username,
          'display_name', u.display_name, 'avatar_url', u.avatar_url,
          'role', case
                    when p.user_id = r.host_id then 'host'
                    when p.stage_role in ('host', 'cohost', 'speaker') then p.stage_role
                    else 'speaker'
                  end,
          'side', p.stance,
          'rank', case
                    when p.user_id = r.host_id then 0
                    when p.stage_role = 'cohost' then 1
                    else 2
                  end
        ) as s
        from public.debate_participants p
        join public.users u on u.id = p.user_id
        where p.room_id = r.id
          and (p.user_id = r.host_id
               or p.role = 'debater'
               or p.stage_role in ('host', 'cohost', 'speaker'))
        order by p.user_id, p.joined_at asc
      ) sp
    ), '[]'::jsonb),
    'recording_url', r.recording_url,
    'recording_started_at', r.recording_started_at,
    'recording_ended_at', r.recording_ended_at,
    'discussion_post_id', r.discussion_post_id,
    'discussion_comment_count', coalesce((
      select count(*) from public.community_comments c
      where c.post_id = r.discussion_post_id
    ), 0),
    'transcript_count', (
      select count(*) from public.debate_utterances du where du.room_id = r.id
    )
  )
  from public.debate_rooms r
  where r.id = p_room;
$$;
revoke all on function public.get_debate_replay(uuid) from public;
grant execute on function public.get_debate_replay(uuid) to anon, authenticated;

-- ─── 4. get_debate_transcript ────────────────────────────────
-- Same semantics as reading debate_utterances directly (public stage
-- speech; select policy `using (true)`), ordered, with speaker identity
-- and the offset in seconds from the recording start (null when the
-- room wasn't recorded — the transcript still reads fine on its own).
drop function if exists public.get_debate_transcript(uuid, integer);
create function public.get_debate_transcript(p_room uuid, p_limit integer default 2000)
returns table(
  id uuid,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  content text,
  created_at timestamptz,
  offset_seconds double precision
)
language sql stable
set search_path to 'public'
as $$
  select
    du.id,
    du.user_id,
    coalesce(u.username, '(deleted)')::text,
    u.display_name,
    u.avatar_url,
    du.content,
    du.created_at,
    case
      when r.recording_started_at is null then null
      else greatest(0, extract(epoch from (du.created_at - r.recording_started_at)))::double precision
    end
  from public.debate_utterances du
  join public.debate_rooms r on r.id = du.room_id
  left join public.users u on u.id = du.user_id
  where du.room_id = p_room
  order by du.created_at asc
  limit greatest(1, least(coalesce(p_limit, 2000), 5000));
$$;
revoke all on function public.get_debate_transcript(uuid, integer) from public;
grant execute on function public.get_debate_transcript(uuid, integer) to anon, authenticated;

-- ─── 5. ensure_debate_discussion ─────────────────────────────
-- Lazily creates the discussion post for an ended room and returns its
-- id. Any signed-in user may trigger creation (the first person to hit
-- "Join the discussion"); the post is authored by the host and lives in
-- the room's own public community when it has one, else in "Debates".
-- Definer so the caller doesn't need insert rights as the host; the
-- room row is locked so two concurrent callers can't create two posts.
drop function if exists public.ensure_debate_discussion(uuid);
create function public.ensure_debate_discussion(p_room uuid)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_room      public.debate_rooms%rowtype;
  v_community uuid;
  v_post      uuid;
  v_short     text;
  v_slug      text;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if public.is_suspended(auth.uid()) then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select * into v_room from public.debate_rooms where id = p_room for update;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  if v_room.status <> 'ended' then
    raise exception 'room_not_ended' using errcode = 'P0001';
  end if;
  if v_room.discussion_post_id is not null
     and exists (select 1 from public.community_posts where id = v_room.discussion_post_id) then
    return v_room.discussion_post_id;
  end if;

  -- Prefer the hosting community when it's public; otherwise "Debates".
  v_community := '00000000-0000-4000-8000-00000000deba';
  if v_room.community_id is not null and exists (
       select 1 from public.communities c
       where c.id = v_room.community_id and not c.is_private) then
    v_community := v_room.community_id;
  end if;

  -- Same slug rule as src/lib/urls.ts roomPath(): <motion-slug>-<short8>.
  v_short := left(v_room.id::text, 8);
  v_slug := left(regexp_replace(
              regexp_replace(lower(v_room.motion), '[^a-z0-9]+', '-', 'g'),
              '(^-+|-+$)', '', 'g'), 60);
  v_slug := regexp_replace(v_slug, '-+$', '');
  v_slug := case when v_slug = '' then v_short else v_slug || '-' || v_short end;

  insert into public.community_posts (community_id, author_id, title, body)
  values (
    v_community,
    v_room.host_id,
    left(v_room.motion, 200),
    format('Discussion for the debate "%s" — watch the replay at /agora/%s',
           left(v_room.motion, 300), v_slug)
  )
  returning id into v_post;

  update public.debate_rooms set discussion_post_id = v_post where id = p_room;
  return v_post;
end;
$$;
revoke all on function public.ensure_debate_discussion(uuid) from public, anon;
grant execute on function public.ensure_debate_discussion(uuid) to authenticated;
