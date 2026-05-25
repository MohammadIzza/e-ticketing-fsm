-- =============================================================================
-- Storage bucket: report-photos
--
-- Layout file: reports/{user_id}/{timestamp}.jpg
--
-- Policy:
--   * SELECT bebas (foto laporan public-read agar URL bisa dibuka langsung).
--   * INSERT hanya owner (path harus "reports/{auth.uid()}/...").
--   * DELETE owner ATAU superadmin (untuk moderasi).
--   * UPDATE tidak diperlukan (foto laporan tidak diedit).
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "report-photos-public-read" on storage.objects;
create policy "report-photos-public-read"
on storage.objects
for select
using (bucket_id = 'report-photos');

drop policy if exists "report-photos-owner-insert" on storage.objects;
create policy "report-photos-owner-insert"
on storage.objects
for insert
with check (
  bucket_id = 'report-photos'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = 'reports'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "report-photos-owner-or-admin-delete" on storage.objects;
create policy "report-photos-owner-or-admin-delete"
on storage.objects
for delete
using (
  bucket_id = 'report-photos'
  and (
    (
      auth.uid() is not null
      and (storage.foldername(name))[1] = 'reports'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or public.is_superadmin()
  )
);
