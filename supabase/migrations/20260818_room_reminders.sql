-- Scheduled-discussion reminders.
--
-- Users can ask to be notified when a scheduled discussion goes live; the
-- homepage Browse tabs order scheduled rooms by how many people did. When
-- the room flips live, reminder-setters get a 'room_live' notification
-- (regardless of their notify_room_live preference — the reminder is an
-- explicit opt-in) and the reminder rows are consumed.

-- ─── Table ───────────────────────────────────────────────────
create table if not exists public.room_reminders (
  room_id    uuid not null references public.debate_rooms(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_reminders enable row level security;
-- No client policies: all access goes through the security-definer RPCs.

-- ─── Toggle my reminder ──────────────────────────────────────
-- Returns the new state (true = reminder set, false = removed).
create or replace function public.toggle_room_reminder(p_room uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated: Sign in to set a reminder.';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if not exists (
    select 1 from public.debate_rooms r
    where r.id = p_room
      and r.status in ('created', 'scheduled')
      and r.is_private = false
  ) then
    raise exception using errcode = 'P0001', message = 'room_unavailable: This room is not open for reminders.';
  end if;

  delete from public.room_reminders where room_id = p_room and user_id = v_me;
  if found then
    return false;
  end if;
  insert into public.room_reminders (room_id, user_id) values (p_room, v_me);
  return true;
end;
$$;
revoke execute on function public.toggle_room_reminder(uuid) from anon;

-- ─── Counts for listings ─────────────────────────────────────
-- Reminder count (+ whether the caller set one) for a batch of rooms.
-- Anon-callable: counts are public signal, am_set is false when signed out.
create or replace function public.get_room_reminders(p_rooms uuid[])
returns table (room_id uuid, reminder_count bigint, am_set boolean)
language sql
stable
security definer
set search_path = public
as $$
  select rr.room_id,
         count(*)::bigint,
         coalesce(bool_or(rr.user_id = auth.uid()), false)
  from public.room_reminders rr
  where rr.room_id = any (p_rooms)
  group by rr.room_id;
$$;

-- ─── Fan out on go-live, then consume ────────────────────────
-- Extends 20260814's notify_room_live: followers (pref-gated) plus
-- reminder-setters (explicit opt-in, not pref-gated), deduplicated.
create or replace function public.notify_room_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fires on creation as live or on a scheduled room flipping live.
  -- Public rooms only — private rooms are invite-only by definition.
  if new.status = 'live'
     and (tg_op = 'INSERT' or old.status is distinct from 'live')
     and new.is_private = false then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select s.uid, 'room_live', new.host_id, new.id
    from (
      select f.follower_id as uid
      from public.user_follows f
      where f.following_id = new.host_id
        and f.follower_id <> new.host_id
        and coalesce((select notify_room_live from public.user_settings
                      where user_id = f.follower_id), true)
      union
      select rr.user_id
      from public.room_reminders rr
      where rr.room_id = new.id
        and rr.user_id <> new.host_id
    ) s;
    delete from public.room_reminders where room_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_room_live() from anon, authenticated;
