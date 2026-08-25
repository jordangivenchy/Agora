-- ─── Remove "debate" from DB-generated user-visible copy ─────────────
-- The word is retired site-wide in favor of "discussion". Client copy
-- is swept in the app code; this patches the strings that originate in
-- SQL functions. Applied as an in-place string replace over each live
-- function definition so it stays correct regardless of which version
-- of the function is deployed (idempotent — re-running is a no-op).
-- The system community was also renamed by hand: "Debates" → "Replays",
-- "Debate Club" → "Discussion Club" (data update, 2026-08-25).

do $$
declare r record; def text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enforce_max_scheduled_rooms','join_private_room','get_people_suggestions','ensure_debate_discussion')
  loop
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'at most 3 debates at once', 'at most 3 discussions at once');
    def := replace(def, 'This debate is already live', 'This discussion is already live');
    def := replace(def, 'Hosts debates in ', 'Hosts discussions in ');
    def := replace(def, 'Discussion for the debate "%s" — watch the replay', 'Discussion for "%s" — watch the replay');
    execute def;
  end loop;
end $$;
