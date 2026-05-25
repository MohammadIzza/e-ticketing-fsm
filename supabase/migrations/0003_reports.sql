-- =============================================================================
-- Reports table — laporan sekarang disimpan di Supabase per user.
--
-- Tabel public.reports:
--   - id          : uuid primary key
--   - user_id     : pemilik laporan (FK ke profiles.id, cascade)
--   - photo_url   : URL foto di bucket report-photos (public)
--   - description : keterangan
--   - created_at  : waktu dibuat
--
-- Helper:
--   public.is_superadmin() - SECURITY DEFINER, dipakai oleh policy untuk
--   memberi superadmin akses baca semua row tanpa harus mengubah RLS
--   manual setiap tabel.
--
-- RLS:
--   reports.SELECT  : owner OR superadmin
--   reports.INSERT  : owner saja (auth.uid = user_id)
--   reports.DELETE  : owner OR superadmin
--   profiles.SELECT : superadmin juga (untuk halaman "Laporan Semua User")
-- =============================================================================

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles
     where user_id = auth.uid()
       and role = 'superadmin'
  );
$$;

revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to anon, authenticated;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  photo_url text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists reports_user_id_idx
  on public.reports (user_id);
create index if not exists reports_created_at_idx
  on public.reports (created_at desc);

alter table public.reports enable row level security;

drop policy if exists reports_select_self_or_admin on public.reports;
create policy reports_select_self_or_admin on public.reports
  for select
  using (auth.uid() = user_id or public.is_superadmin());

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports
  for insert
  with check (auth.uid() = user_id);

drop policy if exists reports_delete_self_or_admin on public.reports;
create policy reports_delete_self_or_admin on public.reports
  for delete
  using (auth.uid() = user_id or public.is_superadmin());

-- Tambahan policy: superadmin boleh membaca semua profil (untuk
-- menampilkan info pelapor di halaman "Laporan Semua User").
drop policy if exists profiles_select_superadmin on public.profiles;
create policy profiles_select_superadmin on public.profiles
  for select
  using (public.is_superadmin());
