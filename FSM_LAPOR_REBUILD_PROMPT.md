# FSM LAPOR! — Full Rebuild Prompt

> **Tujuan:** Bangun ulang aplikasi **FSM LAPOR!** — sistem pelaporan berbasis web untuk organisasi/instansi — dari awal menggunakan stack modern. Dokumen ini adalah prompt lengkap yang dapat diberikan langsung ke AI coding assistant untuk mereproduksi seluruh fitur aplikasi.

---

## 1. GAMBARAN UMUM APLIKASI

**FSM LAPOR!** adalah aplikasi web PWA (Progressive Web App) untuk pelaporan masalah/insiden berbasis foto dan lokasi GPS, dilengkapi workflow manajemen laporan multi-role serta modul survey kondisi aset.

**Nama Aplikasi:** FSM LAPOR!
**Versi:** 0.2.0
**Bahasa antarmuka:** Bahasa Indonesia

### Fitur Utama:
1. **Autentikasi multi-role** (Pelapor, Pimpinan, Petugas, Superadmin)
2. **Buat Laporan** dengan foto kamera, deskripsi, kategori, SLA, dan GPS otomatis
3. **Workflow laporan**: Dikirim → Diterima → Ditugaskan → Diselesaikan → Diverifikasi
4. **Manajemen laporan** dengan filter, pencarian, pagination
5. **Multi-penugasan**: satu laporan dapat ditugaskan ke banyak petugas (maks. 10)
6. **SLA tracking** dengan countdown dan status "Melebihi SLA"
7. **Notifikasi realtime** in-app + browser Notification API + nada dering (Web Audio)
8. **Dashboard** multi-view (Pelapor / Petugas / Pimpinan) dengan statistik
9. **Manajemen master data**: kategori laporan, jabatan, jenis pelapor
10. **Modul Survey Aset**: pencatatan & survey kondisi aset per ruang (PDCA: Plan-Do-Check)
11. **PWA** dengan service worker, offline screen, auto-update
12. **Profil user**: avatar, nomor WhatsApp opsional, preferensi notifikasi


---

## 2. TECH STACK

```
Frontend:
  - Vite 5 (build tool)
  - React 18 + TypeScript 5 strict mode
  - react-router-dom v6 (client-side routing)
  - vite-plugin-pwa (Workbox, autoUpdate, manifest)
  - Supabase JS Client v2 (@supabase/supabase-js)
  - TIDAK ada UI component library — semua UI dibuat dengan plain CSS

Backend / BaaS:
  - Supabase (Auth, PostgreSQL + RLS, Storage, Realtime)
  - TIDAK ada server-side backend lain selain Supabase

Testing:
  - Vitest + @testing-library/react
  - jsdom

CI/CD:
  - GitHub Actions (bootstrap.yml + ci.yml)
  - Deploy: Vercel / Netlify / Cloudflare Pages (static output dist/)
```

### Environment Variables:
```env
# Wajib untuk frontend
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>

# Hanya untuk script admin (JANGAN masuk bundle)
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPERADMIN_EMAIL=superadmin@fsm-lapor.local
SUPERADMIN_PASSWORD=kerasaktimigunani
SUPERADMIN_USERNAME=superrasyid
SUPERADMIN_FULL_NAME=Superadmin
```


---

## 3. SISTEM ROLE & AUTENTIKASI

### Role yang Ada:
| Role | Deskripsi |
|---|---|
| `pelapor` | Default untuk semua user baru. Bisa membuat & melihat laporan sendiri. |
| `superadmin` | Akses penuh ke semua fitur. Login pakai username (bukan email). |
| `pimpinan` | Bisa menerima, menugaskan, dan memverifikasi laporan sesuai jabatan. |
| `petugas` | Bisa menyelesaikan laporan yang ditugaskan kepadanya. |

**Aturan Role:**
- Role disimpan di tabel `public.user_roles`, BUKAN di localStorage atau user_metadata.
- Role `pelapor` di-set otomatis oleh trigger database saat user baru daftar.
- Role `superadmin` HANYA bisa di-set via service-role script/workflow — tidak ada UI untuk itu.
- Role `pimpinan` dan `petugas` di-set oleh superadmin via halaman Manajemen Pengguna.
- User bisa memiliki banyak role sekaligus (misal: superadmin + pimpinan).

### Alur Login:
- **User biasa (pelapor/petugas/pimpinan):** Email + password → `/login`
- **Superadmin:** Username + password → `/superadmin/login`
  - Frontend memanggil RPC `find_email_by_username(username)` untuk mendapat email, lalu `signInWithPassword`.
  - Email superadmin TIDAK pernah ditampilkan di UI.
- **Daftar akun baru:** `/register` → otomatis role `pelapor` via trigger DB.
- **Reset password:** `/forgot-password` → email → `/reset-password` (PKCE flow, `detectSessionInUrl: true`).

### Auth Context (`useAuth`):
```typescript
interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: Role[];
  isSuperadmin: boolean;
  loading: boolean;
  profileLoading: boolean;
  recoveryMode: boolean;           // true saat session dari link reset password
  refreshProfile: () => Promise<void>;
  signInWithEmail: (email, password) => Promise<{error: string | null}>;
  signInSuperadmin: (username, password) => Promise<{error: string | null}>;
  signUp: ({email, password, fullName}) => Promise<{error: string | null}>;
  signOut: () => Promise<void>;
  updateMyProfile: ({fullName?, avatarUrl?, waNumber?, notificationPrefs?}) => Promise<{error}>;
  uploadAvatar: (file: File|Blob) => Promise<{url, error}>;
  requestPasswordReset: () => Promise<{error}>;
  sendPasswordResetTo: (email) => Promise<{error}>;
  updatePassword: (newPassword) => Promise<{error}>;
}
```


---

## 4. SKEMA DATABASE (Supabase / PostgreSQL)

### Tabel-tabel Utama:

#### `public.profiles`
```sql
id uuid PK (references auth.users, on delete cascade)
username text UNIQUE
email text
full_name text
avatar_url text
position_id uuid FK → positions (nullable)
reporter_type_id uuid FK → reporter_types (nullable)
wa_number text               -- nomor WhatsApp opsional
notification_prefs jsonb     -- default '{}'
created_at timestamptz
updated_at timestamptz
```

#### `public.user_roles`
```sql
id uuid PK
user_id uuid FK → auth.users (on delete cascade)
role text CHECK IN ('pelapor','superadmin','pimpinan','petugas')
created_at timestamptz
UNIQUE (user_id, role)
```

#### `public.categories`
```sql
id uuid PK
name text UNIQUE
description text
is_active boolean DEFAULT true
requires_pimpinan_verification boolean DEFAULT false
self_executable boolean DEFAULT false  -- pelapor bisa selesaikan sendiri
created_at, updated_at timestamptz
```

#### `public.category_sla_options`
```sql
id uuid PK
category_id uuid FK → categories (on delete cascade)
hours integer CHECK > 0
label text
sort_order integer DEFAULT 0
created_at timestamptz
```

#### `public.category_positions`
```sql
category_id uuid FK → categories (on delete cascade)
position_id uuid FK → positions (on delete cascade)
PRIMARY KEY (category_id, position_id)
```

