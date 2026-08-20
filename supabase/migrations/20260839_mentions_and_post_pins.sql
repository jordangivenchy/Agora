-- ============================================================
-- 20260839_mentions_and_post_pins.sql
--
-- @mentions — writing @username in a post (title/body) or comment
--   notifies that user (type 'mention', capped at 5 per item, author
--   excluded, and only when the mentioned user can actually see the
--   board — no leaking private-community activity).
-- Post pins — mods pin posts to the top of their board's feed
--   (community view only; the All-posts feed ignores pins). Same
--   posture as comment pins: pinned_at column, mod-checked RPC.
-- ============================================================

-- ─── Post pins ───────────────────────────────────────────────
alter table public.community_posts
  add column if not exists pinned_at timestamptz;

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
end;
$$;
revoke all on function public.set_post_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_post_pinned(uuid, boolean) to authenticated;

-- ─── Mentions ────────────────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'new_follower', 'room_live', 'room_starting_soon', 'room_invite',
    'friend_accepted', 'community_post', 'community_debate', 'mention'
  ]));

-- Shared fan-out: parse @handles out of text, notify matching users.
-- Guards: author excluded, at most 5 distinct mentions per item, and the
-- mentioned user must be able to see the board (community_visible).
create or replace function public.notify_mentions(
  p_text text, p_author uuid, p_post uuid, p_community uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, actor_id, post_id)
  select u.id, 'mention', p_author, p_post
  from (
    select distinct lower(m[1]) as uname
    from regexp_matches(coalesce(p_text, ''), '@([a-zA-Z0-9_]{3,20})', 'g') m
    limit 5
  ) hits
  join public.users u on lower(u.username) = hits.uname
  where u.id <> p_author
    and public.community_visible(p_community, u.id)
    -- one mention notification per user per post, not one per edit/reply spam
    and not exists (
      select 1 from public.notifications n
      where n.user_id = u.id and n.type = 'mention'
        and n.post_id = p_post and n.actor_id = p_author
        and n.created_at > now() - interval '1 hour'
    );
end;
$$;
revoke all on function public.notify_mentions(text, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.notify_post_mentions()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_mentions(
    coalesce(new.title, '') || ' ' || coalesce(new.body, ''),
    new.author_id, new.id, new.community_id);
  return new;
end;
$$;
revoke execute on function public.notify_post_mentions() from anon, authenticated;
drop trigger if exists trg_notify_post_mentions on public.community_posts;
create trigger trg_notify_post_mentions
  after insert on public.community_posts
  for each row execute function public.notify_post_mentions();

create or replace function public.notify_comment_mentions()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_community uuid;
begin
  select community_id into v_community from public.community_posts where id = new.post_id;
  if v_community is not null then
    perform public.notify_mentions(new.body, new.author_id, new.post_id, v_community);
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_comment_mentions() from anon, authenticated;
drop trigger if exists trg_notify_comment_mentions on public.community_comments;
create trigger trg_notify_comment_mentions
  after insert on public.community_comments
  for each row execute function public.notify_comment_mentions();

-- ─── Feed RPCs learn pinned_at ───────────────────────────────
-- Pinned posts lead ONLY inside their own board (p_community set);
-- the cross-community All feed keeps its pure sort.
drop function if exists public.get_community_posts(uuid, text, integer, uuid);
create function public.get_community_posts(
  p_community uuid default null, p_sort text default 'new',
  p_limit integer default 50, p_author uuid default null
)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text,
  image_url text, tag_id uuid, tag_name text, tag_color text, author_role text,
  is_repost boolean, repost_of uuid, orig_title text, orig_body text,
  orig_image_url text, orig_community_name text,
  orig_author_username text, orig_author_display_name text,
  pinned_at timestamptz
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    p.id, p.community_id, c.name, p.author_id,
    coalesce(u.username, '(deleted)'), p.title, p.body, p.created_at,
    coalesce(v.score, 0), mv.value, coalesce(cc.n, 0),
    u.display_name,
    p.image_url, p.tag_id, t.name, t.color,
    (select cm.role from public.community_members cm
      where cm.community_id = p.community_id and cm.user_id = p.author_id),
    p.is_repost,
    case when ov.visible then p.repost_of end,
    case when ov.visible then op.title end,
    case when ov.visible then op.body end,
    case when ov.visible then op.image_url end,
    case when ov.visible then oc.name end,
    case when ov.visible then coalesce(ou.username, '(deleted)') end,
    case when ov.visible then ou.display_name end,
    p.pinned_at
  from public.community_posts p
  join public.communities c on c.id = p.community_id
  left join public.users u on u.id = p.author_id
  left join public.community_tags t on t.id = p.tag_id
  left join public.community_posts op on op.id = p.repost_of
  left join public.users ou on ou.id = op.author_id
  left join public.communities oc on oc.id = op.community_id
  left join lateral (
    select op.id is not null
       and public.community_visible(op.community_id, auth.uid()) as visible
  ) ov on true
  left join lateral (
    select sum(value)::bigint as score,
           count(*) filter (where value = 1) as ups,
           count(*) filter (where value = -1) as downs
    from public.community_post_votes
    where post_id = p.id
  ) v on true
  left join public.community_post_votes mv
    on mv.post_id = p.id and mv.user_id = auth.uid()
  left join lateral (
    select count(*)::bigint as n from public.community_comments
    where post_id = p.id
  ) cc on true
  where (p_community is null or p.community_id = p_community)
    and (p_author is null or p.author_id = p_author)
    and public.community_visible(p.community_id, auth.uid())
  order by
    case when p_community is not null and p.pinned_at is not null then p.pinned_at end asc nulls last,
    case when p_sort = 'top' then coalesce(v.score, 0) end desc nulls last,
    case when p_sort = 'best'
      then public.wilson_lower_bound(coalesce(v.ups, 0), coalesce(v.downs, 0)) end desc nulls last,
    p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;
grant execute on function public.get_community_posts(uuid, text, integer, uuid) to anon, authenticated;

drop function if exists public.get_community_post(uuid);
create function public.get_community_post(p_post uuid)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text,
  image_url text, tag_id uuid, tag_name text, tag_color text, author_role text,
  is_repost boolean, repost_of uuid, orig_title text, orig_body text,
  orig_image_url text, orig_community_name text,
  orig_author_username text, orig_author_display_name text,
  pinned_at timestamptz
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    p.id, p.community_id, c.name, p.author_id,
    coalesce(u.username, '(deleted)'), p.title, p.body, p.created_at,
    coalesce(v.score, 0), mv.value, coalesce(cc.n, 0),
    u.display_name,
    p.image_url, p.tag_id, t.name, t.color,
    (select cm.role from public.community_members cm
      where cm.community_id = p.community_id and cm.user_id = p.author_id),
    p.is_repost,
    case when ov.visible then p.repost_of end,
    case when ov.visible then op.title end,
    case when ov.visible then op.body end,
    case when ov.visible then op.image_url end,
    case when ov.visible then oc.name end,
    case when ov.visible then coalesce(ou.username, '(deleted)') end,
    case when ov.visible then ou.display_name end,
    p.pinned_at
  from public.community_posts p
  join public.communities c on c.id = p.community_id
  left join public.users u on u.id = p.author_id
  left join public.community_tags t on t.id = p.tag_id
  left join public.community_posts op on op.id = p.repost_of
  left join public.users ou on ou.id = op.author_id
  left join public.communities oc on oc.id = op.community_id
  left join lateral (
    select op.id is not null
       and public.community_visible(op.community_id, auth.uid()) as visible
  ) ov on true
  left join lateral (
    select sum(value)::bigint as score
    from public.community_post_votes
    where post_id = p.id
  ) v on true
  left join public.community_post_votes mv
    on mv.post_id = p.id and mv.user_id = auth.uid()
  left join lateral (
    select count(*)::bigint as n from public.community_comments
    where post_id = p.id
  ) cc on true
  where p.id = p_post
    and public.community_visible(p.community_id, auth.uid());
$$;
grant execute on function public.get_community_post(uuid) to anon, authenticated;

-- Username search for the composer's @-autocomplete (tiny, indexed by
-- the trgm index from the search sweep).
create or replace function public.search_mention_users(p_query text, p_limit integer default 5)
returns table(id uuid, username text, display_name text, avatar_url text)
language sql stable security definer
set search_path to 'public'
as $$
  select u.id, u.username, u.display_name, u.avatar_url
  from public.users u
  where u.username ilike p_query || '%'
    and u.username is not null
  order by u.username asc
  limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;
