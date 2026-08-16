-- Follow hardening: blocks sever the friend-request channel, and repeated
-- follow toggling can't spam notifications.

create or replace function public.follow_user(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_target is null or p_target = v_me then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  -- A block in either direction closes the door completely.
  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = p_target and ub.blocked_id = v_me)
       or (ub.blocker_id = v_me and ub.blocked_id = p_target)
  ) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  insert into public.user_follows (follower_id, following_id)
  values (v_me, p_target)
  on conflict (follower_id, following_id) do nothing;
end;
$$;

-- Notification dedupe: re-following someone who already has an unread
-- request/acceptance from you creates nothing new.
create or replace function public.notify_new_follower()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_type text;
begin
  if exists (
    select 1 from public.user_follows f
    where f.follower_id = new.following_id and f.following_id = new.follower_id
  ) then
    v_type := 'friend_accepted';
  else
    v_type := 'new_follower';
  end if;

  if coalesce((select notify_follows from public.user_settings
               where user_id = new.following_id), true)
     and not exists (
       select 1 from public.notifications n
       where n.user_id = new.following_id
         and n.actor_id = new.follower_id
         and n.type in ('new_follower', 'friend_accepted')
         and n.read_at is null
     )
  then
    insert into public.notifications (user_id, type, actor_id)
    values (new.following_id, v_type, new.follower_id);
  end if;
  return new;
end;
$$;
