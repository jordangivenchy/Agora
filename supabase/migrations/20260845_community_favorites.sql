-- ============================================================
-- 20260845_community_favorites.sql
--
-- Favorite (bookmark) communities, Reddit-style: a per-membership flag
-- so a member can pin boards to the top of their list. Stored on the
-- membership row (favorites only make sense for communities you've
-- joined; leaving drops it with the row). Written only through the RPC
-- so the check "must be a member" lives in one place.
-- ============================================================

alter table public.community_members
  add column if not exists favorite boolean not null default false;

create or replace function public.set_community_favorite(p_community uuid, p_favorite boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.community_members
     set favorite = coalesce(p_favorite, false)
   where community_id = p_community and user_id = auth.uid();
  if not found then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.set_community_favorite(uuid, boolean) from public, anon;
grant execute on function public.set_community_favorite(uuid, boolean) to authenticated;
