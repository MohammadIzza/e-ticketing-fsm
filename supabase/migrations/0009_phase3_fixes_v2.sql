-- =============================================================================
-- Phase 3 — Fix-up v2 (idempotent, bulletproof)
--
-- Migration 0008 sudah meng-handle dua bug:
--   (a) report_history_with_actors → "column reference 'id' is ambiguous"
--   (b) Dashboard statistik (RPC report_stats_for_me)
--
-- Tetapi pengguna melaporkan kedua masalah masih muncul. Kemungkinan
-- penyebab: 0008 tidak ter-apply karena state aneh (mis. signature
-- function lama masih hidup, atau bootstrap workflow gagal di tengah).
--
-- Migration ini me-RE-ASSERT kedua perbaikan dengan sangat defensif:
--   * Drop SEMUA overload dari report_history_with_actors (apapun
--     argumen-nya) sebelum membuat versi baru — supaya tidak ada
--     overload lama yang mengambang.
--   * Drop & recreate report_stats_for_me dengan tipe yang sudah
--     stabil + GRANT yang benar.
--   * Tambah RAISE NOTICE supaya log bootstrap menunjukkan apply OK.
--
-- Aman dijalankan ulang berkali-kali (idempotent).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Bersihkan SEMUA overload dari report_history_with_actors
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  cnt int := 0;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'report_history_with_actors'
  loop
    execute format(
      'drop function public.report_history_with_actors(%s);',
      r.args
    );
    cnt := cnt + 1;
  end loop;
  raise notice 'Dropped % overload(s) of report_history_with_actors', cnt;
end$$;

-- Recreate dengan signature yang dipakai frontend.
create function public.report_history_with_actors(p_report_id uuid)
returns table(
  history_id uuid,
  history_status text,
  history_changed_at timestamptz,
  history_note text,
  history_changed_by uuid,
  changer_full_name text,
  changer_email text,
  changer_username text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
begin
  -- "where id = p_report_id" tidak ambiguous lagi karena OUT params kita
  -- sudah pakai prefix history_*.
  select * into v_report from public.reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Laporan tidak ditemukan';
  end if;
  if not (
    v_report.user_id = auth.uid()
    or public.is_superadmin()
    or (public.is_petugas() and v_report.assigned_to = auth.uid())
    or (public.is_pimpinan()
        and public.can_pimpinan_handle_category(auth.uid(), v_report.category_id))
  ) then
    raise exception 'Anda tidak diizinkan melihat laporan ini';
  end if;

  return query
  select
    h.id,
    h.status::text,
    h.changed_at,
    h.note,
    h.changed_by,
    p.full_name,
    p.email,
    p.username
  from public.report_status_history h
  left join public.profiles p on p.id = h.changed_by
  where h.report_id = p_report_id
  order by h.changed_at asc;
end;
$$;

revoke all on function public.report_history_with_actors(uuid) from public;
grant execute on function public.report_history_with_actors(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Bersihkan SEMUA overload dari report_stats_for_me, lalu recreate
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  cnt int := 0;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'report_stats_for_me'
  loop
    execute format(
      'drop function public.report_stats_for_me(%s);',
      r.args
    );
    cnt := cnt + 1;
  end loop;
  raise notice 'Dropped % overload(s) of report_stats_for_me', cnt;
end$$;

-- Pakai PL/pgSQL agar mudah di-debug & explicit return shape.
create function public.report_stats_for_me()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total bigint;
  v_dikirim bigint;
  v_diterima bigint;
  v_ditugaskan bigint;
  v_diselesaikan bigint;
  v_pending bigint;
  v_overdue bigint;
  v_hari_ini bigint;
begin
  -- RLS otomatis menyaring rows yang dapat dibaca caller.
  select
    count(*),
    count(*) filter (where status = 'dikirim'),
    count(*) filter (where status = 'diterima'),
    count(*) filter (where status = 'ditugaskan'),
    count(*) filter (where status = 'diselesaikan'),
    count(*) filter (
      where status = 'diselesaikan' and pending_verification = true
    ),
    count(*) filter (
      where status <> 'diselesaikan'
        and sla_due_at is not null
        and sla_due_at < now()
    ),
    count(*) filter (where created_at >= date_trunc('day', now()))
  into
    v_total, v_dikirim, v_diterima, v_ditugaskan, v_diselesaikan,
    v_pending, v_overdue, v_hari_ini
  from public.reports;

  return jsonb_build_object(
    'total',                 v_total,
    'dikirim',               v_dikirim,
    'diterima',              v_diterima,
    'ditugaskan',            v_ditugaskan,
    'diselesaikan',          v_diselesaikan,
    'pending_verification',  v_pending,
    'overdue',               v_overdue,
    'hari_ini',              v_hari_ini
  );
end;
$$;

revoke all on function public.report_stats_for_me() from public;
grant execute on function public.report_stats_for_me() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Sanity-check log
-- ---------------------------------------------------------------------------

do $$
declare
  has_history boolean;
  has_stats boolean;
begin
  select exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'report_history_with_actors'
      and pg_get_function_identity_arguments(p.oid) = 'p_report_id uuid'
  ) into has_history;

  select exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'report_stats_for_me'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) into has_stats;

  raise notice 'phase3-fixes-v2: report_history_with_actors=%  report_stats_for_me=%',
    has_history, has_stats;

  if not has_history then
    raise exception 'phase3-fixes-v2: report_history_with_actors NOT created';
  end if;
  if not has_stats then
    raise exception 'phase3-fixes-v2: report_stats_for_me NOT created';
  end if;
end$$;
