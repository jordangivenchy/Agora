-- Real enforcement for private-room access modes (follow-up to 20260865).
--
-- 20260865 added the access_mode column and a seat-INSERT gate, but the
-- bug sweep found the gate rested on a false premise: the live
-- debate_rooms SELECT policy is "Rooms are viewable by everyone"
-- USING (true), so a followers/friends room's whole row — including its
-- invite_code and hls_url — was world-readable. Any user could read the
-- code and walk in via join_private_room, and the replay/metadata leaked.
--
-- This migration makes the row itself the boundary: debate_rooms and
-- debate_participants become readable only when can_enter_room() passes.
-- Because can_enter_room short-circuits to true for non-private AND
-- code-mode rooms, this is a no-op for every existing room and every
-- public/code room going forward — only followers/friends rooms (0 today)
-- are actually restricted. Gating the room row transitively gates the
-- replay (get_debate_replay reads debate_rooms as the caller) and the
-- LiveKit token route.

-- ── 1. can_enter_room v2: exclude banned/kicked users ──────────────
-- The grandfather clause (existing participant → always in) let a kicked
-- user back into a followers/friends call: host_kick_user only sets
-- left_at + inserts a room_bans row, it never deletes the participant.
-- Check the ban BEFORE the grandfather. left_at is intentionally NOT
-- filtered — a plain leave/refresh keeps access (that is the code
-- escape-hatch surviving a reload); only an actual ban revokes it.
create or replace function public.can_enter_room(p_room uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when r.is_private = false then true
      when r.access_mode = 'code' then true
      when p_user is null then false
      when p_user = r.host_id then true
      when public.is_room_banned(r.id, p_user) then false
      when exists (
        select 1 from debate_participants dp
        where dp.room_id = r.id and dp.user_id = p_user
      ) then true
      when r.access_mode = 'followers' then exists (
        select 1 from user_follows f
        where f.follower_id = p_user and f.following_id = r.host_id
      )
      when r.access_mode = 'friends' then public.are_friends(p_user, r.host_id)
      else false
    end
    from debate_rooms r where r.id = p_room
  ), false);
$$;

-- ── 2. Row-level read gate on debate_rooms ─────────────────────────
-- Replaces the blanket "viewable by everyone" policy. The USING clause
-- calls the SECURITY DEFINER helper, whose internal read of debate_rooms
-- runs as the owner (bypassing RLS), so there is no policy recursion.
drop policy if exists "Rooms are viewable by everyone" on public.debate_rooms;
drop policy if exists "rooms readable when enterable" on public.debate_rooms;
create policy "rooms readable when enterable"
  on public.debate_rooms for select
  using ( public.can_enter_room(id, auth.uid()) );

-- ── 3. Row-level read gate on debate_participants ──────────────────
-- The roster is only as private as the room it belongs to. Same
-- short-circuit: public/code rooms stay fully readable.
drop policy if exists "Participants are viewable by everyone" on public.debate_participants;
drop policy if exists "participants readable when room enterable" on public.debate_participants;
create policy "participants readable when room enterable"
  on public.debate_participants for select
  using ( public.can_enter_room(room_id, auth.uid()) );

-- ── 4. get_room_gate: powers the denied screen ────────────────────
-- When the row is hidden by RLS the room page gets null and can't tell
-- "doesn't exist" from "not allowed", nor render the motion/host on the
-- denial screen. This definer RPC answers exactly that, and nothing more.
create or replace function public.get_room_gate(p_room uuid)
returns table(
  room_exists boolean,
  allowed boolean,
  motion text,
  host_username text,
  access_mode text,
  status text
)
language sql stable security definer set search_path = public
as $$
  select true,
         public.can_enter_room(r.id, auth.uid()),
         r.motion,
         u.username,
         r.access_mode,
         r.status
  from public.debate_rooms r
  join public.users u on u.id = r.host_id
  where r.id = p_room;
$$;
revoke all on function public.get_room_gate(uuid) from public;
grant execute on function public.get_room_gate(uuid) to authenticated, anon;
