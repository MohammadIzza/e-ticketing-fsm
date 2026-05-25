import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

function ChangePassword() {
  const { session, loading, user, isSuperadmin, requestPasswordReset } =
    useAuth();
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session || !user) return <Navigate to="/login" replace />;
  if (isSuperadmin) return <Navigate to="/superadmin" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await requestPasswordReset();
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="app">
        <main className="app__main">
          <div className="page-header">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => navigate("/profile")}
            >
              ← Kembali
            </button>
            <h1 className="page-title">Ganti Password</h1>
          </div>

          <section className="card">
            <h2 className="section-title">Cek email Anda</h2>
            <p className="section-desc">
              Kami sudah mengirim link reset password ke{" "}
              <strong>{user.email}</strong>. Klik link di email tersebut untuk
              menyetel password baru. Setelah selesai, Anda perlu login ulang.
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ marginTop: "0.85rem" }}
              onClick={() => navigate("/profile")}
            >
              Kembali ke Profil
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/profile")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Ganti Password</h1>
        </div>

        <section className="card">
          <p className="section-desc">
            Demi keamanan, perubahan password memerlukan verifikasi email. Kami
            akan mengirim link reset ke email Anda.
          </p>

          <form className="report-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field__label">Email tujuan</span>
              <input
                type="email"
                className="field__input"
                value={user.email ?? ""}
                disabled
                style={{ minHeight: "2.5rem" }}
              />
            </label>
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={submitting}
            >
              {submitting ? "Mengirim..." : "Kirim Link Reset Password"}
            </button>
            {error && <p className="notice notice--warn">{error}</p>}
          </form>
        </section>
      </main>
    </div>
  );
}

export default ChangePassword;
