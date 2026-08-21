-- ============================================================
-- 20260817_agora_moderator.sql
--
-- Live Moderator mode: a room-level switch that lets Agora participate
-- proactively — dropping in relevant facts (interjection kind 'context')
-- and moderating the exchange (kind 'insight') — on top of the existing
-- fact-check corrections. Toggled by the room host from the Agora panel;
-- the existing "Hosts can update their rooms" RLS policy authorizes the
-- write, and debate_rooms is already in the realtime publication, so all
-- clients see the switch flip live.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

alter table public.debate_rooms
  add column if not exists agora_moderator boolean not null default false;

comment on column public.debate_rooms.agora_moderator is
  'When true, Agora acts as a live moderator: proactive context drops and moderation nudges via agora_interjections, paced by claim_interjection_slot.';
