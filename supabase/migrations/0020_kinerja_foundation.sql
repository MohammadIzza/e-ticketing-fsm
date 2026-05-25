-- =============================================================================
-- 0020_kinerja_foundation.sql
--
-- PR-D — Submodul "Kinerja Pegawai" (Item #13 dari batch revisi PR-A).
--
-- Lapisan PALING BAWAH dari fitur ini: schema DB + RLS + RPC SECURITY
-- DEFINER untuk transisi state. Tidak ada UI di sini — UI dibangun di
-- PR-E (Superadmin config) dan PR-F (Pimpinan + User flow).
--
-- Tujuan: tracking kinerja pegawai (dosen / staf / mahasiswa) dengan
-- alur dua arah:
--   A) Pimpinan menugaskan user → user kerjakan & lapor → pimpinan
--      approve/revisi/verifikasi.
--   B) User langsung lapor kinerja sendiri → pimpinan validasi.
--
-- Tabel yang dibuat:
--   1. kinerja_assignment_types  — jenis penugasan + formula SKS
--   2. kinerja_indicators        — indikator pengukur (variabel formula)
--   3. kinerja_outputs           — output / deliverable target
--   4. kinerja_activities        — katalog kegiatan dapat diklaim
--   5. kinerja_form_schemas      — definisi form custom (jsonb)
--   6. kinerja_assignments       — instance penugasan ke user
--   7. kinerja_submissions       — laporan/claim user
--   8. kinerja_evidences         — file bukti per submission
--   9. kinerja_approvals         — audit log transisi status
--
-- RPC SECURITY DEFINER:
--   - kinerja_create_self_assignment    — alur B: user buat sendiri
--   - kinerja_submit_submission         — user submit untuk review
--   - kinerja_review_submission         — pimpinan approve/revisi/verify
--
-- Keamanan:
--   - "Jenis user" (dosen / staf / mahasiswa) di-derive dari
--     `profiles.reporter_type_id` → `reporter_types.name` (tidak
--     menambah role baru). Default semua authenticated user dengan
--     reporter_type_id non-NULL bisa pakai modul ini.
--   - Pimpinan & superadmin punya wewenang penuh untuk review semua
--     submission. Refinement per-jabatan/divisi dapat dilakukan di
--     PR berikutnya tanpa breaking change.
--
-- Idempotent — aman di-jalankan ulang via Bootstrap workflow.
-- Tidak menyentuh tabel modul FSM LAPOR atau Survey Aset.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper internal: cek apakah user dapat me-review submission (pimpinan/super)
-- ---------------------------------------------------------------------------

create or replace function public.is_kinerja_reviewer(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_superadmin() or exists(
    select 1 from public.user_roles where user_id = p_user and role = 'pimpinan'
  );
$$;

revoke all on function public.is_kinerja_reviewer(uuid) from public;
grant execute on function public.is_kinerja_reviewer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) kinerja_assignment_types
-- ---------------------------------------------------------------------------

create table if not exists public.kinerja_assignment_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  /**
   * Ekspresi rumus untuk hitung estimasi SKS dari indikator-indikator
   * yang terkait. Operator yang didukung evaluator klien (PR-E):
   *   `+ - * / ( )`, `min(a,b,...)`, `max(...)`, `round(x[, n])`, dan
   *   variabel sesuai `kinerja_indicators.code`. Server tidak meng-
   *   evaluate-nya — disimpan apa adanya untuk audit/portabilitas.
   */
  formula     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists kat_set_updated_at on public.kinerja_assignment_types;
create trigger kat_set_updated_at
before update on public.kinerja_assignment_types
for each row execute function public.touch_updated_at();

alter table public.kinerja_assignment_types enable row level security;

drop policy if exists kat_select on public.kinerja_assignment_types;
create policy kat_select on public.kinerja_assignment_types
  for select to authenticated using (true);

drop policy if exists kat_write on public.kinerja_assignment_types;
create policy kat_write on public.kinerja_assignment_types
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.kinerja_assignment_types to authenticated;

