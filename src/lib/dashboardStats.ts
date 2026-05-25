/**
 * Helpers untuk membaca hasil RPC `report_stats_for_me` dan menghitung
 * agregasi sederhana di sisi client (untuk "Ringkasan laporan yang
 * Anda ajukan" — tidak perlu RPC tambahan).
 *
 * RPC mengembalikan jsonb tunggal:
 *   {
 *     total, dikirim, diterima, ditugaskan, diselesaikan,
 *     pending_verification, overdue, hari_ini
 *   }
 *
 * Helper di file ini:
 *   - normalizeStats: validasi & default-value supaya UI tidak crash kalau
 *     RPC mengembalikan bentuk yang tak terduga.
 *   - belumSelesai: alias `dikirim + diterima + ditugaskan` (laporan
 *     yang masih perlu tindakan).
 *   - aggregateOwnedStats: hitung counts dari row-row laporan yang
 *     dimiliki user (sebagai pelapor) — dipakai di tile "Ringkasan
 *     Laporan Anda" pada dashboard.
 *
 * Stand-alone module supaya bisa di-unit-test tanpa Supabase.
 */

export interface ReportStats {
  total: number;
  dikirim: number;
  diterima: number;
  ditugaskan: number;
  diselesaikan: number;
  pending_verification: number;
  overdue: number;
  hari_ini: number;
}

export const EMPTY_STATS: ReportStats = {
  total: 0,
  dikirim: 0,
  diterima: 0,
  ditugaskan: 0,
  diselesaikan: 0,
  pending_verification: 0,
  overdue: 0,
  hari_ini: 0,
};

function asNumber(x: unknown): number {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Normalisasi raw response RPC menjadi {@link ReportStats} yang aman.
 * Field yang hilang/non-numeric akan menjadi 0, sehingga UI tidak NaN.
 */
export function normalizeStats(raw: unknown): ReportStats {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATS };
  const r = raw as Record<string, unknown>;
  return {
    total: asNumber(r.total),
    dikirim: asNumber(r.dikirim),
    diterima: asNumber(r.diterima),
    ditugaskan: asNumber(r.ditugaskan),
    diselesaikan: asNumber(r.diselesaikan),
    pending_verification: asNumber(r.pending_verification),
    overdue: asNumber(r.overdue),
    hari_ini: asNumber(r.hari_ini),
  };
}

/** Laporan yang belum selesai = dikirim + diterima + ditugaskan. */
export function belumSelesai(s: ReportStats): number {
  return s.dikirim + s.diterima + s.ditugaskan;
}

/**
 * Agregasi rows menjadi {@link ReportStats}. Dipakai di sisi client
 * untuk menghitung ringkasan laporan yang DIAJUKAN oleh user
 * (pelapor) — query sederhana ke `reports.eq('user_id', auth.uid())`,
 * lalu agregasi di JS supaya tidak butuh RPC tambahan.
 */
export function aggregateOwnedStats(
  rows: ReadonlyArray<{
    status: string;
    sla_due_at: string | null;
    pending_verification: boolean | null;
    created_at: string;
  }>,
  now: Date = new Date(),
): ReportStats {
  const stats: ReportStats = { ...EMPTY_STATS };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const nowMs = now.getTime();

  for (const r of rows) {
    stats.total++;
    switch (r.status) {
      case "dikirim":
        stats.dikirim++;
        break;
      case "diterima":
        stats.diterima++;
        break;
      case "ditugaskan":
        stats.ditugaskan++;
        break;
      case "diselesaikan":
        stats.diselesaikan++;
        if (r.pending_verification) stats.pending_verification++;
        break;
    }
    if (r.status !== "diselesaikan" && r.sla_due_at) {
      const due = Date.parse(r.sla_due_at);
      if (!Number.isNaN(due) && due < nowMs) {
        stats.overdue++;
      }
    }
    const created = Date.parse(r.created_at);
    if (!Number.isNaN(created) && created >= todayMs) {
      stats.hari_ini++;
    }
  }
  return stats;
}