#### `public.positions`
```sql
id uuid PK
name text UNIQUE
description text
is_active boolean DEFAULT true
created_at, updated_at timestamptz
```

#### `public.reporter_types`
```sql
id uuid PK
name text UNIQUE
description text
is_active boolean DEFAULT true
created_at, updated_at timestamptz
```


#### `public.reports`
```sql
id uuid PK
user_id uuid FK → profiles (on delete cascade)
category_id uuid FK → categories (on delete cascade, nullable)
photo_url text NOT NULL          -- URL di bucket report-photos (public)
description text NOT NULL
status text DEFAULT 'dikirim' CHECK IN ('dikirim','diterima','ditugaskan','diselesaikan')
assigned_to uuid FK → profiles (on delete set null, nullable)  -- legacy primary assignee
latitude double precision NULLABLE
longitude double precision NULLABLE
accuracy_m double precision NULLABLE
geo_captured_at timestamptz NULLABLE
sla_option_id uuid FK → category_sla_options (on delete set null, nullable)
sla_due_at timestamptz NULLABLE   -- dihitung otomatis oleh trigger dari sla_option_id
completion_note text NULLABLE
completion_photo_url text NULLABLE
pending_verification boolean DEFAULT false
verified_at timestamptz NULLABLE
verified_by uuid FK → profiles (on delete set null, nullable)
created_at, updated_at timestamptz
```

#### `public.report_assignees` (multi-assignee, maks 10)
```sql
id uuid PK
report_id uuid FK → reports (on delete cascade)
assignee_id uuid FK → profiles (on delete cascade)
note text NULLABLE
assigned_at timestamptz DEFAULT now()
assigned_by uuid FK → profiles (on delete set null, nullable)
UNIQUE (report_id, assignee_id)
```

#### `public.report_status_history`
```sql
id uuid PK
report_id uuid FK → reports (on delete cascade)
status text CHECK IN ('dikirim','diterima','ditugaskan','diselesaikan')
changed_by uuid FK → profiles (on delete set null, nullable)
changed_at timestamptz DEFAULT now()
note text NULLABLE
```

### Storage Buckets:
| Bucket | Path Layout | Akses |
|---|---|---|
| `profile-avatars` | `avatars/{user_id}/{timestamp}.{ext}` | Owner write, public read |
| `report-photos` | `reports/{user_id}/{timestamp}.{ext}` | Owner write, public read |

### Trigger Penting:
- `handle_new_user` — setelah INSERT ke `auth.users`: buat `profiles` + role `pelapor`
- `touch_updated_at` — sebelum UPDATE: set `updated_at = now()`
- `log_report_status_change` — setelah INSERT/UPDATE `reports`: tulis ke `report_status_history`
- `compute_report_sla_due` — sebelum INSERT `reports`: hitung `sla_due_at` dari `sla_option_id`
- `enforce_report_assignees_limit` — sebelum INSERT `report_assignees`: max 10 per laporan
- `assets_log_condition_change` — setelah UPDATE `assets`: tulis ke `asset_history`


---

## 5. ROW LEVEL SECURITY (RLS)

### Prinsip RLS:
- Semua tabel menggunakan `ENABLE ROW LEVEL SECURITY`.
- Helper functions SECURITY DEFINER: `is_superadmin()`, `is_pimpinan()`, `is_petugas()`, `can_pimpinan_handle_category(user_id, category_id)`, `has_survey_access(user_id)`.
- `can_pimpinan_handle_category`: jika `category_positions` kosong untuk kategori tersebut, semua pimpinan boleh menangani (backward compat).

### Kebijakan Utama:

**profiles:**
- SELECT: diri sendiri ATAU superadmin ATAU pimpinan ATAU petugas

**user_roles:**
- SELECT: diri sendiri ATAU superadmin
- INSERT/UPDATE/DELETE: hanya via trigger/service-role (tidak ada policy untuk client)

**reports:**
- SELECT: pemilik (`user_id = auth.uid()`) ATAU superadmin ATAU (petugas DAN ada di `report_assignees` atau `assigned_to`) ATAU (pimpinan DAN kategori sesuai jabatan)
- INSERT: pemilik saja (`user_id = auth.uid()`)
- DELETE: superadmin SELALU, atau pemilik HANYA bila `status = 'dikirim'`
- UPDATE: via RPC SECURITY DEFINER saja

**categories, positions, reporter_types:**
- SELECT: semua authenticated
- INSERT/UPDATE/DELETE: superadmin saja

**report_assignees:**
- SELECT: sama scope dengan reports
- INSERT/UPDATE/DELETE: via RPC SECURITY DEFINER saja

---

## 6. RPC (Stored Procedures) PENTING

### Autentikasi & Profil:
- `find_email_by_username(p_username text) → text` — lookup email dari username (untuk login superadmin)
- `email_exists(p_email text) → boolean` — cek duplikat email sebelum register
- `update_my_profile(p_full_name, p_avatar_url, p_wa_number, p_notification_prefs)` — update profil sendiri

### Manajemen User (superadmin only):
- `admin_list_users() → table(...)` — list semua user + role + jabatan + jenis pelapor
- `admin_grant_role(p_user_id, p_role)` — beri role pimpinan/petugas
- `admin_revoke_role(p_user_id, p_role)` — cabut role
- `admin_set_position(p_user_id, p_position_id)` — set jabatan
- `admin_set_reporter_type(p_user_id, p_reporter_type_id)` — set jenis pelapor
- `admin_set_category_positions(p_category_id, p_position_ids[])` — set jabatan yang boleh handle kategori
- `admin_set_category_sla_options(p_category_id, p_options jsonb)` — set opsi SLA

### Workflow Laporan:
- `report_mark_received(p_report_id uuid)` — status: dikirim → diterima (atau langsung ditugaskan jika `self_executable`)
- `report_assign_multi(p_report_id uuid, p_assignees jsonb)` — tugaskan ke banyak petugas `[{id, note?}]`
- `report_assign(p_report_id uuid, p_assignee uuid)` — wrapper single-assignee
- `report_mark_done(p_report_id uuid, p_note text, p_photo_url text)` — tandai selesai dengan catatan + foto bukti
- `report_verify(p_report_id uuid)` — verifikasi penyelesaian (pimpinan)
- `report_history_with_actors(p_report_id uuid) → table(history_id, history_status, history_changed_at, history_note, history_changed_by, changer_full_name, changer_email, changer_username)`
- `report_list_assignees(p_report_id uuid) → table(assignment_id, assignee_id, username, email, full_name, avatar_url, wa_number, note, assigned_at, assigned_by)`
- `report_stats_for_me() → jsonb` — statistik laporan terkait user ini (total, per-status, overdue, hari_ini, pending_verification)
- `list_petugas() → table(id, full_name, email, username, avatar_url)` — list semua petugas (untuk dropdown assign)


---

## 7. ROUTING APLIKASI