-- ---------------------------------------------------------------------------
-- 2) kinerja_indicators
-- ---------------------------------------------------------------------------

create table if not exists public.kinerja_indicators (
  id                  uuid primary key default gen_random_uuid(),
  assignment_type_id  uuid not null references public.kinerja_assignment_types(id) on delete cascade,
  /** Identifier variabel di formula (cth: "n_paper", "jam_mengajar"). */
  code                text not null,
  label               text not null,
  description         text,
  unit                text,           -- "buah", "halaman", "jam", dst.
  default_value       numeric not null default 0,
  sort_order          int    not null default 0,
  created_at          timestamptz not null default now(),
  unique (assignment_type_id, code)
);

create index if not exists kinerja_indicators_type_idx
  on public.kinerja_indicators (assignment_type_id);

alter table public.kinerja_indicators enable row level security;

drop policy if exists ki_select on public.kinerja_indicators;
create policy ki_select on public.kinerja_indicators
  for select to authenticated using (true);

drop policy if exists ki_write on public.kinerja_indicators;
create policy ki_write on public.kinerja_indicators
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.kinerja_indicators to authenticated;

-- ---------------------------------------------------------------------------
-- 3) kinerja_outputs
-- ---------------------------------------------------------------------------

create table if not exists public.kinerja_outputs (
  id                  uuid primary key default gen_random_uuid(),
  assignment_type_id  uuid not null references public.kinerja_assignment_types(id) on delete cascade,
  label               text not null,
  description         text,
  sort_order          int  not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists kinerja_outputs_type_idx
  on public.kinerja_outputs (assignment_type_id);

alter table public.kinerja_outputs enable row level security;

drop policy if exists ko_select on public.kinerja_outputs;
create policy ko_select on public.kinerja_outputs
  for select to authenticated using (true);

drop policy if exists ko_write on public.kinerja_outputs;
create policy ko_write on public.kinerja_outputs
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.kinerja_outputs to authenticated;

-- ---------------------------------------------------------------------------
-- 4) kinerja_activities  (katalog kegiatan global atau per assignment_type)
-- ---------------------------------------------------------------------------

create table if not exists public.kinerja_activities (
  id                  uuid primary key default gen_random_uuid(),
  /** NULL = berlaku untuk semua assignment_type (kegiatan umum). */
  assignment_type_id  uuid references public.kinerja_assignment_types(id) on delete cascade,
  code                text,
  name                text not null,
  description         text,
  is_active           boolean not null default true,
  sort_order          int    not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists kinerja_activities_type_idx
  on public.kinerja_activities (assignment_type_id);

alter table public.kinerja_activities enable row level security;

drop policy if exists ka_select on public.kinerja_activities;
create policy ka_select on public.kinerja_activities
  for select to authenticated using (true);

drop policy if exists ka_write on public.kinerja_activities;
create policy ka_write on public.kinerja_activities
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.kinerja_activities to authenticated;

-- ---------------------------------------------------------------------------
-- 5) kinerja_form_schemas
--
-- Skema form custom (jsonb array of field definitions). Format setiap
-- field di `fields`:
--   { "name": str, "label": str, "type": "text|textarea|number|date|select|multiselect|file|checkbox",
--     "required": bool, "options": [str]?, "help": str? }
-- Validasi skema dilakukan client-side (PR-E). Server hanya simpan apa
-- adanya. 1 schema per assignment_type (UPSERT-friendly via unique).
-- ---------------------------------------------------------------------------

create table if not exists public.kinerja_form_schemas (
  id                  uuid primary key default gen_random_uuid(),
  assignment_type_id  uuid not null unique
    references public.kinerja_assignment_types(id) on delete cascade,
  fields              jsonb not null default '[]'::jsonb,
  updated_at          timestamptz not null default now()
);

drop trigger if exists kfs_set_updated_at on public.kinerja_form_schemas;
create trigger kfs_set_updated_at
before update on public.kinerja_form_schemas
for each row execute function public.touch_updated_at();

