-- =============================================================================
-- 0015_multi_assignees.sql
--
-- Penugasan ke banyak petugas (maksimum 10 per laporan), dengan catatan
-- opsional per-petugas. Sebelum migrasi ini sebuah laporan hanya bisa
-- ditugaskan ke 1 user lewat kolom reports.assigned_to.
--
-- Perubahan utama:
--   1. Tabel baru `public.report_assignees(report_id, assignee_id, note,
--      assigned_at, assigned_by)` dengan UNIQUE(report_id, assignee_id) +
--      trigger BEFORE INSERT yang membatasi maksimum 10 petugas/laporan.
--
--   2. Backfill: setiap row reports.assigned_to non-null disalin ke
--      tabel pivot supaya UI multi-petugas konsisten dengan data lama.
--
--   3. Kolom legacy `reports.assigned_to` DIPERTAHANKAN sebagai "primary
--      assignee" untuk backward compat (komponen lain, realtime payload,
--      filter daftar petugas-only). Ketika multi-assign dilakukan,
--      assigned_to = petugas pertama dari list. Ketika daftar dikosongkan,
--      assigned_to = null dan status balik ke 'diterima'.
--
--   4. RPC baru `report_assign_multi(p_report_id uuid, p_assignees jsonb)`
--      menerima array `[{id: uuid, note: text}]`. Atomic: hapus seluruh
--      assignment lama lalu insert ulang. Validasi semua user adalah
--      petugas, dan hanya pimpinan-yang-cocok-jabatan / superadmin yang
--      boleh memanggil.
--
--   5. RPC lama `report_assign(p_report_id, p_assignee uuid)` di-rewrite
--      sebagai wrapper di atas report_assign_multi (single-assignee).
--
--   6. RPC `report_mark_done` diperluas: petugas mana pun di
--      report_assignees boleh menandai selesai (selain legacy
--      assigned_to dan superadmin).
--
--   7. RPC `report_mark_received` (self-executable path) sekarang juga
--      memasukkan pelapor ke report_assignees, supaya konsisten
--      dengan model multi.
--
--   8. RPC baru `report_list_assignees(p_report_id uuid)` SECURITY DEFINER
--      mengembalikan daftar petugas + nama + WA + catatan untuk
--      ditampilkan di sisi pelapor (yang RLS profiles-nya tidak
--      meng-grant baca profil orang lain) maupun manajemen.
--
--   9. RLS reports SELECT diperluas: petugas dapat melihat laporan
--      yang dia ada di report_assignees (selain legacy assigned_to).
--      RLS report_status_history disesuaikan dengan logika yang sama.
--
--  10. Tambahkan report_assignees ke publication supabase_realtime +
--      REPLICA IDENTITY FULL supaya client dapat berlangganan event
--      INSERT (notifikasi "Anda baru ditugaskan").
--
-- Aman dijalankan ulang (idempotent).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabel report_assignees
-- ---------------------------------------------------------------------------

create table if not exists public.report_assignees (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  unique (report_id, assignee_id)
);

create index if not exists report_assignees_report_id_idx
  on public.report_assignees (report_id);
create index if not exists report_assignees_assignee_id_idx
  on public.report_assignees (assignee_id);

alter table public.report_assignees enable row level security;

