-- A new account's first username can no longer stop the account being made.
--
-- handle_new_user() gives every new account a starting username from
-- whoever signed them in: the handle they typed (email sign-up), their
-- name from Google, their Discord name, or the front of their email.
-- Usernames are unique, so a name that was already somebody's handle here
-- made the whole sign-up fail ("Database error saving new user"). Rare
-- with Google's full names; likely with Discord (sign-in added
-- 2026-10-07), where people keep one handle everywhere. The welcome page
-- asks for a proper username straight afterwards, so the starting one
-- only has to be free.
--
-- Now: Discord's "name#0" loses its tail, a name counts as taken whatever
-- its capitals, and a taken name gets four characters of the new
-- account's id on the end ("luke_3f9a"). Everything else is as it was
-- (the live body, pg_get_functiondef 2026-10-07).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base text := split_part(coalesce(
    nullif(btrim(new.raw_user_meta_data->>'preferred_username'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1)
  ), '#', 1);
  v_name text;
  v_try  int := 0;
begin
  if v_base is null or v_base = '' then
    v_base := 'user';
  end if;
  v_name := v_base;
  while v_try < 6 and exists (select 1 from public.users u where lower(u.username) = lower(v_name)) loop
    v_name := v_base || '_' || substr(replace(new.id::text, '-', ''), v_try * 4 + 1, 4);
    v_try := v_try + 1;
  end loop;

  insert into public.users (id, username, email, avatar_url)
  values (
    new.id,
    v_name,
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  );
  return new;
end;
$function$;
