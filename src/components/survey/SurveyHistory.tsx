import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import { supabase } from "../../lib/supabase";
import {
  ASSET_CONDITION_LABEL,
  SURVEY_STATUS_LABEL,
  type AssetSurvey,
  type AssetSurveyItem,
  type Building,
  type Room,
} from "../../lib/surveyTypes";

/**
 * `/survey-aset/history` — visualisasi histori survey sebagai grafik garis.
 *
 * Sumbu X: tanggal survey (created_at).
 * Garis ditampilkan untuk total kondisi `Baik` vs `Rusak` per survey
 * di lingkup yang dipilih (semua / per gedung / per ruangan via query
 * `?building=<id>` atau `?room=<id>`).
 *
 * Tujuan: agar pimpinan / superadmin bisa melihat tren kondisi aset
 * antar survey dalam scope yang sama.
 */
function SurveyHistory() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const buildingId = params.get("building");
  const roomId = params.get("room");

  const [surveys, setSurveys] = useState<AssetSurvey[]>([]);
  const [items, setItems] = useState<AssetSurveyItem[]>([]);
  const [building, setBuilding] = useState<Building | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!access.enabled) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    (async () => {
      let q = supabase
        .from("asset_surveys")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(200);
      if (roomId) q = q.eq("room_id", roomId);
      if (buildingId) q = q.eq("building_id", buildingId);
      const sRes = await q;
      if (!mounted) return;
      if (sRes.error) {
        setError(sRes.error.message);
        setLoading(false);
        return;
      }
      const sv = (sRes.data ?? []) as AssetSurvey[];
      setSurveys(sv);

      // Kontext lingkup
      if (buildingId) {
        const bRes = await supabase
          .from("buildings")
          .select("*")
          .eq("id", buildingId)
          .maybeSingle();
        if (mounted && bRes.data) setBuilding(bRes.data as Building);
      }
      if (roomId) {
        const rRes = await supabase
          .from("rooms")
          .select("*")
          .eq("id", roomId)
          .maybeSingle();
        if (mounted && rRes.data) setRoom(rRes.data as Room);
      }

      if (sv.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }
      const ids = sv.map((s) => s.id);
      const iRes = await supabase
        .from("asset_survey_items")
        .select("*")
        .in("survey_id", ids);
      if (!mounted) return;
      setLoading(false);
      if (iRes.error) {
        setError(iRes.error.message);
        return;
      }
      setItems((iRes.data ?? []) as AssetSurveyItem[]);
    })();

    return () => {
      mounted = false;
    };
  }, [access.enabled, buildingId, roomId]);

  const series = useMemo(() => {
    return surveys.map((s) => {
      const its = items.filter((i) => i.survey_id === s.id);
      const counts: Record<string, number> = {
        baik: 0,
        rusak_ringan: 0,
        rusak_berat: 0,
        tidak_ditemukan: 0,
        perlu_diganti: 0,
      };
      for (const it of its) {
        if (it.condition) counts[it.condition] += 1;
      }
      const broken =
        counts.rusak_ringan + counts.rusak_berat + counts.perlu_diganti;
      return {
        survey: s,
        date: new Date(s.created_at),
        total: its.length,
        baik: counts.baik,
        rusak: broken,
        notFound: counts.tidak_ditemukan,
        counts,
      };
    });
  }, [surveys, items]);

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;

  const scopeLabel = building
    ? `Gedung: ${building.code ? `${building.code} — ${building.name}` : building.name}`
    : room
      ? `Ruang: ${room.code ? `${room.code} — ${room.name}` : room.name}`
      : "Semua Lingkup";

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/survey-aset")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Histori Survey</h1>
        </div>

        <section className="card">
          <p className="muted small" style={{ margin: 0 }}>
            <strong>Lingkup:</strong> {scopeLabel}
          </p>
          {(buildingId || roomId) && (
            <div
              className="profile-actions"
              style={{ marginTop: "0.4rem" }}
            >
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate("/survey-aset/history")}
              >
                Lihat Semua Lingkup
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Grafik Kondisi Aset Antar Survey</h2>
          {loading ? (
            <p className="muted small">Memuat...</p>
          ) : error ? (
            <p className="notice notice--warn">{error}</p>
          ) : series.length === 0 ? (
            <p className="muted small">
              Belum ada survey dalam lingkup ini.
            </p>
          ) : (
            <>
              <LineChart
                points={series.map((s) => ({
                  x: s.date.getTime(),
                  baik: s.baik,
                  rusak: s.rusak,
                  total: s.total,
                  label: s.date.toLocaleDateString("id-ID", {
                    day: "2-digit",
                    month: "short",
                  }),
                }))}
              />
              <div className="chart__legend">
                <span>
                  <span
                    className="chart__legend-swatch"
                    style={{ background: "var(--primary)" }}
                  />
                  Baik
                </span>
                <span>
                  <span
                    className="chart__legend-swatch"
                    style={{ background: "#dc2626" }}
                  />
                  Rusak
                </span>
                <span>
                  <span
                    className="chart__legend-swatch"
                    style={{ background: "rgba(148,163,184,0.6)" }}
                  />
                  Total Aset
                </span>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">Daftar Survey</h2>
          {series.length === 0 ? (
            <p className="muted small">Tidak ada data.</p>
          ) : (
            <ul className="list-rows">
              {series.map((s) => (
                <li key={s.survey.id} className="list-row">
                  <div className="list-row__main">
                    <p className="list-row__title">{s.survey.title}</p>
                    <p className="list-row__sub">
                      {s.date.toLocaleDateString("id-ID")} ·{" "}
                      {SURVEY_STATUS_LABEL[s.survey.status]} ·{" "}
                      {Object.entries(s.counts)
                        .filter(([, v]) => v > 0)
                        .map(
                          ([k, v]) =>
                            `${
                              ASSET_CONDITION_LABEL[
                                k as keyof typeof ASSET_CONDITION_LABEL
                              ]
                            }: ${v}`,
                        )
                        .join(" · ") || "(belum diisi)"}
                    </p>
                  </div>
                  <div className="list-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        navigate(`/survey-aset/check?id=${s.survey.id}`)
                      }
                    >
                      Detail
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

/* ---------------- LineChart (SVG, tanpa dependency) ---------------- */

interface ChartPoint {
  x: number; // ms epoch
  baik: number;
  rusak: number;
  total: number;
  label: string;
}

function LineChart({ points }: { points: ChartPoint[] }) {
  if (points.length === 0) return null;

  const W = 600;
  const H = 180;
  const PAD_L = 30;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;

  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const xRange = Math.max(1, maxX - minX);

  const yMax = Math.max(
    1,
    ...points.flatMap((p) => [p.baik, p.rusak, p.total]),
  );
  const yTicks = 4;

  const xAt = (x: number) =>
    points.length === 1
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L + ((x - minX) / xRange) * (W - PAD_L - PAD_R);
  const yAt = (v: number) =>
    H - PAD_B - (v / yMax) * (H - PAD_T - PAD_B);

  const line = (key: "baik" | "rusak" | "total") =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(p.x)} ${yAt(p[key])}`)
      .join(" ");

  const areaBaik = `${line("baik")} L ${xAt(points[points.length - 1].x)} ${
    H - PAD_B
  } L ${xAt(points[0].x)} ${H - PAD_B} Z`;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Grafik kondisi aset antar survey"
    >
      {/* gridlines + Y ticks */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (yMax / yTicks) * i;
        const y = yAt(v);
        return (
          <g key={i}>
            <line
              className="chart__grid"
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y}
              y2={y}
            />
            <text className="chart__label" x={4} y={y + 3}>
              {Math.round(v)}
            </text>
          </g>
        );
      })}

      {/* axis */}
      <line
        className="chart__axis"
        x1={PAD_L}
        x2={W - PAD_R}
        y1={H - PAD_B}
        y2={H - PAD_B}
      />

      {/* area for baik (subtle) */}
      <path className="chart__area" d={areaBaik} />

      {/* line: total (muted), rusak (red), baik (primary) */}
      <path
        d={line("total")}
        fill="none"
        stroke="rgba(148,163,184,0.6)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <path
        d={line("rusak")}
        fill="none"
        stroke="#dc2626"
        strokeWidth={2}
      />
      <path className="chart__line" d={line("baik")} />

      {/* dots + labels */}
      {points.map((p, i) => (
        <g key={i}>
          <circle className="chart__dot" cx={xAt(p.x)} cy={yAt(p.baik)} r={3} />
          <circle cx={xAt(p.x)} cy={yAt(p.rusak)} r={3} fill="#dc2626" />
          <text
            className="chart__label"
            x={xAt(p.x)}
            y={H - PAD_B + 14}
            textAnchor="middle"
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default SurveyHistory;
