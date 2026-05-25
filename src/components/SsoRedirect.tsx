import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const SUPABASE_HOST = new URL(
  import.meta.env.VITE_SUPABASE_URL ?? "https://placeholder.supabase.co",
).hostname;

/**
 * Halaman perantara setelah SSO UNDIP mengarahkan user ke app.
 * Menerima action_link dari Vercel API /api/auth/sso, memvalidasi
 * bahwa link mengarah ke Supabase kita (cegah open redirect), lalu
 * redirect ke sana sehingga Supabase membuat session dan mengirim
 * user ke /dashboard.
 */
export default function SsoRedirect() {
  const [params] = useSearchParams();
  const [error, setError] = useState(false);

  useEffect(() => {
    const link = params.get("link");
    if (!link) {
      setError(true);
      return;
    }

    try {
      const url = new URL(link);
      if (url.hostname !== SUPABASE_HOST) {
        setError(true);
        return;
      }
    } catch {
      setError(true);
      return;
    }

    window.location.replace(link);
  }, [params]);

  if (error) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h2>Login SSO Gagal</h2>
          <p>Terjadi kesalahan saat memproses login SSO UNDIP.</p>
          <a href="/login" className="btn btn--primary">
            Kembali ke Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen muted">
      <p>Memproses login SSO, mengalihkan...</p>
    </div>
  );
}
