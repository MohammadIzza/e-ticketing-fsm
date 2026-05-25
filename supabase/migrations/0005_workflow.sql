-- =============================================================================
-- Phase 2 — Workflow & Management
--
-- 1. Tabel public.categories (jenis laporan): superadmin only CRUD; pelapor
--    hanya melihat is_active = true.
-- 2. Tabel reports diperluas: status, category_id, assigned_to, updated_at.
-- 3. Tabel public.report_status_history untuk tracking timeline.
-- 4. Helper role functions (is_pimpinan, is_petugas).
-- 5. SECURITY DEFINER RPC untuk transisi status (terima / tugaskan / selesai)
--    + role grant/revoke + listing user untuk admin.
-- 6. RPC public.email_exists untuk pre-check pendaftaran (memberantas masalah
--    duplicate-email yang lolos lewat enumeration prevention Supabase).
-- 7. RLS update: pimpinan/petugas dapat SELECT semua report + profile.
--    DELETE laporan: owner hanya bila status='dikirim'; superadmin selalu.
-- 8. Backfill report_status_history dari row reports yang sudah ada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) email_exists RPC
-- ---------------------------------------------------------------------------

create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users
     where lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Helper role functions
-- ---------------------------------------------------------------------------

create or replace function public.is_pimpinan()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = auth.uid() and role = 'pimpinan'
  );
$$;

create or replace function public.is_petugas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = auth.uid() and role = 'petugas'
  );
$$;

revoke all on function public.is_pimpinan() from public;
revoke all on function public.is_petugas() from public;
grant execute on function public.is_pimpinan() to anon, authenticated;
grant execute on function public.is_petugas() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) categories
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.touch_updated_at();

alter table public.categories enable row level security;

drop policy if exists categories_select_all on public.categories;
create policy categories_select_all on public.categories
  for select to authenticated using (true);

drop policy if exists categories_write_admin on public.categories;
create policy categories_write_admin on public.categories
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 4) reports — extend
-- ---------------------------------------------------------------------------

alter table public.reports
  add column if not exists status text not null default 'dikirim',
  add column if not exists category_id uuid,
  add column if not exists assigned_to uuid,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_status_check'
  ) then
    alter table public.reports
      add constraint reports_status_check
      check (status in ('dikirim', 'diterima', 'ditugaskan', 'diselesaikan'));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_category_fkey'
  ) then
    alter table public.reports
      add constraint reports_category_fkey
      foreign key (category_id) references public.categories(id) on delete cascade;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_assigned_to_fkey'
  ) then
    alter table public.reports
      add constraint reports_assigned_to_fkey
      foreign key (assigned_to) references public.profiles(id) on delete set null;
  end if;
end$$;

create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_category_id_idx on public.reports (category_id);
create index if not exists reports_assigned_to_idx on public.reports (assigned_to);

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5) report_status_history (timeline)
-- ---------------------------------------------------------------------------

create table if not exists public.report_status_history (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  status text not null check (status in ('dikirim', 'diterima', 'ditugaskan', 'diselesaikan')),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  note text
);

create index if not exists rsh_report_id_idx on public.report_status_history (report_id);
create index if not exists rsh_changed_at_idx on public.report_status_history (changed_at desc);

alter table public.report_status_history enable row level security;

drop policy if exists rsh_select_visibility on public.report_status_history;
create policy rsh_select_visibility on public.report_status_history
  for select using (
    exists (
      select 1 from public.reports r
       where r.id = report_id
         and (
           r.user_id = auth.uid()
           or public.is_superadmin()
           or public.is_pimpinan()
           or public.is_petugas()
         )
    )
  );

create or replace function public.log_report_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT') then
    insert into public.report_status_history (report_id, status, changed_by)
    values (NEW.id, NEW.status, NEW.user_id);
  elsif (TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status) then
    insert into public.report_status_history (report_id, status, changed_by)
    values (NEW.id, NEW.status, coalesce(auth.uid(), NEW.user_id));
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_reports_status_history on public.reports;
create trigger trg_reports_status_history
after insert or update on public.reports
for each row execute function public.log_report_status_change();

insert into public.report_status_history (report_id, status, changed_by, changed_at)
select r.id, r.status, r.user_id, r.created_at
  from public.reports r
 where not exists (
   select 1 from public.report_status_history h where h.report_id = r.id
 );