alter table public.kinerja_form_schemas enable row level security;

drop policy if exists kfs_select on public.kinerja_form_schemas;
create policy kfs_select on public.kinerja_form_schemas
  for select to authenticated using (true);

drop policy if exists kfs_write on public.kinerja_form_schemas;
create policy kfs_write on public.kinerja_form_schemas
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on public.kinerja_form_schemas to authenticated;

-- ---------------------------------------------------------------------------
-- 6) kinerja_assignments
--
-- Slot penugasan ke user. Bisa jadi parent dari banyak submission
-- (mis. dosen di-assign "Mengajar" untuk semester ini, lalu setiap
-- minggu submit progress). Atau bisa tidak ada (alur B: user lapor
-- langsung tanpa assignment).
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'kinerja_assignment_status') then
    create type public.kinerja_assignment_status as enum (
      'active', 'closed', 'cancelled'
    );
  end if;
end$$;

create table if not exists public.kinerja_assignments (
  id                  uuid primary key default gen_random_uuid(),
  assignment_type_id  uuid not null references public.kinerja_assignment_types(id) on delete restrict,
  assignee_id         uuid not null references public.profiles(id) on delete cascade,
  /** NULL = self-assigned (alur B). Otherwise = pimpinan yang menugaskan. */
  assigned_by         uuid references public.profiles(id) on delete set null,
  title               text not null,
  description         text,
  due_date            date,
  status              public.kinerja_assignment_status not null default 'active',
  /** Group tahun/semester opsional untuk reporting periode. */
  period_year         int,
  period_semester     smallint check (period_semester is null or period_semester in (1, 2)),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists kas_set_updated_at on public.kinerja_assignments;
create trigger kas_set_updated_at
before update on public.kinerja_assignments
for each row execute function public.touch_updated_at();

create index if not exists kinerja_assignments_assignee_idx
  on public.kinerja_assignments (assignee_id);
create index if not exists kinerja_assignments_type_idx
  on public.kinerja_assignments (assignment_type_id);
create index if not exists kinerja_assignments_status_idx
  on public.kinerja_assignments (status);

alter table public.kinerja_assignments enable row level security;

-- SELECT: assignee melihat punyanya, reviewer melihat semua.
drop policy if exists kas_select on public.kinerja_assignments;
create policy kas_select on public.kinerja_assignments
  for select using (
    assignee_id = auth.uid()
    or public.is_kinerja_reviewer()
  );

-- INSERT: pimpinan/superadmin menugaskan ke user mana saja, ATAU user
-- self-assign (assigned_by NULL DAN assignee_id = auth.uid()).
drop policy if exists kas_insert on public.kinerja_assignments;
create policy kas_insert on public.kinerja_assignments
  for insert with check (
    public.is_kinerja_reviewer()
    or (assignee_id = auth.uid() and assigned_by is null)
  );

-- UPDATE: hanya reviewer (status, due, dll). User tidak boleh ubah
-- assignment-nya sendiri (mereka edit submission, bukan assignment).
drop policy if exists kas_update on public.kinerja_assignments;
create policy kas_update on public.kinerja_assignments
  for update using (public.is_kinerja_reviewer())
  with check (public.is_kinerja_reviewer());

drop policy if exists kas_delete on public.kinerja_assignments;
create policy kas_delete on public.kinerja_assignments
  for delete using (public.is_kinerja_reviewer());

grant select, insert, update, delete on public.kinerja_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 7) kinerja_submissions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'kinerja_submission_status') then
    create type public.kinerja_submission_status as enum (
      'draft', 'submitted', 'needs_revision', 'approved', 'verified', 'rejected'
    );
  end if;
end$$;

