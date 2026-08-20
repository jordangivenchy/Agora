-- ============================================================
-- 20260835_communities_v2.sql
--
-- Communities grow up: from open boards into real forums.
--
--   Privacy      — communities.is_private; private boards are listed
--                  (name + member count) but their posts/comments are
--                  member-only, enforced in RLS *and* inside the
--                  definer feed RPCs. Joining a private community goes
--                  through community_join_requests + mod approval.
--   Moderation   — community_members.role was already there; this adds
--                  is_community_mod(), mod deletes on posts/comments,
--                  set_community_role (owner promotes/demotes), and
--                  update_community_settings (rules/description/privacy).
--   Rules        — communities.rules, one rule per line, shown in the
--                  community header.
--   Tags         — community_tags, created by mods, one optional tag
--                  per post (validated by trigger against the post's
--                  own community).
--   Images       — community_posts.image_url + a public post-images
--                  bucket with per-user-folder policies (mirrors the
--                  thumbnails bucket).
--   Best sort    — wilson_lower_bound(ups, downs): the lower bound of
--                  the 95% Wilson confidence interval on the upvote
--                  ratio. High-ratio posts rank high, but a 2-vote
--                  wonder can't outrank a proven 500-vote thread.
--   Reposts      — repost_post() crossposts a public-community post
--                  into another community you can post in; the feed
--                  returns the embedded original. is_repost survives
--                  the original's deletion (repost_of goes null).
--   Notifications— 'community_post' (new post in a community you
--                  joined, honoring user_settings.notify_community_posts)
--                  and 'community_debate' (a debate scheduled in your
--                  community). notifications.post_id added for the
--                  former.
--   Debates      — debate_rooms.community_id; create_room gains
--                  p_community (member-checked) so debates can be
--                  scheduled from inside a community.
-- ============================================================

-- ─── 1. Columns ──────────────────────────────────────────────
alter table public.communities
  add column if not exists is_private boolean not null default false,
  add column if not exists rules text check (char_length(rules) <= 4000);

alter table public.community_posts
  add column if not exists image_url text check (char_length(image_url) <= 500),
  add column if not exists is_repost boolean not null default false,
  add column if not exists repost_of uuid references public.community_posts(id) on delete set null;
-- (tag_id is added in section 2, after community_tags exists.)

alter table public.debate_rooms
  add column if not exists community_id uuid references public.communities(id) on delete set null;
create index if not exists idx_debate_rooms_community
  on public.debate_rooms (community_id) where community_id is not null;

alter table public.notifications
  add column if not exists post_id uuid references public.community_posts(id) on delete cascade;
create index if not exists idx_notifications_post
  on public.notifications (post_id) where post_id is not null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'new_follower', 'room_live', 'room_starting_soon', 'room_invite',
    'friend_accepted', 'community_post', 'community_debate'
  ]));

alter table public.user_settings
  add column if not exists notify_community_posts boolean not null default true;

-- ─── 2. Tags ─────────────────────────────────────────────────
create table if not exists public.community_tags (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 24),
  color        text not null default '#8b8b94',
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (community_id, name)
);

alter table public.community_posts
  add column if not exists tag_id uuid references public.community_tags(id) on delete set null;

-- ─── 3. Membership helpers ───────────────────────────────────
create or replace function public.is_community_member(p_community uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = p_user
  );
$$;

create or replace function public.is_community_mod(p_community uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = p_user
      and role in ('owner', 'moderator')
  );
$$;

-- Visible = public board, or you're a member. Same predicate gates
-- reading and posting: public boards accept posts from anyone (as
-- before), private boards from members only.
create or replace function public.community_visible(p_community uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.communities c
    where c.id = p_community
      and (not c.is_private or public.is_community_member(p_community, p_user))
  );
$$;

grant execute on function public.is_community_member(uuid, uuid) to anon, authenticated;
grant execute on function public.is_community_mod(uuid, uuid) to anon, authenticated;
grant execute on function public.community_visible(uuid, uuid) to anon, authenticated;

