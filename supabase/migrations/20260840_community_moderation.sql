-- ============================================================
-- 20260840_community_moderation.sql
--
-- Moderation grows teeth: bans, a mod log, and per-member mutes.
--
--   Bans      — community_bans (one row per community+user) written
--               only through ban_community_member / unban_community_
--               member (mods; can't ban yourself, an owner, or a
--               moderator). Banning removes the target's membership
--               and any pending join request. is_community_banned()
--               is the shared predicate.
--   Enforce   — RESTRICTIVE RLS insert policies on community_posts /
--               community_comments (a permissive policy alone could
--               be OR-ed around later); the community_members join
--               policy, request_to_join, and approve_join_request
--               refuse banned users; vote_post / vote_comment gain a
--               banned check after their visibility guard. Errors use
--               the house 'code: message' style, errcode P0001.
--   Mod log   — community_mod_log records who did what (ban/unban,
--               role_change, approve_join/deny_join, settings_update,
--               pin/unpin of posts and comments) via the private
--               log_mod_action() helper — definer-only plumbing,
--               revoked from clients; mods read their board's log.
--               The logged functions are re-created from their
--               CURRENT bodies with logging added; every existing
--               guard and behavior is preserved.
--   Mutes     — community_mutes: a member turns off notifications
--               from one community without leaving it. Own-row RLS
--               (clients toggle directly); notify_community_post and
--               notify_community_debate skip muted members.
-- ============================================================

