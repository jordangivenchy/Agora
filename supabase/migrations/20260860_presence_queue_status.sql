-- ─── Presence: "in queue" as a distinct status ───────────────────────
-- user_presence learns a queued flag so friends lists can distinguish
-- "in a room" / "in queue for a debate" / merely online. Written only
-- through touch_presence like everything else here (auth.uid() is the
-- identity — spoof-proof). The old single-arg touch_presence is
-- dropped rather than overloaded: two visible overloads would make
-- PostgREST's named-argument dispatch ambiguous for existing clients,
-- while one function with defaults keeps the old {p_room} call working.

alter table public.user_presence
  add column if not exists queued boolean not null default false;

drop function if exists public.touch_presence(uuid);

create or replace function public.touch_presence(
  p_room uuid default null,
  p_queued boolean default false
)
returns void
language sql security definer
set search_path to 'public'
as $$
  insert into public.user_presence (user_id, room_id, queued, last_seen_at)
  select auth.uid(), p_room, coalesce(p_queued, false), now()
  where auth.uid() is not null
  on conflict (user_id) do update
    set room_id = excluded.room_id,
        queued = excluded.queued,
        last_seen_at = now();
$$;
grant execute on function public.touch_presence(uuid, boolean) to authenticated;
revoke execute on function public.touch_presence(uuid, boolean) from public, anon;
