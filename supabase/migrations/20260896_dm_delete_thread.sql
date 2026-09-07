-- "Delete conversation" in a DM's chat options: hide every message
-- between me and the peer for me, the same way dm_delete_for_me hides
-- one. The other person keeps their copy; get_dm_threads drops the
-- thread for me once nothing visible is left.
create or replace function public.dm_delete_thread_for_me(p_peer uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with upd as (
    update direct_messages
    set hidden_for = array_append(hidden_for, auth.uid())
    where auth.uid() is not null
      and p_peer <> auth.uid()
      and auth.uid() in (sender_id, recipient_id)
      and p_peer in (sender_id, recipient_id)
      and not (auth.uid() = any(hidden_for))
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke all on function public.dm_delete_thread_for_me(uuid) from public;
grant execute on function public.dm_delete_thread_for_me(uuid) to authenticated;
