-- Community invites, delivered as DMs.
--
-- A member invites a friend (mutual follow — DMs are friends-only, and
-- so are invites) to their board. The invite is a row here plus a direct
-- message that carries community_id, which the thread renders as a card
-- with a Join button. Accepting joins the board directly, private or
-- not: the invite is the permission. Public boards can be joined by
-- anyone anyway; the RPC just makes it one tap.

alter table public.direct_messages
  add column if not exists community_id uuid references public.communities(id) on delete set null;

create table if not exists public.community_invites (
  community_id uuid not null references public.communities(id) on delete cascade,
  inviter_id   uuid not null references public.users(id) on delete cascade,
  invitee_id   uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (community_id, invitee_id),
  check (inviter_id <> invitee_id)
);
create index if not exists community_invites_inviter_idx on public.community_invites (inviter_id, created_at desc);
alter table public.community_invites enable row level security;
drop policy if exists community_invites_select on public.community_invites;
create policy community_invites_select on public.community_invites
  for select to authenticated
  using (invitee_id = auth.uid() or inviter_id = auth.uid());
-- No direct insert/update/delete: the RPCs below own the writes.

-- Who a member could invite: their friends who aren't in the board yet,
-- with a flag for the ones already invited.
create or replace function public.get_community_invite_candidates(p_community uuid)
returns table (id uuid, username text, display_name text, avatar_url text, invited boolean)
language sql stable security definer set search_path = public
as $$
  select f.id, f.username, u.display_name, f.avatar_url,
         exists (select 1 from public.community_invites i
                 where i.community_id = p_community and i.invitee_id = f.id) as invited
  from public.get_friends(auth.uid()) f
  join public.users u on u.id = f.id
  where auth.uid() is not null
    and public.is_community_member(p_community, auth.uid())
    and not exists (select 1 from public.community_members m
                    where m.community_id = p_community and m.user_id = f.id)
  order by invited asc, f.since desc;
$$;
revoke execute on function public.get_community_invite_candidates(uuid) from public, anon;
grant execute on function public.get_community_invite_candidates(uuid) to authenticated;

-- Send: records the invite and writes the DM (content is the fallback the
-- thread list and push previews show). Friends only; members only; mods
-- only on private boards; 30 invites an hour per person.
create or replace function public.send_community_invite(p_community uuid, p_to uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_name text;
  v_priv boolean;
  v_msg  uuid;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  if p_to = v_me then raise exception 'self_invite'; end if;
  select name, is_private into v_name, v_priv from public.communities where id = p_community;
  if v_name is null then raise exception 'no_such_community'; end if;
  if not public.is_community_member(p_community, v_me) then raise exception 'not_a_member'; end if;
  if v_priv and not public.is_community_mod(p_community, v_me) then raise exception 'mods_only'; end if;
  if not public.are_friends(v_me, p_to) then raise exception 'not_friends'; end if;
  if exists (select 1 from public.community_members where community_id = p_community and user_id = p_to) then
    raise exception 'already_member';
  end if;
  if (select count(*) from public.community_invites where inviter_id = v_me and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'invite_rate_limit';
  end if;
  insert into public.community_invites (community_id, inviter_id, invitee_id)
  values (p_community, v_me, p_to)
  on conflict (community_id, invitee_id) do update set inviter_id = excluded.inviter_id, created_at = now();
  insert into public.direct_messages (sender_id, recipient_id, content, community_id)
  values (v_me, p_to, 'Invited you to join ' || v_name, p_community)
  returning id into v_msg;
  return v_msg;
end;
$$;
revoke execute on function public.send_community_invite(uuid, uuid) from public, anon;
grant execute on function public.send_community_invite(uuid, uuid) to authenticated;

-- Accept: an invite (or a public board) seats you; pending requests clear.
create or replace function public.accept_community_invite(p_community uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_priv boolean;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  select is_private into v_priv from public.communities where id = p_community;
  if v_priv is null then raise exception 'no_such_community'; end if;
  if v_priv and not exists (select 1 from public.community_invites where community_id = p_community and invitee_id = v_me) then
    raise exception 'no_invite';
  end if;
  insert into public.community_members (community_id, user_id, role)
  values (p_community, v_me, 'member')
  on conflict (community_id, user_id) do nothing;
  delete from public.community_invites where community_id = p_community and invitee_id = v_me;
  delete from public.community_join_requests where community_id = p_community and user_id = v_me;
end;
$$;
revoke execute on function public.accept_community_invite(uuid) from public, anon;
grant execute on function public.accept_community_invite(uuid) to authenticated;
