-- Profile posts and post topics.
--
-- 1. Every user can post on their own profile: a personal board — a
--    communities row of kind 'profile', one per user, created on
--    demand by ensure_profile_community(). Only its owner can post
--    there (trigger); everyone can read and comment as on any public
--    board; the creation cap ignores it; a username change renames it.
-- 2. Verified accounts can attach a conversation topic to a post
--    (create_post_topic): a debate_topics row people queue into with
--    queue_for_topic, matched into a room the usual way. Cards read the
--    topic and its queue through get_post_topics.

-- ── Posts carry a topic ──
alter table public.community_posts
  add column if not exists topic_id uuid references public.debate_topics(id) on delete set null;
create index if not exists community_posts_topic_idx on public.community_posts(topic_id) where topic_id is not null;

-- ── One profile board per user ──
create unique index if not exists communities_profile_owner_uq on public.communities(created_by) where kind = 'profile';

-- The creation cap counts real communities only.
create or replace function public.community_creation_status()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare
  v_me        uuid := auth.uid();
  v_cap       int  := 3;
  v_count     int  := 0;
  v_confirmed timestamptz;
  v_created   timestamptz;
  v_mod       boolean := false;
  v_reason    text := null;
begin
  if v_me is null then
    return jsonb_build_object('allowed', false, 'reason', 'signed_out', 'count', 0, 'cap', v_cap);
  end if;
  select email_confirmed_at, created_at into v_confirmed, v_created from auth.users where id = v_me;
  select coalesce(is_moderator, false) into v_mod from public.users where id = v_me;
  select count(*) into v_count from public.communities where created_by = v_me and kind <> 'profile';
  if v_confirmed is null then
    v_reason := 'email_unverified';
  elsif not v_mod and v_created > now() - interval '1 day' then
    v_reason := 'account_too_new';
  elsif not v_mod and v_count >= v_cap then
    v_reason := 'community_limit';
  end if;
  return jsonb_build_object(
    'allowed', v_reason is null,
    'reason', v_reason,
    'count', v_count,
    'cap', case when v_mod then null else v_cap end,
    'account_age_hours', floor(extract(epoch from (now() - v_created)) / 3600)
  );
end;
$function$;

-- The guard lets a profile board through (owner only; the unique index keeps it to one).
create or replace function public.community_creation_guard()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_status jsonb;
begin
  if auth.uid() is null then return new; end if;
  if new.created_by is distinct from auth.uid() then
    raise exception 'created_by_mismatch' using errcode = '42501';
  end if;
  if new.kind = 'profile' then return new; end if;
  v_status := public.community_creation_status();
  if not (v_status->>'allowed')::boolean then
    raise exception '%', v_status->>'reason' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

create or replace function public.ensure_profile_community()
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_me   uuid := auth.uid();
  v_id   uuid;
  v_name text;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select id into v_id from public.communities where kind = 'profile' and created_by = v_me;
  if v_id is not null then return v_id; end if;
  select username into v_name from public.users where id = v_me;
  if v_name is null then raise exception using errcode = 'P0001', message = 'no_username: Pick a username first.'; end if;
  insert into public.communities (name, kind, description, color, created_by, is_private)
  values ('u/' || v_name, 'profile', 'Posts by @' || v_name, '#ffb700', v_me, false)
  returning id into v_id;
  insert into public.community_members (community_id, user_id, role)
  values (v_id, v_me, 'owner')
  on conflict do nothing;
  return v_id;
end;
$function$;
revoke all on function public.ensure_profile_community() from public;
grant execute on function public.ensure_profile_community() to authenticated;

-- Only the owner posts on a profile board.
create or replace function public.community_posts_profile_guard()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from public.communities c
    where c.id = new.community_id and c.kind = 'profile' and c.created_by <> new.author_id
  ) then
    raise exception using errcode = 'P0001', message = 'profile_board: Only the profile''s owner can post here.';
  end if;
  return new;
end;
$function$;
drop trigger if exists community_posts_profile_guard on public.community_posts;
create trigger community_posts_profile_guard
  before insert on public.community_posts
  for each row execute function public.community_posts_profile_guard();

-- A username change renames the board.
create or replace function public.rename_profile_community()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
begin
  if new.username is distinct from old.username then
    update public.communities
    set name = 'u/' || new.username, description = 'Posts by @' || new.username
    where kind = 'profile' and created_by = new.id;
  end if;
  return new;
end;
$function$;
drop trigger if exists users_rename_profile_community on public.users;
create trigger users_rename_profile_community
  after update of username on public.users
  for each row execute function public.rename_profile_community();

