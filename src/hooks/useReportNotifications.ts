import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  isEventEnabled,
  playRingtone,
  showNotification,
  type ReportEventKey,
} from "../lib/notifications";
import { emitToast } from "../lib/notificationToast";
import type { NotificationPrefs, ReportStatus } from "../lib/types";

interface ReportRecord {
  id: string;
  user_id: string;
  assigned_to: string | null;
  status: ReportStatus;
  pending_verification: boolean;
  verified_at: string | null;
  description: string | null;
}

interface AssigneeRecord {
  id: string;
  report_id: string;
  assignee_id: string;
  note: string | null;
}

/**
 * Map transisi status DB ke key event NotificationPrefs.
 *
 * Implementasi defensif terhadap dua skenario REPLICA IDENTITY:
 *
 *   - REPLICA IDENTITY FULL (preferred, di-set oleh migrasi 0014):
 *     `oldRow` berisi seluruh kolom row lama, sehingga kita bisa
 *     membandingkan `oldRow.status !== newRow.status`.
 *
 *   - REPLICA IDENTITY DEFAULT (fallback): `oldRow` hanya berisi primary
 *     key. `oldRow.status` undefined. Kita treat itu sebagai "transisi
 *     baru" — `undefined !== newRow.status` tetap true sehingga event
 *     status terdeteksi (walau ada potensi kecil double-fire kalau update
 *     non-status terjadi pada row dengan status yang relevan; itu sudah
 *     di-deduplikasi via Notification `tag`).
 */
function classifyTransition(
  oldRow: Partial<ReportRecord> | null,
  newRow: ReportRecord,
): ReportEventKey | null {
  if (
    newRow.verified_at &&
    newRow.status === "diselesaikan" &&
    (!oldRow || !oldRow.verified_at)
  ) {
    return "verified";
  }
  const oldStatus = oldRow?.status;
  if (oldStatus !== newRow.status) {
    if (newRow.status === "diterima") return "diterima";
    if (newRow.status === "ditugaskan") return "ditugaskan";
    if (newRow.status === "diselesaikan") return "diselesaikan";
  }
  return null;
}

/** Susun pesan notifikasi yang ramah dan ringkas. */
function buildMessage(
  event: ReportEventKey,
  row: ReportRecord,
): { title: string; body: string } {
  const desc =
    (row.description ?? "").length > 80
      ? `${(row.description ?? "").slice(0, 77)}...`
      : (row.description ?? "Laporan Anda");
  switch (event) {
    case "diterima":
      return {
        title: "Laporan Anda diterima",
        body: `Pimpinan telah menerima laporan: ${desc}`,
      };
    case "ditugaskan":
      return {
        title: "Laporan ditugaskan",
        body: `Laporan telah ditugaskan: ${desc}`,
      };
    case "diselesaikan":
      return {
        title: "Laporan diselesaikan",
        body: `Laporan ditandai selesai: ${desc}`,
      };
    case "verified":
      return {
        title: "Penyelesaian diverifikasi",
        body: `Pimpinan memverifikasi penyelesaian: ${desc}`,
      };
  }
}

/**
 * Pancarkan notifikasi ke 3 channel sekaligus:
 *   1. Browser Notification API (system-level — muncul di notif center
 *      device, bisa juga saat tab tidak fokus).
 *   2. In-app toast banner (popup di atas layar, berfungsi bahkan saat
 *      tab fokus / di iOS yang tidak support Notification API).
 *   3. Ringtone (Web Audio API) supaya user dengar walau tidak melihat
 *      layar.
 */
function fanOutNotification(
  title: string,
  body: string,
  reportId: string,
  event: ReportEventKey,
): void {
  showNotification(title, {
    body,
    tag: `report-${reportId}-${event}`,
    onClickUrl: `/laporan/${reportId}`,
  });
  emitToast({
    title,
    body,
    href: `/laporan/${reportId}`,
    tone:
      event === "ditugaskan"
        ? "warn"
        : event === "diselesaikan" || event === "verified"
          ? "success"
          : "info",
  });
  try {
    playRingtone();
  } catch (err) {
    console.warn("[notif] ringtone failed:", err);
  }
}

