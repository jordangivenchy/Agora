-- The profile page's first view in one call: the header (get_user_profile,
-- as the viewer), the viewer's id and moderator flag, and the rooms this
-- user hosted or debated in, with the hosts of the debated-in ones — what
-- lib/profileData.ts fetched in four round trips, one after another.
-- Runs as the caller, so row security applies to the rooms exactly as it
-- did. `profile` is null when no one has that name; `debates` is null
-- then too.

create or replace function public.get_profile_page(p_username text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid uuid;
  v_me uuid := auth.uid();
  v_is_mod boolean := coalesce((select u.is_moderator from public.users u where u.id = auth.uid()), false);
  v_profile jsonb;
  v_debates jsonb;
begin
  select u.id into v_uid from public.users u where lower(u.username) = lower(p_username) limit 1;
  if v_uid is null then
    return jsonb_build_object('profile', null, 'viewer_id', v_me, 'viewer_is_mod', v_is_mod, 'debates', null);
  end if;

  select to_jsonb(p) into v_profile from public.get_user_profile(v_uid) p limit 1;

  with hosted as (
    select r.id, r.motion, r.topic_key, r.status, r.created_at, r.scheduled_start,
           r.viewer_count, r.thumbnail_url, r.recording_url, r.host_id, 'host'::text as role
    from public.debate_rooms r
    where r.host_id = v_uid
    order by r.created_at desc
    limit 40
  ),
  debated as (
    select distinct on (r.id)
           r.id, r.motion, r.topic_key, r.status, r.created_at, r.scheduled_start,
           r.viewer_count, r.thumbnail_url, r.recording_url, r.host_id, 'debater'::text as role
    from public.debate_participants dp
    join public.debate_rooms r on r.id = dp.room_id
    where dp.user_id = v_uid
      and dp.role = 'debater'
      and r.id not in (select h.id from hosted h)
    order by r.id
  ),
  everything as (
    select * from hosted
    union all
    select * from debated
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'motion', x.motion,
           'topic_key', x.topic_key,
           'status', x.status,
           'created_at', x.created_at,
           'scheduled_start', x.scheduled_start,
           'viewer_count', x.viewer_count,
           'thumbnail_url', x.thumbnail_url,
           'recording_url', x.recording_url,
           'role', x.role,
           -- the host is named only for rooms this user debated in
           'host_id', case when x.role = 'debater' then x.host_id end,
           'host_username', case when x.role = 'debater' then h.username end,
           'host_display_name', case when x.role = 'debater' then h.display_name end,
           'host_avatar_url', case when x.role = 'debater' then h.avatar_url end
         ) order by x.created_at desc), '[]'::jsonb)
    into v_debates
  from everything x
  left join public.users h on h.id = x.host_id and x.role = 'debater';

  return jsonb_build_object(
    'profile', v_profile,
    'viewer_id', v_me,
    'viewer_is_mod', v_is_mod,
    'debates', v_debates
  );
end;
$$;

grant execute on function public.get_profile_page(text) to anon, authenticated;
