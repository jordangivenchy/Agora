-- Reactions + unsend for direct messages.
-- dm_reactions: one row per (message, user, emoji), visible to both
-- participants of the message's conversation; you may react only inside
-- your own conversations and remove only your own reactions. Unsend:
-- senders may DELETE their own messages — the first DELETE path on
-- direct_messages (there was deliberately none before). Reactions
-- cascade away with the message; replies to a deleted message keep
-- rendering via their "Earlier message" fallback (reply_to is
-- ON DELETE SET NULL from 20260886).

-- ── dm_reactions ─────────────────────────────────────────────────────

create table if not exists public.dm_reactions (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.dm_reactions enable row level security;
revoke all on public.dm_reactions from public, anon;
grant select, insert, delete on public.dm_reactions to authenticated;

-- Participants of the message's conversation see its reactions.
drop policy if exists dm_react_select on public.dm_reactions;
create policy dm_react_select on public.dm_reactions
  for select to authenticated
  using (exists (
    select 1 from public.direct_messages m
    where m.id = message_id and auth.uid() in (m.sender_id, m.recipient_id)
  ));

-- React as yourself, only inside your own conversations.
drop policy if exists dm_react_insert on public.dm_reactions;
create policy dm_react_insert on public.dm_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.direct_messages m
      where m.id = message_id and auth.uid() in (m.sender_id, m.recipient_id)
    )
  );

-- Remove only your own reactions.
drop policy if exists dm_react_delete on public.dm_reactions;
create policy dm_react_delete on public.dm_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- Stream reaction changes to the thread views.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_reactions'
  ) then
    alter publication supabase_realtime add table public.dm_reactions;
  end if;
end $$;

-- ── Unsend ───────────────────────────────────────────────────────────

grant delete on public.direct_messages to authenticated;
drop policy if exists dm_delete_own on public.direct_messages;
create policy dm_delete_own on public.direct_messages
  for delete to authenticated
  using (sender_id = auth.uid());
