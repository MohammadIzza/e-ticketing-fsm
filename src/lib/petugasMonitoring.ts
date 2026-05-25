/**
 * Helper untuk halaman Monitoring Petugas (`/survey-aset/petugas`) dan
 * Performance per-Petugas (`/survey-aset/petugas/:id`).
 *
 * Awalnya diintroduksi di PR #49 (di-revert via PR #56), di-introduce
 * ulang di PR-C dengan tambahan **filter periode dropdown** (bulan /
 * semester / tahun) sesuai item #4. Semua fetcher RLS-aman karena
 * memakai RPC eksisting `list_petugas` (pimpinan/superadmin only) dan
 * SELECT terhadap `asset_surveys` & `report_assignees` yang policy-nya
 * sudah membatasi visibilitas per role.
 *
 * Tidak ada migrasi DB — pure read-only client logic.
 */

import { supabase } from "./supabase";
import type { ReportStatus } from "./types";
import type { SurveyStatus } from "./surveyTypes";

/* ------------------------------------------------------------------------- */
/* Tipe data                                                                  */
/* ------------------------------------------------------------------------- */

export interface PetugasInfo {
  id: string;
  full_name: string | null;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface PetugasSurveyRow {
  id: string;
  created_by: string;
  status: SurveyStatus;
  created_at: string;
  title: string | null;
}

export interface PetugasAssigneeRow {
  report_id: string;
  assignee_id: string;
  assigned_at: string;
  report_status: ReportStatus;
}

/** Status agregat petugas (dipakai filter & sort). */
export type PetugasWorkStatus = "working" | "idle";

export interface PetugasOverview {
  petugas: PetugasInfo;
  status: PetugasWorkStatus;
  /** Total semua pekerjaan (survey + assignment laporan) dalam scope filter. */
  total: number;
  /** Pekerjaan yang masih aktif sekarang (semua waktu, ignore filter). */
  active: number;
  surveyCount: number;
  reportCount: number;
}

export interface PeriodRange {
  /** Inclusive ISO timestamp; kosong = tidak ada batas bawah. */
  from?: string;
  /** Exclusive ISO timestamp; kosong = tidak ada batas atas. */
  to?: string;
}

/* ------------------------------------------------------------------------- */
/* Klasifikasi pekerjaan aktif                                                */
/* ------------------------------------------------------------------------- */

const ACTIVE_SURVEY_STATUSES: SurveyStatus[] = [
  "draft",
  "in_progress",
  "needs_revision",
];

const ACTIVE_REPORT_STATUSES: ReportStatus[] = ["diterima", "ditugaskan"];

export function isSurveyActive(s: SurveyStatus): boolean {
  return ACTIVE_SURVEY_STATUSES.includes(s);
}
export function isReportActive(s: ReportStatus): boolean {
  return ACTIVE_REPORT_STATUSES.includes(s);
}

/* ------------------------------------------------------------------------- */
/* Pure aggregator (mudah di-unit test)                                       */
/* ------------------------------------------------------------------------- */

/**
 * Gabungkan list petugas dengan survey & assignment yang dia kerjakan
 * dalam scope `range`. Mengembalikan satu `PetugasOverview` per petugas,
 * urutan mengikuti urutan `petugasList`.
 *
 * - `total` di-filter range (cocok untuk "ringkasan periode").
 * - `active` selalu ALL-TIME (sekarang masih aktif atau tidak).
 *
 * Pure function — tidak menyentuh I/O. Aman dipakai di test.
 */
export function aggregatePetugas(args: {
  petugasList: PetugasInfo[];
  surveys: PetugasSurveyRow[];
  assignments: PetugasAssigneeRow[];
  range: PeriodRange;
}): PetugasOverview[] {
  const { petugasList, surveys, assignments, range } = args;

  const inRange = (iso: string): boolean => {
    if (range.from && iso < range.from) return false;
    if (range.to && iso >= range.to) return false;
    return true;
  };

  const surveyByUser = new Map<string, PetugasSurveyRow[]>();
  for (const s of surveys) {
    if (!inRange(s.created_at)) continue;
    const list = surveyByUser.get(s.created_by) ?? [];
    list.push(s);
    surveyByUser.set(s.created_by, list);
  }

  const assignByUser = new Map<string, PetugasAssigneeRow[]>();
  for (const a of assignments) {
    if (!inRange(a.assigned_at)) continue;
    const list = assignByUser.get(a.assignee_id) ?? [];
    list.push(a);
    assignByUser.set(a.assignee_id, list);
  }

  // Active uses ALL data ignoring range.
  const surveysAllByUser = new Map<string, PetugasSurveyRow[]>();
  for (const s of surveys) {
    const list = surveysAllByUser.get(s.created_by) ?? [];
    list.push(s);
    surveysAllByUser.set(s.created_by, list);
  }
  const assignAllByUser = new Map<string, PetugasAssigneeRow[]>();
  for (const a of assignments) {
    const list = assignAllByUser.get(a.assignee_id) ?? [];
    list.push(a);
    assignAllByUser.set(a.assignee_id, list);
  }

  return petugasList.map((p) => {
    const ss = surveyByUser.get(p.id) ?? [];
    const aa = assignByUser.get(p.id) ?? [];
    const ssAll = surveysAllByUser.get(p.id) ?? [];
    const aaAll = assignAllByUser.get(p.id) ?? [];
    const active =
      ssAll.filter((s) => isSurveyActive(s.status)).length +
      aaAll.filter((a) => isReportActive(a.report_status)).length;
    return {
      petugas: p,
      surveyCount: ss.length,
      reportCount: aa.length,
      total: ss.length + aa.length,
      active,
      status: active > 0 ? "working" : "idle",
    };
  });
}

/* ------------------------------------------------------------------------- */
/* Period filter (Item #4 PR-C)                                               */
/* ------------------------------------------------------------------------- */

export type PeriodKind = "all" | "month" | "semester" | "year";

export interface PeriodFilter {
  kind: PeriodKind;
  /** Tahun acuan; default tahun ini. Tidak relevan saat kind === "all". */
  year: number;
  /** Bulan 1-12; relevan saat kind === "month". */
  month?: number;
  /** Semester 1 (Jan-Jun) atau 2 (Jul-Dec); relevan saat kind === "semester". */
  semester?: 1 | 2;
}

export const DEFAULT_PERIOD: PeriodFilter = {
  kind: "all",
  year: new Date().getFullYear(),
};

/**
 * Konversi `PeriodFilter` → range ISO (`from`, `to`).
 *
 * Konvensi: `from` inclusive, `to` exclusive — agar mudah dipakai
 * sebagai `>= from AND < to`. Untuk kind "all" mengembalikan `{}`.
 */
export function periodToRange(p: PeriodFilter): PeriodRange {
  if (p.kind === "all") return {};
  if (p.kind === "year") {
    return {
      from: new Date(p.year, 0, 1).toISOString(),
      to: new Date(p.year + 1, 0, 1).toISOString(),
    };
  }
  if (p.kind === "semester") {
    const sem = p.semester ?? 1;
    const fromMonth = sem === 1 ? 0 : 6;
    const toMonth = sem === 1 ? 6 : 12;
    return {
      from: new Date(p.year, fromMonth, 1).toISOString(),
      to:
        toMonth >= 12
          ? new Date(p.year + 1, 0, 1).toISOString()
          : new Date(p.year, toMonth, 1).toISOString(),
    };
  }
  // month
  const m = p.month ?? new Date().getMonth() + 1;
  const safeM = Math.min(Math.max(m, 1), 12);
  const fromDate = new Date(p.year, safeM - 1, 1);
  const toDate =
    safeM === 12
      ? new Date(p.year + 1, 0, 1)
      : new Date(p.year, safeM, 1);
  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

export const MONTH_LABELS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export function describePeriod(p: PeriodFilter): string {
  if (p.kind === "all") return "Semua waktu";
  if (p.kind === "year") return `Tahun ${p.year}`;
  if (p.kind === "semester") {
    const sem = p.semester ?? 1;
    return `Semester ${sem} · ${p.year}`;
  }
  const m = p.month ?? new Date().getMonth() + 1;
  return `${MONTH_LABELS[Math.min(Math.max(m, 1), 12) - 1]} ${p.year}`;
}

/* ------------------------------------------------------------------------- */
/* Sort helper                                                                */
/* ------------------------------------------------------------------------- */

export type PetugasSortKey = "total_desc" | "active_desc" | "name_asc";

export function sortPetugas(
  rows: PetugasOverview[],
  by: PetugasSortKey,
): PetugasOverview[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    if (by === "total_desc") {
      if (b.total !== a.total) return b.total - a.total;
    } else if (by === "active_desc") {
      if (b.active !== a.active) return b.active - a.active;
    }
    const an = (a.petugas.full_name || a.petugas.email || "").toLowerCase();
    const bn = (b.petugas.full_name || b.petugas.email || "").toLowerCase();
    return an.localeCompare(bn, "id");
  });
  return arr;
}