-- RLS: hanya SELECT (penulisan via RPC SECURITY DEFINER). Scope sama
-- dengan reports.
drop policy if exists ra_select_visibility on public.report_assignees;
create policy ra_select_visibility on public.report_assignees
  for select using (
    exists (
      select 1 from public.reports r
       where r.id = report_id
         and (
           r.user_id = auth.uid()
           or public.is_superadmin()
           or (public.is_petugas()
               and (r.assigned_to = auth.uid()
                    or assignee_id = auth.uid()))
           or (public.is_pimpinan()
               and public.can_pimpinan_handle_category(auth.uid(), r.category_id))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Trigger: maksimum 10 petugas per laporan
-- ---------------------------------------------------------------------------

create or replace function public.enforce_report_assignees_limit()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.report_assignees
   where report_id = NEW.report_id;
  if v_count >= 10 then
    raise exception 'Maksimum 10 petugas per laporan';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_report_assignees_limit on public.report_assignees;
create trigger trg_report_assignees_limit
before insert on public.report_assignees
for each row execute function public.enforce_report_assignees_limit();

-- ---------------------------------------------------------------------------
-- 3) Backfill dari reports.assigned_to lama
-- ---------------------------------------------------------------------------

insert into public.report_assignees (report_id, assignee_id, note, assigned_at, assigned_by)
select r.id, r.assigned_to, null, coalesce(r.updated_at, r.created_at), null
  from public.reports r
 where r.assigned_to is not null
   and not exists (
     select 1 from public.report_assignees ra
      where ra.report_id = r.id and ra.assignee_id = r.assigned_to
   );

-- ---------------------------------------------------------------------------
-- 4) RLS reports SELECT — extend petugas scope ke pivot
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
        or exists (
          select 1 from public.report_assignees ra
           where ra.report_id = reports.id and ra.assignee_id = auth.uid()
        )
      )
    )
    or (
      public.is_pimpinan()
      and public.can_pimpinan_handle_category(auth.uid(), category_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5) RLS report_status_history — selaraskan
-- ---------------------------------------------------------------------------

drop policy if exists rsh_select_visibility on public.report_status_history;
create policy rsh_select_visibility on public.report_status_history
  for select using (
    exists (
      select 1 from public.reports r
       where r.id = report_id
         and (
           r.user_id = auth.uid()
           or public.is_superadmin()
           or (public.is_petugas()
               and (r.assigned_to = auth.uid()
                    or exists (
                      select 1 from public.report_assignees ra
                       where ra.report_id = r.id and ra.assignee_id = auth.uid()
                    )))
           or (public.is_pimpinan()
               and public.can_pimpinan_handle_category(auth.uid(), r.category_id))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 6) RPC report_assign_multi(p_report_id, p_assignees jsonb)
--    p_assignees: jsonb array `[{id: uuid, note?: text}, ...]`.
-- ---------------------------------------------------------------------------

create or replace function public.report_assign_multi(
  p_report_id uuid,
  p_assignees jsonb
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
  v_existing public.reports;
  v_cat uuid;
  v_count int;
  v_first_id uuid;
  v_caller uuid := auth.uid();
  v_item jsonb;
  v_id uuid;
  v_note text;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if p_assignees is null or jsonb_typeof(p_assignees) <> 'array' then
    raise exception 'Daftar petugas tidak valid';
  end if;
  v_count := jsonb_array_length(p_assignees);
  if v_count < 1 then
    raise exception 'Pilih minimal 1 petugas';
  end if;
  if v_count > 10 then
    raise exception 'Maksimum 10 petugas per laporan';
  end if;

  select * into v_existing from public.reports where id = p_report_id;
  if v_existing.id is null then
    raise exception 'Laporan tidak ditemukan';
  end if;
  v_cat := v_existing.category_id;

  if not (
    public.is_superadmin()
    or (public.is_pimpinan()
        and public.can_pimpinan_handle_category(v_caller, v_cat))
  ) then
    raise exception 'Anda tidak diizinkan menugaskan laporan ini (jabatan tidak cocok dengan jenis laporan)';
  end if;

  -- Validasi: semua id valid dan punya role 'petugas', tidak ada duplikat.
  declare
    v_seen uuid[] := '{}';
  begin
    for v_item in select * from jsonb_array_elements(p_assignees) loop
      v_id := nullif(v_item->>'id', '')::uuid;
      if v_id is null then
        raise exception 'ID petugas tidak valid pada salah satu item';
      end if;
      if v_id = any(v_seen) then
        raise exception 'Petugas yang sama dipilih lebih dari sekali';
      end if;
      v_seen := array_append(v_seen, v_id);
      if not exists (
        select 1 from public.user_roles
         where user_id = v_id and role = 'petugas'
      ) then
        raise exception 'User % bukan petugas', v_id;
      end if;
    end loop;
  end;

  -- Replace assignment secara atomik.
  delete from public.report_assignees where report_id = p_report_id;

  v_first_id := null;
  for v_item in select * from jsonb_array_elements(p_assignees) loop
    v_id := (v_item->>'id')::uuid;
    v_note := nullif(trim(coalesce(v_item->>'note', '')), '');
    insert into public.report_assignees(report_id, assignee_id, note, assigned_by)
      values (p_report_id, v_id, v_note, v_caller);
    if v_first_id is null then
      v_first_id := v_id;
    end if;
  end loop;

  -- Update reports: status='ditugaskan' (kalau masih dikirim/diterima)
  -- dan legacy assigned_to = first item supaya filter list petugas-only
  -- + payload realtime tetap kompatibel.
  if v_existing.status in ('dikirim', 'diterima') then
    update public.reports
       set status = 'ditugaskan',
           assigned_to = v_first_id
     where id = p_report_id
     returning * into v_row;
  else
    -- Sudah 'ditugaskan' / 'diselesaikan': re-assignment tanpa mengubah
    -- status. Tetap update legacy assigned_to + log ke history sebagai
    -- penanda perubahan penugasan.
    update public.reports
       set assigned_to = v_first_id,
           updated_at = now()
     where id = p_report_id
     returning * into v_row;
    if v_row.id is not null and v_existing.status = 'ditugaskan' then
      insert into public.report_status_history (report_id, status, changed_by, note)
        values (p_report_id, v_row.status, v_caller, 'Penugasan diperbarui');
    end if;
  end if;

  if v_row.id is null then
    raise exception 'Gagal memperbarui laporan';
  end if;
  return v_row;
end;
$$;

revoke all on function public.report_assign_multi(uuid, jsonb) from public;
grant execute on function public.report_assign_multi(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) RPC report_assign(uuid, uuid) — re-implement sebagai wrapper.
-- ---------------------------------------------------------------------------

create or replace function public.report_assign(
  p_report_id uuid,
  p_assignee uuid
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.report_assign_multi(
    p_report_id,
    jsonb_build_array(jsonb_build_object('id', p_assignee))
  );
end;
$$;

revoke all on function public.report_assign(uuid, uuid) from public;
grant execute on function public.report_assign(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) RPC report_mark_done — terima setiap multi-assignee.
-- ---------------------------------------------------------------------------

-- Drop overload (uuid, text, text) supaya bersih.
do $$
declare r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'report_mark_done'
  loop
    execute format('drop function public.report_mark_done(%s);', r.args);
  end loop;
end$$;

create function public.report_mark_done(
  p_report_id uuid,
  p_note text default null,
  p_photo_url text default null
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
  v_pending boolean;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(c.requires_pimpinan_verification, false)
    into v_pending
    from public.reports r
    left join public.categories c on c.id = r.category_id
   where r.id = p_report_id;

  update public.reports r
     set status = 'diselesaikan',
         completion_note = nullif(trim(coalesce(p_note, '')), ''),
         completion_photo_url = nullif(trim(coalesce(p_photo_url, '')), ''),
         pending_verification = coalesce(v_pending, false),
         verified_at = null,
         verified_by = null
   where r.id = p_report_id
     and r.status = 'ditugaskan'
     and (
       r.assigned_to = v_caller
       or exists (
         select 1 from public.report_assignees ra
          where ra.report_id = r.id and ra.assignee_id = v_caller
       )
       or public.is_superadmin()
     )
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Laporan tidak ditemukan, status bukan "ditugaskan", atau Anda bukan petugas yang ditugaskan';
  end if;

  if v_row.completion_note is not null then
    update public.report_status_history
       set note = v_row.completion_note
     where report_id = v_row.id
       and status = 'diselesaikan'
       and changed_at = (
         select max(changed_at)
           from public.report_status_history
          where report_id = v_row.id
            and status = 'diselesaikan'
       );
  end if;

  return v_row;
end;
$$;

revoke all on function public.report_mark_done(uuid, text, text) from public;
grant execute on function public.report_mark_done(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) report_mark_received self-executable: insert juga ke pivot.
--    Patch ringan: kalau status berubah ke 'ditugaskan' dengan
--    assigned_to=v_owner (self-executable), pastikan owner ada di
--    report_assignees.
-- ---------------------------------------------------------------------------

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
  v_caller uuid := auth.uid();
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
        and public.can_pimpinan_handle_category(v_caller, v_cat))
  ) then
    raise exception 'Anda tidak diizinkan menerima laporan ini (jabatan tidak cocok dengan jenis laporan)';
  end if;

  if v_self then
    update public.reports
       set status = 'ditugaskan',
           assigned_to = v_owner
     where id = p_report_id
       and status = 'dikirim'
     returning * into v_row;
    if v_row.id is not null then
      -- Pastikan owner masuk ke pivot juga (idempotent via UNIQUE).
      insert into public.report_assignees(report_id, assignee_id, assigned_by)
        values (p_report_id, v_owner, v_caller)
        on conflict (report_id, assignee_id) do nothing;
    end if;
  else
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

revoke all on function public.report_mark_received(uuid) from public;
grant execute on function public.report_mark_received(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) RPC report_list_assignees — mengembalikan multi-petugas + WA + note.
--     SECURITY DEFINER agar pelapor (owner) yang RLS profiles-nya tidak
--     mengizinkan baca profil orang lain tetap dapat melihat nama & WA
--     petugas yang ditugaskan.
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'report_list_assignees'
  loop
    execute format('drop function public.report_list_assignees(%s);', r.args);
  end loop;
end$$;

create function public.report_list_assignees(p_report_id uuid)
returns table(
  assignment_id uuid,
  assignee_id uuid,
  username text,
  email text,
  full_name text,
  avatar_url text,
  wa_number text,
  note text,
  assigned_at timestamptz,
  assigned_by uuid
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
  if not (
    v_report.user_id = auth.uid()
    or public.is_superadmin()
    or (public.is_petugas()
        and (v_report.assigned_to = auth.uid()
             or exists (select 1 from public.report_assignees ra
                         where ra.report_id = p_report_id and ra.assignee_id = auth.uid())))
    or (public.is_pimpinan()
        and public.can_pimpinan_handle_category(auth.uid(), v_report.category_id))
  ) then
    raise exception 'Anda tidak diizinkan melihat penugasan laporan ini';
  end if;

  return query
    select ra.id, p.id, p.username, p.email, p.full_name, p.avatar_url,
           p.wa_number, ra.note, ra.assigned_at, ra.assigned_by
      from public.report_assignees ra
      join public.profiles p on p.id = ra.assignee_id
     where ra.report_id = p_report_id
     order by ra.assigned_at asc;
end;
$$;

revoke all on function public.report_list_assignees(uuid) from public;
grant execute on function public.report_list_assignees(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) Realtime: replica identity full + tambahkan ke publication
-- ---------------------------------------------------------------------------

alter table public.report_assignees replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'report_assignees'
  ) then
    begin
      execute 'alter publication supabase_realtime add table public.report_assignees';
      raise notice 'Added public.report_assignees to supabase_realtime publication';
    exception when others then
      raise notice 'Skip add public.report_assignees to publication: %', SQLERRM;
    end;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 12) Sanity-check
-- ---------------------------------------------------------------------------

do $$
declare
  v_has_table boolean;
  v_has_rpc boolean;
begin
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'report_assignees'
  ) into v_has_table;

  select exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'report_assign_multi'
  ) into v_has_rpc;

  if not v_has_table then
    raise exception '0015: tabel report_assignees tidak terbentuk';
  end if;
  if not v_has_rpc then
    raise exception '0015: RPC report_assign_multi tidak terbentuk';
  end if;
  raise notice '0015_multi_assignees applied — table=%, rpc_multi=%', v_has_table, v_has_rpc;
end$$;