-- ─── 4. RLS: privacy + mod powers ────────────────────────────
drop policy if exists "posts are readable by everyone" on public.community_posts;
create policy "posts readable where community is visible"
  on public.community_posts for select
  using (public.community_visible(community_id, auth.uid()));

drop policy if exists "users post as themselves" on public.community_posts;
create policy "users post as themselves where visible"
  on public.community_posts for insert
  with check (
    auth.uid() = author_id
    and public.community_visible(community_id, auth.uid())
  );

drop policy if exists "authors delete own posts" on public.community_posts;
create policy "authors and mods delete posts"
  on public.community_posts for delete
  using (auth.uid() = author_id or public.is_community_mod(community_id, auth.uid()));

drop policy if exists "comments are readable by everyone" on public.community_comments;
create policy "comments readable where community is visible"
  on public.community_comments for select
  using (public.community_visible(
    (select community_id from public.community_posts where id = post_id), auth.uid()));

drop policy if exists "users comment as themselves" on public.community_comments;
create policy "users comment as themselves where visible"
  on public.community_comments for insert
  with check (
    auth.uid() = author_id
    and public.community_visible(
      (select community_id from public.community_posts where id = post_id), auth.uid())
  );

drop policy if exists "authors delete own comments" on public.community_comments;
create policy "authors and mods delete comments"
  on public.community_comments for delete
  using (
    auth.uid() = author_id
    or public.is_community_mod(
      (select community_id from public.community_posts where id = post_id), auth.uid())
  );

-- Joining: self-serve only into public communities, and only as a
-- plain member — except the creator seeding their own owner row.
-- (The old policy let anyone insert themselves as 'owner' anywhere.)
drop policy if exists "users join communities as themselves" on public.community_members;
create policy "users join public communities as members"
  on public.community_members for insert
  with check (
    auth.uid() = user_id
    and (
      (select created_by from public.communities where id = community_id) = auth.uid()
      or (
        role = 'member'
        and not (select is_private from public.communities where id = community_id)
      )
    )
  );

-- Tags: labels are readable by everyone; only mods manage them.
alter table public.community_tags enable row level security;
drop policy if exists "tags are readable by everyone" on public.community_tags;
create policy "tags are readable by everyone"
  on public.community_tags for select using (true);
drop policy if exists "mods create tags" on public.community_tags;
create policy "mods create tags"
  on public.community_tags for insert
  with check (auth.uid() = created_by and public.is_community_mod(community_id, auth.uid()));
drop policy if exists "mods delete tags" on public.community_tags;
create policy "mods delete tags"
  on public.community_tags for delete
  using (public.is_community_mod(community_id, auth.uid()));

-- A post's tag must belong to the post's own community.
create or replace function public.validate_post_tag()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.tag_id is not null and not exists (
    select 1 from public.community_tags
    where id = new.tag_id and community_id = new.community_id
  ) then
    raise exception 'tag_mismatch: That tag belongs to a different community.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_post_tag() from anon, authenticated;
drop trigger if exists trg_validate_post_tag on public.community_posts;
create trigger trg_validate_post_tag
  before insert or update of tag_id on public.community_posts
  for each row execute function public.validate_post_tag();

