import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** URL SSO Portal UNDIP — user login di sini lalu klik tile FSM LAPOR! */
const SSO_PORTAL_URL = "https://apps-fsm.undip.ac.id/sso/";

function Login() {
  const { session, isSuperadmin, loading, signInWithEmail } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Tampilkan error yang dikirim balik dari /api/auth/microsoft-callback
  // (mis. domain bukan undip.ac.id, atau user cancel login)
  useEffect(() => {
    const ssoError = searchParams.get("sso_error");
    if (ssoError) setError(decodeURIComponent(ssoError));
  }, [searchParams]);

  if (loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (session) {
    return (
      <Navigate to={isSuperadmin ? "/superadmin" : "/dashboard"} replace />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await signInWithEmail(email, password);
    setSubmitting(false);
    if (err) setError(err);
  };

  return (
    <main className="auth-screen">
      <section className="card auth-card auth-card--clean">
        <h1 className="auth-title">FSM LAPOR!</h1>
        <p className="auth-subtitle">Login</p>
        <p className="auth-help">
          Masuk dengan akun Microsoft UNDIP atau email &amp; password.
        </p>

        <a href={SSO_PORTAL_URL} className="btn btn--sso btn--block">
          <MicrosoftIcon />
          Login dengan SSO UNDIP
        </a>

        <div className="auth-divider">
          <span>atau</span>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              type="email"
              className="field__input"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              type="password"
              className="field__input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={submitting}
          >
            {submitting ? "Masuk..." : "Login"}
          </button>
          {error && <p className="notice notice--warn">{error}</p>}
        </form>

        <div className="auth-card__footer">
          <p>
            <Link to="/forgot-password" className="link-btn">
              Lupa password?
            </Link>
          </p>
          <p>
            Belum punya akun?{" "}
            <Link to="/register" className="link-btn">
              Daftar
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

/** Ikon Microsoft (logo 4 kotak warna) */
function MicrosoftIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 21 21"
      xmlns="http://www.w3.org/2000/svg"
      style={{ marginRight: "0.5rem", verticalAlign: "middle", flexShrink: 0 }}
      aria-hidden="true"
    >
      <rect x="1"  y="1"  width="9" height="9" fill="#f25022" />
      <rect x="11" y="1"  width="9" height="9" fill="#7fba00" />
      <rect x="1"  y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default Login;
