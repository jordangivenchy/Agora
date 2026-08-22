-- ============================================================
-- 20260846_community_bookmarks.sql
--
-- Community Bookmarks (Reddit-style): a mod-curated list of links shown
-- in the community's sidebar as pill buttons — plain links ("Discord")
-- or dropdown groups ("Social Links ▾" → several links). Stored as jsonb:
--   [{ "label": "Discord", "url": "https://…" },
--    { "label": "Social Links", "items": [{ "label": "X", "url": "https://…" }, …] }]
-- Written only through set_community_bookmarks (moderators), which
-- validates shape, sizes, and http(s)-only URLs — the rail renders these
-- as hrefs, so nothing else may ever land in a url.
-- ============================================================

alter table public.communities
  add column if not exists bookmarks jsonb not null default '[]'::jsonb;

alter table public.communities drop constraint if exists communities_bookmarks_is_array;
alter table public.communities add constraint communities_bookmarks_is_array
  check (jsonb_typeof(bookmarks) = 'array');

create or replace function public.set_community_bookmarks(p_community uuid, p_bookmarks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_item jsonb;
  v_sub  jsonb;
begin
  if v_me is null or not public.is_community_mod(p_community, v_me) then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
  if p_bookmarks is null or jsonb_typeof(p_bookmarks) <> 'array' then
    raise exception 'bookmarks_not_array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_bookmarks) > 12 then
    raise exception 'too_many_bookmarks' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_bookmarks) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'label') <> 'string'
       or char_length(btrim(v_item->>'label')) not between 1 and 40 then
      raise exception 'invalid_bookmark_label' using errcode = '22023';
    end if;
    if v_item ? 'items' then
      if jsonb_typeof(v_item->'items') <> 'array' or jsonb_array_length(v_item->'items') not between 1 and 12 then
        raise exception 'invalid_bookmark_group' using errcode = '22023';
      end if;
      for v_sub in select * from jsonb_array_elements(v_item->'items') loop
        if jsonb_typeof(v_sub) <> 'object'
           or jsonb_typeof(v_sub->'label') <> 'string'
           or char_length(btrim(v_sub->>'label')) not between 1 and 40
           or jsonb_typeof(v_sub->'url') <> 'string'
           or char_length(v_sub->>'url') > 500
           or (v_sub->>'url') !~ '^https?://' then
          raise exception 'invalid_bookmark_link' using errcode = '22023';
        end if;
      end loop;
    else
      if jsonb_typeof(v_item->'url') <> 'string'
         or char_length(v_item->>'url') > 500
         or (v_item->>'url') !~ '^https?://' then
        raise exception 'invalid_bookmark_link' using errcode = '22023';
      end if;
    end if;
  end loop;

  update public.communities set bookmarks = p_bookmarks where id = p_community;
  perform public.log_mod_action(p_community, v_me, 'settings_update', null, null, 'bookmarks');
end;
$$;

revoke all on function public.set_community_bookmarks(uuid, jsonb) from public, anon;
grant execute on function public.set_community_bookmarks(uuid, jsonb) to authenticated;
