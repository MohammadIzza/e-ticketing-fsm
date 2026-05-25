import { useCallback, useEffect, useMemo, useState } from "react";
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
  ASSET_CONDITION_VALUES,
  SURVEY_STATUS_LABEL,
  isBrokenCondition,
  type AssetCondition,
  type AssetRow,
  type AssetSurvey,
  type AssetSurveyItem,
  type Building,
  type Room,
} from "../../lib/surveyTypes";
import type { Category, CategorySlaOption } from "../../lib/types";
import { ListToolbar, Pager, useListState } from "./listHelpers";

/**
 * `/survey-aset/do?id=<survey_id>`
 *
 * Tanpa `id` → daftar survey aktif (dengan search + pagination).
 * Dengan `id` → editor checklist + progress bar + ringkasan submit.
 */
function SurveyDo() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const [params] = useSearchParams();
  const surveyId = params.get("id");

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;
  if (access.role !== "petugas" && !access.isSuperadmin) {
    return <Navigate to="/survey-aset" replace />;
  }

  if (!surveyId) {
    return <DoList />;
  }
  return <DoEditor surveyId={surveyId} />;
}

function DoList() {
  const navigate = useNavigate();
  const [surveys, setSurveys] = useState<AssetSurvey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("asset_surveys")
      .select("*")
      .in("status", ["draft", "in_progress", "needs_revision"])
      .order("updated_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (!mounted) return;
        setLoading(false);
        if (err) setError(err.message);
        else setSurveys((data ?? []) as AssetSurvey[]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const ls = useListState(surveys, (s, q) =>
    s.title.toLowerCase().includes(q),
  );

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
          <h1 className="page-title">Do Survey</h1>
        </div>
        <section className="card">
          <p className="section-desc">
            Pilih survey aktif untuk dilanjutkan.
          </p>
          <ListToolbar
            searchValue={ls.search}
            onSearch={ls.setSearch}
            placeholder="Cari judul survey..."
          />
          {loading ? (
            <p className="muted small">Memuat...</p>
          ) : error ? (
            <p className="notice notice--warn">{error}</p>
          ) : ls.total === 0 ? (
            <p className="muted small">
              Belum ada survey aktif. Buat dulu di Planning Survey.
            </p>
          ) : (
            <ul className="list-rows">
              {ls.page.map((s) => (
                <li key={s.id} className="list-row">
                  <div className="list-row__main">
                    <p className="list-row__title">{s.title}</p>
                    <p className="list-row__sub">
                      {SURVEY_STATUS_LABEL[s.status]} ·{" "}
                      {s.building_id ? "Per Gedung" : "Per Ruangan"}
                    </p>
                  </div>
                  <div className="list-row__actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => navigate(`/survey-aset/do?id=${s.id}`)}
                    >
                      Buka
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

interface ItemView {
  item: AssetSurveyItem;
  asset: AssetRow | null;
  room: Room | null;
}

function DoEditor({ surveyId }: { surveyId: string }) {
  const navigate = useNavigate();
  const [survey, setSurvey] = useState<AssetSurvey | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportFor, setReportFor] = useState<ItemView | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [filterRoom, setFilterRoom] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const sRes = await supabase
      .from("asset_surveys")
      .select("*")
      .eq("id", surveyId)
      .maybeSingle();
    if (sRes.error) {
      setError(sRes.error.message);
      setLoading(false);
      return;
    }
    if (!sRes.data) {
      setError("Survey tidak ditemukan atau Anda tidak punya akses.");
      setLoading(false);
      return;
    }
    const sv = sRes.data as AssetSurvey;
    setSurvey(sv);

    // Tergantung scope: load room/building info, plus assets in scope.
    let roomFilter: { ids: string[] } = { ids: [] };
    if (sv.room_id) {
      const rRes = await supabase
        .from("rooms")
        .select("*")
        .eq("id", sv.room_id)
        .maybeSingle();
      if (rRes.data) {
        setRoom(rRes.data as Room);
        roomFilter = { ids: [(rRes.data as Room).id] };
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
      roomFilter = { ids: rs.map((r) => r.id) };
      setRoom(null);
    }

    const [itemRes, assetRes, roomRes] = await Promise.all([
      supabase
        .from("asset_survey_items")
        .select("*")
        .eq("survey_id", surveyId)
        .order("created_at", { ascending: true }),
      roomFilter.ids.length > 0
        ? supabase.from("assets").select("*").in("room_id", roomFilter.ids)
        : Promise.resolve({ data: [] as AssetRow[], error: null }),
      roomFilter.ids.length > 0
        ? supabase.from("rooms").select("*").in("id", roomFilter.ids)
        : Promise.resolve({ data: [] as Room[], error: null }),
    ]);
    setLoading(false);
    if (itemRes.error) {
      setError(itemRes.error.message);
      return;
    }
    if (assetRes.error) {
      setError(assetRes.error.message);
      return;
    }
    const assets = (assetRes.data ?? []) as AssetRow[];
    const rooms = (roomRes.data ?? []) as Room[];
    const aMap = new Map(assets.map((a) => [a.id, a]));
    const rMap = new Map(rooms.map((r) => [r.id, r]));
    const its = ((itemRes.data ?? []) as AssetSurveyItem[]).map((it) => {
      const asset = aMap.get(it.asset_id) ?? null;
      const r = asset ? rMap.get(asset.room_id) ?? null : null;
      return { item: it, asset, room: r };
    });
    setItems(its);
  }, [surveyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writable = useMemo(() => {
    return (
      survey?.status === "draft" ||
      survey?.status === "in_progress" ||
      survey?.status === "needs_revision"
    );
  }, [survey?.status]);

  const filledCount = useMemo(
    () => items.filter((it) => it.item.condition !== null).length,
    [items],
  );
  const totalCount = items.length;
  const progress = totalCount === 0 ? 0 : Math.round((filledCount / totalCount) * 100);

  // Building scope: kelompokkan filter ruangan
  const roomsInScope = useMemo(() => {
    const set = new Map<string, Room>();
    for (const it of items) if (it.room) set.set(it.room.id, it.room);
    return Array.from(set.values()).sort((a, b) =>
      (a.code ?? a.name).localeCompare(b.code ?? b.name),
    );
  }, [items]);

  const filteredItems = useMemo(
    () =>
      filterRoom
        ? items.filter((it) => it.room?.id === filterRoom)
        : items,
    [items, filterRoom],
  );
  const ls = useListState(filteredItems, (it, q) =>
    `${it.asset?.name ?? ""} ${it.asset?.code ?? ""}`.toLowerCase().includes(q),
    20,
  );

  const handleConditionChange = async (
    item: AssetSurveyItem,
    cond: AssetCondition,
  ) => {
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.rpc("survey_save_item", {
      p_item_id: item.id,
      p_condition: cond,
      p_note: item.note,
      p_photo_url: item.photo_url,
    });
    if (err) {
      setError(err.message);
      return;
    }
    void refresh();
  };

  const handleNoteBlur = async (item: AssetSurveyItem, note: string) => {
    if (!item.condition) return;
    if (note === (item.note ?? "")) return;
    setError(null);
    const { error: err } = await supabase.rpc("survey_save_item", {
      p_item_id: item.id,
      p_condition: item.condition,
      p_note: note || null,
      p_photo_url: item.photo_url,
    });
    if (err) setError(err.message);
  };

  const handleMarkAllGood = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("survey_mark_all_good", {
      p_survey_id: surveyId,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    void refresh();
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.rpc("survey_submit", {
      p_survey_id: surveyId,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setShowSummary(true);
    void refresh();
  };

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (error && !survey) {
    return (
      <div className="app">
        <main className="app__main">
          <div className="page-header">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => navigate("/survey-aset/do")}
            >
              ← Kembali
            </button>
            <h1 className="page-title">Survey</h1>
          </div>
          <p className="notice notice--warn">{error}</p>
        </main>
      </div>
    );
  }
  if (!survey) return null;

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
            onClick={() => navigate("/survey-aset/do")}
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
            {survey.status === "needs_revision" && survey.validation_note && (
              <>
                <br />
                <strong>Catatan revisi pimpinan:</strong>{" "}
                {survey.validation_note}
              </>
            )}
          </p>

          <div className="progress-row" style={{ marginTop: "0.7rem" }}>
            <div className="progress" aria-label="Progress survey">
              <div
                className="progress__bar"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="progress-row__label">
              {filledCount}/{totalCount} ({progress}%)
            </span>
          </div>
        </section>

        <section className="card">
          <header className="report-list__header">
            <h2 className="section-title" style={{ margin: 0 }}>
              Checklist Aset
            </h2>
            <span className="badge">{totalCount}</span>
          </header>

          <ListToolbar
            searchValue={ls.search}
            onSearch={ls.setSearch}
            placeholder="Cari nama / kode aset..."
          >
            {building && roomsInScope.length > 1 && (
              <select
                className="list-toolbar__select"
                value={filterRoom}
                onChange={(e) => setFilterRoom(e.target.value)}
                aria-label="Filter berdasarkan ruangan"
              >
                <option value="">Semua Ruangan</option>
                {roomsInScope.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code ? `${r.code} — ${r.name}` : r.name}
                  </option>
                ))}
              </select>
            )}
          </ListToolbar>

          {totalCount === 0 ? (
            <p className="muted small">
              Belum ada aset di lingkup ini. Hubungi superadmin untuk
              menambahkan aset / menerapkan template.
            </p>
          ) : (
            <ul className="list-rows">
              {ls.page.map(({ item, asset, room: r }) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  asset={asset}
                  roomLabel={
                    building && r
                      ? r.code
                        ? `${r.code} — ${r.name}`
                        : r.name
                      : null
                  }
                  writable={!!writable}
                  onChangeCondition={(c) => void handleConditionChange(item, c)}
                  onNoteBlur={(n) => void handleNoteBlur(item, n)}
                  onCreateReport={
                    isBrokenCondition(item.condition) && !item.report_id
                      ? () => setReportFor({ item, asset, room: r })
                      : null
                  }
                />
              ))}
            </ul>
          )}
          <Pager state={ls} />

          {writable && (
            <div className="profile-actions" style={{ marginTop: "0.6rem" }}>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void handleMarkAllGood()}
              >
                Tandai Semua Baik
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || totalCount === 0}
                onClick={() => void handleSubmit()}
              >
                Simpan &amp; Kirim Survey
              </button>
            </div>
          )}

          {error && <p className="notice notice--warn">{error}</p>}
          {info && <p className="notice notice--info">{info}</p>}
        </section>
      </main>

      {reportFor && (
        <ReportFromAssetModal
          item={reportFor.item}
          asset={reportFor.asset}
          room={reportFor.room ?? room}
          onClose={() => setReportFor(null)}
          onCreated={() => {
            setReportFor(null);
            setInfo("Laporan FSM LAPOR berhasil dibuat dan ditautkan.");
            void refresh();
          }}
        />
      )}

      {showSummary && survey && (
        <SurveySummaryModal
          survey={survey}
          items={items}
          onClose={() => {
            setShowSummary(false);
            navigate("/survey-aset/do");
          }}
        />
      )}
    </div>
  );
}

interface ChecklistRowProps {
  item: AssetSurveyItem;
  asset: AssetRow | null;
  roomLabel: string | null;
  writable: boolean;
  onChangeCondition: (c: AssetCondition) => void;
  onNoteBlur: (n: string) => void;
  onCreateReport: (() => void) | null;
}

function ChecklistRow(props: ChecklistRowProps) {
  const { item, asset, roomLabel, writable, onChangeCondition, onNoteBlur } =
    props;
  const [note, setNote] = useState<string>(item.note ?? "");
  const [expanded, setExpanded] = useState<boolean>(item.condition === null);

  useEffect(() => {
    setNote(item.note ?? "");
  }, [item.note]);

  return (
    <li className="list-row" style={{ flexWrap: "wrap" }}>
      <div className="list-row__main">
        <p className="list-row__title">
          {asset?.name ?? "(aset tidak ditemukan)"}
          {asset?.code && (
            <span className="muted small"> · {asset.code}</span>
          )}
        </p>
        <p className="list-row__sub">
          {roomLabel ? `${roomLabel} · ` : ""}
          {item.condition
            ? ASSET_CONDITION_LABEL[item.condition]
            : "Belum dichecklist"}
          {item.report_id ? " · ✓ Laporan dibuat" : ""}
        </p>
      </div>
      <div className="list-row__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Tutup" : "Isi"}
        </button>
        {props.onCreateReport && writable && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={props.onCreateReport}
          >
            Buat Laporan
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ width: "100%", marginTop: "0.4rem" }}>
          <div
            className="report-item__chips"
            style={{ flexWrap: "wrap", gap: "0.4rem" }}
          >
            {ASSET_CONDITION_VALUES.map((c) => (
              <label
                key={c}
                className={
                  item.condition === c
                    ? "btn btn--primary btn--sm"
                    : "btn btn--ghost btn--sm"
                }
                style={{ cursor: writable ? "pointer" : "not-allowed" }}
              >
                <input
                  type="radio"
                  name={`cond-${item.id}`}
                  value={c}
                  checked={item.condition === c}
                  onChange={() => writable && onChangeCondition(c)}
                  disabled={!writable}
                  style={{ display: "none" }}
                />
                {ASSET_CONDITION_LABEL[c]}
              </label>
            ))}
          </div>
          {item.condition && (
            <textarea
              className="field__input"
              rows={2}
              placeholder="Catatan singkat (opsional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => onNoteBlur(note)}
              disabled={!writable}
              style={{ marginTop: "0.4rem" }}
            />
          )}
        </div>
      )}
    </li>
  );
}

