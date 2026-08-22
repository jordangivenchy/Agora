-- DM media: images and GIFs in direct messages.
-- Adds direct_messages.image_url, allows empty content when an image is
-- attached, and teaches get_dm_threads to summarise media-only messages
-- ('Photo' / 'GIF') in the conversation list.
--
-- Storage: DM uploads reuse the post-images bucket under the uploader's
-- own folder (<uid>/<uuid>.<ext>) — exactly what the existing
-- "post images upload own folder" policy (20260835 §13) already allows,
-- so no new storage policy is needed.

-- ── 1. image_url column ────────────────────────────────────────────
alter table public.direct_messages
  add column if not exists image_url text;

alter table public.direct_messages drop constraint if exists direct_messages_image_url_check;
alter table public.direct_messages add constraint direct_messages_image_url_check
  check (image_url is null or char_length(image_url) <= 500);

-- ── 2. Relax the content check ─────────────────────────────────────
-- The original check was inline (auto-named); drop whichever check
-- constraint on this table references `content` and is not ours.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.direct_messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%char_length(content)%'
      and conname <> 'direct_messages_content_or_image_check'
  loop
    execute format('alter table public.direct_messages drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.direct_messages drop constraint if exists direct_messages_content_or_image_check;
alter table public.direct_messages add constraint direct_messages_content_or_image_check
  check (
    (char_length(content) between 1 and 2000)
    or (image_url is not null and char_length(content) <= 2000)
  );

-- ── 3. get_dm_threads: media-aware last line ───────────────────────
-- Same signature/body as 20260829; only last_content changes.
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
