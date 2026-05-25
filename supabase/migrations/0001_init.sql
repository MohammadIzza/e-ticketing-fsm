-- =============================================================================
-- FSM LAPOR! — Auth & profile schema
--
-- Tabel:
--   public.profiles        : 1:1 dengan auth.users
--   public.user_roles      : multi-role per user (pelapor, superadmin,
--                            pimpinan, petugas)
--
-- Trigger:
--   handle_new_user        : auto-create profile + role 'pelapor' setiap kali
--                            ada row baru di auth.users
--
-- RPC:
--   find_email_by_username : lookup email dari username (dipakai superadmin
--                            login form yang tidak menampilkan email)
--   update_my_profile      : update full_name + avatar_url milik diri sendiri
--                            (SECURITY DEFINER agar trigger updated_at + RLS
--                            tetap konsisten)
--
-- RLS:
--   profiles               : SELECT/UPDATE row sendiri saja
--   user_roles             : SELECT row sendiri saja; client tidak boleh
--                            INSERT/UPDATE/DELETE — hanya trigger / service
--                            role yang isi.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (username);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('pelapor', 'superadmin', 'pimpinan', 'petugas')),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_role_idx on public.user_roles (role);

-- -----------------------------------------------------------------------------
-- Trigger: keep updated_at fresh
-- -----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Trigger: handle_new_user
--
-- Dipanggil setiap kali Supabase Auth membuat user baru. Bertugas:
--   1. menulis profile row dengan username/full_name yang diturunkan dari
--      raw_user_meta_data atau dari email,
--   2. menambahkan role default 'pelapor' di public.user_roles.
--
-- Username dijamin unik dengan menambahkan 6 karakter pertama dari user id
-- jika ada konflik.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta_username text := nullif(trim(new.raw_user_meta_data->>'username'), '');
  v_meta_full_name text := nullif(trim(new.raw_user_meta_data->>'full_name'), '');
  v_username text;
begin
  v_username := lower(
    coalesce(
      v_meta_username,
      split_part(coalesce(new.email, ''), '@', 1)
    )
  );

  if v_username is null or v_username = '' then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  -- de-conflict
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := v_username || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  insert into public.profiles (id, email, username, full_name)
  values (new.id, new.email, v_username, v_meta_full_name);

  insert into public.user_roles (user_id, role)
  values (new.id, 'pelapor')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RPC: find_email_by_username
--
-- Dipakai halaman /superadmin/login yang menerima username (bukan email).
-- Frontend lookup email lalu signInWithPassword. Aman digrant ke anon
-- karena yang muncul hanya email — bukan password. Username tidak rahasia.
-- -----------------------------------------------------------------------------

create or replace function public.find_email_by_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if p_username is null or trim(p_username) = '' then
    return null;
  end if;

  select email
    into v_email
    from public.profiles
   where username = lower(trim(p_username))
   limit 1;

  return v_email;
end;
$$;

revoke all on function public.find_email_by_username(text) from public;
grant execute on function public.find_email_by_username(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPC: update_my_profile
--
-- Update full_name + avatar_url milik user yang sedang login. Memakai
-- SECURITY DEFINER supaya konsisten dengan trigger updated_at meski caller
-- belum punya ROW row update. Mencegah user mengganti id/email/username
-- secara langsung (yang akan menabrak unique / FK).
-- -----------------------------------------------------------------------------

create or replace function public.update_my_profile(
  p_full_name text,
  p_avatar_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
     set full_name = case
                       when p_full_name is null then full_name
                       when trim(p_full_name) = '' then null
                       else trim(p_full_name)
                     end,
         avatar_url = case
                        when p_avatar_url is null then avatar_url
                        when trim(p_avatar_url) = '' then null
                        else p_avatar_url
                      end,
         updated_at = now()
   where id = auth.uid()
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Profile not found for current user';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_my_profile(text, text) from public;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- INSERT pada profiles hanya via trigger handle_new_user (SECURITY DEFINER) atau
-- service role. Tidak ada policy INSERT untuk client.

drop policy if exists user_roles_select_self on public.user_roles;
create policy user_roles_select_self on public.user_roles
  for select using (auth.uid() = user_id);

-- Tidak ada policy INSERT/UPDATE/DELETE untuk client. Semua perubahan role
-- dilakukan oleh trigger handle_new_user atau script admin pakai service role.
