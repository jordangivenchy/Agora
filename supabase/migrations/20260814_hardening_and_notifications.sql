-- ============================================================
-- 20260814_hardening_and_notifications.sql
--
-- Part A — hardening pass (from the Supabase security advisors +
--          known gaps):
--   1. Pin search_path on the four flagged functions.
--   2. Revoke RPC execute where it was never intended: trigger
--      functions and host_kick_user_internal from client roles, and
--      auth-only / moderator-only functions from anon. (The advisor
--      also flags every definer RPC as anon/authenticated-callable —
--      that IS this schema's architecture; each one validates
--      auth.uid() internally. Left as-is by design.)
--   3. vote_news_topic rewritten: requires auth, one vote per user
--      (news_topic_votes ledger), search_path pinned.
--   4. Chat flood control: max 8 messages per 10 seconds per user,
--      enforced by trigger — client UI can't be trusted for this.
--
-- Part B — notifications backend:
--   5. notifications table. RLS: recipients read + mark-read their
--      own rows; nobody inserts from the client (definer/triggers).
--   6. Preferences as user_settings columns (notify_follows,
--      notify_room_live), honored INSIDE the triggers.
--   7. Triggers: new follower; room going live notifies the host's
--      followers.
--   8. RPCs: get_notifications, mark_notifications_read. Realtime
--      publication so clients can subscribe to their own stream.
--
-- Advisor findings intentionally NOT "fixed":
--   - rls_enabled_no_policy on mod_notes / password_reset_attempts /
--     security_audit_log / user_reports: deliberate. These tables are
--     definer-RPC-only; a policy would widen access.
--   - auth_leaked_password_protection: dashboard setting (Auth →
--     Passwords), cannot be enabled via SQL.
-- ============================================================

-- ─── A1. Pin search_path ─────────────────────────────────────
alter function public.handle_new_user() set search_path = public;
alter function public.enforce_max_scheduled_rooms() set search_path = public;
alter function public.touch_user_settings() set search_path = public;
-- vote_news_topic is replaced wholesale in A3.

-- ─── A2. Tighten execute grants ──────────────────────────────
-- Trigger functions: triggers run as the function owner; client roles
-- never need EXECUTE, and exposing them as RPCs is pure attack surface.
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.enforce_max_scheduled_rooms() from anon, authenticated;
revoke execute on function public.touch_user_settings() from anon, authenticated;
-- Internal helper only ever called from other definer functions.
revoke execute on function public.host_kick_user_internal(uuid, uuid) from anon, authenticated;
-- Maintenance job, not a client API.
revoke execute on function public.prune_password_reset_attempts() from anon, authenticated;

-- Functions that always require an authenticated caller: no anon.
revoke execute on function public.mod_get_user_moderation(uuid) from anon;
revoke execute on function public.mod_add_note(uuid, text) from anon;
revoke execute on function public.mod_warn_user(uuid, text) from anon;
revoke execute on function public.mod_suspend_user(uuid, integer) from anon;
revoke execute on function public.mod_unsuspend_user(uuid) from anon;
revoke execute on function public.mod_list_reports(text, integer) from anon;
revoke execute on function public.mod_resolve_report(uuid, text) from anon;
revoke execute on function public.assert_moderator() from anon;
revoke execute on function public.block_user(uuid) from anon;
revoke execute on function public.unblock_user(uuid) from anon;
revoke execute on function public.submit_report(uuid, text, text, text, uuid, uuid) from anon;
revoke execute on function public.delete_own_account() from anon;
revoke execute on function public.is_suspended(uuid) from anon;
revoke execute on function public.host_kick_user(uuid, uuid) from anon;
revoke execute on function public.host_ban_user(uuid, uuid, integer) from anon;
revoke execute on function public.host_set_participant_role(uuid, uuid, text, text) from anon;
revoke execute on function public.approve_queue_entry(uuid) from anon;
revoke execute on function public.decline_queue_entry(uuid) from anon;
revoke execute on function public.cancel_room(uuid) from anon;
revoke execute on function public.create_room(text, text, text, text, boolean, boolean, integer, integer, integer, timestamptz) from anon;
revoke execute on function public.join_private_room(text, text, text) from anon;

