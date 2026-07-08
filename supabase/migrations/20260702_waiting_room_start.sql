-- ============================================================
-- 20260702_waiting_room_start.sql
--
-- Live debates are now spectator-only, so rooms must open in a
-- joinable waiting state. create_room previously set immediate
-- (non-scheduled) rooms straight to 'live'; now every room opens
-- as 'created' (the existing WAITING state) and the host starts
-- the debate explicitly with the Start Debate button. Once live,
-- new debater joins are blocked in the UI.
-- ============================================================

create or replace function public.create_room(
  p_motion              text,
  p_topic_key           text,
  p_language            text,
  p_stance              text,
  p_is_private          boolean,
  p_allow_spectators    boolean,
  p_pro_size            int,
  p_con_size            int,
  p_time_limit_seconds  int,
  p_scheduled_start     timestamptz
)
returns table (room_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_room_id  uuid;
  v_code     text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if char_length(trim(p_motion)) = 0 then
    raise exception 'motion_required' using errcode = 'P0001';
  end if;

  if p_pro_size + p_con_size > 20 then
    raise exception 'team_size_too_large' using errcode = 'P0001';
  end if;

  if p_is_private then
    v_code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  else
    v_code := null;
  end if;

  if p_scheduled_start is not null
     and p_scheduled_start <= now() + interval '60 seconds' then
    raise exception 'scheduled_start_too_soon' using errcode = 'P0001';
  end if;

  -- Every room opens in the 'created' waiting state. The host goes live
  -- explicitly via Start Debate (started_at is stamped at that moment).
  insert into public.debate_rooms (
    motion, host_id, topic_key, format, language,
    status, is_private, invite_code, allow_spectators,
    pro_size, con_size, fact_check_intensity, time_limit_seconds,
    allow_audience_questions, recording_consent,
    scheduled_start, started_at
  ) values (
    trim(p_motion), v_me, p_topic_key, 'open', p_language,
    'created', p_is_private, v_code,
    case when p_is_private then p_allow_spectators else true end,
    p_pro_size, p_con_size, 'off', p_time_limit_seconds,
    false, false,
    p_scheduled_start, null
  )
  returning id into v_room_id;

  insert into public.debate_participants (room_id, user_id, role, stance)
  values (v_room_id, v_me, 'debater', p_stance);

  return query select v_room_id, v_code;
end;
$$;
