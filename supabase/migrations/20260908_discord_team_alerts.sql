-- ─── Discord: the team hears about call trouble and reports ──────────
-- The room already records what goes wrong in a call (room_call_events:
-- connect_fail, token_fail, reopened_after_unclean_exit) and testers can
-- report people (user_reports), but nothing told anyone. Now both raise
-- the same pg_net event as the rest (20260905), and /api/internal/discord
-- posts a card to #team: one card per room for call trouble, edited as
-- events pile up; one card per report.

alter table public.discord_cards drop constraint if exists discord_cards_kind_check;
alter table public.discord_cards
  add constraint discord_cards_kind_check check (kind in ('room', 'recording', 'post', 'call', 'report'));

create or replace function public.notify_discord_call_trouble()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.room_id is not null
     and (new.event in ('connect_fail', 'token_fail', 'reopened_after_unclean_exit')
          or new.event ilike '%fail%'
          or new.event ilike '%error%') then
    perform public.notify_discord('call_trouble', new.room_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_discord_call_trouble() from public, anon, authenticated;

drop trigger if exists trg_notify_discord_call_trouble on public.room_call_events;
create trigger trg_notify_discord_call_trouble
  after insert on public.room_call_events
  for each row
  execute function public.notify_discord_call_trouble();

create or replace function public.notify_discord_user_report()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.notify_discord('user_report', new.id);
  return new;
end;
$$;

revoke execute on function public.notify_discord_user_report() from public, anon, authenticated;

drop trigger if exists trg_notify_discord_user_report on public.user_reports;
create trigger trg_notify_discord_user_report
  after insert on public.user_reports
  for each row
  execute function public.notify_discord_user_report();
