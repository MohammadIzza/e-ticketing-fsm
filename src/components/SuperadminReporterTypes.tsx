import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { ReporterType } from "../lib/types";

function SuperadminReporterTypes() {
  const { session, loading, isSuperadmin } = useAuth();
  const navigate = useNavigate();

  const [list, setList] = useState<ReporterType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("reporter_types")
      .select("*")
      .order("name", { ascending: true });
    setBusy(false);
    if (err) {
      setError(err.message);
      setList([]);
      return;
    }
    setList((data ?? []) as ReporterType[]);
  }, []);

  useEffect(() => {
    if (session && isSuperadmin) void refresh();
  }, [session, isSuperadmin, refresh]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/superadmin/login" replace />;
  if (!isSuperadmin) return <Navigate to="/profile" replace />;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Nama jenis pelapor wajib diisi.");
      return;
    }
    setCreating(true);
    const { error: err } = await supabase.from("reporter_types").insert({
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
    await refresh();
  };

  const handleToggle = async (row: ReporterType) => {
    setPendingId(row.id);
    const { error: err } = await supabase
      .from("reporter_types")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    setPendingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await refresh();
  };

  const handleDelete = async (row: ReporterType) => {
    const ok = window.confirm(
      `Hapus jenis pelapor "${row.name}"?\n\n` +
        `Pengguna yang memiliki jenis pelapor ini akan kehilangan jenisnya.`,
    );
    if (!ok) return;
    setPendingId(row.id);
    const { error: err } = await supabase
      .from("reporter_types")
      .delete()
      .eq("id", row.id);
    setPendingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await refresh();
  };

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
          <h1 className="page-title">Manajemen Jenis Pelapor</h1>
        </div>

        <section className="card">
          <h2 className="profile-section__title">Tambah Jenis Pelapor</h2>
          <p className="section-desc">
            Jenis pelapor dipakai untuk mengkategorikan pengguna pelapor
            (misal: Warga, Pegawai, Mitra). Tetapkan jenis pelapor di menu
            Manajemen Pengguna.
          </p>
          <form className="report-form" onSubmit={handleCreate}>
            <label className="field">
              <span className="field__label">Nama Jenis</span>
              <input
                type="text"
                className="field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="cth. Warga"
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
                placeholder="Catatan singkat"
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
              Daftar Jenis Pelapor
            </h2>
            <span className="badge">{list.length}</span>
          </header>

          {busy && list.length === 0 ? (
            <p className="muted small">Memuat...</p>
          ) : list.length === 0 ? (
            <div className="empty">
              <p>Belum ada jenis pelapor. Tambahkan satu di form di atas.</p>
            </div>
          ) : (
            <ul className="cat-list">
              {list.map((p) => {
                const pending = pendingId === p.id;
                return (
                  <li key={p.id} className="cat-row">
                    <div className="cat-row__main">
                      <div className="cat-row__name">
                        {p.name}{" "}
                        <span
                          className={`pill ${p.is_active ? "pill--ok" : "pill--warn"}`}
                        >
                          {p.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                      </div>
                      {p.description && (
                        <div className="cat-row__desc muted small">
                          {p.description}
                        </div>
                      )}
                    </div>
                    <div className="cat-row__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void handleToggle(p)}
                        disabled={pending}
                      >
                        {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => void handleDelete(p)}
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
    </div>
  );
}

export default SuperadminReporterTypes;
