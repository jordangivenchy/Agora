-- Spam hardening sweep. Everything here is enforced in the database so
-- it holds for every client:
--   0. account_trust()      — verified email / day-old / moderator, in one place
--   1. follows              — hourly cap (30; 10 until day one), verified email,
--                             and no repeat "started following you" within a day
--   2. live rooms           — at most 2 open/live at once, none before day one
--                             (queue-matched 1v1 duels and moderators exempt)
--   3. uploads              — bucket size + MIME limits (were unset)
--   4. notification fan-out — one community_post / community_debate per
--                             recipient per board per hour
--   7. small things         — join-request message length, search history
--                             kept to 50 rows per user, live-listening
--                             transcript rate limit
-- (5 and 6 of the audit are code: the signals route and sign-up copy.)

-- ── 0. account_trust ─────────────────────────────────────────────────
create or replace function public.account_trust(p_user uuid default auth.uid())
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_confirmed timestamptz;
  v_created   timestamptz;
  v_mod       boolean := false;
begin
  if p_user is null then
    return jsonb_build_object('verified', false, 'day_old', false, 'moderator', false);
  end if;
  select email_confirmed_at, created_at into v_confirmed, v_created from auth.users where id = p_user;
  select coalesce(is_moderator, false) into v_mod from public.users where id = p_user;
  return jsonb_build_object(
    'verified',  v_confirmed is not null,
    'day_old',   coalesce(v_created <= now() - interval '1 day', false),
    'moderator', v_mod
  );
end;
$$;
revoke all on function public.account_trust(uuid) from public, anon;
grant execute on function public.account_trust(uuid) to authenticated;

-- ── 1. Follows ───────────────────────────────────────────────────────
-- Follow/unfollow churn would reset a count on user_follows itself, so
-- attempts are logged to a small table and counted from there.
create table if not exists public.follow_events (
  follower_id uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists follow_events_follower_idx on public.follow_events (follower_id, created_at desc);
alter table public.follow_events enable row level security;
revoke all on public.follow_events from public, anon, authenticated;

create or replace function public.user_follows_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_trust jsonb;
  v_cap   int;
  v_n     int;
begin
  if auth.uid() is null then return new; end if;
  v_trust := public.account_trust(new.follower_id);
  if not (v_trust->>'verified')::boolean then
    raise exception using errcode = 'P0001', message = 'email_unverified: Verify your email before following people.';
  end if;
  v_cap := case
    when (v_trust->>'moderator')::boolean then 1000
    when (v_trust->>'day_old')::boolean then 30
    else 10
  end;
  select count(*) into v_n from public.follow_events
  where follower_id = new.follower_id and created_at > now() - interval '1 hour';
  if v_n >= v_cap then
    raise exception using errcode = 'P0001', message = 'rate_limited: Too many follows this hour — try again later.';
  end if;
  insert into public.follow_events (follower_id) values (new.follower_id);
  -- Opportunistic tidy-up; the table only needs an hour of history.
  delete from public.follow_events where follower_id = new.follower_id and created_at < now() - interval '2 days';
  return new;
end;
$$;
revoke execute on function public.user_follows_guard() from anon, authenticated;
drop trigger if exists trg_user_follows_guard on public.user_follows;
create trigger trg_user_follows_guard
  before insert on public.user_follows
  for each row execute function public.user_follows_guard();

-- No repeat notification from the same person within a day, read or not
-- (the previous check only skipped while an earlier one was unread).
create or replace function public.notify_new_follower()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_type text;
begin
  if exists (
    select 1 from public.user_follows f
    where f.follower_id = new.following_id and f.following_id = new.follower_id
  ) then
    v_type := 'friend_accepted';
  else
    v_type := 'new_follower';
  end if;

  if coalesce((select notify_follows from public.user_settings
               where user_id = new.following_id), true)
     and not exists (
       select 1 from public.notifications n
       where n.user_id = new.following_id
         and n.actor_id = new.follower_id
         and n.type in ('new_follower', 'friend_accepted')
         and (n.read_at is null or n.created_at > now() - interval '1 day')
     )
  then
    insert into public.notifications (user_id, type, actor_id)
    values (new.following_id, v_type, new.follower_id);
  end if;
  return new;
end;
$$;

-- ── 2. Live rooms ────────────────────────────────────────────────────
create or replace function public.debate_rooms_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_trust jsonb;
  v_n     int;
begin
  if auth.uid() is null then return new; end if;
  -- Queue-matched duels are made for the user by the matcher, not opened
  -- by them; they already carry their own queue limits.
  if new.pro_size = 1 and new.con_size = 1 then return new; end if;
  v_trust := public.account_trust(new.host_id);
  if (v_trust->>'moderator')::boolean then return new; end if;
  if not (v_trust->>'verified')::boolean then
    raise exception using errcode = 'P0001', message = 'email_unverified: Verify your email before opening a room.';
  end if;
  if not (v_trust->>'day_old')::boolean then
    raise exception using errcode = 'P0001', message = 'account_too_new: New accounts can open rooms after their first day. Join a discussion or queue for a topic in the meantime.';
  end if;
  -- Scheduled rooms have their own cap (20260420); this one is for rooms
  -- opened right now.
  if new.scheduled_start is null then
    select count(*) into v_n from public.debate_rooms r
    where r.host_id = new.host_id
      and r.status in ('created', 'live')
      and r.scheduled_start is null
      and not (r.pro_size = 1 and r.con_size = 1);
    if v_n >= 2 then
      raise exception using errcode = 'P0001', message = 'max_open_rooms: You already have two open rooms — end one before opening another.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.debate_rooms_guard() from anon, authenticated;
drop trigger if exists trg_debate_rooms_guard on public.debate_rooms;
create trigger trg_debate_rooms_guard
  before insert on public.debate_rooms
  for each row execute function public.debate_rooms_guard();

-- ── 3. Uploads ───────────────────────────────────────────────────────
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id in ('avatars', 'post-images', 'thumbnails');
update storage.buckets
set file_size_limit = 157286400,
    allowed_mime_types = array['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']
where id = 'clips';

-- ── 4. Notification fan-out ──────────────────────────────────────────
create or replace function public.notify_community_post()
returns trigger
language plpgsql security definer set search_path = public
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
    )
    -- One unread "new post in <board>" per hour is plenty.
    and not exists (
      select 1 from public.notifications n
      join public.community_posts p on p.id = n.post_id
      where n.user_id = m.user_id
        and n.type = 'community_post'
        and n.read_at is null
        and n.created_at > now() - interval '1 hour'
        and p.community_id = new.community_id
    );
  return new;
