import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type {
  Category,
  CategorySlaOption,
  Position,
  ReporterType,
} from "../lib/types";

interface CriteriaState {
  requiresVerification: boolean;
  selfExecutable: boolean;
  positionIds: string[];
  /**
   * Jenis pelapor yang boleh memilih kategori ini saat membuat laporan.
   * Kosong = no restriction (semua jenis pelapor boleh).
   */
  reporterTypeIds: string[];
  slaOptions: { hours: number; label: string }[];
}

const EMPTY_CRITERIA: CriteriaState = {
  requiresVerification: false,
  selfExecutable: false,
  positionIds: [],
  reporterTypeIds: [],
  slaOptions: [],
};

function SuperadminCategories() {
  const { session, loading, isSuperadmin } = useAuth();
  const navigate = useNavigate();

  const [list, setList] = useState<Category[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [reporterTypes, setReporterTypes] = useState<ReporterType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Editor kriteria modal
  const [editTarget, setEditTarget] = useState<Category | null>(null);
  const [criteria, setCriteria] = useState<CriteriaState>(EMPTY_CRITERIA);
  const [criteriaLoading, setCriteriaLoading] = useState(false);
  const [savingCriteria, setSavingCriteria] = useState(false);

  const refreshList = useCallback(async () => {
    setBusy(true);
    setError(null);
    const [catRes, posRes, rtRes] = await Promise.all([
      supabase.from("categories").select("*").order("created_at", { ascending: false }),
      supabase.from("positions").select("*").order("name", { ascending: true }),
      supabase.from("reporter_types").select("*").order("name", { ascending: true }),
    ]);
    setBusy(false);
    if (catRes.error) {
      setError(catRes.error.message);
      setList([]);
    } else {
      setList((catRes.data ?? []) as Category[]);
    }
    if (posRes.error) {
      // tidak fatal — tetap render kategori
      console.error(posRes.error);
      setPositions([]);
    } else {
      setPositions((posRes.data ?? []) as Position[]);
    }
    if (rtRes.error) {
      console.error(rtRes.error);
      setReporterTypes([]);
    } else {
      setReporterTypes((rtRes.data ?? []) as ReporterType[]);
    }
  }, []);

  useEffect(() => {
    if (session && isSuperadmin) void refreshList();
  }, [session, isSuperadmin, refreshList]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/superadmin/login" replace />;
  if (!isSuperadmin) return <Navigate to="/profile" replace />;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Nama jenis laporan wajib diisi.");
      return;
    }
    setCreating(true);
    const { error: err } = await supabase.from("categories").insert({
      name: cleanName,
      description: description.trim() || null,
      is_active: true,
    });
    setCreating(false);
    if (err) {
      setError(err.message);
      return;
    }
    setName("");
    setDescription("");
    await refreshList();
  };

  const handleToggle = async (cat: Category) => {
    setPendingId(cat.id);
    const { error: err } = await supabase
      .from("categories")
      .update({ is_active: !cat.is_active })
      .eq("id", cat.id);
    setPendingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await refreshList();
  };

  const handleDelete = async (cat: Category) => {
    const ok = window.confirm(
      `Hapus jenis laporan "${cat.name}"?\n\n` +
        `PERHATIAN: Semua laporan dengan jenis ini juga akan ikut dihapus permanen.\n\n` +
        `Lanjutkan?`,
    );
    if (!ok) return;
    setPendingId(cat.id);
    const { error: err } = await supabase
      .from("categories")
      .delete()
      .eq("id", cat.id);
    setPendingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await refreshList();
  };

  const openCriteria = async (cat: Category) => {
    setEditTarget(cat);
    setCriteria(EMPTY_CRITERIA);
    setCriteriaLoading(true);
    const [slaRes, posRes, rtRes] = await Promise.all([
      supabase
        .from("category_sla_options")
        .select("*")
        .eq("category_id", cat.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("category_positions")
        .select("position_id")
        .eq("category_id", cat.id),
      supabase
        .from("category_reporter_types")
        .select("reporter_type_id")
        .eq("category_id", cat.id),
    ]);
    setCriteriaLoading(false);

    // Capture error messages BEFORE any early return so TypeScript doesn't
    // narrow rtRes to 'never' due to the control-flow analysis.
    const slaErr = slaRes.error;
    const posErr = posRes.error;
    // rtRes may be from a table that doesn't exist yet (migration 0019).
    // Wrap in unknown so TS doesn't complain about 'never' after narrowing.
    const rtResUnknown = rtRes as unknown as {
      error: { message: string; code?: string } | null;
      data: { reporter_type_id: string }[] | null;
    };

    if (slaErr || posErr) {
      // SLA & positions sudah lama ada — kalau itu yang error, fail keras.
      setError((slaErr || posErr)?.message ?? "Gagal memuat kriteria");
      setEditTarget(null);
      return;
    }
    // category_reporter_types adalah tabel baru (migrasi 0019). Kalau
    // bootstrap belum jalan, jangan ganggu workflow lain — soft-fallback
    // ke list kosong dan tampilkan warning kecil di section terkait.
    if (rtResUnknown.error) {
      console.warn(
        "category_reporter_types belum tersedia — jalankan migrasi 0019:",
        rtResUnknown.error.message,
      );
    }
    const slaOptions = ((slaRes.data ?? []) as CategorySlaOption[]).map((o) => ({
      hours: o.hours,
      label: o.label,
    }));
    const positionIds = (posRes.data ?? []).map(
      (r: { position_id: string }) => r.position_id,
    );
    const reporterTypeIds = (rtResUnknown.data ?? []).map(
      (r: { reporter_type_id: string }) => r.reporter_type_id,
    );
    setCriteria({
      requiresVerification: cat.requires_pimpinan_verification,
      selfExecutable: cat.self_executable,
      positionIds,
      reporterTypeIds,
      slaOptions,
    });
  };

  const closeCriteria = () => {
    if (savingCriteria) return;
    setEditTarget(null);
    setCriteria(EMPTY_CRITERIA);
  };

  const saveCriteria = async () => {
    if (!editTarget) return;
    setSavingCriteria(true);
    setError(null);
    try {
      // 1) Update flag verifikasi + flag self-executable.
      const { error: e1 } = await supabase
        .from("categories")
        .update({
          requires_pimpinan_verification: criteria.requiresVerification,
          self_executable: criteria.selfExecutable,
        })
        .eq("id", editTarget.id);
      if (e1) throw e1;

      // 2) Sync category_positions.
      const { error: e2 } = await supabase.rpc("admin_set_category_positions", {
        p_category_id: editTarget.id,
        p_position_ids: criteria.positionIds,
      });
      if (e2) throw e2;

      // 2b) Sync category_reporter_types. Tabel baru — kalau migrasi 0019
      //     belum jalan, log warning saja (tidak abort save lain).
      const { error: e2b } = await supabase.rpc(
        "admin_set_category_reporter_types",
        {
          p_category_id: editTarget.id,
          p_reporter_type_ids: criteria.reporterTypeIds,
        },
      );
      if (e2b) {
        // PGRST202 = function not found (migrasi 0019 belum apply)
        if (
          e2b.code === "PGRST202" ||
          /admin_set_category_reporter_types/i.test(e2b.message)
        ) {
          console.warn(
            "RPC admin_set_category_reporter_types belum tersedia — " +
              "jalankan migrasi 0019. Section 'Jenis Pelapor' di-skip.",
          );
        } else {
          throw e2b;
        }
      }

      // 3) Sync SLA options.
      const cleanSlas = criteria.slaOptions
        .filter((o) => Number.isFinite(o.hours) && o.hours > 0)
        .map((o) => ({
          hours: Math.round(o.hours),
          label: o.label.trim() || `${o.hours} jam`,
        }));
      const { error: e3 } = await supabase.rpc(
        "admin_set_category_sla_options",
        {
          p_category_id: editTarget.id,
          p_options: cleanSlas,
        },
      );
      if (e3) throw e3;

      setEditTarget(null);
      await refreshList();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan kriteria";
      setError(msg);
    } finally {
      setSavingCriteria(false);
    }
  };

  const togglePosition = (id: string) => {
    setCriteria((prev) => {
      const has = prev.positionIds.includes(id);
      return {
        ...prev,
        positionIds: has
          ? prev.positionIds.filter((x) => x !== id)
          : [...prev.positionIds, id],
      };
    });
  };

  const toggleReporterType = (id: string) => {
    setCriteria((prev) => {
      const has = prev.reporterTypeIds.includes(id);
      return {
        ...prev,
        reporterTypeIds: has
          ? prev.reporterTypeIds.filter((x) => x !== id)
          : [...prev.reporterTypeIds, id],
      };
    });
  };

  const addSlaOption = () => {
    setCriteria((prev) => ({
      ...prev,
      slaOptions: [...prev.slaOptions, { hours: 24, label: "1 hari" }],
    }));
  };

  const updateSlaOption = (
    idx: number,
    patch: Partial<{ hours: number; label: string }>,
  ) => {
    setCriteria((prev) => ({
      ...prev,
      slaOptions: prev.slaOptions.map((o, i) =>
        i === idx ? { ...o, ...patch } : o,
      ),
    }));
  };

  const removeSlaOption = (idx: number) => {
    setCriteria((prev) => ({
      ...prev,
      slaOptions: prev.slaOptions.filter((_, i) => i !== idx),
    }));
  };

  const positionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of positions) m.set(p.id, p.name);
    return m;
  }, [positions]);

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
          <h1 className="page-title">Jenis Laporan</h1>
        </div>

        <section className="card">
          <h2 className="profile-section__title">Tambah Jenis Laporan</h2>
          <form className="report-form" onSubmit={handleCreate}>
            <label className="field">
              <span className="field__label">Nama</span>
              <input
                type="text"
                className="field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="cth. Infrastruktur"
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
                placeholder="Deskripsi singkat"
                style={{ minHeight: "2.5rem" }}
              />
            </label>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={creating}
            >
              {creating ? "Menyimpan..." : "Tambah"}
            </button>
            {error && <p className="notice notice--warn">{error}</p>}
          </form>
        </section>

        <section className="card">
          <header className="report-list__header">
            <h2 className="section-title" style={{ margin: 0 }}>
              Daftar Jenis
            </h2>
            <span className="badge">{list.length}</span>
          </header>
          <p className="section-desc">
            Klik <strong>Kriteria</strong> untuk mengatur SLA, verifikasi
            pimpinan, dan jabatan pimpinan yang berhak menerima/menugaskan.
          </p>

          {busy && list.length === 0 ? (
            <p className="muted small">Memuat...</p>
          ) : list.length === 0 ? (
            <div className="empty">
              <p>Belum ada jenis laporan. Tambahkan satu di form di atas.</p>
            </div>
          ) : (
            <ul className="cat-list">
              {list.map((c) => {
                const pending = pendingId === c.id;
                return (
                  <li key={c.id} className="cat-row">
                    <div className="cat-row__main">
                      <div className="cat-row__name">
                        {c.name}{" "}
                        <span
                          className={`pill ${c.is_active ? "pill--ok" : "pill--warn"}`}
                        >
                          {c.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                        {c.requires_pimpinan_verification && (
                          <span className="pill pill--accent">
                            Perlu Verifikasi
                          </span>
                        )}
                        {c.self_executable && (
                          <span className="pill pill--info">
                            Bisa Dikerjakan Sendiri
                          </span>
                        )}
                      </div>
                      {c.description && (
                        <div className="cat-row__desc muted small">
                          {c.description}
                        </div>
                      )}
                    </div>
                    <div className="cat-row__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void openCriteria(c)}
                        disabled={pending}
                      >
                        Kriteria
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void handleToggle(c)}
                        disabled={pending}
                      >
                        {c.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => void handleDelete(c)}
                        disabled={pending}
                      >
                        Hapus
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {editTarget && (
        <div className="modal-backdrop" onClick={closeCriteria}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">Kriteria — {editTarget.name}</h2>
            {criteriaLoading ? (
              <p className="muted small">Memuat...</p>
            ) : (
              <>
                <div className="profile-section">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={criteria.requiresVerification}
                      onChange={(e) =>
                        setCriteria((prev) => ({
                          ...prev,
                          requiresVerification: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Perlu diverifikasi pimpinan setelah diselesaikan
                    </span>
                  </label>
                </div>

                <div className="profile-section">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={criteria.selfExecutable}
                      onChange={(e) =>
                        setCriteria((prev) => ({
                          ...prev,
                          selfExecutable: e.target.checked,
                        }))
                      }
                      style={{ marginTop: "0.25rem" }}
                    />
                    <span>
                      <strong>Bisa dikerjakan sendiri</strong>
                      <br />
                      <span className="muted small">
                        Setelah pimpinan menerima laporan jenis ini, sistem
                        otomatis menugaskan kepada pelapor itu sendiri —
                        pelapor langsung dapat menyelesaikan tanpa perlu
                        ditugaskan ke petugas terpisah.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="profile-section">
                  <h3 className="profile-section__title">
                    Jabatan Pimpinan yang Berhak
                  </h3>
                  <p className="muted small" style={{ margin: 0 }}>
                    Pimpinan dengan jabatan ini yang dapat menerima &
                    menugaskan laporan jenis ini. Kosongkan = semua pimpinan
                    bisa menangani.
                  </p>
                  {positions.length === 0 ? (
                    <p className="notice notice--warn">
                      Belum ada jabatan. Tambahkan di menu Manajemen Jabatan.
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.35rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      {positions.map((p) => (
                        <label
                          key={p.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={criteria.positionIds.includes(p.id)}
                            onChange={() => togglePosition(p.id)}
                          />
                          <span>{p.name}</span>
                          {!p.is_active && (
                            <span className="pill pill--warn">Nonaktif</span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="profile-section">
                  <h3 className="profile-section__title">
                    Jenis Pelapor yang Berhak
                  </h3>
                  <p className="muted small" style={{ margin: 0 }}>
                    Hanya pelapor dengan jenis-jenis ini yang dapat memilih
                    kategori ini saat membuat laporan. Kosongkan = semua
                    jenis pelapor boleh.
                  </p>
                  {reporterTypes.length === 0 ? (
                    <p className="notice notice--warn">
                      Belum ada jenis pelapor. Tambahkan di menu Manajemen
                      Jenis Pelapor.
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.35rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      {reporterTypes.map((rt) => (
                        <label
                          key={rt.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={criteria.reporterTypeIds.includes(rt.id)}
                            onChange={() => toggleReporterType(rt.id)}
                          />
                          <span>{rt.name}</span>
                          {!rt.is_active && (
                            <span className="pill pill--warn">Nonaktif</span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="profile-section">
                  <h3 className="profile-section__title">Opsi SLA</h3>
                  <p className="muted small" style={{ margin: 0 }}>
                    Daftar pilihan SLA (kapan harus diselesaikan) yang bisa
                    dipilih pelapor. Kosongkan = laporan tidak punya SLA.
                  </p>
                  {criteria.slaOptions.length === 0 ? (
                    <p className="muted small" style={{ marginTop: "0.5rem" }}>
                      Belum ada opsi.
                    </p>
                  ) : (
                    <ul className="cat-list" style={{ marginTop: "0.5rem" }}>
                      {criteria.slaOptions.map((o, idx) => (
                        <li key={idx} className="cat-row">
                          <div
                            className="cat-row__main"
                            style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
                          >
                            <label className="field" style={{ flex: "1 1 6rem" }}>
                              <span className="field__label">Jam</span>
                              <input
                                type="number"
                                min={1}
                                className="field__input"
                                value={o.hours}
                                onChange={(e) =>
                                  updateSlaOption(idx, {
                                    hours: Number(e.target.value) || 0,
                                  })
                                }
                                style={{ minHeight: "2.5rem" }}
                              />
                            </label>
                            <label className="field" style={{ flex: "2 1 10rem" }}>
                              <span className="field__label">Label</span>
                              <input
                                type="text"
                                className="field__input"
                                value={o.label}
                                onChange={(e) =>
                                  updateSlaOption(idx, { label: e.target.value })
                                }
                                placeholder="cth. 1 hari"
                                style={{ minHeight: "2.5rem" }}
                              />
                            </label>
                          </div>
                          <div className="cat-row__actions">
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => removeSlaOption(idx)}
                            >
                              Hapus
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ marginTop: "0.5rem" }}
                    onClick={addSlaOption}
                  >
                    + Tambah Opsi SLA
                  </button>
                </div>

                {criteria.positionIds.length > 0 && (
                  <p className="muted small">
                    Jabatan terpilih:{" "}
                    {criteria.positionIds
                      .map((id) => positionNameById.get(id) ?? id)
                      .join(", ")}
                  </p>
                )}
              </>
            )}
            <div className="profile-actions" style={{ marginTop: "0.85rem" }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeCriteria}
                disabled={savingCriteria}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void saveCriteria()}
                disabled={savingCriteria || criteriaLoading}
              >
                {savingCriteria ? "Menyimpan..." : "Simpan Kriteria"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperadminCategories;
