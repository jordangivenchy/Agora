-- Group chats: a named thread among friends. direct_messages is strictly
-- two people, so groups get their own tables — the chat, its members
-- (with a per-member read cursor), and its messages. Membership only
-- moves through RPCs; messages insert directly under RLS so the row
-- comes back from .select() and realtime streams it. A member sees the
-- history from the moment they joined (the "added" line included).

-- ── Tables ─────────────────────────────────────────────────────────
create table if not exists public.group_chats (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_chat_members (
  chat_id      uuid not null references public.group_chats(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists group_chat_members_user_idx on public.group_chat_members (user_id);

create table if not exists public.group_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.group_chats(id) on delete cascade,
  sender_id  uuid references public.users(id) on delete set null,
  -- 'system' rows are membership/rename events: "<sender> added @x".
  kind       text not null default 'text' check (kind in ('text', 'system')),
  content    text not null default '' check (char_length(content) <= 2000),
  image_url  text,
  reply_to   uuid references public.group_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind = 'system' or char_length(btrim(content)) > 0 or image_url is not null)
);
create index if not exists group_messages_chat_idx on public.group_messages (chat_id, created_at);
create index if not exists group_messages_sender_idx on public.group_messages (sender_id, created_at desc);

-- ── Helpers (security definer: policies must not recurse into RLS) ──
create or replace function public.is_group_member(p_chat uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_chat_members
    where chat_id = p_chat and user_id = p_user
  );
$$;
revoke execute on function public.is_group_member(uuid, uuid) from public, anon;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

-- Can the caller see a message stamped p_at in p_chat? Members only, and
-- only from when they joined.
create or replace function public.group_message_visible(p_chat uuid, p_at timestamptz)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_chat_members
    where chat_id = p_chat and user_id = auth.uid() and joined_at <= p_at
  );
$$;
revoke execute on function public.group_message_visible(uuid, timestamptz) from public, anon;
grant execute on function public.group_message_visible(uuid, timestamptz) to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────
alter table public.group_chats enable row level security;
alter table public.group_chat_members enable row level security;
alter table public.group_messages enable row level security;

revoke all on public.group_chats, public.group_chat_members, public.group_messages from public, anon;
grant select on public.group_chats, public.group_chat_members to authenticated;
grant select, insert, delete on public.group_messages to authenticated;

drop policy if exists gc_select on public.group_chats;
create policy gc_select on public.group_chats
  for select to authenticated
  using (public.is_group_member(id, auth.uid()));

drop policy if exists gcm_select on public.group_chat_members;
create policy gcm_select on public.group_chat_members
  for select to authenticated
  using (public.is_group_member(chat_id, auth.uid()));

drop policy if exists gm_select on public.group_messages;
create policy gm_select on public.group_messages
  for select to authenticated
  using (public.group_message_visible(chat_id, created_at));

drop policy if exists gm_insert on public.group_messages;
create policy gm_insert on public.group_messages
  for insert to authenticated
  with check (
    kind = 'text'
    and sender_id = auth.uid()
    and public.is_group_member(chat_id, auth.uid())
  );

-- Unsend: your own message, within the same two-minute window as DMs.
drop policy if exists gm_unsend on public.group_messages;
create policy gm_unsend on public.group_messages
  for delete to authenticated
  using (
    kind = 'text'
    and sender_id = auth.uid()
    and created_at > now() - interval '2 minutes'
  );

