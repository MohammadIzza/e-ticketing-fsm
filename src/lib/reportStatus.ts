import type { DisplayStatus, ReportStatus, Role } from "./types";

export const STATUS_ORDER: ReportStatus[] = [
  "dikirim",
  "diterima",
  "ditugaskan",
  "diselesaikan",
];

/** Termasuk "melebihi_sla" — dipakai untuk filter di UI. */
export const DISPLAY_STATUS_ORDER: DisplayStatus[] = [
  "dikirim",
  "diterima",
  "ditugaskan",
  "melebihi_sla",
  "diselesaikan",
];

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  dikirim: "Dikirim",
  diterima: "Diterima",
  ditugaskan: "Ditugaskan",
  diselesaikan: "Diselesaikan",
  melebihi_sla: "Melebihi SLA",
};

export function nextStatus(current: ReportStatus): ReportStatus | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}

export function statusBadgeClass(status: DisplayStatus): string {
  switch (status) {
    case "dikirim":
      return "pill pill--info";
    case "diterima":
      return "pill pill--warn";
    case "ditugaskan":
      return "pill pill--accent";
    case "diselesaikan":
      return "pill pill--ok";
    case "melebihi_sla":
      return "pill pill--danger";
  }
}

/**
 * Hitung status untuk display: kalau status belum 'diselesaikan' dan SLA
 * sudah lewat, return "melebihi_sla". Jika status='diselesaikan', tetap
 * return status DB walaupun selesainya lewat SLA — dianggap sudah closed.
 */
export function effectiveStatus(args: {
  status: ReportStatus;
  slaDueAt: string | null;
  now?: Date;
}): DisplayStatus {
  const { status, slaDueAt } = args;
  if (status === "diselesaikan") return status;
  if (!slaDueAt) return status;
  const dueMs = Date.parse(slaDueAt);
  if (Number.isNaN(dueMs)) return status;
  const nowMs = (args.now ?? new Date()).getTime();
  if (nowMs > dueMs) return "melebihi_sla";
  return status;
}

/** True kalau laporan punya SLA dan akan/sudah lewat. */
export function isOverdue(args: {
  status: ReportStatus;
  slaDueAt: string | null;
  now?: Date;
}): boolean {
  return effectiveStatus(args) === "melebihi_sla";
}

/**
 * Format human-readable countdown menuju jatuh tempo SLA, atau berapa lama
 * sudah terlewat. Cocok untuk halaman detail laporan.
 *
 * Tone:
 *   - "ok"     : masih ada > 24 jam
 *   - "warn"   : kurang dari 24 jam
 *   - "danger" : sudah lewat (overdue)
 */
export function formatSlaCountdown(
  slaDueAt: string,
  now: Date = new Date(),
): { text: string; tone: "ok" | "warn" | "danger" } | null {
  const dueMs = Date.parse(slaDueAt);
  if (Number.isNaN(dueMs)) return null;
  const diffMs = dueMs - now.getTime();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);

  const totalMinutes = Math.floor(abs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  let label: string;
  if (days > 0) {
    label = hours > 0 ? `${days} hari ${hours} jam` : `${days} hari`;
  } else if (hours > 0) {
    label = minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
  } else {
    label = `${Math.max(minutes, 0)} menit`;
  }

  if (overdue) {
    return { text: `Terlambat ${label}`, tone: "danger" };
  }
  // < 24 jam tersisa → warn.
  if (totalMinutes < 60 * 24) {
    return { text: `Sisa ${label}`, tone: "warn" };
  }
  return { text: `Sisa ${label}`, tone: "ok" };
}

/**
 * Aturan bisnis: laporan yang sudah lewat status 'dikirim' tidak boleh
 * dihapus oleh pemiliknya. Hanya superadmin yang selalu boleh menghapus.
 */
export function canDeleteReport(
  status: ReportStatus,
  isOwner: boolean,
  roles: Role[],
): boolean {
  if (roles.includes("superadmin")) return true;
  return isOwner && status === "dikirim";
}

/** Tombol aksi yang tersedia bagi user, berdasar role + status report. */
export interface AvailableAction {
  key: "terima" | "tugaskan" | "selesai" | "verifikasi";
  label: string;
}

export interface AvailableActionsContext {
  status: ReportStatus;
  roles: Role[];
  isAssignee: boolean;
  pendingVerification?: boolean;
  /**
   * Apakah kategori laporan ini "bisa dikerjakan sendiri" (self-executable).
   * Ketika true, tombol "Tugaskan" disembunyikan: pada kategori jenis ini
   * sistem otomatis menugaskan laporan ke pelapor saat pimpinan menekan
   * "Terima" (lihat migrasi 0011_self_executable.sql), jadi penugasan
   * manual ke petugas lain tidak relevan dan akan menimbulkan kebingungan
   * pada pimpinan. Default false → perilaku lama tetap.
   */
  selfExecutable?: boolean;
}

export function availableActions(
  ctxOrStatus: AvailableActionsContext | ReportStatus,
  legacyRoles?: Role[],
  legacyIsAssignee?: boolean,
): AvailableAction[] {
  // Backward compat shape (status, roles, isAssignee).
  const ctx: AvailableActionsContext =
    typeof ctxOrStatus === "string"
      ? {
          status: ctxOrStatus,
          roles: legacyRoles ?? [],
          isAssignee: legacyIsAssignee ?? false,
        }
      : ctxOrStatus;

  const {
    status,
    roles,
    isAssignee,
    pendingVerification = false,
    selfExecutable = false,
  } = ctx;
  const actions: AvailableAction[] = [];
  const isAdmin = roles.includes("superadmin");
  const isPimpinan = roles.includes("pimpinan") || isAdmin;

  if (isPimpinan && status === "dikirim") {
    actions.push({ key: "terima", label: "Terima" });
  }
  // Tombol Tugaskan disembunyikan untuk kategori self-executable: alur
  // "Terima" sudah auto-assign ke pelapor pemilik laporan, sehingga
  // tombol Tugaskan akan menimbulkan dua jalur yang konflik. Petugas
  // tetap bisa ditugaskan via path admin RPC kalau pimpinan benar-benar
  // butuh override, tapi tidak melalui tombol UI ini.
  if (
    isPimpinan &&
    !selfExecutable &&
    (status === "dikirim" || status === "diterima")
  ) {
    actions.push({ key: "tugaskan", label: "Tugaskan" });
  }
  // Aturan baru (mendukung kategori "bisa dikerjakan sendiri"):
  //   Siapapun yang DI-assign — termasuk pelapor pemilik laporan pada
  //   kategori self-executable — dapat menekan "Selesaikan". Backend
  //   tetap memvalidasi via RLS / RPC (assigned_to=auth.uid() atau
  //   superadmin), jadi tombol UI hanya ditampilkan kalau aman.
  if (status === "ditugaskan" && (isAdmin || isAssignee)) {
    actions.push({ key: "selesai", label: "Selesai" });
  }
  if (
    status === "diselesaikan" &&
    pendingVerification &&
    isPimpinan
  ) {
    actions.push({ key: "verifikasi", label: "Verifikasi" });
  }
  return actions;
}
