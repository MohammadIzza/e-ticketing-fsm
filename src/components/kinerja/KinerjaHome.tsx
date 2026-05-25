import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import type {
  KinerjaAssignment,
  KinerjaAssignmentType,
  KinerjaSubmission,
  KinerjaSubmissionStatus,
} from "../../lib/kinerjaTypes";
import { KINERJA_SUBMISSION_STATUS_LABEL } from "../../lib/kinerjaTypes";
import { ListToolbar, Pager, useListState } from "../survey/listHelpers";

/**
 * `/kinerja` — landing page submodul Kinerja Pegawai.
 *
 * Role-aware:
 *   - reviewer (pimpinan / superadmin): tab "Review" + "Penugasan" +
 *     "Konfigurasi" (shortcut ke /superadmin/kinerja, hanya jika super).
 *   - user biasa: tab "Penugasan Saya" + "Submission Saya" +
 *     "Portofolio".
 *
 * Membutuhkan migrasi 0020 (PR-D). Kalau tabel belum ada, halaman
 * tetap dapat di-render dengan list kosong + warning kecil di console.
 */
function KinerjaHome() {
  const { session, loading, user, isSuperadmin, profile, roles } = useAuth();
  const navigate = useNavigate();

  const isPimpinan = roles?.includes("pimpinan") ?? false;
  const isReviewer = isSuperadmin || isPimpinan;

  const [tab, setTab] = useState<TabKey>(
    isReviewer ? "review" : "myAssignments",
  );

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session || !user) return <Navigate to="/login" replace />;

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              navigate(isSuperadmin ? "/superadmin" : "/dashboard")
            }
          >
            ← Kembali
          </button>
          <h1 className="page-title">Kinerja Pegawai</h1>
        </div>

        <nav
          className="view-switcher"
          role="tablist"
          aria-label="Pilih tab"
        >
          <div className="view-switcher__tabs">
            {(isReviewer
              ? ([
                  ["review", "Review"],
                  ["assignments", "Penugasan"],
                  ["myAssignments", "Penugasan Saya"],
                  ["mySubs", "Submission Saya"],
                  ["portfolio", "Portofolio Saya"],
                ] as const)
              : ([
                  ["myAssignments", "Penugasan Saya"],
                  ["mySubs", "Submission Saya"],
                  ["portfolio", "Portofolio Saya"],
                ] as const)
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

        {isReviewer && tab === "review" && <ReviewQueue />}
        {isReviewer && tab === "assignments" && <AssignmentsManager />}
        {tab === "myAssignments" && <MyAssignments userId={user.id} />}
        {tab === "mySubs" && (
          <MySubmissions userId={user.id} fullName={profile?.full_name} />
        )}
        {tab === "portfolio" && <Portfolio userId={user.id} />}
      </main>
    </div>
  );
}

type TabKey =
  | "review"
  | "assignments"
  | "myAssignments"
  | "mySubs"
  | "portfolio";

/* ============================================================================
 * Tab — Penugasan Saya (alur A: assignee)
 * ============================================================================ */

