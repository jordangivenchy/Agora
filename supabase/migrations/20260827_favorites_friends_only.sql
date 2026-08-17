-- Favorites are for friends: inserting a favorite now requires a mutual
-- follow. Reading and removing your own favorites is unchanged (you can
-- still un-star someone after unfriending).

drop policy if exists fav_own on public.user_favorites;

create policy fav_select_own on public.user_favorites
  for select to authenticated
  using (user_id = auth.uid());

create policy fav_delete_own on public.user_favorites
  for delete to authenticated
  using (user_id = auth.uid());

create policy fav_insert_friends_only on public.user_favorites
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_follows a
      where a.follower_id = auth.uid() and a.following_id = favorite_id
    )
    and exists (
      select 1 from public.user_follows b
      where b.follower_id = favorite_id and b.following_id = auth.uid()
    )
  );