/**
 * Subscribe ke perubahan tabel public.reports + public.report_assignees
 * lewat Supabase Realtime dan pancarkan notifikasi multi-channel kalau:
 *
 *   1. Pengguna terlibat dalam laporan:
 *      - Sebagai pelapor (reports.user_id = userId), atau
 *      - Sebagai assignee legacy (reports.assigned_to = userId), atau
 *      - Sebagai multi-assignee (entry di report_assignees dengan
 *        assignee_id = userId — kita maintain set lokal `assignedSet`
 *        yang di-update real-time via INSERT/DELETE pada tabel pivot).
 *   2. Pref yang relevan aktif (`isEventEnabled`).
 *
 * Hook tidak melakukan apa-apa kalau:
 *   - tidak ada userId (belum login)
 *   - master switch off (`prefs.enabled !== true`)
 *
 * Cleanup otomatis saat unmount / userId / `enabled` flag berubah.
 */
export function useReportNotifications(
  userId: string | null,
  prefs: NotificationPrefs | null,
): void {
  const prefsRef = useRef<NotificationPrefs | null>(prefs);
  prefsRef.current = prefs;

  const enabled = prefs?.enabled === true;

  useEffect(() => {
    if (!userId || !enabled) return;

    /**
     * Set lokal report_id yang user sedang ditugaskan, sehingga ketika
     * UPDATE pada `reports` datang dan user bukan `assigned_to` (karena
     * assigned_to legacy hanya menampung petugas pertama), kita tetap
     * bisa mengenali "ini relevan untuk saya". Initial seed via SELECT,
     * lalu di-update on INSERT/DELETE realtime.
     */
    const assignedSet = new Set<string>();

    (async () => {
      const { data, error } = await supabase
        .from("report_assignees")
        .select("report_id")
        .eq("assignee_id", userId);
      if (error) {
        console.warn("[notif] gagal seed report_assignees:", error.message);
        return;
      }
      for (const r of (data ?? []) as { report_id: string }[]) {
        assignedSet.add(r.report_id);
      }
      console.info(
        "[notif] seeded assignedSet size=",
        assignedSet.size,
      );
    })().catch(() => {});

    const channelName = `report-notif-${userId}`;
    console.info("[notif] subscribing realtime channel", channelName);

    const channel = supabase
      .channel(channelName)
      // ---- reports UPDATE (status / verified transitions) -------------
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "reports" },
        (payload) => {
          const oldRow = (payload.old ?? null) as Partial<ReportRecord> | null;
          const newRow = payload.new as ReportRecord;
          if (!newRow || !newRow.id) return;

          const involved =
            newRow.user_id === userId ||
            newRow.assigned_to === userId ||
            assignedSet.has(newRow.id);
          if (!involved) return;

          const event = classifyTransition(oldRow, newRow);
          if (!event) return;

          if (!isEventEnabled(prefsRef.current, event)) {
            console.info(
              "[notif] event",
              event,
              "diterima tapi pref off; skip.",
            );
            return;
          }

          const { title, body } = buildMessage(event, newRow);
          console.info("[notif] firing notification:", title);
          fanOutNotification(title, body, newRow.id, event);
        },
      )
      // ---- report_assignees INSERT (saya baru ditugaskan) -------------
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "report_assignees" },
        (payload) => {
          const newRow = payload.new as AssigneeRecord;
          if (!newRow || newRow.assignee_id !== userId) return;

          assignedSet.add(newRow.report_id);

          if (!isEventEnabled(prefsRef.current, "ditugaskan")) {
            console.info(
              "[notif] new assignment to me, tapi pref ditugaskan off; skip.",
            );
            return;
          }

          const title = "Anda ditugaskan ke laporan";
          const body = newRow.note
            ? `Catatan: ${newRow.note}`
            : "Buka laporan untuk lihat detail.";
          console.info("[notif] firing assignment notification");
          fanOutNotification(title, body, newRow.report_id, "ditugaskan");
        },
      )
      // ---- report_assignees DELETE (assignment dihapus) ---------------
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "report_assignees" },
        (payload) => {
          const oldRow = payload.old as Partial<AssigneeRecord> | null;
          if (!oldRow) return;
          if (oldRow.assignee_id === userId && oldRow.report_id) {
            assignedSet.delete(oldRow.report_id);
          }
        },
      )
      .subscribe((status) => {
        console.info("[notif] channel status:", status);
      });

    return () => {
      console.info("[notif] removing channel", channelName);
      void supabase.removeChannel(channel);
    };
    // Lihat catatan deps di versi lama: jangan masukkan `prefs` (object)
    // ke deps karena identity-nya berubah setiap re-fetch profil.
  }, [userId, enabled]);
}
