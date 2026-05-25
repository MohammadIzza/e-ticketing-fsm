import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * Halaman target dari link reset password yang dikirim Supabase.
 * Saat user mendarat di sini, supabase-js otomatis meng-exchange code
 * di URL menjadi recovery session — onAuthStateChange memancarkan event
 * PASSWORD_RECOVERY yang ditangkap auth context (recoveryMode = true).
 */
function ResetPassword() {
  const { loading, session, recoveryMode, user, updatePassword, signOut } =
    useAuth();
  const navigate = useNavigate();

  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }

  // Tidak ada session sama sekali -> link tidak valid / sudah kedaluwarsa.
  // Recovery flag false dan user tetap login normal -> tetap izinkan ganti
  // password (defensif, supaya halaman tetap berguna kalau dibuka manual).
  if (!session) {
    return (
      <main className="auth-screen">
        <section className="card auth-card auth-card--clean">
          <h1 className="auth-title">Reset Password</h1>
          <p className="auth-help">
            Link reset password tidak valid atau sudah kedaluwarsa. Silakan
            minta link baru dari halaman Ganti Password.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => navigate("/login")}
          >
            Ke Halaman Login
          </button>
        </section>
      </main>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pwd.length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }
    if (pwd !== confirm) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }
    setSubmitting(true);
    const { error: err } = await updatePassword(pwd);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <main className="auth-screen">
        <section className="card auth-card auth-card--clean">
          <h1 className="auth-title">Berhasil</h1>
          <p className="auth-help">
            Password Anda sudah diperbarui. Silakan login ulang dengan password
            baru.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={async () => {
              await signOut();
              navigate("/login", { replace: true });
            }}
          >
            Login Ulang
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <section className="card auth-card auth-card--clean">
        <h1 className="auth-title">Reset Password</h1>
        <p className="auth-help">
          {recoveryMode ? (
            <>Setel password baru untuk akun {user?.email}.</>
          ) : (
            <>Setel password baru.</>
          )}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Password baru</span>
            <input
              type="password"
              className="field__input"
              autoComplete="new-password"
              minLength={6}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Ulangi password baru</span>
            <input
              type="password"
              className="field__input"
              autoComplete="new-password"
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={submitting}
          >
            {submitting ? "Menyimpan..." : "Simpan Password"}
          </button>
          {error && <p className="notice notice--warn">{error}</p>}
        </form>
      </section>
    </main>
  );
}

export default ResetPassword;
