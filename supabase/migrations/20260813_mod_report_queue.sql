-- ============================================================
-- 20260813_mod_report_queue.sql
--
-- Closes the moderation loop. user_reports had a full status
-- lifecycle (open / reviewed / actioned / dismissed) and an index on
-- (status, created_at), but no way for a moderator to READ the queue
-- or act on a report — submit_report wrote into a bucket nobody could
-- open. Same posture as the rest of the moderation schema: no client
-- policies, everything through security-definer RPCs gated by
-- assert_moderator().
--
--   mod_list_reports(status, limit)  — the queue, newest first,
--                                      usernames joined in
--   mod_resolve_report(id, status)   — move a report through the
--                                      lifecycle; audit-logged
-- ============================================================

create or replace function public.mod_list_reports(
  p_status text default 'open',
  p_limit  integer default 50
)
returns table (
  id uuid,
  created_at timestamptz,
  status text,
  reason text,
  description text,
  context text,
  room_id uuid,
  message_content text,
  reporter_id uuid,
  reporter_username text,
  reported_user_id uuid,
  reported_username text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_moderator();

  if p_status is not null
     and p_status not in ('open', 'reviewed', 'actioned', 'dismissed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return query
  select
    r.id,
    r.created_at,
    r.status,
    r.reason,
    r.description,
    r.context,
    r.room_id,
    r.message_content,
    r.reporter_id,
    coalesce(ru.username, '(deleted)') as reporter_username,
    r.reported_user_id,
    -- reported_username was captured at report time; fall back to the
    -- live row in case the capture is stale.
    coalesce(r.reported_username, tu.username, '(deleted)') as reported_username
  from public.user_reports r
  left join public.users ru on ru.id = r.reporter_id
  left join public.users tu on tu.id = r.reported_user_id
  where (p_status is null or r.status = p_status)
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.mod_list_reports(text, integer) from public;
grant execute on function public.mod_list_reports(text, integer) to authenticated;

create or replace function public.mod_resolve_report(
  p_report uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  perform public.assert_moderator();

  if p_status not in ('reviewed', 'actioned', 'dismissed', 'open') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select status into v_old from public.user_reports where id = p_report;
  if v_old is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  update public.user_reports set status = p_status where id = p_report;

  -- Append-only audit trail (table from 20260704_password_reset_security;
  -- reused here as the general security log it was designed to be).
  insert into public.security_audit_log (user_id, event_type, metadata)
  values (
    auth.uid(),
    'report_' || p_status,
    jsonb_build_object('report_id', p_report, 'previous_status', v_old)
  );
end;
$$;

revoke all on function public.mod_resolve_report(uuid, text) from public;
grant execute on function public.mod_resolve_report(uuid, text) to authenticated;
