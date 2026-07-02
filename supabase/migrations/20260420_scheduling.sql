-- ═══════════════════════════════════════════════════════════════════════════
-- Scheduled debates
--
-- What this adds
-- ──────────────
-- 1. A BEFORE INSERT/UPDATE trigger on debate_rooms that caps each host at
--    3 future-scheduled rooms (status = 'created' AND scheduled_start > now).
--    This enforces the product rule regardless of what the client sends.
-- 2. get_user_live_and_scheduled(uid) — replaces get_user_recent_debates on
--    the public profile modal. Returns ONLY debates the user is actively in
--    or has coming up; excludes ended/cancelled.
--
-- Run AFTER 20260419_follows_search_history.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Enforce max 3 scheduled rooms per host ──────────────────────────────
create or replace function public.enforce_max_scheduled_rooms()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  -- Only care about rows that REPRESENT a future scheduled debate.
  if NEW.scheduled_start is null
     or NEW.status not in ('created', 'live')
     or NEW.scheduled_start <= now() then
    return NEW;
  end if;

  select count(*)
    into v_count
  from public.debate_rooms
  where host_id         = NEW.host_id
    and status          = 'created'
    and scheduled_start is not null
    and scheduled_start > now()
    and id              <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_count >= 3 then
    raise exception 'max_scheduled_rooms'
      using errcode = 'P0001',
            message = 'You can schedule at most 3 debates at once. End or cancel one first.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_max_scheduled_rooms on public.debate_rooms;
create trigger trg_enforce_max_scheduled_rooms
  before insert or update on public.debate_rooms
  for each row execute function public.enforce_max_scheduled_rooms();

-- ─── 2. get_user_live_and_scheduled ─────────────────────────────────────────
-- Used on the public profile modal. Returns the target user's currently-live
-- debates + any scheduled debates they're rostered in. Ended rooms are
-- excluded so this list doesn't double as "history".
create or replace function public.get_user_live_and_scheduled(p_user uuid)
returns table (
  room_id         uuid,
  motion          text,
  topic_key       text,
  status          text,
  stance          text,
  started_at      timestamptz,
  scheduled_start timestamptz,
  is_scheduled    boolean,
  is_private      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.motion,
    r.topic_key,
    r.status,
    dp.stance,
    r.started_at,
    r.scheduled_start,
    (r.status = 'created'
       and r.scheduled_start is not null
       and r.scheduled_start > now()) as is_scheduled,
    r.is_private
  from public.debate_participants dp
  join public.debate_rooms r on r.id = dp.room_id
  where dp.user_id = p_user
    and dp.role    = 'debater'
    and dp.left_at is null
    and (r.is_private = false or r.allow_spectators = true)
    and (
      r.status = 'live'
      or (r.status = 'created'
          and r.scheduled_start is not null
          and r.scheduled_start > now())
    )
  order by
    (case when r.status = 'live' then 0 else 1 end),   -- live first
    r.started_at      desc nulls last,
    r.scheduled_start asc  nulls last;
$$;

revoke all on function public.get_user_live_and_scheduled(uuid) from public;
grant execute on function public.get_user_live_and_scheduled(uuid) to authenticated, anon;
