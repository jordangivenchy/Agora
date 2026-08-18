-- Spoof-proof presence. The old realtime presence channel trusted a
-- client-chosen payload ({ user_id }), so anyone could impersonate anyone's
-- online status. This table is written only through touch_presence(), which
-- takes identity from auth.uid() — clients heartbeat it and read each
-- other's rows via realtime; a row older than ~90s counts as offline.
-- Applied to the live DB on 2026-08-17.

create table if not exists public.user_presence (
  user_id uuid primary key references public.users(id) on delete cascade,
  room_id uuid references public.debate_rooms(id) on delete set null,
  last_seen_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;

drop policy if exists "presence readable by everyone" on public.user_presence;
create policy "presence readable by everyone" on public.user_presence
  for select using (true);
-- No insert/update/delete policies: writes go through the RPC only.

create or replace function public.touch_presence(p_room uuid default null)
returns void
language sql security definer
set search_path to 'public'
as $$
  insert into public.user_presence (user_id, room_id, last_seen_at)
  select auth.uid(), p_room, now()
  where auth.uid() is not null
  on conflict (user_id) do update
    set room_id = excluded.room_id, last_seen_at = now();
$$;
grant execute on function public.touch_presence(uuid) to authenticated;
revoke execute on function public.touch_presence(uuid) from public, anon;

create or replace function public.clear_presence()
returns void
language sql security definer
set search_path to 'public'
as $$
  delete from public.user_presence where user_id = auth.uid();
$$;
grant execute on function public.clear_presence() to authenticated;
revoke execute on function public.clear_presence() from public, anon;

-- Realtime change feed for the presence map.
do $$
begin
  alter publication supabase_realtime add table public.user_presence;
exception when duplicate_object then null;
end $$;
