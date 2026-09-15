-- Recordings in parts (src/lib/recordingParts.ts).
--
-- LiveKit's recorder can stop on its own while a room is still live: from
-- 2026-09-12 every camera room lost its recording ~20 s in to "CPU
-- exhausted", leaving 9-22 s replays of calls that ran up to 21 minutes.
-- The recording page is lighter now, and when a recorder still stops the
-- LiveKit webhook starts the next part in <room>/p<n>/; the replay plays
-- the parts in order through /api/recordings/<room>/index.m3u8.
--
-- Each part: { n, egress_id, started_at, ended_at, duration, bytes } —
-- duration (seconds) and bytes as LiveKit reports when the part ends.

alter table public.debate_rooms
  add column if not exists recording_parts jsonb not null default '[]'::jsonb;

-- Claim the next part. One part is open (not ended) at a time, so a
-- duplicate webhook delivery or a host reconnect can't start a second
-- recorder. An open part claimed within the last minute always blocks
-- (its recorder may still be starting). An older one blocks while it has
-- a recorder, unless p_close_open: the host's own start, which has
-- already checked with LiveKit that nothing is filming, so it's dead.
-- Whatever doesn't block is closed. A room recorded before parts existed
-- counts its original files as part 1.
create or replace function public.claim_recording_part(p_room uuid, p_close_open boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parts jsonb;
  v_url text;
  v_started timestamptz;
  v_n integer;
  v_open jsonb;
begin
  select recording_parts, recording_url, recording_started_at
    into v_parts, v_url, v_started
    from public.debate_rooms where id = p_room for update;
  if not found then return null; end if;

  if jsonb_array_length(v_parts) = 0 and v_url is not null then
    v_parts := jsonb_build_array(jsonb_build_object(
      'n', 1, 'egress_id', null, 'started_at', v_started, 'ended_at', null));
  end if;

  select p into v_open from jsonb_array_elements(v_parts) p
   where p->>'ended_at' is null
     and (coalesce((p->>'started_at')::timestamptz, 'epoch'::timestamptz) > now() - interval '1 minute'
          or (not p_close_open and p->>'egress_id' is not null))
   limit 1;
  if v_open is not null then return null; end if;
  -- close what's left open: stale claims, or recorders LiveKit has lost
  select coalesce(jsonb_agg(case when p->>'ended_at' is null
                                 then p || jsonb_build_object('ended_at', now())
                                 else p end order by (p->>'n')::int), '[]'::jsonb)
    into v_parts from jsonb_array_elements(v_parts) p;

  v_n := coalesce((select max((p->>'n')::int) from jsonb_array_elements(v_parts) p), 0) + 1;
  if v_n > 12 then return null; end if;

  update public.debate_rooms
     set recording_parts = v_parts || jsonb_build_array(jsonb_build_object(
           'n', v_n, 'egress_id', null, 'started_at', now(), 'ended_at', null))
   where id = p_room;
  return v_n;
end;
$$;

-- The recorder for a claimed part is running: remember its id.
create or replace function public.set_recording_part_egress(p_room uuid, p_n integer, p_egress text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.debate_rooms
     set recording_parts = (
       select coalesce(jsonb_agg(case when (p->>'n')::int = p_n
                                      then p || jsonb_build_object('egress_id', p_egress)
                                      else p end order by (p->>'n')::int), '[]'::jsonb)
         from jsonb_array_elements(recording_parts) p)
   where id = p_room;
$$;

-- The recorder for a claimed part never started: give the claim back.
create or replace function public.drop_recording_part(p_room uuid, p_n integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.debate_rooms
     set recording_parts = (
       select coalesce(jsonb_agg(p order by (p->>'n')::int), '[]'::jsonb)
         from jsonb_array_elements(recording_parts) p
        where (p->>'n')::int <> p_n or p->>'egress_id' is not null)
   where id = p_room;
$$;

-- A recorder ended (LiveKit's egress_ended): close its part with what
-- LiveKit reported, and total the room's real size. Idempotent — webhook
-- deliveries can repeat. Returns what the webhook needs to decide on a
-- restart.
create or replace function public.finish_recording_part(
  p_room uuid, p_egress text, p_ended_at timestamptz, p_duration double precision, p_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parts jsonb;
  v_url text;
  v_started timestamptz;
  v_status text;
  v_hls text;
  v_match integer;
  v_bytes bigint;
begin
  select recording_parts, recording_url, recording_started_at, status, hls_url
    into v_parts, v_url, v_started, v_status, v_hls
    from public.debate_rooms where id = p_room for update;
  if not found then return null; end if;

  if jsonb_array_length(v_parts) = 0 and v_url is not null then
    v_parts := jsonb_build_array(jsonb_build_object(
      'n', 1, 'egress_id', p_egress, 'started_at', v_started, 'ended_at', null));
  end if;

  select (p->>'n')::int into v_match from jsonb_array_elements(v_parts) p
   where p->>'egress_id' = p_egress limit 1;
  if v_match is null then
    -- the recorder died before its id was written down: the open claim
    select (p->>'n')::int into v_match from jsonb_array_elements(v_parts) p
     where p->>'egress_id' is null and p->>'ended_at' is null
     order by (p->>'n')::int desc limit 1;
  end if;

  if v_match is not null then
    select coalesce(jsonb_agg(case when (p->>'n')::int = v_match
                                   then p || jsonb_build_object(
                                     'egress_id', p_egress,
                                     'ended_at', to_jsonb(p_ended_at),
                                     'duration', p_duration,
                                     'bytes', p_bytes)
                                   else p end order by (p->>'n')::int), '[]'::jsonb)
      into v_parts from jsonb_array_elements(v_parts) p;
    select sum((p->>'bytes')::bigint) into v_bytes
      from jsonb_array_elements(v_parts) p where p->>'bytes' is not null;
    update public.debate_rooms
       set recording_parts = v_parts,
           recording_bytes = coalesce(v_bytes, recording_bytes)
     where id = p_room;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'hls_url', v_hls,
    'parts', jsonb_array_length(v_parts),
    'matched', v_match is not null);
end;
$$;

revoke all on function public.claim_recording_part(uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_recording_part_egress(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.drop_recording_part(uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_recording_part(uuid, text, timestamptz, double precision, bigint) from public, anon, authenticated;

-- The size estimate is only the fallback now (real sizes from LiveKit win),
-- and it follows the 720p recording: ~3.1 Mbit/s at most.
create or replace function public.stamp_recording_bytes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.recording_ended_at is not null and old.recording_ended_at is null
     and new.recording_started_at is not null
     and new.recording_bytes is null then
    new.recording_bytes :=
      greatest(0, extract(epoch from (new.recording_ended_at - new.recording_started_at)))::bigint * 391000;
  end if;
  return new;
end;
$$;

create or replace function public.get_recording_usage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'used_bytes', coalesce((
      select sum(coalesce(
        r.recording_bytes,
        case when r.recording_started_at is not null
          -- live rooms count at current elapsed length; an ended room
          -- whose recording never closed cleanly is capped at the
          -- room's own end time, never treated as still growing
          then greatest(0, extract(epoch from (
            coalesce(r.recording_ended_at,
                     case when r.status = 'ended' then coalesce(r.ended_at, r.recording_started_at) end,
                     now()) - r.recording_started_at)))::bigint * 391000
          else 0 end
      ))
      from public.debate_rooms r
      where r.host_id = auth.uid() and r.recording_url is not null
    ), 0),
    'limit_mb', coalesce(
      (select u.recording_storage_limit_mb from public.users u where u.id = auth.uid()), 5120),
    'record_debates', coalesce(
      (select s.record_debates from public.user_settings s where s.user_id = auth.uid()), true)
  );
$$;
revoke all on function public.get_recording_usage() from public, anon;
grant execute on function public.get_recording_usage() to authenticated;
