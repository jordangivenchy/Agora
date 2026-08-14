-- Agora Stage roles: host-curated speaking, Discord-Stage-like but Agora's own.
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Additive: new columns on existing tables + one new table.
--
-- Model:
--   debate_participants.stage_role — 'host' | 'cohost' | 'speaker' | 'audience'
--     The stage hierarchy is orthogonal to the debate role (debater/spectator):
--     a spectator can be promoted to 'speaker' without becoming a debater.
--     Hosts originate from configuration (room creation, scheduled setup,
--     pre-event co-host invites) — not minted arbitrarily mid-session.
--   debate_rooms.speaker_requests_locked — host can freeze raised hands.
--   stage_invites — consent flow: a host invites, the invitee accepts or
--     declines ("Alex has invited you to join the discussion").

-- ── Columns ────────────────────────────────────────────────────────────────
alter table public.debate_participants
  add column if not exists stage_role text not null default 'audience'
    check (stage_role in ('host', 'cohost', 'speaker', 'audience'));

alter table public.debate_rooms
  add column if not exists speaker_requests_locked boolean not null default false;

-- Backfill: the room creator is a host; existing debaters are speakers.
update public.debate_participants p
set stage_role = 'host'
from public.debate_rooms r
where p.room_id = r.id
  and p.user_id = r.host_id
  and p.stage_role = 'audience';

update public.debate_participants
set stage_role = 'speaker'
where role = 'debater'
  and stage_role = 'audience';

-- ── Host check (security definer avoids RLS self-recursion) ────────────────
create or replace function public.is_stage_host(p_room uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.debate_rooms r
    where r.id = p_room and r.host_id = auth.uid()
  )
  or exists (
    select 1 from public.debate_participants p
    where p.room_id = p_room
      and p.user_id = auth.uid()
      and p.stage_role in ('host', 'cohost')
      and p.left_at is null
  );
$$;

-- Hosts and co-hosts manage the room's participants: approve hands, promote
-- to speaker, mute, return to audience, remove from the space.
drop policy if exists "stage hosts manage room participants" on public.debate_participants;
create policy "stage hosts manage room participants"
  on public.debate_participants for update
  using (public.is_stage_host(room_id))
  with check (public.is_stage_host(room_id));

-- ── Invites ────────────────────────────────────────────────────────────────
create table if not exists public.stage_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.debate_rooms(id) on delete cascade,
  inviter_id uuid not null references public.users(id) on delete cascade,
  invitee_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists stage_invites_invitee_pending
  on public.stage_invites (invitee_id, room_id)
  where status = 'pending';

alter table public.stage_invites enable row level security;

drop policy if exists "invitee and hosts can read invites" on public.stage_invites;
create policy "invitee and hosts can read invites"
  on public.stage_invites for select
  using (invitee_id = auth.uid() or public.is_stage_host(room_id));

drop policy if exists "hosts send invites as themselves" on public.stage_invites;
create policy "hosts send invites as themselves"
  on public.stage_invites for insert
  with check (inviter_id = auth.uid() and public.is_stage_host(room_id));

drop policy if exists "invitee responds; hosts revoke" on public.stage_invites;
create policy "invitee responds; hosts revoke"
  on public.stage_invites for update
  using (invitee_id = auth.uid() or public.is_stage_host(room_id))
  with check (invitee_id = auth.uid() or public.is_stage_host(room_id));

-- Realtime: invitees hear their invite arrive live.
do $$
begin
  alter publication supabase_realtime add table public.stage_invites;
exception
  when others then null; -- publication missing or table already added
end $$;
