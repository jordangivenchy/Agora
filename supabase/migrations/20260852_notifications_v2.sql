-- ============================================================
-- 20260852_notifications_v2.sql
--
-- Social notifications for a feed-centric product. Builds on 20260814
-- (table + RLS), 20260818/20260834 (reminders), 20260835/20260839
-- (community_post / mention).
--
-- New types
--   post_reply           someone replied to your comment
--   post_comment         someone commented on your post
--   post_upvotes         your post hit 5 / 25 / 100 upvotes (meta.milestone)
--   comment_upvotes      your comment hit 5 / 25 (meta.milestone)
--   followed_scheduled   someone you follow scheduled a debate
--   followed_live        someone you follow went live (followers; people
--                        with a reminder get room_live instead — one row
--                        per (user, room) across both types)
--   repost               someone reposted your post
--   debate_replay_ready  a debate you hosted / spoke in has its recording
--                        finalized (debate_rooms.recording_ended_at set)
--   discussion_opened    someone started the discussion thread on a
--                        debate you hosted (discussion_post_id set)
--
-- Columns added: comment_id, meta (jsonb: milestone, count, actors,
-- excerpt), delivered_at (web-push/email dispatch marker).
--
-- Coalescing: post_comment / post_reply / post_upvotes / repost on the
-- same target within 10 minutes fold into the existing UNREAD row
-- (meta.count, meta.actors, created_at bumped) instead of a new row.
--
-- Preferences: user_settings.notification_prefs jsonb {type: bool}.
-- Every trigger checks notif_enabled() before inserting. The three
-- legacy booleans (notify_follows / notify_room_live /
-- notify_community_posts) stay authoritative for their types when the
-- jsonb has no key, and set_notification_pref mirrors into them.
--
-- RPCs: get_notifications(limit, before), get_notification_prefs(),
-- set_notification_pref(type, enabled), mark_all_notifications_read(),
-- mark_notification_read(id).
--
-- Delivery: pg_cron 'notification-push' (every minute) POSTs to
-- /api/cron/notifications with the reminder webhook secret; the route
-- pushes/emails undelivered followed_live / followed_scheduled /
-- debate_replay_ready rows and stamps delivered_at.
--
-- Idempotent; run in the Supabase SQL editor.
-- ============================================================

-- ─── 1. Columns + type check ─────────────────────────────────
alter table public.notifications
  add column if not exists post_id uuid references public.community_posts(id) on delete cascade,
  add column if not exists comment_id uuid references public.community_comments(id) on delete cascade,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists delivered_at timestamptz;

create index if not exists idx_notifications_comment
  on public.notifications (comment_id) where comment_id is not null;
create index if not exists idx_notifications_room
  on public.notifications (room_id) where room_id is not null;
create index if not exists idx_notifications_undelivered
  on public.notifications (created_at) where delivered_at is null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'new_follower', 'room_live', 'room_starting_soon', 'room_invite',
    'friend_accepted', 'community_post', 'community_debate', 'mention',
    'post_reply', 'post_comment', 'post_upvotes', 'comment_upvotes',
    'followed_scheduled', 'followed_live', 'repost',
    'debate_replay_ready', 'discussion_opened'
  ]));

-- ─── 2. Preferences ──────────────────────────────────────────
alter table public.user_settings
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- The full catalogue, all default on.
create or replace function public.notification_types()
returns text[]
language sql immutable
as $$
  select array[
    'new_follower', 'friend_accepted', 'room_invite', 'mention',
    'room_live', 'room_starting_soon', 'followed_live', 'followed_scheduled',
    'debate_replay_ready', 'discussion_opened', 'community_debate',
    'community_post', 'post_comment', 'post_reply', 'post_upvotes',
    'comment_upvotes', 'repost'
  ]::text[];
$$;
revoke all on function public.notification_types() from public, anon;
grant execute on function public.notification_types() to authenticated;

