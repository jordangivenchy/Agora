-- Grant-drift audit (2026-08-17). Every mutating RPC below asserts its own
-- authorization internally, but anon (signed-out) should not be able to
-- invoke auth-required actions at all. close_inactive_room deliberately
-- keeps anon: guests viewing a dead room may suggest closure (the RPC
-- re-validates timestamps itself). record_password_reset_attempt and
-- log_security_event stay anon by design (pre-auth flows).

revoke execute on function public.advance_speaker_queue(uuid) from anon;
revoke execute on function public.raise_hand(uuid, boolean) from anon;
revoke execute on function public.step_down_from_mic(uuid) from anon;
revoke execute on function public.set_user_verified(uuid, boolean) from anon;
revoke execute on function public.touch_seat(uuid) from public, anon;
revoke execute on function public.enforce_dm_rate_limit() from public, anon, authenticated;
revoke execute on function public.prune_ai_pipeline() from public, anon, authenticated;