```
/ (index)           → redirect berdasarkan session + role
                      - tidak login → /login
                      - superadmin  → /superadmin
                      - lainnya     → /dashboard

/login              → Login user biasa (email + password)
/register           → Daftar akun baru (email + password + nama)
/forgot-password    → Kirim email reset password
/reset-password     → Set password baru (dari link email, PKCE recovery session)

/superadmin/login   → Login superadmin (username + password)
/superadmin         → Dashboard + profil superadmin (+ statistik laporan)
/superadmin/users   → Manajemen pengguna
/superadmin/categories      → Manajemen jenis laporan
/superadmin/positions       → Manajemen jabatan
/superadmin/reporter-types  → Manajemen jenis pelapor
/superadmin/laporan         → Manajemen laporan (sama dengan /manajemen-laporan)

/dashboard          → Dashboard user (multi-view: Pelapor / Petugas / Pimpinan)
/profile            → Profil user (nama, WA, notifikasi, ganti password)
/profile/password   → Ganti password
/profile/contact-admin → Hubungi administrator

/laporan            → Buat laporan baru (foto + deskripsi + kategori + SLA + GPS)
/laporan-saya       → Daftar laporan milik user sendiri
/laporan/:id        → Detail laporan (read + actions sesuai role)
/manajemen-laporan  → Manajemen laporan (untuk pimpinan/petugas/superadmin)

/survey-aset                → Landing page modul Survey Aset
/survey-aset/planning       → Planning survey
/survey-aset/do             → Pengisian survey (checklist kondisi aset)
/survey-aset/check          → Validasi survey (pimpinan)
/survey-aset/rooms          → Daftar ruang & aset
/survey-aset/assets/:assetId → Detail aset + history kondisi
/survey-aset/manage         → Manajemen modul Survey Aset (superadmin: akses, jenis ruang, template, ruang)

* → redirect ke /
```

### Guard Akses:
- Semua route kecuali `/login`, `/register`, `/forgot-password`, `/superadmin/login`, `/reset-password` memerlukan session.
- `/superadmin/*` memerlukan role `superadmin`.
- `/manajemen-laporan` memerlukan role `superadmin` ATAU `pimpinan` ATAU `petugas`.
- `/survey-aset/*` memerlukan session + izin khusus (tabel `survey_module_access`) atau superadmin.
- Tanpa koneksi internet → tampilkan `OfflineScreen` (blokir seluruh app).
- Jika env vars Supabase belum diset → tampilkan `ConfigError`.


---

## 8. FITUR DETAIL SETIAP HALAMAN

### 8.1 Login (`/login`)
- Form: Email + Password
- Link ke `/forgot-password` dan `/register`
- Jika email belum terverifikasi: pesan error spesifik
- Setelah login sukses: redirect ke `/dashboard`

### 8.2 Register (`/register`)
- Form: Nama Lengkap + Email + Password (min 6 karakter)
- Pre-check via RPC `email_exists` sebelum call `signUp`
- 3 state halaman: form → "cek email" → "email sudah terdaftar"
- Error `EMAIL_ALREADY_REGISTERED`: tampilkan halaman khusus dengan opsi Login / Lupa Password / Email Lain
- Setelah daftar: tampilkan halaman "Cek email Anda" dengan instruksi konfirmasi

### 8.3 Superadmin Login (`/superadmin/login`)
- Form: Username + Password (BUKAN email)
- Proses: `find_email_by_username(username)` → `signInWithPassword(email, password)` → verifikasi role `superadmin`
- Email TIDAK ditampilkan di UI

### 8.4 Dashboard (`/dashboard`)
- Real-time clock (jam:menit:detik + tanggal lengkap Bahasa Indonesia)
- Tab-switcher jika user punya lebih dari satu role: **Pelapor | Petugas | Pimpinan**
- Sapaan dengan nama user (kanan atas header)
- Tombol "Survey dan Aset" hanya muncul jika user punya akses survey

**View Pelapor:**
- Tile ringkasan laporan sendiri: Total, Aktif, Selesai, Melebihi SLA (klik → `/laporan-saya`)
- Tombol besar "Buat Laporan" → `/laporan`

**View Petugas:**
- Statistik tugas: Total, Aktif, Selesai, Melebihi SLA
- Daftar 3 tugas terkini (laporan ber-status `ditugaskan` yang di-assign ke user ini)
- Tombol "Lihat Semua Penugasan" → `/manajemen-laporan`

**View Pimpinan:**
- Statistik laporan dalam wewenang (RPC `report_stats_for_me`)
- Daftar 3 laporan masuk terbaru (status `dikirim`)
- Indikator "Menunggu Verifikasi" jika ada
- Tombol "Lihat Semua Laporan" → `/manajemen-laporan`

### 8.5 Buat Laporan (`/laporan`)
- **Kamera:** komponen `CameraCapture` — akses kamera browser, ambil foto, preview. Ada tombol "Foto Ulang".
- **Jenis Laporan:** dropdown dari `categories` yang `is_active = true`
- **SLA:** dropdown `category_sla_options` untuk kategori terpilih (muncul hanya jika ada opsi)
- **Keterangan:** textarea (deskripsi laporan, lokasi, waktu, detail)
- **GPS:** auto-capture saat mount (`navigator.geolocation.getCurrentPosition`). Tampilkan koordinat + akurasi. Tombol "Refresh" + "Coba Lagi" jika error. Laporan tetap bisa dikirim tanpa GPS.
- Upload foto ke bucket `report-photos`, kemudian INSERT ke `reports`
- Setelah berhasil: redirect ke `/laporan-saya` (atau `/manajemen-laporan` untuk superadmin)

### 8.6 Laporan Saya (`/laporan-saya`)
- List laporan milik user sendiri (`user_id = auth.uid()`)
- Filter: Status (dropdown semua status + melebihi_sla), Cari teks, Tanggal Dari-Sampai
- Reset filter
- Setiap item: foto thumbnail, deskripsi, badge status, kategori, SLA info, catatan penyelesaian, foto bukti, koordinat GPS + link Google Maps
- Actions per item: **Detail** (→ `/laporan/:id`), **Riwayat** (modal timeline), **Hapus** (hanya status `dikirim`)
- Modal Riwayat: timeline status dengan nama aktor dan catatan


### 8.7 Manajemen Laporan (`/manajemen-laporan` atau `/superadmin/laporan`)
- Diakses oleh: superadmin, pimpinan, petugas
- RLS otomatis membatasi: petugas hanya laporan di-assign ke dia, pimpinan hanya laporan sesuai jabatan, superadmin semua
- Pagination: 25 per halaman, tombol "Load More"
- Filter: Status + Cari teks (deskripsi, pelapor, jenis, petugas)
- Setiap item: foto, deskripsi, nama pelapor, jenis laporan, badge status, SLA info, daftar petugas (multi), catatan penyelesaian, foto bukti, koordinat GPS + link Maps, badge "Menunggu Verifikasi"

**Actions per laporan (berdasarkan role + status):**
- **Terima** — pimpinan, status `dikirim` → `diterima`
- **Tugaskan** — pimpinan, status `dikirim` atau `diterima` → modal multi-assign (kecuali kategori `self_executable`)
- **Selesai** — petugas yang di-assign / superadmin, status `ditugaskan` → modal input catatan + foto bukti
- **Verifikasi** — pimpinan, status `diselesaikan` + `pending_verification=true`
- **Hapus** — superadmin selalu, pemilik hanya jika `dikirim`
- **Riwayat** — semua, buka modal timeline

