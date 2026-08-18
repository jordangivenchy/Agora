-- Scheduled-debate reminder delivery.
-- Every ~2 minutes pg_cron looks for debates whose doors just opened
-- (scheduled_start - 30min <= now) with unsent reminders:
--   1. bell notifications insert directly (type 'room_starting_soon' —
--      the bell already renders it and links to the room)
--   2. pg_net POSTs the room to /api/cron/reminders, which sends the
--      email (Resend, once configured) and web-push fanout
-- Secrets/config live in app_config: RLS on with no policies, so only the
-- service role (API routes) and definer functions can read it.
-- Applied to the live DB on 2026-08-17 (values inserted separately).

create extension if not exists pg_net;

alter table public.room_reminders
  add column if not exists reminded_at timestamptz;

-- Web-push subscriptions, one row per browser.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Server-only config (webhook secret, VAPID keys, app origin).
create table if not exists public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

create or replace function public.send_due_room_reminders()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  v_secret text;
  v_origin text;
  n integer := 0;
begin
  select value into v_secret from public.app_config where key = 'reminder_webhook_secret';
  select value into v_origin from public.app_config where key = 'app_origin';

  for r in
    select distinct rm.room_id
    from public.room_reminders rm
    join public.debate_rooms dr on dr.id = rm.room_id
    where rm.reminded_at is null
      and dr.status in ('scheduled', 'created')
      and dr.scheduled_start is not null
      and dr.scheduled_start > now()
      and dr.scheduled_start - interval '30 minutes' <= now()
  loop
    insert into public.notifications (user_id, type, actor_id, room_id)
    select rm.user_id, 'room_starting_soon', dr.host_id, rm.room_id
    from public.room_reminders rm
    join public.debate_rooms dr on dr.id = rm.room_id
    where rm.room_id = r.room_id and rm.reminded_at is null;

    update public.room_reminders
    set reminded_at = now()
    where room_id = r.room_id and reminded_at is null;

    if v_secret is not null and v_origin is not null then
      perform net.http_post(
        url := v_origin || '/api/cron/reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object('roomId', r.room_id)
      );
    end if;

    n := n + 1;
  end loop;

  return n;
end;
$$;
revoke execute on function public.send_due_room_reminders() from public, anon, authenticated;

-- Every 2 minutes. Reschedule idempotently.
do $$
begin
  perform cron.unschedule('room-reminders');
exception when others then null;
end $$;
select cron.schedule('room-reminders', '*/2 * * * *', 'select public.send_due_room_reminders()');
