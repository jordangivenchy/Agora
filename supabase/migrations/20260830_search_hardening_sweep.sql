-- Search indexes, DM rate limiting, and the ghost-seat sweep.
-- Applied to the live DB on 2026-08-17.

-- ── Trigram indexes: the discovery search runs ilike '%q%' over these ──
create extension if not exists pg_trgm;

create index if not exists users_username_trgm_idx
  on public.users using gin (lower(username) gin_trgm_ops);
create index if not exists users_display_name_trgm_idx
  on public.users using gin (lower(coalesce(display_name, '')) gin_trgm_ops);
create index if not exists community_posts_title_trgm_idx
  on public.community_posts using gin (lower(title) gin_trgm_ops);
create index if not exists community_posts_body_trgm_idx
  on public.community_posts using gin (lower(coalesce(body, '')) gin_trgm_ops);
create index if not exists debate_rooms_motion_trgm_idx
  on public.debate_rooms using gin (lower(motion) gin_trgm_ops);

-- ── DM rate limit: at most 20 sends per minute per sender ──
create or replace function public.enforce_dm_rate_limit()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if (
    select count(*) from public.direct_messages
    where sender_id = new.sender_id
      and created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception 'dm_rate_limited: slow down — max 20 messages per minute';
  end if;
  return new;
end;
$$;

drop trigger if exists dm_rate_limit on public.direct_messages;
create trigger dm_rate_limit
  before insert on public.direct_messages
  for each row execute function public.enforce_dm_rate_limit();

-- ── Ghost seats: heartbeat + sweep ──
-- A force-closed tab never stamps left_at; the room page heartbeats
-- last_seen_at (touch_seat) and the sweep vacates anything stale.
alter table public.debate_participants
  add column if not exists last_seen_at timestamptz not null default now();

create or replace function public.touch_seat(p_room uuid)
returns void
language sql security definer
set search_path to 'public'
as $$
  update public.debate_participants
  set last_seen_at = now()
  where room_id = p_room and user_id = auth.uid() and left_at is null;
$$;
grant execute on function public.touch_seat(uuid) to authenticated;

create or replace function public.sweep_ghost_seats()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  n integer := 0;
  m integer := 0;
begin
  -- Seats in rooms that already ended.
  update public.debate_participants dp
  set left_at = now()
  from public.debate_rooms r
  where dp.room_id = r.id and r.status = 'ended' and dp.left_at is null;
  get diagnostics n = row_count;

  -- Stale seats in open rooms: no heartbeat for 5 minutes.
  update public.debate_participants dp
  set left_at = now()
  from public.debate_rooms r
  where dp.room_id = r.id
    and r.status in ('live', 'created', 'scheduled')
    and dp.left_at is null
    and greatest(coalesce(dp.last_seen_at, 'epoch'), coalesce(dp.joined_at, 'epoch')) < now() - interval '5 minutes';
  get diagnostics m = row_count;

  return n + m;
end;
$$;
-- Server-side only (cron / API routes with the service role).
revoke execute on function public.sweep_ghost_seats() from public, anon, authenticated;