**Modal Tugaskan (Multi-Assign):**
- List semua petugas (dari RPC `list_petugas`)
- Checkbox per petugas + input catatan opsional per petugas
- Pre-populate dari assignment yang sudah ada (re-assign = hapus lama + insert baru)
- Maksimum 10 petugas
- Konfirmasi: tampilkan jumlah petugas yang dipilih

**Modal Selesai:**
- Input catatan penyelesaian (wajib)
- Komponen CameraCapture untuk foto bukti (wajib)
- Upload foto ke `report-photos`, panggil RPC `report_mark_done`

### 8.8 Detail Laporan (`/laporan/:id`)
- Halaman penuh detail satu laporan
- Hero section: foto besar + badge status + kategori + tanggal
- Action bar: tombol aksi tersedia (sama logika dengan manajemen)
- Info Laporan: pelapor, jenis, status, petugas ditugaskan (multi), SLA countdown, catatan penyelesaian, foto bukti, GPS + link Maps
- **Nomor WA Petugas:** pelapor (owner) dapat melihat nomor WA petugas yang ditugaskan + tombol "Chat WA" (wa.me link). Default: disembunyikan (masked), klik "Tampilkan" untuk reveal.
- **Nomor WA Pelapor:** hanya superadmin yang dapat melihat, dengan toggle show/hide
- Jenis Pelapor ditampilkan sebagai badge di info pelapor
- Timeline riwayat status (langsung tampil, tidak perlu modal)
- SLA Countdown: format human-readable "Sisa X hari Y jam" / "Terlambat X jam" dengan warna ok/warn/danger

### 8.9 Profil User (`/profile`)
- Avatar upload (komponen `AvatarBlock` dengan upload ke `profile-avatars`)
- Info: Nama, Email, Status Verifikasi Email, Nomor WA, Role (sebagai pill/badge)
- Edit Nama (inline form)
- Edit Nomor WhatsApp (opsional, validasi minimal 6 digit)
- **Preferensi Notifikasi:**
  - Master switch "Aktifkan notifikasi" (meminta permission browser saat diaktifkan)
  - Per-event toggle: Laporan diterima, Laporan ditugaskan, Laporan diselesaikan, Penyelesaian diverifikasi
  - Saat master switch pertama kali diaktifkan → semua event toggle otomatis ON
  - Tombol "Tes Notifikasi" — kirim test notification + in-app toast + nada dering
  - Warning jika permission "denied" atau browser tidak support
- Tombol: Ganti Password, Hubungi Administrator, Logout

### 8.10 Superadmin Dashboard (`/superadmin`)
- Avatar + info profil (username, nama, role)
- Edit nama
- Tile besar "Manajemen Laporan" dengan statistik ringkasan (total, belum selesai, selesai, menunggu verifikasi, melebihi SLA, hari ini)
- Tombol navigasi: Manajemen Pengguna, Jenis Laporan, Manajemen Jabatan, Manajemen Jenis Pelapor, Buat Laporan, Survey dan Aset, Logout


### 8.11 Manajemen Pengguna (`/superadmin/users`)
- Tabel semua user: nama, email/username, role (chips), jabatan, jenis pelapor
- Filter/Search: nama, email, username, jabatan, jenis pelapor
- Setiap user memiliki:
  - Toggle role `pimpinan` dan `petugas` (tombol: "+ pimpinan" / "✓ pimpinan")
  - Dropdown jabatan (hanya muncul jika user adalah pimpinan)
  - Dropdown jenis pelapor
- Role `superadmin` tidak bisa diubah dari UI ini
- Data dari RPC `admin_list_users()`

### 8.12 Jenis Laporan / Kategori (`/superadmin/categories`)
- Tambah jenis laporan (nama + deskripsi opsional)
- List semua kategori dengan badge: Aktif/Nonaktif, "Perlu Verifikasi", "Bisa Dikerjakan Sendiri"
- Actions: **Kriteria**, **Aktifkan/Nonaktifkan**, **Hapus** (warning: laporan terkait ikut terhapus)
- **Modal Kriteria** per kategori:
  - Checkbox "Perlu diverifikasi pimpinan setelah diselesaikan"
  - Checkbox "Bisa dikerjakan sendiri" (self-executable: pelapor bisa menyelesaikan sendiri)
  - Jabatan pimpinan yang berhak (multi-checkbox dari daftar positions)
  - Opsi SLA: tambah/hapus/edit pasangan (jam, label). Contoh: "24 jam - 1 hari"

### 8.13 Manajemen Jabatan (`/superadmin/positions`)
- CRUD jabatan: nama + deskripsi opsional
- Toggle Aktif/Nonaktif, Hapus (warning: user dan kategori yang terhubung akan terputus)

### 8.14 Manajemen Jenis Pelapor (`/superadmin/reporter-types`)
- CRUD jenis pelapor: nama + deskripsi opsional
- Toggle Aktif/Nonaktif, Hapus

### 8.15 Ganti Password (`/profile/password`)
- Form ganti password (current password + new password + konfirmasi)
- Atau gunakan flow "reset via email" dari halaman profil

### 8.16 Hubungi Administrator (`/profile/contact-admin`)
- Tampilkan kontak/informasi administrator
- Navigasi balik ke profil

### 8.17 Forgot Password & Reset Password
- `/forgot-password`: Form email → kirim link reset via `sendPasswordResetTo(email)`
- `/reset-password`: Dari link email (membawa `?code=...`) → supabase-js PKCE deteksi otomatis `PASSWORD_RECOVERY` event → set `recoveryMode = true` → tampilkan form set password baru

---

## 9. MODUL SURVEY ASET

### Database Tambahan (Survey):
```
survey_module_access  — izin user masuk modul (superadmin grant/revoke)
room_types            — jenis ruang (Kelas, Lab, Kantor, dll)
room_type_asset_templates — template aset default per jenis ruang
rooms                 — ruang konkret (kode, nama, gedung, lantai, jenis)
assets                — aset konkret per ruang (nama, kode, kondisi current)
asset_surveys         — instance survey (title, status, room_id, creator, validator)
asset_survey_items    — checklist: satu baris per (survey, aset) dengan kondisi + catatan + foto + report_id
asset_history         — log perubahan kondisi aset
```

### Status Survey:
`draft` → `in_progress` → `submitted` → `validated` (atau `needs_revision` → `in_progress` → `submitted`)

### Kondisi Aset:
`baik` | `rusak_ringan` | `rusak_berat` | `tidak_ditemukan` | `perlu_diganti`

### Access Control Survey:
- **Superadmin:** akses penuh ke semua fitur modul
- **Petugas/Pimpinan:** akses hanya jika ada baris di `survey_module_access.enabled = true`
- Superadmin grant/revoke akses via tab "Akses Modul" di halaman Manajemen Survey Aset
- Tombol "Survey dan Aset" di dashboard hanya muncul jika user punya akses

