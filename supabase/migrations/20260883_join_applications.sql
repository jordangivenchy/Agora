-- Private communities become application-based: a join request now
-- carries an optional message ("why I want in"), mods are notified when
-- someone applies, and the applicant is notified on approval (denial
-- stays silent by design). The existing request/approve/deny RPCs and
-- RLS keep their shapes; request_to_join gains a p_message arg.

-- ── The application message ─────────────────────────────────────────
alter table public.community_join_requests
  add column if not exists message text;

-- ── New notification types ──────────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'new_follower', 'room_live', 'room_starting_soon', 'room_invite',
    'friend_accepted', 'community_post', 'community_debate', 'mention',
    'post_reply', 'post_comment', 'post_upvotes', 'comment_upvotes',
    'followed_scheduled', 'followed_live', 'repost',
    'debate_replay_ready', 'discussion_opened',
    'join_request', 'join_approved'
  ));

create or replace function public.notification_types()
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select array[
    'new_follower', 'room_live', 'room_starting_soon', 'room_invite',
    'friend_accepted', 'community_post', 'community_debate', 'mention',
    'post_reply', 'post_comment', 'post_upvotes', 'comment_upvotes',
    'followed_scheduled', 'followed_live', 'repost',
    'debate_replay_ready', 'discussion_opened',
    'join_request', 'join_approved'
  ];
$$;

-- ── request_to_join: accept the message, notify the mods ────────────
drop function if exists public.request_to_join(uuid);
create function public.request_to_join(p_community uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_mod record;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if public.is_community_banned(p_community, v_me) then
    raise exception 'banned: You are banned from this community.' using errcode = 'P0001';
  end if;
  select name into v_name from public.communities where id = p_community and is_private;
  if v_name is null then
    raise exception 'not_private: This community is public — just join it.' using errcode = 'P0001';
  end if;
  if public.is_community_member(p_community, v_me) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.community_join_requests (community_id, user_id, message)
  values (p_community, v_me, nullif(left(trim(coalesce(p_message, '')), 500), ''))
  on conflict (community_id, user_id) do update
    set message = excluded.message;

  -- Every mod hears about the application; notif_emit handles prefs,
  -- blocks, and coalesces repeat applications to the same board.
  for v_mod in
    select cm.user_id from public.community_members cm
    where cm.community_id = p_community and cm.role in ('owner', 'moderator')
  loop
    perform public.notif_emit(
      v_mod.user_id, 'join_request', v_me,
      null, null, null,
      jsonb_build_object('community_id', p_community, 'community_name', v_name),
      'jr:' || p_community::text
    );
  end loop;
end;
$$;

grant execute on function public.request_to_join(uuid, text) to authenticated;

-- ── approve: let the applicant know ─────────────────────────────────
create or replace function public.approve_join_request(p_community uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
begin
  if v_me is null or not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if not exists (select 1 from public.community_join_requests where community_id = p_community and user_id = p_user) then
    raise exception 'no_request' using errcode = 'P0001';
  end if;
  if public.is_community_banned(p_community, p_user) then
    raise exception 'banned: That user is banned from this community.' using errcode = 'P0001';
  end if;
  insert into public.community_members (community_id, user_id, role)
  values (p_community, p_user, 'member')
  on conflict do nothing;
  delete from public.community_join_requests where community_id = p_community and user_id = p_user;
  perform public.log_mod_action(p_community, v_me, 'approve_join', p_user);

  select name into v_name from public.communities where id = p_community;
  perform public.notif_emit(
    p_user, 'join_approved', v_me,
    null, null, null,
    jsonb_build_object('community_id', p_community, 'community_name', v_name),
    'ja:' || p_community::text
  );
end;
$$;