-- Is this type on for this user? jsonb key wins; legacy booleans next;
-- everything defaults to on.
create or replace function public.notif_enabled(p_user uuid, p_type text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce(
    (s.notification_prefs ->> p_type)::boolean,
    case p_type
      when 'new_follower'   then s.notify_follows
      when 'friend_accepted' then s.notify_follows
      when 'room_live'      then s.notify_room_live
      when 'followed_live'  then s.notify_room_live
      when 'community_post' then s.notify_community_posts
      else null
    end,
    true)
  from (select 1) x
  left join public.user_settings s on s.user_id = p_user;
$$;
revoke all on function public.notif_enabled(uuid, text) from public, anon, authenticated;

create or replace function public.get_notification_prefs()
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  t text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  foreach t in array public.notification_types() loop
    v_out := v_out || jsonb_build_object(t, public.notif_enabled(v_me, t));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.get_notification_prefs() from public, anon;
grant execute on function public.get_notification_prefs() to authenticated;

create or replace function public.set_notification_pref(p_type text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_type is null or not (p_type = any (public.notification_types())) then
    raise exception 'invalid_notification_type' using errcode = '22023';
  end if;

  insert into public.user_settings (user_id, notification_prefs)
  values (v_me, jsonb_build_object(p_type, coalesce(p_enabled, true)))
  on conflict (user_id) do update
    set notification_prefs = public.user_settings.notification_prefs
                             || jsonb_build_object(p_type, coalesce(p_enabled, true));

  -- Keep the legacy booleans (still read by older clients) in step.
  if p_type in ('new_follower', 'friend_accepted') then
    update public.user_settings set notify_follows = coalesce(p_enabled, true) where user_id = v_me;
  elsif p_type in ('room_live', 'followed_live') then
    update public.user_settings set notify_room_live = coalesce(p_enabled, true) where user_id = v_me;
  elsif p_type = 'community_post' then
    update public.user_settings set notify_community_posts = coalesce(p_enabled, true) where user_id = v_me;
  end if;

  return public.get_notification_prefs();
end;
$$;
revoke all on function public.set_notification_pref(text, boolean) from public, anon;
grant execute on function public.set_notification_pref(text, boolean) to authenticated;

-- ─── 3. Shared insert helper (pref + block gate, coalescing) ─
-- p_coalesce_key: 'post' | 'comment' | null. When set, an unread row of
-- the same type for the same target created in the last 10 minutes is
-- updated in place (count / actors / milestone) instead of a new insert.
create or replace function public.notif_emit(
  p_user uuid, p_type text, p_actor uuid default null,
  p_room uuid default null, p_post uuid default null, p_comment uuid default null,
  p_meta jsonb default '{}'::jsonb, p_coalesce_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.notifications%rowtype;
  v_actors jsonb;
  v_meta jsonb;
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  if not public.notif_enabled(p_user, p_type) then
    return;
  end if;
  if p_actor is not null and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_user and b.blocked_id = p_actor)
       or (b.blocker_id = p_actor and b.blocked_id = p_user)
  ) then
    return;
  end if;

  if p_coalesce_key is not null then
    select * into v_existing
    from public.notifications n
    where n.user_id = p_user
      and n.type = p_type
      and n.read_at is null
      and n.created_at > now() - interval '10 minutes'
      and ((p_coalesce_key = 'post' and n.post_id = p_post)
           or (p_coalesce_key = 'comment' and n.comment_id = p_comment))
    order by n.created_at desc
    limit 1;

    if v_existing.id is not null then
      v_actors := coalesce(v_existing.meta -> 'actors', '[]'::jsonb);
      if p_actor is not null
         and not (v_actors @> to_jsonb(array[p_actor::text])) then
        v_actors := v_actors || to_jsonb(array[p_actor::text]);
      end if;
      v_meta := v_existing.meta
        || coalesce(p_meta, '{}'::jsonb)
        || jsonb_build_object(
             'count', coalesce((v_existing.meta ->> 'count')::int, 1) + 1,
             'actors', (select jsonb_agg(e) from (
                          select e from jsonb_array_elements(v_actors) e limit 5) s));
      -- Milestones only ever climb.
      if (v_existing.meta ? 'milestone') and (p_meta ? 'milestone') then
        v_meta := v_meta || jsonb_build_object('milestone',
          greatest((v_existing.meta ->> 'milestone')::int, (p_meta ->> 'milestone')::int));
      end if;
      update public.notifications
      set meta = v_meta,
          actor_id = coalesce(p_actor, actor_id),
          created_at = now(),
          delivered_at = null
      where id = v_existing.id;
      return;
    end if;
  end if;

  v_meta := coalesce(p_meta, '{}'::jsonb);
  if p_actor is not null then
    v_meta := v_meta || jsonb_build_object('actors', to_jsonb(array[p_actor::text]));
  end if;
  insert into public.notifications (user_id, type, actor_id, room_id, post_id, comment_id, meta)
  values (p_user, p_type, p_actor, p_room, p_post, p_comment, v_meta);
end;
$$;
revoke all on function public.notif_emit(uuid, text, uuid, uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;

-- ─── 4. Comments → post_comment / post_reply ─────────────────
create or replace function public.notify_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_author uuid;
  v_parent_author uuid;
  v_excerpt text := left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 140);
begin
  if new.author_id is null then
    return new;
  end if;
  select author_id into v_post_author from public.community_posts where id = new.post_id;
  if new.parent_id is not null then
    select author_id into v_parent_author from public.community_comments where id = new.parent_id;
  end if;

  -- Reply to a comment: the parent's author hears about it (and not a
  -- second time as the post author).
  if v_parent_author is not null and v_parent_author <> new.author_id then
    perform public.notif_emit(
      v_parent_author, 'post_reply', new.author_id,
      null, new.post_id, new.parent_id,
      jsonb_build_object('excerpt', v_excerpt, 'reply_id', new.id), 'comment');
  end if;

  if v_post_author is not null
     and v_post_author <> new.author_id
     and v_post_author is distinct from v_parent_author then
    perform public.notif_emit(
      v_post_author, 'post_comment', new.author_id,
      null, new.post_id, new.id,
      jsonb_build_object('excerpt', v_excerpt, 'reply_id', new.id), 'post');
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_comment_activity() from anon, authenticated;
drop trigger if exists trg_notify_comment_activity on public.community_comments;
create trigger trg_notify_comment_activity
  after insert on public.community_comments
  for each row execute function public.notify_comment_activity();