### Sub-menu berdasarkan role:
| Sub-menu | Superadmin | Petugas | Pimpinan |
|---|---|---|---|
| Manajemen Survey Aset | ✅ | ❌ | ❌ |
| Planning Survey | ✅ | ✅ | ❌ |
| Do Survey | ✅ | ✅ | ❌ |
| Check Survey | ✅ | ❌ | ✅ |
| Daftar Ruang & Aset | ✅ | ✅ | ✅ |


### Halaman Survey:

**Planning Survey (`/survey-aset/planning`):**
- Pilih ruang, buat survey baru dengan judul
- RPC `survey_create(title, room_id)` → membuat `asset_surveys` + init semua `asset_survey_items` untuk aset di ruang tersebut

**Do Survey (`/survey-aset/do`):**
- List survey aktif milik user (status `draft`, `in_progress`, `needs_revision`)
- Buka survey → checklist semua aset di ruang
- Per aset: pilih kondisi, isi catatan, upload foto
- RPC `survey_save_item(item_id, condition, note, photo_url)`
- Tombol "Tandai Semua Baik" → RPC `survey_mark_all_good(survey_id)`
- Tombol "Submit" → RPC `survey_submit(survey_id)` (validasi semua item terisi)
- Jika kondisi rusak: tombol "Buat Laporan" → buka form insert laporan FSM LAPOR dari aset ini (RPC `survey_create_report_from_asset`)

**Check Survey (`/survey-aset/check`):**
- List survey yang sudah di-submit (status `submitted`)
- Review checklist kondisi aset
- Tombol "Validasi" → RPC `survey_validate(survey_id, note?)` → propagasi kondisi ke `assets.current_condition`
- Tombol "Minta Revisi" → RPC `survey_request_revision(survey_id, note)` (catatan wajib)

**Daftar Ruang & Aset (`/survey-aset/rooms`):**
- List semua ruang
- Klik ruang → list aset dengan kondisi terkini

**Detail Aset (`/survey-aset/assets/:assetId`):**
- Info aset: nama, kode, kondisi terkini, catatan
- History perubahan kondisi

**Manajemen Survey Aset (`/survey-aset/manage`) — superadmin only:**
- Tab 1 "Akses Modul": list petugas/pimpinan, toggle grant/revoke akses
- Tab 2 "Jenis Ruang": CRUD `room_types`
- Tab 3 "Template Aset": pilih jenis ruang → tambah/hapus template aset (nama + jumlah default)
- Tab 4 "Ruang": CRUD `rooms` (kode, nama, gedung, lantai, jenis) + tombol "Apply Template Aset" (RPC `survey_apply_template`)

---

## 10. SISTEM NOTIFIKASI

### Arsitektur Notifikasi (3 channel):
1. **Browser Notification API** — system-level, muncul di notification center
2. **In-App Toast Banner** — popup di atas layar (fallback saat tab fokus atau iOS)
3. **Web Audio Ringtone** — nada dering pendek dari Web Audio API (tanpa file audio eksternal)

### Events yang Dinotifikasi:
| Event Key | Kondisi | Penerima |
|---|---|---|
| `diterima` | Status berubah → diterima | Pelapor (owner) |
| `ditugaskan` | Status berubah → ditugaskan | Pelapor + Petugas yang di-assign |
| `diselesaikan` | Status berubah → diselesaikan | Pelapor |
| `verified` | `verified_at` diisi + status diselesaikan | Pelapor |

### Preferensi Notifikasi:
```typescript
interface NotificationPrefs {
  enabled?: boolean;    // master switch
  diterima?: boolean;
  ditugaskan?: boolean;
  diselesaikan?: boolean;
  verified?: boolean;
}
```
- Disimpan di `profiles.notification_prefs` (jsonb)
- Default: semua off `{}`
- Dikelola user dari `/profile`

### Realtime Subscription:
- Subscribe ke `UPDATE` pada `public.reports` + `INSERT`/`DELETE` pada `public.report_assignees`
- Set `REPLICA IDENTITY FULL` pada tabel `report_assignees` agar payload DELETE berisi data lama
- Channel name: `report-notif-{userId}`
- Cleanup saat unmount atau `enabled` berubah menjadi false

### Ringtone (Web Audio API):
- 4 tone pendek (880Hz / 660Hz bergantian, 180ms each)
- Fade-in/out 20ms tiap tone (tidak ada klik tajam)
- Total durasi ~0.92 detik
- Haptic feedback via `navigator.vibrate([200, 100, 200])` jika tersedia
- `unlockAudio()` dipanggil dari gesture pertama user (pointerdown/keydown) di App

### In-App Toast:
- Event bus sederhana (pub/sub): `emitToast(t)` + `subscribeToast(listener)`
- Komponen `<InAppNotificationToast />` di-mount sekali di App level
- Properti toast: id, title, body, href (navigasi on-click), tone (info/success/warn/danger), ttlMs (auto-dismiss, default 8000ms, 0 = sticky)


---

## 11. WORKFLOW STATUS LAPORAN

```
DIKIRIM → DITERIMA → DITUGASKAN → DISELESAIKAN
                                       ↓ (jika requires_pimpinan_verification)
                                  PENDING_VERIFICATION (flag, bukan status)
                                       ↓
                                   DIVERIFIKASI (verified_at diisi)
```

### Status Delete:
- Pelapor (owner): hanya bisa hapus jika `status = 'dikirim'`
- Superadmin: bisa hapus kapan saja

### Self-Executable Category:
Jika `category.self_executable = true`:
- Saat pimpinan klik "Terima", sistem otomatis set status → `ditugaskan` dan `assigned_to` = pelapor itu sendiri
- Pelapor otomatis bisa menyelesaikan laporannya sendiri
- Tombol "Tugaskan" tidak muncul di UI untuk kategori ini

### Available Actions (logika):
```typescript
function availableActions({status, roles, isAssignee, pendingVerification, selfExecutable}):

  isPimpinan = roles.includes('pimpinan') || roles.includes('superadmin')
  
  if isPimpinan && status === 'dikirim':
    → show "Terima"
  
  if isPimpinan && !selfExecutable && status in ['dikirim', 'diterima']:
    → show "Tugaskan"
  
  if status === 'ditugaskan' && (isAdmin || isAssignee):
    → show "Selesai"
  
  if status === 'diselesaikan' && pendingVerification && isPimpinan:
    → show "Verifikasi"
```

---

## 12. TIPE DATA TypeScript

```typescript
type Role = "pelapor" | "superadmin" | "pimpinan" | "petugas";

type ReportStatus = "dikirim" | "diterima" | "ditugaskan" | "diselesaikan";

type DisplayStatus = ReportStatus | "melebihi_sla";
// "melebihi_sla" = computed: status bukan diselesaikan + sla_due_at sudah lewat

interface Profile {
  id: string;
  username: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  position_id: string | null;
  reporter_type_id: string | null;
  wa_number: string | null;
  notification_prefs: NotificationPrefs;
  created_at: string;
  updated_at: string;
}

interface ReportRow {
  id: string;
  user_id: string;
  category_id: string | null;
  photo_url: string;
  description: string;
  status: ReportStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  geo_captured_at: string | null;
  sla_option_id: string | null;
  sla_due_at: string | null;
  completion_note: string | null;
  completion_photo_url: string | null;
  pending_verification: boolean;
  verified_at: string | null;
  verified_by: string | null;
}

const MAX_ASSIGNEES_PER_REPORT = 10;
```