export function displayName(p: PetugasInfo): string {
  return p.full_name || p.email || p.username || "(tanpa nama)";
}

/* ------------------------------------------------------------------------- */
/* Fetchers                                                                   */
/* ------------------------------------------------------------------------- */

export async function fetchPetugasList(): Promise<PetugasInfo[]> {
  const { data, error } = await supabase.rpc("list_petugas");
  if (error) throw error;
  return (data ?? []) as PetugasInfo[];
}

export async function fetchSurveysForPetugas(
  petugasIds: string[],
): Promise<PetugasSurveyRow[]> {
  if (petugasIds.length === 0) return [];
  const { data, error } = await supabase
    .from("asset_surveys")
    .select("id, created_by, status, created_at, title")
    .in("created_by", petugasIds);
  if (error) throw error;
  return (data ?? []) as PetugasSurveyRow[];
}

export async function fetchAssigneesForPetugas(
  petugasIds: string[],
): Promise<PetugasAssigneeRow[]> {
  if (petugasIds.length === 0) return [];
  const { data, error } = await supabase
    .from("report_assignees")
    .select("report_id, assignee_id, assigned_at, reports(status)")
    .in("assignee_id", petugasIds);
  if (error) throw error;
  type Row = {
    report_id: string;
    assignee_id: string;
    assigned_at: string;
    reports: { status: ReportStatus } | { status: ReportStatus }[] | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const reports = Array.isArray(r.reports) ? r.reports[0] : r.reports;
    return {
      report_id: r.report_id,
      assignee_id: r.assignee_id,
      assigned_at: r.assigned_at,
      report_status: (reports?.status ?? "dikirim") as ReportStatus,
    };
  });
}

