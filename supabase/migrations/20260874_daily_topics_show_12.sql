-- Show more talking points per category in Daily Topics: raise the daily
-- rotation cap from 6 to 12 (pool is now deep enough per category).
create or replace function public.get_debate_topics()
returns table (
  id uuid, question text, topic_key text,
  queue_count bigint, pro_count bigint, con_count bigint,
  am_queued boolean, my_stance text
)
language sql stable security definer set search_path = public
as $$
  with fresh as (
    select q.topic_id, q.user_id, q.stance
    from public.topic_queue q
    where q.matched_room_id is null and q.last_seen_at > now() - interval '30 seconds'
  ),
  counts as (
    select t.id, t.question, t.topic_key,
      (select count(*) from fresh f where f.topic_id = t.id) as queue_count,
      (select count(*) from fresh f where f.topic_id = t.id and f.stance = 'PRO') as pro_count,
      (select count(*) from fresh f where f.topic_id = t.id and f.stance = 'CON') as con_count,
      exists (select 1 from public.topic_queue q where q.topic_id = t.id and q.user_id = auth.uid() and q.matched_room_id is null) as am_queued,
      (select q.stance from public.topic_queue q where q.topic_id = t.id and q.user_id = auth.uid() and q.matched_room_id is null) as my_stance,
      md5(current_date::text || t.id::text) as day_hash
    from public.debate_topics t where t.active
  ),
  ranked as (
    select c.*, row_number() over (partition by c.topic_key
      order by (c.queue_count > 0) desc, c.am_queued desc, c.day_hash) as rn
    from counts c
  )
  select id, question, topic_key, queue_count, pro_count, con_count, am_queued, my_stance
  from ranked
  where rn <= 12 or queue_count > 0 or am_queued
  order by queue_count desc, day_hash;
$$;
revoke all on function public.get_debate_topics() from public;
grant execute on function public.get_debate_topics() to anon, authenticated;
