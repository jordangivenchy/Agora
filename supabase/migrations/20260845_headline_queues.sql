-- ============================================================
-- 20260845_headline_queues.sql
--
-- Queue to debate a news headline. The News tab's major stories get a
-- Queue option next to Start a discussion: the headline becomes a
-- debate_topics question (deduped by text, so everyone queuing on the
-- same story lands in the same queue) and the caller joins it through
-- the existing queue_for_topic matchmaking — same rooms, same
-- check_topic_match polling, same Browse-board visibility.
--
-- debate_topics was curation-only (no client writes); this opens ONE
-- narrow, server-validated path: authenticated, suspended users refused,
-- text length enforced by the table, topic_key allow-listed, and at most
-- 10 new questions per user per hour. Headline-created topics remember
-- their creator and source so the maintenance cron can retire stale ones.
-- ============================================================

alter table public.debate_topics
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists source_url text;

create or replace function public.queue_for_headline(
  p_question   text,
  p_topic_key  text,
  p_stance     text default 'PRO',
  p_source_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_q    text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_id   uuid;
  v_made int;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_suspended(v_me) then
    raise exception using errcode = 'P0001', message = 'account_suspended: Your account is suspended.';
  end if;
  if char_length(v_q) < 5 or char_length(v_q) > 200 then
    raise exception using errcode = 'P0001', message = 'bad_question: Headline must be 5–200 characters.';
  end if;
  if p_topic_key not in ('politics-law','politics-ethics','sports','culture','economics','science-tech','foreign-policy','philosophy') then
    raise exception using errcode = 'P0001', message = 'bad_topic: Unknown field.';
  end if;
  if p_source_url is not null and p_source_url !~ '^https://' then
    raise exception using errcode = 'P0001', message = 'bad_source: Source must be an https URL.';
  end if;

  select id into v_id from public.debate_topics where question = v_q;

  if v_id is null then
    select count(*) into v_made
    from public.debate_topics
    where created_by = v_me and created_at > now() - interval '1 hour';
    if v_made >= 10 then
      raise exception using errcode = 'P0001', message = 'rate_limited: Too many new questions this hour.';
    end if;

    insert into public.debate_topics (question, topic_key, active, created_by, source_url)
    values (v_q, p_topic_key, true, v_me, p_source_url)
    returning id into v_id;
  else
    update public.debate_topics set active = true where id = v_id and not active;
  end if;

  return public.queue_for_topic(v_id, p_stance) || jsonb_build_object('topic_id', v_id);
end;
$$;

revoke all on function public.queue_for_headline(text, text, text, text) from public, anon;
grant execute on function public.queue_for_headline(text, text, text, text) to authenticated;

-- Retire headline topics nobody is waiting on after a day, so the
-- question bank doesn't fill with yesterday's news. (Curated rows have
-- no created_by and are never touched.)
create or replace function public.retire_stale_headline_topics()
returns integer
language sql
security definer
set search_path = public
as $$
  with stale as (
    update public.debate_topics t
       set active = false
     where t.created_by is not null
       and t.active
       and t.created_at < now() - interval '24 hours'
       and not exists (
         select 1 from public.topic_queue q
          where q.topic_id = t.id and q.matched_room_id is null
       )
    returning 1
  )
  select count(*)::int from stale;
$$;

revoke all on function public.retire_stale_headline_topics() from public, anon, authenticated;