---

## 13. PWA CONFIGURATION

```typescript
// vite.config.ts
VitePWA({
  registerType: 'autoUpdate',
  devOptions: { enabled: false },
  manifest: {
    name: 'FSM LAPOR!',
    short_name: 'FSM LAPOR',
    description: 'Sistem pelaporan FSM',
    theme_color: '#1e40af',
    background_color: '#0f172a',
    display: 'standalone',
    icons: [
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ]
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg}']
  }
})
```

### PWA Footer:
- Badge "PWA Ready" (hijau) atau "Checking PWA support..." (abu)
- Pesan "Aplikasi siap digunakan offline" saat `offlineReady = true`
- Banner "Versi baru tersedia" + tombol "Muat Ulang" saat `needRefresh = true`
- Footer tersembunyi di halaman auth (login, register, forgot-password, reset-password, superadmin/login)


---

## 14. KOMPONEN SHARED

### `CameraCapture`
- Props: `onCapture: (blob: Blob) => void`, `autoStart?: boolean`
- Akses kamera browser (`getUserMedia`)
- Tampilkan live preview dalam `<video>`
- Tombol "Ambil Foto" → capture frame ke canvas → konversi ke Blob (JPEG)
- Tombol "Ganti Kamera" (front/back toggle) jika tersedia
- Handle error: permission denied, tidak ada kamera

### `AvatarBlock`
- Tampilkan avatar user (dari `profile.avatar_url`)
- Jika tidak ada avatar: initials dari `fallback` prop
- Tombol upload foto baru → crop/resize → upload ke `profile-avatars` → update profil
- Loading state saat upload

### `InAppNotificationToast`
- Subscribe ke bus `subscribeToast`
- Render stack toast di pojok atas layar
- Auto-dismiss setelah `ttlMs` ms (default 8000)
- Klik toast → navigasi ke `href` jika ada
- Tombol close (×)
- Animasi slide-in dari atas

### `OfflineScreen`
- Tampil saat `navigator.onLine === false`
- Pesan "Tidak ada koneksi internet"
- Auto-hilang saat koneksi kembali (`online` event)

### `ConfigError`
- Tampil saat env vars Supabase tidak lengkap
- Instruksi cara mengisi `.env.local`

---

## 15. HOOKS

### `useOnline(): boolean`
- Subscribe ke `window` events `online`/`offline`
- Initial state dari `navigator.onLine`

### `useAuth(): AuthContextValue`
- Konsumsi `AuthContext` (throw jika di luar `<AuthProvider>`)

### `useReportNotifications(userId: string|null, prefs: NotificationPrefs|null): void`
- Side-effect: setup/teardown Supabase Realtime channel
- Seed `assignedSet` dari `report_assignees` saat mount
- Update `assignedSet` on INSERT/DELETE `report_assignees`
- Detect status transition dari UPDATE `reports`
- Emit notifikasi (browser + in-app toast + ringtone) sesuai prefs

### `useSurveyAccess(): SurveyAccessState`
```typescript
interface SurveyAccessState {
  loading: boolean;
  enabled: boolean;
  isSuperadmin: boolean;
  role: "superadmin" | "pimpinan" | "petugas" | "lainnya";
}
```
- Superadmin: `enabled = true` langsung
- Lainnya: query `survey_module_access` tabel

---

## 16. UTILITY FUNCTIONS

### `lib/reportStatus.ts`
- `effectiveStatus({status, slaDueAt}) → DisplayStatus` — hitung status display
- `statusBadgeClass(status) → string` — CSS class untuk badge
- `formatSlaCountdown(slaDueAt) → {text, tone}` — "Sisa 2 hari 3 jam" / "Terlambat 1 jam"
- `availableActions(ctx) → AvailableAction[]` — tombol aksi berdasarkan role+status
- `canDeleteReport(status, isOwner, roles) → boolean`
- `STATUS_LABEL: Record<DisplayStatus, string>` — label display Bahasa Indonesia

### `lib/geo.ts`
- `hasCoords(c) → boolean`
- `formatCoords(c, digits?) → string` — "lat, lng"
- `formatAccuracy(meters) → string` — "±50 m" atau "±1.2 km"
- `buildMapsUrl(c) → string | null` — Google Maps URL

### `lib/dashboardStats.ts`
- `normalizeStats(raw) → ReportStats` — parse RPC response aman
- `belumSelesai(s) → number` — dikirim + diterima + ditugaskan
- `aggregateOwnedStats(rows) → ReportStats` — hitung client-side dari array laporan

### `lib/notifications.ts`
- `isEventEnabled(prefs, event) → boolean`
- `notificationsSupported() → boolean`
- `notificationPermission() → NotificationPermission | "unsupported"`
- `requestNotificationPermission() → Promise<...>`
- `showNotification(title, options) → void`
- `unlockAudio() → void`
- `playRingtone() → void`

### `lib/notificationToast.ts`
- `emitToast(t) → void`
- `subscribeToast(listener) → unsubscribeFn`


---

## 17. CSS / STYLING

Aplikasi menggunakan **plain CSS** tanpa framework UI. Sistem kelas yang digunakan:

### Layout:
- `.app` — root container
- `.app__header` — top bar dengan logo + nama user
- `.app__main` — konten utama (max-width, padding)
- `.app__footer` — footer PWA
- `.page-header` — baris header halaman (tombol kembali + judul)
- `.page-title` — h1 halaman
- `.auth-screen` — layout full-screen untuk halaman auth (centered card)

### Komponen:
- `.card` — container utama putih dengan border-radius + shadow
- `.auth-card` — card versi auth (lebih slim)
- `.btn` — base tombol; modifiers: `--primary`, `--ghost`, `--danger`, `--block`, `--sm`, `--lg`
- `.field` — wrapper label + input; `field__label`, `field__input`
- `.notice` — pesan notifikasi; modifiers: `--info`, `--warn`
- `.pill` — badge kecil; modifiers: `--ok` (hijau), `--warn` (kuning), `--info` (biru), `--accent` (ungu), `--danger` (merah), `--role-pelapor`, `--role-pimpinan`, `--role-petugas`, `--role-superadmin`
- `.badge` — counter angka kecil (bulat)
- `.muted` — teks abu-abu; `.small` — teks kecil
- `.empty` — state kosong (centered, muted)

### Report List:
- `.report-list__items` — `<ul>` daftar laporan
- `.report-item` — satu baris laporan (flex row)
- `.report-item__photo` — thumbnail foto
- `.report-item__body` — konten teks
- `.report-item__desc` — deskripsi utama
- `.report-item__chips` — row badge-badge status
- `.report-item__action-row` — row tombol aksi
- `.report-item__meta` — metadata (tanggal)

### Profile:
- `.profile-card` — card profil
- `.profile-header` — header kartu profil
- `.profile-summary` — `<dl>` ringkasan profil
- `.profile-section` — seksi dalam profil (dengan judul + konten)
- `.profile-section__title` — judul seksi
- `.profile-actions` — row tombol aksi; `--stack` = vertikal
- `.avatar-block` — container avatar + upload

