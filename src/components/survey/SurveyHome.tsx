import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import {
  fetchSurveySummary,
  type SurveySummary,
} from "../../lib/surveySummary";

/**
 * Landing page modul Survey Aset (`/survey-aset`).
 *
 * Sekarang menampilkan ringkasan jumlah (Gedung / Ruang / Aset / Survey)
 * di bagian atas. Akses & sub-menu mengikuti role efektif user.
 */
function SurveyHome() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<SurveySummary | null>(null);

  useEffect(() => {
    if (!access.enabled) return;
    let mounted = true;
    fetchSurveySummary().then((s) => {
      if (mounted) setSummary(s);
    });
    return () => {
      mounted = false;
    };
  }, [access.enabled]);

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) {
    return (
      <div className="app">
        <main className="app__main">
          <div className="page-header">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => navigate("/dashboard")}
            >
              ← Kembali
            </button>
            <h1 className="page-title">Survey Aset</h1>
          </div>
          <section className="card">
            <p className="notice notice--warn">
              Anda belum diberi izin untuk modul Survey Aset. Hubungi
              superadmin untuk mendapat akses.
            </p>
          </section>
        </main>
      </div>
    );
  }

  const isSuper = access.isSuperadmin;
  const isPimpinan = access.role === "pimpinan";
  const isPetugas = access.role === "petugas";

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(isSuper ? "/superadmin" : "/dashboard")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Survey Aset</h1>
        </div>

        <SummaryHeader summary={summary} />

        <section className="card">
          <p className="section-desc">
            Pencatatan inventaris dan survey kondisi aset per Gedung &amp;
            Ruangan. Aset yang ditemukan rusak dapat langsung dibuatkan
            laporan FSM LAPOR.
          </p>

          <div className="profile-actions profile-actions--stack">
            {isSuper && (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => navigate("/survey-aset/manage")}
              >
                Manajemen Survey Aset
              </button>
            )}

            {(isSuper || isPetugas) && (
              <>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => navigate("/survey-aset/planning")}
                >
                  Planning Survey
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => navigate("/survey-aset/do")}
                >
                  Do Survey
                </button>
              </>
            )}

            {(isSuper || isPimpinan) && (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => navigate("/survey-aset/check")}
              >
                Check Survey
              </button>
            )}

            {(isSuper || isPimpinan) && (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => navigate("/survey-aset/petugas")}
              >
                Monitoring Petugas
              </button>
            )}

            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate("/survey-aset/rooms")}
            >
              Daftar Gedung, Ruang &amp; Aset
            </button>

            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate("/survey-aset/history")}
            >
              Histori Survey (Grafik)
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export function SummaryHeader({ summary }: { summary: SurveySummary | null }) {
  const fmt = (n: number | undefined) =>
    summary ? n!.toLocaleString("id-ID") : "—";
  return (
    <div className="summary-grid" aria-label="Ringkasan jumlah">
      <div className="summary-tile">
        <span className="summary-tile__value">{fmt(summary?.buildings)}</span>
        <span className="summary-tile__label">Gedung</span>
      </div>
      <div className="summary-tile">
        <span className="summary-tile__value">{fmt(summary?.rooms)}</span>
        <span className="summary-tile__label">Ruangan</span>
      </div>
      <div className="summary-tile">
        <span className="summary-tile__value">{fmt(summary?.assets)}</span>
        <span className="summary-tile__label">Aset</span>
      </div>
      <div className="summary-tile">
        <span className="summary-tile__value">{fmt(summary?.surveys)}</span>
        <span className="summary-tile__label">Survey</span>
      </div>
    </div>
  );
}

export default SurveyHome;
