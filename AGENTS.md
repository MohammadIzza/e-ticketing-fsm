# AGENTS.md

Working rules for AI agents (Kiro, Copilot, Cursor, Claude, etc.) contributing
to this repository.

## Project Snapshot

- App: **FSM LAPOR!**
- Stack: Vite + React 18 + TypeScript + react-router-dom + vite-plugin-pwa +
  Dexie + Supabase (Auth + Postgres + Storage)
- Roles: `pelapor`, `superadmin`, `pimpinan`, `petugas`. Disimpan di
  `public.user_roles` dan dibaca lewat RLS — **bukan** dari localStorage.

## Scope Rules

1. Jangan tambah backend di luar Supabase.
2. Jangan rusak fitur lokal: kamera, IndexedDB (Dexie), service worker. Ini
   tetap berjalan walaupun offline.
3. Jangan ganti UI framework, bundler, bahasa, atau DB wrapper.
4. Test tidak ditambahkan kecuali user secara eksplisit meminta.
5. Jangan ekspos role lewat `localStorage` / `user_metadata`. Gating UI
   boleh, tapi keamanan akhir adalah RLS.

## Auth Rules

- Superadmin login pakai username; frontend memanggil RPC
  `find_email_by_username` lalu `signInWithPassword`. Email tidak boleh
  ditampilkan di UI.
- User biasa (`pelapor`) login dengan email/password. Trigger
  `handle_new_user` yang mengisi profile + role default.
- Role superadmin **hanya** dapat di-set lewat service-role (script
  `npm run setup:superadmin`). Tidak boleh ada UI yang men-set role.
- `SUPABASE_SERVICE_ROLE_KEY` tidak boleh dibundle ke frontend. Variable
  yang berprefix `VITE_` masuk ke bundle browser.

## PWA Rules

- Manifest single source of truth di `vite.config.ts`.
- `registerType: "autoUpdate"`.
- Icon harus mencakup `192x192` dan `512x512` (yang 512 juga `maskable`).
- Service worker dimatikan di dev (`devOptions.enabled: false`).

## IndexedDB Rules

- Schema diatur lewat `Dexie.version().stores()`.
- Setiap perubahan schema = naikkan versi + tambah `upgrade()` block,
  jangan rewrite versi lama.
- Database name (`fsm-lapor`) tidak diganti tanpa rencana migrasi.

## Storage Rules

- Bucket `profile-avatars`, layout `avatars/{user_id}/{ts}.{ext}`.
- Hanya owner yang INSERT/UPDATE/DELETE; SELECT bebas (avatar public).

## Definition of Done

- [ ] `npm install` sukses.
- [ ] `npm run lint` sukses.
- [ ] `npm run build` sukses.
- [ ] `npm run preview` melayani app, service worker aktif.
- [ ] Manifest di DevTools memunculkan **FSM LAPOR!** + icon.
- [ ] User belum login tidak bisa membuka `/laporan` (di-redirect ke `/login`).
- [ ] Tidak ada service-role key / `sb_secret_*` di diff.

## Commit / PR Style

- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- Satu logical change per PR.
- Body PR: apa yang berubah, kenapa, cara test, migrasi DB baru (bila ada).