function MyAssignments({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [list, setList] = useState<KinerjaAssignment[]>([]);
  const [types, setTypes] = useState<Map<string, KinerjaAssignmentType>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      supabase
        .from("kinerja_assignments")
        .select("*")
        .eq("assignee_id", userId)
        .order("created_at", { ascending: false }),
      supabase.from("kinerja_assignment_types").select("*"),
    ]).then(([aRes, tRes]) => {
      if (!mounted) return;
      setLoading(false);
      if (aRes.error || tRes.error) {
        console.warn(
          "Kinerja: gagal load (mungkin migrasi 0020 belum apply):",
          (aRes.error || tRes.error)?.message,
        );
        setList([]);
        setTypes(new Map());
        return;
      }
      setList((aRes.data ?? []) as KinerjaAssignment[]);
      setTypes(
        new Map(
          ((tRes.data ?? []) as KinerjaAssignmentType[]).map((t) => [t.id, t]),
        ),
      );
    });
    return () => {
      mounted = false;
    };
  }, [userId]);

  const ls = useListState(list, (a, q) =>
    a.title.toLowerCase().includes(q),
  );

  return (
    <section className="card">
      <h2 className="section-title">Penugasan Yang Diberikan ke Saya</h2>
      <p className="section-desc">
        Daftar penugasan dari pimpinan. Klik untuk membuat / melanjutkan
        submission terkait.
      </p>
      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari judul penugasan..."
      />

      {loading ? (
        <p className="muted small">Memuat...</p>
      ) : ls.total === 0 ? (
        <p className="muted small">
          Belum ada penugasan. Anda dapat membuat laporan langsung di tab
          "Submission Saya".
        </p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((a) => {
            const t = types.get(a.assignment_type_id);
            return (
              <li key={a.id} className="list-row">
                <div className="list-row__main">
                  <p className="list-row__title">
                    {a.title}{" "}
                    <span
                      className={`pill ${a.status === "active" ? "pill--ok" : "pill--warn"}`}
                    >
                      {a.status}
                    </span>
                  </p>
                  <p className="list-row__sub">
                    {t?.name ?? "(jenis dihapus)"}
                    {a.due_date ? ` · due ${a.due_date}` : ""}
                  </p>
                </div>
                <div className="list-row__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() =>
                      navigate(`/kinerja/submission/new?assignment=${a.id}`)
                    }
                    disabled={a.status !== "active"}
                  >
                    Buat Submission
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
 * Tab — Submission Saya
 * ============================================================================ */

function MySubmissions({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string | null | undefined;
}) {
  const navigate = useNavigate();
  const [list, setList] = useState<KinerjaSubmission[]>([]);
  const [types, setTypes] = useState<Map<string, KinerjaAssignmentType>>(
    new Map(),
  );
  const [statusFilter, setStatusFilter] = useState<
    "all" | KinerjaSubmissionStatus
  >("all");
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    Promise.all([
      supabase
        .from("kinerja_submissions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase.from("kinerja_assignment_types").select("*"),
    ]).then(([sRes, tRes]) => {
      setLoading(false);
      if (sRes.error || tRes.error) {
        console.warn(
          "Kinerja: gagal load submissions:",
          (sRes.error || tRes.error)?.message,
        );
        setList([]);
        return;
      }
      setList((sRes.data ?? []) as KinerjaSubmission[]);
      setTypes(
        new Map(
          ((tRes.data ?? []) as KinerjaAssignmentType[]).map((t) => [t.id, t]),
        ),
      );
    });
  };
  useEffect(reload, [userId]);

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? list
        : list.filter((s) => s.status === statusFilter),
    [list, statusFilter],
  );
  const ls = useListState(filtered, (s, q) =>
    s.title.toLowerCase().includes(q),
  );

  return (
    <section className="card">
      <header className="report-list__header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Submission Saya {fullName ? `· ${fullName}` : ""}
        </h2>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => navigate("/kinerja/submission/new")}
        >
          + Buat Submission
        </button>
      </header>

      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari judul submission..."
      >
        <select
          className="list-toolbar__select"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(
              e.target.value as "all" | KinerjaSubmissionStatus,
            )
          }
          aria-label="Filter status"
        >
          <option value="all">Semua Status</option>
          {(
            [
              "draft",
              "submitted",
              "needs_revision",
              "approved",
              "verified",
              "rejected",
            ] as KinerjaSubmissionStatus[]
          ).map((s) => (
            <option key={s} value={s}>
              {KINERJA_SUBMISSION_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </ListToolbar>

      {loading ? (
        <p className="muted small">Memuat...</p>
      ) : ls.total === 0 ? (
        <p className="muted small">
          Belum ada submission. Klik "+ Buat Submission" untuk mulai.
        </p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((s) => (
            <li key={s.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {s.title}{" "}
                  <span
                    className={`pill ${pillVariant(s.status)}`}
                  >
                    {KINERJA_SUBMISSION_STATUS_LABEL[s.status]}
                  </span>
                </p>
                <p className="list-row__sub">
                  {types.get(s.assignment_type_id)?.name ?? "(jenis dihapus)"}
                  {s.computed_sks !== null
                    ? ` · ${s.computed_sks} SKS`
                    : ""}
                  {s.review_note
                    ? ` · catatan: ${truncate(s.review_note, 60)}`
                    : ""}
                </p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => navigate(`/kinerja/submission/${s.id}`)}
                >
                  {s.status === "draft" || s.status === "needs_revision"
                    ? "Lanjutkan"
                    : "Lihat"}
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
 * Tab — Portofolio (user agg)
 * ============================================================================ */

function Portfolio({ userId }: { userId: string }) {
  const [list, setList] = useState<KinerjaSubmission[]>([]);
  const [types, setTypes] = useState<KinerjaAssignmentType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase
        .from("kinerja_submissions")
        .select("*")
        .eq("user_id", userId),
      supabase.from("kinerja_assignment_types").select("*"),
    ]).then(([sRes, tRes]) => {
      setLoading(false);
      if (sRes.error || tRes.error) {
        setList([]);
        setTypes([]);
        return;
      }
      setList((sRes.data ?? []) as KinerjaSubmission[]);
      setTypes((tRes.data ?? []) as KinerjaAssignmentType[]);
    });
  }, [userId]);

  const stats = useMemo(() => {
    const by = (status: KinerjaSubmissionStatus) =>
      list.filter((s) => s.status === status).length;
    const totalSks = list
      .filter((s) => s.status === "verified" || s.status === "approved")
      .reduce((sum, s) => sum + (s.computed_sks ?? 0), 0);
    return {
      total: list.length,
      draft: by("draft"),
      submitted: by("submitted"),
      revising: by("needs_revision"),
      approved: by("approved"),
      verified: by("verified"),
      rejected: by("rejected"),
      totalSks,
    };
  }, [list]);

  const byType = useMemo(() => {
    const m = new Map<string, { count: number; sks: number }>();
    for (const s of list) {
      const cur = m.get(s.assignment_type_id) ?? { count: 0, sks: 0 };
      cur.count += 1;
      if (s.status === "verified" || s.status === "approved") {
        cur.sks += s.computed_sks ?? 0;
      }
      m.set(s.assignment_type_id, cur);
    }
    return types
      .map((t) => ({ type: t, ...(m.get(t.id) ?? { count: 0, sks: 0 }) }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.sks - a.sks);
  }, [list, types]);

  return (
    <>
      <section className="card">
        <h2 className="section-title">Ringkasan Kinerja</h2>
        <div className="summary-grid" aria-label="Ringkasan">
          <div className="summary-tile">
            <span className="summary-tile__value">{stats.total}</span>
            <span className="summary-tile__label">Total Submission</span>
          </div>
          <div className="summary-tile">
            <span className="summary-tile__value">
              {stats.totalSks.toFixed(2)}
            </span>
            <span className="summary-tile__label">SKS Disetujui</span>
          </div>
          <div className="summary-tile">
            <span className="summary-tile__value">{stats.verified}</span>
            <span className="summary-tile__label">Terverifikasi</span>
          </div>
          <div className="summary-tile">
            <span className="summary-tile__value">
              {stats.submitted + stats.revising}
            </span>
            <span className="summary-tile__label">Pending</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Per Jenis Penugasan</h2>
        {loading ? (
          <p className="muted small">Memuat...</p>
        ) : byType.length === 0 ? (
          <p className="muted small">Belum ada submission.</p>
        ) : (
          <ul className="list-rows">
            {byType.map((row) => (
              <li key={row.type.id} className="list-row">
                <div className="list-row__main">
                  <p className="list-row__title">{row.type.name}</p>
                  <p className="list-row__sub">
                    {row.count} submission · {row.sks.toFixed(2)} SKS
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/* ============================================================================
 * Tab — Review Queue (reviewer)
 * ============================================================================ */

function ReviewQueue() {
  const navigate = useNavigate();
  const [list, setList] = useState<KinerjaSubmission[]>([]);
  const [types, setTypes] = useState<Map<string, KinerjaAssignmentType>>(
    new Map(),
  );
  const [statusFilter, setStatusFilter] = useState<
    "pending" | "all" | KinerjaSubmissionStatus
  >("pending");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase
        .from("kinerja_submissions")
        .select("*")
        .order("submitted_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase.from("kinerja_assignment_types").select("*"),
    ]).then(([sRes, tRes]) => {
      setLoading(false);
      if (sRes.error || tRes.error) {
        setList([]);
        return;
      }
      setList((sRes.data ?? []) as KinerjaSubmission[]);
      setTypes(
        new Map(
          ((tRes.data ?? []) as KinerjaAssignmentType[]).map((t) => [t.id, t]),
        ),
      );
    });
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return list;
    if (statusFilter === "pending") {
      return list.filter(
        (s) => s.status === "submitted" || s.status === "approved",
      );
    }
    return list.filter((s) => s.status === statusFilter);
  }, [list, statusFilter]);

  const ls = useListState(filtered, (s, q) =>
    s.title.toLowerCase().includes(q),
  );

  return (
    <section className="card">
      <h2 className="section-title">Antrian Review</h2>
      <p className="section-desc">
        Submission dari user yang menunggu approval / verifikasi.
      </p>
      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari judul submission..."
      >
        <select
          className="list-toolbar__select"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(
              e.target.value as
                | "pending"
                | "all"
                | KinerjaSubmissionStatus,
            )
          }
          aria-label="Filter status"
        >
          <option value="pending">Perlu Aksi (submitted+approved)</option>
          <option value="all">Semua</option>
          <option value="submitted">Menunggu Review</option>
          <option value="approved">Disetujui (perlu verifikasi)</option>
          <option value="needs_revision">Perlu Revisi</option>
          <option value="verified">Terverifikasi</option>
          <option value="rejected">Ditolak</option>
        </select>
      </ListToolbar>

      {loading ? (
        <p className="muted small">Memuat...</p>
      ) : ls.total === 0 ? (
        <p className="muted small">Tidak ada submission yang cocok.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((s) => (
            <li key={s.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {s.title}{" "}
                  <span className={`pill ${pillVariant(s.status)}`}>
                    {KINERJA_SUBMISSION_STATUS_LABEL[s.status]}
                  </span>
                </p>
                <p className="list-row__sub">
                  {types.get(s.assignment_type_id)?.name ?? "(jenis dihapus)"}
                  {s.computed_sks !== null
                    ? ` · ${s.computed_sks} SKS`
                    : ""}
                </p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => navigate(`/kinerja/submission/${s.id}`)}
                >
                  Review
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
 * Tab — Assignments Manager (reviewer create / monitor)
 * ============================================================================ */

function AssignmentsManager() {
  const navigate = useNavigate();
  const [list, setList] = useState<KinerjaAssignment[]>([]);
  const [types, setTypes] = useState<Map<string, KinerjaAssignmentType>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase
        .from("kinerja_assignments")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("kinerja_assignment_types").select("*"),
    ]).then(([aRes, tRes]) => {
      setLoading(false);
      if (aRes.error || tRes.error) {
        setList([]);
        return;
      }
      setList((aRes.data ?? []) as KinerjaAssignment[]);
      setTypes(
        new Map(
          ((tRes.data ?? []) as KinerjaAssignmentType[]).map((t) => [t.id, t]),
        ),
      );
    });
  }, []);

  const ls = useListState(list, (a, q) =>
    a.title.toLowerCase().includes(q),
  );

  return (
    <section className="card">
      <header className="report-list__header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Daftar Penugasan
        </h2>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => navigate("/kinerja/assignment/new")}
        >
          + Buat Penugasan
        </button>
      </header>
      <ListToolbar
        searchValue={ls.search}
        onSearch={ls.setSearch}
        placeholder="Cari judul..."
      />
      {loading ? (
        <p className="muted small">Memuat...</p>
      ) : ls.total === 0 ? (
        <p className="muted small">Belum ada penugasan.</p>
      ) : (
        <ul className="list-rows">
          {ls.page.map((a) => (
            <li key={a.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {a.title}{" "}
                  <span
                    className={`pill ${a.status === "active" ? "pill--ok" : "pill--warn"}`}
                  >
                    {a.status}
                  </span>
                </p>
                <p className="list-row__sub">
                  {types.get(a.assignment_type_id)?.name ??
                    "(jenis dihapus)"}
                  {a.due_date ? ` · due ${a.due_date}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager state={ls} />
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------- */

function pillVariant(status: KinerjaSubmissionStatus): string {
  switch (status) {
    case "draft":
      return "pill--info";
    case "submitted":
      return "pill--accent";
    case "needs_revision":
      return "pill--warn";
    case "approved":
      return "pill--ok";
    case "verified":
      return "pill--ok";
    case "rejected":
      return "pill--warn";
  }
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export default KinerjaHome;
