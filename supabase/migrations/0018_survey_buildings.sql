-- =============================================================================
-- 0018_survey_buildings.sql
--
-- Revisi modul "Survey Aset":
--   1. Tabel `buildings` (Gedung) sebagai induk Ruangan.
--      Sebelumnya `rooms.building` cuma kolom teks bebas — sekarang
--      Ruangan bisa di-link ke baris Gedung (lewat `rooms.building_id`).
--      Kolom `rooms.building` lama dipertahankan untuk back-compat.
--   2. `asset_surveys` bisa scope ke Ruangan ATAU Gedung
--      (room_id NULL + building_id NOT NULL = survey gedung).
--      CHECK constraint memastikan tepat satu yang diisi.
--   3. RPC `survey_create` dimodifikasi: terima param baru
--      `p_building_id uuid` (default NULL). Kalau gedung, item survey
--      dibuat untuk semua aset di semua ruangan dalam gedung itu.
--
-- Idempotent: aman dijalankan ulang via Bootstrap.
-- Tidak menyentuh tabel/fungsi FSM LAPOR — hanya domain Survey Aset.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabel `buildings` (Gedung)
-- ---------------------------------------------------------------------------

create table if not exists public.buildings (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  address     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists buildings_set_updated_at on public.buildings;
create trigger buildings_set_updated_at
  before update on public.buildings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Pautkan rooms ke buildings (nullable; legacy text `building` tetap)
-- ---------------------------------------------------------------------------

alter table public.rooms
  add column if not exists building_id uuid
    references public.buildings(id) on delete set null;

create index if not exists rooms_building_id_idx
  on public.rooms(building_id);

-- ---------------------------------------------------------------------------
-- 3) asset_surveys: scope ruang ATAU gedung
-- ---------------------------------------------------------------------------

alter table public.asset_surveys
  alter column room_id drop not null;

alter table public.asset_surveys
  add column if not exists building_id uuid
    references public.buildings(id) on delete restrict;

create index if not exists asset_surveys_building_id_idx
  on public.asset_surveys(building_id);

-- Tepat salah satu dari (room_id, building_id) wajib diisi.
alter table public.asset_surveys
  drop constraint if exists asset_surveys_scope_chk;
alter table public.asset_surveys
  add constraint asset_surveys_scope_chk
  check (
    (room_id is not null and building_id is null)
    or (room_id is null and building_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 4) RLS untuk buildings
-- ---------------------------------------------------------------------------

alter table public.buildings enable row level security;

drop policy if exists buildings_select on public.buildings;
create policy buildings_select on public.buildings
  for select using (public.has_survey_access(auth.uid()));

drop policy if exists buildings_modify on public.buildings;
create policy buildings_modify on public.buildings
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.buildings to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: survey_create (versi baru)
--
-- Drop versi lama (text, uuid) supaya tidak ambigu dengan versi baru
-- (text, uuid, uuid). Kemudian recreate.
-- ---------------------------------------------------------------------------

drop function if exists public.survey_create(text, uuid);
drop function if exists public.survey_create(text, uuid, uuid);

create or replace function public.survey_create(
  p_title       text,
  p_room_id     uuid,
  p_building_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_survey_access(auth.uid()) then
    raise exception 'Anda tidak punya akses ke modul Survey Aset.';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Judul survey wajib diisi.';
  end if;

  if (p_room_id is null and p_building_id is null)
     or (p_room_id is not null and p_building_id is not null) then
    raise exception 'Pilih tepat satu scope: Ruangan ATAU Gedung.';
  end if;

  if p_room_id is not null and not exists (
    select 1 from public.rooms where id = p_room_id
  ) then
    raise exception 'Ruang tidak ditemukan.';
  end if;
  if p_building_id is not null and not exists (
    select 1 from public.buildings where id = p_building_id
  ) then
    raise exception 'Gedung tidak ditemukan.';
  end if;

  insert into public.asset_surveys(
    title, status, room_id, building_id, created_by
  ) values (
    p_title, 'draft', p_room_id, p_building_id, auth.uid()
  ) returning id into v_id;

  if p_room_id is not null then
    insert into public.asset_survey_items(survey_id, asset_id)
      select v_id, a.id from public.assets a where a.room_id = p_room_id;
  else
    insert into public.asset_survey_items(survey_id, asset_id)
      select v_id, a.id
        from public.assets a
        join public.rooms r on r.id = a.room_id
       where r.building_id = p_building_id;
  end if;

  return v_id;
end$$;

revoke all on function public.survey_create(text, uuid, uuid) from public;
grant execute on function public.survey_create(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Sanity check
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_buildings  int;
  v_has_building_col int;
  v_has_scope_chk  int;
  v_create_arity   int;
begin
  select count(*) into v_has_buildings
    from information_schema.tables
   where table_schema = 'public' and table_name = 'buildings';

  select count(*) into v_has_building_col
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'asset_surveys'
     and column_name = 'building_id';

  select count(*) into v_has_scope_chk
    from pg_constraint
   where conname = 'asset_surveys_scope_chk';

  select count(*) into v_create_arity
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'survey_create'
     and p.pronargs = 3;

  if v_has_buildings = 0 then
    raise exception '0018: tabel buildings tidak terbentuk';
  end if;
  if v_has_building_col = 0 then
    raise exception '0018: kolom asset_surveys.building_id tidak ada';
  end if;
  if v_has_scope_chk = 0 then
    raise exception '0018: constraint asset_surveys_scope_chk tidak ada';
  end if;
  if v_create_arity = 0 then
    raise exception '0018: survey_create(text,uuid,uuid) tidak terdefinisi';
  end if;

  raise notice '0018_survey_buildings applied — buildings ok, scope chk ok, survey_create/3 ok';
end$$;
