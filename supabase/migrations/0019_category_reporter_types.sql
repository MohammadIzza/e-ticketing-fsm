-- =============================================================================
-- 0019_category_reporter_types.sql
--
-- Item PR-A #2 — Kriteria jenis laporan: tentukan jenis pelapor mana saja
-- yang boleh memilih kategori tertentu saat membuat laporan.
--
-- Pola identik dengan `category_positions` (M:N kategori ↔ jabatan).
--   - Tabel relasi: public.category_reporter_types(category_id, reporter_type_id)
--   - RLS         : SELECT untuk semua authenticated (perlu dibaca pelapor
--                   untuk mem-filter dropdown), WRITE hanya superadmin.
--   - RPC         : admin_set_category_reporter_types(uuid, uuid[])
--                   — replace-all set untuk satu kategori.
--
-- Semantik filter (di-enforce di klien — tidak ada constraint server-side
-- yang melarang INSERT laporan dgn kategori "tidak diizinkan" karena pelapor
-- tetap berhak melihat semua categories.is_active untuk kompatibilitas):
--   * Bila kategori TIDAK punya baris di category_reporter_types → boleh
--     dipakai semua jenis pelapor (no restriction = open to all).
--   * Bila kategori PUNYA satu/lebih baris → hanya pelapor dengan
--     `profiles.reporter_type_id` IN list itu yang melihat kategori
--     tersebut di dropdown.
--
-- Idempotent: aman dijalankan ulang via Bootstrap.
-- Tidak menyentuh tabel/fungsi modul Survey Aset.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabel relasi
-- ---------------------------------------------------------------------------

create table if not exists public.category_reporter_types (
  category_id      uuid not null references public.categories(id)      on delete cascade,
  reporter_type_id uuid not null references public.reporter_types(id)  on delete cascade,
  primary key (category_id, reporter_type_id)
);

create index if not exists crt_reporter_type_id_idx
  on public.category_reporter_types (reporter_type_id);

-- ---------------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------------

alter table public.category_reporter_types enable row level security;

drop policy if exists crt_select_all on public.category_reporter_types;
create policy crt_select_all on public.category_reporter_types
  for select to authenticated using (true);

drop policy if exists crt_write_admin on public.category_reporter_types;
create policy crt_write_admin on public.category_reporter_types
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.category_reporter_types to authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPC: replace-all set (mirror admin_set_category_positions)
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_category_reporter_types(
  p_category_id      uuid,
  p_reporter_type_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin';
  end if;
  delete from public.category_reporter_types where category_id = p_category_id;
  if p_reporter_type_ids is not null
     and array_length(p_reporter_type_ids, 1) > 0 then
    insert into public.category_reporter_types (category_id, reporter_type_id)
    select p_category_id, x
      from unnest(p_reporter_type_ids) as x
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.admin_set_category_reporter_types(uuid, uuid[]) from public;
grant execute on function public.admin_set_category_reporter_types(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Sanity check
-- ---------------------------------------------------------------------------

do $$
declare
  v_table int;
  v_func  int;
  v_pols  int;
begin
  select count(*) into v_table
    from information_schema.tables
   where table_schema = 'public' and table_name = 'category_reporter_types';
  select count(*) into v_func
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'admin_set_category_reporter_types'
     and p.pronargs = 2;
  select count(*) into v_pols
    from pg_policies
   where schemaname = 'public'
     and tablename = 'category_reporter_types';

  if v_table = 0 then
    raise exception '0019: tabel category_reporter_types tidak terbentuk';
  end if;
  if v_func = 0 then
    raise exception '0019: RPC admin_set_category_reporter_types/2 tidak terdefinisi';
  end if;
  if v_pols < 2 then
    raise exception '0019: policy kurang (% dari 2)', v_pols;
  end if;
  raise notice '0019_category_reporter_types applied — table ok, rpc ok, policies=%', v_pols;
end$$;