-- ─── 5. Join requests (private communities) ──────────────────
create table if not exists public.community_join_requests (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.community_join_requests enable row level security;

drop policy if exists "requesters and mods see requests" on public.community_join_requests;
create policy "requesters and mods see requests"
  on public.community_join_requests for select
  using (auth.uid() = user_id or public.is_community_mod(community_id, auth.uid()));

drop policy if exists "requesters cancel own requests" on public.community_join_requests;
create policy "requesters cancel own requests"
  on public.community_join_requests for delete
  using (auth.uid() = user_id);
-- Inserts go through request_to_join(); approval through the RPCs below.

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
  insert into public.community_members (community_id, user_id, role)
  values (p_community, p_user, 'member')
  on conflict do nothing;
  delete from public.community_join_requests
  where community_id = p_community and user_id = p_user;
end;
$$;
revoke all on function public.approve_join_request(uuid, uuid) from public, anon;
grant execute on function public.approve_join_request(uuid, uuid) to authenticated;

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
end;
$$;
revoke all on function public.deny_join_request(uuid, uuid) from public, anon;
grant execute on function public.deny_join_request(uuid, uuid) to authenticated;

-- ─── 6. Community settings + roles ───────────────────────────
-- Null leaves a field unchanged; empty string clears description/rules.
-- Privacy flips are owner-only (a mod shouldn't be able to lock the
-- owner's board or expose a private one).
create or replace function public.update_community_settings(
  p_community   uuid,
  p_description text default null,
  p_rules       text default null,
  p_is_private  boolean default null
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
    is_private  = coalesce(p_is_private, is_private)
  where id = p_community;
end;
$$;
revoke all on function public.update_community_settings(uuid, text, text, boolean) from public, anon;
grant execute on function public.update_community_settings(uuid, text, text, boolean) to authenticated;

-- Owner promotes members to moderator and back. No touching owners.
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
end;
$$;
revoke all on function public.set_community_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_community_role(uuid, uuid, text) to authenticated;

-- ─── 7. Wilson "Best" ────────────────────────────────────────
-- Lower bound of the 95% Wilson score interval on the upvote ratio
-- (z = 1.96). Ranks by how confident we are the post is good, not by
-- raw score — a 3/3 post can't outrank a 480/520 one.
create or replace function public.wilson_lower_bound(ups bigint, downs bigint)
returns double precision
language sql immutable
as $$
  select case
    when coalesce(ups, 0) + coalesce(downs, 0) = 0 then 0
    else (
      (ups::float8 / (ups + downs)) + 1.9208 / (ups + downs)
      - 1.96 * sqrt(
          ((ups::float8 / (ups + downs)) * (1 - ups::float8 / (ups + downs))
           + 0.9604 / (ups + downs)) / (ups + downs))
    ) / (1 + 3.8416 / (ups + downs))
  end;
$$;
grant execute on function public.wilson_lower_bound(bigint, bigint) to anon, authenticated;

-- ─── 8. Feed RPCs ────────────────────────────────────────────
-- Columns are append-only over 20260829's shape so older clients keep
-- working. New: image_url, tag, author's role in the community (badge),
-- repost embed, and p_sort = 'best'.
drop function if exists public.get_community_posts(uuid, text, integer);
create function public.get_community_posts(p_community uuid default null, p_sort text default 'new', p_limit integer default 50)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text,
  image_url text, tag_id uuid, tag_name text, tag_color text, author_role text,
  is_repost boolean, repost_of uuid, orig_title text, orig_body text,
  orig_image_url text, orig_community_name text,
  orig_author_username text, orig_author_display_name text
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
    p.is_repost, p.repost_of, op.title, op.body,
    op.image_url, oc.name,
    case when op.id is not null then coalesce(ou.username, '(deleted)') end,
    ou.display_name
  from public.community_posts p
  join public.communities c on c.id = p.community_id
  left join public.users u on u.id = p.author_id
  left join public.community_tags t on t.id = p.tag_id
  left join public.community_posts op on op.id = p.repost_of
  left join public.users ou on ou.id = op.author_id
  left join public.communities oc on oc.id = op.community_id
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
    and public.community_visible(p.community_id, auth.uid())
  order by
    case when p_sort = 'top' then coalesce(v.score, 0) end desc nulls last,
    case when p_sort = 'best'
      then public.wilson_lower_bound(coalesce(v.ups, 0), coalesce(v.downs, 0)) end desc nulls last,
    p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;
grant execute on function public.get_community_posts(uuid, text, integer) to anon, authenticated;

drop function if exists public.get_community_post(uuid);
create function public.get_community_post(p_post uuid)
returns table(
  id uuid, community_id uuid, community_name text, author_id uuid,
  author_username text, title text, body text, created_at timestamptz,
  score bigint, my_vote smallint, comment_count bigint, author_display_name text,
  image_url text, tag_id uuid, tag_name text, tag_color text, author_role text,
  is_repost boolean, repost_of uuid, orig_title text, orig_body text,
  orig_image_url text, orig_community_name text,
  orig_author_username text, orig_author_display_name text
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
    p.is_repost, p.repost_of, op.title, op.body,
    op.image_url, oc.name,
    case when op.id is not null then coalesce(ou.username, '(deleted)') end,
    ou.display_name
  from public.community_posts p
  join public.communities c on c.id = p.community_id
  left join public.users u on u.id = p.author_id
  left join public.community_tags t on t.id = p.tag_id
  left join public.community_posts op on op.id = p.repost_of
  left join public.users ou on ou.id = op.author_id
  left join public.communities oc on oc.id = op.community_id
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

drop function if exists public.get_post_comments(uuid);
create function public.get_post_comments(p_post uuid)
returns table(
  id uuid, post_id uuid, parent_id uuid, author_id uuid, author_username text,
  body text, created_at timestamptz, score bigint, my_vote smallint,
  author_display_name text, author_role text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    c.id, c.post_id, c.parent_id, c.author_id,
    coalesce(u.username, '(deleted)'), c.body, c.created_at,
    coalesce(v.score, 0), mv.value,
    u.display_name,
    (select cm.role from public.community_members cm
      where cm.community_id = p.community_id and cm.user_id = c.author_id)
  from public.community_comments c
  join public.community_posts p on p.id = c.post_id
  left join public.users u on u.id = c.author_id
  left join lateral (
    select sum(value)::bigint as score from public.community_comment_votes
    where comment_id = c.id
  ) v on true
  left join public.community_comment_votes mv
    on mv.comment_id = c.id and mv.user_id = auth.uid()
  where c.post_id = p_post
    and public.community_visible(p.community_id, auth.uid())
  order by c.created_at asc;
$$;
grant execute on function public.get_post_comments(uuid) to anon, authenticated;

-- Votes respect privacy too (the definer bypasses RLS).
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

  if p_value = 0 then
    delete from public.community_post_votes where post_id = p_post and user_id = v_me;
  else
    insert into public.community_post_votes (post_id, user_id, value)
    values (p_post, v_me, p_value)
    on conflict (post_id, user_id) do update set value = excluded.value;
  end if;
end;
$$;

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

  if p_value = 0 then
    delete from public.community_comment_votes where comment_id = p_comment and user_id = v_me;
  else
    insert into public.community_comment_votes (comment_id, user_id, value)
    values (p_comment, v_me, p_value)
    on conflict (comment_id, user_id) do update set value = excluded.value;
  end if;
end;
$$;

-- ─── 9. Reposts ──────────────────────────────────────────────
-- Crosspost a post into another community. Sources must live in a
-- public community (a repost out of a private board would leak it);
-- the target must be one the caller can post in. Reposting a repost
-- chases the original so chains don't form.
create or replace function public.repost_post(
  p_post uuid, p_community uuid, p_body text default null
)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_me     uuid := auth.uid();
  v_src    public.community_posts%rowtype;
  v_new_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;

  select * into v_src from public.community_posts where id = p_post;
  if v_src.id is null then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;
  -- Chase one level: reposting a repost shares the original.
  if v_src.is_repost and v_src.repost_of is not null then
    select * into v_src from public.community_posts where id = v_src.repost_of;
    if v_src.id is null then
      raise exception 'post_not_found' using errcode = 'P0001';
    end if;
  end if;

  if (select is_private from public.communities where id = v_src.community_id) then
    raise exception 'private_source: Posts in private communities can''t be shared out.' using errcode = 'P0001';
  end if;
  if p_community = v_src.community_id then
    raise exception 'same_community: That post already lives here.' using errcode = 'P0001';
  end if;
  if not public.community_visible(p_community, v_me) then
    raise exception 'not_visible' using errcode = '42501';
  end if;

  insert into public.community_posts
    (community_id, author_id, title, body, is_repost, repost_of)
  values
    (p_community, v_me, v_src.title, nullif(trim(coalesce(p_body, '')), ''), true, v_src.id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;
revoke all on function public.repost_post(uuid, uuid, text) from public, anon;
grant execute on function public.repost_post(uuid, uuid, text) to authenticated;

-- ─── 10. Notifications ───────────────────────────────────────
-- New post in a community you joined. The posts rate limit (5 per 10
-- minutes per author) keeps the fan-out bounded.
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
                  where user_id = m.user_id), true);
  return new;
end;
$$;
revoke execute on function public.notify_community_post() from anon, authenticated;
drop trigger if exists trg_notify_community_post on public.community_posts;
create trigger trg_notify_community_post
  after insert on public.community_posts
  for each row execute function public.notify_community_post();

-- A debate created in (or scheduled for) a community tells its members.
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
      and m.user_id <> new.host_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_community_debate() from anon, authenticated;
drop trigger if exists trg_notify_community_debate on public.debate_rooms;
create trigger trg_notify_community_debate
  after insert on public.debate_rooms
  for each row execute function public.notify_community_debate();

-- ─── 11. create_room learns about communities ────────────────
-- Signature change (11th arg, defaulted): drop the old one first so
-- named-argument calls stay unambiguous.
drop function if exists public.create_room(
  text, text, text, text, boolean, boolean, integer, integer, integer, timestamptz);
create function public.create_room(
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

  -- Community debates come from community members.
  if p_community is not null
     and not public.is_community_member(p_community, v_me) then
    raise exception 'not_a_member: Join the community to schedule its debates.' using errcode = '42501';
  end if;

  -- Generate invite code for private rooms.
  if p_is_private then
    v_code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  else
    v_code := null;
  end if;

  -- Scheduled rooms start in 'created' status; immediate rooms go 'live'.
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
revoke all on function public.create_room(text, text, text, text, boolean, boolean, integer, integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.create_room(text, text, text, text, boolean, boolean, integer, integer, integer, timestamptz, uuid) to authenticated;

-- ─── 12. Bell payload ────────────────────────────────────────
-- The bell's RPC learns the new types' context: the post's title and
-- the community name (from the post for community_post, from the room
-- for community_debate). Columns append-only, as usual.
drop function if exists public.get_notifications(integer);
create function public.get_notifications(p_limit integer default 30)
returns table(
  id uuid, type text, actor_id uuid, actor_username text, room_id uuid,
  room_motion text, read_at timestamptz, created_at timestamptz, actor_display_name text,
  post_id uuid, post_title text, community_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    n.id, n.type, n.actor_id,
    u.username, n.room_id, r.motion, n.read_at, n.created_at,
    u.display_name,
    n.post_id, p.title,
    coalesce(pc.name, rc.name)
  from public.notifications n
  left join public.users u on u.id = n.actor_id
  left join public.debate_rooms r on r.id = n.room_id
  left join public.community_posts p on p.id = n.post_id
  left join public.communities pc on pc.id = p.community_id
  left join public.communities rc on rc.id = r.community_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;
grant execute on function public.get_notifications(integer) to authenticated;

-- ─── 13. post-images bucket ──────────────────────────────────
-- Public bucket, per-user folders — same posture as thumbnails/avatars.
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

drop policy if exists "post images public read" on storage.objects;
create policy "post images public read" on storage.objects
  for select using (bucket_id = 'post-images');

drop policy if exists "post images upload own folder" on storage.objects;
create policy "post images upload own folder" on storage.objects
  for insert with check (
    bucket_id = 'post-images'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists "post images update own folder" on storage.objects;
create policy "post images update own folder" on storage.objects
  for update using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists "post images delete own folder" on storage.objects;
create policy "post images delete own folder" on storage.objects
  for delete using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
