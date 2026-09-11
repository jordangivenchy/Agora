-- The feed's reason for a recorded room said "Replay"; they are past
-- discussions now. The function body is long and lives in an earlier
-- migration, so the label is swapped in place rather than restated.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_home_feed';
  if v_def is null then return; end if;
  execute replace(v_def, '''Replay''', '''Past discussion''');
end $$;
