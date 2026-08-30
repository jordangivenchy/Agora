-- join_private_room was broken for EVERYONE: `returns table(room_id ...)`
-- makes the OUT param collide with the unqualified `where room_id = ...`
-- references in its body, so every invite-code join (spectator, debater,
-- host rejoin) died with SQLSTATE 42702 "column reference room_id is
-- ambiguous" before seating anyone. Dates back to the returns-table
-- rewrite in 20260421; found by the launch-QA role-simulation pass.
--
-- Fix: `#variable_conflict use_column` (precedent: 20260853_global_search)
-- so unqualified names inside queries resolve to table columns. Body is
-- otherwise byte-identical to the deployed version.

create or replace function public.join_private_room(
  p_code text,
  p_role text default 'debater',
  p_stance text default null
)
returns table(room_id uuid, queued boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid(); v_room uuid;
  v_code text := upper(trim(coalesce(p_code, ''))); v_stance text := upper(trim(coalesce(p_stance, '')));
  v_existing_id uuid; v_existing_role text; v_host_id uuid; v_status text;
begin
  if v_user_id is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public.is_suspended(v_user_id) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if length(v_code) = 0 then raise exception 'invite_code_required' using errcode = '22023'; end if;
  if p_role not in ('debater', 'spectator') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_role = 'debater' and v_stance not in ('PRO', 'CON') then raise exception 'stance_required' using errcode = '22023'; end if;
  select id, host_id, status into v_room, v_host_id, v_status
  from public.debate_rooms where invite_code = v_code and is_private = true and status in ('live', 'created') limit 1;
  if v_room is null then raise exception 'invalid_or_expired_code' using errcode = 'P0002'; end if;
  if public.is_room_banned(v_room, v_user_id) then
    raise exception using errcode = 'P0001', message = 'banned_from_room: You have been removed from this room by the host.';
  end if;
  if p_role = 'debater' and v_status = 'live' and v_user_id <> v_host_id then
    raise exception using errcode = 'P0001', message = 'debate_live: This discussion is already live — join as a spectator instead.';
  end if;
  if p_role = 'spectator' then
    select id, role into v_existing_id, v_existing_role from public.debate_participants where room_id = v_room and user_id = v_user_id;
    if v_existing_id is not null then
      update public.debate_participants set role = 'spectator', stance = null, left_at = null, joined_at = now() where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance) values (v_room, v_user_id, 'spectator', null);
    end if;
    return query select v_room, false; return;
  end if;
  if v_user_id = v_host_id then
    select id into v_existing_id from public.debate_participants where room_id = v_room and user_id = v_user_id;
    if v_existing_id is not null then
      update public.debate_participants set role = 'debater', stance = v_stance, left_at = null, joined_at = now() where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance) values (v_room, v_user_id, 'debater', v_stance);
    end if;
    return query select v_room, false; return;
  end if;
  update public.debate_queue set status = 'cancelled' where room_id = v_room and user_id = v_user_id and status = 'waiting';
  insert into public.debate_queue (room_id, user_id, stance, status) values (v_room, v_user_id, v_stance, 'waiting');
  select id, role into v_existing_id, v_existing_role from public.debate_participants where room_id = v_room and user_id = v_user_id;
  if v_existing_id is null then
    insert into public.debate_participants (room_id, user_id, role, stance) values (v_room, v_user_id, 'spectator', null);
  elsif v_existing_role <> 'debater' then
    update public.debate_participants set role = 'spectator', stance = null, left_at = null, joined_at = now() where id = v_existing_id;
  end if;
  return query select v_room, true;
end; $function$;
