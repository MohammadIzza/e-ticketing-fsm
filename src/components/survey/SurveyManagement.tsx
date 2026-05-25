import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSurveyAccess } from "../../hooks/useSurveyAccess";
import { supabase } from "../../lib/supabase";
import {
  type AssetRow,
  type Building,
  type Room,
  type RoomType,
  type RoomTypeAssetTemplate,
  type SurveyModuleAccessRow,
} from "../../lib/surveyTypes";
import type { Profile, Role } from "../../lib/types";
import { downloadCsv, encodeCsv, parseCsv } from "../../lib/csv";
import {
  fetchSurveySummary,
  type SurveySummary,
} from "../../lib/surveySummary";
import { SummaryHeader } from "./SurveyHome";
import { ListToolbar, Pager, useListState } from "./listHelpers";

/**
 * `/survey-aset/manage` — superadmin-only.
 *
 * Tab:
 *   1. Akses Modul
 *   2. Gedung           (baru)
 *   3. Jenis Ruang
 *   4. Template Aset
 *   5. Ruangan
 *   6. Aset             (PR-A: tambah aset langsung, bisa juga buat
 *                        ruangan baru sekaligus dalam 1 alur form)
 *   7. Import / Export
 */
function SurveyManagement() {
  const { session, loading: authLoading } = useAuth();
  const access = useSurveyAccess();
  const navigate = useNavigate();
  const [tab, setTab] = useState<
    "access" | "buildings" | "types" | "templates" | "rooms" | "assets" | "io"
  >("access");

  const [summary, setSummary] = useState<SurveySummary | null>(null);
  useEffect(() => {
    if (!access.isSuperadmin) return;
    fetchSurveySummary().then(setSummary);
  }, [access.isSuperadmin, tab]);

  if (authLoading || access.loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!access.isSuperadmin) return <Navigate to="/survey-aset" replace />;

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
          <h1 className="page-title">Manajemen Survey Aset</h1>
        </div>

        <SummaryHeader summary={summary} />

        <nav
          className="view-switcher"
          role="tablist"
          aria-label="Pilih tab manajemen"
        >
          <div className="view-switcher__tabs">
            {(
              [
                ["access", "Akses"],
                ["buildings", "Gedung"],
                ["types", "Jenis Ruang"],
                ["templates", "Template"],
                ["rooms", "Ruangan"],
                ["assets", "Aset"],
                ["io", "Import/Export"],
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

        {tab === "access" && <AccessTab />}
        {tab === "buildings" && <BuildingsTab />}
        {tab === "types" && <RoomTypesTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "rooms" && <RoomsTab />}
        {tab === "assets" && <AssetsTab />}
        {tab === "io" && <ImportExportTab />}
      </main>
    </div>
  );
}

/* ============================================================================
 * Tab — Akses Modul
 * ============================================================================ */

interface CandidateUser {
  profile: Profile;
  roles: Role[];
}

function AccessTab() {
  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [accessRows, setAccessRows] = useState<SurveyModuleAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [profRes, roleRes, accRes] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("user_roles").select("*"),
      supabase.from("survey_module_access").select("*"),
    ]);
    setLoading(false);
    if (profRes.error) {
      setError(profRes.error.message);
      return;
    }
    const profiles = (profRes.data ?? []) as Profile[];
    const rolesByUser = new Map<string, Role[]>();
    for (const r of (roleRes.data ?? []) as { user_id: string; role: Role }[]) {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    }
    const cands: CandidateUser[] = profiles
      .map((p) => ({ profile: p, roles: rolesByUser.get(p.id) ?? [] }))
      .filter(
        (c) => c.roles.includes("petugas") || c.roles.includes("pimpinan"),
      );
    cands.sort((a, b) =>
      (a.profile.full_name || a.profile.email || "").localeCompare(
        b.profile.full_name || b.profile.email || "",
      ),
    );
    setCandidates(cands);
    setAccessRows((accRes.data ?? []) as SurveyModuleAccessRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accessMap = new Map(accessRows.map((r) => [r.user_id, r]));
  const list = useListState(candidates, (c, q) =>
    `${c.profile.full_name ?? ""} ${c.profile.email ?? ""}`
      .toLowerCase()
      .includes(q),
  );

  const grant = async (userId: string) => {
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.rpc("survey_grant_access", {
      p_user_id: userId,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setInfo("Akses diberikan.");
    void load();
  };
  const revoke = async (userId: string) => {
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.rpc("survey_revoke_access", {
      p_user_id: userId,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setInfo("Akses dicabut.");
    void load();
  };

  return (
    <section className="card">
      <h2 className="section-title">Akses Modul Survey Aset</h2>
      <p className="section-desc">
        Berikan izin ke Petugas / Pimpinan agar tombol "Survey dan Aset"
        muncul di dashboard mereka.
      </p>

      <ListToolbar
        searchValue={list.search}
        onSearch={list.setSearch}
        placeholder="Cari nama / email..."
      />

      {loading ? (
        <p className="muted small">Memuat...</p>
      ) : error ? (
        <p className="notice notice--warn">{error}</p>
      ) : list.total === 0 ? (
        <p className="muted small">
          Belum ada user dengan role petugas / pimpinan.
        </p>
      ) : (
        <ul className="list-rows">
          {list.page.map((c) => {
            const a = accessMap.get(c.profile.id);
            const enabled = !!a?.enabled;
            return (
              <li key={c.profile.id} className="list-row">
                <div className="list-row__main">
                  <p className="list-row__title">
                    {c.profile.full_name ||
                      c.profile.email ||
                      "(tanpa nama)"}
                  </p>
                  <p className="list-row__sub">
                    {c.roles.join(", ")}
                    {enabled ? " · ✓ punya akses" : " · belum diberi akses"}
                  </p>
                </div>
                <div className="list-row__actions">
                  {enabled ? (
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => void revoke(c.profile.id)}
                    >
                      Cabut
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => void grant(c.profile.id)}
                    >
                      Beri Akses
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pager state={list} />
      {info && <p className="notice notice--info">{info}</p>}
    </section>
  );
}

/* ============================================================================
 * Tab — Gedung (buildings)
 * ============================================================================ */

function BuildingsTab() {
  const [list, setList] = useState<Building[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("buildings")
      .select("*")
      .order("name");
    setLoading(false);
    if (err) setError(err.message);
    else setList((data ?? []) as Building[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const ls = useListState(list, (b, q) =>
    `${b.code ?? ""} ${b.name} ${b.address ?? ""}`.toLowerCase().includes(q),
  );

  const reset = () => {
    setCode("");
    setName("");
    setAddress("");
    setEditingId(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    if (editingId) {
      const { error: err } = await supabase
        .from("buildings")
        .update({
          code: code.trim() || null,
          name: name.trim(),
          address: address.trim() || null,
        })
        .eq("id", editingId);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase.from("buildings").insert({
        code: code.trim() || null,
        name: name.trim(),
        address: address.trim() || null,
      });
      if (err) {
        setError(err.message);
        return;
      }
    }
    reset();
    void load();
  };
  const startEdit = (b: Building) => {
    setEditingId(b.id);
    setCode(b.code ?? "");
    setName(b.name);
    setAddress(b.address ?? "");
  };
  const remove = async (id: string) => {
    if (!confirm("Hapus gedung ini? Ruangan-nya akan kehilangan tautan.")) return;
    const { error: err } = await supabase
      .from("buildings")
      .delete()
      .eq("id", id);
    if (err) setError(err.message);
    else void load();
  };

  return (
    <section className="card">
      <h2 className="section-title">Gedung</h2>
      <form className="report-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Kode (opsional, unik)</span>
          <input
            type="text"
            className="field__input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="cth: GED-A"
          />
        </label>
        <label className="field">
          <span className="field__label">Nama</span>
          <input
            type="text"
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Gedung A"
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Alamat (opsional)</span>
          <input
            type="text"
            className="field__input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <div className="profile-actions">
          <button type="submit" className="btn btn--primary">
            {editingId ? "Simpan Perubahan" : "Tambah Gedung"}
          </button>
          {editingId && (
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Batal
            </button>
          )}
        </div>
      </form>

      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari kode / nama / alamat..."
      />

      {loading ? (
        <p className="muted small">Memuat...</p>
      ) : ls.total === 0 ? (
        <p className="muted small">Belum ada gedung.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((b) => (
            <li key={b.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {b.code ? `${b.code} — ${b.name}` : b.name}
                </p>
                <p className="list-row__sub">{b.address ?? "-"}</p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => startEdit(b)}
                >
                  Ubah
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void remove(b.id)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager state={ls} />
      {error && <p className="notice notice--warn">{error}</p>}
    </section>
  );
}

/* ============================================================================
 * Tab — Jenis Ruang (room_types)
 * ============================================================================ */

function RoomTypesTab() {
  const [list, setList] = useState<RoomType[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("room_types")
      .select("*")
      .order("name");
    setLoading(false);
    if (err) setError(err.message);
    else setList((data ?? []) as RoomType[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ls = useListState(list, (t, q) =>
    `${t.name} ${t.description ?? ""}`.toLowerCase().includes(q),
  );

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { error: err } = await supabase.from("room_types").insert({
      name: name.trim(),
      description: description.trim() || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setName("");
    setDescription("");
    void load();
  };
  const remove = async (id: string) => {
    if (!confirm("Hapus jenis ruang ini?")) return;
    const { error: err } = await supabase
      .from("room_types")
      .delete()
      .eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    void load();
  };

  return (
    <section className="card">
      <h2 className="section-title">Jenis Ruang</h2>
      <form className="report-form" onSubmit={add}>
        <label className="field">
          <span className="field__label">Nama Jenis</span>
          <input
            type="text"
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Ruang Kelas, Lab Komputer, Kantor"
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Deskripsi (opsional)</span>
          <input
            type="text"
            className="field__input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--primary">
          Tambah
        </button>
      </form>

      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari jenis ruang..."
      />

      {loading ? (
        <p className="muted small">Memuat...</p>
      ) : ls.total === 0 ? (
        <p className="muted small">Belum ada jenis ruang.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((t) => (
            <li key={t.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">{t.name}</p>
                {t.description && (
                  <p className="list-row__sub">{t.description}</p>
                )}
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void remove(t.id)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager state={ls} />
      {error && <p className="notice notice--warn">{error}</p>}
    </section>
  );
}

/* ============================================================================
 * Tab — Template Aset
 * ============================================================================ */

function TemplatesTab() {
  const [types, setTypes] = useState<RoomType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [list, setList] = useState<RoomTypeAssetTemplate[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("room_types")
      .select("*")
      .order("name")
      .then(({ data }) => setTypes((data ?? []) as RoomType[]));
  }, []);

  const reload = useCallback(async () => {
    if (!typeId) {
      setList([]);
      return;
    }
    const { data, error: err } = await supabase
      .from("room_type_asset_templates")
      .select("*")
      .eq("room_type_id", typeId)
      .order("asset_name");
    if (err) setError(err.message);
    else setList((data ?? []) as RoomTypeAssetTemplate[]);
  }, [typeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ls = useListState(list, (t, q) =>
    t.asset_name.toLowerCase().includes(q),
  );

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!typeId || !name.trim()) return;
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("Jumlah default minimal 1.");
      return;
    }
    const { error: err } = await supabase
      .from("room_type_asset_templates")
      .insert({
        room_type_id: typeId,
        asset_name: name.trim(),
        default_quantity: n,
      });
    if (err) {
      setError(err.message);
      return;
    }
    setName("");
    setQty("1");
    void reload();
  };
  const remove = async (id: string) => {
    if (!confirm("Hapus template aset ini?")) return;
    const { error: err } = await supabase
      .from("room_type_asset_templates")
      .delete()
      .eq("id", id);
    if (err) setError(err.message);
    else void reload();
  };

  return (
    <section className="card">
      <h2 className="section-title">Template Aset per Jenis Ruang</h2>
      <p className="section-desc">
        Template ini di-apply otomatis ke ruang lewat tombol "Apply
        Template Aset" di Planning Survey.
      </p>

      <label className="field">
        <span className="field__label">Pilih Jenis Ruang</span>
        <select
          className="field__input"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          style={{ minHeight: "2.5rem" }}
        >
          <option value="">— Pilih —</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {typeId && (
        <>
          <form className="report-form" onSubmit={add}>
            <label className="field">
              <span className="field__label">Nama Aset Template</span>
              <input
                type="text"
                className="field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="cth: Whiteboard, Meja Guru, AC, Proyektor"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Jumlah Default</span>
              <input
                type="number"
                className="field__input"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn btn--primary">
              Tambah Template
            </button>
          </form>

          <ListToolbar
            searchValue={ls.search}
            onSearch={ls.setSearch}
            placeholder="Cari template..."
          />

          {ls.total === 0 ? (
            <p className="muted small">Belum ada template untuk jenis ini.</p>
          ) : (
            <ul className="list-rows">
              {ls.page.map((t) => (
                <li key={t.id} className="list-row">
                  <div className="list-row__main">
                    <p className="list-row__title">{t.asset_name}</p>
                    <p className="list-row__sub">
                      Default × {t.default_quantity}
                    </p>
                  </div>
                  <div className="list-row__actions">
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => void remove(t.id)}
                    >
                      Hapus
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager state={ls} />
        </>
      )}

      {error && <p className="notice notice--warn">{error}</p>}
    </section>
  );
}

/* ============================================================================
 * Tab — Ruangan
 * ============================================================================ */

function RoomsTab() {
  const [types, setTypes] = useState<RoomType[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [list, setList] = useState<Room[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floor, setFloor] = useState("");
  const [typeId, setTypeId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [filterBuilding, setFilterBuilding] = useState<string>("");

  const load = useCallback(async () => {
    const [tRes, bRes, rRes] = await Promise.all([
      supabase.from("room_types").select("*").order("name"),
      supabase.from("buildings").select("*").order("name"),
      supabase.from("rooms").select("*").order("name"),
    ]);
    setTypes((tRes.data ?? []) as RoomType[]);
    setBuildings((bRes.data ?? []) as Building[]);
    setList((rRes.data ?? []) as Room[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      list.filter((r) =>
        filterBuilding ? r.building_id === filterBuilding : true,
      ),
    [list, filterBuilding],
  );

  const ls = useListState(filtered, (r, q) =>
    `${r.code ?? ""} ${r.name} ${r.building ?? ""} ${r.floor ?? ""}`
      .toLowerCase()
      .includes(q),
  );

  const reset = () => {
    setCode("");
    setName("");
    setBuildingId("");
    setFloor("");
    setTypeId("");
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!name.trim()) return;
    const payload = {
      code: code.trim() || null,
      name: name.trim(),
      building_id: buildingId || null,
      floor: floor.trim() || null,
      room_type_id: typeId || null,
    };
    if (editingId) {
      const { error: err } = await supabase
        .from("rooms")
        .update(payload)
        .eq("id", editingId);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase.from("rooms").insert(payload);
      if (err) {
        setError(err.message);
        return;
      }
    }
    reset();
    void load();
  };
  const startEdit = (r: Room) => {
    setEditingId(r.id);
    setCode(r.code ?? "");
    setName(r.name);
    setBuildingId(r.building_id ?? "");
    setFloor(r.floor ?? "");
    setTypeId(r.room_type_id ?? "");
  };
  const remove = async (id: string) => {
    if (!confirm("Hapus ruangan ini? Aset di dalamnya akan ikut terhapus.")) return;
    const { error: err } = await supabase.from("rooms").delete().eq("id", id);
    if (err) setError(err.message);
    else void load();
  };
  const apply = async (id: string) => {
    setError(null);
    setInfo(null);
    const { data, error: err } = await supabase.rpc("survey_apply_template", {
      p_room_id: id,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setInfo(`Template diterapkan: ${data} aset baru.`);
  };

  const buildingName = (id: string | null) =>
    id ? buildings.find((b) => b.id === id)?.name ?? "(gedung dihapus)" : "-";

  return (
    <section className="card">
      <h2 className="section-title">Ruangan</h2>
      <form className="report-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Kode (opsional, unik)</span>
          <input
            type="text"
            className="field__input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="cth: A-201"
          />
        </label>
        <label className="field">
          <span className="field__label">Nama</span>
          <input
            type="text"
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Kelas A-201"
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Gedung</span>
          <select
            className="field__input"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
            style={{ minHeight: "2.5rem" }}
          >
            <option value="">— Pilih (opsional) —</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code ? `${b.code} — ${b.name}` : b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Lantai (opsional)</span>
          <input
            type="text"
            className="field__input"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            placeholder="Lantai 2"
          />
        </label>
        <label className="field">
          <span className="field__label">Jenis Ruang</span>
          <select
            className="field__input"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            style={{ minHeight: "2.5rem" }}
          >
            <option value="">— Pilih (opsional) —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="profile-actions">
          <button type="submit" className="btn btn--primary">
            {editingId ? "Simpan Perubahan" : "Tambah Ruangan"}
          </button>
          {editingId && (
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Batal
            </button>
          )}
        </div>
      </form>

      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari kode / nama ruangan..."
      >
        <select
          className="list-toolbar__select"
          value={filterBuilding}
          onChange={(e) => setFilterBuilding(e.target.value)}
          aria-label="Filter berdasarkan gedung"
        >
          <option value="">Semua Gedung</option>
          {buildings.map((b) => (
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
                  {r.floor ? ` · Lt. ${r.floor}` : ""}
                </p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void apply(r.id)}
                  disabled={!r.room_type_id}
                  title={
                    r.room_type_id
                      ? "Apply template aset sesuai jenis ruang."
                      : "Set jenis ruang dulu."
                  }
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => startEdit(r)}
                >
                  Ubah
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void remove(r.id)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager state={ls} />
      {error && <p className="notice notice--warn">{error}</p>}
      {info && <p className="notice notice--info">{info}</p>}
    </section>
  );
}

/* ============================================================================
 * Tab — Aset (PR-A items #5, #6, #7)
 *
 * Form ini menggabungkan tiga revisi:
 *   #5 Tambah aset tanpa harus buat ruangan baru   → mode "Pilih Ruangan
 *      Existing" (default).
 *   #6 Buat ruangan baru + aset sekaligus dalam 1 alur form → mode
 *      "Buat Ruangan Baru". Ruangan di-INSERT dulu, lalu aset-aset di-
 *      INSERT dengan room_id tersebut.
 *   #7 Dropdown / search untuk memilih nama aset dari daftar yang sudah
 *      terdaftar → input nama aset memakai HTML <datalist> ber-isi nama
 *      distinct dari `assets.name` (autocomplete native, tanpa lib
 *      tambahan).
 *
 * Bagian bawah: daftar semua aset (filter gedung/ruang + search) dengan
 * tombol Hapus untuk superadmin.
 * ============================================================================ */

interface AssetDraft {
  /** Local key (random) untuk React. */
  key: string;
  name: string;
  code: string;
  condition: import("../../lib/surveyTypes").AssetCondition;
  notes: string;
}

const CONDITION_OPTIONS: {
  value: import("../../lib/surveyTypes").AssetCondition;
  label: string;
}[] = [
  { value: "baik", label: "Baik" },
  { value: "rusak_ringan", label: "Rusak Ringan" },
  { value: "rusak_berat", label: "Rusak Berat" },
  { value: "tidak_ditemukan", label: "Tidak Ditemukan" },
  { value: "perlu_diganti", label: "Perlu Diganti" },
];

function newAssetDraft(): AssetDraft {
  return {
    key: Math.random().toString(36).slice(2, 10),
    name: "",
    code: "",
    condition: "baik",
    notes: "",
  };
}

function AssetsTab() {
  const [mode, setMode] = useState<"existing" | "new">("existing");

  // Existing-room mode
  const [roomId, setRoomId] = useState<string>("");

  // New-room mode (mirrors RoomsTab fields)
  const [newRoomCode, setNewRoomCode] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomBuildingId, setNewRoomBuildingId] = useState("");
  const [newRoomFloor, setNewRoomFloor] = useState("");
  const [newRoomTypeId, setNewRoomTypeId] = useState("");

  // Aset rows (selalu minimal 1 row)
  const [drafts, setDrafts] = useState<AssetDraft[]>([newAssetDraft()]);

  // Reference data
  const [rooms, setRooms] = useState<Room[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [allAssets, setAllAssets] = useState<AssetRow[]>([]);

  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // List view filters
  const [filterBuilding, setFilterBuilding] = useState<string>("");
  const [filterRoom, setFilterRoom] = useState<string>("");

  const load = useCallback(async () => {
    const [rRes, bRes, rtRes, aRes] = await Promise.all([
      supabase.from("rooms").select("*").order("name"),
      supabase.from("buildings").select("*").order("name"),
      supabase.from("room_types").select("*").order("name"),
      supabase.from("assets").select("*").order("name"),
    ]);
    setRooms((rRes.data ?? []) as Room[]);
    setBuildings((bRes.data ?? []) as Building[]);
    setRoomTypes((rtRes.data ?? []) as RoomType[]);
    setAllAssets((aRes.data ?? []) as AssetRow[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Datalist sources untuk Item #7 — autocomplete nama & kode aset. */
  const distinctAssetNames = useMemo(() => {
    const set = new Set<string>();
    for (const a of allAssets) {
      const n = a.name.trim();
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
  }, [allAssets]);

  const updateDraft = (key: string, patch: Partial<AssetDraft>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );
  };
  const removeDraft = (key: string) => {
    setDrafts((prev) =>
      prev.length === 1 ? prev : prev.filter((d) => d.key !== key),
    );
  };
  const addDraft = () => setDrafts((prev) => [...prev, newAssetDraft()]);

  const resetForm = () => {
    setMode("existing");
    setRoomId("");
    setNewRoomCode("");
    setNewRoomName("");
    setNewRoomBuildingId("");
    setNewRoomFloor("");
    setNewRoomTypeId("");
    setDrafts([newAssetDraft()]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    // Validasi aset (di-share kedua mode)
    const cleanDrafts = drafts
      .map((d) => ({ ...d, name: d.name.trim(), code: d.code.trim() }))
      .filter((d) => d.name !== "");
    if (cleanDrafts.length === 0) {
      setError("Tambahkan minimal 1 aset (nama wajib diisi).");
      return;
    }

    setBusy(true);
    try {
      let targetRoomId = roomId;
      let createdRoomLabel: string | null = null;

      if (mode === "new") {
        if (!newRoomName.trim()) {
          throw new Error("Nama ruangan baru wajib diisi.");
        }
        const payload = {
          code: newRoomCode.trim() || null,
          name: newRoomName.trim(),
          building_id: newRoomBuildingId || null,
          floor: newRoomFloor.trim() || null,
          room_type_id: newRoomTypeId || null,
        };
        const { data, error: rErr } = await supabase
          .from("rooms")
          .insert(payload)
          .select("*")
          .single();
        if (rErr) throw rErr;
        const created = data as Room;
        targetRoomId = created.id;
        createdRoomLabel = created.code
          ? `${created.code} — ${created.name}`
          : created.name;
      } else {
        if (!targetRoomId) {
          throw new Error("Pilih ruangan terlebih dahulu.");
        }
      }

      // INSERT assets (batch) — kalau gagal, kita tidak rollback room (
      // user bisa retry tambah aset di mode existing pakai room yg sudah
      // terbuat). Sederhana & konsisten dengan UX.
      const rows = cleanDrafts.map((d) => ({
        room_id: targetRoomId,
        name: d.name,
        code: d.code || null,
        current_condition: d.condition,
        notes: d.notes.trim() || null,
      }));
      const { error: aErr } = await supabase.from("assets").insert(rows);
      if (aErr) throw aErr;

      const summary =
        mode === "new"
          ? `Ruangan baru "${createdRoomLabel}" dibuat dengan ${rows.length} aset.`
          : `${rows.length} aset ditambahkan ke ruangan terpilih.`;
      setInfo(summary);
      resetForm();
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  };

  // --- List view: filter & paginate
  const roomById = useMemo(
    () => new Map(rooms.map((r) => [r.id, r])),
    [rooms],
  );
  const visibleRooms = useMemo(
    () =>
      filterBuilding
        ? rooms.filter((r) => r.building_id === filterBuilding)
        : rooms,
    [rooms, filterBuilding],
  );
  const filteredAssets = useMemo(() => {
    return allAssets.filter((a) => {
      const r = roomById.get(a.room_id);
      if (!r) return false;
      if (filterBuilding && r.building_id !== filterBuilding) return false;
      if (filterRoom && a.room_id !== filterRoom) return false;
      return true;
    });
  }, [allAssets, roomById, filterBuilding, filterRoom]);
  const ls = useListState(filteredAssets, (a, q) =>
    `${a.name} ${a.code ?? ""}`.toLowerCase().includes(q),
  );

  const removeAsset = async (id: string) => {
    if (!confirm("Hapus aset ini? Riwayat survey-nya akan terhapus.")) return;
    const { error: err } = await supabase.from("assets").delete().eq("id", id);
    if (err) {
      setError(err.message);
      return;
    }
    void load();
  };

  return (
    <section className="card">
      <h2 className="section-title">Tambah Aset</h2>
      <p className="section-desc">
        Anda dapat menambah aset ke <strong>ruangan yang sudah ada</strong>
        {", "}
        atau membuat <strong>ruangan baru sekaligus aset di dalamnya</strong>
        {" "}dalam satu alur form. Nama aset dapat dipilih dari daftar
        autocomplete atau diketik baru.
      </p>

      {/* Datalist global untuk Item #7 — dipakai semua input nama aset */}
      <datalist id="asset-name-suggestions">
        {distinctAssetNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <form className="report-form" onSubmit={submit}>
        <fieldset className="field">
          <span className="field__label">Mode</span>
          <div className="profile-actions" role="radiogroup">
            {(
              [
                ["existing", "Pilih Ruangan Existing"],
                ["new", "Buat Ruangan Baru + Aset"],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className={
                  mode === k
                    ? "btn btn--primary btn--sm"
                    : "btn btn--ghost btn--sm"
                }
                style={{ cursor: "pointer" }}
              >
                <input
                  type="radio"
                  name="assets-mode"
                  value={k}
                  checked={mode === k}
                  onChange={() => setMode(k)}
                  style={{ display: "none" }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "existing" ? (
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
              {rooms.map((r) => {
                const b = r.building_id
                  ? buildings.find((x) => x.id === r.building_id)
                  : null;
                const label = r.code ? `${r.code} — ${r.name}` : r.name;
                return (
                  <option key={r.id} value={r.id}>
                    {label}
                    {b ? ` (${b.name})` : ""}
                  </option>
                );
              })}
            </select>
            {rooms.length === 0 && (
              <span className="muted small">
                Belum ada ruangan. Pilih mode "Buat Ruangan Baru".
              </span>
            )}
          </label>
        ) : (
          <div
            className="profile-section"
            style={{
              border: "1px solid var(--c-border, #ddd)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
            }}
          >
            <h3 className="profile-section__title" style={{ marginTop: 0 }}>
              Data Ruangan Baru
            </h3>
            <label className="field">
              <span className="field__label">Kode (opsional, unik)</span>
              <input
                type="text"
                className="field__input"
                value={newRoomCode}
                onChange={(e) => setNewRoomCode(e.target.value)}
                placeholder="cth: A-201"
              />
            </label>
            <label className="field">
              <span className="field__label">Nama</span>
              <input
                type="text"
                className="field__input"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="cth: Kelas A-201"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Gedung</span>
              <select
                className="field__input"
                value={newRoomBuildingId}
                onChange={(e) => setNewRoomBuildingId(e.target.value)}
                style={{ minHeight: "2.5rem" }}
              >
                <option value="">— Pilih (opsional) —</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code ? `${b.code} — ${b.name}` : b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Lantai (opsional)</span>
              <input
                type="text"
                className="field__input"
                value={newRoomFloor}
                onChange={(e) => setNewRoomFloor(e.target.value)}
                placeholder="Lantai 2"
              />
            </label>
            <label className="field">
              <span className="field__label">Jenis Ruang (opsional)</span>
              <select
                className="field__input"
                value={newRoomTypeId}
                onChange={(e) => setNewRoomTypeId(e.target.value)}
                style={{ minHeight: "2.5rem" }}
              >
                <option value="">— Pilih —</option>
                {roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="profile-section">
          <h3 className="profile-section__title">Aset</h3>
          <p className="muted small" style={{ margin: "0 0 0.5rem 0" }}>
            Tambahkan satu atau lebih aset. Field Nama mendukung
            autocomplete dari aset yang sudah terdaftar.
          </p>
          <ul className="list-rows">
            {drafts.map((d, idx) => (
              <li
                key={d.key}
                className="list-row"
                style={{ alignItems: "stretch", flexWrap: "wrap" }}
              >
                <div
                  className="list-row__main"
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(10rem, 2fr) minmax(7rem, 1fr) minmax(8rem, 1fr)",
                    gap: "0.5rem",
                    width: "100%",
                  }}
                >
                  <label className="field" style={{ margin: 0 }}>
                    <span className="field__label">
                      Nama #{idx + 1}{" "}
                      <span className="muted small">(autocomplete)</span>
                    </span>
                    <input
                      type="text"
                      className="field__input"
                      list="asset-name-suggestions"
                      value={d.name}
                      onChange={(e) =>
                        updateDraft(d.key, { name: e.target.value })
                      }
                      placeholder="cth: Whiteboard"
                      style={{ minHeight: "2.5rem" }}
                    />
                  </label>
                  <label className="field" style={{ margin: 0 }}>
                    <span className="field__label">Kode (opsional)</span>
                    <input
                      type="text"
                      className="field__input"
                      value={d.code}
                      onChange={(e) =>
                        updateDraft(d.key, { code: e.target.value })
                      }
                      placeholder="INV-001"
                      style={{ minHeight: "2.5rem" }}
                    />
                  </label>
                  <label className="field" style={{ margin: 0 }}>
                    <span className="field__label">Kondisi</span>
                    <select
                      className="field__input"
                      value={d.condition}
                      onChange={(e) =>
                        updateDraft(d.key, {
                          condition: e.target
                            .value as import("../../lib/surveyTypes").AssetCondition,
                        })
                      }
                      style={{ minHeight: "2.5rem" }}
                    >
                      {CONDITION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="list-row__actions">
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => removeDraft(d.key)}
                    disabled={drafts.length === 1}
                    title={
                      drafts.length === 1
                        ? "Minimal 1 aset"
                        : "Hapus baris ini"
                    }
                  >
                    Hapus baris
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={addDraft}
            style={{ marginTop: "0.5rem" }}
          >
            + Tambah Aset Lain
          </button>
        </div>

        <div className="profile-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy
              ? "Menyimpan..."
              : mode === "new"
                ? "Simpan Ruangan + Aset"
                : "Simpan Aset"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={resetForm}
            disabled={busy}
          >
            Reset
          </button>
        </div>

        {error && <p className="notice notice--warn">{error}</p>}
        {info && <p className="notice notice--info">{info}</p>}
      </form>

      <h2 className="section-title" style={{ marginTop: "1.25rem" }}>
        Daftar Aset
      </h2>
      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari nama / kode aset..."
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
          {buildings.map((b) => (
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
                    {r?.code ?? r?.name ?? "-"} · Kondisi:{" "}
                    {CONDITION_OPTIONS.find(
                      (o) => o.value === a.current_condition,
                    )?.label ?? a.current_condition}
                  </p>
                </div>
                <div className="list-row__actions">
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => void removeAsset(a.id)}
                  >
                    Hapus
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

/* ============================================================================
 * Tab — Import / Export
 * ============================================================================ */

const BUILDING_HEADERS = ["code", "name", "address", "notes"];
const ROOM_HEADERS = [
  "code",
  "name",
  "building_code",
  "floor",
  "room_type",
  "notes",
];
const ASSET_HEADERS = [
  "name",
  "code",
  "room_code",
  "current_condition",
  "notes",
];

function ImportExportTab() {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---------- EXPORT ----------
  const exportBuildings = async () => {
    const { data, error: err } = await supabase
      .from("buildings")
      .select("*")
      .order("name");
    if (err) {
      setError(err.message);
      return;
    }
    const rows = ((data ?? []) as Building[]).map((b) => ({
      code: b.code ?? "",
      name: b.name,
      address: b.address ?? "",
      notes: b.notes ?? "",
    }));
    downloadCsv("buildings.csv", encodeCsv(BUILDING_HEADERS, rows));
  };

  const exportRooms = async () => {
    const [bRes, rtRes, rRes] = await Promise.all([
      supabase.from("buildings").select("*"),
      supabase.from("room_types").select("*"),
      supabase.from("rooms").select("*").order("name"),
    ]);
    if (rRes.error) {
      setError(rRes.error.message);
      return;
    }
    const bMap = new Map(
      ((bRes.data ?? []) as Building[]).map((b) => [b.id, b]),
    );
    const rtMap = new Map(
      ((rtRes.data ?? []) as RoomType[]).map((t) => [t.id, t]),
    );
    const rows = ((rRes.data ?? []) as Room[]).map((r) => ({
      code: r.code ?? "",
      name: r.name,
      building_code: r.building_id
        ? bMap.get(r.building_id)?.code ?? bMap.get(r.building_id)?.name ?? ""
        : r.building ?? "",
      floor: r.floor ?? "",
      room_type: r.room_type_id ? rtMap.get(r.room_type_id)?.name ?? "" : "",
      notes: r.notes ?? "",
    }));
    downloadCsv("rooms.csv", encodeCsv(ROOM_HEADERS, rows));
  };

  const exportAssets = async () => {
    const [rRes, aRes] = await Promise.all([
      supabase.from("rooms").select("*"),
      supabase.from("assets").select("*").order("name"),
    ]);
    if (aRes.error) {
      setError(aRes.error.message);
      return;
    }
    const rMap = new Map(
      ((rRes.data ?? []) as Room[]).map((r) => [r.id, r]),
    );
    const rows = ((aRes.data ?? []) as AssetRow[]).map((a) => {
      const r = rMap.get(a.room_id);
      return {
        name: a.name,
        code: a.code ?? "",
        room_code: r?.code ?? r?.name ?? "",
        current_condition: a.current_condition,
        notes: a.notes ?? "",
      };
    });
    downloadCsv("assets.csv", encodeCsv(ASSET_HEADERS, rows));
  };

  // ---------- IMPORT ----------
  const importBuildings = async (file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const text = await file.text();
      const { rows } = parseCsv(text);
      let inserted = 0;
      for (const row of rows) {
        if (!row.name) continue;
        const { error: err } = await supabase
          .from("buildings")
          .upsert(
            {
              code: row.code || null,
              name: row.name,
              address: row.address || null,
              notes: row.notes || null,
            },
            { onConflict: "code" },
          );
        if (err) throw err;
        inserted += 1;
      }
      setInfo(`Import gedung selesai: ${inserted} baris diproses.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importRooms = async (file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const text = await file.text();
      const { rows } = parseCsv(text);
      const [bRes, rtRes] = await Promise.all([
        supabase.from("buildings").select("*"),
        supabase.from("room_types").select("*"),
      ]);
      const bByCode = new Map(
        ((bRes.data ?? []) as Building[]).map((b) => [
          (b.code ?? b.name).toLowerCase(),
          b,
        ]),
      );
      const rtByName = new Map(
        ((rtRes.data ?? []) as RoomType[]).map((t) => [
          t.name.toLowerCase(),
          t,
        ]),
      );
      let inserted = 0;
      let skipped = 0;
      for (const row of rows) {
        if (!row.name) continue;
        const b = row.building_code
          ? bByCode.get(row.building_code.toLowerCase())
          : null;
        const t = row.room_type
          ? rtByName.get(row.room_type.toLowerCase())
          : null;
        if (row.building_code && !b) {
          skipped += 1;
          continue;
        }
        const payload = {
          code: row.code || null,
          name: row.name,
          building_id: b?.id ?? null,
          building: row.building_code || null,
          floor: row.floor || null,
          room_type_id: t?.id ?? null,
          notes: row.notes || null,
        };
        if (row.code) {
          const { error: err } = await supabase
            .from("rooms")
            .upsert(payload, { onConflict: "code" });
          if (err) throw err;
        } else {
          const { error: err } = await supabase.from("rooms").insert(payload);
          if (err) throw err;
        }
        inserted += 1;
      }
      setInfo(
        `Import ruangan selesai: ${inserted} masuk, ${skipped} dilewati (gedung tidak ditemukan).`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importAssets = async (file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const text = await file.text();
      const { rows } = parseCsv(text);
      const { data: roomsData } = await supabase.from("rooms").select("*");
      const rooms = (roomsData ?? []) as Room[];
      const rByCode = new Map<string, Room>();
      for (const r of rooms) {
        if (r.code) rByCode.set(r.code.toLowerCase(), r);
        rByCode.set(r.name.toLowerCase(), r);
      }
      let inserted = 0;
      let skipped = 0;
      const validConditions = [
        "baik",
        "rusak_ringan",
        "rusak_berat",
        "tidak_ditemukan",
        "perlu_diganti",
      ];
      for (const row of rows) {
        if (!row.name || !row.room_code) {
          skipped += 1;
          continue;
        }
        const room = rByCode.get(row.room_code.toLowerCase());
        if (!room) {
          skipped += 1;
          continue;
        }
        const cond = validConditions.includes(row.current_condition)
          ? row.current_condition
          : "baik";
        const { error: err } = await supabase.from("assets").insert({
          room_id: room.id,
          name: row.name,
          code: row.code || null,
          current_condition: cond,
          notes: row.notes || null,
        });
        if (err) throw err;
        inserted += 1;
      }
      setInfo(
        `Import aset selesai: ${inserted} masuk, ${skipped} dilewati (ruang tidak cocok).`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="section-title">Import / Export Data</h2>
      <p className="section-desc">
        Format CSV sederhana (UTF-8). Header: kolom nama. Jalur tipikal
        adalah <strong>Gedung → Ruangan → Aset</strong>. Kolom referensi
        memakai <em>code</em> (atau nama bila tidak ada) — jadi pastikan
        gedung diimpor sebelum ruangan, dan ruangan sebelum aset.
      </p>

      <ExportRow
        label="Gedung"
        headers={BUILDING_HEADERS}
        onExport={exportBuildings}
        onImport={importBuildings}
        busy={busy}
      />
      <ExportRow
        label="Ruangan"
        headers={ROOM_HEADERS}
        onExport={exportRooms}
        onImport={importRooms}
        busy={busy}
      />
      <ExportRow
        label="Aset"
        headers={ASSET_HEADERS}
        onExport={exportAssets}
        onImport={importAssets}
        busy={busy}
      />

      {info && <p className="notice notice--info">{info}</p>}
      {error && <p className="notice notice--warn">{error}</p>}
    </section>
  );
}

function ExportRow(props: {
  label: string;
  headers: string[];
  onExport: () => Promise<void> | void;
  onImport: (file: File) => Promise<void> | void;
  busy: boolean;
}) {
  return (
    <div
      className="list-row"
      style={{ marginBottom: "0.5rem" }}
      aria-label={`Import/Export ${props.label}`}
    >
      <div className="list-row__main">
        <p className="list-row__title">{props.label}</p>
        <p className="list-row__sub">
          Kolom: {props.headers.join(", ")}
        </p>
      </div>
      <div className="list-row__actions">
        <label className="btn btn--ghost btn--sm" style={{ cursor: "pointer" }}>
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={props.busy}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void props.onImport(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={props.busy}
          onClick={() => void props.onExport()}
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}

export default SurveyManagement;
