-- =============================================================================
-- 0006 — Report geolocation
--
-- Tambah info posisi GPS pada laporan untuk verifikasi & klasifikasi.
-- Kolom opsional: lokasi tetap dipakai walaupun perangkat / izin browser
-- tidak menyediakan koordinat.
--
-- - latitude, longitude  : DOUBLE PRECISION (WGS84 derajat desimal)
-- - accuracy_m           : DOUBLE PRECISION, akurasi horizontal (meter)
-- - geo_captured_at      : TIMESTAMPTZ, waktu posisi diambil (client clock)
-- =============================================================================

alter table public.reports
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists accuracy_m double precision,
  add column if not exists geo_captured_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_latitude_range'
  ) then
    alter table public.reports
      add constraint reports_latitude_range
      check (latitude is null or (latitude between -90 and 90));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_longitude_range'
  ) then
    alter table public.reports
      add constraint reports_longitude_range
      check (longitude is null or (longitude between -180 and 180));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_accuracy_nonnegative'
  ) then
    alter table public.reports
      add constraint reports_accuracy_nonnegative
      check (accuracy_m is null or accuracy_m >= 0);
  end if;
end$$;

create index if not exists reports_geo_idx
  on public.reports (latitude, longitude)
  where latitude is not null and longitude is not null;
