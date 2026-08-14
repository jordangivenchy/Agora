-- ============================================================
-- 20260706_context_menu_moderation.sql
--
-- Infrastructure for the unified user context menu:
--   1. user_blocks           — block/unblock (severs follows both ways)
--   2. room_bans             — host kicks / timeouts / permanent room bans,
--                              enforced at the RLS layer AND inside the
--                              private-room join RPC (so bans hold even
--                              against direct API calls)
--   3. host RPCs             — kick, ban/timeout, role changes (stage /
--                              audience), all verifying host server-side
--   4. moderator platform    — users.is_moderator + suspended_until,
--                              mod_notes, warn/suspend RPCs, and a single
--                              moderation-panel read RPC
-- ============================================================

-- ─── 1. Blocks ──────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "Users can view their own blocks" on public.user_blocks;
create policy "Users can view their own blocks"
  on public.user_blocks for select using (auth.uid() = blocker_id);

create or replace function public.block_user(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_target = v_me then raise exception 'cannot_block_self' using errcode = 'P0001'; end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, p_target)
  on conflict do nothing;

  -- Blocking severs the relationship both ways.
  delete from public.user_follows
  where (follower_id = v_me and following_id = p_target)
     or (follower_id = p_target and following_id = v_me);
end;
$$;

create or replace function public.unblock_user(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_target;
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ─── 2. Room bans (kick = leave now; ban/timeout = can't come back) ───
create table if not exists public.room_bans (
  room_id uuid not null references public.debate_rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  banned_by uuid references public.users(id),
  expires_at timestamptz,          -- null = permanent for this room
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_bans enable row level security;

drop policy if exists "Users can see their own room bans" on public.room_bans;
create policy "Users can see their own room bans"
  on public.room_bans for select using (auth.uid() = user_id);

create or replace function public.is_room_banned(p_room uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_bans
    where room_id = p_room and user_id = p_user
      and (expires_at is null or expires_at > now())
  );
$$;

-- Enforce bans at the RLS layer for the public join/rejoin paths.
drop policy if exists "Authenticated users can join rooms" on public.debate_participants;
create policy "Authenticated users can join rooms"
  on public.debate_participants for insert
  with check (
    auth.uid() = user_id
    and not public.is_room_banned(room_id, auth.uid())
  );

drop policy if exists "Users can update their own participation" on public.debate_participants;
create policy "Users can update their own participation"
  on public.debate_participants for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and not public.is_room_banned(room_id, auth.uid())
  );

-- ─── 3. Host RPCs ───────────────────────────────────────────
create or replace function public.host_kick_user(p_room uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid(); v_host uuid;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select host_id into v_host from public.debate_rooms where id = p_room;
  if v_host is null then raise exception 'room_not_found' using errcode = 'P0002'; end if;
  if v_host <> v_me then raise exception 'not_host' using errcode = '42501'; end if;
  if p_user = v_me then raise exception 'cannot_kick_self' using errcode = 'P0001'; end if;

  update public.debate_participants
     set left_at = now(), hand_raised_at = null
   where room_id = p_room and user_id = p_user and left_at is null;

  update public.debate_queue
     set status = 'cancelled'
   where room_id = p_room and user_id = p_user and status = 'waiting';
end;
$$;

-- Timeout = ban with an expiry; permanent room ban = null expiry.
create or replace function public.host_ban_user(
  p_room uuid, p_user uuid, p_minutes int default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_me uuid := auth.uid(); v_host uuid;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select host_id into v_host from public.debate_rooms where id = p_room;
  if v_host is null then raise exception 'room_not_found' using errcode = 'P0002'; end if;
  if v_host <> v_me then raise exception 'not_host' using errcode = '42501'; end if;
  if p_user = v_me then raise exception 'cannot_ban_self' using errcode = 'P0001'; end if;

  insert into public.room_bans (room_id, user_id, banned_by, expires_at)
  values (
    p_room, p_user, v_me,
    case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end
  )
  on conflict (room_id, user_id) do update
    set expires_at = excluded.expires_at, banned_by = excluded.banned_by, created_at = now();

  perform public.host_kick_user_internal(p_room, p_user);
end;
$$;

-- Internal kick without the host re-check (called from host_ban_user
-- after the host was already verified).
create or replace function public.host_kick_user_internal(p_room uuid, p_user uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.debate_participants
     set left_at = now(), hand_raised_at = null
   where room_id = p_room and user_id = p_user and left_at is null;
  update public.debate_queue
     set status = 'cancelled'
   where room_id = p_room and user_id = p_user and status = 'waiting';
$$;
revoke all on function public.host_kick_user_internal(uuid, uuid) from public;

-- Stage management: promote a spectator to debater / demote to audience.
create or replace function public.host_set_participant_role(
  p_room uuid, p_user uuid, p_role text, p_stance text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_room record;
  v_row uuid;
  v_taken int;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_room from public.debate_rooms where id = p_room for update;
  if v_room is null then raise exception 'room_not_found' using errcode = 'P0002'; end if;
  if v_room.host_id <> v_me then raise exception 'not_host' using errcode = '42501'; end if;
  if v_room.status not in ('created', 'live') then
    raise exception 'room_not_active' using errcode = 'P0001';
  end if;
  if p_role not in ('debater', 'spectator') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  select id into v_row
  from public.debate_participants
  where room_id = p_room and user_id = p_user and left_at is null;
  if v_row is null then
    raise exception 'not_in_room' using errcode = 'P0002';
  end if;

  if p_role = 'debater' then
    if p_stance not in ('PRO', 'CON') then
      raise exception 'stance_required' using errcode = '22023';
    end if;
    select count(*) into v_taken
    from public.debate_participants
    where room_id = p_room and role = 'debater' and stance = p_stance
      and left_at is null and user_id <> p_user;
    if p_stance = 'PRO' and v_taken >= coalesce(v_room.pro_size, 1) then
      raise exception 'pro_slot_full' using errcode = 'P0001';
    end if;
    if p_stance = 'CON' and v_taken >= coalesce(v_room.con_size, 1) then
      raise exception 'con_slot_full' using errcode = 'P0001';
    end if;
    update public.debate_participants
       set role = 'debater', stance = p_stance, hand_raised_at = null
     where id = v_row;
    update public.debate_queue
       set status = 'matched'
     where room_id = p_room and user_id = p_user and status = 'waiting';
  else
    update public.debate_participants
       set role = 'spectator', stance = null, hand_raised_at = null
     where id = v_row;
  end if;
end;
$$;

revoke all on function public.host_kick_user(uuid, uuid) from public;
revoke all on function public.host_ban_user(uuid, uuid, int) from public;
revoke all on function public.host_set_participant_role(uuid, uuid, text, text) from public;
grant execute on function public.host_kick_user(uuid, uuid) to authenticated;
grant execute on function public.host_ban_user(uuid, uuid, int) to authenticated;
grant execute on function public.host_set_participant_role(uuid, uuid, text, text) to authenticated;

-- Enforce room bans in the private-room invite flow too (security definer
-- RPCs bypass RLS, so the check must live inside the function).
create or replace function public.join_private_room(
  p_code   text,
  p_role   text default 'debater',
  p_stance text default null
) returns table (room_id uuid, queued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_room    uuid;
  v_code    text := upper(trim(coalesce(p_code, '')));
  v_stance  text := upper(trim(coalesce(p_stance, '')));
  v_existing_id   uuid;
  v_existing_role text;
  v_host_id uuid;
  v_status  text;
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

  select id, host_id, status into v_room, v_host_id, v_status
  from public.debate_rooms
  where invite_code = v_code
    and is_private = true
    and status in ('live', 'created')
  limit 1;

  if v_room is null then
    raise exception 'invalid_or_expired_code' using errcode = 'P0002';
  end if;

  if public.is_room_banned(v_room, v_user_id) then
    raise exception 'banned_from_room'
      using errcode = 'P0001',
            message = 'You have been removed from this room by the host.';
  end if;

  if p_role = 'debater'
     and v_status = 'live'
     and v_user_id <> v_host_id then
    raise exception 'debate_live'
      using errcode = 'P0001',
            message = 'This debate is already live — join as a spectator instead.';
  end if;

  if p_role = 'spectator' then
    select id, role into v_existing_id, v_existing_role
    from public.debate_participants
    where room_id = v_room and user_id = v_user_id;

    if v_existing_id is not null then
      update public.debate_participants
         set role = 'spectator', stance = null, left_at = null, joined_at = now()
       where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance)
      values (v_room, v_user_id, 'spectator', null);
    end if;

    return query select v_room, false;
    return;
  end if;

  if v_user_id = v_host_id then
    select id into v_existing_id
    from public.debate_participants
    where room_id = v_room and user_id = v_user_id;

    if v_existing_id is not null then
      update public.debate_participants
         set role = 'debater', stance = v_stance, left_at = null, joined_at = now()
       where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance)
      values (v_room, v_user_id, 'debater', v_stance);
    end if;

    return query select v_room, false;
    return;
  end if;

  update public.debate_queue
     set status = 'cancelled'
   where room_id = v_room and user_id = v_user_id and status = 'waiting';

  insert into public.debate_queue (room_id, user_id, stance, status)
  values (v_room, v_user_id, v_stance, 'waiting');

  select id, role into v_existing_id, v_existing_role
  from public.debate_participants
  where room_id = v_room and user_id = v_user_id;

  if v_existing_id is null then
    insert into public.debate_participants (room_id, user_id, role, stance)
    values (v_room, v_user_id, 'spectator', null);
  elsif v_existing_role <> 'debater' then
    update public.debate_participants
       set role = 'spectator', stance = null, left_at = null, joined_at = now()
     where id = v_existing_id;
  end if;

  return query select v_room, true;
end;
$$;

-- ─── 4. Moderator platform ──────────────────────────────────
alter table public.users add column if not exists is_moderator boolean not null default false;
alter table public.users add column if not exists suspended_until timestamptz;

create table if not exists public.mod_notes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  author_id uuid references public.users(id),
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.mod_notes enable row level security;
-- No policies: RPC-only.

create or replace function public.assert_moderator()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not coalesce((select is_moderator from public.users where id = auth.uid()), false) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
end;
$$;

-- Everything the moderation panel needs about a user, in one call.
create or replace function public.mod_get_user_moderation(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.assert_moderator();
  return jsonb_build_object(
    'suspended_until', (select suspended_until from public.users where id = p_user),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'context', r.context,
        'description', r.description, 'message_content', r.message_content,
        'status', r.status, 'created_at', r.created_at
      ) order by r.created_at desc)
      from public.user_reports r where r.reported_user_id = p_user
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'note', n.note, 'created_at', n.created_at,
        'author', (select username from public.users u where u.id = n.author_id)
      ) order by n.created_at desc)
      from public.mod_notes n where n.user_id = p_user
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mod_add_note(p_user uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_moderator();
  insert into public.mod_notes (user_id, author_id, note)
  values (p_user, auth.uid(), trim(p_note));
end;
$$;

create or replace function public.mod_warn_user(p_user uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_moderator();
  insert into public.mod_notes (user_id, author_id, note)
  values (p_user, auth.uid(), '⚠ Warning issued: ' || coalesce(nullif(trim(p_reason), ''), 'no reason given'));
end;
$$;

-- p_days null = permanent account ban; otherwise temporary suspension.
create or replace function public.mod_suspend_user(p_user uuid, p_days int default 7)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_moderator();
  if p_user = auth.uid() then raise exception 'cannot_suspend_self' using errcode = 'P0001'; end if;
  update public.users
     set suspended_until = case when p_days is null then 'infinity'::timestamptz
                                else now() + make_interval(days => p_days) end
   where id = p_user;
  insert into public.mod_notes (user_id, author_id, note)
  values (p_user, auth.uid(),
          case when p_days is null then '⛔ Account banned (permanent)'
               else '⛔ Account suspended for ' || p_days || ' days' end);
end;
$$;

create or replace function public.mod_unsuspend_user(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.assert_moderator();
  update public.users set suspended_until = null where id = p_user;
  insert into public.mod_notes (user_id, author_id, note)
  values (p_user, auth.uid(), '✅ Suspension lifted');
end;
$$;

revoke all on function public.mod_get_user_moderation(uuid) from public;
revoke all on function public.mod_add_note(uuid, text) from public;
revoke all on function public.mod_warn_user(uuid, text) from public;
revoke all on function public.mod_suspend_user(uuid, int) from public;
revoke all on function public.mod_unsuspend_user(uuid) from public;
grant execute on function public.mod_get_user_moderation(uuid) to authenticated;
grant execute on function public.mod_add_note(uuid, text) to authenticated;
grant execute on function public.mod_warn_user(uuid, text) to authenticated;
grant execute on function public.mod_suspend_user(uuid, int) to authenticated;
grant execute on function public.mod_unsuspend_user(uuid) to authenticated;
