-- =============================================================================
-- 0012_notifications_and_wa.sql
--
-- Tambahan fitur:
--   1. Nomor WhatsApp opsional pada profil user (profiles.wa_number).
--   2. Preferensi notifikasi per-user (profiles.notification_prefs jsonb).
--      Default off (jsonb '{}'); UI di /profile yang membaca + menulis.
--   3. Update RPC public.update_my_profile agar bisa menyimpan kedua
--      kolom baru tersebut. Signature LAMA (p_full_name, p_avatar_url)
--      tetap di-handle karena parameter baru memiliki default null.
--   4. Daftarkan tabel public.reports ke publication supabase_realtime
--      supaya client dapat berlangganan event UPDATE untuk perubahan
--      status laporan. RLS tetap menyaring baris yang dapat diterima.
--
-- Aman dijalankan ulang oleh workflow Bootstrap (idempotent).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Kolom baru di profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists wa_number text,
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- Hindari nilai null pada baris yang sudah ada.
update public.profiles
   set notification_prefs = '{}'::jsonb
 where notification_prefs is null;

-- Sanity constraint: notification_prefs harus berupa object (jsonb_typeof
-- 'object') agar UI tidak perlu defensive parsing untuk kasus tipe lain.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_notification_prefs_obj'
  ) then
    alter table public.profiles
      add constraint profiles_notification_prefs_obj
      check (jsonb_typeof(notification_prefs) = 'object');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2) Update RPC update_my_profile dengan parameter baru.
--
--    Postgres tidak mengizinkan create or replace yang mengubah signature,
--    jadi drop dulu varian-varian lamanya.
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
       and p.proname = 'update_my_profile'
  loop
    execute format(
      'drop function public.update_my_profile(%s);',
      r.args
    );
  end loop;
end$$;

-- Catatan tentang konvensi NULL vs string kosong:
--   * NULL    => "tidak diubah" (caller tidak menyebut parameter ini).
--   * ''      => "kosongkan / set null" (user mengosongkan field).
--   * trim() == '' diperlakukan sama seperti '' (kosongkan).
--   * Untuk wa_number, hanya digit + tanda + yang disimpan; whitespace,
--     dash, dan kurung dibersihkan supaya format konsisten saat
--     dipakai membangun URL wa.me.
create function public.update_my_profile(
  p_full_name text default null,
  p_avatar_url text default null,
  p_wa_number text default null,
  p_notification_prefs jsonb default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
  v_clean_wa text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_wa_number is null then
    v_clean_wa := null;
  elsif trim(p_wa_number) = '' then
    v_clean_wa := '';
  else
    -- Normalisasi: pertahankan + di awal kalau ada, sisanya digit saja.
    v_clean_wa := regexp_replace(trim(p_wa_number), '[^0-9+]', '', 'g');
    if length(v_clean_wa) < 6 then
      raise exception 'Nomor WhatsApp tidak valid (minimal 6 digit)';
    end if;
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
         wa_number = case
                       when p_wa_number is null then wa_number
                       when v_clean_wa = '' then null
                       else v_clean_wa
                     end,
         notification_prefs = case
                                when p_notification_prefs is null
                                  then notification_prefs
                                else p_notification_prefs
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

revoke all on function public.update_my_profile(text, text, text, jsonb) from public;
grant execute on function public.update_my_profile(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Realtime: subscribe perubahan status laporan
--
-- Supabase Realtime mengamati publication "supabase_realtime". Kita add
-- tabel public.reports kalau belum terdaftar. RLS reports tetap berlaku
-- untuk pesan yang dikirim ke client.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'reports'
  ) then
    -- Bisa gagal pada self-hosted minimal yang belum punya publication
    -- supabase_realtime; bungkus aman dengan exception handler.
    begin
      execute 'alter publication supabase_realtime add table public.reports';
      raise notice 'Added public.reports to supabase_realtime publication';
    exception when others then
      raise notice 'Skip add to publication: %', SQLERRM;
    end;
  else
    raise notice 'public.reports already in supabase_realtime publication';
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 4) Sanity-check
-- ---------------------------------------------------------------------------

do $$
declare
  v_has_wa boolean;
  v_has_prefs boolean;
  v_rpc_args text;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'wa_number'
  ) into v_has_wa;
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'notification_prefs'
  ) into v_has_prefs;
  select pg_get_function_identity_arguments(p.oid)
    into v_rpc_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'update_my_profile';

  if not v_has_wa then
    raise exception '0012: profiles.wa_number tidak terbentuk';
  end if;
  if not v_has_prefs then
    raise exception '0012: profiles.notification_prefs tidak terbentuk';
  end if;
  raise notice '0012_notifications_and_wa applied — update_my_profile(%) OK', v_rpc_args;
end$$;