-- ─── 5. Votes → post_upvotes / comment_upvotes milestones ────
create or replace function public.notify_post_upvotes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_score bigint;
  v_milestone int;
  v_fired int;
begin
  if new.value <> 1 then
    return new;
  end if;
  select author_id into v_author from public.community_posts where id = new.post_id;
  if v_author is null then
    return new;
  end if;
  select coalesce(sum(value), 0) into v_score
  from public.community_post_votes where post_id = new.post_id;

  v_milestone := case when v_score >= 100 then 100
                      when v_score >= 25 then 25
                      when v_score >= 5 then 5
                      else null end;
  if v_milestone is null then
    return new;
  end if;
  select max((n.meta ->> 'milestone')::int) into v_fired
  from public.notifications n
  where n.type = 'post_upvotes' and n.post_id = new.post_id and n.user_id = v_author;
  if v_fired is not null and v_fired >= v_milestone then
    return new;
  end if;

  perform public.notif_emit(
    v_author, 'post_upvotes', null, null, new.post_id, null,
    jsonb_build_object('milestone', v_milestone, 'score', v_score), 'post');
  return new;
end;
$$;
revoke execute on function public.notify_post_upvotes() from anon, authenticated;
drop trigger if exists trg_notify_post_upvotes on public.community_post_votes;
create trigger trg_notify_post_upvotes
  after insert or update of value on public.community_post_votes
  for each row execute function public.notify_post_upvotes();

create or replace function public.notify_comment_upvotes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_post uuid;
  v_score bigint;
  v_milestone int;
  v_fired int;
begin
  if new.value <> 1 then
    return new;
  end if;
  select author_id, post_id into v_author, v_post
  from public.community_comments where id = new.comment_id;
  if v_author is null then
    return new;
  end if;
  select coalesce(sum(value), 0) into v_score
  from public.community_comment_votes where comment_id = new.comment_id;

  v_milestone := case when v_score >= 25 then 25
                      when v_score >= 5 then 5
                      else null end;
  if v_milestone is null then
    return new;
  end if;
  select max((n.meta ->> 'milestone')::int) into v_fired
  from public.notifications n
  where n.type = 'comment_upvotes' and n.comment_id = new.comment_id and n.user_id = v_author;
  if v_fired is not null and v_fired >= v_milestone then
    return new;
  end if;

  perform public.notif_emit(
    v_author, 'comment_upvotes', null, null, v_post, new.comment_id,
    jsonb_build_object('milestone', v_milestone, 'score', v_score), 'comment');
  return new;
