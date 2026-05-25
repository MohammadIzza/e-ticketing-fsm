import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Position } from "../lib/types";

function SuperadminPositions() {
  const { session, loading, isSuperadmin } = useAuth();
  const navigate = useNavigate();

  const [list, setList] = useState<Position[]>([]);
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
      .from("positions")
      .select("*")
      .order("name", { ascending: true });
    setBusy(false);
    if (err) {
      setError(err.message);
      setList([]);
      return;
    }
    setList((data ?? []) as Position[]);
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
      setError("Nama jabatan wajib diisi.");
      return;
    }
    setCreating(true);
    const { error: err } = await supabase.from("positions").insert({
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

  const handleToggle = async (row: Position) => {
    setPendingId(row.id);
    const { error: err } = await supabase
      .from("positions")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    setPendingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await refresh();
  };

  const handleDelete = async (row: Position) => {
    const ok = window.confirm(
      `Hapus jabatan "${row.name}"?\n\n` +
        `Pengguna yang memiliki jabatan ini akan kehilangan jabatannya, ` +
        `dan jenis laporan yang terhubung dengan jabatan ini akan kehilangan ` +
        `mapping tersebut.`,
    );
    if (!ok) return;
    setPendingId(row.id);
    const { error: err } = await supabase
      .from("positions")
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
          <h1 className="page-title">Manajemen Jabatan</h1>
        </div>

        <section className="card">
          <h2 className="profile-section__title">Tambah Jabatan</h2>
          <p className="section-desc">
            Jabatan dipakai untuk menentukan pimpinan mana yang berhak menerima
            dan menugaskan jenis laporan tertentu.
          </p>
          <form className="report-form" onSubmit={handleCreate}>
            <label className="field">
              <span className="field__label">Nama Jabatan</span>
              <input
                type="text"
                className="field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="cth. Kepala Dinas Infrastruktur"
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
                placeholder="Wewenang singkat / catatan"
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
              Daftar Jabatan
            </h2>
            <span className="badge">{list.length}</span>
          </header>

          {busy && list.length === 0 ? (
            <p className="muted small">Memuat...</p>
          ) : list.length === 0 ? (
            <div className="empty">
              <p>Belum ada jabatan. Tambahkan satu di form di atas.</p>
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

export default SuperadminPositions;
