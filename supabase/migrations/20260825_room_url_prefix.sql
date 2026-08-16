-- Pretty room URLs: /agora/<slug>-<short8> carries only an id prefix; this
-- resolves it to the full room id. Rooms are publicly viewable, so exposing
-- id-by-prefix to anon adds nothing new.
create or replace function public.resolve_room_prefix(p_prefix text)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.debate_rooms
  where id::text like lower(p_prefix) || '%'
  limit 1;
$$;

revoke all on function public.resolve_room_prefix(text) from public;
grant execute on function public.resolve_room_prefix(text) to anon, authenticated;