### Dashboard:
- `.brand` — logo + judul app di header
- `.clock-card` — kartu jam besar
- `.clock-card__time`, `.clock-card__date`
- `.view-switcher` — nav tab switcher (Pelapor/Petugas/Pimpinan)
- `.view-switcher__tab` + `.is-active`
- `.summary-tile` — tile ringkasan laporan (klikable)
- `.stats-grid`, `.stats-grid--4` — grid statistik
- `.stat-box` — kotak statistik; modifiers: `--info`, `--ok`, `--warn`, `--danger`, `--accent`
- `.stat-tile` — tile besar statistik di superadmin
- `.stat-tile__grid`, `.stat-tile__item`, `.stat-tile__item--alert`

### Modal:
- `.modal-backdrop` — overlay gelap
- `.modal` — popup modal (white card centered)

### Timeline:
- `.timeline` — `<ol>` riwayat
- `.timeline-item` + `.timeline-item__dot` + `.timeline-item__body`

### Misc:
- `.cat-list`, `.cat-row`, `.cat-row__main`, `.cat-row__actions`, `.cat-row__name`, `.cat-row__desc`
- `.user-list`, `.user-row`, `.user-row__main`, `.user-row__name`, `.user-row__meta`, `.user-row__chips`, `.user-row__actions`
- `.filter-toolbar`, `.filter-toolbar__dates`, `.mgmt-toolbar`
- `.section-title`, `.section-desc`
- `.link-btn` — link bergaya tombol (inline, no decoration)
- `.detail-hero`, `.detail-hero__photo`, `.detail-hero__chips`, `.detail-hero__meta`
- `.detail-list`, `.detail-item`
- `.pwa-footer`, `.status`, `.status--ok`, `.status--pending`, `.status__dot`
- `.photo-preview`


---

## 18. CI/CD & SETUP OTOMATIS

### GitHub Actions Workflows:

**`bootstrap.yml` (Bootstrap Supabase one-click setup):**
- Trigger: manual dispatch dengan konfirmasi input `YES`
- Steps:
  1. Jalankan semua migrasi SQL di `supabase/migrations/` secara berurutan via `psql` (menggunakan `SUPABASE_DB_URL`)
  2. Jalankan `scripts/setup-superadmin.mjs` untuk membuat user superadmin di Supabase Auth + set profile + role
- Secrets yang dibutuhkan: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`
- Workflow ini **idempotent** — aman dijalankan ulang

**`ci.yml` (Continuous Integration):**
- Trigger: push & pull request
- Steps: `npm install`, `npm run lint`, `npm run test`, `npm run build`

### Script Setup Superadmin (`scripts/setup-superadmin.mjs`):
```javascript
// Menggunakan Supabase Admin API (service-role key)
// 1. Buat user di auth.users via admin.createUser({email, password})
// 2. Update profile: set username + full_name
// 3. Insert role superadmin + pimpinan ke user_roles
// Idempotent: cek dulu apakah user sudah ada
```

---

## 19. ATURAN KEAMANAN PENTING

1. **Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) TIDAK BOLEH masuk ke bundle frontend.** Hanya variable dengan prefix `VITE_` yang masuk bundle browser.
2. **Role gating di RLS adalah keamanan akhir.** UI gating boleh ada, tapi jangan andalkan itu saja.
3. **Role tidak boleh di-set atau di-expose melalui UI atau localStorage.** Semua operasi role melalui RPC SECURITY DEFINER atau service-role.
4. **Email superadmin tidak pernah ditampilkan di UI.** Login superadmin menggunakan username saja.
5. **Nomor WA pelapor:** hanya superadmin yang bisa lihat (dari halaman detail laporan).
6. **Nomor WA petugas:** pelapor (owner laporan) boleh lihat untuk keperluan komunikasi, tapi dengan toggle show/hide (default tersembunyi/masked).

---

## 20. DEFINISI OF DONE (CHECKLIST BUILD)

Aplikasi dianggap selesai ketika:

- [ ] `npm install` sukses
- [ ] `npm run lint` sukses (TypeScript strict, no errors)
- [ ] `npm run build` sukses (output di `dist/`)
- [ ] `npm run test` sukses (unit tests)
- [ ] `npm run preview` melayani app, service worker aktif di DevTools
- [ ] Manifest PWA menampilkan "FSM LAPOR!" + ikon di DevTools
- [ ] User belum login tidak bisa akses `/laporan` (redirect ke `/login`)
- [ ] Superadmin bisa login via `/superadmin/login` dengan username
- [ ] User biasa bisa daftar, login, buat laporan
- [ ] Pimpinan bisa terima, tugaskan (multi), verifikasi laporan
- [ ] Petugas bisa menyelesaikan laporan yang ditugaskan
- [ ] Notifikasi realtime bekerja (status update terpancar ke pelapor)
- [ ] GPS auto-capture saat buat laporan
- [ ] PWA installable, offline screen tampil saat tidak ada koneksi
- [ ] Tidak ada service-role key di diff/bundle

---

## 21. CATATAN IMPLEMENTASI KHUSUS

### Supabase Client Initialization:
```typescript
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,  // WAJIB untuk reset-password PKCE flow
    flowType: "pkce",
  },
});
```

### Handling Join Supabase (array vs single):
Supabase PostgREST kadang mengembalikan relasi sebagai array atau single object. Selalu normalize:
```typescript
const norm = <T>(x: T | T[] | null): T | null =>
  Array.isArray(x) ? (x[0] ?? null) : (x ?? null);
```

### Petugas-Only Filter di Manajemen Laporan:
Petugas yang tidak memiliki role pimpinan/superadmin hanya melihat laporan yang DI-ASSIGN kepadanya. Karena multi-assignee menggunakan tabel pivot, filter harus:
```typescript
// Ambil report_id dari report_assignees dulu
const { data: pivotIds } = await supabase
  .from("report_assignees")
  .select("report_id")
  .eq("assignee_id", userId);
