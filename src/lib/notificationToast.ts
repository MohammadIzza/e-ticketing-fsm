/**
 * Bus event sederhana untuk in-app notification toast (popup di atas
 * layar) yang melengkapi browser Notification API.
 *
 * Kenapa butuh ini:
 *   - Browser Notification API tidak menampilkan apapun ketika tab
 *     sedang fokus (di banyak browser desktop). User dengan tab
 *     terbuka tidak akan tahu ada update laporan.
 *   - Di iOS Safari, Notification API tidak didukung sama sekali
 *     untuk web (kecuali PWA installed di iOS 16.4+).
 *   - "Popup di atas layar dengan nada dering" — requirement memang
 *     mengharapkan in-app banner, bukan system notification.
 *
 * Solusi: hook `useReportNotifications` memanggil `emitToast()` setiap
 * kali ada event laporan. Komponen `<InAppNotificationToast />` di-mount
 * sekali di App, men-subscribe bus, dan render banner di top of viewport.
 */

export type ToastTone = "info" | "success" | "warn" | "danger";

export interface ToastEvent {
  /** ID stabil supaya React key konsisten saat re-render. */
  id: string;
  title: string;
  body: string;
  /** Path internal untuk dinavigasi ketika user klik banner. */
  href?: string;
  /** Warna aksen banner. Default "info". */
  tone?: ToastTone;
  /**
   * Auto-dismiss setelah n ms. Default 8000. 0 = sticky (user harus
   * close manual). Sticky cocok untuk event high-importance (mis.
   * "anda baru ditugaskan").
   */
  ttlMs?: number;
}

type Listener = (t: ToastEvent) => void;

const listeners = new Set<Listener>();
let counter = 0;

/**
 * Push event ke seluruh subscriber. ID di-generate otomatis
 * (timestamp + counter monotonic) supaya unik bahkan kalau dipanggil
 * dua kali di tick yang sama.
 */
export function emitToast(t: Omit<ToastEvent, "id">): void {
  counter += 1;
  const evt: ToastEvent = {
    id: `${Date.now()}-${counter}`,
    ...t,
  };
  for (const l of listeners) {
    try {
      l(evt);
    } catch (err) {
      console.warn("[toast] listener threw:", err);
    }
  }
}

/** Subscribe; return unsubscribe fn. */
export function subscribeToast(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
