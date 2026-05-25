import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import { supabase } from "../../lib/supabase";
import {
  ASSET_CONDITION_LABEL,
  type AssetRow,
  type Building,
  type Room,
  type RoomType,
} from "../../lib/surveyTypes";
import {
  fetchSurveySummary,
  type SurveySummary,
} from "../../lib/surveySummary";
import { SummaryHeader } from "./SurveyHome";
import { ListToolbar, Pager, useListState } from "./listHelpers";

/**
 * `/survey-aset/rooms` — daftar gabungan untuk eksplorasi data
 * Gedung → Ruangan → Aset. Tab di atas memilih level yang ditampilkan.
 *
 * Read-only untuk semua user yang punya akses; superadmin punya tombol
 * pintas ke halaman manajemen.
 */
function RoomList() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"buildings" | "rooms" | "assets">("rooms");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SurveySummary | null>(null);

  useEffect(() => {
    if (!access.enabled) return;
    let mounted = true;
    setLoading(true);
    Promise.all([
      supabase.from("buildings").select("*").order("name"),
      supabase.from("rooms").select("*").order("name"),
      supabase.from("room_types").select("*").order("name"),
      supabase.from("assets").select("*").order("name"),
      fetchSurveySummary(),
    ]).then(([bRes, rRes, rtRes, aRes, sum]) => {
      if (!mounted) return;
      setLoading(false);
      if (bRes.error) setError(bRes.error.message);
      else setBuildings((bRes.data ?? []) as Building[]);
      if (rRes.error) setError(rRes.error.message);
      else setRooms((rRes.data ?? []) as Room[]);
      if (!rtRes.error) setRoomTypes((rtRes.data ?? []) as RoomType[]);
      if (!aRes.error) setAssets((aRes.data ?? []) as AssetRow[]);
      setSummary(sum);
    });
    return () => {
      mounted = false;
    };
  }, [access.enabled]);

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.enabled) return <Navigate to="/survey-aset" replace />;

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
          <h1 className="page-title">Daftar Gedung, Ruang &amp; Aset</h1>
        </div>

        <SummaryHeader summary={summary} />

        {access.isSuperadmin && (
          <p className="muted small" style={{ margin: 0 }}>
            Untuk menambah/ubah data, gunakan{" "}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => navigate("/survey-aset/manage")}
              style={{ padding: 0, textDecoration: "underline" }}
            >
              Manajemen Survey Aset
            </button>
            .
          </p>
        )}

        <nav className="view-switcher" role="tablist">
          <div className="view-switcher__tabs">
            {(
              [
                ["buildings", "Gedung"],
                ["rooms", "Ruangan"],
                ["assets", "Aset"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`view-switcher__tab${tab === k ? " is-active" : ""}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        {loading ? (
          <p className="muted small">Memuat...</p>
        ) : error ? (
          <p className="notice notice--warn">{error}</p>
        ) : tab === "buildings" ? (
          <BuildingsView
            buildings={buildings}
            rooms={rooms}
            assets={assets}
          />
        ) : tab === "rooms" ? (
          <RoomsView
            buildings={buildings}
            rooms={rooms}
            roomTypes={roomTypes}
            assets={assets}
          />
        ) : (
          <AssetsView
            buildings={buildings}
            rooms={rooms}
            assets={assets}
          />
        )}
      </main>
    </div>
  );
}

function BuildingsView(props: {
  buildings: Building[];
  rooms: Room[];
  assets: AssetRow[];
}) {
  const navigate = useNavigate();
  const ls = useListState(props.buildings, (b, q) =>
    `${b.code ?? ""} ${b.name} ${b.address ?? ""}`.toLowerCase().includes(q),
  );

  const roomCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of props.rooms)
      if (r.building_id) m.set(r.building_id, (m.get(r.building_id) ?? 0) + 1);
    return m;
  }, [props.rooms]);

  const assetCount = useMemo(() => {
    const roomToBuilding = new Map<string, string | null>();
    for (const r of props.rooms) roomToBuilding.set(r.id, r.building_id);
    const m = new Map<string, number>();
    for (const a of props.assets) {
      const bId = roomToBuilding.get(a.room_id);
      if (bId) m.set(bId, (m.get(bId) ?? 0) + 1);
    }
    return m;
  }, [props.rooms, props.assets]);

  return (
    <section className="card">
      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari gedung..."
      />
      {ls.total === 0 ? (
        <p className="muted small">Belum ada gedung.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((b) => (
            <li key={b.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {b.code ? `${b.code} — ${b.name}` : b.name}
                </p>
                <p className="list-row__sub">
                  {b.address ?? "-"} · {roomCount.get(b.id) ?? 0} ruang ·{" "}
                  {assetCount.get(b.id) ?? 0} aset
                </p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    navigate(`/survey-aset/history?building=${b.id}`)
                  }
                >
                  Histori
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager state={ls} />
    </section>
  );
}

function RoomsView(props: {
  buildings: Building[];
  rooms: Room[];
  roomTypes: RoomType[];
  assets: AssetRow[];
}) {
  const navigate = useNavigate();
  const [filterBuilding, setFilterBuilding] = useState<string>("");

  const filtered = useMemo(
    () =>
      filterBuilding
        ? props.rooms.filter((r) => r.building_id === filterBuilding)
        : props.rooms,
    [props.rooms, filterBuilding],
  );
  const ls = useListState(filtered, (r, q) =>
    `${r.code ?? ""} ${r.name} ${r.floor ?? ""}`.toLowerCase().includes(q),
  );

  const buildingName = (id: string | null) =>
    id
      ? props.buildings.find((b) => b.id === id)?.name ?? "(gedung dihapus)"
      : "-";
  const typeName = (id: string | null) =>
    props.roomTypes.find((t) => t.id === id)?.name ?? "-";
  const assetCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of props.assets)
      m.set(a.room_id, (m.get(a.room_id) ?? 0) + 1);
    return m;
  }, [props.assets]);

  return (
    <section className="card">
      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari ruangan..."
      >
        <select
          className="list-toolbar__select"
          value={filterBuilding}
          onChange={(e) => setFilterBuilding(e.target.value)}
          aria-label="Filter gedung"
        >
          <option value="">Semua Gedung</option>
          {props.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </ListToolbar>

      {ls.total === 0 ? (
        <p className="muted small">Belum ada ruangan.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((r) => (
            <li key={r.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {r.code ? `${r.code} — ${r.name}` : r.name}
                </p>
                <p className="list-row__sub">
                  {buildingName(r.building_id)}
                  {r.floor ? ` · Lt. ${r.floor}` : ""} · {typeName(r.room_type_id)} ·{" "}
                  {assetCount.get(r.id) ?? 0} aset
                </p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => navigate(`/survey-aset/history?room=${r.id}`)}
                >
                  Histori
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager state={ls} />
    </section>
  );
}

function AssetsView(props: {
  buildings: Building[];
  rooms: Room[];
  assets: AssetRow[];
}) {
  const navigate = useNavigate();
  const [filterBuilding, setFilterBuilding] = useState<string>("");
  const [filterRoom, setFilterRoom] = useState<string>("");

  const roomById = useMemo(
    () => new Map(props.rooms.map((r) => [r.id, r])),
    [props.rooms],
  );

  const visibleRooms = useMemo(
    () =>
      filterBuilding
        ? props.rooms.filter((r) => r.building_id === filterBuilding)
        : props.rooms,
    [props.rooms, filterBuilding],
  );

  const filtered = useMemo(() => {
    return props.assets.filter((a) => {
      const r = roomById.get(a.room_id);
      if (!r) return false;
      if (filterBuilding && r.building_id !== filterBuilding) return false;
      if (filterRoom && a.room_id !== filterRoom) return false;
      return true;
    });
  }, [props.assets, roomById, filterBuilding, filterRoom]);

  const ls = useListState(filtered, (a, q) =>
    `${a.name} ${a.code ?? ""}`.toLowerCase().includes(q),
  );

  return (
    <section className="card">
      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari aset..."
      >
        <select
          className="list-toolbar__select"
          value={filterBuilding}
          onChange={(e) => {
            setFilterBuilding(e.target.value);
            setFilterRoom("");
          }}
          aria-label="Filter gedung"
        >
          <option value="">Semua Gedung</option>
          {props.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          className="list-toolbar__select"
          value={filterRoom}
          onChange={(e) => setFilterRoom(e.target.value)}
          aria-label="Filter ruangan"
        >
          <option value="">Semua Ruangan</option>
          {visibleRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code ? `${r.code} — ${r.name}` : r.name}
            </option>
          ))}
        </select>
      </ListToolbar>

      {ls.total === 0 ? (
        <p className="muted small">Belum ada aset.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((a) => {
            const r = roomById.get(a.room_id);
            return (
              <li key={a.id} className="list-row">
                <div className="list-row__main">
                  <p className="list-row__title">
                    {a.name}
                    {a.code && (
                      <span className="muted small"> · {a.code}</span>
                    )}
                  </p>
                  <p className="list-row__sub">
                    {r?.code ?? r?.name ?? "-"} ·{" "}
                    {ASSET_CONDITION_LABEL[a.current_condition]}
                  </p>
                </div>
                <div className="list-row__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => navigate(`/survey-aset/assets/${a.id}`)}
                  >
                    Detail
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pager state={ls} />
    </section>
  );
}

export default RoomList;