-- ---------------------------------------------------------------------------
-- 6) RLS reports — sesuaikan
-- ---------------------------------------------------------------------------

drop policy if exists reports_select_self_or_admin on public.reports;
drop policy if exists reports_select_self_or_management on public.reports;
create policy reports_select_self_or_management on public.reports
  for select using (
    auth.uid() = user_id
    or public.is_superadmin()
    or public.is_pimpinan()
    or public.is_petugas()
  );

drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports
  for insert with check (auth.uid() = user_id);

drop policy if exists reports_delete_self_or_admin on public.reports;
drop policy if exists reports_delete_owner_or_admin on public.reports;
create policy reports_delete_owner_or_admin on public.reports
  for delete using (
    public.is_superadmin()
    or (auth.uid() = user_id and status = 'dikirim')
  );

drop policy if exists profiles_select_management on public.profiles;
create policy profiles_select_management on public.profiles
  for select using (public.is_pimpinan() or public.is_petugas());

drop policy if exists user_roles_select_superadmin on public.user_roles;
create policy user_roles_select_superadmin on public.user_roles
  for select using (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 7) Status transition RPCs
-- ---------------------------------------------------------------------------

create or replace function public.report_mark_received(p_report_id uuid)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
begin
  if not (public.is_pimpinan() or public.is_superadmin()) then
    raise exception 'Hanya pimpinan/superadmin yang dapat menerima laporan';
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
begin
  if not (public.is_pimpinan() or public.is_superadmin()) then
    raise exception 'Hanya pimpinan/superadmin yang dapat menugaskan laporan';
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

create or replace function public.report_mark_done(p_report_id uuid)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
begin
  update public.reports
     set status = 'diselesaikan'
   where id = p_report_id
     and status = 'ditugaskan'
     and (assigned_to = auth.uid() or public.is_superadmin())
   returning * into v_row;
  if v_row.id is null then
    raise exception 'Laporan tidak ditemukan, status bukan "ditugaskan", atau Anda bukan petugas yang ditugaskan';
  end if;
  return v_row;
end;
$$;

revoke all on function public.report_mark_received(uuid) from public;
revoke all on function public.report_assign(uuid, uuid) from public;
revoke all on function public.report_mark_done(uuid) from public;
grant execute on function public.report_mark_received(uuid) to authenticated;
grant execute on function public.report_assign(uuid, uuid) to authenticated;
grant execute on function public.report_mark_done(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Admin user-management RPCs
-- ---------------------------------------------------------------------------

-- Drop first so subsequent migrations can widen the return type without
-- "cannot change return type of existing function" errors on re-runs.
drop function if exists public.admin_list_users();

create or replace function public.admin_list_users()
returns table(
  id uuid,
  email text,
  full_name text,
  username text,
  avatar_url text,
  created_at timestamptz,
  roles text[]
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
    ) as roles
  from public.profiles p
  order by p.created_at desc;
end;
$$;

create or replace function public.admin_grant_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin';
  end if;
  if p_role not in ('pimpinan', 'petugas') then
    raise exception 'Role yang diizinkan hanya: pimpinan, petugas';
  end if;
  insert into public.user_roles (user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id, role) do nothing;
end;
$$;

create or replace function public.admin_revoke_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin';
  end if;
  if p_role not in ('pimpinan', 'petugas') then
    raise exception 'Role yang diizinkan hanya: pimpinan, petugas';
  end if;
  delete from public.user_roles
   where user_id = p_user_id and role = p_role;
end;
$$;

create or replace function public.list_petugas()
returns table(
  id uuid,
  full_name text,
  email text,
  username text,
  avatar_url text
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
  select p.id, p.full_name, p.email, p.username, p.avatar_url
    from public.profiles p
   inner join public.user_roles ur on ur.user_id = p.id
   where ur.role = 'petugas'
   order by p.full_name nulls last;
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_grant_role(uuid, text) from public;
revoke all on function public.admin_revoke_role(uuid, text) from public;
revoke all on function public.list_petugas() from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_grant_role(uuid, text) to authenticated;
grant execute on function public.admin_revoke_role(uuid, text) to authenticated;
grant execute on function public.list_petugas() to authenticated;
