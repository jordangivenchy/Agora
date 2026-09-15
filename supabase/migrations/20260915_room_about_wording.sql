-- ─── About this room, in plain words ─────────────────────────────────
-- The panel is "About this room", not "the frame": the refusals people
-- can see say so too. Same checks and tidying as 20260913_room_frame_lines.

create or replace function public.set_room_frame(p_room uuid, p_about text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_about text := coalesce(p_about, '');
  v_new jsonb;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.can_frame_room(p_room, v_uid) then raise exception 'only the host can edit this'; end if;
  if length(v_about) > 6000 then raise exception 'too long (1200 characters)'; end if;

  v_about := replace(v_about, E'\r', '');
  v_about := regexp_replace(v_about, E'^[ \t]*&nbsp;[ \t]*$', '', 'gn');
  v_about := regexp_replace(v_about, E'\n{3,}', E'\n\n', 'g');
  v_about := btrim(v_about, E' \t\n');

  if length(regexp_replace(v_about, E'\n{2,}', E'\n', 'g')) > 1200 then
    raise exception 'too long (1200 characters)';
  end if;
  if v_about <> '' and array_length(string_to_array(v_about, E'\n'), 1) > 16 then
    raise exception 'too many lines (16 at most)';
  end if;

  update public.debate_rooms
     set framing = coalesce(framing, '{}'::jsonb)
                   || jsonb_build_object('about', v_about, 'about_by', v_uid, 'about_at', now())
   where id = p_room
   returning framing into v_new;
  return v_new;
end;
$$;