// Lalu filter: assigned_to = me OR id in (pivotIds)
query = query.or(`assigned_to.eq.${userId},id.in.(${idList})`);
```

### Audio Unlock:
```typescript
// Di App.tsx — listener sekali saja pada user gesture pertama
window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
window.addEventListener("keydown", unlockAudio, { once: true });
```

### Realtime REPLICA IDENTITY:
Tabel `reports` dan `report_assignees` harus di-set `REPLICA IDENTITY FULL` agar payload DELETE berisi data row lama (bukan hanya PK).

### Email Duplicate Detection (Register):
Supabase mencegah email enumeration — `signUp` bisa mengembalikan success meski email sudah ada (`user.identities` jadi kosong). Gunakan RPC `email_exists` sebagai pre-check SEBELUM `signUp`.
```typescript
const exists = await supabase.rpc("email_exists", { p_email: email });
if (exists.data === true) return { error: "EMAIL_ALREADY_REGISTERED" };
```

---

## 22. STRUKTUR FILE YANG DIREKOMENDASIKAN

```
src/
  App.tsx              — routing + providers + global effects
  main.tsx             — ReactDOM.createRoot
  App.css              — global styles
  index.css            — CSS variables + reset
  vite-env.d.ts

  lib/
    supabase.ts         — Supabase client singleton + config error check
    auth.tsx            — AuthContext + AuthProvider + useAuth hook
    types.ts            — shared TypeScript interfaces
    reportStatus.ts     — status logic, labels, badge classes, available actions
    dashboardStats.ts   — stats normalization + aggregation
    geo.ts              — GPS formatting utilities
    notifications.ts    — browser notifications + Web Audio ringtone
    notificationToast.ts — in-app toast event bus
    surveyTypes.ts      — survey module types

  components/
    Login.tsx
    Register.tsx
    ForgotPassword.tsx
    ResetPassword.tsx
    Dashboard.tsx
    Profile.tsx
    ChangePassword.tsx
    ContactAdmin.tsx
    Laporan.tsx
    LaporanSaya.tsx
    LaporanManagement.tsx
    ReportDetail.tsx
    SuperadminLogin.tsx
    SuperadminProfile.tsx
    SuperadminUsers.tsx
    SuperadminCategories.tsx
    SuperadminPositions.tsx
    SuperadminReporterTypes.tsx
    AvatarBlock.tsx
    CameraCapture.tsx
    InAppNotificationToast.tsx
    OfflineScreen.tsx
    ConfigError.tsx

    survey/
      SurveyHome.tsx
      SurveyPlanning.tsx
      SurveyDo.tsx
      SurveyCheck.tsx
      RoomList.tsx
      AssetDetail.tsx
      SurveyManagement.tsx

  hooks/
    useOnline.ts
    useReportNotifications.ts
    useSurveyAccess.ts

  test/
    setup.ts
    dashboardStats.test.ts
    geo.test.ts
    notifications.test.ts
    reportStatus.test.ts
    useOnline.test.ts

supabase/
  migrations/
    0001_init.sql              — profiles, user_roles, triggers, RPCs auth
    0002_storage.sql           — bucket profile-avatars + policies
    0003_reports.sql           — tabel reports + is_superadmin() + RLS
    0004_report_storage.sql    — bucket report-photos + policies
    0005_workflow.sql          — categories, workflow RPCs, status history
    0006_report_geolocation.sql — kolom lat/lng/accuracy di reports
    0007_phase3.sql            — positions, reporter_types, SLA, verifikasi
    0008_phase3_fixes.sql      — fix berbagai bug migrasi phase3
    0009_phase3_fixes_v2.sql   — fix lanjutan (report_history_with_actors rename columns)
    0010_fix_admin_list_users.sql — fix return type admin_list_users
    0011_self_executable.sql   — kolom self_executable di categories + RPC update
    0012_notifications_and_wa.sql — wa_number, notification_prefs, realtime
    0013_report_assignee_contact.sql — WA petugas visible ke pelapor
    0014_realtime_replica_identity.sql — REPLICA IDENTITY FULL
    0015_multi_assignees.sql   — tabel report_assignees + RPC multi-assign
    0016_fix_assignees_recursion.sql — fix RLS recursion bug
    0017_survey_aset.sql       — full modul Survey Aset

scripts/
  setup-superadmin.mjs         — script Node.js setup superadmin via service-role

public/
  favicon.svg
  pwa-192x192.png
  pwa-512x512.png              — juga sebagai maskable icon
  apple-touch-icon.png
  robots.txt

index.html
vite.config.ts
tsconfig.json
tsconfig.app.json
package.json
.env.example
.env.admin.local.example
.gitignore
AGENTS.md                      — aturan untuk AI agent
README.md                      — dokumentasi setup
```


---

## 23. INSTRUKSI UNTUK AI ASSISTANT

Saat membangun ulang proyek ini, ikuti urutan berikut:

### Fase 1: Setup & Fondasi
1. Init proyek Vite + React + TypeScript (`npm create vite@latest`)
2. Install dependencies: `@supabase/supabase-js react-router-dom vite-plugin-pwa`
3. Buat `vite.config.ts` dengan konfigurasi PWA
4. Buat `tsconfig.app.json` dengan `strict: true`
5. Buat `src/lib/supabase.ts` + `src/lib/types.ts`
6. Buat CSS global (`index.css` + `App.css`) dengan semua kelas yang disebutkan di bagian 17

### Fase 2: Auth Layer
7. Buat `src/lib/auth.tsx` — `AuthProvider` + `useAuth`
8. Buat komponen Login, Register, ForgotPassword, ResetPassword, SuperadminLogin
9. Buat routing dasar di `App.tsx` dengan semua route dan `IndexRedirect`

### Fase 3: Core Features
10. Buat Dashboard (multi-view: Pelapor/Petugas/Pimpinan)
11. Buat `CameraCapture` component
12. Buat halaman Laporan (buat laporan dengan kamera + GPS)
13. Buat `LaporanSaya` + `LaporanManagement`
14. Buat `ReportDetail`

### Fase 4: Profil & Admin
15. Buat `AvatarBlock` component
16. Buat halaman `Profile`, `ChangePassword`, `ContactAdmin`
17. Buat semua halaman superadmin (Users, Categories, Positions, ReporterTypes)
18. Buat `SuperadminProfile` dengan statistik

### Fase 5: Notifikasi
19. Buat `src/lib/notifications.ts` (browser notification + ringtone)
20. Buat `src/lib/notificationToast.ts` (event bus)
21. Buat `InAppNotificationToast` component
22. Buat `useReportNotifications` hook
23. Tambahkan `NotificationManager` + `AudioGestureUnlocker` ke App

### Fase 6: Survey Aset
24. Buat `src/lib/surveyTypes.ts`
25. Buat `useSurveyAccess` hook
26. Buat semua komponen di `src/components/survey/`

### Fase 7: Database Migrations
27. Buat semua file SQL di `supabase/migrations/` sesuai urutan
28. Buat `scripts/setup-superadmin.mjs`

### Fase 8: CI/CD
29. Buat `.github/workflows/bootstrap.yml`
30. Buat `.github/workflows/ci.yml`

### Fase 9: Finishing
31. Buat `OfflineScreen`, `ConfigError`
32. Buat `useOnline` hook
33. Tambahkan `OnlineGate` ke App
34. Buat `PwaFooter`
35. Buat file dokumentasi (`README.md`, `AGENTS.md`)
36. Unit tests untuk `dashboardStats`, `geo`, `notifications`, `reportStatus`, `useOnline`

---

**Catatan Penting:**
- Semua teks antarmuka dalam **Bahasa Indonesia**
- Tidak ada UI component library — semua dengan plain CSS
- RLS adalah keamanan utama, bukan UI gating
- Supabase Realtime untuk notifikasi status laporan
- GPS dan kamera menggunakan browser native API (tidak perlu library)
- Ringtone dihasilkan murni dari Web Audio API tanpa file audio eksternal
- App harus bisa dihost sebagai static site (output `dist/`) di Vercel/Netlify/Cloudflare Pages

---

*Prompt ini merepresentasikan 100% fitur dari FSM LAPOR! v0.2.0*
