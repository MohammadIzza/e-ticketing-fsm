-- =============================================================================
-- 0016_fix_assignees_recursion.sql
--
-- Memperbaiki bug "infinite recursion detected in policy for relation
-- 'reports'" / "... 'report_assignees'" yang muncul setelah migrasi
-- 0015_multi_assignees.sql.
--
-- Akar masalah:
--   * Policy `reports_select_self_or_management` pada `public.reports`
--     melakukan EXISTS ke `public.report_assignees`.
--   * Policy `ra_select_visibility` pada `public.report_assignees`
--     melakukan EXISTS balik ke `public.reports`.
--   * Setiap subquery memicu evaluasi policy tabel lain — Postgres
--     mendeteksi siklus dan membatalkan query dengan error
--     "infinite recursion detected in policy for relation ...".
--
--     Akibatnya:
--       - RPC `report_stats_for_me` (security invoker, membaca reports)
--         gagal → "Statistik tidak dapat dimuat".
--       - SELECT langsung ke `report_assignees` dari klien juga gagal.
--       - SELECT ke `report_status_history` ikut gagal karena
--         `rsh_select_visibility` mengandung pola yang sama.
--
-- Strategi perbaikan:
--   Tambahkan helper SECURITY DEFINER kecil yang menjawab pertanyaan
--   lintas-tabel (siapa pemilik laporan, siapa primary assignee,
--   apa kategori laporan, apakah user X ada di pivot petugas).
--   Helper SECURITY DEFINER milik role `postgres` (BYPASSRLS) tidak
--   memicu RLS — sama seperti pola yang sudah dipakai oleh
--   `is_superadmin()`, `is_petugas()`, `is_pimpinan()`,
--   `can_pimpinan_handle_category()`.
--
--   Policy lalu di-rewrite untuk memanggil helper tersebut, sehingga
--   tidak ada lagi cross-table EXISTS antar tabel yang sama-sama
--   ber-RLS.
--
-- Idempotent — aman dijalankan ulang lewat workflow Bootstrap.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper SECURITY DEFINER (bypass RLS via owner postgres)
-- ---------------------------------------------------------------------------

create or replace function public.report_owner_id(p_report_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.reports where id = p_report_id;
$$;

create or replace function public.report_primary_assignee(p_report_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select assigned_to from public.reports where id = p_report_id;
$$;

create or replace function public.report_category_of(p_report_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select category_id from public.reports where id = p_report_id;
$$;

create or replace function public.is_report_assignee(
  p_report_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.report_assignees
     where report_id = p_report_id
       and assignee_id = p_user_id
  );
$$;

revoke all on function public.report_owner_id(uuid) from public;
revoke all on function public.report_primary_assignee(uuid) from public;
revoke all on function public.report_category_of(uuid) from public;
revoke all on function public.is_report_assignee(uuid, uuid) from public;

grant execute on function public.report_owner_id(uuid) to authenticated;
grant execute on function public.report_primary_assignee(uuid) to authenticated;
grant execute on function public.report_category_of(uuid) to authenticated;
grant execute on function public.is_report_assignee(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Policy reports SELECT — pakai is_report_assignee() (bukan EXISTS)
-- ---------------------------------------------------------------------------

drop policy if exists reports_select_self_or_management on public.reports;
create policy reports_select_self_or_management on public.reports
  for select using (
    auth.uid() = user_id
    or public.is_superadmin()
    or (
      public.is_petugas()
      and (
        assigned_to = auth.uid()
        or public.is_report_assignee(reports.id, auth.uid())
      )
    )
    or (
      public.is_pimpinan()
      and public.can_pimpinan_handle_category(auth.uid(), category_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Policy report_assignees SELECT — pakai helper, bukan EXISTS reports
-- ---------------------------------------------------------------------------

drop policy if exists ra_select_visibility on public.report_assignees;
create policy ra_select_visibility on public.report_assignees
  for select using (
    -- Petugas yang bersangkutan selalu bisa melihat barisnya sendiri.
    assignee_id = auth.uid()
    or public.is_superadmin()
    -- Pemilik laporan (pelapor) boleh melihat siapa saja yang ditugaskan.
    or public.report_owner_id(report_id) = auth.uid()
    -- Petugas yang jadi primary assignee (legacy reports.assigned_to).
    or (
      public.is_petugas()
      and public.report_primary_assignee(report_id) = auth.uid()
    )
    -- Pimpinan yang jabatannya cocok dengan kategori laporan.
    or (
      public.is_pimpinan()
      and public.can_pimpinan_handle_category(
        auth.uid(),
        public.report_category_of(report_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Policy report_status_history SELECT — selaraskan, tanpa EXISTS reports
-- ---------------------------------------------------------------------------

drop policy if exists rsh_select_visibility on public.report_status_history;
create policy rsh_select_visibility on public.report_status_history
  for select using (
    public.is_superadmin()
    or public.report_owner_id(report_id) = auth.uid()
    or (
      public.is_petugas()
      and (
        public.report_primary_assignee(report_id) = auth.uid()
        or public.is_report_assignee(report_id, auth.uid())
      )
    )
    or (
      public.is_pimpinan()
      and public.can_pimpinan_handle_category(
        auth.uid(),
        public.report_category_of(report_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Sanity-check
-- ---------------------------------------------------------------------------

do $$
declare
  v_helpers int;
  v_policies int;
begin
  select count(*) into v_helpers
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'report_owner_id',
       'report_primary_assignee',
       'report_category_of',
       'is_report_assignee'
     );

  select count(*) into v_policies
    from pg_policies
   where schemaname = 'public'
     and policyname in (
       'reports_select_self_or_management',
       'ra_select_visibility',
       'rsh_select_visibility'
     );

  if v_helpers < 4 then
    raise exception '0016: helper functions missing (found %)', v_helpers;
  end if;
  if v_policies < 3 then
    raise exception '0016: policies missing (found %)', v_policies;
  end if;
  raise notice '0016_fix_assignees_recursion applied — helpers=%, policies=%',
    v_helpers, v_policies;
end$$;