/* ---------- Modal: Buat Laporan dari Aset ---------- */

function ReportFromAssetModal(props: {
  item: AssetSurveyItem;
  asset: AssetRow | null;
  room: Room | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { item, asset, room } = props;
  const initialDesc = asset
    ? `Aset "${asset.name}" di ruang ${
        room?.code ?? room?.name ?? "-"
      } ditemukan rusak (${item.condition ?? "-"})${
        item.note ? `. Catatan: ${item.note}` : "."
      }`
    : "";

  const [description, setDescription] = useState(initialDesc);
  const [photoUrl, setPhotoUrl] = useState(item.photo_url ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [slaOptionId, setSlaOptionId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [slaOptions, setSlaOptions] = useState<CategorySlaOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setCategories((data ?? []) as Category[]));
  }, []);

  useEffect(() => {
    setSlaOptionId("");
    if (!categoryId) {
      setSlaOptions([]);
      return;
    }
    supabase
      .from("category_sla_options")
      .select("*")
      .eq("category_id", categoryId)
      .order("sort_order")
      .then(({ data }) =>
        setSlaOptions((data ?? []) as CategorySlaOption[]),
      );
  }, [categoryId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!description.trim() || !photoUrl.trim() || !categoryId) {
      setError("Keterangan, URL foto, dan jenis laporan wajib diisi.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc(
      "survey_create_report_from_asset",
      {
        p_item_id: item.id,
        p_category_id: categoryId,
        p_description: description.trim(),
        p_photo_url: photoUrl.trim(),
        p_sla_option_id: slaOptionId || null,
      },
    );
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    props.onCreated();
  };

  return (
    <div
      className="auth-screen"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        padding: "1rem",
      }}
    >
      <section
        className="card"
        style={{ maxWidth: "520px", width: "100%", margin: "auto" }}
      >
        <header className="page-header">
          <h2 className="page-title" style={{ margin: 0 }}>
            Buat Laporan dari Aset
          </h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={props.onClose}
          >
            ✕
          </button>
        </header>

        <form className="report-form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Jenis Laporan</span>
            <select
              className="field__input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ minHeight: "2.5rem" }}
              required
            >
              <option value="">— Pilih jenis —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {slaOptions.length > 0 && (
            <label className="field">
              <span className="field__label">SLA</span>
              <select
                className="field__input"
                value={slaOptionId}
                onChange={(e) => setSlaOptionId(e.target.value)}
                style={{ minHeight: "2.5rem" }}
                required
              >
                <option value="">— Pilih SLA —</option>
                {slaOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} ({o.hours} jam)
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span className="field__label">Keterangan</span>
            <textarea
              className="field__input"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="field__label">URL Foto</span>
            <input
              type="url"
              className="field__input"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://..."
              required
            />
            <span className="muted small">
              Tempelkan URL foto bukti (atau gunakan halaman /laporan
              untuk ambil foto kamera).
            </span>
          </label>

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy}
          >
            {busy ? "Memproses..." : "Buat Laporan"}
          </button>
          {error && <p className="notice notice--warn">{error}</p>}
        </form>
      </section>
    </div>
  );
}

