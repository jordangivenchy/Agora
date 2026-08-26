-- Pin search_path on the 10 functions the security advisor flagged with a
-- role-mutable search_path (a caller could otherwise shadow a referenced
-- object via a malicious schema on their path). Applied to the live DB.
alter function public.claim_cached_response(text) set search_path = public;
alter function public.claim_interjection_slot(uuid, integer) set search_path = public;
alter function public.email_default_types() set search_path = public;
alter function public.has_data_consent(uuid, text) set search_path = public;
alter function public.notification_types() set search_path = public;
alter function public.prune_ai_pipeline() set search_path = public;
alter function public.search_scraped_data(text, text, integer) set search_path = public;
alter function public.seed_data_consent() set search_path = public;
alter function public.stamp_recording_bytes() set search_path = public;
alter function public.wilson_lower_bound(bigint, bigint) set search_path = public;
