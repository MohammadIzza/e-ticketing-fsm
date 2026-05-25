import type { NotificationEvent, NotificationPrefs } from "./types";

/**
 * Map status laporan (enum DB) → key di NotificationPrefs. "dikirim"
 * tidak menjadi event terpisah karena itu kondisi awal.
 */
export type ReportEventKey = NotificationEvent;

/** Nilai default ketika kolom belum di-set di server. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: false,
  diterima: false,
  ditugaskan: false,
  diselesaikan: false,
  verified: false,
};

export const NOTIFICATION_EVENT_LABEL: Record<ReportEventKey, string> = {
  diterima: "Laporan diterima oleh pimpinan",
  ditugaskan: "Laporan ditugaskan ke petugas",
  diselesaikan: "Laporan ditandai selesai",
  verified: "Penyelesaian laporan diverifikasi",
};

/** Apakah notifikasi diizinkan untuk event tertentu, mempertimbangkan master switch. */
export function isEventEnabled(
  prefs: NotificationPrefs | null | undefined,
  event: ReportEventKey,
): boolean {
  if (!prefs) return false;
  if (prefs.enabled !== true) return false;
  return prefs[event] === true;
}

/**
 * Browser support untuk Notification API. Mengembalikan false di SSR
 * dan environment yang tidak punya window.Notification (mis. iOS Safari
 * versi lama tanpa PWA).
 */
export function notificationsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.Notification !== "undefined"
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return window.Notification.permission;
}

/**
 * Minta izin notifikasi ke browser. Mengembalikan permission terbaru
 * setelah user merespons prompt.
 */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!notificationsSupported()) return "unsupported";
  try {
    const res = await window.Notification.requestPermission();
    return res;
  } catch {
    return window.Notification.permission;
  }
}

/**
 * Tampilkan notifikasi browser. Best-effort: kalau permission belum
 * granted atau Notification API tidak ada, fungsi ini no-op.
 *
 * Defaultnya `requireInteraction: true` supaya popup tidak menghilang
 * sendiri (pengguna harus klik untuk dismiss). Beberapa browser tetap
 * mengabaikan flag ini di mobile, jadi kita juga punya in-app toast
 * sebagai fallback (lihat notificationToast.ts + InAppNotificationToast).
 */
export function showNotification(
  title: string,
  options?: NotificationOptions & { onClickUrl?: string },
): void {
  if (!notificationsSupported()) return;
  if (window.Notification.permission !== "granted") return;
  const { onClickUrl, ...rest } = options ?? {};
  try {
    const n = new window.Notification(title, {
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      requireInteraction: true,
      ...rest,
    });
    if (onClickUrl) {
      n.onclick = () => {
        window.focus();
        if (window.location.pathname !== onClickUrl) {
          window.location.href = onClickUrl;
        }
        n.close();
      };
    }
  } catch (e) {
    // Beberapa browser melempar SecurityError jika dipanggil tanpa user
    // gesture pada konteks tertentu. Diam-diam abaikan.
    console.warn("Gagal menampilkan notifikasi:", e);
  }
}

// =============================================================================
// Ringtone — Web Audio API
//
// Browser tidak mengizinkan kita memutar nada dering "bawaan HP" secara
// langsung. Sebagai gantinya kita generate dua-nada pendek mirip dering
// telepon (seperti tone "ding-dong" notifikasi), 100% di kode tanpa
// asset audio eksternal — supaya jalan offline juga di PWA.
//
// Autoplay policy: AudioContext modern (Chrome/Edge/Safari) butuh user
// gesture untuk pertama kali start. `unlockAudio()` dipanggil dari
// listener gesture global di App.tsx + dari tombol "Tes Notifikasi"
// di Profile, supaya ketika notifikasi laporan datang nantinya, audio
// sudah unlocked dan tone bisa langsung diputar.
// =============================================================================

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let cachedCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (cachedCtx) return cachedCtx;
  const w = window as WebkitWindow;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    cachedCtx = new Ctor();
    return cachedCtx;
  } catch {
    return null;
  }
}

/**
 * "Unlock" AudioContext — dipanggil dari user gesture (klik/keypress)
 * supaya browser mengizinkan resume(). Aman dipanggil berkali-kali.
 */
export function unlockAudio(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {
      // Tidak fatal — beberapa browser butuh gesture lebih kuat.
    });
  }
}

/**
 * Putar nada dering pendek (~0.9 detik) dengan dua tone berselang-seling.
 * No-op jika Web Audio API tidak tersedia atau context tidak bisa
 * di-resume karena belum ada user gesture.
 */
export function playRingtone(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  // Pola dering: 4 chirp, alternating 880Hz / 660Hz, masing-masing 180ms,
  // jeda 50ms antar chirp. Total durasi ~0.92s.
  const tones = [
    { freq: 880, start: 0.0, dur: 0.18 },
    { freq: 660, start: 0.23, dur: 0.18 },
    { freq: 880, start: 0.46, dur: 0.18 },
    { freq: 660, start: 0.69, dur: 0.18 },
  ];
  for (const t of tones) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      // Envelope: fade-in 20ms, sustain ~0.14s, fade-out 20ms supaya
      // tidak ada klik tajam di awal/akhir (lebih enak di telinga).
      gain.gain.setValueAtTime(0, now + t.start);
      gain.gain.linearRampToValueAtTime(0.28, now + t.start + 0.02);
      gain.gain.linearRampToValueAtTime(0.28, now + t.start + t.dur - 0.02);
      gain.gain.linearRampToValueAtTime(0, now + t.start + t.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.04);
    } catch (err) {
      // Skip tone yang gagal — partial ringtone better than none.
      console.warn("[ringtone] tone failed:", err);
    }
  }

  // Bonus haptic feedback di device yang mendukung Vibration API
  // (kebanyakan Android browser). 200ms - 100ms - 200ms.
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch {
    // ignore
  }
}
