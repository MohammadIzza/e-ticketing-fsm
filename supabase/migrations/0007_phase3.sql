-- =============================================================================
-- Phase 3 — Jabatan, Jenis Pelapor, Kriteria Laporan, SLA, Bukti Penyelesaian
--
-- Rangkuman perubahan:
--   1. Tabel public.positions          : daftar jabatan (untuk role 'pimpinan').
--   2. Tabel public.reporter_types     : daftar jenis pelapor.
--   3. profiles diperluas              : position_id, reporter_type_id.
--   4. categories diperluas            : requires_pimpinan_verification.
--   5. category_sla_options            : opsi SLA (jam) per jenis laporan.
--   6. category_positions              : M:N — jabatan pimpinan mana yang
--                                        boleh menerima/menugaskan laporan
--                                        kategori tersebut.
--   7. reports diperluas               : sla_option_id, sla_due_at,
--                                        completion_note, completion_photo_url,
--                                        verified_at, verified_by,
--                                        pending_verification.
--   8. report_status_history           : kolom note bisa diisi via RPC selesai.
--   9. RLS reports                     : petugas hanya bisa SELECT laporan
--                                        yang assigned_to dirinya;
--                                        pimpinan hanya laporan yang
--                                        category-nya cocok dengan jabatannya.
--  10. RPC baru                        : report_verify, admin_set_position,
--                                        admin_set_reporter_type,
--                                        admin_set_category_positions,
--                                        admin_set_category_sla_options,
--                                        admin_list_users (extended),
--                                        list_pimpinan_for_category, dsb.
--  11. RPC report_mark_done diperluas  : terima catatan + URL foto bukti.
--  12. Index untuk performance         : reports.sla_due_at, assigned_to,
--                                        category_id, profiles.position_id, dst.
--
-- Aman dijalankan ulang (idempotent).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) positions (jabatan)
-- ---------------------------------------------------------------------------

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists positions_set_updated_at on public.positions;
create trigger positions_set_updated_at
before update on public.positions
for each row execute function public.touch_updated_at();

alter table public.positions enable row level security;

drop policy if exists positions_select_all on public.positions;
create policy positions_select_all on public.positions
  for select to authenticated using (true);

drop policy if exists positions_write_admin on public.positions;
create policy positions_write_admin on public.positions
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 2) reporter_types (jenis pelapor)
-- ---------------------------------------------------------------------------

create table if not exists public.reporter_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists reporter_types_set_updated_at on public.reporter_types;
create trigger reporter_types_set_updated_at
before update on public.reporter_types
for each row execute function public.touch_updated_at();

alter table public.reporter_types enable row level security;

drop policy if exists reporter_types_select_all on public.reporter_types;
create policy reporter_types_select_all on public.reporter_types
  for select to authenticated using (true);

drop policy if exists reporter_types_write_admin on public.reporter_types;
create policy reporter_types_write_admin on public.reporter_types
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 3) profiles: position_id + reporter_type_id
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists position_id uuid,
  add column if not exists reporter_type_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_position_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_position_fkey
      foreign key (position_id) references public.positions(id) on delete set null;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_reporter_type_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_reporter_type_fkey
      foreign key (reporter_type_id) references public.reporter_types(id) on delete set null;
  end if;
end$$;

create index if not exists profiles_position_id_idx
  on public.profiles (position_id) where position_id is not null;
create index if not exists profiles_reporter_type_id_idx
  on public.profiles (reporter_type_id) where reporter_type_id is not null;

-- ---------------------------------------------------------------------------
-- 4) categories: kriteria
-- ---------------------------------------------------------------------------

alter table public.categories
  add column if not exists requires_pimpinan_verification boolean not null default false;

-- ---------------------------------------------------------------------------
-- 5) category_sla_options
-- ---------------------------------------------------------------------------

create table if not exists public.category_sla_options (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  hours integer not null check (hours > 0),
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists csla_category_id_idx
  on public.category_sla_options (category_id, sort_order);

alter table public.category_sla_options enable row level security;

drop policy if exists csla_select_all on public.category_sla_options;
create policy csla_select_all on public.category_sla_options
  for select to authenticated using (true);

drop policy if exists csla_write_admin on public.category_sla_options;
create policy csla_write_admin on public.category_sla_options
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 6) category_positions
-- ---------------------------------------------------------------------------

