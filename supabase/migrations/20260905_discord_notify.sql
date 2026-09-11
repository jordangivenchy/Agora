-- ─── Discord: the beta server hears what happens on the site ─────────
-- Three moments are worth a message in the testers' Discord: a public
-- room going live, a recording landing (a new past discussion), and a
-- moderator featuring a post on the home page. Same contract as the
-- room-ended hook (20260879): trigger → pg_net POST → the app, carrying
-- the app_config secret; /api/internal/discord re-reads the row, builds
-- the card and posts it to the channel's webhook (Vercel env
-- DISCORD_WEBHOOK_*). Nothing here knows Discord — it only says "this
-- happened to this id". With no webhook configured the route answers
-- "skipped" and the site is unchanged.

create or replace function public.notify_discord(p_event text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_secret text;
  v_origin text;
begin
  select value into v_secret from public.app_config where key = 'reminder_webhook_secret';
  select value into v_origin from public.app_config where key = 'app_origin';
  if v_secret is null or v_origin is null then
    return;
  end if;
  perform net.http_post(
    url := v_origin || '/api/internal/discord',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('event', p_event, 'id', p_id)
  );
end;
$$;

revoke execute on function public.notify_discord(text, uuid) from public, anon, authenticated;

-- Rooms: live, and recorded. Mirrors notify_v2_room_state's tests for
-- "became live" (private rooms never leave the house) and "recording
-- done" — except that queue-matched 1v1s are announced too: in a beta
-- a live call is exactly what testers want to hop into.
create or replace function public.notify_discord_room_state()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_private then
    return new;
  end if;

  if new.status = 'live'
     and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    perform public.notify_discord('room_live', new.id);
  end if;

  if tg_op = 'UPDATE'
     and new.recording_ended_at is not null
     and old.recording_ended_at is null
     and new.recording_url is not null then
    perform public.notify_discord('recording_ready', new.id);
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_discord_room_state() from public, anon, authenticated;

drop trigger if exists trg_notify_discord_room_state on public.debate_rooms;
create trigger trg_notify_discord_room_state
  after insert or update of status, recording_ended_at
  on public.debate_rooms
  for each row
  execute function public.notify_discord_room_state();

-- Posts: featured on home (set_post_featured, site moderators only).
-- Un-featuring says nothing; featuring again announces again.
create or replace function public.notify_discord_post_featured()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.featured_at is not null
     and (tg_op = 'INSERT' or old.featured_at is null) then
    perform public.notify_discord('post_featured', new.id);
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_discord_post_featured() from public, anon, authenticated;

drop trigger if exists trg_notify_discord_post_featured on public.community_posts;
create trigger trg_notify_discord_post_featured
  after insert or update of featured_at
  on public.community_posts
  for each row
  execute function public.notify_discord_post_featured();
