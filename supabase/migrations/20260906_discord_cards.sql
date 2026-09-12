-- ─── Discord: one card per room, edited as the room moves along ──────
-- A "Live now" card that stays "Live now" after the room ends sends
-- people into a dead room. The app now remembers the Discord message
-- it posted for each room (and each recording and featured post) and
-- rewrites it as the room goes scheduled → live → ended → recorded.
-- This table is the memory; the room trigger now also raises the
-- scheduling and ending changes. Same contract as 20260905: trigger →
-- pg_net → /api/internal/discord, which re-reads the row.

create table if not exists public.discord_cards (
  kind text not null check (kind in ('room', 'recording', 'post')),
  ref_id uuid not null,
  channel text not null,
  message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, ref_id)
);

-- Server-only: RLS on with no policies, so only the service role reads or writes.
alter table public.discord_cards enable row level security;
revoke all on table public.discord_cards from public, anon, authenticated;

-- Rooms: scheduled, live, ended, cancelled, recorded. "room_live" keeps
-- its own event (the moment that matters most); every other change of
-- status or schedule is "room_changed" and the route works out the
-- phase from the row. Private rooms never leave the house.
create or replace function public.notify_discord_room_state()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_private then
    return new;
  end if;

  if new.status = 'live'
     and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    perform public.notify_discord('room_live', new.id);
  elsif tg_op = 'INSERT' and new.scheduled_start is not null then
    perform public.notify_discord('room_changed', new.id);
  elsif tg_op = 'UPDATE'
     and (old.status is distinct from new.status
          or old.scheduled_start is distinct from new.scheduled_start) then
    perform public.notify_discord('room_changed', new.id);
  end if;

  if tg_op = 'UPDATE'
     and new.recording_ended_at is not null
     and old.recording_ended_at is null
     and new.recording_url is not null then
    perform public.notify_discord('recording_ready', new.id);
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_discord_room_state() from public, anon, authenticated;

drop trigger if exists trg_notify_discord_room_state on public.debate_rooms;
create trigger trg_notify_discord_room_state
  after insert or update of status, scheduled_start, recording_ended_at
  on public.debate_rooms
  for each row
  execute function public.notify_discord_room_state();
