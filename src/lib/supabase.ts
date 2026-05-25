import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const key = publishableKey ?? anonKey;

export let supabaseConfigError: string | null = null;

if (!url || !key) {
  supabaseConfigError =
    "Konfigurasi Supabase belum lengkap. Set VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY di .env.local atau env hosting.";
}

/**
 * Single Supabase client untuk seluruh app. Saat env belum lengkap,
 * client diinisialisasi dengan placeholder agar import-import tidak
 * crash; halaman ConfigError yang menjelaskan masalah ke user.
 */
export const supabase: SupabaseClient = createClient(
  url ?? "https://placeholder.supabase.co",
  key ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // detectSessionInUrl: true diperlukan agar reset-password link
      // (yang membawa ?code=...) otomatis di-exchange jadi recovery
      // session oleh supabase-js saat user mendarat di /reset-password.
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  },
);
