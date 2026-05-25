import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

function Register() {
  const { session, isSuperadmin, loading, signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  // Catatan: kalau project Supabase tidak mengaktifkan email confirmation,
  // signUp akan langsung memberi session — onAuthStateChange akan trigger
  // re-render dan guard ini akan membawa user ke /dashboard.
  if (session) {
    return <Navigate to={isSuperadmin ? "/superadmin" : "/dashboard"} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const submitEmail = email.trim();
    const { error: err } = await signUp({
      email: submitEmail,
      password,
      fullName,
    });
    setSubmitting(false);
    if (err === "EMAIL_ALREADY_REGISTERED") {
      // Tampilkan halaman khusus.
      setDuplicateEmail(submitEmail);
      setFullName("");
      setEmail("");
      setPassword("");
      return;
    }
    if (err) {
      setError(err);
      return;
    }
    setFullName("");
    setEmail("");
    setPassword("");
    setSubmittedEmail(submitEmail);
  };

  // ----- Halaman: email sudah terdaftar -----
  if (duplicateEmail) {
    return (
      <main className="auth-screen">
        <section className="card auth-card auth-card--clean">
          <h1 className="auth-title">FSM LAPOR!</h1>
          <p className="auth-subtitle">Email sudah terdaftar</p>
          <p className="auth-help">
            Email <strong>{duplicateEmail}</strong> sudah terdaftar di sistem.
            Silakan gunakan email lain, atau coba login bila ini akun Anda.
            Lupa password? Anda bisa minta link reset.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <Link to="/login" className="btn btn--primary btn--block">
              Ke Halaman Login
            </Link>
            <Link to="/forgot-password" className="btn btn--ghost btn--block">
              Lupa Password
            </Link>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setDuplicateEmail(null)}
            >
              Gunakan Email Lain
            </button>
          </div>
        </section>
      </main>
    );
  }

  // ----- Halaman sukses: cek email -----
  if (submittedEmail) {
    return (
      <main className="auth-screen">
        <section className="card auth-card auth-card--clean">
          <h1 className="auth-title">FSM LAPOR!</h1>
          <p className="auth-subtitle">Cek email Anda</p>
          <p className="auth-help">
            Kami sudah mengirim link konfirmasi ke{" "}
            <strong>{submittedEmail}</strong>. Klik link di email tersebut untuk
            mengaktifkan akun, lalu kembali ke halaman login.
          </p>
          <Link to="/login" className="btn btn--primary btn--block">
            Ke halaman Login
          </Link>
          <div className="auth-card__footer">
            <p className="small">
              Tidak menerima email? Cek folder spam, atau coba daftar ulang
              setelah beberapa menit.
            </p>
          </div>
        </section>
      </main>
    );
  }

  // ----- Form pendaftaran -----
  return (
    <main className="auth-screen">
      <section className="card auth-card auth-card--clean">
        <h1 className="auth-title">FSM LAPOR!</h1>
        <p className="auth-subtitle">Daftar sebagai Pelapor</p>
        <p className="auth-help">Buat akun untuk mulai membuat laporan.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Nama</span>
            <input
              type="text"
              className="field__input"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>
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
              autoComplete="new-password"
              minLength={6}
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
            {submitting ? "Mendaftar..." : "Daftar"}
          </button>
          {error && <p className="notice notice--warn">{error}</p>}
        </form>

        <div className="auth-card__footer">
          <p>
            Sudah punya akun?{" "}
            <Link to="/login" className="link-btn">
              Login
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

export default Register;
