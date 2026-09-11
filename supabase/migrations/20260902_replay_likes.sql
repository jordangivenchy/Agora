-- Likes on past discussions (the recorded rooms), the way a video is
-- liked: one per account, toggled. replay_like_state says where the
-- viewer stands and how many there are; toggle_replay_like flips it.

create table if not exists public.replay_likes (
  room_id uuid not null references public.debate_rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.replay_likes enable row level security;
drop policy if exists "replay likes are readable" on public.replay_likes;
create policy "replay likes are readable" on public.replay_likes for select using (true);
drop policy if exists "like as yourself" on public.replay_likes;
create policy "like as yourself" on public.replay_likes for insert with check (auth.uid() = user_id);
drop policy if exists "unlike as yourself" on public.replay_likes;
create policy "unlike as yourself" on public.replay_likes for delete using (auth.uid() = user_id);
create index if not exists replay_likes_room_idx on public.replay_likes (room_id);

create or replace function public.replay_like_state(p_room uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', (select count(*) from public.replay_likes where room_id = p_room),
    'liked', exists (select 1 from public.replay_likes where room_id = p_room and user_id = auth.uid())
  );
$$;

create or replace function public.toggle_replay_like(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_liked boolean;
begin
  if auth.uid() is null then raise exception 'sign in to like' using errcode = '42501'; end if;
  if public.is_suspended(auth.uid()) then raise exception 'suspended accounts cannot like' using errcode = '42501'; end if;
  if not exists (select 1 from public.debate_rooms where id = p_room and status = 'ended') then
    raise exception 'only a past discussion can be liked';
  end if;
  if exists (select 1 from public.replay_likes where room_id = p_room and user_id = auth.uid()) then
    delete from public.replay_likes where room_id = p_room and user_id = auth.uid();
    v_liked := false;
  else
    insert into public.replay_likes (room_id, user_id) values (p_room, auth.uid());
    v_liked := true;
  end if;
  return jsonb_build_object('liked', v_liked, 'count', (select count(*) from public.replay_likes where room_id = p_room));
end $$;
revoke all on function public.toggle_replay_like(uuid) from public, anon;
grant execute on function public.toggle_replay_like(uuid) to authenticated;
