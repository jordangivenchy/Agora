-- ═══════════════════════════════════════════════════════════════════════════
-- Hard enforcement for private rooms: Row Level Security + invite-code RPC.
-- Run this AFTER 20260417_team_sizes_and_spectator_rules.sql.
--
-- What this does
-- ──────────────
-- 1. Enables RLS on public.debate_rooms (safe no-op if already on).
-- 2. Adds SELECT policies so that:
--      • Public + private-with-spectators rooms are readable by anyone
--      • Fully-hidden private rooms are only readable by the host or by
--        participants who are currently joined (left_at is null)
-- 3. Keeps write access working for existing features:
--      • Anyone signed in can insert a room as themselves (host_id must match)
--      • Only the host can update or delete their own room
-- 4. Creates public.join_private_room(p_code text) RETURNS uuid:
--      • SECURITY DEFINER: bypasses RLS so it can read a hidden room by code
--      • Validates caller is authenticated + code is live
--      • Upserts the caller as a participant (spectator) so that subsequent
--        SELECTs on the room succeed via the membership policy
--      • Returns the matching room id
--
-- If you've already defined your own SELECT/INSERT/UPDATE policies on
-- debate_rooms, these policies are ADDITIVE — RLS OR's all policies together,
-- so nothing you currently allow will break. The new policies can only grant
-- more access, never revoke.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.debate_rooms enable row level security;

-- Drop previous versions of OUR policies so this file is safe to re-run.
drop policy if exists "debate_rooms_public_select"   on public.debate_rooms;
drop policy if exists "debate_rooms_host_select"     on public.debate_rooms;
drop policy if exists "debate_rooms_member_select"   on public.debate_rooms;
drop policy if exists "debate_rooms_self_insert"     on public.debate_rooms;
drop policy if exists "debate_rooms_host_update"     on public.debate_rooms;
drop policy if exists "debate_rooms_host_delete"     on public.debate_rooms;

-- SELECT ─────────────────────────────────────────────────────────────────────

-- Public rooms + private rooms that allow spectators are readable by anyone
create policy "debate_rooms_public_select"
  on public.debate_rooms for select
  using ( is_private = false or allow_spectators = true );

-- Host can always read their own rooms (including fully-hidden ones)
create policy "debate_rooms_host_select"
  on public.debate_rooms for select
  using ( auth.uid() = host_id );

-- Anyone currently joined as a participant can read the room.
-- This is what the RPC enables: after a code-holder is enrolled as spectator,
-- this policy makes the room readable for them going forward.
create policy "debate_rooms_member_select"
  on public.debate_rooms for select
  using (
    exists (
      select 1 from public.debate_participants dp
      where dp.room_id = debate_rooms.id
        and dp.user_id = auth.uid()
        and dp.left_at is null
    )
  );

-- INSERT / UPDATE / DELETE ───────────────────────────────────────────────────

create policy "debate_rooms_self_insert"
  on public.debate_rooms for insert
  with check ( auth.uid() = host_id );

create policy "debate_rooms_host_update"
  on public.debate_rooms for update
  using ( auth.uid() = host_id )
  with check ( auth.uid() = host_id );

create policy "debate_rooms_host_delete"
  on public.debate_rooms for delete
  using ( auth.uid() = host_id );

-- RPC ────────────────────────────────────────────────────────────────────────

create or replace function public.join_private_room(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_user_id uuid := auth.uid();
  v_existing_id uuid;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if length(v_code) = 0 then
    raise exception 'invite_code_required' using errcode = '22023';
  end if;

  -- Look up the room by code (SECURITY DEFINER bypasses the SELECT policies
  -- so we can see a fully-hidden private room by its code).
  select id into v_room_id
  from public.debate_rooms
  where invite_code = v_code
    and is_private = true
    and status in ('live', 'created')
  limit 1;

  if v_room_id is null then
    raise exception 'invalid_or_expired_code' using errcode = 'P0002';
  end if;

  -- Upsert a participant row for the caller (spectator by default).
  -- If they already have one (even if they left), just reinstate it without
  -- changing their role — a debater who rejoins stays a debater.
  select id into v_existing_id
  from public.debate_participants
  where room_id = v_room_id and user_id = v_user_id
  limit 1;

  if v_existing_id is not null then
    update public.debate_participants
      set left_at = null,
          joined_at = now()
      where id = v_existing_id;
  else
    insert into public.debate_participants (room_id, user_id, role, stance)
    values (v_room_id, v_user_id, 'spectator', null);
  end if;

  return v_room_id;
end;
$$;

-- Allow signed-in users to call it. Anon callers get an auth error above.
revoke all on function public.join_private_room(text) from public;
grant execute on function public.join_private_room(text) to authenticated;
