-- ============================================================
-- 20260708_profile_qa_hardening.sql
-- Applied to the live DB on 2026-07-08 via MCP (mirrored here so the
-- repo matches production).
--
--   1. get_user_history — privacy fix. Previously ANY caller (incl.
--      anon, due to the grant drift below) could pass any p_user and
--      read that user's full debate history, including private rooms
--      and spectator participation. The 20260422 hardening pass fixed
--      the sibling get_user_live_and_scheduled but missed this one.
--      Now p_user is ignored (kept only for signature compat) and the
--      function returns the CALLER's history only; the app already
--      calls it exclusively with p_user: null (DebatesPage).
--
--   2. Function grants — the revoke/grant statements in earlier
--      migration files were never run against the live DB (functions
--      were created by hand in the SQL editor, leaving Postgres's
--      default EXECUTE-to-PUBLIC in place, so every RPC was callable
--      by anon). This re-applies the intended grants:
--        • authenticated-only: follow_user, unfollow_user,
--          update_profile, get_user_history, check_username_available
--        • anon + authenticated (public profile reads): search_users,
--          get_user_profile, get_followers, get_following, get_friends,
--          get_user_recent_debates, get_user_live_and_scheduled
-- ============================================================

create or replace function public.get_user_history(p_user uuid default null)
returns table (
  room_id        uuid,
  motion         text,
  topic_key      text,
  status         text,
  role           text,
  stance         text,
  joined_at      timestamptz,
  ended_at       timestamptz,
  started_at     timestamptz,
  pro_votes      bigint,
  con_votes      bigint,
  winning_stance text,
  outcome        text
)
language sql
stable
security definer
set search_path = public
as $$
  -- p_user intentionally ignored: history is caller-private.
  with target as (select auth.uid() as uid),
  vote_counts as (
    select
      dv.room_id,
      count(*) filter (where dv.stance = 'PRO') as pro_votes,
      count(*) filter (where dv.stance = 'CON') as con_votes
    from public.debate_votes dv
    group by dv.room_id
  )
  select
    r.id as room_id,
    r.motion,
    r.topic_key,
    r.status,
    dp.role,
    dp.stance,
    dp.joined_at,
    r.ended_at,
    r.started_at,
    coalesce(vc.pro_votes, 0) as pro_votes,
    coalesce(vc.con_votes, 0) as con_votes,
    case
      when coalesce(vc.pro_votes, 0) > coalesce(vc.con_votes, 0) then 'PRO'
      when coalesce(vc.con_votes, 0) > coalesce(vc.pro_votes, 0) then 'CON'
      when coalesce(vc.pro_votes, 0) = 0 and coalesce(vc.con_votes, 0) = 0 then null
      else 'TIE'
    end as winning_stance,
    case
      when dp.role <> 'debater' or dp.stance is null then null
      when coalesce(vc.pro_votes, 0) + coalesce(vc.con_votes, 0) = 0 then null
      when coalesce(vc.pro_votes, 0) = coalesce(vc.con_votes, 0) then 'tied'
      when (dp.stance = 'PRO' and coalesce(vc.pro_votes,0) > coalesce(vc.con_votes,0))
        or (dp.stance = 'CON' and coalesce(vc.con_votes,0) > coalesce(vc.pro_votes,0))
        then 'won'
      else 'lost'
    end as outcome
  from target
  join public.debate_participants dp on dp.user_id = target.uid
  join public.debate_rooms r on r.id = dp.room_id
  left join vote_counts vc on vc.room_id = r.id
  order by coalesce(r.ended_at, r.started_at, dp.joined_at) desc;
$$;

-- ── Grants: authenticated-only (writes + caller-private reads) ──
revoke all on function public.follow_user(uuid)                  from public, anon;
revoke all on function public.unfollow_user(uuid)                from public, anon;
revoke all on function public.update_profile(text,text,text,text) from public, anon;
revoke all on function public.get_user_history(uuid)             from public, anon;
revoke all on function public.check_username_available(text)     from public, anon;
grant execute on function public.follow_user(uuid)                   to authenticated;
grant execute on function public.unfollow_user(uuid)                 to authenticated;
grant execute on function public.update_profile(text,text,text,text) to authenticated;
grant execute on function public.get_user_history(uuid)              to authenticated;
grant execute on function public.check_username_available(text)      to authenticated;

-- ── Grants: public profile reads (anon + authenticated) ──
revoke all on function public.search_users(text)                     from public;
revoke all on function public.get_user_profile(uuid)                 from public;
revoke all on function public.get_followers(uuid)                    from public;
revoke all on function public.get_following(uuid)                    from public;
revoke all on function public.get_friends(uuid)                      from public;
revoke all on function public.get_user_recent_debates(uuid, int)     from public;
revoke all on function public.get_user_live_and_scheduled(uuid)      from public;
grant execute on function public.search_users(text)                  to authenticated, anon;
grant execute on function public.get_user_profile(uuid)              to authenticated, anon;
grant execute on function public.get_followers(uuid)                 to authenticated, anon;
grant execute on function public.get_following(uuid)                 to authenticated, anon;
grant execute on function public.get_friends(uuid)                   to authenticated, anon;
grant execute on function public.get_user_recent_debates(uuid, int)  to authenticated, anon;
grant execute on function public.get_user_live_and_scheduled(uuid)   to authenticated, anon;
