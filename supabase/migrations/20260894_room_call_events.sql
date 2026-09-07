-- Call diagnostics. Phones keep reporting "the room kicked me" and nothing
-- on the server can say why: the LiveKit disconnect reason, a token
-- failure, the access gate sending someone home — all of it happens on
-- the device. The room page and the call hook log those moments here
-- (through the RPC, never a direct insert), tagged with the user agent
-- and page state, so a report can be matched to what actually happened.
-- Nobody reads this table from the client; it's for the dashboard.

create table if not exists public.room_call_events (
  id         bigserial primary key,
  user_id    uuid references public.users(id) on delete cascade,
  room_id    uuid,
  event      text not null,
  reason     text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists room_call_events_room_idx on public.room_call_events (room_id, created_at desc);
create index if not exists room_call_events_user_idx on public.room_call_events (user_id, created_at desc);

alter table public.room_call_events enable row level security;
revoke all on public.room_call_events from public, anon, authenticated;

-- Signed-in only, capped at 200 rows per person per 10 minutes so a
-- reconnect loop can't fill the table.
create or replace function public.log_room_event(
  p_room uuid,
  p_event text,
  p_reason text default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  if (select count(*) from public.room_call_events
      where user_id = v_me and created_at > now() - interval '10 minutes') >= 200 then
    return;
  end if;
  insert into public.room_call_events (user_id, room_id, event, reason, meta)
  values (v_me, p_room, left(coalesce(p_event, ''), 40), left(p_reason, 300), coalesce(p_meta, '{}'::jsonb));
end;
$$;
revoke execute on function public.log_room_event(uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_room_event(uuid, text, text, jsonb) to authenticated;
