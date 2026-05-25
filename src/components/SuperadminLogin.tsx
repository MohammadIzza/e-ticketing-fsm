import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

function SuperadminLogin() {
  const { session, isSuperadmin, loading, signInSuperadmin } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (session && isSuperadmin) {
    return <Navigate to="/superadmin" replace />;
  }
  if (session && !isSuperadmin) {
    // Logged in as a regular user — bounce them away from this form.
    return <Navigate to="/profile" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await signInSuperadmin(username, password);
    setSubmitting(false);
    if (err) setError(err);
  };

  return (
    <main className="auth-screen">
      <section className="card auth-card auth-card--clean">
        <h1 className="auth-title">FSM LAPOR!</h1>
        <p className="auth-subtitle">Login Superadmin</p>
        <p className="auth-help">Masuk dengan username superadmin.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Username</span>
            <input
              type="text"
              className="field__input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
          <Link to="/login" className="link-btn">
            Login sebagai user biasa
          </Link>
        </div>
      </section>
    </main>
  );
}

export default SuperadminLogin;
