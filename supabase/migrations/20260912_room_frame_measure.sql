-- ─── The frame's limit, measured the way the counter shows it ─────────
-- 1200 characters with each move down a line counting once (a paragraph
-- break is two newlines in markdown; it counts as one). Over the limit
-- is refused, never clipped: cutting markdown mid-way breaks formatting.
-- A hard cap on the raw source stays as a backstop.

create or replace function public.set_room_frame(p_room uuid, p_about text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_about text := btrim(coalesce(p_about, ''));
  v_new jsonb;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.can_frame_room(p_room, v_uid) then raise exception 'only the host can set the frame'; end if;
  if length(regexp_replace(replace(v_about, E'\r', ''), E'\n{2,}', E'\n', 'g')) > 1200 or length(v_about) > 6000 then
    raise exception 'the frame is too long (1200 characters)';
  end if;
  update public.debate_rooms
     set framing = coalesce(framing, '{}'::jsonb)
                   || jsonb_build_object('about', v_about, 'about_by', v_uid, 'about_at', now())
   where id = p_room
   returning framing into v_new;
  return v_new;
end;
$$;