export async function fetchPetugasMonitoring(args: {
  range: PeriodRange;
}): Promise<PetugasOverview[]> {
  const petugas = await fetchPetugasList();
  if (petugas.length === 0) return [];
  const ids = petugas.map((p) => p.id);
  const [surveys, assignments] = await Promise.all([
    fetchSurveysForPetugas(ids),
    fetchAssigneesForPetugas(ids),
  ]);
  return aggregatePetugas({
    petugasList: petugas,
    surveys,
    assignments,
    range: args.range,
  });
}

export interface PetugasDetail {
  petugas: PetugasInfo;
  surveys: PetugasSurveyRow[];
  assignments: PetugasAssigneeRow[];
}

export async function fetchPetugasDetail(
  petugasId: string,
): Promise<PetugasDetail | null> {
  const list = await fetchPetugasList();
  const petugas = list.find((p) => p.id === petugasId);
  if (!petugas) return null;
  const [surveys, assignments] = await Promise.all([
    fetchSurveysForPetugas([petugasId]),
    fetchAssigneesForPetugas([petugasId]),
  ]);
  return { petugas, surveys, assignments };
}

/**
 * Ringkasan all-time per sumber (Survey Aset / FSM LAPOR) untuk halaman
 * Performance per-Petugas. Tidak dipengaruhi `range` — selalu all-time
 * agar konsisten dengan tile dashboard.
 */
export interface PetugasPerformanceOverview {
  surveyActive: number;
  surveyDone: number;
  surveyTotal: number;
  reportActive: number;
  reportDone: number;
  reportTotal: number;
}

export function overviewOf(d: PetugasDetail): PetugasPerformanceOverview {
  const surveyActive = d.surveys.filter((s) => isSurveyActive(s.status)).length;
  const surveyDone = d.surveys.filter((s) => s.status === "validated").length;
  const reportActive = d.assignments.filter((a) =>
    isReportActive(a.report_status),
  ).length;
  const reportDone = d.assignments.filter(
    (a) => a.report_status === "diselesaikan",
  ).length;
  return {
    surveyActive,
    surveyDone,
    surveyTotal: d.surveys.length,
    reportActive,
    reportDone,
    reportTotal: d.assignments.length,
  };
}
