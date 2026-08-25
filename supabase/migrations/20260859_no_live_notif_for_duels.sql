-- ─── No "went live" notification for queue-matched duels ─────────────
-- A queue match (pro_size/con_size 1/1, written only by
-- queue_for_topic) is two people agreeing to talk right now — not a
-- show the matched pair's followers were invited to. Blasting
-- followed_live for every spontaneous pairing is noise, so
-- notify_v2_room_state now skips the live branch for duels. Scheduled/
-- replay/discussion branches are untouched (duels are never scheduled;
-- a replay of a good duel is still worth surfacing).
--
-- Identical to 20260852's function except the duel guard on
-- v_became_live.

create or replace function public.notify_v2_room_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_became_scheduled boolean;
  v_became_live boolean;
  v_recording_done boolean;
  v_discussion_opened boolean;
begin
  if new.is_private then
    return new;
  end if;

  v_became_scheduled :=
    new.scheduled_start is not null
    and new.status in ('created', 'scheduled')
    and (tg_op = 'INSERT' or old.scheduled_start is null);
  v_became_live :=
    new.status = 'live'
    and (tg_op = 'INSERT' or old.status is distinct from 'live')
    -- queue-matched 1v1s go live silently
    and not (coalesce(new.pro_size, 10) = 1 and coalesce(new.con_size, 10) = 1);
  v_recording_done :=
    tg_op = 'UPDATE'
    and new.recording_ended_at is not null
    and old.recording_ended_at is null;
  v_discussion_opened :=
    tg_op = 'UPDATE'
    and new.discussion_post_id is not null
    and old.discussion_post_id is null;

  if v_became_scheduled then
    insert into public.notifications (user_id, type, actor_id, room_id, meta)
    select f.follower_id, 'followed_scheduled', new.host_id, new.id,
           jsonb_build_object('scheduled_start', new.scheduled_start)
    from public.user_follows f
    where f.following_id = new.host_id
      and f.follower_id <> new.host_id
      and public.notif_enabled(f.follower_id, 'followed_scheduled')
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
           or (b.blocker_id = new.host_id and b.blocked_id = f.follower_id))
      and not exists (
        select 1 from public.notifications n
        where n.user_id = f.follower_id and n.room_id = new.id
          and n.type = 'followed_scheduled');
  end if;

  if v_became_live then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select f.follower_id, 'followed_live', new.host_id, new.id
    from public.user_follows f
    where f.following_id = new.host_id
      and f.follower_id <> new.host_id
      and public.notif_enabled(f.follower_id, 'followed_live')
      and not exists (
        select 1 from public.room_reminders rr
        where rr.room_id = new.id and rr.user_id = f.follower_id)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
           or (b.blocker_id = new.host_id and b.blocked_id = f.follower_id))
      and not exists (
        select 1 from public.notifications n
        where n.user_id = f.follower_id and n.room_id = new.id
          and n.type in ('room_live', 'followed_live'));
  end if;

  if v_recording_done then
    insert into public.notifications (user_id, type, actor_id, room_id)
    select s.uid, 'debate_replay_ready', null, new.id
    from (
      select new.host_id as uid
      union
      select p.user_id from public.debate_participants p
      where p.room_id = new.id and p.role = 'debater'
    ) s
    where public.notif_enabled(s.uid, 'debate_replay_ready')
      and not exists (
        select 1 from public.notifications n
        where n.user_id = s.uid and n.room_id = new.id
          and n.type = 'debate_replay_ready');
  end if;

  if v_discussion_opened then
    perform public.notif_emit(
      new.host_id, 'discussion_opened', auth.uid(),
      new.id, new.discussion_post_id, null, '{}'::jsonb, null);
  end if;

  return new;
end;
$$;
revoke execute on function public.notify_v2_room_state() from anon, authenticated;
