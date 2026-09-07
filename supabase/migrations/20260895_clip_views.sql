-- Clip views. clips.view_count existed but nothing wrote to it; the clip
-- page now counts one view per session so "More clips" has a popularity
-- signal to sort by. Callable signed out — clip pages are public.
create or replace function public.bump_clip_view(p_clip uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.clips set view_count = view_count + 1 where id = p_clip;
$$;
revoke all on function public.bump_clip_view(uuid) from public;
grant execute on function public.bump_clip_view(uuid) to anon, authenticated;
