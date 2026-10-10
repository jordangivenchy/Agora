-- Totals: who "spoke" is who was on the stage, read the way the room reads it.
--
-- totals_cells (20261008_totals.sql) took a person to have spoken when
-- their seat's stage_role was 'host' or 'speaker'. But stage_role is only
-- written by a promotion: a room's host, and the two sides of a one-on-one
-- room, keep the column's default, 'audience', and the room works out
-- that they are on the stage from debate_rooms.host_id and from
-- role = 'debater' (components/agora/stage.ts, deriveStageRole; the
-- recorder's speakers in 20260851_debate_recordings.sql read it the same
-- way). So every host was counted as having listened to their own room,
-- and co-hosts with them.
--
-- This is the same function with that one reading corrected, and the
-- host carried through from the room. Nothing else changes: the same
-- rows out, the same small groups, blanked by the server before anything
-- is shown (lib/totals/table.ts).

create or replace function public.totals_cells(p_from date, p_to date)
returns table (
  measure text, subject_kind text, subject text, label text,
  category text, dimension text, value text,
  people integer, rooms integer, minutes integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with bounds as (
    select (date_trunc('month', p_from::timestamp) at time zone 'UTC') as t0,
           ((date_trunc('month', p_to::timestamp) + interval '1 month') at time zone 'UTC') as t1,
           extract(year from p_to)::int as y
  ),
  rooms as (
    select r.id, r.started_at, r.topic_key, r.host_id,
           lower(regexp_replace(btrim(r.motion), '\s+', ' ', 'g')) as motion_key,
           regexp_replace(btrim(r.motion), '\s+', ' ', 'g') as motion,
           -- a room left open is not a room that ran for days
           least(480, greatest(0, extract(epoch from (coalesce(r.ended_at, r.started_at) - r.started_at)) / 60))::int as minutes
    from public.debate_rooms r
    left join public.communities c on c.id = r.community_id
    cross join bounds b
    where r.status = 'ended'
      and r.is_private = false
      and coalesce(c.is_private, false) = false
      and r.started_at >= b.t0
      and r.started_at < b.t1
  ),
  people as (
    -- Only the year of birth is kept, so an age is right to within a year.
    select e.user_id, e.agreed_at, e.country, e.region,
           case when b.y - e.birth_year < 25 then '18-24'
                when b.y - e.birth_year < 35 then '25-34'
                when b.y - e.birth_year < 45 then '35-44'
                when b.y - e.birth_year < 55 then '45-54'
                when b.y - e.birth_year < 65 then '55-64'
                else '65+' end as age
    from public.totals_countable() e
    cross join bounds b
  ),
  facts as (
    select 'took_part'::text as measure, 'topic'::text as subject_kind, r.topic_key as subject, r.topic_key as label,
           -- on the stage as the room itself reads it (deriveStageRole): the
           -- stored stage_role of a host is the column's default, 'audience'
           case when p.stage_role in ('host', 'cohost', 'speaker') or p.user_id = r.host_id or p.role = 'debater'
                then 'spoke' else 'listened' end as category,
           p.user_id, r.id as room_id, r.minutes
    from public.debate_participants p
    join rooms r on r.id = p.room_id
    join people e on e.user_id = p.user_id and e.agreed_at <= r.started_at
    union all
    select 'argued', 'motion', r.motion_key, r.motion, x.stance, x.user_id, r.id, r.minutes
    from public.room_readings x
    join rooms r on r.id = x.room_id
    join people e on e.user_id = x.user_id and e.agreed_at <= r.started_at
    where x.stance in ('for', 'against', 'mixed')
    union all
    select 'kinds', 'topic', r.topic_key, r.topic_key, k.kind, x.user_id, r.id, r.minutes
    from public.room_readings x
    join rooms r on r.id = x.room_id
    join people e on e.user_id = x.user_id and e.agreed_at <= r.started_at
    cross join lateral unnest(x.kinds) as k(kind)
    union all
    select 'voted', 'motion', r.motion_key, r.motion,
           case v.stance when 'PRO' then 'for' else 'against' end, v.voter_id, r.id, r.minutes
    from public.debate_votes v
    join rooms r on r.id = v.room_id
    join people e on e.user_id = v.voter_id and e.agreed_at <= r.started_at
    where v.stance in ('PRO', 'CON')
  ),
  with_any as (
    select f.measure, f.subject_kind, f.subject, f.category, f.user_id from facts f
    union all
    select f.measure, f.subject_kind, f.subject, 'any', f.user_id from facts f
  ),
  spread as (
    select f.measure, f.subject_kind, f.subject, f.category, d.dimension, d.value, f.user_id
    from with_any f
    join people e on e.user_id = f.user_id
    cross join lateral (
      values ('all', 'all'), ('age', e.age), ('country', e.country), ('state', e.region)
    ) as d(dimension, value)
    where d.value is not null
  ),
  counted as (
    select s.measure, s.subject_kind, s.subject, s.category, s.dimension, s.value,
           count(distinct s.user_id)::int as people
    from spread s
    group by s.measure, s.subject_kind, s.subject, s.category, s.dimension, s.value
  ),
  -- one way of writing each subject, the same on every one of its rows
  names as (
    select f.subject_kind, f.subject, min(f.label) as label
    from facts f
    group by f.subject_kind, f.subject
  ),
  held as (
    select t.subject, count(*)::int as rooms, coalesce(sum(t.minutes), 0)::int as minutes
    from (select distinct f.subject, f.room_id, f.minutes from facts f where f.measure = 'took_part') t
    group by t.subject
  )
  select c.measure, c.subject_kind, c.subject, n.label, c.category, c.dimension, c.value, c.people,
         case when c.measure = 'took_part' and c.category = 'any' and c.dimension = 'all' then h.rooms end,
         case when c.measure = 'took_part' and c.category = 'any' and c.dimension = 'all' then h.minutes end
  from counted c
  join names n on n.subject_kind = c.subject_kind and n.subject = c.subject
  left join held h on c.measure = 'took_part' and h.subject = c.subject;
$$;

revoke execute on function public.totals_cells(date, date) from public, anon, authenticated;
grant execute on function public.totals_cells(date, date) to service_role;
