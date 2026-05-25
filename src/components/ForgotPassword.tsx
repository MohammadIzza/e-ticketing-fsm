import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

function ForgotPassword() {
  const { session, loading, sendPasswordResetTo } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (session) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const target = email.trim();
    const { error: err } = await sendPasswordResetTo(target);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    setSubmittedTo(target);
  };

  if (submittedTo) {
    return (
      <main className="auth-screen">
        <section className="card auth-card auth-card--clean">
          <h1 className="auth-title">FSM LAPOR!</h1>
          <p className="auth-subtitle">Cek email Anda</p>
          <p className="auth-help">
            Jika <strong>{submittedTo}</strong> terdaftar, kami sudah mengirim
            link reset password ke email tersebut. Klik link di email untuk
            menyetel password baru.
          </p>
          <Link to="/login" className="btn btn--primary btn--block">
            Kembali ke Login
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <section className="card auth-card auth-card--clean">
        <h1 className="auth-title">FSM LAPOR!</h1>
        <p className="auth-subtitle">Lupa Password</p>
        <p className="auth-help">
          Masukkan email akun Anda. Kami akan mengirim link reset password.
        </p>

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
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={submitting}
          >
            {submitting ? "Mengirim..." : "Kirim Link Reset"}
          </button>
          {error && <p className="notice notice--warn">{error}</p>}
        </form>

        <div className="auth-card__footer">
          <p>
            <Link to="/login" className="link-btn">
              Kembali ke Login
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

export default ForgotPassword;
