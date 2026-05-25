/**
 * Tipe domain modul Survey Aset. Disimpan terpisah dari `types.ts`
 * (tipe FSM LAPOR) supaya kontrak antar-modul jelas.
 */

export type AssetCondition =
  | "baik"
  | "rusak_ringan"
  | "rusak_berat"
  | "tidak_ditemukan"
  | "perlu_diganti";

export const ASSET_CONDITION_VALUES: AssetCondition[] = [
  "baik",
  "rusak_ringan",
  "rusak_berat",
  "tidak_ditemukan",
  "perlu_diganti",
];

export const ASSET_CONDITION_LABEL: Record<AssetCondition, string> = {
  baik: "Baik",
  rusak_ringan: "Rusak Ringan",
  rusak_berat: "Rusak Berat",
  tidak_ditemukan: "Tidak Ditemukan",
  perlu_diganti: "Perlu Diganti",
};

/** Apakah kondisi ini "rusak" → boleh dibuatkan laporan FSM LAPOR. */
export function isBrokenCondition(c: AssetCondition | null): boolean {
  return c === "rusak_ringan" || c === "rusak_berat" || c === "perlu_diganti";
}

export type SurveyStatus =
  | "draft"
  | "in_progress"
  | "submitted"
  | "needs_revision"
  | "validated";

export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: "Draf",
  in_progress: "Sedang Disurvey",
  submitted: "Menunggu Validasi",
  needs_revision: "Perlu Revisi",
  validated: "Tervalidasi",
};

export interface RoomType {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoomTypeAssetTemplate {
  id: string;
  room_type_id: string;
  asset_name: string;
  default_quantity: number;
  notes: string | null;
  created_at: string;
}

/** Gedung (induk Ruangan). */
export interface Building {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  code: string | null;
  name: string;
  /** Legacy free-text (kept for back-compat). */
  building: string | null;
  /** FK ke `buildings.id` — sumber kebenaran sekarang. */
  building_id: string | null;
  floor: string | null;
  room_type_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRow {
  id: string;
  room_id: string;
  name: string;
  code: string | null;
  current_condition: AssetCondition;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetSurvey {
  id: string;
  title: string;
  status: SurveyStatus;
  /** Salah satu dari (room_id, building_id) yang terisi. */
  room_id: string | null;
  building_id: string | null;
  created_by: string;
  validator_id: string | null;
  validation_note: string | null;
  validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SurveyScope = "room" | "building";

export function surveyScope(s: Pick<AssetSurvey, "room_id" | "building_id">): SurveyScope {
  return s.building_id ? "building" : "room";
}

export interface AssetSurveyItem {
  id: string;
  survey_id: string;
  asset_id: string;
  condition: AssetCondition | null;
  note: string | null;
  photo_url: string | null;
  report_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetHistoryRow {
  id: string;
  asset_id: string;
  survey_id: string | null;
  previous_condition: AssetCondition | null;
  new_condition: AssetCondition | null;
  changed_by: string | null;
  note: string | null;
  changed_at: string;
}

export interface SurveyModuleAccessRow {
  user_id: string;
  enabled: boolean;
  granted_by: string | null;
  granted_at: string;
}
