-- ─── A replay's comments are its own; a thread is a choice ────────────
-- Commenting under a past discussion used to make a post in a community
-- — the first comment published the room to a feed nobody asked for. The
-- comments now hang on a post that no feed lists (listed = false); the
-- host turns it into a thread in a community when they want one, and
-- then it shows up there like any other post.

alter table public.community_posts
  add column if not exists listed boolean not null default true;

create index if not exists community_posts_listed_idx
  on public.community_posts (community_id, created_at desc) where listed;

-- Feeds, community pages and profiles list posts through this one
-- function: unlisted comment threads stay out of all of them.
create or replace function public.get_community_posts(p_community uuid default null, p_sort text default 'new', p_limit integer default 50, p_author uuid default null, p_offset integer default 0)
returns table(id uuid, community_id uuid, community_name text, author_id uuid, author_username text, title text, body text, created_at timestamp with time zone, score bigint, my_vote smallint, comment_count bigint, author_display_name text, image_url text, tag_id uuid, tag_name text, tag_color text, author_role text, is_repost boolean, repost_of uuid, orig_title text, orig_body text, orig_image_url text, orig_community_name text, orig_author_username text, orig_author_display_name text, pinned_at timestamp with time zone, featured_at timestamp with time zone, edited_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    p.id, p.community_id, c.name, p.author_id,
    coalesce(u.username, '(deleted)'), p.title, p.body, p.created_at,
    coalesce(v.score, 0), mv.value, coalesce(cc.n, 0),
    u.display_name,
    p.image_url, p.tag_id, t.name, t.color,
    case when c.kind = 'profile' then null else
      (select cm.role from public.community_members cm
        where cm.community_id = p.community_id and cm.user_id = p.author_id) end,
    p.is_repost,
    case when ov.visible then p.repost_of end,
    case when ov.visible then op.title end,
    case when ov.visible then op.body end,
    case when ov.visible then op.image_url end,
    case when ov.visible then oc.name end,
    case when ov.visible then coalesce(ou.username, '(deleted)') end,
    case when ov.visible then ou.display_name end,
    p.pinned_at,
    p.featured_at,
    p.edited_at
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
    and p.listed
    and public.community_visible(p.community_id, auth.uid())
  order by
    case when p_community is not null and p.pinned_at is not null then p.pinned_at end asc nulls last,
    case when p_sort = 'top' then coalesce(v.score, 0) end desc nulls last,
    case when p_sort = 'best'
      then public.wilson_lower_bound(coalesce(v.ups, 0), coalesce(v.downs, 0)) end desc nulls last,
    p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

-- The comment container: the same post as before, but unlisted, so
-- commenting publishes nothing anywhere.
create or replace function public.ensure_debate_discussion(p_room uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_room      public.debate_rooms%rowtype;
  v_community uuid;
  v_post      uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if public.is_suspended(auth.uid()) then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select * into v_room from public.debate_rooms where id = p_room for update;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  if v_room.status <> 'ended' then
    raise exception 'room_not_ended' using errcode = 'P0001';
  end if;
  if v_room.discussion_post_id is not null
     and exists (select 1 from public.community_posts where id = v_room.discussion_post_id) then
    return v_room.discussion_post_id;
  end if;

  /* It has to live somewhere; unlisted, nobody reads it there. */
  v_community := '00000000-0000-4000-8000-00000000deba';

  insert into public.community_posts (community_id, author_id, title, body, listed)
  values (v_community, v_room.host_id, left(v_room.motion, 200), null, false)
  returning id into v_post;

  update public.debate_rooms set discussion_post_id = v_post where id = p_room;
  return v_post;
end;
$function$;

-- Making it a thread: the host (or a co-host) picks the community, and
-- from then on it is a post like any other, comments and all.
create or replace function public.publish_debate_discussion(p_room uuid, p_community uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_room public.debate_rooms%rowtype;
  v_post uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if public.is_suspended(auth.uid()) then raise exception 'your account is suspended'; end if;

  select * into v_room from public.debate_rooms where id = p_room for update;
  if not found then raise exception 'room_not_found' using errcode = 'P0002'; end if;
  if v_room.status <> 'ended' then raise exception 'the discussion is still open'; end if;
  if not public.can_frame_room(p_room, auth.uid()) then
    raise exception 'only the host can make this a thread';
  end if;
  if not public.community_visible(p_community, auth.uid()) then
    raise exception 'you can''t post in that community';
  end if;
  if public.is_community_banned(p_community, auth.uid()) then
    raise exception 'you can''t post in that community';
  end if;

  v_post := public.ensure_debate_discussion(p_room);
  update public.community_posts
     set community_id = p_community, listed = true
   where id = v_post;
  return v_post;
end;
$function$;

grant execute on function public.publish_debate_discussion(uuid, uuid) to authenticated;

-- The one that already exists was made the old way: it is a comment
-- thread, not something its community asked for.
update public.community_posts p
   set listed = false
  from public.debate_rooms r
 where r.discussion_post_id = p.id
   and p.community_id = '00000000-0000-4000-8000-00000000deba';
