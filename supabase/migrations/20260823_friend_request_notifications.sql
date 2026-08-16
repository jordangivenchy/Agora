-- Friend-request notifications: when a follow completes a mutual pair,
-- the original requester gets a dedicated 'friend_accepted' notification
-- instead of a generic follow. One-way follows keep 'new_follower', which
-- the bell renders as "wants to be your friend" with accept/dismiss.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array['new_follower', 'room_live', 'room_starting_soon', 'room_invite', 'friend_accepted']));

create or replace function public.notify_new_follower()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.user_follows f
    where f.follower_id = new.following_id and f.following_id = new.follower_id
  ) then
    -- This follow completes a friendship: tell the original requester
    -- their request was accepted (their own notify_follows setting applies).
    if coalesce((select notify_follows from public.user_settings
                 where user_id = new.following_id), true) then
      insert into public.notifications (user_id, type, actor_id)
      values (new.following_id, 'friend_accepted', new.follower_id);
    end if;
  elsif coalesce((select notify_follows from public.user_settings
                  where user_id = new.following_id), true) then
    insert into public.notifications (user_id, type, actor_id)
    values (new.following_id, 'new_follower', new.follower_id);
  end if;
  return new;
end;
$$;
