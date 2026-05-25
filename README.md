# FSM LAPOR!

PWA pelaporan dengan kamera + IndexedDB lokal, dipayungi auth Supabase
sederhana (superadmin + pelapor).

## Setup minimal (untuk owner repo)

Anda **tidak perlu menjalankan apa pun di lokal**. Semuanya berjalan di
GitHub Actions. Yang harus Anda kerjakan hanya 3 langkah:

### 1. Buat project Supabase (gratis)

1. Daftar / login di <https://supabase.com>.
2. **New project**. Tunggu sampai siap.
3. Catat 3 nilai berikut dari **Project Settings**:

   | Nilai                       | Lokasi di Supabase Dashboard                                                  |
   | --------------------------- | ----------------------------------------------------------------------------- |
   | `SUPABASE_URL`              | Project Settings → API → **Project URL**                                       |
   | `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → **service_role** (klik Reveal)                        |
   | `SUPABASE_DB_URL`           | Project Settings → Database → **Connection string** → URI (mode Session, 5432) |

   `SUPABASE_DB_URL` bentuknya kira-kira
   `postgresql://postgres.<ref>:<password>@aws-0-...supabase.com:5432/postgres`.

   Selain itu catat juga **anon / publishable key** (Project Settings → API).
   Itu untuk frontend di langkah 3.

### 2. Tambah secret + jalankan workflow setup

1. Repo GitHub → **Settings → Secrets and variables → Actions**.
2. Tab **Secrets**, klik **New repository secret**, tambahkan tiga ini:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_DB_URL`

3. Buka tab **Actions** → workflow **Bootstrap Supabase (one-click setup)** →
   **Run workflow** → ketik `YES` di field konfirmasi → **Run workflow**.

   Workflow akan:

   - menjalankan semua migrasi di `supabase/migrations/` ke project Supabase Anda
   - membuat user superadmin di Supabase Auth
   - mengisi profile (`username = superrasyid`)
   - memberi role `superadmin` + `pimpinan`

   Workflow ini **idempotent** — aman dijalankan ulang kapan pun (mis. setelah
   menambah migrasi baru).

### 3. Deploy frontend ke Vercel

1. Login ke <https://vercel.com>, **Import Git Repository** → pilih repo ini.
2. Framework: Vite. Output: `dist`. Build command: `npm run build` (default).
3. **Environment Variables** — tambahkan dua key:

   - `VITE_SUPABASE_URL` = nilai `SUPABASE_URL` Anda
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = anon / publishable key

4. **Deploy**. Selesai.

> Tidak ingin pakai Vercel? Output `dist/` adalah static — bisa di-host di
> Netlify, Cloudflare Pages, atau di mana saja. Pastikan dua env `VITE_*`
> di atas tersedia saat build.

### Login pertama kali

- Superadmin: `/superadmin/login` → username `superrasyid`, password
  `kerasaktimigunani`.
- User biasa: `/register` → daftar dengan email/password → otomatis role
  `pelapor` → diarahkan ke `/profile`.

## Routes

| Path                | Akses              | Halaman                                |
| ------------------- | ------------------ | -------------------------------------- |
| `/superadmin/login` | publik             | login superadmin (username + password) |
| `/superadmin`       | superadmin         | profil superadmin (edit nama + foto)   |
| `/login`            | publik             | login user biasa (email + password)    |
| `/register`         | publik             | daftar user (auto role pelapor)        |
| `/profile`          | user login         | profil pelapor (edit nama + foto)      |
| `/laporan`          | siapa saja login   | kamera + buat laporan + list lokal     |

`/laporan` menolak akses tanpa session — diarahkan ke `/login`.

## Tech Stack

- Vite 5 + React 18 + TypeScript 5 strict
- react-router-dom 6
- vite-plugin-pwa (Workbox, autoUpdate)
- Dexie.js — penyimpanan laporan offline (IndexedDB)
- Supabase — Auth, Postgres + RLS, Storage

## Roles

- `pelapor` — default semua user baru (di-set oleh trigger `handle_new_user`)
- `superadmin` — di-set oleh workflow Bootstrap
- `pimpinan` — superadmin juga punya role ini
- `petugas` — disiapkan untuk pengembangan ke depan

`useAuth().isSuperadmin` selalu dibaca dari `public.user_roles` yang
RLS-protected, bukan dari `localStorage`.

## Database

- `0001_init.sql` — `profiles`, `user_roles`, RLS, trigger `handle_new_user`,
  RPC `find_email_by_username`, RPC `update_my_profile`
- `0002_storage.sql` — bucket `profile-avatars` + storage policies
  (path `avatars/{user_id}/{ts}.{ext}`, owner-only write)

## Mau jalankan / develop di lokal?

Optional. Yang dibutuhkan hanyalah Node 20+.

```bash
npm install
npm run dev          # localhost:5173
npm run build
npm run preview
npm run lint
npm run test
```

Buat `.env.local`:

```env
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key>
```

Untuk script setup superadmin lokal: salin `.env.admin.local.example`
ke `.env.admin.local`, isi service-role key, lalu
`npm run setup:superadmin`. **Tidak wajib** — workflow GitHub Actions
sudah melakukan hal yang sama.
