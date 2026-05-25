-- =============================================================================
-- Storage bucket: profile-avatars
--
-- Layout file: avatars/{user_id}/{timestamp}.jpg
--
-- Policy:
--   * SELECT bebas (avatar harus bisa diakses lewat URL publik).
--   * INSERT/UPDATE/DELETE hanya untuk authenticated user, dan path harus
--     diawali "avatars/{auth.uid()}/" — user lain tidak bisa
--     mengubah/menghapus avatar orang.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "profile-avatars-public-read" on storage.objects;
create policy "profile-avatars-public-read"
on storage.objects
for select
using (bucket_id = 'profile-avatars');

drop policy if exists "profile-avatars-owner-insert" on storage.objects;
create policy "profile-avatars-owner-insert"
on storage.objects
for insert
with check (
  bucket_id = 'profile-avatars'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "profile-avatars-owner-update" on storage.objects;
create policy "profile-avatars-owner-update"
on storage.objects
for update
using (
  bucket_id = 'profile-avatars'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "profile-avatars-owner-delete" on storage.objects;
create policy "profile-avatars-owner-delete"
on storage.objects
for delete
using (
  bucket_id = 'profile-avatars'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = auth.uid()::text
);