-- ── Verified authors attach a conversation topic to a post ──
create or replace function public.create_post_topic(p_post uuid, p_question text, p_topic_key text)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_me       uuid := auth.uid();
  v_q        text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_id       uuid;
  v_made     int;
  v_author   uuid;
  v_verified boolean;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select author_id into v_author from public.community_posts where id = p_post;
  if v_author is null or v_author <> v_me then
    raise exception using errcode = '42501', message = 'not_author: Only the post''s author can attach a topic.';
  end if;
  select coalesce(verified, false) into v_verified from public.users where id = v_me;
  if not v_verified then
    raise exception using errcode = 'P0001', message = 'not_verified: Only verified accounts can attach a conversation topic.';
  end if;
  if char_length(v_q) < 5 or char_length(v_q) > 200 then
    raise exception using errcode = 'P0001', message = 'bad_question: The question must be 5–200 characters.';
  end if;
  if p_topic_key not in ('politics-law','politics-ethics','sports','culture','economics','science-tech','foreign-policy','philosophy') then
    raise exception using errcode = 'P0001', message = 'bad_topic: Unknown field.';
  end if;

  select id into v_id from public.debate_topics where question = v_q;
  if v_id is null then
    select count(*) into v_made
    from public.debate_topics
    where created_by = v_me and created_at > now() - interval '1 hour';
    if v_made >= 10 then
      raise exception using errcode = 'P0001', message = 'rate_limited: Too many new questions this hour.';
    end if;
    insert into public.debate_topics (question, topic_key, active, created_by)
    values (v_q, p_topic_key, true, v_me)
    returning id into v_id;
  else
    update public.debate_topics set active = true where id = v_id and not active;
  end if;

  update public.community_posts set topic_id = v_id where id = p_post;
  return v_id;
end;
$function$;
revoke all on function public.create_post_topic(uuid, text, text) from public;
grant execute on function public.create_post_topic(uuid, text, text) to authenticated;

-- The topic and its live queue for a page of posts (rows only for posts that carry one).
create or replace function public.get_post_topics(p_posts uuid[])
returns table(
  post_id uuid, topic_id uuid, question text, topic_key text,
  queue_count bigint, pro_count bigint, con_count bigint, am_queued boolean, my_stance text
)
language sql stable security definer
set search_path to 'public'
as $function$
  with fresh as (
    select q.topic_id, q.user_id, q.stance
    from public.topic_queue q
    where q.matched_room_id is null
      and q.last_seen_at > now() - interval '30 seconds'
  )
  select
    p.id, t.id, t.question, t.topic_key,
    (select count(*) from fresh f where f.topic_id = t.id),
    (select count(*) from fresh f where f.topic_id = t.id and f.stance = 'PRO'),
    (select count(*) from fresh f where f.topic_id = t.id and f.stance = 'CON'),
    exists (select 1 from public.topic_queue q
             where q.topic_id = t.id and q.user_id = auth.uid() and q.matched_room_id is null),
    (select q.stance from public.topic_queue q
      where q.topic_id = t.id and q.user_id = auth.uid() and q.matched_room_id is null limit 1)
  from public.community_posts p
  join public.debate_topics t on t.id = p.topic_id
  where p.id = any(p_posts[1:100])
    and public.community_visible(p.community_id, auth.uid());
$function$;
revoke all on function public.get_post_topics(uuid[]) from public;
grant execute on function public.get_post_topics(uuid[]) to anon, authenticated;

-- A profile's Communities tab lists real communities only.
create or replace function public.get_user_communities(p_user uuid)
returns table(id uuid, name text, color text, avatar_url text, role text, member_count bigint)
language sql stable security definer
set search_path to 'public'
as $function$
  select
    c.id,
    c.name,
    c.color,
    c.avatar_url,
    cm.role,
    (select count(*) from public.community_members m
      where m.community_id = c.id) as member_count
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  where cm.user_id = p_user
    and c.kind <> 'profile'
    and public.community_visible(c.id, auth.uid())
  order by
    case cm.role when 'owner' then 0 when 'moderator' then 1 else 2 end,
    c.name asc;
$function$;

-- The board is named after the handle: @username, not u/username.
create or replace function public.ensure_profile_community()
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_me   uuid := auth.uid();
  v_id   uuid;
  v_name text;
begin
  if v_me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select id into v_id from public.communities where kind = 'profile' and created_by = v_me;
  if v_id is not null then return v_id; end if;
  select username into v_name from public.users where id = v_me;
  if v_name is null then raise exception using errcode = 'P0001', message = 'no_username: Pick a username first.'; end if;
  insert into public.communities (name, kind, description, color, created_by, is_private)
  values ('@' || v_name, 'profile', 'Posts by @' || v_name, '#ffb700', v_me, false)
  returning id into v_id;
  insert into public.community_members (community_id, user_id, role)
  values (v_id, v_me, 'owner')
  on conflict do nothing;
  return v_id;
end;
$function$;

create or replace function public.rename_profile_community()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
begin
  if new.username is distinct from old.username then
    update public.communities
    set name = '@' || new.username, description = 'Posts by @' || new.username
    where kind = 'profile' and created_by = new.id;
  end if;
  return new;
end;
$function$;

update public.communities c
set name = '@' || u.username
from public.users u
where c.kind = 'profile' and c.created_by = u.id and c.name <> '@' || u.username;
