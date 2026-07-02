-- ═══════════════════════════════════════════════════════════════════════════
-- Polish pass migration
--
-- Adds:
--   1. Avatars storage bucket + RLS (users upload their own).
--   2. update_profile  — edit username/avatar/bio (validates handle format).
--      check_username_available — regex + uniqueness check.
--   3. Follower / following list RPCs (with "is this the caller following them"
--      flags).
--   4. cancel_room — host cancels a debate from the Debates page.
--   5. approve_queue_entry / decline_queue_entry — host-only, atomic; replaces
--      the client-side "update + upsert" flow so we can't race on slot limits.
--   6. Rewrites join_private_room so p_role='spectator' always enrolls the
--      caller as a spectator (old RPC restored them as debater if they had
--      ever been one) and p_role='debater' routes them into debate_queue
--      instead of the participants table, matching the new "host approves
--      everyone" model.
--   7. Augments get_user_live_and_scheduled so DebatesPage knows whether the
--      current user is the host (to show the Cancel button).
--
-- Run AFTER 20260420_scheduling.sql.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. Avatars storage bucket ──────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- Authenticated users can upload to paths under their own uid/*.
drop policy if exists "avatars upload own folder" on storage.objects;
create policy "avatars upload own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars update own folder" on storage.objects;
create policy "avatars update own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars delete own folder" on storage.objects;
create policy "avatars delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select to public
  using (bucket_id = 'avatars');


-- ─── 2. Username check + profile update ─────────────────────────────────────
create or replace function public.check_username_available(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_clean text := lower(trim(coalesce(p_username, '')));
begin
  if v_clean !~ '^[a-z0-9_]{3,20}$' then
    return false;
  end if;
  return not exists (
    select 1 from public.users
    where lower(username) = v_clean
      and (v_me is null or id <> v_me)
  );
end;
$$;

revoke all on function public.check_username_available(text) from public;
grant execute on function public.check_username_available(text) to authenticated;


create or replace function public.update_profile(
  p_username   text,
  p_avatar_url text,
  p_bio        text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_clean text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_username is not null then
    v_clean := lower(trim(p_username));
    if v_clean !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'invalid_username'
        using errcode = '22023',
              message = 'Username must be 3-20 chars: lowercase letters, numbers, or underscores.';
    end if;
    if exists (
      select 1 from public.users
      where lower(username) = v_clean and id <> v_me
    ) then
      raise exception 'username_taken'
        using errcode = 'P0001',
              message = 'That username is already taken.';
    end if;
  end if;

  update public.users
     set username   = coalesce(v_clean,    username),
         avatar_url = coalesce(p_avatar_url, avatar_url),
         bio        = coalesce(p_bio,      bio),
         updated_at = now()
   where id = v_me;
end;
$$;

revoke all on function public.update_profile(text, text, text) from public;
grant execute on function public.update_profile(text, text, text) to authenticated;


-- ─── 3. Follower / following list RPCs ──────────────────────────────────────
create or replace function public.get_followers(p_user uuid)
returns table (
  id              uuid,
  username        text,
  avatar_url      text,
  bio             text,
  i_am_following  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.username,
    u.avatar_url,
    u.bio,
    exists (
      select 1 from public.user_follows me
      where me.follower_id  = auth.uid()
        and me.following_id = u.id
    ) as i_am_following
  from public.user_follows f
  join public.users u on u.id = f.follower_id
  where f.following_id = p_user
  order by f.created_at desc;
$$;

revoke all on function public.get_followers(uuid) from public;
grant execute on function public.get_followers(uuid) to authenticated, anon;


create or replace function public.get_following(p_user uuid)
returns table (
  id              uuid,
  username        text,
  avatar_url      text,
  bio             text,
  i_am_following  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.username,
    u.avatar_url,
    u.bio,
    exists (
      select 1 from public.user_follows me
      where me.follower_id  = auth.uid()
        and me.following_id = u.id
    ) as i_am_following
  from public.user_follows f
  join public.users u on u.id = f.following_id
  where f.follower_id = p_user
  order by f.created_at desc;
$$;

revoke all on function public.get_following(uuid) from public;
grant execute on function public.get_following(uuid) to authenticated, anon;


-- ─── 4. cancel_room ─────────────────────────────────────────────────────────
create or replace function public.cancel_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_host uuid;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select host_id, status into v_host, v_status
  from public.debate_rooms
  where id = p_room;

  if v_host is null then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  if v_host <> v_me then
    raise exception 'not_host' using errcode = '42501';
  end if;

  if v_status not in ('created', 'live') then
    raise exception 'already_ended' using errcode = 'P0001';
  end if;

  update public.debate_rooms
     set status   = 'cancelled',
         ended_at = now()
   where id = p_room;

  update public.debate_queue
     set status = 'cancelled'
   where room_id = p_room
     and status = 'waiting';
end;
$$;

revoke all on function public.cancel_room(uuid) from public;
grant execute on function public.cancel_room(uuid) to authenticated;


-- ─── 5. approve_queue_entry / decline_queue_entry ──────────────────────────
-- Moves a waiting queue row to the participants table as a debater. Only the
-- host may call this. Enforces the pro_size / con_size slot limits.
create or replace function public.approve_queue_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_room     uuid;
  v_user     uuid;
  v_stance   text;
  v_status   text;
  v_host     uuid;
  v_pro_size int;
  v_con_size int;
  v_room_status text;
  v_taken    int;
  v_existing_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select q.room_id, q.user_id, q.stance, q.status
    into v_room, v_user, v_stance, v_status
  from public.debate_queue q
  where q.id = p_entry;

  if v_room is null then
    raise exception 'queue_entry_not_found' using errcode = 'P0002';
  end if;

  if v_status <> 'waiting' then
    raise exception 'queue_entry_not_waiting' using errcode = 'P0001';
  end if;

  select r.host_id, r.pro_size, r.con_size, r.status
    into v_host, v_pro_size, v_con_size, v_room_status
  from public.debate_rooms r
  where r.id = v_room;

  if v_host <> v_me then
    raise exception 'not_host' using errcode = '42501';
  end if;

  if v_room_status not in ('created', 'live') then
    raise exception 'room_not_active' using errcode = 'P0001';
  end if;

  -- Count currently-active debaters on this stance; ignore the person being
  -- approved themselves (in case they had a stale participants row).
  select count(*) into v_taken
  from public.debate_participants
  where room_id = v_room
    and role    = 'debater'
    and stance  = v_stance
    and left_at is null
    and user_id <> v_user;

  if v_stance = 'PRO' and v_taken >= v_pro_size then
    raise exception 'pro_slot_full' using errcode = 'P0001';
  end if;
  if v_stance = 'CON' and v_taken >= v_con_size then
    raise exception 'con_slot_full' using errcode = 'P0001';
  end if;

  -- Upsert participant row.
  select id into v_existing_id
  from public.debate_participants
  where room_id = v_room and user_id = v_user;

  if v_existing_id is not null then
    update public.debate_participants
       set role   = 'debater',
           stance = v_stance,
           left_at = null,
           joined_at = now()
     where id = v_existing_id;
  else
    insert into public.debate_participants (room_id, user_id, role, stance)
    values (v_room, v_user, 'debater', v_stance);
  end if;

  update public.debate_queue
     set status = 'matched'
   where id = p_entry;
end;
$$;

revoke all on function public.approve_queue_entry(uuid) from public;
grant execute on function public.approve_queue_entry(uuid) to authenticated;


create or replace function public.decline_queue_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_room uuid;
  v_host uuid;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select q.room_id, q.status into v_room, v_status
  from public.debate_queue q
  where q.id = p_entry;

  if v_room is null then
    raise exception 'queue_entry_not_found' using errcode = 'P0002';
  end if;

  if v_status <> 'waiting' then
    return; -- idempotent
  end if;

  select r.host_id into v_host
  from public.debate_rooms r
  where r.id = v_room;

  if v_host <> v_me then
    raise exception 'not_host' using errcode = '42501';
  end if;

  update public.debate_queue
     set status = 'cancelled'
   where id = p_entry;
end;
$$;

revoke all on function public.decline_queue_entry(uuid) from public;
grant execute on function public.decline_queue_entry(uuid) to authenticated;


-- ─── 6. Rewrite join_private_room ───────────────────────────────────────────
-- Two behavior changes vs 20260418_private_rooms_rpc_v2.sql:
--   • p_role = 'spectator' now ALWAYS enrolls as spectator. The old version
--     silently promoted them back to debater if they had ever been one in
--     that room — the source of the "pressed Join as Spectator but ended up
--     as debater" bug.
--   • p_role = 'debater' inserts into debate_queue (status='waiting') and
--     returns (room_id, queued=true). The UI reads the queued flag and shows
--     a "waiting for host" state. Hosts approve via approve_queue_entry.
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

  select id, host_id into v_room, v_host_id
  from public.debate_rooms
  where invite_code = v_code
    and is_private = true
    and status in ('live', 'created')
  limit 1;

  if v_room is null then
    raise exception 'invalid_or_expired_code' using errcode = 'P0002';
  end if;

  -- Host joining their own room by code: fall straight through as debater
  -- (skipping the queue), since they rostered themselves at creation time.
  -- Existing logic lives on debate_participants upsert below.
  if p_role = 'spectator' then
    select id, role into v_existing_id, v_existing_role
    from public.debate_participants
    where room_id = v_room and user_id = v_user_id;

    if v_existing_id is not null then
      update public.debate_participants
         set role = 'spectator',
             stance = null,
             left_at = null,
             joined_at = now()
       where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance)
      values (v_room, v_user_id, 'spectator', null);
    end if;

    return query select v_room, false;
    return;
  end if;

  -- p_role = 'debater' path.
  -- Host bypasses the queue.
  if v_user_id = v_host_id then
    select id into v_existing_id
    from public.debate_participants
    where room_id = v_room and user_id = v_user_id;

    if v_existing_id is not null then
      update public.debate_participants
         set role = 'debater',
             stance = v_stance,
             left_at = null,
             joined_at = now()
       where id = v_existing_id;
    else
      insert into public.debate_participants (room_id, user_id, role, stance)
      values (v_room, v_user_id, 'debater', v_stance);
    end if;

    return query select v_room, false;
    return;
  end if;

  -- Non-host debater: route to queue. Dedupe any prior waiting row for this
  -- user in this room so the list doesn't balloon on repeat clicks.
  update public.debate_queue
     set status = 'cancelled'
   where room_id = v_room
     and user_id = v_user_id
     and status  = 'waiting';

  insert into public.debate_queue (room_id, user_id, stance, status)
  values (v_room, v_user_id, v_stance, 'waiting');

  -- Ensure they have a spectator participant row so they can watch while
  -- they wait.
  select id, role into v_existing_id, v_existing_role
  from public.debate_participants
  where room_id = v_room and user_id = v_user_id;

  if v_existing_id is null then
    insert into public.debate_participants (room_id, user_id, role, stance)
    values (v_room, v_user_id, 'spectator', null);
  elsif v_existing_role <> 'debater' then
    update public.debate_participants
       set role = 'spectator',
           stance = null,
           left_at = null,
           joined_at = now()
     where id = v_existing_id;
  end if;

  return query select v_room, true;
end;
$$;

revoke all on function public.join_private_room(text, text, text) from public;
grant execute on function public.join_private_room(text, text, text) to authenticated;


-- ─── 7. Extend get_user_live_and_scheduled with host_id ────────────────────
create or replace function public.get_user_live_and_scheduled(p_user uuid)
returns table (
  room_id         uuid,
  motion          text,
  topic_key       text,
  status          text,
  stance          text,
  started_at      timestamptz,
  scheduled_start timestamptz,
  is_scheduled    boolean,
  is_private      boolean,
  host_id         uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.motion,
    r.topic_key,
    r.status,
    dp.stance,
    r.started_at,
    r.scheduled_start,
    (r.status = 'created'
       and r.scheduled_start is not null
       and r.scheduled_start > now()) as is_scheduled,
    r.is_private,
    r.host_id
  from public.debate_participants dp
  join public.debate_rooms r on r.id = dp.room_id
  where dp.user_id = p_user
    and dp.role    = 'debater'
    and dp.left_at is null
    and (r.is_private = false or r.allow_spectators = true)
    and r.status <> 'cancelled'
    and (
      r.status = 'live'
      or (r.status = 'created'
          and r.scheduled_start is not null
          and r.scheduled_start > now())
    )
  order by
    (case when r.status = 'live' then 0 else 1 end),
    r.started_at      desc nulls last,
    r.scheduled_start asc  nulls last;
$$;

revoke all on function public.get_user_live_and_scheduled(uuid) from public;
grant execute on function public.get_user_live_and_scheduled(uuid) to authenticated, anon;
