-- =============================================================================
-- 0013_report_assignee_contact.sql
--
-- Tambahkan RPC SECURITY DEFINER `report_assignee_contact(p_report_id uuid)`
-- supaya pelapor (owner laporan) dapat melihat informasi petugas yang
-- ditugaskan terhadap laporannya — termasuk nomor WhatsApp untuk kontak
-- selama proses pengerjaan.
--
-- Latar belakang:
--   * RLS public.profiles saat ini hanya mengizinkan SELECT bagi
--     pemilik baris itu sendiri (profiles_select_self) dan untuk role
--     manajemen (profiles_select_management → pimpinan/petugas/...).
--   * Pelapor murni bukan keduanya, sehingga ketika ReportDetail
--     mem-join `assignee:profiles!assigned_to(...)`, hasilnya null —
--     UI menampilkan "Belum ditugaskan" walaupun field `assigned_to`
--     sudah terisi di tabel reports.
--
-- RPC ini SECURITY DEFINER, mengembalikan kolom yang aman untuk
-- ditampilkan ke pelapor (id, username, email, full_name, avatar_url,
-- wa_number) dengan akses control:
--   * Pemanggil HARUS auth.uid() = reports.user_id (owner), atau
--   * superadmin (untuk konsistensi audit).
--
-- Aman dijalankan ulang (idempotent).
-- =============================================================================

-- Drop semua overload eksisting agar idempoten lintas re-run dan agar
-- perubahan return type ke depan tidak menabrak CREATE OR REPLACE.
do $$
declare
  r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'report_assignee_contact'
  loop
    execute format(
      'drop function public.report_assignee_contact(%s);',
      r.args
    );
  end loop;
end$$;

create function public.report_assignee_contact(p_report_id uuid)
returns table(
  id uuid,
  username text,
  email text,
  full_name text,
  avatar_url text,
  wa_number text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_report from public.reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Laporan tidak ditemukan';
  end if;

  -- Hanya pemilik laporan atau superadmin yang boleh memanggil.
  if v_report.user_id <> auth.uid() and not public.is_superadmin() then
    raise exception 'Anda tidak diizinkan melihat data petugas laporan ini';
  end if;

  -- Belum ada penugasan → return empty set (bukan error).
  if v_report.assigned_to is null then
    return;
  end if;

  return query
    select p.id, p.username, p.email, p.full_name, p.avatar_url, p.wa_number
      from public.profiles p
     where p.id = v_report.assigned_to;
end;
$$;

revoke all on function public.report_assignee_contact(uuid) from public;
grant execute on function public.report_assignee_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sanity-check: pastikan function terbentuk dengan signature yang benar.
-- ---------------------------------------------------------------------------
do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(p.oid)
    into v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'report_assignee_contact';
  if v_args is null then
    raise exception '0013: report_assignee_contact tidak terbentuk';
  end if;
  raise notice '0013_report_assignee_contact applied — args=(%)', v_args;
end$$;
