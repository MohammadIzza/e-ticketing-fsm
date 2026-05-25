/**
 * Tipe TypeScript untuk submodul Kinerja Pegawai (PR-D foundation).
 *
 * Schema DB yang berlaku didefinisikan di
 * `supabase/migrations/0020_kinerja_foundation.sql`. File ini hanya
 * representasi sisi klien — bila ada perubahan kolom di DB, perbarui
 * di sini. Tidak ada generated types dari Supabase di repo ini, jadi
 * dijaga manual.
 */

export type KinerjaAssignmentStatus = "active" | "closed" | "cancelled";

export type KinerjaSubmissionStatus =
  | "draft"
  | "submitted"
  | "needs_revision"
  | "approved"
  | "verified"
  | "rejected";

export const KINERJA_SUBMISSION_STATUS_LABEL: Record<
  KinerjaSubmissionStatus,
  string
> = {
  draft: "Draf",
  submitted: "Menunggu Review",
  needs_revision: "Perlu Revisi",
  approved: "Disetujui",
  verified: "Terverifikasi",
  rejected: "Ditolak",
};

export type KinerjaReviewAction =
  | "approve"
  | "revise"
  | "reject"
  | "verify";

/* ------------------------------------------------------------------------- */
/* Master / config (superadmin)                                               */
/* ------------------------------------------------------------------------- */

export interface KinerjaAssignmentType {
  id: string;
  name: string;
  description: string | null;
  /** Ekspresi rumus SKS (text mentah, evaluator client-side). */
  formula: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KinerjaIndicator {
  id: string;
  assignment_type_id: string;
  /** Identifier untuk dipakai di formula. */
  code: string;
  label: string;
  description: string | null;
  unit: string | null;
  default_value: number;
  sort_order: number;
  created_at: string;
}

export interface KinerjaOutput {
  id: string;
  assignment_type_id: string;
  label: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface KinerjaActivity {
  id: string;
  assignment_type_id: string | null;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

/* ------------------------------------------------------------------------- */
/* Form schema (jsonb)                                                        */
/* ------------------------------------------------------------------------- */

export type KinerjaFormFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "file"
  | "checkbox";

export interface KinerjaFormField {
  /** Identifier unik dalam schema; nantinya jadi key di `form_data`. */
  name: string;
  label: string;
  type: KinerjaFormFieldType;
  required?: boolean;
  /** Untuk select / multiselect. */
  options?: string[];
  help?: string;
}

export interface KinerjaFormSchema {
  id: string;
  assignment_type_id: string;
  fields: KinerjaFormField[];
  updated_at: string;
}

/* ------------------------------------------------------------------------- */
/* Instance                                                                   */
/* ------------------------------------------------------------------------- */

export interface KinerjaAssignment {
  id: string;
  assignment_type_id: string;
  assignee_id: string;
  /** NULL = self-assigned (alur B). */
  assigned_by: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: KinerjaAssignmentStatus;
  period_year: number | null;
  period_semester: 1 | 2 | null;
  created_at: string;
  updated_at: string;
}

export interface KinerjaSubmission {
  id: string;
  assignment_id: string | null;
  assignment_type_id: string;
  user_id: string;
  title: string;
  description: string | null;
  /** Nilai field user dari schema form. */
  form_data: Record<string, unknown>;
  /** Mapping {indicator_code: numeric} untuk evaluasi formula. */
  indicator_values: Record<string, number>;
  computed_sks: number | null;
  status: KinerjaSubmissionStatus;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KinerjaEvidence {
  id: string;
  submission_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  label: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface KinerjaApproval {
  id: string;
  submission_id: string;
  actor_id: string;
  action: "submit" | KinerjaReviewAction;
  note: string | null;
  created_at: string;
}