end;
$$;
revoke execute on function public.notify_community_post() from anon, authenticated;

create or replace function public.notify_community_debate()
returns trigger
language plpgsql security definer set search_path = public
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
      )
      and not exists (
        select 1 from public.notifications n
        join public.debate_rooms r on r.id = n.room_id
        where n.user_id = m.user_id
          and n.type = 'community_debate'
          and n.read_at is null
          and n.created_at > now() - interval '1 hour'
          and r.community_id = new.community_id
      );
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_community_debate() from anon, authenticated;

-- ── 7. Small things ──────────────────────────────────────────────────
alter table public.community_join_requests drop constraint if exists community_join_requests_message_check;
alter table public.community_join_requests
  add constraint community_join_requests_message_check
  check (message is null or char_length(message) <= 1000);

create or replace function public.search_history_trim()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.search_history
  where user_id = new.user_id
    and id not in (
      select id from public.search_history
      where user_id = new.user_id
      order by created_at desc
      limit 50
    );
  return new;
end;
$$;
revoke execute on function public.search_history_trim() from anon, authenticated;
drop trigger if exists trg_search_history_trim on public.search_history;
create trigger trg_search_history_trim
  after insert on public.search_history
  for each row execute function public.search_history_trim();

create or replace function public.debate_utterances_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.debate_utterances
      where user_id = new.user_id and created_at > now() - interval '1 minute') >= 120 then
    raise exception using errcode = 'P0001', message = 'rate_limited: Transcript is arriving too fast.';
  end if;
  return new;
end;
$$;
revoke execute on function public.debate_utterances_rate_limit() from anon, authenticated;
drop trigger if exists trg_debate_utterances_rate_limit on public.debate_utterances;
create trigger trg_debate_utterances_rate_limit
  before insert on public.debate_utterances
  for each row execute function public.debate_utterances_rate_limit();
