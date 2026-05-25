-- =============================================================================
-- 0017_survey_aset.sql
--
-- Modul "Survey Aset" — pencatatan inventaris dan survey kondisi aset
-- per ruang. Terpisah penuh dari domain FSM LAPOR; satu-satunya jembatan
-- ke FSM LAPOR adalah RPC `survey_create_report_from_asset()` yang
-- INSERT ke `public.reports` lalu memautkan baris baru ke
-- `asset_survey_items.report_id`.
--
-- Idempotent: aman dijalankan ulang via workflow Bootstrap Supabase.
--
-- Tabel:
--   - survey_module_access     izin per-user untuk masuk modul
--   - room_types               jenis ruang (Kelas, Lab Komputer, Kantor, ...)
--   - room_type_asset_templates template aset default per jenis ruang
--   - rooms                    ruang konkret
--   - assets                   aset konkret yang menempel di ruang
--   - asset_surveys            instance survey
--   - asset_survey_items       checklist per aset per survey
--   - asset_history            log perubahan kondisi aset
--
-- Helper (SECURITY DEFINER, BYPASSRLS lewat ownership postgres):
--   - has_survey_access(uuid)  superadmin OR baris di survey_module_access
--
-- RPC publik (SECURITY DEFINER):
--   - survey_grant_access / survey_revoke_access (superadmin)
--   - survey_apply_template
--   - survey_create
--   - survey_save_item
--   - survey_mark_all_good
--   - survey_submit
--   - survey_validate
--   - survey_request_revision
--   - survey_create_report_from_asset
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabel
-- ---------------------------------------------------------------------------

create table if not exists public.survey_module_access (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  enabled     boolean not null default true,
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz not null default now()
);

