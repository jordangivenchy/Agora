-- ═══════════════════════════════════════════════════════════════════════════
-- Update join_private_room() so code-holders can choose PRO / CON / Spectator.
--
-- Why: the v1 RPC always enrolled the caller as a spectator, which meant a
-- friend invited to a private debate couldn't actually debate. Now the client
-- passes role + stance and the RPC validates the stance slot before enrolling.
--
-- Run AFTER 20260417_private_rooms_rls.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the old single-argument signature so we don't leave an orphan overload.
drop function if exists public.join_private_room(text);

create or replace function public.join_private_room(
  p_code   text,
  p_role   text default 'debater',
  p_stance text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_room_id  uuid;
  v_existing_id    uuid;
  v_existing_role  text;
  v_existing_stance text;
  v_final_role   text;
  v_final_stance text;
  v_code   text := upper(trim(coalesce(p_code, '')));
  v_stance text := upper(trim(coalesce(p_stance, '')));
  v_slot_taken_by uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if length(v_code) = 0 then
    raise exception 'invite_code_required' using errcode = '22023';
  end if;

  if p_role not in ('debater', 'spectator') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  if p_role = 'debater' and v_stance not in ('PRO', 'CON') then
    raise exception 'stance_required' using errcode = '22023';
  end if;

  -- Locate the private room by its code (SECURITY DEFINER bypasses RLS).
  select id into v_room_id
  from public.debate_rooms
  where invite_code = v_code
    and is_private = true
    and status in ('live', 'created')
  limit 1;

  if v_room_id is null then
    raise exception 'invalid_or_expired_code' using errcode = 'P0002';
  end if;

  -- Existing participant row (active or previously left)?
  select id, role, stance
    into v_existing_id, v_existing_role, v_existing_stance
  from public.debate_participants
  where room_id = v_room_id and user_id = v_user_id
  limit 1;

  -- If they're already a debater in this room, keep their role/stance.
  -- Otherwise use what the caller requested.
  if v_existing_id is not null and v_existing_role = 'debater' then
    v_final_role   := 'debater';
    v_final_stance := v_existing_stance;
  else
    v_final_role   := p_role;
    v_final_stance := case when p_role = 'debater' then v_stance else null end;
  end if;

  -- Debater slot validation — the stance they want must not be held by
  -- someone else who is currently in the room.
  if v_final_role = 'debater' then
    select user_id into v_slot_taken_by
    from public.debate_participants
    where room_id = v_room_id
      and role    = 'debater'
      and stance  = v_final_stance
      and left_at is null
      and user_id <> v_user_id
    limit 1;

    if v_slot_taken_by is not null then
      raise exception 'stance_slot_taken' using errcode = 'P0001';
    end if;
  end if;

  -- Upsert participation.
  if v_existing_id is not null then
    update public.debate_participants
      set role      = v_final_role,
          stance    = v_final_stance,
          left_at   = null,
          joined_at = now()
      where id = v_existing_id;
  else
    insert into public.debate_participants (room_id, user_id, role, stance)
    values (v_room_id, v_user_id, v_final_role, v_final_stance);
  end if;

  return v_room_id;
end;
$$;

revoke all on function public.join_private_room(text, text, text) from public;
grant execute on function public.join_private_room(text, text, text) to authenticated;
