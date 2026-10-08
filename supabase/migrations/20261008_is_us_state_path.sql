-- is_us_state() (20261007_terms_agreement) looks nothing up: it compares
-- its argument with a list. It was the one function added that day
-- without a fixed search path, which the database's own security check
-- asks of every function. Pinned empty; what it answers is unchanged.
alter function public.is_us_state(text) set search_path = '';