-- ── Triggers: rate limit + replies stay inside the chat ────────────
create or replace function public.enforce_group_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.kind = 'text' and (
    select count(*) from public.group_messages
    where sender_id = new.sender_id
      and kind = 'text'
      and created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception 'dm_rate_limited: slow down — max 20 messages per minute';
  end if;
  if new.reply_to is not null and not exists (
    select 1 from public.group_messages
    where id = new.reply_to and chat_id = new.chat_id
  ) then
    raise exception 'reply_outside_chat';
  end if;
  return new;
end;
$$;
drop trigger if exists group_rate_limit on public.group_messages;
create trigger group_rate_limit
  before insert on public.group_messages
  for each row execute function public.enforce_group_rate_limit();

-- ── Membership RPCs ────────────────────────────────────────────────
-- Start a group with at least one friend. Every member you add has to be
-- a friend (mutual follow) — the same rule as DMs.
create or replace function public.create_group_chat(p_name text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_members uuid[];
  v_chat    uuid;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then raise exception 'bad_name'; end if;

  select array_agg(distinct m) into v_members
  from unnest(coalesce(p_members, '{}'::uuid[])) m
  where m <> v_me;
  if v_members is null or cardinality(v_members) < 1 then raise exception 'need_members'; end if;
  if cardinality(v_members) > 49 then raise exception 'too_many_members'; end if;
  if exists (select 1 from unnest(v_members) m where not public.are_friends(v_me, m)) then
    raise exception 'not_friends';
  end if;
  if (select count(*) from public.group_chats
      where created_by = v_me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'group_rate_limit';
  end if;

  insert into public.group_chats (name, created_by) values (v_name, v_me) returning id into v_chat;
  insert into public.group_chat_members (chat_id, user_id)
    select v_chat, v_me
    union all
    select v_chat, m from unnest(v_members) m;
  insert into public.group_messages (chat_id, sender_id, kind, content)
    values (v_chat, v_me, 'system', 'created the group');
  return v_chat;
end;
$$;
revoke execute on function public.create_group_chat(text, uuid[]) from public, anon;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;

-- Any member can bring their own friends in. Returns how many joined.
create or replace function public.add_group_members(p_chat uuid, p_members uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_new   uuid[];
  v_names text;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  if not public.is_group_member(p_chat, v_me) then raise exception 'not_a_member'; end if;

  select array_agg(distinct m) into v_new
  from unnest(coalesce(p_members, '{}'::uuid[])) m
  where m <> v_me and not public.is_group_member(p_chat, m);
  if v_new is null then return 0; end if;
  if exists (select 1 from unnest(v_new) m where not public.are_friends(v_me, m)) then
    raise exception 'not_friends';
  end if;
  if (select count(*) from public.group_chat_members where chat_id = p_chat) + cardinality(v_new) > 50 then
    raise exception 'too_many_members';
  end if;

  insert into public.group_chat_members (chat_id, user_id) select p_chat, m from unnest(v_new) m;
  select string_agg('@' || u.username, ', ' order by u.username) into v_names
  from public.users u where u.id = any (v_new);
  insert into public.group_messages (chat_id, sender_id, kind, content)
    values (p_chat, v_me, 'system', 'added ' || v_names);
  return cardinality(v_new);
end;
$$;
revoke execute on function public.add_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

-- Leave. The last one out deletes the chat; an owner leaving hands the
-- group to the longest-standing remaining member.
create or replace function public.leave_group_chat(p_chat uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_next uuid;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  if not public.is_group_member(p_chat, v_me) then raise exception 'not_a_member'; end if;

  insert into public.group_messages (chat_id, sender_id, kind, content)
    values (p_chat, v_me, 'system', 'left');
  delete from public.group_chat_members where chat_id = p_chat and user_id = v_me;

  if not exists (select 1 from public.group_chat_members where chat_id = p_chat) then
    delete from public.group_chats where id = p_chat;
    return;
  end if;
  if (select created_by from public.group_chats where id = p_chat) = v_me then
    select user_id into v_next from public.group_chat_members
    where chat_id = p_chat order by joined_at, user_id limit 1;
    update public.group_chats set created_by = v_next where id = p_chat;
  end if;
end;
$$;
revoke execute on function public.leave_group_chat(uuid) from public, anon;
grant execute on function public.leave_group_chat(uuid) to authenticated;

-- Owner only.
create or replace function public.remove_group_member(p_chat uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_name text;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  if (select created_by from public.group_chats where id = p_chat) is distinct from v_me then
    raise exception 'owner_only';
  end if;
  if p_user = v_me or not public.is_group_member(p_chat, p_user) then raise exception 'not_a_member'; end if;

  select username into v_name from public.users where id = p_user;
  insert into public.group_messages (chat_id, sender_id, kind, content)
    values (p_chat, v_me, 'system', 'removed @' || coalesce(v_name, '?'));
  delete from public.group_chat_members where chat_id = p_chat and user_id = p_user;
end;
$$;
revoke execute on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- Any member can rename.
create or replace function public.rename_group_chat(p_chat uuid, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  if not public.is_group_member(p_chat, v_me) then raise exception 'not_a_member'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then raise exception 'bad_name'; end if;
  if (select name from public.group_chats where id = p_chat) = v_name then return; end if;

  update public.group_chats set name = v_name where id = p_chat;
  insert into public.group_messages (chat_id, sender_id, kind, content)
    values (p_chat, v_me, 'system', 'renamed the group to “' || v_name || '”');
end;
$$;
revoke execute on function public.rename_group_chat(uuid, text) from public, anon;
grant execute on function public.rename_group_chat(uuid, text) to authenticated;

create or replace function public.mark_group_read(p_chat uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.group_chat_members
  set last_read_at = now()
  where chat_id = p_chat and user_id = auth.uid();
$$;
revoke execute on function public.mark_group_read(uuid) from public, anon;
grant execute on function public.mark_group_read(uuid) to authenticated;

-- ── Readers ────────────────────────────────────────────────────────
-- My groups, newest activity first. `members` carries up to four
-- profiles (other people first) for the rail's avatar cluster; the
-- last message comes raw so the client can phrase the preview.
create or replace function public.get_group_threads()
returns table (
  chat_id              uuid,
  name                 text,
  created_by           uuid,
  member_count         integer,
  members              jsonb,
  last_content         text,
  last_image_url       text,
  last_kind            text,
  last_sender_id       uuid,
  last_sender_username text,
  last_sender_name     text,
  last_from_me         boolean,
  last_at              timestamptz,
  unread               bigint
)
language sql stable security definer set search_path = public
as $$
  with mine as (
    select c.id, c.name, c.created_by, c.created_at, m.joined_at, m.last_read_at
    from public.group_chats c
    join public.group_chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
  ),
  latest as (
    select distinct on (g.chat_id)
      g.chat_id, g.content, g.image_url, g.kind, g.sender_id, g.created_at
    from public.group_messages g
    join mine on mine.id = g.chat_id
    where g.created_at >= mine.joined_at
    order by g.chat_id, g.created_at desc
  )
  select
    mine.id,
    mine.name,
    mine.created_by,
    (select count(*)::integer from public.group_chat_members x where x.chat_id = mine.id),
    (select coalesce(jsonb_agg(
              jsonb_build_object('id', u.id, 'username', u.username,
                                 'display_name', u.display_name, 'avatar_url', u.avatar_url)
              order by x.me, x.joined_at), '[]'::jsonb)
       from (select gm.user_id, gm.joined_at, (gm.user_id = auth.uid()) as me
               from public.group_chat_members gm
              where gm.chat_id = mine.id
              order by (gm.user_id = auth.uid()), gm.joined_at
              limit 4) x
       join public.users u on u.id = x.user_id),
    l.content,
    l.image_url,
    l.kind,
    l.sender_id,
    su.username,
    su.display_name,
    l.sender_id = auth.uid(),
    coalesce(l.created_at, mine.created_at),
    (select count(*) from public.group_messages g
      where g.chat_id = mine.id
        and g.kind = 'text'
        and g.created_at > mine.last_read_at
        and g.created_at >= mine.joined_at
        and g.sender_id is distinct from auth.uid())
  from mine
  left join latest l on l.chat_id = mine.id
  left join public.users su on su.id = l.sender_id
  order by coalesce(l.created_at, mine.created_at) desc;
$$;
revoke execute on function public.get_group_threads() from public, anon;
grant execute on function public.get_group_threads() to authenticated;

create or replace function public.get_group_members(p_chat uuid)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  joined_at    timestamptz,
  is_owner     boolean
)
language sql stable security definer set search_path = public
as $$
  select u.id, u.username, u.display_name, u.avatar_url, m.joined_at,
         (c.created_by = u.id) as is_owner
  from public.group_chat_members m
  join public.users u on u.id = m.user_id
  join public.group_chats c on c.id = m.chat_id
  where m.chat_id = p_chat
    and public.is_group_member(p_chat, auth.uid())
  order by (c.created_by = u.id) desc, m.joined_at, u.username;
$$;
revoke execute on function public.get_group_members(uuid) from public, anon;
grant execute on function public.get_group_members(uuid) to authenticated;

-- Friends who could be added: everyone for a new group, non-members for
-- an existing one (members only may ask).
create or replace function public.get_group_chat_candidates(p_chat uuid default null)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  select f.id, f.username, u.display_name, f.avatar_url
  from public.get_friends(auth.uid()) f
  join public.users u on u.id = f.id
  where auth.uid() is not null
    and (p_chat is null or (
      public.is_group_member(p_chat, auth.uid())
      and not public.is_group_member(p_chat, f.id)
    ))
  order by lower(coalesce(u.display_name, f.username)), f.username;
$$;
revoke execute on function public.get_group_chat_candidates(uuid) from public, anon;
grant execute on function public.get_group_chat_candidates(uuid) to authenticated;

-- ── Realtime: messages and membership stream to open threads ───────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_chat_members'
  ) then
    alter publication supabase_realtime add table public.group_chat_members;
  end if;
end $$;