create table if not exists public.category_positions (
  category_id uuid not null references public.categories(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  primary key (category_id, position_id)
);

create index if not exists cpos_position_id_idx
  on public.category_positions (position_id);

alter table public.category_positions enable row level security;

drop policy if exists cpos_select_all on public.category_positions;
create policy cpos_select_all on public.category_positions
  for select to authenticated using (true);

drop policy if exists cpos_write_admin on public.category_positions;
create policy cpos_write_admin on public.category_positions
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 7) reports: SLA + bukti penyelesaian + verifikasi
-- ---------------------------------------------------------------------------

alter table public.reports
  add column if not exists sla_option_id uuid,
  add column if not exists sla_due_at timestamptz,
  add column if not exists completion_note text,
  add column if not exists completion_photo_url text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid,
  add column if not exists pending_verification boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_sla_option_fkey'
  ) then
    alter table public.reports
      add constraint reports_sla_option_fkey
      foreign key (sla_option_id) references public.category_sla_options(id)
      on delete set null;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_verified_by_fkey'
  ) then
    alter table public.reports
      add constraint reports_verified_by_fkey
      foreign key (verified_by) references public.profiles(id) on delete set null;
  end if;
end$$;

create index if not exists reports_sla_due_at_idx
  on public.reports (sla_due_at) where sla_due_at is not null;
create index if not exists reports_status_assigned_idx
  on public.reports (status, assigned_to);
create index if not exists reports_status_category_idx
  on public.reports (status, category_id);

-- BEFORE INSERT trigger: hitung sla_due_at dari sla_option_id (kalau ada).
create or replace function public.compute_report_sla_due()
returns trigger
language plpgsql
as $$
begin
  if new.sla_option_id is not null and new.sla_due_at is null then
    select coalesce(new.created_at, now()) + (so.hours::text || ' hours')::interval
      into new.sla_due_at
      from public.category_sla_options so
     where so.id = new.sla_option_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reports_compute_sla on public.reports;
create trigger trg_reports_compute_sla
before insert on public.reports
for each row execute function public.compute_report_sla_due();

-- ---------------------------------------------------------------------------
-- 8) Helper: cek apakah pimpinan boleh handle category tertentu.
--    Kalau category belum punya restriction (category_positions kosong),
--    semua pimpinan diizinkan (backward compat dengan data lama).
-- ---------------------------------------------------------------------------

create or replace function public.can_pimpinan_handle_category(
  p_user_id uuid,
  p_category_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p_category_id is null then true
      when not exists (
        select 1 from public.category_positions
         where category_id = p_category_id
      ) then true
      else exists (
        select 1
          from public.category_positions cp
          join public.profiles p on p.id = p_user_id
         where cp.category_id = p_category_id
           and cp.position_id = p.position_id
      )
    end;
$$;

revoke all on function public.can_pimpinan_handle_category(uuid, uuid) from public;
grant execute on function public.can_pimpinan_handle_category(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) RLS reports: scope ulang untuk petugas (assigned_to) dan pimpinan (jabatan)
-- ---------------------------------------------------------------------------

drop policy if exists reports_select_self_or_management on public.reports;
create policy reports_select_self_or_management on public.reports
  for select using (
    auth.uid() = user_id
    or public.is_superadmin()
    or (
      public.is_petugas()
      and assigned_to = auth.uid()
    )
    or (
      public.is_pimpinan()
      and public.can_pimpinan_handle_category(auth.uid(), category_id)
    )
  );

-- profiles: pimpinan/petugas tetap perlu lihat profil pelapor & assignee untuk
-- tampilan list. Ditambah: pelapor (user) lain tidak bisa lihat.
drop policy if exists profiles_select_management on public.profiles;
create policy profiles_select_management on public.profiles
  for select using (public.is_pimpinan() or public.is_petugas());

-- ---------------------------------------------------------------------------
-- 10) Status transition RPCs (rewrite)
-- ---------------------------------------------------------------------------

-- a) Mark received: pimpinan harus punya jabatan yang cocok dengan category
create or replace function public.report_mark_received(p_report_id uuid)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
  v_cat uuid;
begin
  select category_id into v_cat from public.reports where id = p_report_id;
  if not (
    public.is_superadmin()
    or (public.is_pimpinan()
        and public.can_pimpinan_handle_category(auth.uid(), v_cat))
  ) then
    raise exception 'Anda tidak diizinkan menerima laporan ini (jabatan tidak cocok dengan jenis laporan)';
  end if;

  update public.reports
     set status = 'diterima'
   where id = p_report_id
     and status = 'dikirim'
   returning * into v_row;
  if v_row.id is null then
    raise exception 'Laporan tidak ditemukan atau status sudah lewat dari "dikirim"';
  end if;
  return v_row;
