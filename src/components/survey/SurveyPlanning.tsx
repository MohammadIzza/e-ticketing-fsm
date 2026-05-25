import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import { supabase } from "../../lib/supabase";
import {
  SURVEY_STATUS_LABEL,
  type AssetSurvey,
  type Building,
  type Room,
  type SurveyScope,
} from "../../lib/surveyTypes";
import {
  fetchSurveySummary,
  type SurveySummary,
} from "../../lib/surveySummary";
import { SummaryHeader } from "./SurveyHome";
import { ListToolbar, Pager, useListState } from "./listHelpers";

/**
 * `/survey-aset/planning`
 *
 * Petugas/Superadmin:
 *   - Pilih scope: per Ruangan atau per Gedung.
 *   - Daftar survey aktif (draft / in_progress / needs_revision) miliknya.
 *   - Pencarian + pagination di list bawah.
 */
function SurveyPlanning() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [surveys, setSurveys] = useState<AssetSurvey[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [summary, setSummary] = useState<SurveySummary | null>(null);

  const [scope, setScope] = useState<SurveyScope>("room");
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSurveys = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("asset_surveys")
      .select("*")
      .in("status", ["draft", "in_progress", "needs_revision"])
      .order("updated_at", { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    setSurveys((data ?? []) as AssetSurvey[]);
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!access.enabled) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    Promise.all([
      supabase.from("rooms").select("*").order("name"),
      supabase.from("buildings").select("*").order("name"),
      supabase
        .from("asset_surveys")
        .select("*")
        .in("status", ["draft", "in_progress", "needs_revision"])
        .order("updated_at", { ascending: false }),
      fetchSurveySummary(),
    ]).then(([roomsRes, bRes, surveysRes, sum]) => {
      if (!mounted) return;
      setLoadingData(false);
      if (roomsRes.error) setError(roomsRes.error.message);
      else setRooms((roomsRes.data ?? []) as Room[]);
      if (!bRes.error) setBuildings((bRes.data ?? []) as Building[]);
      if (surveysRes.error) {
        setError((e) => e ?? surveysRes.error!.message);
      } else {
        setSurveys((surveysRes.data ?? []) as AssetSurvey[]);
      }
      setSummary(sum);
    });
    return () => {
      mounted = false;
    };
  }, [access.enabled]);

  const ls = useListState(surveys, (s, q) =>
    s.title.toLowerCase().includes(q),
  );

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;
  if (access.role !== "petugas" && !access.isSuperadmin) {
    return <Navigate to="/survey-aset" replace />;
  }

  const handleApplyTemplate = async () => {
    if (!roomId) {
      setError("Pilih ruangan terlebih dahulu untuk apply template.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { data, error: err } = await supabase.rpc("survey_apply_template", {
      p_room_id: roomId,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setInfo(`Template diterapkan: ${data} aset baru ditambahkan.`);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!title.trim()) {
      setError("Judul wajib diisi.");
      return;
    }
    if (scope === "room" && !roomId) {
      setError("Pilih ruangan.");
      return;
    }
    if (scope === "building" && !buildingId) {
      setError("Pilih gedung.");
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc("survey_create", {
      p_title: title.trim(),
      p_room_id: scope === "room" ? roomId : null,
      p_building_id: scope === "building" ? buildingId : null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setTitle("");
    void refreshSurveys();
    if (typeof data === "string") {
      navigate(`/survey-aset/do?id=${data}`);
    } else {
      setInfo("Survey dibuat.");
    }
  };

  const buildingName = (id: string | null) =>
    id ? buildings.find((b) => b.id === id)?.name ?? "(gedung)" : null;
  const roomName = (id: string | null) => {
    if (!id) return null;
    const r = rooms.find((x) => x.id === id);
    return r ? (r.code ? `${r.code} — ${r.name}` : r.name) : "(ruang)";
  };

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
          <h1 className="page-title">Planning Survey</h1>
        </div>

        <SummaryHeader summary={summary} />

        <section className="card">
          <h2 className="section-title">Buat Survey Baru</h2>
          <form className="report-form" onSubmit={handleCreate}>
            <label className="field">
              <span className="field__label">Judul Survey</span>
              <input
                type="text"
                className="field__input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="cth: Survey Awal Kelas A-201"
                required
              />
            </label>

            <fieldset className="field">
              <span className="field__label">Lingkup Survey</span>
              <div className="profile-actions">
                {(
                  [
                    ["room", "Per Ruangan"],
                    ["building", "Per Gedung"],
                  ] as const
                ).map(([k, label]) => (
                  <label
                    key={k}
                    className={
                      scope === k
                        ? "btn btn--primary btn--sm"
                        : "btn btn--ghost btn--sm"
                    }
                    style={{ cursor: "pointer" }}
                  >
                    <input
                      type="radio"
                      name="scope"
                      value={k}
                      checked={scope === k}
                      onChange={() => setScope(k)}
                      style={{ display: "none" }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {scope === "room" ? (
              <label className="field">
                <span className="field__label">Ruangan</span>
                <select
                  className="field__input"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                  required
                >
                  <option value="">— Pilih ruangan —</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code ? `${r.code} — ${r.name}` : r.name}
                      {r.building_id
                        ? ` (${buildingName(r.building_id) ?? "?"})`
                        : ""}
                    </option>
                  ))}
                </select>
                {rooms.length === 0 && !loadingData && (
                  <span className="muted small">
                    Belum ada ruangan. Hubungi superadmin.
                  </span>
                )}
              </label>
            ) : (
              <label className="field">
                <span className="field__label">Gedung</span>
                <select
                  className="field__input"
                  value={buildingId}
                  onChange={(e) => setBuildingId(e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                  required
                >
                  <option value="">— Pilih gedung —</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code ? `${b.code} — ${b.name}` : b.name}
                    </option>
                  ))}
                </select>
                {buildings.length === 0 && !loadingData && (
                  <span className="muted small">
                    Belum ada gedung. Hubungi superadmin.
                  </span>
                )}
              </label>
            )}

            <div className="profile-actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={
                  busy ||
                  (scope === "room"
                    ? rooms.length === 0
                    : buildings.length === 0)
                }
              >
                {busy ? "Memproses..." : "Buat Survey"}
              </button>
              {access.isSuperadmin && scope === "room" && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy || !roomId}
                  onClick={() => void handleApplyTemplate()}
                  title="Tambahkan aset default sesuai jenis ruang ke ruang ini (idempotent)."
                >
                  Apply Template Aset
                </button>
              )}
            </div>

            {error && <p className="notice notice--warn">{error}</p>}
            {info && <p className="notice notice--info">{info}</p>}
          </form>
        </section>

        <section className="card">
          <h2 className="section-title">Survey Berjalan</h2>
          <ListToolbar
            searchValue={ls.search}
            onSearch={ls.setSearch}
            placeholder="Cari judul survey..."
          />
          {loadingData ? (
            <p className="muted small">Memuat...</p>
          ) : ls.total === 0 ? (
            <p className="muted small">Belum ada survey aktif.</p>
          ) : (
            <ul className="list-rows">
              {ls.page.map((s) => {
                const scopeLabel = s.building_id
                  ? `Gedung: ${buildingName(s.building_id) ?? "-"}`
                  : `Ruang: ${roomName(s.room_id) ?? "-"}`;
                return (
                  <li key={s.id} className="list-row">
                    <div className="list-row__main">
                      <p className="list-row__title">{s.title}</p>
                      <p className="list-row__sub">
                        {SURVEY_STATUS_LABEL[s.status]} · {scopeLabel}
                      </p>
                    </div>
                    <div className="list-row__actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => navigate(`/survey-aset/do?id=${s.id}`)}
                      >
                        Mulai / Lanjut
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <Pager state={ls} />
        </section>
      </main>
    </div>
  );
}

export default SurveyPlanning;
