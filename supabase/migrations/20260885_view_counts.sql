-- Views, actually counted. viewer_count had no writer on the amphitheater
-- route (its only writer was the host's client on the retired classic
-- room page), so every room showed 0. New model per product decision:
--
--   LIVE   → viewer_count = UNIQUE people who were in the room while it
--            was live. Fed by the in-room presence heartbeat
--            (touch_presence) recording each user once per room in
--            room_viewers; the room row's counter increments on first
--            sight. Signed-in viewers only (HLS overflow lurkers have no
--            presence row — acceptable for now).
--
--   REPLAY → replay_views = raw view count, one per watch, repeats
--            included, anonymous included. bump_replay_view() increments
--            and returns the new total; the replay page calls it once
--            per load.

create table if not exists public.room_viewers (
  room_id    uuid not null references public.debate_rooms(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  first_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- Locked table: written only by the definer functions below.
alter table public.room_viewers enable row level security;
revoke all on public.room_viewers from anon, authenticated;

alter table public.debate_rooms
  add column if not exists replay_views integer not null default 0;

create or replace function public.touch_presence(p_room uuid default null, p_queued boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;

  insert into public.user_presence (user_id, room_id, queued, last_seen_at)
  values (v_me, p_room, coalesce(p_queued, false), now())
  on conflict (user_id) do update
    set room_id = excluded.room_id,
        queued = excluded.queued,
        last_seen_at = now();

  -- First heartbeat from this user in a LIVE room = one unique viewer.
  if p_room is not null then
    insert into public.room_viewers (room_id, user_id)
    select p_room, v_me
    where exists (select 1 from public.debate_rooms r where r.id = p_room and r.status = 'live')
    on conflict do nothing;
    if found then
      update public.debate_rooms
      set viewer_count = coalesce(viewer_count, 0) + 1
      where id = p_room;
    end if;
  end if;
end;
$$;

-- One replay view, no dedupe by design. Anonymous viewers count; access
-- follows the room gate so hidden rooms can't be probed or inflated.
create or replace function public.bump_replay_view(p_room uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_views integer;
begin
  if not public.can_enter_room(p_room, auth.uid()) then
    return null;
  end if;
  update public.debate_rooms
  set replay_views = coalesce(replay_views, 0) + 1
  where id = p_room and status = 'ended' and recording_url is not null
  returning replay_views into v_views;
  return v_views;
end;
$$;

grant execute on function public.bump_replay_view(uuid) to anon, authenticated;
