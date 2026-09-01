-- Replies for direct messages, plus a write-scope fix the feature exposed.
-- A message may reference an earlier message in the SAME conversation
-- (reply_to); a trigger enforces the same-pair rule since RLS can't see
-- the referenced row's pair at insert time. While here: the dm_mark_read
-- UPDATE policy has no column list, so the table-level UPDATE grant let a
-- recipient rewrite any column of received rows (content included). The
-- grant is now column-scoped to read_at — mark_dm_read() (security
-- definer) is unaffected, and reply_to/content become immutable to
-- clients. Read receipts and typing need no schema: read_at is already
-- sender-visible through dm_select, and typing rides a realtime
-- broadcast channel.

-- ── reply_to column ──────────────────────────────────────────────────

alter table public.direct_messages
  add column if not exists reply_to uuid references public.direct_messages(id) on delete set null;

-- ── same-conversation guard ──────────────────────────────────────────

-- The pair is order-insensitive: (least, greatest) of the two ids.
create or replace function public.enforce_dm_reply_pair()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.reply_to is not null then
    if not exists (
      select 1 from public.direct_messages m
      where m.id = new.reply_to
        and least(m.sender_id, m.recipient_id) = least(new.sender_id, new.recipient_id)
        and greatest(m.sender_id, m.recipient_id) = greatest(new.sender_id, new.recipient_id)
    ) then
      raise exception 'dm_reply_cross_thread: reply must reference a message in this conversation'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_dm_reply_pair() from public, anon;

drop trigger if exists dm_reply_pair on public.direct_messages;
create trigger dm_reply_pair
  before insert on public.direct_messages
  for each row execute function public.enforce_dm_reply_pair();

-- ── scope the client UPDATE grant to read_at only ────────────────────

revoke update on public.direct_messages from authenticated;
grant update (read_at) on public.direct_messages to authenticated;
