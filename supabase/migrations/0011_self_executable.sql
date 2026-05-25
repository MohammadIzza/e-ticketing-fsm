-- ============================================================================
-- 0011_self_executable.sql
--
-- Tambahan kriteria jenis laporan: "bisa dikerjakan sendiri" (self-executable).
--
-- Konsep:
--   Pada jenis laporan tertentu, pekerjaan tidak perlu diperantarai oleh
--   petugas terpisah — pelapor dapat menyelesaikan sendiri laporannya.
--   Ketika pimpinan menekan "Terima" pada laporan jenis ini, sistem
--   otomatis melompati langkah penugasan dan langsung mengeset:
--     status      = 'ditugaskan'
--     assigned_to = user_id pelapor
--   Sehingga pelapor langsung dapat menekan "Selesaikan" pada halaman
--   Detail Laporan.
--
-- Catatan keamanan:
--   * report_mark_done sudah mengizinkan caller = assigned_to (atau
--     superadmin), jadi pelapor yang assigned_to=auth.uid() dapat
--     memanggil RPC tersebut tanpa perubahan tambahan di sisi DB.
--   * Verifikasi pimpinan (requires_pimpinan_verification) tetap
--     berlaku jika kategori juga di-flag perlu verifikasi.
--
-- Idempotent — aman dijalankan ulang oleh workflow Bootstrap.
-- ============================================================================

-- 1) Kolom flag di kategori.
alter table public.categories
  add column if not exists self_executable boolean not null default false;

-- 2) Override report_mark_received agar memperhatikan flag tersebut.
--    create or replace aman karena signature (uuid) tidak berubah.
create or replace function public.report_mark_received(p_report_id uuid)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.reports;
  v_cat    uuid;
  v_owner  uuid;
  v_self   boolean;
begin
  select r.category_id,
         r.user_id,
         coalesce(c.self_executable, false)
    into v_cat, v_owner, v_self
    from public.reports r
    left join public.categories c on c.id = r.category_id
   where r.id = p_report_id;

  if v_cat is null and v_owner is null then
    raise exception 'Laporan tidak ditemukan';
  end if;

  if not (
    public.is_superadmin()
    or (public.is_pimpinan()
        and public.can_pimpinan_handle_category(auth.uid(), v_cat))
  ) then
    raise exception 'Anda tidak diizinkan menerima laporan ini (jabatan tidak cocok dengan jenis laporan)';
  end if;

  if v_self then
    -- Self-executable: skip 'diterima', langsung 'ditugaskan' ke pelapor.
    update public.reports
       set status = 'ditugaskan',
           assigned_to = v_owner
     where id = p_report_id
       and status = 'dikirim'
     returning * into v_row;
  else
    -- Alur normal: 'dikirim' → 'diterima'.
    update public.reports
       set status = 'diterima'
     where id = p_report_id
       and status = 'dikirim'
     returning * into v_row;
  end if;

  if v_row.id is null then
    raise exception 'Laporan tidak ditemukan atau status sudah lewat dari "dikirim"';
  end if;
  return v_row;
end;
$$;

-- Permissions tidak berubah (signature tetap (uuid)), tapi kita refresh
-- supaya migrasi ini aman dijalankan di clean DB juga.
revoke all on function public.report_mark_received(uuid) from public;
grant execute on function public.report_mark_received(uuid) to authenticated;

-- 3) Sanity-check.
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'categories'
     and column_name = 'self_executable';
  if v_count <> 1 then
    raise exception 'Kolom categories.self_executable tidak terbentuk';
  end if;
  raise notice '0011_self_executable.sql applied — categories.self_executable ada, report_mark_received di-update.';
end$$;
