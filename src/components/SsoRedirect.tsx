import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Halaman perantara setelah SSO UNDIP mengarahkan user ke app.
 * Menerima token_hash dari /api/auth/sso, memanggil verifyOtp
 * secara langsung agar kompatibel dengan flowType: 'pkce' (tidak
 * memerlukan code_verifier karena sesi dikembalikan langsung via API).
 */
export default function SsoRedirect() {
  const [params] = useSearchParams();
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const tokenHash = params.get("token_hash");
    if (!tokenHash) {
      setError(true);
      return;
    }

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: "magiclink" })
      .then(({ error: err }) => {
        if (err) {
          console.error("[sso-redirect] verifyOtp error:", err.message);
          setError(true);
        } else {
          navigate("/dashboard", { replace: true });
        }
      });
  }, [params, navigate]);

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
