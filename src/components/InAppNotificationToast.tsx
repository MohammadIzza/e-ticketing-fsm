import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  subscribeToast,
  type ToastEvent,
} from "../lib/notificationToast";

const DEFAULT_TTL_MS = 8000;
/**
 * Maksimum toast ditampilkan bersamaan. Lebih banyak akan menumpuk &
 * menutupi konten. Toast paling lama otomatis dibuang.
 */
const MAX_VISIBLE = 3;

/**
 * Banner notifikasi in-app yang muncul melayang di atas layar saat ada
 * event laporan. Di-mount sekali di App.tsx (setelah BrowserRouter
 * supaya bisa pakai useNavigate untuk klik → buka detail laporan).
 *
 * Karakteristik:
 *   - Posisi: top center, fixed. Stack vertikal kalau ada >1 toast.
 *   - Auto-dismiss: default 8 detik, kecuali ttlMs=0 (sticky).
 *   - Klik body banner = navigate ke `href`, lalu close.
 *   - Tombol × untuk close manual.
 *   - Pause auto-dismiss saat hover/focus (UX friendly untuk
 *     user yang lambat membaca).
 */
function InAppNotificationToast() {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = subscribeToast((t) => {
      setToasts((prev) => {
        // Buang yang paling lama kalau melebihi limit.
        const next = [...prev, t];
        if (next.length > MAX_VISIBLE) {
          return next.slice(next.length - MAX_VISIBLE);
        }
        return next;
      });
    });
    return unsub;
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="toast-stack" role="region" aria-label="Notifikasi laporan">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={() => dismiss(t.id)}
          onActivate={() => {
            if (t.href) {
              navigate(t.href);
            }
            dismiss(t.id);
          }}
        />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
  onActivate,
}: {
  toast: ToastEvent;
  onDismiss: () => void;
  onActivate: () => void;
}) {
  const ttl = toast.ttlMs ?? DEFAULT_TTL_MS;
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (ttl <= 0) return;
    if (paused) return;
    const t = setTimeout(onDismiss, ttl);
    return () => clearTimeout(t);
  }, [ttl, paused, onDismiss]);

  const tone = toast.tone ?? "info";
  const cls = `toast toast--${tone}`;

  return (
    <div
      className={cls}
      role="alert"
      aria-live="assertive"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button
        type="button"
        className="toast__body"
        onClick={onActivate}
        aria-label={`${toast.title}. Klik untuk buka detail.`}
      >
        <div className="toast__title">{toast.title}</div>
        <div className="toast__msg">{toast.body}</div>
        {toast.href && (
          <div className="toast__hint">Ketuk untuk buka detail →</div>
        )}
      </button>
      <button
        type="button"
        className="toast__close"
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
      >
        ×
      </button>
    </div>
  );
}

export default InAppNotificationToast;