end;
$$;
revoke execute on function public.notify_comment_upvotes() from anon, authenticated;
drop trigger if exists trg_notify_comment_upvotes on public.community_comment_votes;
create trigger trg_notify_comment_upvotes
  after insert or update of value on public.community_comment_votes
  for each row execute function public.notify_comment_upvotes();

-- ─── 6. Reposts → repost ─────────────────────────────────────
create or replace function public.notify_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig_author uuid;
begin
  if not new.is_repost or new.repost_of is null then
    return new;
  end if;
  select author_id into v_orig_author from public.community_posts where id = new.repost_of;
  perform public.notif_emit(
    v_orig_author, 'repost', new.author_id, null, new.repost_of, null,
    jsonb_build_object('repost_id', new.id), 'post');
  return new;
end;
$$;
revoke execute on function public.notify_repost() from anon, authenticated;
drop trigger if exists trg_notify_repost on public.community_posts;
create trigger trg_notify_repost
  after insert on public.community_posts
  for each row execute function public.notify_repost();

-- ─── 7. Rooms: room_live becomes reminder-only; followers get
--        followed_live / followed_scheduled ──────────────────
-- Replaces 20260818's notify_room_live: reminder-setters (explicit
-- opt-in) keep 'room_live'; followers are handled below with their own
-- pref, one row per (user, room) across the two types.
create or replace function public.notify_room_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'live'
     and (tg_op = 'INSERT' or old.status is distinct from 'live')
     and new.is_private = false then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select rr.user_id, 'room_live', new.host_id, new.id
    from public.room_reminders rr
    where rr.room_id = new.id
      and rr.user_id <> new.host_id
      and not exists (
        select 1 from public.notifications n
        where n.user_id = rr.user_id and n.room_id = new.id
          and n.type in ('room_live', 'followed_live'));
    delete from public.room_reminders where room_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_room_live() from anon, authenticated;

-- Trigger name sorts after trg_notify_room_live so reminder-setters are
-- already stamped 'room_live' when this runs (same statement, same row).
create or replace function public.notify_v2_room_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_became_scheduled boolean;
  v_became_live boolean;
  v_recording_done boolean;
  v_discussion_opened boolean;
begin
  if new.is_private then
    return new;
  end if;

  v_became_scheduled :=
    new.scheduled_start is not null
    and new.status in ('created', 'scheduled')
    and (tg_op = 'INSERT' or old.scheduled_start is null);
  v_became_live :=
    new.status = 'live'
    and (tg_op = 'INSERT' or old.status is distinct from 'live');
  v_recording_done :=
    tg_op = 'UPDATE'
    and new.recording_ended_at is not null
    and old.recording_ended_at is null;
  v_discussion_opened :=
    tg_op = 'UPDATE'
    and new.discussion_post_id is not null
    and old.discussion_post_id is null;

  if v_became_scheduled then
    insert into public.notifications (user_id, type, actor_id, room_id, meta)
    select f.follower_id, 'followed_scheduled', new.host_id, new.id,
           jsonb_build_object('scheduled_start', new.scheduled_start)
    from public.user_follows f
    where f.following_id = new.host_id
      and f.follower_id <> new.host_id
      and public.notif_enabled(f.follower_id, 'followed_scheduled')
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
           or (b.blocker_id = new.host_id and b.blocked_id = f.follower_id))
      and not exists (
        select 1 from public.notifications n
        where n.user_id = f.follower_id and n.room_id = new.id
          and n.type = 'followed_scheduled');
  end if;

  if v_became_live then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select f.follower_id, 'followed_live', new.host_id, new.id
    from public.user_follows f
    where f.following_id = new.host_id
      and f.follower_id <> new.host_id
      and public.notif_enabled(f.follower_id, 'followed_live')
      and not exists (
        select 1 from public.room_reminders rr
        where rr.room_id = new.id and rr.user_id = f.follower_id)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
           or (b.blocker_id = new.host_id and b.blocked_id = f.follower_id))
      and not exists (
        select 1 from public.notifications n
        where n.user_id = f.follower_id and n.room_id = new.id
          and n.type in ('room_live', 'followed_live'));
  end if;

  if v_recording_done then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select s.uid, 'debate_replay_ready', null, new.id
    from (
      select new.host_id as uid
      union
      select p.user_id from public.debate_participants p
      where p.room_id = new.id and p.role = 'debater'
    ) s
    where public.notif_enabled(s.uid, 'debate_replay_ready')
      and not exists (
        select 1 from public.notifications n
        where n.user_id = s.uid and n.room_id = new.id
          and n.type = 'debate_replay_ready');
  end if;

  if v_discussion_opened then
    perform public.notif_emit(
      new.host_id, 'discussion_opened', auth.uid(),
      new.id, new.discussion_post_id, null, '{}'::jsonb, null);
  end if;

  return new;
