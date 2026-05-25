#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Idempotent setup script untuk akun superadmin.
 *
 * Yang dilakukan:
 *   1. Buat (atau temukan) user di Supabase Auth dengan SUPERADMIN_EMAIL.
 *   2. Pastikan ada row di public.profiles dengan username SUPERADMIN_USERNAME
 *      dan full_name SUPERADMIN_FULL_NAME (di-update kalau berbeda).
 *   3. Pastikan user_roles memiliki role 'superadmin' DAN 'pimpinan'.
 *   4. Hapus role 'pelapor' dari user superadmin (sesuai aturan: superadmin
 *      punya role superadmin + pimpinan).
 *
 * Aman dijalankan berulang kali — tidak akan error kalau objek sudah ada.
 *
 * Cara pakai:
 *   1. Salin .env.admin.local.example -> .env.admin.local, isi nilainya.
 *   2. Pastikan migrasi 0001 + 0002 sudah dijalankan di Supabase.
 *   3. npm run setup:superadmin
 */
import { createClient } from "@supabase/supabase-js";

// Node 20 tidak punya WebSocket native; @supabase/supabase-js@^2.53
// mem-init RealtimeClient dari konstruktor SupabaseClient sehingga
// createClient akan crash bila tidak diberi transport.
// Workaround portable: pakai package `ws` sebagai transport.
// Aman juga untuk Node 22+ (tidak dipakai jika WebSocket native tersedia,
// tetapi tidak menimbulkan masalah).
let wsTransport;
try {
  wsTransport = (await import("ws")).default;
} catch {
  wsTransport = undefined;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`[setup:superadmin] Missing env: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const EMAIL = requireEnv("SUPERADMIN_EMAIL");
const PASSWORD = requireEnv("SUPERADMIN_PASSWORD");
const USERNAME = requireEnv("SUPERADMIN_USERNAME").toLowerCase();
const FULL_NAME = process.env.SUPERADMIN_FULL_NAME?.trim() || "Superadmin";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  ...(wsTransport ? { realtime: { transport: wsTransport } } : {}),
});

async function findUserByEmail(email) {
  // Paginate listUsers until we find the email (small projects -> page 1 cukup).
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const found = data.users.find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureAuthUser() {
  const existing = await findUserByEmail(EMAIL);
  if (existing) {
    console.log(`[setup:superadmin] auth user exists: ${existing.id}`);
    // Pastikan password tetap sesuai .env.admin.local + metadata di-sync.
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        username: USERNAME,
        full_name: FULL_NAME,
      },
    });
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      username: USERNAME,
      full_name: FULL_NAME,
    },
  });
  if (error) throw error;
  console.log(`[setup:superadmin] created auth user: ${data.user.id}`);
  return data.user.id;
}

async function ensureProfile(userId) {
  // Trigger handle_new_user mungkin sudah membuat row profile saat user dibuat.
  // Sinkronkan username + full_name supaya tetap sesuai env.
  const { data: existing, error: selErr } = await admin
    .from("profiles")
    .select("id, username, full_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (selErr) throw selErr;

  if (!existing) {
    const { error: insErr } = await admin.from("profiles").insert({
      id: userId,
      email: EMAIL,
      username: USERNAME,
      full_name: FULL_NAME,
    });
    if (insErr) throw insErr;
    console.log("[setup:superadmin] inserted profile row");
    return;
  }

  if (
    existing.username !== USERNAME ||
    existing.full_name !== FULL_NAME ||
    existing.email !== EMAIL
  ) {
    const { error: updErr } = await admin
      .from("profiles")
      .update({
        username: USERNAME,
        full_name: FULL_NAME,
        email: EMAIL,
      })
      .eq("id", userId);
    if (updErr) throw updErr;
    console.log("[setup:superadmin] updated profile row");
  } else {
    console.log("[setup:superadmin] profile already in sync");
  }
}

async function ensureRoles(userId) {
  // Hapus 'pelapor' dari superadmin agar tidak ganda.
  const { error: delErr } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", "pelapor");
  if (delErr) throw delErr;

  for (const role of ["superadmin", "pimpinan"]) {
    const { error: upErr } = await admin
      .from("user_roles")
      .upsert(
        { user_id: userId, role },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (upErr) throw upErr;
  }
  console.log("[setup:superadmin] roles ensured: superadmin, pimpinan");
}

async function main() {
  console.log(`[setup:superadmin] target email=${EMAIL} username=${USERNAME}`);
  const userId = await ensureAuthUser();
  await ensureProfile(userId);
  await ensureRoles(userId);
  console.log("[setup:superadmin] done");
}

main().catch((err) => {
  console.error("[setup:superadmin] failed:", err);
  process.exit(1);
});