-- ─── 1. Bans table ───────────────────────────────────────────
create table if not exists public.community_bans (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  banned_by    uuid references public.users(id) on delete set null,
  reason       text check (char_length(reason) <= 300),
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.community_bans enable row level security;

-- Mods see their board's bans; a banned user sees their own row
-- (so the client can say "you are banned" instead of failing mutely).
drop policy if exists "mods and the banned user see bans" on public.community_bans;
create policy "mods and the banned user see bans"
  on public.community_bans for select
  using (public.is_community_mod(community_id, auth.uid()) or auth.uid() = user_id);
-- No client insert/update/delete policies — writes go through the RPCs.

-- ─── 2. Shared predicate ─────────────────────────────────────
create or replace function public.is_community_banned(p_community uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.community_bans
    where community_id = p_community and user_id = p_user
  );
$$;
grant execute on function public.is_community_banned(uuid, uuid) to anon, authenticated;

-- ─── 3. Mod log ──────────────────────────────────────────────
create table if not exists public.community_mod_log (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  actor_id     uuid references public.users(id) on delete set null,
  action       text not null,
  target_user  uuid,
  target_post  uuid,
  detail       text check (char_length(detail) <= 300),
  created_at   timestamptz not null default now()
);
create index if not exists idx_community_mod_log_community
  on public.community_mod_log (community_id, created_at desc);

alter table public.community_mod_log enable row level security;

drop policy if exists "mods read the mod log" on public.community_mod_log;
create policy "mods read the mod log"
  on public.community_mod_log for select
  using (public.is_community_mod(community_id, auth.uid()));
-- No client write policies — rows come from log_mod_action() only.

-- Private plumbing: called from the definer RPCs below, never by
-- clients (revoked from authenticated too, unlike the public helpers).
create or replace function public.log_mod_action(
  p_community   uuid,
  p_actor       uuid,
  p_action      text,
  p_target_user uuid default null,
  p_target_post uuid default null,
  p_detail      text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.community_mod_log
    (community_id, actor_id, action, target_user, target_post, detail)
  values
    (p_community, p_actor, p_action, p_target_user, p_target_post,
     nullif(left(coalesce(p_detail, ''), 300), ''));
end;
$$;
revoke all on function public.log_mod_action(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;

-- ─── 4. Ban / unban RPCs ─────────────────────────────────────
-- Mods ban plain members (or non-members, preemptively). You can't
-- ban yourself, and owners/moderators are untouchable — demote first
-- (set_community_role is owner-only), then ban.
create or replace function public.ban_community_member(
  p_community uuid, p_user uuid, p_reason text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 300), '');
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_user = v_me then
    raise exception 'cannot_ban_self: You can''t ban yourself.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = p_user
      and role in ('owner', 'moderator')
  ) then
    raise exception 'cannot_ban_mod: Owners and moderators can''t be banned.' using errcode = 'P0001';
  end if;

  insert into public.community_bans (community_id, user_id, banned_by, reason)
  values (p_community, p_user, v_me, v_reason)
  on conflict do nothing;

  if found then
    perform public.log_mod_action(p_community, v_me, 'ban', p_user, null, v_reason);
  end if;

  delete from public.community_members
  where community_id = p_community and user_id = p_user;
  delete from public.community_join_requests
  where community_id = p_community and user_id = p_user;
end;
$$;
revoke all on function public.ban_community_member(uuid, uuid, text) from public, anon;
grant execute on function public.ban_community_member(uuid, uuid, text) to authenticated;

create or replace function public.unban_community_member(p_community uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;

  delete from public.community_bans
  where community_id = p_community and user_id = p_user;

  if found then
    perform public.log_mod_action(p_community, v_me, 'unban', p_user);
  end if;
end;
$$;
revoke all on function public.unban_community_member(uuid, uuid) from public, anon;
grant execute on function public.unban_community_member(uuid, uuid) to authenticated;

-- ─── 5. Enforcement: RLS ─────────────────────────────────────
-- RESTRICTIVE, so no present or future permissive policy can OR its
-- way around a ban. (The permissive visibility policies from 20260835
-- still gate the happy path.)
drop policy if exists "banned users cannot post" on public.community_posts;
create policy "banned users cannot post"
  on public.community_posts as restrictive for insert
  with check (not public.is_community_banned(community_id, auth.uid()));

drop policy if exists "banned users cannot comment" on public.community_comments;
create policy "banned users cannot comment"
  on public.community_comments as restrictive for insert
  with check (not public.is_community_banned(
    (select community_id from public.community_posts where id = post_id), auth.uid()));

-- Joining: same policy as 20260835 section 4, plus the banned check.
drop policy if exists "users join public communities as members" on public.community_members;
create policy "users join public communities as members"
  on public.community_members for insert
  with check (
    auth.uid() = user_id
    and not public.is_community_banned(community_id, auth.uid())
    and (
      (select created_by from public.communities where id = community_id) = auth.uid()
      or (
        role = 'member'
        and not (select is_private from public.communities where id = community_id)
      )
    )
  );

-- ─── 6. Enforcement: join-request RPCs ───────────────────────
-- request_to_join re-created from 20260835 with a caller banned check.
create or replace function public.request_to_join(p_community uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if public.is_community_banned(p_community, v_me) then
    raise exception 'banned: You are banned from this community.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.communities where id = p_community and is_private) then
    raise exception 'not_private: This community is public — just join it.' using errcode = 'P0001';
  end if;
  if public.is_community_member(p_community, v_me) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  insert into public.community_join_requests (community_id, user_id)
  values (p_community, v_me)
  on conflict do nothing;
end;
$$;
revoke all on function public.request_to_join(uuid) from public, anon;
grant execute on function public.request_to_join(uuid) to authenticated;

-- approve_join_request re-created from 20260835 with a target banned
-- check (a stale request from a since-banned user can't be waved in)
-- and 'approve_join' logging.
create or replace function public.approve_join_request(p_community uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if not exists (select 1 from public.community_join_requests
                 where community_id = p_community and user_id = p_user) then
    raise exception 'no_request' using errcode = 'P0001';
  end if;
  if public.is_community_banned(p_community, p_user) then
    raise exception 'banned: That user is banned from this community.' using errcode = 'P0001';
  end if;
  insert into public.community_members (community_id, user_id, role)
  values (p_community, p_user, 'member')
  on conflict do nothing;
  delete from public.community_join_requests
  where community_id = p_community and user_id = p_user;
  perform public.log_mod_action(p_community, v_me, 'approve_join', p_user);
end;
$$;
revoke all on function public.approve_join_request(uuid, uuid) from public, anon;
grant execute on function public.approve_join_request(uuid, uuid) to authenticated;

-- deny_join_request re-created from 20260835 with 'deny_join' logging
-- (only when a request actually existed).
create or replace function public.deny_join_request(p_community uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  delete from public.community_join_requests
  where community_id = p_community and user_id = p_user;
  if found then
    perform public.log_mod_action(p_community, v_me, 'deny_join', p_user);
  end if;
end;
$$;
revoke all on function public.deny_join_request(uuid, uuid) from public, anon;
grant execute on function public.deny_join_request(uuid, uuid) to authenticated;

-- ─── 7. Enforcement: vote RPCs ───────────────────────────────
-- Re-created from their 20260835 bodies (the visibility-guard
-- versions); the banned check lands right after the visibility check.
create or replace function public.vote_post(p_post uuid, p_value integer)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if p_value not in (-1, 0, 1) then
    raise exception 'invalid_vote' using errcode = '22023';
  end if;
  if not public.community_visible(
    (select community_id from public.community_posts where id = p_post), v_me) then
    raise exception 'not_visible' using errcode = '42501';
  end if;
  if public.is_community_banned(
    (select community_id from public.community_posts where id = p_post), v_me) then
    raise exception 'banned: You are banned from this community.' using errcode = 'P0001';
  end if;

  if p_value = 0 then
    delete from public.community_post_votes where post_id = p_post and user_id = v_me;
  else
    insert into public.community_post_votes (post_id, user_id, value)
    values (p_post, v_me, p_value)
    on conflict (post_id, user_id) do update set value = excluded.value;
  end if;
end;
$$;
revoke all on function public.vote_post(uuid, integer) from public, anon;
grant execute on function public.vote_post(uuid, integer) to authenticated;

create or replace function public.vote_comment(p_comment uuid, p_value integer)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if p_value not in (-1, 0, 1) then
    raise exception 'invalid_vote' using errcode = '22023';
  end if;
  if not public.community_visible(
    (select p.community_id from public.community_comments cc
     join public.community_posts p on p.id = cc.post_id
     where cc.id = p_comment), v_me) then
    raise exception 'not_visible' using errcode = '42501';
  end if;
  if public.is_community_banned(
    (select p.community_id from public.community_comments cc
     join public.community_posts p on p.id = cc.post_id
     where cc.id = p_comment), v_me) then
    raise exception 'banned: You are banned from this community.' using errcode = 'P0001';
  end if;

  if p_value = 0 then
    delete from public.community_comment_votes where comment_id = p_comment and user_id = v_me;
  else
    insert into public.community_comment_votes (comment_id, user_id, value)
    values (p_comment, v_me, p_value)
    on conflict (comment_id, user_id) do update set value = excluded.value;
  end if;
end;
$$;
revoke all on function public.vote_comment(uuid, integer) from public, anon;
grant execute on function public.vote_comment(uuid, integer) to authenticated;

-- ─── 8. Logging on the existing mod RPCs ─────────────────────
-- Each is re-created from its CURRENT body — every guard preserved —
-- with a log_mod_action call added on success.

-- set_community_role (source: 20260835 §6) — logs 'role_change',
-- detail = the new role, only when a row actually changed.
create or replace function public.set_community_role(
  p_community uuid, p_user uuid, p_role text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = v_me and role = 'owner'
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_role not in ('moderator', 'member') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_user = v_me then
    raise exception 'cannot_change_own_role' using errcode = 'P0001';
  end if;
  update public.community_members
  set role = p_role
  where community_id = p_community and user_id = p_user and role <> 'owner';
  if found then
    perform public.log_mod_action(p_community, v_me, 'role_change', p_user, null, p_role);
  end if;
end;
$$;
revoke all on function public.set_community_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_community_role(uuid, uuid, text) to authenticated;

-- update_community_settings (source: current 6-arg body from
-- 20260838) — logs 'settings_update', detail = which fields were sent.
create or replace function public.update_community_settings(
  p_community   uuid,
  p_description text default null,
  p_rules       text default null,
  p_is_private  boolean default null,
  p_banner_url  text default null,
  p_avatar_url  text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_is_private is not null and not exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = v_me and role = 'owner'
  ) then
    raise exception 'owner_only: Only the owner can change privacy.' using errcode = '42501';
  end if;
  update public.communities set
    description = case when p_description is null then description
                       when p_description = '' then null
                       else left(p_description, 500) end,
    rules       = case when p_rules is null then rules
                       when p_rules = '' then null
                       else left(p_rules, 4000) end,
    is_private  = coalesce(p_is_private, is_private),
    banner_url  = case when p_banner_url is null then banner_url
                       when p_banner_url = '' then null
                       else left(p_banner_url, 500) end,
    avatar_url  = case when p_avatar_url is null then avatar_url
                       when p_avatar_url = '' then null
                       else left(p_avatar_url, 500) end
  where id = p_community;
  perform public.log_mod_action(p_community, v_me, 'settings_update', null, null,
    nullif(array_to_string(array_remove(array[
      case when p_description is not null then 'description' end,
      case when p_rules       is not null then 'rules' end,
      case when p_is_private  is not null then 'privacy' end,
      case when p_banner_url  is not null then 'banner' end,
      case when p_avatar_url  is not null then 'avatar' end
    ], null), ', '), ''));
end;
$$;
revoke all on function public.update_community_settings(uuid, text, text, boolean, text, text) from public, anon;
grant execute on function public.update_community_settings(uuid, text, text, boolean, text, text) to authenticated;

-- set_comment_pinned (source: 20260838) — logs 'pin_comment' /
-- 'unpin_comment', target_post = the comment's post.
create or replace function public.set_comment_pinned(p_comment uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_community uuid;
  v_post      uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select p.community_id, p.id into v_community, v_post
  from public.community_comments c
  join public.community_posts p on p.id = c.post_id
  where c.id = p_comment;
  if v_community is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;
  if not public.is_community_mod(v_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  update public.community_comments
  set pinned_at = case when p_pinned then now() end
  where id = p_comment;
  perform public.log_mod_action(v_community, v_me,
    case when p_pinned then 'pin_comment' else 'unpin_comment' end, null, v_post);
end;
$$;
revoke all on function public.set_comment_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_comment_pinned(uuid, boolean) to authenticated;

-- set_post_pinned (source: 20260839) — logs 'pin_post' / 'unpin_post'.
create or replace function public.set_post_pinned(p_post uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_community uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select community_id into v_community from public.community_posts where id = p_post;
  if v_community is null then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;
  if not public.is_community_mod(v_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  update public.community_posts
  set pinned_at = case when p_pinned then now() end
  where id = p_post;
  perform public.log_mod_action(v_community, v_me,
    case when p_pinned then 'pin_post' else 'unpin_post' end, null, p_post);
end;
$$;
revoke all on function public.set_post_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_post_pinned(uuid, boolean) to authenticated;

-- ─── 9. Mutes ────────────────────────────────────────────────
-- Stay a member, stop the pings. Own-row policies: the client
-- inserts/deletes its own mute rows directly, no RPC needed.
create table if not exists public.community_mutes (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.community_mutes enable row level security;

drop policy if exists "users see own mutes" on public.community_mutes;
create policy "users see own mutes"
  on public.community_mutes for select
  using (auth.uid() = user_id);

drop policy if exists "users mute as themselves" on public.community_mutes;
create policy "users mute as themselves"
  on public.community_mutes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users unmute as themselves" on public.community_mutes;
create policy "users unmute as themselves"
  on public.community_mutes for delete
  using (auth.uid() = user_id);

-- notify_community_post (source: 20260835 §10) — muted members are
-- skipped. The existing trigger binding survives create-or-replace.
create or replace function public.notify_community_post()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, actor_id, post_id)
  select m.user_id, 'community_post', new.author_id, new.id
  from public.community_members m
  where m.community_id = new.community_id
    and m.user_id <> new.author_id
    and coalesce((select notify_community_posts from public.user_settings
                  where user_id = m.user_id), true)
    and not exists (
      select 1 from public.community_mutes cm
      where cm.community_id = new.community_id and cm.user_id = m.user_id
    );
  return new;
end;
$$;
revoke execute on function public.notify_community_post() from anon, authenticated;

-- notify_community_debate (source: 20260835 §10) — same skip.
create or replace function public.notify_community_debate()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.community_id is not null and new.is_private = false then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select m.user_id, 'community_debate', new.host_id, new.id
    from public.community_members m
    where m.community_id = new.community_id
      and m.user_id <> new.host_id
      and not exists (
        select 1 from public.community_mutes cm
        where cm.community_id = new.community_id and cm.user_id = m.user_id
      );
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_community_debate() from anon, authenticated;