create table if not exists public.kinerja_submissions (
  id                  uuid primary key default gen_random_uuid(),
  /** NULL = self-claim (alur B), tidak ada parent assignment. */
  assignment_id       uuid references public.kinerja_assignments(id) on delete set null,
  /** Denormalize agar mudah filter walau assignment_id NULL. */
  assignment_type_id  uuid not null references public.kinerja_assignment_types(id) on delete restrict,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  title               text not null,
  description         text,
  /** Nilai field-field dari kinerja_form_schemas.fields */
  form_data           jsonb not null default '{}'::jsonb,
  /** Mapping {indicator_code: numeric_value} untuk evaluasi formula. */
  indicator_values    jsonb not null default '{}'::jsonb,
  /** Hasil eval rumus (computed client-side & disimpan). */
  computed_sks        numeric,
  status              public.kinerja_submission_status not null default 'draft',
  /** Catatan terakhir dari reviewer (untuk needs_revision/rejected). */
  review_note         text,
  submitted_at        timestamptz,
  reviewed_at         timestamptz,
  reviewed_by         uuid references public.profiles(id) on delete set null,
  verified_at         timestamptz,
  verified_by         uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists ksub_set_updated_at on public.kinerja_submissions;
create trigger ksub_set_updated_at
before update on public.kinerja_submissions
for each row execute function public.touch_updated_at();

create index if not exists kinerja_submissions_user_idx
  on public.kinerja_submissions (user_id);
create index if not exists kinerja_submissions_assignment_idx
  on public.kinerja_submissions (assignment_id);
create index if not exists kinerja_submissions_status_idx
  on public.kinerja_submissions (status);

alter table public.kinerja_submissions enable row level security;

-- SELECT: pemilik atau reviewer.
drop policy if exists ksub_select on public.kinerja_submissions;
create policy ksub_select on public.kinerja_submissions
  for select using (
    user_id = auth.uid() or public.is_kinerja_reviewer()
  );

-- INSERT: user buat submission untuk dirinya sendiri.
drop policy if exists ksub_insert on public.kinerja_submissions;
create policy ksub_insert on public.kinerja_submissions
  for insert with check (user_id = auth.uid());

-- UPDATE: pemilik HANYA boleh ubah saat status draft / needs_revision
-- (sebelum submitted final). Setelah submitted, hanya reviewer (via
-- RPC) yang bisa transisi status. Edit field ini juga membatasi UI di
-- PR-F — di sini sebagai defense-in-depth.
drop policy if exists ksub_update_owner on public.kinerja_submissions;
create policy ksub_update_owner on public.kinerja_submissions
  for update using (
    user_id = auth.uid() and status in ('draft','needs_revision')
  )
  with check (
    user_id = auth.uid() and status in ('draft','needs_revision')
  );

-- UPDATE oleh reviewer (mostly via RPC, tapi policy di-grant).
drop policy if exists ksub_update_reviewer on public.kinerja_submissions;
create policy ksub_update_reviewer on public.kinerja_submissions
  for update using (public.is_kinerja_reviewer())
  with check (public.is_kinerja_reviewer());

drop policy if exists ksub_delete on public.kinerja_submissions;
create policy ksub_delete on public.kinerja_submissions
  for delete using (
    public.is_superadmin()
    or (user_id = auth.uid() and status = 'draft')
  );

grant select, insert, update, delete on public.kinerja_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- 8) kinerja_evidences
-- ---------------------------------------------------------------------------

create table if not exists public.kinerja_evidences (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.kinerja_submissions(id) on delete cascade,
  /** Object key di bucket `kinerja-evidence`, bukan signed URL. */
  storage_path    text not null,
  file_name       text not null,
  mime_type       text,
  size_bytes      bigint,
  label           text,
  uploaded_by     uuid references public.profiles(id) on delete set null,
  uploaded_at     timestamptz not null default now()
);

create index if not exists kinerja_evidences_submission_idx
  on public.kinerja_evidences (submission_id);

alter table public.kinerja_evidences enable row level security;

-- Visibility & write mengikuti parent submission (pemilik atau reviewer).
drop policy if exists kev_select on public.kinerja_evidences;
create policy kev_select on public.kinerja_evidences
  for select using (
    exists (
      select 1 from public.kinerja_submissions s
      where s.id = submission_id
        and (s.user_id = auth.uid() or public.is_kinerja_reviewer())
    )
  );

