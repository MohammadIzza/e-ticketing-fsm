import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import {
  displayName,
  fetchPetugasDetail,
  overviewOf,
  type PetugasDetail as PetugasDetailType,
  type PetugasPerformanceOverview,
} from "../../lib/petugasMonitoring";
import { SURVEY_STATUS_LABEL } from "../../lib/surveyTypes";

interface ActivityEntry {
  kind: "survey" | "report";
  id: string;
  at: string;
  label: string;
  href: string;
}

function buildActivity(d: PetugasDetailType): ActivityEntry[] {
  const surveyEntries: ActivityEntry[] = d.surveys.map((s) => ({
    kind: "survey",
    id: s.id,
    at: s.created_at,
    label: `Survey: ${s.title ?? "(tanpa judul)"} · ${SURVEY_STATUS_LABEL[s.status]}`,
    href: `/survey-aset/check/${s.id}`,
  }));
  const reportEntries: ActivityEntry[] = d.assignments.map((a) => ({
    kind: "report",
    id: a.report_id,
    at: a.assigned_at,
    label: `Laporan: ditugaskan · status ${a.report_status}`,
    href: `/laporan/${a.report_id}`,
  }));
  return [...surveyEntries, ...reportEntries]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);
}

function PetugasDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<PetugasDetailType | null>(null);
  const [overview, setOverview] = useState<PetugasPerformanceOverview | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!access.enabled || !id) return;
    let mounted = true;
    setLoading(true);
    fetchPetugasDetail(id)
      .then((d) => {
        if (!mounted) return;
        if (!d) {
          setError("Petugas tidak ditemukan atau tidak dapat diakses.");
          setDetail(null);
          setOverview(null);
        } else {
          setDetail(d);
          setOverview(overviewOf(d));
        }
      })
      .catch((err) => {
        if (mounted)
          setError(err instanceof Error ? err.message : "Gagal memuat.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [access.enabled, id]);

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;
  if (access.role === "petugas" && !access.isSuperadmin) {
    return <Navigate to="/survey-aset" replace />;
  }

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/survey-aset/petugas")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">
            {detail ? displayName(detail.petugas) : "Detail Petugas"}
          </h1>
        </div>

        {loading ? (
          <section className="card">
            <p className="muted small">Memuat...</p>
          </section>
        ) : error ? (
          <section className="card">
            <p className="notice notice--warn">{error}</p>
          </section>
        ) : detail && overview ? (
          <>
            <section className="card">
              <h2 className="section-title">Survey Aset (all-time)</h2>
              <div className="summary-grid" aria-label="Ringkasan survey">
                <div className="summary-tile">
                  <span className="summary-tile__value">
                    {overview.surveyActive}
                  </span>
                  <span className="summary-tile__label">Sedang Dikerjakan</span>
                </div>
                <div className="summary-tile">
                  <span className="summary-tile__value">
                    {overview.surveyDone}
                  </span>
                  <span className="summary-tile__label">Selesai</span>
                </div>
                <div className="summary-tile">
                  <span className="summary-tile__value">
                    {overview.surveyTotal}
                  </span>
                  <span className="summary-tile__label">Total</span>
                </div>
              </div>
            </section>

            <section className="card">
              <h2 className="section-title">FSM LAPOR (all-time)</h2>
              <div className="summary-grid" aria-label="Ringkasan laporan">
                <div className="summary-tile">
                  <span className="summary-tile__value">
                    {overview.reportActive}
                  </span>
                  <span className="summary-tile__label">Sedang Dikerjakan</span>
                </div>
                <div className="summary-tile">
                  <span className="summary-tile__value">
                    {overview.reportDone}
                  </span>
                  <span className="summary-tile__label">Selesai</span>
                </div>
                <div className="summary-tile">
                  <span className="summary-tile__value">
                    {overview.reportTotal}
                  </span>
                  <span className="summary-tile__label">Total</span>
                </div>
              </div>
            </section>

            <section className="card">
              <h2 className="section-title">Aktivitas Terkini</h2>
              <p className="muted small" style={{ margin: 0 }}>
                10 entri terbaru gabungan survey &amp; assignment laporan,
                terurut paling baru.
              </p>
              {(() => {
                const activity = buildActivity(detail);
                if (activity.length === 0) {
                  return (
                    <p className="muted small">
                      Belum ada aktivitas tercatat.
                    </p>
                  );
                }
                return (
                  <ul className="list-rows" style={{ marginTop: "0.5rem" }}>
                    {activity.map((e) => (
                      <li
                        key={`${e.kind}-${e.id}`}
                        className="list-row"
                      >
                        <div className="list-row__main">
                          <p className="list-row__title">{e.label}</p>
                          <p className="list-row__sub">
                            {new Date(e.at).toLocaleString("id-ID")}
                          </p>
                        </div>
                        <div className="list-row__actions">
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => navigate(e.href)}
                          >
                            Buka
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

export default PetugasDetailPage;
