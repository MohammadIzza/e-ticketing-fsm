-- =============================================================================
-- Phase 3 — Fix-up:
--   1) report_history_with_actors: bug "column reference 'id' is ambiguous".
--      OUT-parameter `id`/`status`/`changed_by` bentrok dengan kolom kandidat
--      pada SELECT. Solusi: rename OUT parameters dengan prefix `history_*`
--      dan cast `status::text` untuk menghindari masalah enum→text.
--      Frontend juga di-update mengikuti nama baru ini.
--   2) report_stats_for_me(): RPC baru — sekali round-trip mengembalikan
--      jumlah laporan per status / overdue / pending verification, dengan
--      RLS scope (pelapor=own, petugas=assigned, pimpinan=jabatan, admin=all).
--      Dipakai oleh dashboard pimpinan & superadmin tile.
--
-- Aman dijalankan ulang (idempotent).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Fix: report_history_with_actors
-- ---------------------------------------------------------------------------

drop function if exists public.report_history_with_actors(uuid);

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
-- 2) Stats RPC — scope-aware via RLS (security invoker).
-- ---------------------------------------------------------------------------

create or replace function public.report_stats_for_me()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with my_reports as (
    -- RLS otomatis batasi sesuai role pemanggil.
    select status::text as status,
           pending_verification,
           sla_due_at,
           assigned_to,
           created_at
      from public.reports
  ),
  base as (
    select
      count(*)                                         as total,
      count(*) filter (where status = 'dikirim')       as dikirim,
      count(*) filter (where status = 'diterima')      as diterima,
      count(*) filter (where status = 'ditugaskan')    as ditugaskan,
      count(*) filter (where status = 'diselesaikan')  as diselesaikan,
      count(*) filter (
        where status = 'diselesaikan' and pending_verification = true
      ) as pending_verification,
      count(*) filter (
        where status <> 'diselesaikan'
          and sla_due_at is not null
          and sla_due_at < now()
      ) as overdue,
      count(*) filter (
        where created_at >= date_trunc('day', now())
      ) as hari_ini
    from my_reports
  )
  select to_jsonb(base.*) from base;
$$;

revoke all on function public.report_stats_for_me() from public;
grant execute on function public.report_stats_for_me() to authenticated;
