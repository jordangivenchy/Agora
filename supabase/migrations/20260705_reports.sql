-- ============================================================
-- 20260705_reports.sql
--
-- User reporting (trust & safety, part 1).
--
-- Design:
--   • user_reports has RLS enabled with NO policies — clients can
--     never read or write it directly. The only path in is the
--     submit_report() RPC below (security definer), which validates
--     everything server-side. Reading reports is a dashboard /
--     service-role job (a moderator UI can come later).
--   • Snapshots over joins: the reported @username, the message
--     content, and the room state are copied INTO the report row at
--     submission time, so the evidence survives renames, message
--     deletion, and room closure.
--   • Dedupe: the same reporter re-reporting the same target (same
--     message, if any) within 10 minutes returns the existing report
--     instead of creating spam rows.
-- ============================================================

create table if not exists public.user_reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_user_id uuid not null references public.users(id) on delete cascade,
  reported_username text not null,
  reason text not null check (reason in (
    'harassment', 'hate_speech', 'threats_violence', 'spam',
    'sexual_content', 'misinformation', 'impersonation',
    'inappropriate_username', 'other'
  )),
  description text check (char_length(description) <= 1000),
  context text not null check (context in ('room', 'profile', 'chat', 'history')),
  room_id uuid references public.debate_rooms(id) on delete set null,
  message_id uuid references public.room_messages(id) on delete set null,
  message_content text,
  room_state jsonb,
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_user_reports_queue
  on public.user_reports (status, created_at);
create index if not exists idx_user_reports_reported
  on public.user_reports (reported_user_id, created_at);

alter table public.user_reports enable row level security;
-- Intentionally no policies: write via RPC only, read via dashboard only.

create or replace function public.submit_report(
  p_reported    uuid,
  p_reason      text,
  p_description text default null,
  p_context     text default 'profile',
  p_room        uuid default null,
  p_message     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me          uuid := auth.uid();
  v_username    text;
  v_msg_content text;
  v_room_state  jsonb;
  v_existing    uuid;
  v_id          uuid;
  v_desc        text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_reported = v_me then
    raise exception 'cannot_report_self' using errcode = 'P0001';
  end if;

  if p_reason not in (
    'harassment', 'hate_speech', 'threats_violence', 'spam',
    'sexual_content', 'misinformation', 'impersonation',
    'inappropriate_username', 'other'
  ) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if p_reason = 'other' and v_desc is null then
    raise exception 'description_required'
      using errcode = '22023',
            message = 'Please describe the problem when choosing Other.';
  end if;

  if p_context not in ('room', 'profile', 'chat', 'history') then
    raise exception 'invalid_context' using errcode = '22023';
  end if;

  -- Snapshot the reported user's current handle.
  select username into v_username from public.users where id = p_reported;
  if v_username is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  -- Snapshot the offending message (must belong to the reported user —
  -- prevents attaching someone else's words as "evidence").
  if p_message is not null then
    select content into v_msg_content
    from public.room_messages
    where id = p_message and user_id = p_reported;
  end if;

  -- Snapshot the room's state at report time.
  if p_room is not null then
    select jsonb_build_object(
      'status', r.status,
      'motion', r.motion,
      'is_private', r.is_private,
      'started_at', r.started_at,
      'participant_count', (
        select count(*) from public.debate_participants dp
        where dp.room_id = r.id and dp.left_at is null
      )
    )
    into v_room_state
    from public.debate_rooms r
    where r.id = p_room;
  end if;

  -- Dedupe repeat submissions.
  select id into v_existing
  from public.user_reports
  where reporter_id = v_me
    and reported_user_id = p_reported
    and coalesce(message_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_message, '00000000-0000-0000-0000-000000000000'::uuid)
    and created_at > now() - interval '10 minutes'
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.user_reports (
    reporter_id, reported_user_id, reported_username,
    reason, description, context,
    room_id, message_id, message_content, room_state
  ) values (
    v_me, p_reported, v_username,
    p_reason, v_desc, p_context,
    p_room, p_message, v_msg_content, v_room_state
  )
  returning id into v_id;

  -- Audit-log the event if the security log exists (added in the
  -- password-reset migration; reports must not fail without it).
  begin
    perform public.log_security_event(
      'user_reported',
      jsonb_build_object('report_id', v_id, 'reported_user_id', p_reported, 'reason', p_reason)
    );
  exception when undefined_function then
    null;
  end;

  return v_id;
end;
$$;

revoke all on function public.submit_report(uuid, text, text, text, uuid, uuid) from public;
grant execute on function public.submit_report(uuid, text, text, text, uuid, uuid) to authenticated;
