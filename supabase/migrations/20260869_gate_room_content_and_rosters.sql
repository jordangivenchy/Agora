-- Close world-readable private content (security audit, 2026-08-26).
--
-- room_messages (chat), debate_utterances (transcript), and
-- agora_interjections were "viewable by everyone" USING(true), so anyone
-- with a private followers/friends room's id could read its chat and
-- transcript without being admitted — defeating the room's access gate
-- for its content. Gate them by the same can_enter_room() predicate that
-- guards debate_rooms/debate_participants (short-circuits to true for
-- public and code-mode rooms, so this is a no-op for them).
--
-- community_members was "readable by everyone", letting anyone enumerate
-- the full membership + moderator roster of a PRIVATE community. Gate it
-- by community_visible() (plus your own rows), matching get_community_posts.

drop policy if exists "Room messages are viewable by everyone" on public.room_messages;
drop policy if exists "room messages readable when room enterable" on public.room_messages;
create policy "room messages readable when room enterable"
  on public.room_messages for select
  using ( public.can_enter_room(room_id, auth.uid()) );

drop policy if exists "utterances are viewable by everyone" on public.debate_utterances;
drop policy if exists "utterances readable when room enterable" on public.debate_utterances;
create policy "utterances readable when room enterable"
  on public.debate_utterances for select
  using ( public.can_enter_room(room_id, auth.uid()) );

drop policy if exists "interjections are viewable by everyone" on public.agora_interjections;
drop policy if exists "interjections readable when room enterable" on public.agora_interjections;
create policy "interjections readable when room enterable"
  on public.agora_interjections for select
  using ( public.can_enter_room(room_id, auth.uid()) );

drop policy if exists "members are readable by everyone" on public.community_members;
drop policy if exists "members readable when community visible" on public.community_members;
create policy "members readable when community visible"
  on public.community_members for select
  using ( public.community_visible(community_id, auth.uid()) or user_id = auth.uid() );
