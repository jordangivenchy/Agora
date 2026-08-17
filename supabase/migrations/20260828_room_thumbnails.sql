-- Room thumbnails: hosts may pick a cover image for their room's card.
-- Cards fall back to the host's profile picture when unset.
-- Applied to the live DB on 2026-08-16 (session: display names / thumbnails).

alter table public.debate_rooms add column if not exists thumbnail_url text;

-- Public bucket, mirroring the avatars bucket's per-user-folder policies.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

drop policy if exists "thumbnails public read" on storage.objects;
create policy "thumbnails public read" on storage.objects
  for select using (bucket_id = 'thumbnails');

drop policy if exists "thumbnails upload own folder" on storage.objects;
create policy "thumbnails upload own folder" on storage.objects
  for insert with check (
    bucket_id = 'thumbnails'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists "thumbnails update own folder" on storage.objects;
create policy "thumbnails update own folder" on storage.objects
  for update using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists "thumbnails delete own folder" on storage.objects;
create policy "thumbnails delete own folder" on storage.objects
  for delete using (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