end;
$$;
revoke execute on function public.notify_v2_room_state() from anon, authenticated;
drop trigger if exists trg_notify_v2_room_state on public.debate_rooms;
create trigger trg_notify_v2_room_state
  after insert or update of status, scheduled_start, recording_ended_at, discussion_post_id
  on public.debate_rooms
  for each row execute function public.notify_v2_room_state();

-- ─── 8. Read RPCs ────────────────────────────────────────────
drop function if exists public.get_notifications(integer);
drop function if exists public.get_notifications(integer, timestamptz);
create function public.get_notifications(
  p_limit integer default 30, p_before timestamptz default null
)
returns table(
  id uuid, type text,
  actor_id uuid, actor_username text, actor_display_name text, actor_avatar_url text,
  room_id uuid, room_motion text, room_status text, room_scheduled_start timestamptz,
  post_id uuid, post_title text, community_name text,
  comment_id uuid, comment_excerpt text,
  meta jsonb, read_at timestamptz, created_at timestamptz
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    n.id, n.type,
    n.actor_id, u.username, u.display_name, u.avatar_url,
    n.room_id, r.motion, r.status, r.scheduled_start,
    n.post_id, p.title, coalesce(pc.name, rc.name),
    n.comment_id,
    coalesce(n.meta ->> 'excerpt', left(c.body, 140)),
    n.meta, n.read_at, n.created_at
  from public.notifications n
  left join public.users u on u.id = n.actor_id
  left join public.debate_rooms r on r.id = n.room_id
  left join public.community_posts p on p.id = n.post_id
  left join public.community_comments c on c.id = n.comment_id
  left join public.communities pc on pc.id = p.community_id
  left join public.communities rc on rc.id = r.community_id
  where n.user_id = auth.uid()
    and (p_before is null or n.created_at < p_before)
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;
revoke all on function public.get_notifications(integer, timestamptz) from public, anon;
grant execute on function public.get_notifications(integer, timestamptz) to authenticated;

create or replace function public.get_unread_notification_count()
returns integer
language sql stable security definer
set search_path to 'public'
as $$
  select count(*)::int from public.notifications
  where user_id = auth.uid() and read_at is null;
$$;
revoke all on function public.get_unread_notification_count() from public, anon;
grant execute on function public.get_unread_notification_count() to authenticated;

create or replace function public.mark_all_notifications_read()
returns void
language sql security definer
set search_path to 'public'
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
$$;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql security definer
set search_path to 'public'
as $$
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_id and user_id = auth.uid();
$$;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- ─── 9. Delivery: poke /api/cron/notifications every minute ──
-- Only when something is waiting, so idle minutes cost nothing.
create or replace function public.dispatch_notification_push()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_origin text;
  n integer;
begin
  select count(*)::int into n
  from public.notifications
  where delivered_at is null
    and type in ('followed_live', 'followed_scheduled', 'debate_replay_ready')
    and created_at > now() - interval '30 minutes';
  if n = 0 then
    return 0;
  end if;

  select value into v_secret from public.app_config where key = 'reminder_webhook_secret';
  select value into v_origin from public.app_config where key = 'app_origin';
  if v_secret is null or v_origin is null then
    return 0;
  end if;

  perform net.http_post(
    url := v_origin || '/api/cron/notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  );
  return n;
end;
$$;
revoke execute on function public.dispatch_notification_push() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('notification-push');
exception when others then null;
end $$;
select cron.schedule('notification-push', '* * * * *', 'select public.dispatch_notification_push()');
