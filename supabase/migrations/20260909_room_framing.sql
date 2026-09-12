-- ─── The frame of a debate ────────────────────────────────────────────
-- A room now carries a written frame: what is being argued, set by the
-- host (or a co-host), and one line per person on the stage saying
-- where they stand. It rides on the room row as jsonb, so the room's
-- own realtime subscription delivers every change to everyone in it:
--   framing = {
--     "about": text, "about_by": uuid, "about_at": timestamptz,
--     "stances": { "<user_id>": { "text": text, "at": timestamptz } }
--   }
-- Three RPCs guard the writes; reading comes with the room under RLS.

alter table public.debate_rooms add column if not exists framing jsonb;

/* Host or co-host of the room. */
create or replace function public.can_frame_room(p_room uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.debate_rooms r
     where r.id = p_room
       and (r.host_id = p_user
            or exists (select 1 from public.debate_participants p
                        where p.room_id = r.id and p.user_id = p_user and p.left_at is null
                          and p.stage_role in ('host', 'cohost')))
  );
$$;

/* Anyone on the stage: host, co-host, debater, promoted speaker. */
create or replace function public.on_room_stage(p_room uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.debate_rooms r
     where r.id = p_room
       and (r.host_id = p_user
            or exists (select 1 from public.debate_participants p
                        where p.room_id = r.id and p.user_id = p_user and p.left_at is null
                          and (p.role = 'debater' or p.stage_role in ('host', 'cohost', 'speaker'))))
  );
$$;

revoke execute on function public.can_frame_room(uuid, uuid) from public, anon;
revoke execute on function public.on_room_stage(uuid, uuid) from public, anon;

create or replace function public.set_room_frame(p_room uuid, p_about text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_about text := left(btrim(coalesce(p_about, '')), 600);
  v_new jsonb;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.can_frame_room(p_room, v_uid) then raise exception 'only the host can set the frame'; end if;
  update public.debate_rooms
     set framing = coalesce(framing, '{}'::jsonb)
                   || jsonb_build_object('about', v_about, 'about_by', v_uid, 'about_at', now())
   where id = p_room
   returning framing into v_new;
  return v_new;
end;
$$;

create or replace function public.set_room_stance(p_room uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := left(btrim(coalesce(p_text, '')), 200);
  v_new jsonb;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.on_room_stage(p_room, v_uid) then raise exception 'only people on the stage can say where they stand'; end if;
  if v_text = '' then
    update public.debate_rooms
       set framing = coalesce(framing, '{}'::jsonb)
                     || jsonb_build_object('stances', coalesce(framing -> 'stances', '{}'::jsonb) - v_uid::text)
     where id = p_room
     returning framing into v_new;
  else
    update public.debate_rooms
       set framing = coalesce(framing, '{}'::jsonb)
                     || jsonb_build_object('stances', coalesce(framing -> 'stances', '{}'::jsonb)
                          || jsonb_build_object(v_uid::text, jsonb_build_object('text', v_text, 'at', now())))
     where id = p_room
     returning framing into v_new;
  end if;
  return v_new;
end;
$$;

/* The host clears a line that no longer belongs; anyone clears their own. */
create or replace function public.clear_room_stance(p_room uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new jsonb;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if p_user <> v_uid and not public.can_frame_room(p_room, v_uid) then raise exception 'only the host can clear another person''s line'; end if;
  update public.debate_rooms
     set framing = coalesce(framing, '{}'::jsonb)
                   || jsonb_build_object('stances', coalesce(framing -> 'stances', '{}'::jsonb) - p_user::text)
   where id = p_room
   returning framing into v_new;
  return v_new;
end;
$$;

revoke execute on function public.set_room_frame(uuid, text) from public, anon;
revoke execute on function public.set_room_stance(uuid, text) from public, anon;
revoke execute on function public.clear_room_stance(uuid, uuid) from public, anon;
grant execute on function public.set_room_frame(uuid, text) to authenticated;
grant execute on function public.set_room_stance(uuid, text) to authenticated;
grant execute on function public.clear_room_stance(uuid, uuid) to authenticated;
