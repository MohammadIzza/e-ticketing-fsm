import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import {
  evaluateFormula,
  extractVariables,
  FormulaError,
} from "../../lib/kinerjaFormula";
import type {
  KinerjaActivity,
  KinerjaAssignmentType,
  KinerjaFormField,
  KinerjaFormFieldType,
  KinerjaFormSchema,
  KinerjaIndicator,
  KinerjaOutput,
} from "../../lib/kinerjaTypes";
import { ListToolbar, Pager, useListState } from "../survey/listHelpers";

/**
 * `/superadmin/kinerja` — halaman config submodul Kinerja Pegawai.
 *
 * Superadmin di sini mendefinisikan: jenis penugasan, indikator, output,
 * kegiatan, formula SKS, dan skema form custom yang akan diisi user
 * (PR-F). Halaman ini tidak menyentuh data submission user — itu
 * domain PR-F.
 *
 * Layout: tabs konsisten dengan `SurveyManagement` agar superadmin
 * tidak perlu belajar pola baru. Style tile/card mengikuti acuan
 * UI MicroPost (compact, light shadow, pill button via .btn variants).
 */
function KinerjaConfig() {
  const { session, loading, isSuperadmin } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("types");

  // Banyak tab share state "selected assignment type" — angkat ke parent
  // supaya berpindah tab tetap menjaga konteks.
  const [types, setTypes] = useState<KinerjaAssignmentType[]>([]);
  const [typeId, setTypeId] = useState<string>("");

  const refreshTypes = useCallback(async () => {
    const { data, error } = await supabase
      .from("kinerja_assignment_types")
      .select("*")
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      setTypes([]);
      return;
    }
    setTypes((data ?? []) as KinerjaAssignmentType[]);
  }, []);

  useEffect(() => {
    if (session && isSuperadmin) void refreshTypes();
  }, [session, isSuperadmin, refreshTypes]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/superadmin/login" replace />;
  if (!isSuperadmin) return <Navigate to="/profile" replace />;

  const selectedType = types.find((t) => t.id === typeId) ?? null;

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/superadmin")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Konfigurasi Kinerja Pegawai</h1>
        </div>

        <nav
          className="view-switcher"
          role="tablist"
          aria-label="Pilih tab konfigurasi"
        >
          <div className="view-switcher__tabs">
            {(
              [
                ["types", "Jenis Penugasan"],
                ["indicators", "Indikator"],
                ["outputs", "Output"],
                ["activities", "Kegiatan"],
                ["formula", "Formula"],
                ["form", "Form Builder"],
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

        {tab === "types" ? (
          <TypesTab types={types} onChange={refreshTypes} />
        ) : (
          <>
            <TypeSelector
              value={typeId}
              types={types}
              onChange={setTypeId}
            />
            {!selectedType ? (
              <section className="card">
                <p className="muted small">
                  Pilih jenis penugasan dulu untuk mengelola{" "}
                  {tab === "indicators"
                    ? "indikator"
                    : tab === "outputs"
                      ? "output"
                      : tab === "activities"
                        ? "kegiatan"
                        : tab === "formula"
                          ? "formula"
                          : "form schema"}{" "}
                  yang terkait.
                </p>
              </section>
            ) : tab === "indicators" ? (
              <IndicatorsTab type={selectedType} />
            ) : tab === "outputs" ? (
              <OutputsTab type={selectedType} />
            ) : tab === "activities" ? (
              <ActivitiesTab type={selectedType} />
            ) : tab === "formula" ? (
              <FormulaTab type={selectedType} onTypeUpdated={refreshTypes} />
            ) : (
              <FormBuilderTab type={selectedType} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

type TabKey =
  | "types"
  | "indicators"
  | "outputs"
  | "activities"
  | "formula"
  | "form";

function TypeSelector({
  value,
  types,
  onChange,
}: {
  value: string;
  types: KinerjaAssignmentType[];
  onChange: (v: string) => void;
}) {
  return (
    <section className="card">
      <label className="field" style={{ margin: 0 }}>
        <span className="field__label">Pilih Jenis Penugasan</span>
        <select
          className="field__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ minHeight: "2.5rem" }}
        >
          <option value="">— Pilih —</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {!t.is_active ? " (Nonaktif)" : ""}
            </option>
          ))}
        </select>
        {types.length === 0 && (
          <span className="muted small">
            Belum ada jenis penugasan. Tambahkan di tab "Jenis Penugasan".
          </span>
        )}
      </label>
    </section>
  );
}

/* ============================================================================
 * Tab — Jenis Penugasan (Assignment Types)
 * ============================================================================ */

function TypesTab({
  types,
  onChange,
}: {
  types: KinerjaAssignmentType[];
  onChange: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ls = useListState(types, (t, q) =>
    `${t.name} ${t.description ?? ""}`.toLowerCase().includes(q),
  );

  const reset = () => {
    setName("");
    setDescription("");
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    setBusy(true);
    if (editingId) {
      const { error: err } = await supabase
        .from("kinerja_assignment_types")
        .update({
          name: name.trim(),
          description: description.trim() || null,
        })
        .eq("id", editingId);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase
        .from("kinerja_assignment_types")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          is_active: true,
        });
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
    }
    reset();
    await onChange();
  };

  const startEdit = (t: KinerjaAssignmentType) => {
    setEditingId(t.id);
    setName(t.name);
    setDescription(t.description ?? "");
  };

  const remove = async (t: KinerjaAssignmentType) => {
    if (
      !confirm(
        `Hapus jenis penugasan "${t.name}"?\n\n` +
          `PERHATIAN: Indikator, output, form schema, assignment, dan submission ` +
          `yang terkait dengan jenis ini akan ikut terhapus permanen.`,
      )
    )
      return;
    const { error: err } = await supabase
      .from("kinerja_assignment_types")
      .delete()
      .eq("id", t.id);
    if (err) setError(err.message);
    else await onChange();
  };

  const toggle = async (t: KinerjaAssignmentType) => {
    const { error: err } = await supabase
      .from("kinerja_assignment_types")
      .update({ is_active: !t.is_active })
      .eq("id", t.id);
    if (err) setError(err.message);
    else await onChange();
  };

  return (
    <section className="card">
      <h2 className="section-title">
        {editingId ? "Edit Jenis Penugasan" : "Tambah Jenis Penugasan"}
      </h2>
      <form className="report-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Nama</span>
          <input
            type="text"
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Penelitian, Pengabdian, Mengajar"
            style={{ minHeight: "2.5rem" }}
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
            placeholder="Penjelasan singkat"
            style={{ minHeight: "2.5rem" }}
          />
        </label>
        <div className="profile-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
          >
            {busy
              ? "Menyimpan..."
              : editingId
                ? "Simpan Perubahan"
                : "Tambah"}
          </button>
          {editingId && (
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Batal
            </button>
          )}
        </div>
        {error && <p className="notice notice--warn">{error}</p>}
      </form>

      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari nama / deskripsi..."
      />

      {ls.total === 0 ? (
        <p className="muted small">Belum ada jenis penugasan.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((t) => (
            <li key={t.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {t.name}{" "}
                  <span
                    className={`pill ${t.is_active ? "pill--ok" : "pill--warn"}`}
                  >
                    {t.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                  {t.formula && (
                    <span className="pill pill--info">Punya Formula</span>
                  )}
                </p>
                {t.description && (
                  <p className="list-row__sub">{t.description}</p>
                )}
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => startEdit(t)}
                >
                  Ubah
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void toggle(t)}
                >
                  {t.is_active ? "Nonaktifkan" : "Aktifkan"}
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void remove(t)}
                >
                  Hapus
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

/* ============================================================================
 * Tab — Indikator (variabel formula)
 * ============================================================================ */

function IndicatorsTab({ type }: { type: KinerjaAssignmentType }) {
  const [list, setList] = useState<KinerjaIndicator[]>([]);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [defaultValue, setDefaultValue] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("kinerja_indicators")
      .select("*")
      .eq("assignment_type_id", type.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message);
      return;
    }
    setList((data ?? []) as KinerjaIndicator[]);
  }, [type.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reset = () => {
    setCode("");
    setLabel("");
    setUnit("");
    setDefaultValue("0");
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanCode = code.trim();
    if (!cleanCode) {
      setError("Kode wajib diisi.");
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanCode)) {
      setError(
        "Kode hanya boleh huruf, angka, underscore; tidak boleh diawali angka.",
      );
      return;
    }
    if (!label.trim()) return;
    const dv = Number(defaultValue);
    if (!Number.isFinite(dv)) {
      setError("Nilai default harus angka.");
      return;
    }
    const payload = {
      assignment_type_id: type.id,
      code: cleanCode,
      label: label.trim(),
      unit: unit.trim() || null,
      default_value: dv,
    };
    if (editingId) {
      const { error: err } = await supabase
        .from("kinerja_indicators")
        .update(payload)
        .eq("id", editingId);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase
        .from("kinerja_indicators")
        .insert(payload);
      if (err) {
        setError(err.message);
        return;
      }
    }
    reset();
    void reload();
  };

  const startEdit = (i: KinerjaIndicator) => {
    setEditingId(i.id);
    setCode(i.code);
    setLabel(i.label);
    setUnit(i.unit ?? "");
    setDefaultValue(String(i.default_value));
  };

  const remove = async (id: string) => {
    if (!confirm("Hapus indikator ini?")) return;
    const { error: err } = await supabase
      .from("kinerja_indicators")
      .delete()
      .eq("id", id);
    if (err) setError(err.message);
    else void reload();
  };

  return (
    <section className="card">
      <h2 className="section-title">Indikator — {type.name}</h2>
      <p className="section-desc">
        Indikator adalah variabel pengukur (cth. <code>n_paper</code>,{" "}
        <code>jam_mengajar</code>) yang dapat dipakai di formula SKS dan
        diisi user saat membuat submission.
      </p>
      <form className="report-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Kode (untuk formula)</span>
          <input
            type="text"
            className="field__input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="cth: n_paper"
            style={{ minHeight: "2.5rem" }}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Label</span>
          <input
            type="text"
            className="field__input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="cth: Jumlah Paper Terbit"
            style={{ minHeight: "2.5rem" }}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Satuan (opsional)</span>
          <input
            type="text"
            className="field__input"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="buah, halaman, jam"
            style={{ minHeight: "2.5rem" }}
          />
        </label>
        <label className="field">
          <span className="field__label">Nilai Default</span>
          <input
            type="number"
            className="field__input"
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            step="any"
            style={{ minHeight: "2.5rem" }}
            required
          />
        </label>
        <div className="profile-actions">
          <button type="submit" className="btn btn--primary">
            {editingId ? "Simpan Perubahan" : "Tambah Indikator"}
          </button>
          {editingId && (
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Batal
            </button>
          )}
        </div>
        {error && <p className="notice notice--warn">{error}</p>}
      </form>

      {list.length === 0 ? (
        <p className="muted small">Belum ada indikator untuk jenis ini.</p>
      ) : (
        <ul className="list-rows">
          {list.map((i) => (
            <li key={i.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  <code>{i.code}</code> · {i.label}
                </p>
                <p className="list-row__sub">
                  Default {i.default_value}
                  {i.unit ? ` ${i.unit}` : ""}
                </p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => startEdit(i)}
                >
                  Ubah
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void remove(i.id)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ============================================================================
 * Tab — Output
 * ============================================================================ */

function OutputsTab({ type }: { type: KinerjaAssignmentType }) {
  const [list, setList] = useState<KinerjaOutput[]>([]);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("kinerja_outputs")
      .select("*")
      .eq("assignment_type_id", type.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message);
      return;
    }
    setList((data ?? []) as KinerjaOutput[]);
  }, [type.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const { error: err } = await supabase.from("kinerja_outputs").insert({
      assignment_type_id: type.id,
      label: label.trim(),
      description: description.trim() || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setLabel("");
    setDescription("");
    void reload();
  };
  const remove = async (id: string) => {
    if (!confirm("Hapus output ini?")) return;
    const { error: err } = await supabase
      .from("kinerja_outputs")
      .delete()
      .eq("id", id);
    if (err) setError(err.message);
    else void reload();
  };

  return (
    <section className="card">
      <h2 className="section-title">Output — {type.name}</h2>
      <p className="section-desc">
        Daftar output / deliverable yang harus dihasilkan user di jenis
        penugasan ini (cth. "1 paper terbit Q2", "≥ 32 jam mengajar").
      </p>
      <form className="report-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Label</span>
          <input
            type="text"
            className="field__input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="cth: Paper Terbit"
            style={{ minHeight: "2.5rem" }}
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
            placeholder="Detail / kriteria"
            style={{ minHeight: "2.5rem" }}
          />
        </label>
        <button type="submit" className="btn btn--primary">
          Tambah Output
        </button>
        {error && <p className="notice notice--warn">{error}</p>}
      </form>
      {list.length === 0 ? (
        <p className="muted small">Belum ada output untuk jenis ini.</p>
      ) : (
        <ul className="list-rows">
          {list.map((o) => (
            <li key={o.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">{o.label}</p>
                {o.description && (
                  <p className="list-row__sub">{o.description}</p>
                )}
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void remove(o.id)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ============================================================================
 * Tab — Kegiatan (Activities)
 * ============================================================================ */

function ActivitiesTab({ type }: { type: KinerjaAssignmentType }) {
  const [list, setList] = useState<KinerjaActivity[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("kinerja_activities")
      .select("*")
      .eq("assignment_type_id", type.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message);
      return;
    }
    setList((data ?? []) as KinerjaActivity[]);
  }, [type.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { error: err } = await supabase.from("kinerja_activities").insert({
      assignment_type_id: type.id,
      name: name.trim(),
      description: description.trim() || null,
      is_active: true,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setName("");
    setDescription("");
    void reload();
  };
  const remove = async (id: string) => {
    if (!confirm("Hapus kegiatan ini?")) return;
    const { error: err } = await supabase
      .from("kinerja_activities")
      .delete()
      .eq("id", id);
    if (err) setError(err.message);
    else void reload();
  };

  return (
    <section className="card">
      <h2 className="section-title">Kegiatan — {type.name}</h2>
      <p className="section-desc">
        Katalog kegiatan yang dapat diklaim user. Tampil sebagai pilihan
        cepat saat user membuat submission baru di PR-F.
      </p>
      <form className="report-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Nama Kegiatan</span>
          <input
            type="text"
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Pelatihan / Seminar / Workshop"
            style={{ minHeight: "2.5rem" }}
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
            style={{ minHeight: "2.5rem" }}
          />
        </label>
        <button type="submit" className="btn btn--primary">
          Tambah Kegiatan
        </button>
        {error && <p className="notice notice--warn">{error}</p>}
      </form>
      {list.length === 0 ? (
        <p className="muted small">Belum ada kegiatan untuk jenis ini.</p>
      ) : (
        <ul className="list-rows">
          {list.map((a) => (
            <li key={a.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">{a.name}</p>
                {a.description && (
                  <p className="list-row__sub">{a.description}</p>
                )}
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void remove(a.id)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ============================================================================
 * Tab — Formula (editor + tester live)
 * ============================================================================ */

function FormulaTab({
  type,
  onTypeUpdated,
}: {
  type: KinerjaAssignmentType;
  onTypeUpdated: () => Promise<void>;
}) {
  const [formula, setFormula] = useState(type.formula ?? "");
  const [indicators, setIndicators] = useState<KinerjaIndicator[]>([]);
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setFormula(type.formula ?? "");
  }, [type.id, type.formula]);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("kinerja_indicators")
      .select("*")
      .eq("assignment_type_id", type.id)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (mounted) {
          const inds = (data ?? []) as KinerjaIndicator[];
          setIndicators(inds);
          // Init test values dengan default value indicator.
          const init: Record<string, string> = {};
          for (const i of inds) init[i.code] = String(i.default_value);
          setTestValues(init);
        }
      });
    return () => {
      mounted = false;
    };
  }, [type.id]);

  const indicatorByCode = useMemo(
    () => new Map(indicators.map((i) => [i.code, i])),
    [indicators],
  );

  const usedVars = useMemo(() => {
    if (!formula.trim()) return [];
    try {
      return extractVariables(formula);
    } catch {
      return [];
    }
  }, [formula]);

  const undefinedVars = usedVars.filter((v: string) => !indicatorByCode.has(v));

  const liveResult = useMemo(() => {
    if (!formula.trim()) return { ok: true, value: 0, error: null };
    const vars: Record<string, number> = {};
    for (const code of usedVars) {
      const raw = testValues[code];
      const n = raw === undefined || raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(n))
        return { ok: false, value: 0, error: `Nilai ${code} bukan angka` };
      vars[code] = n;
    }
    try {
      return { ok: true, value: evaluateFormula(formula, vars), error: null };
    } catch (e) {
      const msg =
        e instanceof FormulaError ? e.message : "Error tidak diketahui";
      return { ok: false, value: 0, error: msg };
    }
  }, [formula, usedVars, testValues]);

  const save = async () => {
    setBusy(true);
    setInfo(null);
    const { error: err } = await supabase
      .from("kinerja_assignment_types")
      .update({ formula: formula.trim() || null })
      .eq("id", type.id);
    setBusy(false);
    if (err) {
      setInfo("Gagal menyimpan: " + err.message);
      return;
    }
    setInfo("Formula tersimpan.");
    await onTypeUpdated();
  };

  return (
    <section className="card">
      <h2 className="section-title">Formula SKS — {type.name}</h2>
      <p className="section-desc">
        Tulis ekspresi matematika untuk hitung estimasi SKS. Operator yang
        didukung: <code>+ - * /</code>, kurung, <code>min/max/round/floor/ceil/abs</code>,
        dan variabel = kode indikator yang sudah didefinisikan di tab
        Indikator.
      </p>

      <label className="field">
        <span className="field__label">Formula</span>
        <textarea
          className="field__input"
          rows={3}
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          placeholder="cth: round(min(n_paper, 4) * 2 + jam_mengajar / 16, 2)"
          style={{ fontFamily: "ui-monospace, monospace" }}
        />
      </label>

      {undefinedVars.length > 0 && (
        <p className="notice notice--warn">
          Variabel berikut belum didefinisikan sebagai indikator:{" "}
          <code>{undefinedVars.join(", ")}</code>
        </p>
      )}

      <h3 className="profile-section__title">Tester Live</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Isi nilai indikator di bawah untuk lihat hasil formula real-time.
        Default = nilai default indikator.
      </p>

      {usedVars.length === 0 ? (
        <p className="muted small">
          {formula.trim()
            ? "Formula tidak menggunakan variabel."
            : "Tulis formula dulu di atas."}
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
            gap: "0.5rem",
            marginTop: "0.5rem",
          }}
        >
          {usedVars.map((code: string) => {
            const ind = indicatorByCode.get(code);
            return (
              <label key={code} className="field" style={{ margin: 0 }}>
                <span className="field__label">
                  <code>{code}</code>
                  {ind ? ` (${ind.label})` : ""}
                </span>
                <input
                  type="number"
                  className="field__input"
                  value={testValues[code] ?? ""}
                  onChange={(e) =>
                    setTestValues((prev) => ({
                      ...prev,
                      [code]: e.target.value,
                    }))
                  }
                  step="any"
                  style={{ minHeight: "2.5rem" }}
                />
              </label>
            );
          })}
        </div>
      )}

      <p
        className={`notice ${liveResult.ok ? "notice--info" : "notice--warn"}`}
        style={{ marginTop: "0.5rem" }}
      >
        {liveResult.ok ? (
          <>
            <strong>Hasil:</strong> {liveResult.value} SKS
          </>
        ) : (
          <>Error: {liveResult.error}</>
        )}
      </p>

      <div className="profile-actions" style={{ marginTop: "0.5rem" }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? "Menyimpan..." : "Simpan Formula"}
        </button>
      </div>
      {info && <p className="notice notice--info">{info}</p>}
    </section>
  );
}

/* ============================================================================
 * Tab — Form Builder
 * ============================================================================ */

const FIELD_TYPE_OPTIONS: { value: KinerjaFormFieldType; label: string }[] = [
  { value: "text", label: "Teks Singkat" },
  { value: "textarea", label: "Teks Panjang" },
  { value: "number", label: "Angka" },
  { value: "date", label: "Tanggal" },
  { value: "select", label: "Pilihan Tunggal" },
  { value: "multiselect", label: "Pilihan Ganda" },
  { value: "file", label: "Upload File" },
  { value: "checkbox", label: "Centang (Y/N)" },
];

function FormBuilderTab({ type }: { type: KinerjaAssignmentType }) {
  const [schema, setSchema] = useState<KinerjaFormSchema | null>(null);
  const [fields, setFields] = useState<KinerjaFormField[]>([]);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("kinerja_form_schemas")
      .select("*")
      .eq("assignment_type_id", type.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!mounted) return;
        const s = (data ?? null) as KinerjaFormSchema | null;
        setSchema(s);
        setFields(Array.isArray(s?.fields) ? (s!.fields as KinerjaFormField[]) : []);
      });
    return () => {
      mounted = false;
    };
  }, [type.id]);

  const addField = () =>
    setFields((prev) => [
      ...prev,
      {
        name: `field_${prev.length + 1}`,
        label: "Field Baru",
        type: "text",
        required: false,
      },
    ]);

  const updateField = (idx: number, patch: Partial<KinerjaFormField>) =>
    setFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    );

  const removeField = (idx: number) =>
    setFields((prev) => prev.filter((_, i) => i !== idx));

  const move = (idx: number, dir: -1 | 1) =>
    setFields((prev) => {
      const arr = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });

  const validate = (): string | null => {
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.name.trim()) return "Setiap field harus punya 'name'.";
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.name)) {
        return `Name '${f.name}' tidak valid (huruf/angka/underscore, tidak diawali angka).`;
      }
      if (seen.has(f.name)) return `Name '${f.name}' duplikat.`;
      seen.add(f.name);
      if (!f.label.trim()) return `Label kosong di field '${f.name}'.`;
      if (
        (f.type === "select" || f.type === "multiselect") &&
        (!f.options || f.options.length === 0)
      ) {
        return `Field '${f.name}' butuh minimal 1 opsi.`;
      }
    }
    return null;
  };

  const save = async () => {
    setError(null);
    setInfo(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    if (schema) {
      const { error: err } = await supabase
        .from("kinerja_form_schemas")
        .update({ fields: fields as unknown as object })
        .eq("id", schema.id);
      if (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
    } else {
      const { data, error: err } = await supabase
        .from("kinerja_form_schemas")
        .insert({
          assignment_type_id: type.id,
          fields: fields as unknown as object,
        })
        .select("*")
        .single();
      if (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      setSchema(data as KinerjaFormSchema);
    }
    setBusy(false);
    setInfo("Form schema tersimpan.");
  };

  return (
    <section className="card">
      <h2 className="section-title">Form Builder — {type.name}</h2>
      <p className="section-desc">
        Definisikan field-field yang akan muncul di form submission user
        (PR-F). Field <code>name</code> akan jadi key di{" "}
        <code>form_data</code>; gunakan kode unik tanpa spasi.
      </p>

      {fields.length === 0 ? (
        <p className="muted small">Belum ada field. Klik tombol di bawah.</p>
      ) : (
        <ul className="list-rows">
          {fields.map((f, idx) => (
            <li key={idx} className="list-row" style={{ flexWrap: "wrap" }}>
              <div
                className="list-row__main"
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(7rem, 1fr) minmax(8rem, 1fr) minmax(8rem, 1fr) auto",
                  gap: "0.5rem",
                  width: "100%",
                }}
              >
                <label className="field" style={{ margin: 0 }}>
                  <span className="field__label">Name (key)</span>
                  <input
                    type="text"
                    className="field__input"
                    value={f.name}
                    onChange={(e) =>
                      updateField(idx, { name: e.target.value })
                    }
                    style={{ minHeight: "2.5rem" }}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span className="field__label">Label</span>
                  <input
                    type="text"
                    className="field__input"
                    value={f.label}
                    onChange={(e) =>
                      updateField(idx, { label: e.target.value })
                    }
                    style={{ minHeight: "2.5rem" }}
                  />
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span className="field__label">Tipe</span>
                  <select
                    className="field__input"
                    value={f.type}
                    onChange={(e) =>
                      updateField(idx, {
                        type: e.target.value as KinerjaFormFieldType,
                      })
                    }
                    style={{ minHeight: "2.5rem" }}
                  >
                    {FIELD_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="field"
                  style={{
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!f.required}
                    onChange={(e) =>
                      updateField(idx, { required: e.target.checked })
                    }
                  />
                  <span className="field__label" style={{ margin: 0 }}>
                    Wajib
                  </span>
                </label>

                {(f.type === "select" || f.type === "multiselect") && (
                  <label
                    className="field"
                    style={{ margin: 0, gridColumn: "1 / -1" }}
                  >
                    <span className="field__label">
                      Opsi (pisahkan koma)
                    </span>
                    <input
                      type="text"
                      className="field__input"
                      value={(f.options ?? []).join(", ")}
                      onChange={(e) =>
                        updateField(idx, {
                          options: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Opsi A, Opsi B, Opsi C"
                      style={{ minHeight: "2.5rem" }}
                    />
                  </label>
                )}

                <label
                  className="field"
                  style={{ margin: 0, gridColumn: "1 / -1" }}
                >
                  <span className="field__label">Help text (opsional)</span>
                  <input
                    type="text"
                    className="field__input"
                    value={f.help ?? ""}
                    onChange={(e) =>
                      updateField(idx, { help: e.target.value || undefined })
                    }
                    style={{ minHeight: "2.5rem" }}
                  />
                </label>
              </div>

              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  aria-label="Pindah ke atas"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => move(idx, 1)}
                  disabled={idx === fields.length - 1}
                  aria-label="Pindah ke bawah"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => removeField(idx)}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="profile-actions" style={{ marginTop: "0.5rem" }}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={addField}
        >
          + Tambah Field
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? "Menyimpan..." : "Simpan Form Schema"}
        </button>
      </div>
      {error && <p className="notice notice--warn">{error}</p>}
      {info && <p className="notice notice--info">{info}</p>}
    </section>
  );
}

export default KinerjaConfig;
