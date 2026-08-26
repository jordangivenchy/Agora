-- Block a community: a stronger mute. Blocking leaves the board, hides it
-- from your browse list, and drops its posts from your aggregate feed.
-- Reversible from the board's ⋯ menu (reachable by search / direct link).

create table if not exists public.community_blocks (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);
alter table public.community_blocks enable row level security;

-- Own-row RLS: the SELECT is used client-side to know what you've blocked.
drop policy if exists "users see own blocks" on public.community_blocks;
create policy "users see own blocks"
  on public.community_blocks for select
  using (auth.uid() = user_id);

-- Writes go through set_community_block (definer) so a block can leave the
-- board in the same call; direct inserts are still fine for own rows.
drop policy if exists "users block as themselves" on public.community_blocks;
create policy "users block as themselves"
  on public.community_blocks for insert
  with check (auth.uid() = user_id);
drop policy if exists "users unblock as themselves" on public.community_blocks;
create policy "users unblock as themselves"
  on public.community_blocks for delete
  using (auth.uid() = user_id);

-- ── set_community_block: block (leave + record) or unblock ──────────
create or replace function public.set_community_block(p_community uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_blocked then
    -- Owners can't block their own community (they'd orphan it).
    if exists (
      select 1 from public.community_members
      where community_id = p_community and user_id = v_me and role = 'owner'
    ) then
      raise exception 'owner_cannot_block: You own this community.' using errcode = 'P0001';
    end if;
    insert into public.community_blocks (community_id, user_id)
      values (p_community, v_me)
      on conflict do nothing;
    -- Blocking leaves the board and cancels any pending join request.
    delete from public.community_members where community_id = p_community and user_id = v_me;
    delete from public.community_join_requests where community_id = p_community and user_id = v_me;
    delete from public.community_mutes where community_id = p_community and user_id = v_me;
  else
    delete from public.community_blocks where community_id = p_community and user_id = v_me;
  end if;
end;
$function$;
revoke all on function public.set_community_block(uuid, boolean) from public, anon;
grant execute on function public.set_community_block(uuid, boolean) to authenticated;

-- Feed exclusion is applied client-side (the aggregate view filters out
-- blocked communities' posts) rather than by rewriting get_community_posts,
-- so this migration stays a small, low-risk additive change.
