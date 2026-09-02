-- Direct messages: unsend only within two minutes; "delete for you" any time.
--
-- Unsend (a DELETE, gone for both sides — 20260887) was open-ended. It is
-- now a two-minute window after sending, enforced by the delete policy.
-- Beyond that the only removal is one-way: dm_delete_for_me() hides the
-- row from the caller (sender or recipient) by recording them in
-- hidden_for, and the select policy stops returning hidden rows to
-- whoever hid them — the other side keeps the message. get_dm_threads
-- ignores rows hidden for the caller (last line, unread count).

-- ── 1. hidden_for ────────────────────────────────────────────────────
alter table public.direct_messages
  add column if not exists hidden_for uuid[] not null default '{}';

-- ── 2. Unsend: sender only, and only for two minutes ────────────────
drop policy if exists dm_delete_own on public.direct_messages;
create policy dm_delete_own on public.direct_messages
  for delete to authenticated
  using (sender_id = auth.uid() and created_at > now() - interval '2 minutes');

-- ── 3. Reading: participants, minus what they deleted for themselves ─
drop policy if exists dm_select on public.direct_messages;
create policy dm_select on public.direct_messages
  for select to authenticated
  using (
    auth.uid() in (sender_id, recipient_id)
    and not (auth.uid() = any(hidden_for))
  );

-- ── 4. Delete for me: one-way, either participant, idempotent ───────
create or replace function public.dm_delete_for_me(p_id uuid)
returns boolean
language sql volatile security definer
set search_path = public
as $$
  with upd as (
    update direct_messages
    set hidden_for = array_append(hidden_for, auth.uid())
    where id = p_id
      and auth.uid() in (sender_id, recipient_id)
      and not (auth.uid() = any(hidden_for))
    returning 1
  )
  select exists (select 1 from upd);
$$;
revoke execute on function public.dm_delete_for_me(uuid) from public, anon;
grant execute on function public.dm_delete_for_me(uuid) to authenticated;

-- ── 5. get_dm_threads: same as 20260848, minus rows hidden for the caller
drop function if exists public.get_dm_threads();
create function public.get_dm_threads()
returns table(
  peer_id uuid, peer_username text, peer_avatar_url text, last_content text,
  last_at timestamptz, last_from_me boolean, unread bigint, peer_display_name text
)
language sql stable security definer
set search_path to 'public'
as $$
  with mine as (
    select *,
      case when sender_id = auth.uid() then recipient_id else sender_id end as peer
    from direct_messages
    where auth.uid() in (sender_id, recipient_id)
      and not (auth.uid() = any(hidden_for))
  ),
  latest as (
    select distinct on (peer) peer, content, image_url, created_at, sender_id
    from mine
    order by peer, created_at desc
  )
  select
    l.peer, u.username, u.avatar_url,
    case
      when l.content <> '' then l.content
      when l.image_url ilike '%giphy.com%' then 'GIF'
      when l.image_url is not null then 'Photo'
      else l.content
    end,
    l.created_at,
    l.sender_id = auth.uid(),
    (select count(*) from mine m
      where m.peer = l.peer and m.recipient_id = auth.uid() and m.read_at is null),
    u.display_name
  from latest l
  join users u on u.id = l.peer
  order by l.created_at desc;
$$;
revoke execute on function public.get_dm_threads() from public, anon;
grant execute on function public.get_dm_threads() to authenticated;