/* ---------- Modal: Ringkasan akhir setelah submit ---------- */

function SurveySummaryModal(props: {
  survey: AssetSurvey;
  items: ItemView[];
  onClose: () => void;
}) {
  const { items } = props;
  const breakdown = useMemo(() => {
    const counts: Record<string, number> = {
      baik: 0,
      rusak_ringan: 0,
      rusak_berat: 0,
      tidak_ditemukan: 0,
      perlu_diganti: 0,
      _none: 0,
    };
    let withReport = 0;
    for (const { item } of items) {
      if (item.condition) counts[item.condition] += 1;
      else counts._none += 1;
      if (item.report_id) withReport += 1;
    }
    return { counts, withReport };
  }, [items]);

  const total = items.length;
  const broken =
    breakdown.counts.rusak_ringan +
    breakdown.counts.rusak_berat +
    breakdown.counts.perlu_diganti;

  return (
    <div
      className="auth-screen"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        padding: "1rem",
      }}
    >
      <section
        className="card"
        style={{ maxWidth: "560px", width: "100%", margin: "auto" }}
      >
        <header className="page-header">
          <h2 className="page-title" style={{ margin: 0 }}>
            Survey Selesai
          </h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={props.onClose}
          >
            ✕
          </button>
        </header>

        <p className="section-desc">
          Survey "<strong>{props.survey.title}</strong>" telah dikirim
          untuk validasi pimpinan. Berikut ringkasannya:
        </p>

        <div className="summary-grid">
          <div className="summary-tile">
            <span className="summary-tile__value">{total}</span>
            <span className="summary-tile__label">Total Aset</span>
          </div>
          <div className="summary-tile">
            <span className="summary-tile__value">{breakdown.counts.baik}</span>
            <span className="summary-tile__label">Baik</span>
          </div>
          <div className="summary-tile">
            <span className="summary-tile__value">{broken}</span>
            <span className="summary-tile__label">Rusak</span>
          </div>
          <div className="summary-tile">
            <span className="summary-tile__value">
              {breakdown.withReport}
            </span>
            <span className="summary-tile__label">Laporan Dibuat</span>
          </div>
        </div>

        <ul className="list-rows">
          {(
            [
              ["baik", "Baik"],
              ["rusak_ringan", "Rusak Ringan"],
              ["rusak_berat", "Rusak Berat"],
              ["tidak_ditemukan", "Tidak Ditemukan"],
              ["perlu_diganti", "Perlu Diganti"],
            ] as const
          ).map(([k, label]) => (
            <li key={k} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">{label}</p>
              </div>
              <div className="list-row__actions">
                <span className="badge">{breakdown.counts[k]}</span>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={props.onClose}
          style={{ marginTop: "0.7rem" }}
        >
          Selesai
        </button>
      </section>
    </div>
  );
}

export default SurveyDo;