end;
$$;

-- b) Assign
create or replace function public.report_assign(
  p_report_id uuid,
  p_assignee uuid
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
  v_cat uuid;
begin
  select category_id into v_cat from public.reports where id = p_report_id;
  if not (
    public.is_superadmin()
    or (public.is_pimpinan()
        and public.can_pimpinan_handle_category(auth.uid(), v_cat))
  ) then
    raise exception 'Anda tidak diizinkan menugaskan laporan ini (jabatan tidak cocok dengan jenis laporan)';
  end if;

  if not exists (
    select 1 from public.user_roles
     where user_id = p_assignee and role = 'petugas'
  ) then
    raise exception 'User tujuan tidak memiliki role petugas';
  end if;

  update public.reports
     set status = 'ditugaskan',
         assigned_to = p_assignee
   where id = p_report_id
     and status in ('dikirim', 'diterima')
   returning * into v_row;
  if v_row.id is null then
    raise exception 'Laporan tidak ditemukan atau status tidak valid untuk ditugaskan';
  end if;
  return v_row;
end;
$$;

-- c) Mark done — sekarang menerima catatan + URL foto bukti.
--    Kalau category.requires_pimpinan_verification=true, set
--    pending_verification=true sehingga pimpinan masih perlu verifikasi.

-- Drop signature lama (uuid) supaya tidak ambigu dengan signature baru.
do $$
begin
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'report_mark_done'
      and pg_get_function_identity_arguments(p.oid) = 'p_report_id uuid'
  ) then
    drop function public.report_mark_done(uuid);
  end if;
end$$;

create or replace function public.report_mark_done(
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
begin
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
     and (r.assigned_to = auth.uid() or public.is_superadmin())
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Laporan tidak ditemukan, status bukan "ditugaskan", atau Anda bukan petugas yang ditugaskan';
  end if;

  -- Catatan ke history (kalau ada).
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

-- d) Verify (pimpinan): hanya kalau category.requires_pimpinan_verification.
create or replace function public.report_verify(p_report_id uuid)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
  v_cat uuid;
begin
  select category_id into v_cat from public.reports where id = p_report_id;
  if not (
    public.is_superadmin()
    or (public.is_pimpinan()
        and public.can_pimpinan_handle_category(auth.uid(), v_cat))
  ) then
    raise exception 'Anda tidak diizinkan memverifikasi laporan ini';
  end if;

  update public.reports
     set pending_verification = false,
         verified_at = now(),
         verified_by = auth.uid()
   where id = p_report_id
     and status = 'diselesaikan'
     and pending_verification = true
   returning * into v_row;
  if v_row.id is null then
    raise exception 'Laporan tidak ditemukan, belum selesai, atau sudah diverifikasi';
  end if;
  return v_row;
end;
$$;

revoke all on function public.report_mark_received(uuid) from public;
revoke all on function public.report_assign(uuid, uuid) from public;
revoke all on function public.report_mark_done(uuid, text, text) from public;
revoke all on function public.report_verify(uuid) from public;
grant execute on function public.report_mark_received(uuid) to authenticated;
grant execute on function public.report_assign(uuid, uuid) to authenticated;
grant execute on function public.report_mark_done(uuid, text, text) to authenticated;
grant execute on function public.report_verify(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) Admin RPCs (extended) — assign position, reporter type, dll.
-- ---------------------------------------------------------------------------

-- admin_list_users — extended to include position + reporter_type.
drop function if exists public.admin_list_users();

