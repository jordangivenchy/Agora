-- Recordings were only stopped by the host's client (close-stage
-- stop_all). Every other end path — the hostless reaper, the duel
-- leave-trigger, manual cleanup — left the egress filming a dead stage,
-- burning LiveKit minutes and R2 storage until some backstop noticed
-- (and the maintenance-cron sweep is still disabled by the missing
-- CRON_SECRET). Now the database itself tells the app the moment a live
-- room ends: trigger → pg_net POST → /api/internal/room-ended, which
-- stops all active egresses for the room server-side. Same
-- app_config-secret contract as the room-reminders webhook.

create or replace function public.notify_room_ended()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_origin text;
begin
  -- Only live → ended transitions can have an egress running.
  if new.status = 'ended' and old.status = 'live' then
    select value into v_secret from public.app_config where key = 'reminder_webhook_secret';
    select value into v_origin from public.app_config where key = 'app_origin';
    if v_secret is not null and v_origin is not null then
      perform net.http_post(
        url := v_origin || '/api/internal/room-ended',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object('roomId', new.id)
      );
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_room_ended() from public, anon, authenticated;

drop trigger if exists trg_notify_room_ended on public.debate_rooms;
create trigger trg_notify_room_ended
  after update of status on public.debate_rooms
  for each row
  execute function public.notify_room_ended();
