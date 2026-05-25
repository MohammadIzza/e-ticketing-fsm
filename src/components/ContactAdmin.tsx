import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

const ADMIN_EMAIL =
  (import.meta.env.VITE_ADMIN_CONTACT_EMAIL as string | undefined) ||
  "admin@fsm-lapor.local";

function ContactAdmin() {
  const { session, loading, isSuperadmin } = useAuth();
  const navigate = useNavigate();

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (isSuperadmin) return <Navigate to="/superadmin" replace />;

  const subject = "Pertanyaan dari user FSM LAPOR!";
  const body = "Halo Administrator,\n\n[isi pertanyaan / kendala Anda]\n\nTerima kasih.";
  const mailto = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

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
          <h1 className="page-title">Hubungi Administrator</h1>
        </div>

        <section className="card">
          <h2 className="section-title">Butuh bantuan?</h2>
          <p className="section-desc">
            Untuk pertanyaan, kendala akun, atau permintaan lainnya, silakan
            hubungi administrator melalui email berikut.
          </p>
          <p>
            <strong>Email:</strong>{" "}
            <a href={`mailto:${ADMIN_EMAIL}`} className="link-btn">
              {ADMIN_EMAIL}
            </a>
          </p>
          <a
            href={mailto}
            className="btn btn--primary btn--block"
            style={{ marginTop: "0.85rem" }}
          >
            Tulis Email
          </a>
          <p className="muted small" style={{ marginTop: "0.85rem" }}>
            Sertakan email akun Anda dan deskripsi masalah agar administrator
            dapat membantu lebih cepat.
          </p>
        </section>
      </main>
    </div>
  );
}

export default ContactAdmin;