-- ─── A3. vote_news_topic: authenticated, once per user ───────
create table if not exists public.news_topic_votes (
  topic_id   uuid not null references public.news_topics(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  side       text not null check (side in ('pro', 'con')),
  created_at timestamptz not null default now(),
  primary key (topic_id, user_id)
);
alter table public.news_topic_votes enable row level security;
-- Definer-RPC-only, like the other integrity-sensitive tables.

create or replace function public.vote_news_topic(p_topic_id uuid, p_side text)
returns void
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
  if p_side not in ('pro', 'con') then
    raise exception 'invalid_side' using errcode = '22023';
  end if;

  -- One vote per user per topic; the ledger's PK is the enforcement.
  insert into public.news_topic_votes (topic_id, user_id, side)
  values (p_topic_id, v_me, p_side);

  update public.news_topics
  set pro_votes = pro_votes + (case when p_side = 'pro' then 1 else 0 end),
      con_votes = con_votes + (case when p_side = 'con' then 1 else 0 end)
  where id = p_topic_id;
exception
  when unique_violation then
    raise exception 'already_voted' using errcode = 'P0001';
end;
$$;

revoke all on function public.vote_news_topic(uuid, text) from public, anon;
grant execute on function public.vote_news_topic(uuid, text) to authenticated;

-- ─── A4. Chat flood control ──────────────────────────────────
create or replace function public.room_messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.room_messages
      where user_id = new.user_id
        and created_at > now() - interval '10 seconds') >= 8 then
    raise exception using errcode = 'P0001',
      message = 'rate_limited: Slow down — you''re sending messages too quickly.';
  end if;
  return new;
end;
$$;
revoke execute on function public.room_messages_rate_limit() from anon, authenticated;

drop trigger if exists trg_room_messages_rate_limit on public.room_messages;
create trigger trg_room_messages_rate_limit
  before insert on public.room_messages
  for each row execute function public.room_messages_rate_limit();

-- ─── B5. Notifications ───────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null check (type in ('new_follower', 'room_live')),
  actor_id   uuid references public.users(id) on delete cascade,
  room_id    uuid references public.debate_rooms(id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists idx_notifications_user
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
  on public.notifications for select using (auth.uid() = user_id);

drop policy if exists "users mark own notifications read" on public.notifications;
create policy "users mark own notifications read"
  on public.notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No insert/delete policies: rows are created by triggers below.

-- Realtime stream (RLS applies to realtime, so users only get their own).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ─── B6. Preferences (honored inside the triggers) ───────────
alter table public.user_settings add column if not exists notify_follows boolean not null default true;
alter table public.user_settings add column if not exists notify_room_live boolean not null default true;

-- ─── B7. Triggers ────────────────────────────────────────────
create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select notify_follows from public.user_settings
               where user_id = new.following_id), true) then
    insert into public.notifications (user_id, type, actor_id)
    values (new.following_id, 'new_follower', new.follower_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_new_follower() from anon, authenticated;

drop trigger if exists trg_notify_new_follower on public.user_follows;
create trigger trg_notify_new_follower
  after insert on public.user_follows
  for each row execute function public.notify_new_follower();

create or replace function public.notify_room_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fires on creation as live or on a scheduled room flipping live.
  -- Public rooms only — private rooms are invite-only by definition.
  if new.status = 'live'
     and (tg_op = 'INSERT' or old.status is distinct from 'live')
     and new.is_private = false then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select f.follower_id, 'room_live', new.host_id, new.id
    from public.user_follows f
    where f.following_id = new.host_id
      and f.follower_id <> new.host_id
      and coalesce((select notify_room_live from public.user_settings
                    where user_id = f.follower_id), true);
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_room_live() from anon, authenticated;

drop trigger if exists trg_notify_room_live on public.debate_rooms;
create trigger trg_notify_room_live
  after insert or update of status on public.debate_rooms
  for each row execute function public.notify_room_live();

-- ─── B8. Client RPCs ─────────────────────────────────────────
create or replace function public.get_notifications(p_limit integer default 30)
returns table (
  id uuid,
  type text,
  actor_id uuid,
  actor_username text,
  room_id uuid,
  room_motion text,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id, n.type, n.actor_id,
    u.username as actor_username,
    n.room_id,
    r.motion as room_motion,
    n.read_at, n.created_at
  from public.notifications n
  left join public.users u on u.id = n.actor_id
  left join public.debate_rooms r on r.id = n.room_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke all on function public.get_notifications(integer) from public, anon;
grant execute on function public.get_notifications(integer) to authenticated;

create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;