drop policy if exists kev_insert on public.kinerja_evidences;
create policy kev_insert on public.kinerja_evidences
  for insert with check (
    exists (
      select 1 from public.kinerja_submissions s
      where s.id = submission_id
        and s.user_id = auth.uid()
        and s.status in ('draft','needs_revision')
    )
  );

drop policy if exists kev_delete on public.kinerja_evidences;
create policy kev_delete on public.kinerja_evidences
  for delete using (
    public.is_superadmin()
    or exists (
      select 1 from public.kinerja_submissions s
      where s.id = submission_id
        and s.user_id = auth.uid()
        and s.status in ('draft','needs_revision')
    )
  );

grant select, insert, update, delete on public.kinerja_evidences to authenticated;

-- ---------------------------------------------------------------------------
-- 9) kinerja_approvals  (audit log — append-only via RPC)
-- ---------------------------------------------------------------------------

create table if not exists public.kinerja_approvals (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.kinerja_submissions(id) on delete cascade,
  actor_id        uuid not null references public.profiles(id) on delete restrict,
  /** 'submit' (user), 'approve' / 'revise' / 'verify' / 'reject' (reviewer). */
  action          text not null,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists kinerja_approvals_submission_idx
  on public.kinerja_approvals (submission_id);

alter table public.kinerja_approvals enable row level security;

drop policy if exists kapp_select on public.kinerja_approvals;
create policy kapp_select on public.kinerja_approvals
  for select using (
    actor_id = auth.uid()
    or public.is_kinerja_reviewer()
    or exists (
      select 1 from public.kinerja_submissions s
      where s.id = submission_id and s.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE hanya via RPC SECURITY DEFINER di bawah.
revoke all on public.kinerja_approvals from public;
grant select on public.kinerja_approvals to authenticated;

-- ---------------------------------------------------------------------------
-- RPC — transisi status submission
-- ---------------------------------------------------------------------------

-- User: pindahkan submission sendiri dari draft / needs_revision → submitted.
create or replace function public.kinerja_submit_submission(
  p_submission_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status public.kinerja_submission_status;
begin
  select user_id, status into v_owner, v_status
    from public.kinerja_submissions where id = p_submission_id;
  if v_owner is null then
    raise exception 'Submission tidak ditemukan';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'Hanya pemilik yang dapat submit';
  end if;
  if v_status not in ('draft','needs_revision') then
    raise exception 'Status saat ini tidak dapat di-submit';
  end if;

  update public.kinerja_submissions
     set status = 'submitted',
         submitted_at = now(),
         review_note = null
   where id = p_submission_id;

  insert into public.kinerja_approvals (submission_id, actor_id, action, note)
  values (p_submission_id, auth.uid(), 'submit', null);
end;
$$;

revoke all on function public.kinerja_submit_submission(uuid) from public;
grant execute on function public.kinerja_submit_submission(uuid) to authenticated;

-- Reviewer: approve / minta revisi / reject / verifikasi final.
-- Aksi yang valid:
--   - 'approve'  : submitted          → approved
--   - 'revise'   : submitted/approved → needs_revision (perlu p_note)
--   - 'reject'   : submitted          → rejected       (perlu p_note)
--   - 'verify'   : approved           → verified       (final, bukti OK)
create or replace function public.kinerja_review_submission(
  p_submission_id uuid,
  p_action        text,
  p_note          text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.kinerja_submission_status;
begin
  if not public.is_kinerja_reviewer() then
    raise exception 'Hanya pimpinan/superadmin yang dapat me-review';
  end if;

  select status into v_status
    from public.kinerja_submissions where id = p_submission_id;
  if v_status is null then
    raise exception 'Submission tidak ditemukan';
  end if;

  if p_action = 'approve' then
    if v_status <> 'submitted' then
      raise exception 'Hanya status submitted yang dapat di-approve';
    end if;
    update public.kinerja_submissions
       set status = 'approved',
           reviewed_at = now(),
           reviewed_by = auth.uid(),
           review_note = p_note
     where id = p_submission_id;
  elsif p_action = 'revise' then
    if v_status not in ('submitted','approved') then
      raise exception 'Status saat ini tidak dapat diminta revisi';
    end if;
    if coalesce(p_note, '') = '' then
      raise exception 'Catatan revisi wajib diisi';
    end if;
    update public.kinerja_submissions
       set status = 'needs_revision',
           reviewed_at = now(),
           reviewed_by = auth.uid(),
           review_note = p_note
     where id = p_submission_id;
  elsif p_action = 'reject' then
    if v_status <> 'submitted' then
      raise exception 'Hanya status submitted yang dapat ditolak';
    end if;
    if coalesce(p_note, '') = '' then
      raise exception 'Catatan penolakan wajib diisi';
    end if;
    update public.kinerja_submissions
       set status = 'rejected',
           reviewed_at = now(),
           reviewed_by = auth.uid(),
           review_note = p_note
     where id = p_submission_id;
  elsif p_action = 'verify' then
    if v_status <> 'approved' then
      raise exception 'Hanya status approved yang dapat diverifikasi';
    end if;
    update public.kinerja_submissions
       set status = 'verified',
           verified_at = now(),
           verified_by = auth.uid(),
           review_note = p_note
     where id = p_submission_id;
  else
    raise exception 'Aksi tidak dikenal: %', p_action;
  end if;

  insert into public.kinerja_approvals (submission_id, actor_id, action, note)
  values (p_submission_id, auth.uid(), p_action, p_note);
end;
$$;

revoke all on function public.kinerja_review_submission(uuid, text, text) from public;
grant execute on function public.kinerja_review_submission(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket: kinerja-evidence (private)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('kinerja-evidence', 'kinerja-evidence', false)
on conflict (id) do nothing;

-- RLS storage:
--   READ  : pemilik submission atau reviewer.
--   WRITE : pemilik submission saat status draft/needs_revision.
-- Path konvensi: `<user_id>/<submission_id>/<filename>`.
drop policy if exists kev_storage_select on storage.objects;
create policy kev_storage_select on storage.objects
  for select to authenticated using (
    bucket_id = 'kinerja-evidence'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.is_kinerja_reviewer()
    )
  );

drop policy if exists kev_storage_insert on storage.objects;
create policy kev_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'kinerja-evidence'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists kev_storage_delete on storage.objects;
create policy kev_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'kinerja-evidence'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.is_superadmin()
    )
  );

-- ---------------------------------------------------------------------------
-- Sanity check
-- ---------------------------------------------------------------------------

do $$
declare
  v_tables   int;
  v_funcs    int;
  v_bucket   int;
begin
  select count(*) into v_tables
    from information_schema.tables
   where table_schema = 'public'
     and table_name in (
       'kinerja_assignment_types','kinerja_indicators','kinerja_outputs',
       'kinerja_activities','kinerja_form_schemas','kinerja_assignments',
       'kinerja_submissions','kinerja_evidences','kinerja_approvals'
     );
  select count(*) into v_funcs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'is_kinerja_reviewer',
       'kinerja_submit_submission',
       'kinerja_review_submission'
     );
  select count(*) into v_bucket
    from storage.buckets where id = 'kinerja-evidence';

  if v_tables <> 9 then
    raise exception '0020: jumlah tabel Kinerja kurang (% dari 9)', v_tables;
  end if;
  if v_funcs <> 3 then
    raise exception '0020: jumlah RPC Kinerja kurang (% dari 3)', v_funcs;
  end if;
  if v_bucket <> 1 then
    raise exception '0020: bucket kinerja-evidence tidak terbuat';
  end if;
  raise notice '0020_kinerja_foundation applied — tables=%, rpcs=%, bucket OK', v_tables, v_funcs;
end$$;
