-- Friend system: direct messages (friends-only, block-aware), favorites,
-- room invites via notifications, and DM thread RPCs.
-- Friendship itself is the existing model: a mutual user_follows pair
-- (see get_friends). Nothing here redefines it.

-- ── Helper: friendship = mutual follow ─────────────────────────────
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from user_follows f where f.follower_id = a and f.following_id = b)
     and exists (select 1 from user_follows f where f.follower_id = b and f.following_id = a);
$$;
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ── Direct messages ────────────────────────────────────────────────
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists dm_thread_idx
  on public.direct_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc);
create index if not exists dm_unread_idx
  on public.direct_messages (recipient_id) where read_at is null;

alter table public.direct_messages enable row level security;
revoke all on public.direct_messages from public, anon;
grant select, insert, update on public.direct_messages to authenticated;

create policy dm_select on public.direct_messages
  for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));

-- Send: only as yourself, only to friends, never across a block.
create policy dm_insert on public.direct_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.are_friends(sender_id, recipient_id)
    and not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = recipient_id and ub.blocked_id = sender_id)
         or (ub.blocker_id = sender_id and ub.blocked_id = recipient_id)
    )
  );

-- Recipient may mark messages read (only their own inbox rows).
create policy dm_mark_read on public.direct_messages
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

alter publication supabase_realtime add table public.direct_messages;

-- ── Favorites (pin friends to the top of the list) ─────────────────
create table if not exists public.user_favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  favorite_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, favorite_id),
  check (user_id <> favorite_id)
);

alter table public.user_favorites enable row level security;
revoke all on public.user_favorites from public, anon;
grant select, insert, delete on public.user_favorites to authenticated;

create policy fav_own on public.user_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Room invites ride the notifications table ──────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['new_follower', 'room_live', 'room_starting_soon', 'room_invite']));

create or replace function public.invite_friend_to_room(p_user uuid, p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if not public.are_friends(auth.uid(), p_user) then
    raise exception 'not_friends';
  end if;
  if not exists (
    select 1 from debate_rooms r
    where r.id = p_room and r.status in ('live', 'created', 'scheduled')
  ) then
    raise exception 'room_unavailable';
  end if;
  -- One unread invite per friend per room.
  if exists (
    select 1 from notifications n
    where n.user_id = p_user and n.actor_id = auth.uid()
      and n.room_id = p_room and n.type = 'room_invite' and n.read_at is null
  ) then
    return;
  end if;
  insert into notifications (user_id, type, actor_id, room_id)
  values (p_user, 'room_invite', auth.uid(), p_room);
end;
$$;
revoke execute on function public.invite_friend_to_room(uuid, uuid) from public, anon;
grant execute on function public.invite_friend_to_room(uuid, uuid) to authenticated;

-- ── DM thread list: one row per conversation partner ───────────────
create or replace function public.get_dm_threads()
returns table (
  peer_id uuid,
  peer_username text,
  peer_avatar_url text,
  last_content text,
  last_at timestamptz,
  last_from_me boolean,
  unread bigint
)
language sql stable security definer set search_path = public
as $$
  with mine as (
    select *,
      case when sender_id = auth.uid() then recipient_id else sender_id end as peer
    from direct_messages
    where auth.uid() in (sender_id, recipient_id)
  ),
  latest as (
    select distinct on (peer) peer, content, created_at, sender_id
    from mine
    order by peer, created_at desc
  )
  select
    l.peer,
    u.username,
    u.avatar_url,
    l.content,
    l.created_at,
    l.sender_id = auth.uid(),
    (select count(*) from mine m
      where m.peer = l.peer and m.recipient_id = auth.uid() and m.read_at is null)
  from latest l
  join users u on u.id = l.peer
  order by l.created_at desc;
$$;
revoke execute on function public.get_dm_threads() from public, anon;
grant execute on function public.get_dm_threads() to authenticated;

create or replace function public.mark_dm_read(p_peer uuid)
returns void
language sql security definer set search_path = public
as $$
  update direct_messages
  set read_at = now()
  where recipient_id = auth.uid() and sender_id = p_peer and read_at is null;
$$;
revoke execute on function public.mark_dm_read(uuid) from public, anon;
grant execute on function public.mark_dm_read(uuid) to authenticated;