create or replace function public.admin_list_users()
returns table(
  id uuid,
  email text,
  full_name text,
  username text,
  avatar_url text,
  created_at timestamptz,
  roles text[],
  position_id uuid,
  position_name text,
  reporter_type_id uuid,
  reporter_type_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin';
  end if;
  return query
  select
    p.id,
    p.email,
    p.full_name,
    p.username,
    p.avatar_url,
    p.created_at,
    coalesce(
      (select array_agg(ur.role order by ur.role)
         from public.user_roles ur
        where ur.user_id = p.id),
      array[]::text[]
    ) as roles,
    p.position_id,
    pos.name as position_name,
    p.reporter_type_id,
    rt.name as reporter_type_name
  from public.profiles p
  left join public.positions pos on pos.id = p.position_id
  left join public.reporter_types rt on rt.id = p.reporter_type_id
  order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_set_position(
  p_user_id uuid,
  p_position_id uuid
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
  update public.profiles
     set position_id = p_position_id
   where id = p_user_id;
end;
$$;

create or replace function public.admin_set_reporter_type(
  p_user_id uuid,
  p_reporter_type_id uuid
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
  update public.profiles
     set reporter_type_id = p_reporter_type_id
   where id = p_user_id;
end;
$$;

create or replace function public.admin_set_category_positions(
  p_category_id uuid,
  p_position_ids uuid[]
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
  delete from public.category_positions where category_id = p_category_id;
  if p_position_ids is not null and array_length(p_position_ids, 1) > 0 then
    insert into public.category_positions (category_id, position_id)
    select p_category_id, x
      from unnest(p_position_ids) as x
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.admin_set_category_sla_options(
  p_category_id uuid,
  p_options jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_idx int := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin';
  end if;
  delete from public.category_sla_options where category_id = p_category_id;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    return;
  end if;
  for v_item in select * from jsonb_array_elements(p_options) loop
    insert into public.category_sla_options (category_id, hours, label, sort_order)
    values (
      p_category_id,
      coalesce((v_item->>'hours')::int, 24),
      coalesce(nullif(trim(v_item->>'label'), ''), (coalesce((v_item->>'hours')::int, 24)::text || ' jam')),
      v_idx
    );
    v_idx := v_idx + 1;
  end loop;
end;
$$;

revoke all on function public.admin_set_position(uuid, uuid) from public;
revoke all on function public.admin_set_reporter_type(uuid, uuid) from public;
revoke all on function public.admin_set_category_positions(uuid, uuid[]) from public;
revoke all on function public.admin_set_category_sla_options(uuid, jsonb) from public;
grant execute on function public.admin_set_position(uuid, uuid) to authenticated;
grant execute on function public.admin_set_reporter_type(uuid, uuid) to authenticated;
grant execute on function public.admin_set_category_positions(uuid, uuid[]) to authenticated;
grant execute on function public.admin_set_category_sla_options(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12) View pelengkap untuk pimpinan: hanya kategori yang mereka boleh handle.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_handled_categories()
returns table(
  id uuid,
  name text,
  description text,
  is_active boolean,
  requires_pimpinan_verification boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_pimpinan() or public.is_superadmin()) then
    raise exception 'Hanya pimpinan/superadmin';
  end if;
  return query
  select c.id, c.name, c.description, c.is_active, c.requires_pimpinan_verification
    from public.categories c
   where public.is_superadmin()
      or public.can_pimpinan_handle_category(auth.uid(), c.id)
   order by c.name;
end;
$$;

revoke all on function public.list_my_handled_categories() from public;
grant execute on function public.list_my_handled_categories() to authenticated;

-- ---------------------------------------------------------------------------
-- 13) Riwayat status + nama actor — RPC SECURITY DEFINER agar pelapor
--     (owner) tetap dapat melihat nama pimpinan/petugas yang mengubah status,
--     tanpa perlu memberi RLS profiles ke semua authenticated user.
--
-- IMPORTANT (bootstrap re-runs): 0008/0009 mengganti OUT-parameter row type
-- function ini dari (id, status, …) → (history_id, history_status, …).
-- PostgreSQL tidak mengizinkan mengubah return type lewat CREATE OR REPLACE,
-- jadi tanpa DROP defensif di sini, bootstrap kedua dst. akan gagal dengan:
--   "cannot change return type of existing function"
-- Kita drop SEMUA overload (apapun arg-nya) sebelum CREATE supaya idempoten.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
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
  end loop;
end$$;

create function public.report_history_with_actors(p_report_id uuid)
returns table(
  id uuid,
  status text,
  changed_at timestamptz,
  note text,
  changed_by uuid,
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
  select h.id, h.status, h.changed_at, h.note, h.changed_by,
         p.full_name, p.email, p.username
    from public.report_status_history h
    left join public.profiles p on p.id = h.changed_by
   where h.report_id = p_report_id
   order by h.changed_at asc;
end;
$$;

revoke all on function public.report_history_with_actors(uuid) from public;
grant execute on function public.report_history_with_actors(uuid) to authenticated;

-- Tighten rsh policy supaya selaras dengan scope reports.
drop policy if exists rsh_select_visibility on public.report_status_history;
create policy rsh_select_visibility on public.report_status_history
  for select using (
    exists (
      select 1 from public.reports r
       where r.id = report_id
         and (
           r.user_id = auth.uid()
           or public.is_superadmin()
           or (public.is_petugas() and r.assigned_to = auth.uid())
           or (public.is_pimpinan()
               and public.can_pimpinan_handle_category(auth.uid(), r.category_id))
         )
    )
  );
