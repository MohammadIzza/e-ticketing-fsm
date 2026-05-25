import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import type {
  KinerjaAssignmentType,
} from "../../lib/kinerjaTypes";

interface CandidateProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  username: string | null;
}

/**
 * `/kinerja/assignment/new` — pimpinan/superadmin buat assignment ke
 * user. Form sederhana: pilih user, jenis, judul, due_date, periode.
 */
function KinerjaAssignmentEditor() {
  const { session, loading, isSuperadmin, roles, user } = useAuth();
  const navigate = useNavigate();
  const isReviewer =
    isSuperadmin || (roles?.includes("pimpinan") ?? false);

  const [types, setTypes] = useState<KinerjaAssignmentType[]>([]);
  const [profiles, setProfiles] = useState<CandidateProfile[]>([]);

  const [assigneeId, setAssigneeId] = useState("");
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [periodYear, setPeriodYear] = useState<string>(
    String(new Date().getFullYear()),
  );
  const [periodSemester, setPeriodSemester] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      supabase
        .from("kinerja_assignment_types")
        .select("*")
        .eq("is_active", true)
        .order("name"),
      // RPC admin_list_users: superadmin-only. Pimpinan boleh fallback ke
      // SELECT profiles langsung yang RLS-aman.
      isSuperadmin
        ? supabase.rpc("admin_list_users")
        : supabase.from("profiles").select("id, full_name, email, username"),
    ]).then(([tRes, pRes]) => {
      if (!mounted) return;
      setTypes((tRes.data ?? []) as KinerjaAssignmentType[]);
      // admin_list_users mengembalikan banyak kolom — kita hanya butuh sebagian.
      const raw = (pRes.data ?? []) as Array<Record<string, unknown>>;
      setProfiles(
        raw.map((r) => ({
          id: String(r.id),
          full_name: (r.full_name as string | null) ?? null,
          email: (r.email as string | null) ?? null,
          username: (r.username as string | null) ?? null,
        })),
      );
    });
    return () => {
      mounted = false;
    };
  }, [isSuperadmin]);

  const filteredProfiles = useMemo(() => {
    const q = assigneeQuery.trim().toLowerCase();
    if (!q) return profiles.slice(0, 20);
    return profiles
      .filter((p) =>
        `${p.full_name ?? ""} ${p.email ?? ""} ${p.username ?? ""}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [profiles, assigneeQuery]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session || !user) return <Navigate to="/login" replace />;
  if (!isReviewer) return <Navigate to="/kinerja" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!assigneeId) {
      setError("Pilih user yang akan ditugaskan.");
      return;
    }
    if (!typeId) {
      setError("Pilih jenis penugasan.");
      return;
    }
    if (!title.trim()) {
      setError("Judul wajib diisi.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.from("kinerja_assignments").insert({
      assignment_type_id: typeId,
      assignee_id: assigneeId,
      assigned_by: user.id,
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      status: "active",
      period_year: periodYear ? Number(periodYear) : null,
      period_semester: periodSemester ? Number(periodSemester) : null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate("/kinerja");
  };

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/kinerja")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">Buat Penugasan</h1>
        </div>

        <section className="card">
          <form className="report-form" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Cari User</span>
              <input
                type="text"
                className="field__input"
                value={assigneeQuery}
                onChange={(e) => setAssigneeQuery(e.target.value)}
                placeholder="Ketik nama / email / username..."
                style={{ minHeight: "2.5rem" }}
              />
            </label>
            <label className="field">
              <span className="field__label">Pilih User</span>
              <select
                className="field__input"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                style={{ minHeight: "2.5rem" }}
                size={Math.min(8, filteredProfiles.length + 1)}
              >
                <option value="">— Pilih dari hasil pencarian —</option>
                {filteredProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email || p.username || p.id}
                    {p.email ? ` · ${p.email}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Jenis Penugasan</span>
              <select
                className="field__input"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                style={{ minHeight: "2.5rem" }}
                required
              >
                <option value="">— Pilih —</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Judul</span>
              <input
                type="text"
                className="field__input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="cth: Penelitian Semester Ganjil 2025"
                style={{ minHeight: "2.5rem" }}
                required
              />
            </label>

            <label className="field">
              <span className="field__label">Deskripsi</span>
              <textarea
                className="field__input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(8rem, 1fr))",
                gap: "0.5rem",
              }}
            >
              <label className="field" style={{ margin: 0 }}>
                <span className="field__label">Due Date (opsional)</span>
                <input
                  type="date"
                  className="field__input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span className="field__label">Tahun Periode</span>
                <input
                  type="number"
                  className="field__input"
                  value={periodYear}
                  onChange={(e) => setPeriodYear(e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span className="field__label">Semester</span>
                <select
                  className="field__input"
                  value={periodSemester}
                  onChange={(e) => setPeriodSemester(e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                >
                  <option value="">—</option>
                  <option value="1">Semester 1</option>
                  <option value="2">Semester 2</option>
                </select>
              </label>
            </div>

            {error && <p className="notice notice--warn">{error}</p>}
            <div className="profile-actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy}
              >
                {busy ? "Menyimpan..." : "Buat Penugasan"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => navigate("/kinerja")}
              >
                Batal
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

export default KinerjaAssignmentEditor;
