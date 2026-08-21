-- ============================================================
-- 20260819_consent_on_by_default.sql
--
-- Data & Coach consent is now ON by default: it is granted when the user
-- accepts the app's terms at signup. This migration makes the database
-- reflect that — a consent row (all categories true) is seeded for every
-- new user, and backfilled for existing users. Users can still turn any
-- category OFF in Settings → Data & Coach (and download / erase their data).
--
-- Run in the Supabase SQL editor. Idempotent.
--
-- NOTE: the trigger is named to sort AFTER `on_auth_user_created` so the
-- public.users row (created by handle_new_user) exists before we insert the
-- consent row that references it.
-- ============================================================

create or replace function public.seed_data_consent()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_data_consent
    (user_id, analytics, debate_analysis, personalization, coaching)
  values (new.id, true, true, true, true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists zz_seed_data_consent on auth.users;
create trigger zz_seed_data_consent
  after insert on auth.users
  for each row execute procedure public.seed_data_consent();

-- Backfill: grant consent to every existing user who has no row yet.
insert into public.user_data_consent
  (user_id, analytics, debate_analysis, personalization, coaching)
select u.id, true, true, true, true
from public.users u
where not exists (
  select 1 from public.user_data_consent c where c.user_id = u.id
);
