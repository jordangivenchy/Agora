-- ─── The frame takes formatting ───────────────────────────────────────
-- The frame is now written with the communities' editor and stored as
-- markdown, so the cap moves from 600 to 1200 characters of source.

create or replace function public.set_room_frame(p_room uuid, p_about text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_about text := left(btrim(coalesce(p_about, '')), 1200);
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
