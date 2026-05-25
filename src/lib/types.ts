export type Role = "pelapor" | "superadmin" | "pimpinan" | "petugas";

/**
 * Status workflow yang tersimpan di DB. "Melebihi SLA" adalah status
 * derived (computed) berdasarkan sla_due_at — tidak masuk ke kolom DB.
 */
export type ReportStatus =
  | "dikirim"
  | "diterima"
  | "ditugaskan"
  | "diselesaikan";

/** Status yang dipakai untuk display, termasuk derived state. */
export type DisplayStatus = ReportStatus | "melebihi_sla";

/**
 * Status laporan yang menjadi event notifikasi (perubahan status). Saat ini
 * hanya transisi yang dipicu oleh aksi management/petugas — "dikirim" tidak
 * dipakai sebagai notifikasi karena itu kondisi awal saat user submit.
 */
export type NotificationEvent =
  | "diterima"
  | "ditugaskan"
  | "diselesaikan"
  | "verified";

export interface NotificationPrefs {
  /** Master switch — kalau false, tidak ada notifikasi yang dikeluarkan. */
  enabled?: boolean;
  diterima?: boolean;
  ditugaskan?: boolean;
  diselesaikan?: boolean;
  /** Verifikasi pimpinan terhadap laporan yang sudah selesai. */
  verified?: boolean;
}

export interface Profile {
  id: string;
  username: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  position_id: string | null;
  reporter_type_id: string | null;
  /** Nomor WhatsApp opsional. Disimpan dalam format digit (+ optional). */
  wa_number: string | null;
  /** Preferensi notifikasi per-user. Default `{}` (semua off). */
  notification_prefs: NotificationPrefs;
  created_at: string;
  updated_at: string;
}

export interface Position {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReporterType {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  requires_pimpinan_verification: boolean;
  /**
   * Jika true: ketika pimpinan menerima laporan jenis ini, sistem
   * otomatis menugaskan kepada pelapor itu sendiri (skip langkah
   * "Tugaskan" ke petugas). Pelapor lalu menyelesaikan sendiri.
   */
  self_executable: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategorySlaOption {
  id: string;
  category_id: string;
  hours: number;
  label: string;
  sort_order: number;
  created_at: string;
}

export interface ReportRow {
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

export interface ReportStatusHistory {
  id: string;
  report_id: string;
  status: ReportStatus;
  changed_by: string | null;
  changed_at: string;
  note: string | null;
}

/**
 * Penugasan banyak petugas per laporan (multi-assignee). Sebuah laporan
 * dapat ditugaskan ke 1..10 petugas, masing-masing dengan catatan opsional.
 *
 * Sumber data: tabel `public.report_assignees` (lihat migrasi 0015).
 * `reports.assigned_to` lama tetap dipertahankan sebagai "primary
 * assignee" (= petugas pertama dari list) untuk backward compat dengan
 * kode lama / payload realtime.
 */
export interface ReportAssignee {
  /** ID baris penugasan (report_assignees.id). */
  assignment_id: string;
  /** ID profil petugas. */
  assignee_id: string;
  username: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  wa_number: string | null;
  /** Catatan opsional yang ditulis pimpinan saat menugaskan. */
  note: string | null;
  assigned_at: string;
  assigned_by: string | null;
}

/** Maksimum petugas per laporan (server-side enforce via trigger). */
export const MAX_ASSIGNEES_PER_REPORT = 10;
