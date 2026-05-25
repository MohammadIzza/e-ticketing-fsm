-- =============================================================================
-- 0014_realtime_replica_identity.sql
--
-- Hardening Supabase Realtime untuk fitur notifikasi:
--
--   1. ALTER TABLE ... REPLICA IDENTITY FULL pada reports dan
--      report_status_history.
--
--      Tanpa ini, payload `old` di event UPDATE hanya berisi primary key,
--      sehingga client tidak dapat membandingkan status sebelumnya secara
--      reliable. Dengan REPLICA IDENTITY FULL, semua kolom row lama ikut
--      dikirim oleh replikasi logical → classifyTransition di
--      useReportNotifications dapat mendeteksi transisi status dengan tepat
--      (mis. 'ditugaskan' → 'diselesaikan').
--
--      Cost: write amplification minor pada UPDATE/DELETE (Postgres harus
--      menulis full old-row ke WAL). Aman untuk volume laporan harian yang
--      kecil di project ini.
--
--   2. Pastikan tabel public.reports DAN public.report_status_history
--      keduanya terdaftar di publication `supabase_realtime`. 0012 sudah
--      mencoba menambahkan reports; di sini kita re-assert untuk re-run
--      Bootstrap dan tambahkan report_status_history sebagai sumber event
--      yang lebih granular (setiap perubahan status memasukkan satu row
--      baru lewat trigger log_report_status_change).
--
-- Idempoten: aman dijalankan ulang oleh workflow Bootstrap.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) REPLICA IDENTITY FULL
-- ---------------------------------------------------------------------------

alter table public.reports replica identity full;
alter table public.report_status_history replica identity full;

-- ---------------------------------------------------------------------------
-- 2) Re-assert kedua tabel ada di publication supabase_realtime.
--
-- Bungkus dengan exception handler supaya re-run pada self-hosted yang
-- belum punya publication tetap silent (tidak menggagalkan Bootstrap).
-- ---------------------------------------------------------------------------

do $$
declare
  v_t text;
  v_tables text[] := array['reports', 'report_status_history'];
begin
  foreach v_t in array v_tables loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_t
    ) then
      begin
        execute format(
          'alter publication supabase_realtime add table public.%I',
          v_t
        );
        raise notice 'Added public.% to supabase_realtime publication', v_t;
      exception when others then
        raise notice 'Skip add public.% to publication: %', v_t, SQLERRM;
      end;
    else
      raise notice 'public.% already in supabase_realtime publication', v_t;
    end if;
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 3) Sanity-check
-- ---------------------------------------------------------------------------

do $$
declare
  v_reports_ri char;
  v_history_ri char;
begin
  select c.relreplident into v_reports_ri
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reports';
  select c.relreplident into v_history_ri
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'report_status_history';

  -- 'f' = FULL, 'd' = DEFAULT, 'n' = NOTHING, 'i' = INDEX
  if coalesce(v_reports_ri, 'd') <> 'f' then
    raise warning '0014: reports.replica_identity bukan FULL (= %), notifikasi mungkin tidak akurat',
      v_reports_ri;
  end if;
  if coalesce(v_history_ri, 'd') <> 'f' then
    raise warning '0014: report_status_history.replica_identity bukan FULL (= %)',
      v_history_ri;
  end if;
  raise notice '0014_realtime_replica_identity applied (reports=%, history=%)',
    v_reports_ri, v_history_ri;
end$$;