create table if not exists public.room_types (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.room_type_asset_templates (
  id               uuid primary key default gen_random_uuid(),
  room_type_id     uuid not null references public.room_types(id) on delete cascade,
  asset_name       text not null,
  default_quantity integer not null default 1 check (default_quantity > 0),
  notes            text,
  created_at       timestamptz not null default now(),
  unique (room_type_id, asset_name)
);

create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,
  name         text not null,
  building     text,
  floor        text,
  room_type_id uuid references public.room_types(id) on delete set null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.assets (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.rooms(id) on delete cascade,
  name              text not null,
  code              text,
  current_condition text not null default 'baik'
                    check (current_condition in (
                      'baik','rusak_ringan','rusak_berat',
                      'tidak_ditemukan','perlu_diganti')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists assets_room_id_idx on public.assets(room_id);

create table if not exists public.asset_surveys (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  status          text not null default 'draft'
                  check (status in (
                    'draft','in_progress','submitted',
                    'needs_revision','validated')),
  room_id         uuid not null references public.rooms(id) on delete restrict,
  created_by      uuid not null references auth.users(id),
  validator_id    uuid references auth.users(id),
  validation_note text,
  validated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists asset_surveys_status_idx
  on public.asset_surveys(status);
create index if not exists asset_surveys_room_id_idx
  on public.asset_surveys(room_id);
create index if not exists asset_surveys_created_by_idx
  on public.asset_surveys(created_by);

create table if not exists public.asset_survey_items (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null references public.asset_surveys(id) on delete cascade,
  asset_id    uuid not null references public.assets(id) on delete cascade,
  condition   text check (condition in (
                'baik','rusak_ringan','rusak_berat',
                'tidak_ditemukan','perlu_diganti')),
  note        text,
  photo_url   text,
  report_id   uuid references public.reports(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (survey_id, asset_id)
);
create index if not exists asset_survey_items_survey_idx
  on public.asset_survey_items(survey_id);

create table if not exists public.asset_history (
  id                  uuid primary key default gen_random_uuid(),
  asset_id            uuid not null references public.assets(id) on delete cascade,
  survey_id           uuid references public.asset_surveys(id) on delete set null,
  previous_condition  text,
  new_condition       text,
  changed_by          uuid references auth.users(id),
  note                text,
  changed_at          timestamptz not null default now()
);
create index if not exists asset_history_asset_idx
  on public.asset_history(asset_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- 2) Trigger: auto-update updated_at
-- ---------------------------------------------------------------------------
-- public.touch_updated_at() sudah ada (didefinisikan di 0001_init.sql).

drop trigger if exists room_types_set_updated_at on public.room_types;
create trigger room_types_set_updated_at
  before update on public.room_types
  for each row execute function public.touch_updated_at();

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.touch_updated_at();

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.touch_updated_at();

drop trigger if exists asset_surveys_set_updated_at on public.asset_surveys;
create trigger asset_surveys_set_updated_at
  before update on public.asset_surveys
  for each row execute function public.touch_updated_at();

drop trigger if exists asset_survey_items_set_updated_at on public.asset_survey_items;
create trigger asset_survey_items_set_updated_at
  before update on public.asset_survey_items
  for each row execute function public.touch_updated_at();

-- Trigger: assets.current_condition berubah → catat history
create or replace function public.assets_log_condition_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.current_condition is distinct from old.current_condition then
    insert into public.asset_history(
      asset_id, previous_condition, new_condition, changed_by, note
    ) values (
      new.id, old.current_condition, new.current_condition,
      auth.uid(),
      'auto-logged on assets.current_condition update'
    );
  end if;
  return new;
end$$;

drop trigger if exists assets_log_condition_change on public.assets;
create trigger assets_log_condition_change
  after update on public.assets
  for each row execute function public.assets_log_condition_change();

-- ---------------------------------------------------------------------------
-- 3) Helper SECURITY DEFINER untuk RLS (mengikuti pola is_superadmin/dst.)
-- ---------------------------------------------------------------------------

create or replace function public.has_survey_access(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_user, auth.uid()) is not null
     and (
       public.is_superadmin()
       or exists (
         select 1 from public.survey_module_access
         where user_id = coalesce(p_user, auth.uid())
           and enabled = true
       )
     );
$$;

revoke all on function public.has_survey_access(uuid) from public;
grant execute on function public.has_survey_access(uuid) to authenticated;

-- Helper: pengakses bisa "menulis" item survey kalau dia creator survey
-- dan survey belum di-submit / sedang revisi. Bypass RLS untuk hindari
-- recursion ke asset_surveys.
create or replace function public.survey_is_writable_by(
  p_survey_id uuid,
  p_user      uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.asset_surveys s
    where s.id = p_survey_id
      and s.created_by = coalesce(p_user, auth.uid())
      and s.status in ('draft','in_progress','needs_revision')
  );
$$;

revoke all on function public.survey_is_writable_by(uuid, uuid) from public;
grant execute on function public.survey_is_writable_by(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------

alter table public.survey_module_access      enable row level security;
alter table public.room_types                enable row level security;
alter table public.room_type_asset_templates enable row level security;
alter table public.rooms                     enable row level security;
alter table public.assets                    enable row level security;
alter table public.asset_surveys             enable row level security;
alter table public.asset_survey_items        enable row level security;
alter table public.asset_history             enable row level security;

-- survey_module_access: hanya superadmin yang lihat & ubah; user juga
-- boleh lihat baris-nya sendiri (untuk hook akses).
drop policy if exists sma_select on public.survey_module_access;
create policy sma_select on public.survey_module_access
  for select using (
    public.is_superadmin() or user_id = auth.uid()
  );
drop policy if exists sma_modify on public.survey_module_access;
create policy sma_modify on public.survey_module_access
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

-- room_types: read for has_survey_access; modify by superadmin
drop policy if exists rt_select on public.room_types;
create policy rt_select on public.room_types
  for select using (public.has_survey_access(auth.uid()));
drop policy if exists rt_modify on public.room_types;
create policy rt_modify on public.room_types
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

drop policy if exists rtat_select on public.room_type_asset_templates;
create policy rtat_select on public.room_type_asset_templates
  for select using (public.has_survey_access(auth.uid()));
drop policy if exists rtat_modify on public.room_type_asset_templates;
create policy rtat_modify on public.room_type_asset_templates
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

-- rooms / assets: read for has_survey_access; modify by superadmin
-- (penambahan aset lewat survey dilakukan via RPC SECURITY DEFINER).
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select using (public.has_survey_access(auth.uid()));
drop policy if exists rooms_modify on public.rooms;
create policy rooms_modify on public.rooms
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets
  for select using (public.has_survey_access(auth.uid()));
drop policy if exists assets_modify on public.assets;
create policy assets_modify on public.assets
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

-- asset_surveys: read by has_survey_access. Insert by has_survey_access.
-- Update by creator while writable (draft/in_progress/needs_revision),
-- atau oleh superadmin/pimpinan untuk transisi status submit→validate
-- (lewat RPC survey_validate / survey_request_revision).
drop policy if exists as_select on public.asset_surveys;
create policy as_select on public.asset_surveys
  for select using (public.has_survey_access(auth.uid()));

drop policy if exists as_insert on public.asset_surveys;
create policy as_insert on public.asset_surveys
  for insert with check (
    public.has_survey_access(auth.uid()) and created_by = auth.uid()
  );

drop policy if exists as_update on public.asset_surveys;
create policy as_update on public.asset_surveys
  for update using (
    public.is_superadmin()
    or (created_by = auth.uid()
        and status in ('draft','in_progress','needs_revision'))
  )
  with check (
    public.is_superadmin()
    or (created_by = auth.uid()
        and status in ('draft','in_progress','needs_revision'))
  );

drop policy if exists as_delete on public.asset_surveys;
create policy as_delete on public.asset_surveys
  for delete using (
    public.is_superadmin()
    or (created_by = auth.uid() and status = 'draft')
  );

-- asset_survey_items: read selama has_survey_access; modify selama survey
-- writable oleh creator. (pimpinan tidak edit item langsung — mereka
-- pakai RPC validate/request_revision.)
drop policy if exists asi_select on public.asset_survey_items;
create policy asi_select on public.asset_survey_items
  for select using (public.has_survey_access(auth.uid()));

drop policy if exists asi_insert on public.asset_survey_items;
create policy asi_insert on public.asset_survey_items
  for insert with check (
    public.is_superadmin()
    or public.survey_is_writable_by(survey_id, auth.uid())
  );

drop policy if exists asi_update on public.asset_survey_items;
create policy asi_update on public.asset_survey_items
  for update using (
    public.is_superadmin()
    or public.survey_is_writable_by(survey_id, auth.uid())
  )
  with check (
    public.is_superadmin()
    or public.survey_is_writable_by(survey_id, auth.uid())
  );

drop policy if exists asi_delete on public.asset_survey_items;
create policy asi_delete on public.asset_survey_items
  for delete using (
    public.is_superadmin()
    or public.survey_is_writable_by(survey_id, auth.uid())
  );

-- asset_history: read by has_survey_access; insert lewat trigger / RPC.
drop policy if exists ah_select on public.asset_history;
create policy ah_select on public.asset_history
  for select using (public.has_survey_access(auth.uid()));

-- Eksplisit GRANT ke role authenticated (Supabase default sudah,
-- tapi defensif).
grant select, insert, update, delete on public.survey_module_access      to authenticated;
grant select, insert, update, delete on public.room_types                to authenticated;
grant select, insert, update, delete on public.room_type_asset_templates to authenticated;
grant select, insert, update, delete on public.rooms                     to authenticated;
grant select, insert, update, delete on public.assets                    to authenticated;
grant select, insert, update, delete on public.asset_surveys             to authenticated;
grant select, insert, update, delete on public.asset_survey_items        to authenticated;
grant select                          on public.asset_history            to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RPC: granting access (superadmin only)
-- ---------------------------------------------------------------------------

create or replace function public.survey_grant_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin yang dapat memberi akses modul Survey Aset.';
  end if;
  insert into public.survey_module_access(user_id, enabled, granted_by)
    values (p_user_id, true, auth.uid())
    on conflict (user_id) do update
      set enabled = true,
          granted_by = excluded.granted_by,
          granted_at = now();
end$$;

revoke all on function public.survey_grant_access(uuid) from public;
grant execute on function public.survey_grant_access(uuid) to authenticated;

create or replace function public.survey_revoke_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin yang dapat mencabut akses modul Survey Aset.';
  end if;
  update public.survey_module_access
     set enabled = false
   where user_id = p_user_id;
end$$;

revoke all on function public.survey_revoke_access(uuid) from public;
grant execute on function public.survey_revoke_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPC: survey workflow
-- ---------------------------------------------------------------------------

-- Apply template aset ke ruang. Idempotent (tidak duplikat aset yang
-- sudah punya nama sama). Hanya superadmin yang boleh karena
-- memodifikasi `assets`.
create or replace function public.survey_apply_template(
  p_room_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_type uuid;
  v_inserted  integer := 0;
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin yang dapat menerapkan template aset.';
  end if;

  select room_type_id into v_room_type
    from public.rooms where id = p_room_id;
  if v_room_type is null then
    raise exception 'Ruang tidak ditemukan atau belum punya jenis ruang.';
  end if;

  insert into public.assets(room_id, name, current_condition, notes)
    select p_room_id, t.asset_name, 'baik', t.notes
      from public.room_type_asset_templates t
     where t.room_type_id = v_room_type
       and not exists (
         select 1 from public.assets a
          where a.room_id = p_room_id and a.name = t.asset_name
       );
  get diagnostics v_inserted = row_count;
  return v_inserted;
end$$;

revoke all on function public.survey_apply_template(uuid) from public;
grant execute on function public.survey_apply_template(uuid) to authenticated;

-- Buat survey baru. Otomatis membuat 1 asset_survey_items per aset di
-- ruang (kondisi NULL = belum dichecklist).
create or replace function public.survey_create(
  p_title   text,
  p_room_id uuid
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
  if not exists (select 1 from public.rooms where id = p_room_id) then
    raise exception 'Ruang tidak ditemukan.';
  end if;

  insert into public.asset_surveys(title, status, room_id, created_by)
    values (p_title, 'draft', p_room_id, auth.uid())
    returning id into v_id;

  insert into public.asset_survey_items(survey_id, asset_id)
    select v_id, a.id from public.assets a where a.room_id = p_room_id;

  return v_id;
end$$;

revoke all on function public.survey_create(text, uuid) from public;
grant execute on function public.survey_create(text, uuid) to authenticated;

-- Simpan satu item checklist
create or replace function public.survey_save_item(
  p_item_id   uuid,
  p_condition text,
  p_note      text default null,
  p_photo_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_survey uuid;
begin
  if p_condition not in (
    'baik','rusak_ringan','rusak_berat','tidak_ditemukan','perlu_diganti'
  ) then
    raise exception 'Kondisi tidak valid: %', p_condition;
  end if;

  select survey_id into v_survey
    from public.asset_survey_items where id = p_item_id;
  if v_survey is null then
    raise exception 'Item tidak ditemukan.';
  end if;

  if not (
    public.is_superadmin()
    or public.survey_is_writable_by(v_survey, auth.uid())
  ) then
    raise exception 'Anda tidak berhak mengubah survey ini.';
  end if;

  update public.asset_survey_items
     set condition = p_condition,
         note      = p_note,
         photo_url = p_photo_url
   where id = p_item_id;

  -- begitu user mulai mengisi, status pindah dari draft → in_progress
  update public.asset_surveys
     set status = 'in_progress'
   where id = v_survey and status = 'draft';
end$$;

revoke all on function public.survey_save_item(uuid, text, text, text) from public;
grant execute on function public.survey_save_item(uuid, text, text, text) to authenticated;

-- "Tandai Semua Baik": set semua item yang masih NULL → 'baik'
create or replace function public.survey_mark_all_good(p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not (
    public.is_superadmin()
    or public.survey_is_writable_by(p_survey_id, auth.uid())
  ) then
    raise exception 'Anda tidak berhak mengubah survey ini.';
  end if;

  update public.asset_survey_items
     set condition = 'baik'
   where survey_id = p_survey_id and condition is null;
  get diagnostics v_count = row_count;

  update public.asset_surveys
     set status = 'in_progress'
   where id = p_survey_id and status = 'draft';

  return v_count;
end$$;

revoke all on function public.survey_mark_all_good(uuid) from public;
grant execute on function public.survey_mark_all_good(uuid) to authenticated;

-- Submit: transisi in_progress → submitted. Semua item harus terisi.
create or replace function public.survey_submit(p_survey_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unfilled integer;
begin
  if not (
    public.is_superadmin()
    or public.survey_is_writable_by(p_survey_id, auth.uid())
  ) then
    raise exception 'Anda tidak berhak men-submit survey ini.';
  end if;

  select count(*) into v_unfilled
    from public.asset_survey_items
   where survey_id = p_survey_id and condition is null;
  if v_unfilled > 0 then
    raise exception 'Masih ada % aset yang belum dichecklist.', v_unfilled;
  end if;

  update public.asset_surveys
     set status = 'submitted',
         validation_note = null,
         validated_at = null,
         validator_id = null
   where id = p_survey_id;
end$$;

revoke all on function public.survey_submit(uuid) from public;
grant execute on function public.survey_submit(uuid) to authenticated;

-- Validasi (pimpinan/superadmin): transisi submitted → validated.
-- Propagasi kondisi ke `assets.current_condition` (trigger
-- assets_log_condition_change otomatis log ke asset_history).
create or replace function public.survey_validate(
  p_survey_id uuid,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (public.is_superadmin() or public.is_pimpinan()) then
    raise exception 'Hanya pimpinan/superadmin yang dapat memvalidasi.';
  end if;

  select status into v_status from public.asset_surveys where id = p_survey_id;
  if v_status is null then
    raise exception 'Survey tidak ditemukan.';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Survey tidak dalam status submitted (status: %).', v_status;
  end if;

  -- Propagasi kondisi terbaru ke aset.
  update public.assets a
     set current_condition = i.condition
    from public.asset_survey_items i
   where i.survey_id = p_survey_id
     and i.asset_id = a.id
     and i.condition is not null
     and i.condition is distinct from a.current_condition;

  update public.asset_surveys
     set status = 'validated',
         validator_id = auth.uid(),
         validation_note = p_note,
         validated_at = now()
   where id = p_survey_id;
end$$;

revoke all on function public.survey_validate(uuid, text) from public;
grant execute on function public.survey_validate(uuid, text) to authenticated;

-- Minta revisi: submitted → needs_revision
create or replace function public.survey_request_revision(
  p_survey_id uuid,
  p_note      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (public.is_superadmin() or public.is_pimpinan()) then
    raise exception 'Hanya pimpinan/superadmin yang dapat meminta revisi.';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Catatan revisi wajib diisi.';
  end if;

  select status into v_status from public.asset_surveys where id = p_survey_id;
  if v_status is null then
    raise exception 'Survey tidak ditemukan.';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Survey tidak dalam status submitted (status: %).', v_status;
  end if;

  update public.asset_surveys
     set status = 'needs_revision',
         validator_id = auth.uid(),
         validation_note = p_note,
         validated_at = now()
   where id = p_survey_id;
end$$;

revoke all on function public.survey_request_revision(uuid, text) from public;
grant execute on function public.survey_request_revision(uuid, text) to authenticated;

-- Buat laporan FSM LAPOR dari aset rusak. INSERT ke `public.reports`
-- atas nama auth.uid() (bypass RLS via SECURITY DEFINER). Hasil
-- dipautkan ke item-nya supaya UI tahu sudah dilaporkan.
--
-- Tidak menyentuh kode existing FSM LAPOR — INSERT-nya menggunakan
-- bentuk row yang sama persis dengan yang digunakan komponen Laporan.tsx.
create or replace function public.survey_create_report_from_asset(
  p_item_id        uuid,
  p_category_id    uuid,
  p_description    text,
  p_photo_url      text,
  p_sla_option_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_survey  uuid;
  v_report  uuid;
begin
  if v_user_id is null then
    raise exception 'Tidak ada sesi aktif.';
  end if;

  select survey_id into v_survey
    from public.asset_survey_items where id = p_item_id;
  if v_survey is null then
    raise exception 'Item survey tidak ditemukan.';
  end if;

  if not (
    public.is_superadmin()
    or public.survey_is_writable_by(v_survey, v_user_id)
  ) then
    raise exception 'Anda tidak berhak membuat laporan dari item ini.';
  end if;

  if coalesce(trim(p_description), '') = '' then
    raise exception 'Keterangan wajib diisi.';
  end if;
  if coalesce(trim(p_photo_url), '') = '' then
    raise exception 'Foto wajib diisi.';
  end if;

  insert into public.reports(
    user_id, photo_url, description, category_id, sla_option_id
  ) values (
    v_user_id, p_photo_url, p_description, p_category_id, p_sla_option_id
  ) returning id into v_report;

  update public.asset_survey_items
     set report_id = v_report
   where id = p_item_id;

  return v_report;
end$$;

revoke all on function public.survey_create_report_from_asset(
  uuid, uuid, text, text, uuid
) from public;
grant execute on function public.survey_create_report_from_asset(
  uuid, uuid, text, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Sanity check
-- ---------------------------------------------------------------------------

do $$
declare
  v_tables  int;
  v_funcs   int;
  v_pols    int;
begin
  select count(*) into v_tables
    from information_schema.tables
   where table_schema = 'public'
     and table_name in (
       'survey_module_access','room_types','room_type_asset_templates',
       'rooms','assets','asset_surveys','asset_survey_items','asset_history'
     );
  select count(*) into v_funcs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'has_survey_access','survey_is_writable_by',
       'survey_grant_access','survey_revoke_access',
       'survey_apply_template','survey_create','survey_save_item',
       'survey_mark_all_good','survey_submit','survey_validate',
       'survey_request_revision','survey_create_report_from_asset',
       'assets_log_condition_change'
     );
  select count(*) into v_pols
    from pg_policies
   where schemaname = 'public'
     and tablename in (
       'survey_module_access','room_types','room_type_asset_templates',
       'rooms','assets','asset_surveys','asset_survey_items','asset_history'
     );

  if v_tables < 8 then
    raise exception '0017: tabel kurang (% dari 8)', v_tables;
  end if;
  if v_funcs < 13 then
    raise exception '0017: function kurang (% dari 13)', v_funcs;
  end if;
  if v_pols < 14 then
    raise exception '0017: policy kurang (% dari 14)', v_pols;
  end if;
  raise notice '0017_survey_aset applied — tables=%, funcs=%, policies=%',
    v_tables, v_funcs, v_pols;
end$$;
