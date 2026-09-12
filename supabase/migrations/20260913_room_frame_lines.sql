-- ─── The frame's height ───────────────────────────────────────────────
-- A frame is a few paragraphs, not a scroll. Whatever the client, the
-- stored text is tidied the way the editor tidies it (empty-paragraph
-- placeholders dropped, at most one blank line in a row, trimmed), and
-- then it may run to 16 lines and 1200 characters, each move down a
-- line counting once. Over either is refused, never clipped.

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
  if not public.can_frame_room(p_room, v_uid) then raise exception 'only the host can set the frame'; end if;
  if length(v_about) > 6000 then raise exception 'the frame is too long (1200 characters)'; end if;

  v_about := replace(v_about, E'\r', '');
  v_about := regexp_replace(v_about, E'^[ \t]*&nbsp;[ \t]*$', '', 'gn');
  v_about := regexp_replace(v_about, E'\n{3,}', E'\n\n', 'g');
  v_about := btrim(v_about, E' \t\n');

  if length(regexp_replace(v_about, E'\n{2,}', E'\n', 'g')) > 1200 then
    raise exception 'the frame is too long (1200 characters)';
  end if;
  if v_about <> '' and array_length(string_to_array(v_about, E'\n'), 1) > 16 then
    raise exception 'the frame is too tall (16 lines at most)';
  end if;

  update public.debate_rooms
     set framing = coalesce(framing, '{}'::jsonb)
                   || jsonb_build_object('about', v_about, 'about_by', v_uid, 'about_at', now())
   where id = p_room
   returning framing into v_new;
  return v_new;
end;
$$;
