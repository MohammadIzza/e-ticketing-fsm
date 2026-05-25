import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import { supabase } from "../../lib/supabase";
import {
  ASSET_CONDITION_LABEL,
  SURVEY_STATUS_LABEL,
  type AssetRow,
  type AssetSurvey,
  type AssetSurveyItem,
  type Building,
  type Room,
} from "../../lib/surveyTypes";
import { ListToolbar, Pager, useListState } from "./listHelpers";

/**
 * `/survey-aset/check` — Pimpinan/Superadmin.
 */
function SurveyCheck() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const [params] = useSearchParams();
  const surveyId = params.get("id");

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;
  if (access.role !== "pimpinan" && !access.isSuperadmin) {
    return <Navigate to="/survey-aset" replace />;
  }

  if (!surveyId) {
    return <CheckList />;
  }
  return <CheckDetail surveyId={surveyId} />;
}

function CheckList() {
  const navigate = useNavigate();
  const [list, setList] = useState<AssetSurvey[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("submitted");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    supabase
      .from("asset_surveys")
      .select("*")
      .in("status", ["submitted", "needs_revision", "validated"])
      .order("updated_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!mounted) return;
        setLoading(false);
        setList((data ?? []) as AssetSurvey[]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = statusFilter === "all"
    ? list
    : list.filter((s) => s.status === statusFilter);
  const ls = useListState(filtered, (s, q) => s.title.toLowerCase().includes(q));

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
          <h1 className="page-title">Check Survey</h1>
        </div>

        <section className="card">
          <ListToolbar
            searchValue={ls.search}
            onSearch={ls.setSearch}
            placeholder="Cari judul survey..."
          >
            <select
              className="list-toolbar__select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter status"
            >
              <option value="submitted">Menunggu Validasi</option>
              <option value="needs_revision">Perlu Revisi</option>
              <option value="validated">Tervalidasi</option>
              <option value="all">Semua</option>
            </select>
          </ListToolbar>

          {loading ? (
            <p className="muted small">Memuat...</p>
          ) : ls.total === 0 ? (
            <p className="muted small">Tidak ada survey untuk filter ini.</p>
          ) : (
            <ul className="list-rows">
              {ls.page.map((s) => (
                <li key={s.id} className="list-row">
                  <div className="list-row__main">
                    <p className="list-row__title">{s.title}</p>
                    <p className="list-row__sub">
                      {SURVEY_STATUS_LABEL[s.status]} ·{" "}
                      {s.building_id ? "Per Gedung" : "Per Ruangan"} ·{" "}
                      {new Date(s.updated_at).toLocaleDateString("id-ID")}
                    </p>
                  </div>
                  <div className="list-row__actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => navigate(`/survey-aset/check?id=${s.id}`)}
                    >
                      Detail
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager state={ls} />
        </section>
      </main>
    </div>
  );
}

interface ItemWithAsset {
  item: AssetSurveyItem;
  asset: AssetRow | null;
}

function CheckDetail({ surveyId }: { surveyId: string }) {
  const navigate = useNavigate();
  const [survey, setSurvey] = useState<AssetSurvey | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [items, setItems] = useState<ItemWithAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sRes = await supabase
      .from("asset_surveys")
      .select("*")
      .eq("id", surveyId)
      .maybeSingle();
    if (sRes.error || !sRes.data) {
      setLoading(false);
      setError(sRes.error?.message ?? "Survey tidak ditemukan.");
      return;
    }
    const sv = sRes.data as AssetSurvey;
    setSurvey(sv);

    let assetIds: string[] = [];
    let roomIds: string[] = [];
    if (sv.room_id) {
      const rRes = await supabase
        .from("rooms")
        .select("*")
        .eq("id", sv.room_id)
        .maybeSingle();
      if (rRes.data) {
        setRoom(rRes.data as Room);
        roomIds = [(rRes.data as Room).id];
      }
      setBuilding(null);
    } else if (sv.building_id) {
      const [bRes, rsRes] = await Promise.all([
        supabase
          .from("buildings")
          .select("*")
          .eq("id", sv.building_id)
          .maybeSingle(),
        supabase
          .from("rooms")
          .select("*")
          .eq("building_id", sv.building_id),
      ]);
      if (bRes.data) setBuilding(bRes.data as Building);
      const rs = (rsRes.data ?? []) as Room[];
      roomIds = rs.map((r) => r.id);
      setRoom(null);
    }

    const [itemRes, assetRes] = await Promise.all([
      supabase
        .from("asset_survey_items")
        .select("*")
        .eq("survey_id", surveyId)
        .order("created_at"),
      roomIds.length > 0
        ? supabase.from("assets").select("*").in("room_id", roomIds)
        : Promise.resolve({ data: [] as AssetRow[], error: null }),
    ]);
    setLoading(false);
    const assets = (assetRes.data ?? []) as AssetRow[];
    const map = new Map(assets.map((a) => [a.id, a]));
    assetIds = assets.map((a) => a.id);
    void assetIds;
    const its = ((itemRes.data ?? []) as AssetSurveyItem[]).map((it) => ({
      item: it,
      asset: map.get(it.asset_id) ?? null,
    }));
    setItems(its);
  }, [surveyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ls = useListState(items, (it, q) =>
    `${it.asset?.name ?? ""} ${it.asset?.code ?? ""}`.toLowerCase().includes(q),
    20,
  );

  const validate = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.rpc("survey_validate", {
      p_survey_id: surveyId,
      p_note: revisionNote.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setInfo("Survey divalidasi. Kondisi aset terbaru sudah diperbarui.");
    setRevisionNote("");
    void refresh();
  };

  const requestRevision = async () => {
    if (!revisionNote.trim()) {
      setError("Catatan revisi wajib diisi.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.rpc("survey_request_revision", {
      p_survey_id: surveyId,
      p_note: revisionNote.trim(),
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setInfo("Permintaan revisi terkirim.");
    setRevisionNote("");
    void refresh();
  };

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!survey) {
    return (
      <div className="app">
        <main className="app__main">
          <p className="notice notice--warn">{error ?? "Tidak ditemukan"}</p>
        </main>
      </div>
    );
  }

  const editable = survey.status === "submitted";

  const scopeLine = building
    ? `Gedung: ${building.code ? `${building.code} — ${building.name}` : building.name}`
    : room
      ? `Ruang: ${room.code ? `${room.code} — ${room.name}` : room.name}`
      : "-";

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/survey-aset/check")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">{survey.title}</h1>
        </div>

        <section className="card">
          <p className="muted small" style={{ margin: 0 }}>
            <strong>Lingkup:</strong> {scopeLine}
            <br />
            <strong>Status:</strong> {SURVEY_STATUS_LABEL[survey.status]}
            {survey.validation_note && (
              <>
                <br />
                <strong>Catatan terakhir:</strong> {survey.validation_note}
              </>
            )}
          </p>
        </section>

        <section className="card">
          <h2 className="section-title">Hasil Checklist</h2>
          <ListToolbar
            searchValue={ls.search}
            onSearch={ls.setSearch}
            placeholder="Cari nama / kode aset..."
          />
          {ls.total === 0 ? (
            <p className="muted small">Tidak ada item.</p>
          ) : (
            <ul className="list-rows">
              {ls.page.map(({ item, asset }) => (
                <li key={item.id} className="list-row">
                  <div className="list-row__main">
                    <p className="list-row__title">
                      {asset?.name ?? "(aset hilang)"}
                    </p>
                    <p className="list-row__sub">
                      Kondisi:{" "}
                      <strong>
                        {item.condition
                          ? ASSET_CONDITION_LABEL[item.condition]
                          : "(belum diisi)"}
                      </strong>
                      {item.note && <> · {item.note}</>}
                    </p>
                  </div>
                  <div className="list-row__actions">
                    {item.report_id && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => navigate(`/laporan/${item.report_id}`)}
                      >
                        Lihat Laporan
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager state={ls} />
        </section>

        {editable && (
          <section className="card">
            <h2 className="section-title">Putusan</h2>
            <label className="field">
              <span className="field__label">
                Catatan (wajib untuk Minta Revisi)
              </span>
              <textarea
                className="field__input"
                rows={3}
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
              />
            </label>
            <div className="profile-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void validate()}
              >
                Validasi Survey
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void requestRevision()}
              >
                Minta Revisi
              </button>
            </div>
            {error && <p className="notice notice--warn">{error}</p>}
            {info && <p className="notice notice--info">{info}</p>}
          </section>
        )}
      </main>
    </div>
  );
}

export default SurveyCheck;