grant execute on function public.search_mention_users(text, integer) to authenticated;

-- ─── Community discussions are a mod privilege ───────────────
-- (Rail requirement: only mod-scheduled discussions represent the
-- community.) create_room's p_community check tightens from member
-- to moderator.
create or replace function public.create_room(
  p_motion text, p_topic_key text, p_language text, p_stance text,
  p_is_private boolean, p_allow_spectators boolean,
  p_pro_size integer, p_con_size integer,
  p_time_limit_seconds integer, p_scheduled_start timestamptz,
  p_community uuid default null
)
returns table(room_id uuid, invite_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me       uuid := auth.uid();
  v_room_id  uuid;
  v_code     text;
  v_status   text;
  v_started  timestamptz;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;

  if char_length(trim(p_motion)) = 0 then
    raise exception 'motion_required' using errcode = 'P0001';
  end if;

  if p_pro_size + p_con_size > 20 then
    raise exception 'team_size_too_large' using errcode = 'P0001';
  end if;

  -- Community discussions are scheduled by the board's moderators.
  if p_community is not null
     and not public.is_community_mod(p_community, v_me) then
    raise exception 'not_a_mod: Only moderators can start discussions for the community.' using errcode = '42501';
  end if;

  if p_is_private then
    v_code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  else
    v_code := null;
  end if;

  if p_scheduled_start is not null then
    if p_scheduled_start <= now() + interval '60 seconds' then
      raise exception 'scheduled_start_too_soon' using errcode = 'P0001';
    end if;
    v_status  := 'created';
    v_started := null;
  else
    v_status  := 'live';
    v_started := now();
  end if;

  insert into public.debate_rooms (
    motion, host_id, topic_key, format, language,
    status, is_private, invite_code, allow_spectators,
    pro_size, con_size, fact_check_intensity, time_limit_seconds,
    allow_audience_questions, recording_consent,
    scheduled_start, started_at, community_id
  ) values (
    trim(p_motion), v_me, p_topic_key, 'open', p_language,
    v_status, p_is_private, v_code,
    case when p_is_private then p_allow_spectators else true end,
    p_pro_size, p_con_size, 'off', p_time_limit_seconds,
    false, false,
    p_scheduled_start, v_started, p_community
  )
  returning id into v_room_id;

  insert into public.debate_participants (room_id, user_id, role, stance)
  values (v_room_id, v_me, 'debater', p_stance);

  return query select v_room_id, v_code;
end;
$function$;
