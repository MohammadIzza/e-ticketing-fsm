import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { buildMapsUrl, formatAccuracy, formatCoords, hasCoords } from "../lib/geo";
import {
  DISPLAY_STATUS_ORDER,
  STATUS_LABEL,
  availableActions,
  canDeleteReport,
  effectiveStatus,
  statusBadgeClass,
} from "../lib/reportStatus";
import CameraCapture from "./CameraCapture";
import {
  MAX_ASSIGNEES_PER_REPORT,
  type DisplayStatus,
  type ReportStatus,
  type ReportStatusHistory,
  type Role,
} from "../lib/types";

interface ReporterInfo {
  id: string;
  username: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

/** Satu baris penugasan multi-assignee untuk display di list. */
interface AssigneeChip {
  assignment_id: string;
  assignee_id: string;
  note: string | null;
  profile: ReporterInfo | null;
}

interface ReportRow {
  id: string;
  user_id: string;
  category_id: string | null;
  photo_url: string;
  description: string;
  status: ReportStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  geo_captured_at: string | null;
  sla_option_id: string | null;
  sla_due_at: string | null;
  completion_note: string | null;
  completion_photo_url: string | null;
  pending_verification: boolean;
  verified_at: string | null;
  verified_by: string | null;
  reporter: ReporterInfo | null;
  assignee: ReporterInfo | null;
  verifier: ReporterInfo | null;
  category: { id: string; name: string; self_executable: boolean } | null;
  sla_option: { id: string; label: string; hours: number } | null;
  /** Daftar lengkap petugas multi-assignee (termasuk legacy assigned_to). */
  assignees: AssigneeChip[];
}

interface PetugasOption {
  id: string;
  full_name: string | null;
  email: string | null;
  username: string | null;
}

const PAGE_SIZE = 25;

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function reporterLabel(p: ReporterInfo | null): string {
  if (!p) return "Pengguna tidak diketahui";
  if (p.full_name && p.email) return `${p.full_name} (${p.email})`;
  return p.full_name || p.email || p.username || "Pengguna";
}

function petugasLabel(p: PetugasOption): string {
  if (p.full_name && p.email) return `${p.full_name} (${p.email})`;
  return p.full_name || p.email || p.username || p.id;
}

const SELECT_COLUMNS = `
  id, user_id, category_id, photo_url, description, status, assigned_to,
  created_at, updated_at,
  latitude, longitude, accuracy_m, geo_captured_at,
  sla_option_id, sla_due_at,
  completion_note, completion_photo_url,
  pending_verification, verified_at, verified_by,
  reporter:profiles!user_id(id, username, email, full_name, avatar_url),
  assignee:profiles!assigned_to(id, username, email, full_name, avatar_url),
  verifier:profiles!verified_by(id, username, email, full_name, avatar_url),
  category:categories!category_id(id, name, self_executable),
  sla_option:category_sla_options!sla_option_id(id, label, hours),
  assignees:report_assignees(
    assignment_id:id, assignee_id, note,
    profile:profiles!assignee_id(id, username, email, full_name, avatar_url)
  )
`;

function LaporanManagement() {
  const { session, loading, user, roles, isSuperadmin } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"" | DisplayStatus>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [assignTarget, setAssignTarget] = useState<ReportRow | null>(null);
  const [petugasList, setPetugasList] = useState<PetugasOption[]>([]);
  const [petugasLoading, setPetugasLoading] = useState(false);
  /**
   * State multi-assign: map dari petugas-id ke {selected, note}.
   * Diinisialisasi dengan assignment yang sudah ada di laporan target,
   * supaya membuka modal "Tugaskan" pada laporan yang sudah ditugaskan
   * akan menampilkan pilihan saat ini (bukan kosong) — pimpinan tinggal
   * tambah/hapus.
   */
  const [assignSelections, setAssignSelections] = useState<
    Record<string, { selected: boolean; note: string }>
  >({});
  const [assignError, setAssignError] = useState<string | null>(null);

  const [doneTarget, setDoneTarget] = useState<ReportRow | null>(null);
  const [doneNote, setDoneNote] = useState("");
  const [donePhoto, setDonePhoto] = useState<Blob | null>(null);
  const [donePhotoUrl, setDonePhotoUrl] = useState<string | null>(null);
  const [submittingDone, setSubmittingDone] = useState(false);
  const [doneError, setDoneError] = useState<string | null>(null);

  const [historyTarget, setHistoryTarget] = useState<ReportRow | null>(null);
  const [history, setHistory] = useState<
    (ReportStatusHistory & {
      changer: ReporterInfo | null;
    })[]
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Cleanup donePhoto blob preview.
  useEffect(() => {
    if (!donePhoto) {
      setDonePhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(donePhoto);
    setDonePhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [donePhoto]);

  /**
   * Load satu page dari server. RLS sudah membatasi akses (petugas hanya
   * laporan ditugaskan ke dirinya, pimpinan hanya kategori sesuai jabatan,
   * superadmin: semua) — frontend cukup query tanpa filter scope tambahan.
   *
   * Pengecualian: ketika user adalah petugas-only (tanpa pimpinan/
   * superadmin), halaman ini bertindak sebagai "Penugasan Laporan" murni.
   * RLS sebenarnya juga membolehkan petugas melihat laporan yang DIA AJUKAN
   * sendiri (sebagai pelapor), sehingga tanpa filter eksplisit laporan
   * pribadi ikut muncul di daftar penugasan. Untuk match ekspektasi UX
   * — "tidak muncul di sini KECUALI memang ditugaskan ke dirinya" —
   * tambahkan filter `assigned_to = me` saat mode petugas-only.
   */
  const loadPage = useCallback(
    async (pageIndex: number, append: boolean) => {
      setListLoading(true);
      setError(null);
      const from = pageIndex * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from("reports")
        .select(SELECT_COLUMNS, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      // Petugas-only view: hanya yang DI-assign kepada saya — termasuk
      // multi-assignment (entry di report_assignees). Filter via
      // `or(assigned_to.eq.me, id.in.(...))` — kita ambil dulu daftar
      // report_id dari report_assignees lalu compose filter `or()`.
      const isPetugasOnly =
        roles.includes("petugas") &&
        !roles.includes("pimpinan") &&
        !isSuperadmin;
      if (isPetugasOnly && user) {
        const { data: pivotIds } = await supabase
          .from("report_assignees")
          .select("report_id")
          .eq("assignee_id", user.id);
        const ids = (pivotIds ?? [])
          .map((r) => (r as { report_id: string }).report_id)
          .filter((v): v is string => Boolean(v));
        if (ids.length > 0) {
          // PostgREST or() filter: assigned_to=eq.me OR id=in.(uuid,...)
          const idList = ids.join(",");
          query = query.or(`assigned_to.eq.${user.id},id.in.(${idList})`);
        } else {
          query = query.eq("assigned_to", user.id);
        }
      }
      // Server-side status filter — kecuali "melebihi_sla" yang derived.
      if (statusFilter && statusFilter !== "melebihi_sla") {
        query = query.eq("status", statusFilter);
      } else if (statusFilter === "melebihi_sla") {
        query = query.lt("sla_due_at", new Date().toISOString()).neq(
          "status",
          "diselesaikan",
        );
      }
      const { data, error: err, count } = await query;
      setListLoading(false);
      if (err) {
        setError(err.message);
        if (!append) setReports([]);
        setHasMore(false);
        return;
      }
      const rows: ReportRow[] = ((data ?? []) as unknown[]).map((raw) => {
        const r = raw as ReportRow & {
          reporter: ReporterInfo | ReporterInfo[] | null;
          assignee: ReporterInfo | ReporterInfo[] | null;
          verifier: ReporterInfo | ReporterInfo[] | null;
          category: ReportRow["category"] | ReportRow["category"][] | null;
          sla_option:
            | ReportRow["sla_option"]
            | ReportRow["sla_option"][]
            | null;
          assignees:
            | Array<{
                assignment_id: string;
                assignee_id: string;
                note: string | null;
                profile: ReporterInfo | ReporterInfo[] | null;
              }>
            | null;
        };
        const norm = <T,>(x: T | T[] | null): T | null =>
          Array.isArray(x) ? (x[0] ?? null) : (x ?? null);
        const assignees: AssigneeChip[] = (r.assignees ?? []).map((a) => ({
          assignment_id: a.assignment_id,
          assignee_id: a.assignee_id,
          note: a.note,
          profile: norm<ReporterInfo>(a.profile),
        }));
        return {
          ...r,
          reporter: norm<ReporterInfo>(r.reporter),
          assignee: norm<ReporterInfo>(r.assignee),
          verifier: norm<ReporterInfo>(r.verifier),
          category: norm(r.category),
          sla_option: norm(r.sla_option),
          assignees,
        };
      });
      setReports((prev) => (append ? [...prev, ...rows] : rows));
      const total = count ?? rows.length;
      setHasMore(from + rows.length < total);
    },
    [statusFilter, roles, isSuperadmin, user?.id],
  );

  // Reset page ketika filter berubah.
  useEffect(() => {
    setPage(0);
  }, [statusFilter]);

  useEffect(() => {
    if (!session) return;
    void loadPage(0, false);
  }, [session, loadPage]);

  const refresh = useCallback(async () => {
    setPage(0);
    await loadPage(0, false);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    const next = page + 1;
    setPage(next);
    await loadPage(next, true);
  }, [page, loadPage]);

  const hasMgmt =
    isSuperadmin || roles.includes("pimpinan") || roles.includes("petugas");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => {
      const hay = [
        r.description,
        r.reporter?.full_name ?? "",
        r.reporter?.email ?? "",
        r.assignee?.full_name ?? "",
        ...r.assignees.flatMap((a) => [
          a.profile?.full_name ?? "",
          a.profile?.email ?? "",
        ]),
        r.category?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [reports, search]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!hasMgmt) return <Navigate to="/dashboard" replace />;

  const isPimpinan = roles.includes("pimpinan");
  const isPetugas = roles.includes("petugas");
  const pageTitle = isSuperadmin
    ? "Manajemen Laporan"
    : isPetugas && !isPimpinan
      ? "Penugasan Laporan"
      : "Manajemen Laporan";

  const backTo = isSuperadmin ? "/superadmin" : "/dashboard";

  const handleTerima = async (row: ReportRow) => {
    setPendingId(row.id);
    setError(null);
    const { error: err } = await supabase.rpc("report_mark_received", {
      p_report_id: row.id,
    });
    setPendingId(null);
    if (err) setError(err.message);
    else await refresh();
  };

  const handleVerify = async (row: ReportRow) => {
    if (!window.confirm("Verifikasi penyelesaian laporan ini?")) return;
    setPendingId(row.id);
    setError(null);
    const { error: err } = await supabase.rpc("report_verify", {
      p_report_id: row.id,
    });
    setPendingId(null);
    if (err) setError(err.message);
    else await refresh();
  };

  const openSelesai = (row: ReportRow) => {
    setDoneTarget(row);
    setDoneNote("");
    setDonePhoto(null);
    setDoneError(null);
  };

  const submitSelesai = async () => {
    if (!doneTarget || !user) return;
    setDoneError(null);
    const note = doneNote.trim();
    if (!note) {
      setDoneError("Catatan penyelesaian wajib diisi.");
      return;
    }
    if (!donePhoto) {
      setDoneError("Foto bukti wajib diambil.");
      return;
    }
    setSubmittingDone(true);
    try {
      const ts = Date.now();
      const ext = (donePhoto.type.split("/")[1] || "jpg").split("+")[0];
      const path = `reports/${user.id}/done-${doneTarget.id}-${ts}.${ext}`;
      const contentType =
        donePhoto.type && donePhoto.type !== ""
          ? donePhoto.type
          : "image/jpeg";
      const { error: upErr } = await supabase.storage
        .from("report-photos")
        .upload(path, donePhoto, {
          cacheControl: "3600",
          contentType,
          upsert: false,
        });
      if (upErr) {
        setDoneError(upErr.message);
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from("report-photos").getPublicUrl(path);

      const { error: rpcErr } = await supabase.rpc("report_mark_done", {
        p_report_id: doneTarget.id,
        p_note: note,
        p_photo_url: publicUrl,
      });
      if (rpcErr) {
        // Best-effort cleanup.
        await supabase.storage.from("report-photos").remove([path]);
        setDoneError(rpcErr.message);
        return;
      }
      setDoneTarget(null);
      await refresh();
    } finally {
      setSubmittingDone(false);
    }
  };

  const openAssign = async (row: ReportRow) => {
    setAssignTarget(row);
    setAssignError(null);
    // Pre-populate selections dari assignment yang sudah ada sehingga
    // re-assign tidak start kosong (pimpinan biasanya hanya tambah/hapus
    // 1-2 nama).
    const initial: Record<string, { selected: boolean; note: string }> = {};
    for (const a of row.assignees) {
      initial[a.assignee_id] = {
        selected: true,
        note: a.note ?? "",
      };
    }
    setAssignSelections(initial);
    setPetugasLoading(true);
    const { data, error: err } = await supabase.rpc("list_petugas");
    setPetugasLoading(false);
    if (err) {
      setError(err.message);
      setPetugasList([]);
      return;
    }
    setPetugasList((data ?? []) as PetugasOption[]);
  };

  const toggleAssignee = (id: string) => {
    setAssignSelections((prev) => {
      const cur = prev[id] ?? { selected: false, note: "" };
      return {
        ...prev,
        [id]: { ...cur, selected: !cur.selected },
      };
    });
  };

  const setAssigneeNote = (id: string, note: string) => {
    setAssignSelections((prev) => {
      const cur = prev[id] ?? { selected: true, note: "" };
      return {
        ...prev,
        [id]: { ...cur, note },
      };
    });
  };

  const selectedAssigneeCount = Object.values(assignSelections).filter(
    (v) => v.selected,
  ).length;

  const submitAssign = async () => {
    if (!assignTarget) return;
    setAssignError(null);
    const items = Object.entries(assignSelections)
      .filter(([, v]) => v.selected)
      .map(([id, v]) => ({ id, note: v.note.trim() || null }));
    if (items.length === 0) {
      setAssignError("Pilih minimal 1 petugas.");
      return;
    }
    if (items.length > MAX_ASSIGNEES_PER_REPORT) {
      setAssignError(
        `Maksimum ${MAX_ASSIGNEES_PER_REPORT} petugas per laporan.`,
      );
      return;
    }
    setPendingId(assignTarget.id);
    const { error: err } = await supabase.rpc("report_assign_multi", {
      p_report_id: assignTarget.id,
      p_assignees: items,
    });
    setPendingId(null);
    if (err) {
      setAssignError(err.message);
      return;
    }
    setAssignTarget(null);
    setAssignSelections({});
    await refresh();
  };

  const handleDelete = async (row: ReportRow) => {
    const ownerRoles = (roles ?? []) as Role[];
    if (!canDeleteReport(row.status, row.user_id === user?.id, ownerRoles)) {
      window.alert(
        "Laporan ini tidak dapat dihapus (status sudah lewat 'dikirim'). Hanya superadmin yang dapat menghapusnya.",
      );
      return;
    }
    const ok = window.confirm(
      `Hapus laporan dari ${reporterLabel(row.reporter)}?\n\nAksi ini tidak dapat dibatalkan.`,
    );
    if (!ok) return;
    setPendingId(row.id);
    const { error: err } = await supabase
      .from("reports")
      .delete()
      .eq("id", row.id);
    if (err) {
      setPendingId(null);
      setError(err.message);
      return;
    }
    if (row.photo_url) {
      const marker = "/report-photos/";
      const idx = row.photo_url.indexOf(marker);
      if (idx >= 0) {
        const path = row.photo_url.slice(idx + marker.length);
        await supabase.storage.from("report-photos").remove([path]);
      }
    }
    setPendingId(null);
    await refresh();
  };

  const openHistory = async (row: ReportRow) => {
    setHistoryTarget(row);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistory([]);
    const { data, error: err } = await supabase.rpc(
      "report_history_with_actors",
      { p_report_id: row.id },
    );
    setHistoryLoading(false);
    if (err) {
      setHistoryError(err.message);
      return;
    }
    type RpcRow = {
      history_id: string;
      history_status: ReportStatus;
      history_changed_at: string;
      history_note: string | null;
      history_changed_by: string | null;
      changer_full_name: string | null;
      changer_email: string | null;
      changer_username: string | null;
    };
    const rows = ((data ?? []) as RpcRow[]).map((r) => ({
      id: r.history_id,
      report_id: row.id,
      status: r.history_status,
      changed_by: r.history_changed_by,
      changed_at: r.history_changed_at,
      note: r.history_note,
      changer:
        r.history_changed_by !== null
          ? {
              id: r.history_changed_by,
              full_name: r.changer_full_name,
              email: r.changer_email,
              username: r.changer_username,
              avatar_url: null,
            }
          : null,
    }));
    setHistory(rows);
  };

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(backTo)}
          >
            ← Kembali
          </button>
          <h1 className="page-title">{pageTitle}</h1>
        </div>

        <section className="card">
          <p className="section-desc">
            {isPetugas && !isPimpinan && !isSuperadmin
              ? "Daftar laporan yang ditugaskan kepada Anda."
              : isPimpinan && !isSuperadmin
                ? "Daftar laporan yang sesuai dengan jabatan Anda."
                : "Daftar seluruh laporan."}{" "}
            Aksi tersedia tergantung role Anda dan status laporan.
          </p>

          <div className="mgmt-toolbar">
            <label className="field">
              <span className="field__label">Cari</span>
              <input
                type="text"
                className="field__input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari isi, pelapor, jenis..."
                style={{ minHeight: "2.5rem" }}
              />
            </label>
            <label className="field">
              <span className="field__label">Status</span>
              <select
                className="field__input"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "" | DisplayStatus)
                }
                style={{ minHeight: "2.5rem" }}
              >
                <option value="">Semua</option>
                {DISPLAY_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <p className="notice notice--warn">{error}</p>}

          {listLoading && reports.length === 0 ? (
            <p className="muted small">Memuat...</p>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <p>
                {reports.length === 0
                  ? "Belum ada laporan masuk."
                  : "Tidak ada laporan yang cocok dengan filter."}
              </p>
            </div>
          ) : (
            <ul className="report-list__items">
              {filtered.map((r) => {
                const eff = effectiveStatus({
                  status: r.status,
                  slaDueAt: r.sla_due_at,
                });
                const isAssignee =
                  r.assigned_to === user?.id ||
                  r.assignees.some((a) => a.assignee_id === user?.id);
                const actions = availableActions({
                  status: r.status,
                  roles: roles as Role[],
                  isAssignee,
                  pendingVerification: r.pending_verification,
                  selfExecutable: r.category?.self_executable ?? false,
                });
                const deletable = canDeleteReport(
                  r.status,
                  r.user_id === user?.id,
                  roles as Role[],
                );
                return (
                  <li key={r.id} className="report-item">
                    <div className="report-item__photo">
                      <img
                        src={r.photo_url}
                        alt="Foto laporan"
                        loading="lazy"
                      />
                    </div>
                    <div className="report-item__body">
                      <p className="report-item__desc">{r.description}</p>
                      <p className="muted small" style={{ margin: "0.2rem 0" }}>
                        <strong>Pelapor:</strong> {reporterLabel(r.reporter)}
                      </p>
                      <p className="muted small" style={{ margin: "0.2rem 0" }}>
                        <strong>Jenis:</strong>{" "}
                        {r.category?.name ?? "(tidak ada)"}
                      </p>
                      {r.assignees.length > 0 && (
                        <div
                          className="muted small"
                          style={{ margin: "0.2rem 0" }}
                        >
                          <strong>
                            Petugas ({r.assignees.length}):
                          </strong>{" "}
                          {r.assignees.map((a, idx) => {
                            const label = reporterLabel(a.profile);
                            const mine = a.assignee_id === user?.id;
                            return (
                              <span
                                key={a.assignment_id}
                                title={a.note ?? undefined}
                              >
                                {idx > 0 ? ", " : ""}
                                {label}
                                {mine && " (Anda)"}
                                {a.note ? " 📝" : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {r.sla_option && (
                        <p className="muted small" style={{ margin: "0.2rem 0" }}>
                          <strong>SLA:</strong> {r.sla_option.label} (
                          {r.sla_option.hours} jam)
                          {r.sla_due_at &&
                            ` · jatuh tempo ${fmt(r.sla_due_at)}`}
                        </p>
                      )}
                      {r.completion_note && (
                        <p className="muted small" style={{ margin: "0.2rem 0" }}>
                          <strong>Catatan Penyelesaian:</strong>{" "}
                          {r.completion_note}
                        </p>
                      )}
                      {r.verified_at && r.verifier && (
                        <p className="muted small" style={{ margin: "0.2rem 0" }}>
                          <strong>Diverifikasi:</strong>{" "}
                          {reporterLabel(r.verifier)} · {fmt(r.verified_at)}
                        </p>
                      )}
                      <div className="report-item__chips">
                        <span className={statusBadgeClass(eff)}>
                          {STATUS_LABEL[eff]}
                        </span>
                        {r.pending_verification && (
                          <span className="pill pill--warn">
                            Menunggu Verifikasi
                          </span>
                        )}
                        <span className="muted small">{fmt(r.created_at)}</span>
                      </div>
                      {hasCoords(r) ? (
                        <p className="muted small" style={{ margin: "0.2rem 0" }}>
                          📍 {formatCoords(r, 5)}{" "}
                          {formatAccuracy(r.accuracy_m)}
                          {" — "}
                          <a
                            href={buildMapsUrl(r) ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="link-btn"
                          >
                            Buka di Maps
                          </a>
                        </p>
                      ) : (
                        <p className="muted small" style={{ margin: "0.2rem 0" }}>
                          📍 <em>Lokasi tidak tersedia</em>
                        </p>
                      )}
                      {r.completion_photo_url && (
                        <p className="muted small" style={{ margin: "0.2rem 0" }}>
                          <a
                            href={r.completion_photo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="link-btn"
                          >
                            Lihat Foto Bukti Penyelesaian
                          </a>
                        </p>
                      )}
                      <div className="report-item__action-row">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => navigate(`/laporan/${r.id}`)}
                        >
                          Detail
                        </button>
                        {actions.map((a) => {
                          const pending = pendingId === r.id;
                          if (a.key === "terima")
                            return (
                              <button
                                key={a.key}
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => void handleTerima(r)}
                                disabled={pending}
                              >
                                {a.label}
                              </button>
                            );
                          if (a.key === "tugaskan")
                            return (
                              <button
                                key={a.key}
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => void openAssign(r)}
                                disabled={pending}
                              >
                                {a.label}
                              </button>
                            );
                          if (a.key === "selesai")
                            return (
                              <button
                                key={a.key}
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => openSelesai(r)}
                                disabled={pending}
                              >
                                {a.label}
                              </button>
                            );
                          if (a.key === "verifikasi")
                            return (
                              <button
                                key={a.key}
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => void handleVerify(r)}
                                disabled={pending}
                              >
                                {a.label}
                              </button>
                            );
                          return null;
                        })}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void openHistory(r)}
                        >
                          Riwayat
                        </button>
                        {deletable && (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => void handleDelete(r)}
                            disabled={pendingId === r.id}
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <div style={{ textAlign: "center", marginTop: "0.85rem" }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void loadMore()}
                disabled={listLoading}
              >
                {listLoading ? "Memuat..." : "Muat lebih banyak"}
              </button>
            </div>
          )}
        </section>
      </main>

      {assignTarget && (
        <div
          className="modal-backdrop"
          onClick={() => pendingId !== assignTarget.id && setAssignTarget(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">Tugaskan ke Petugas</h2>
            <p className="muted small">
              Laporan dari {reporterLabel(assignTarget.reporter)}
            </p>
            <p className="muted small" style={{ marginTop: 0 }}>
              Pilih hingga {MAX_ASSIGNEES_PER_REPORT} petugas. Catatan
              opsional per petugas akan ditampilkan di halaman detail
              laporan dan kepada petugas yang bersangkutan.
            </p>
            {petugasLoading ? (
              <p className="muted small">Memuat petugas...</p>
            ) : petugasList.length === 0 ? (
              <p className="notice notice--warn">
                Belum ada user dengan role <strong>petugas</strong>. Beri role
                petugas terlebih dahulu di Manajemen Pengguna.
              </p>
            ) : (
              <>
                <p
                  className="muted small"
                  style={{ margin: "0.4rem 0", textAlign: "right" }}
                >
                  Terpilih: {selectedAssigneeCount} / {MAX_ASSIGNEES_PER_REPORT}
                </p>
                <ul
                  className="report-list__items"
                  style={{
                    maxHeight: "22rem",
                    overflowY: "auto",
                    padding: 0,
                  }}
                >
                  {petugasList.map((p) => {
                    const sel = assignSelections[p.id] ?? {
                      selected: false,
                      note: "",
                    };
                    const limitReached =
                      !sel.selected &&
                      selectedAssigneeCount >= MAX_ASSIGNEES_PER_REPORT;
                    return (
                      <li
                        key={p.id}
                        style={{
                          padding: "0.5rem",
                          borderBottom:
                            "1px solid rgba(148, 163, 184, 0.18)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.35rem",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.6rem",
                            cursor: limitReached ? "not-allowed" : "pointer",
                            opacity: limitReached ? 0.5 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={sel.selected}
                            disabled={limitReached}
                            onChange={() => toggleAssignee(p.id)}
                            style={{ width: "1.1rem", height: "1.1rem" }}
                          />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            {petugasLabel(p)}
                          </span>
                        </label>
                        {sel.selected && (
                          <textarea
                            className="field__input"
                            rows={2}
                            placeholder="Catatan untuk petugas ini (opsional)"
                            value={sel.note}
                            onChange={(e) =>
                              setAssigneeNote(p.id, e.target.value)
                            }
                            maxLength={500}
                            style={{ resize: "vertical" }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {assignError && (
              <p className="notice notice--warn">{assignError}</p>
            )}
            <div className="profile-actions" style={{ marginTop: "0.85rem" }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setAssignTarget(null)}
                disabled={pendingId === assignTarget.id}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void submitAssign()}
                disabled={
                  selectedAssigneeCount === 0 ||
                  pendingId === assignTarget.id
                }
              >
                {pendingId === assignTarget.id
                  ? "Menyimpan..."
                  : `Tugaskan (${selectedAssigneeCount})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {doneTarget && (
        <div
          className="modal-backdrop"
          onClick={() => !submittingDone && setDoneTarget(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">Selesaikan Laporan</h2>
            <p className="muted small">
              Laporan dari {reporterLabel(doneTarget.reporter)}
            </p>

            <label className="field">
              <span className="field__label">Catatan Penyelesaian</span>
              <textarea
                className="field__input"
                rows={4}
                value={doneNote}
                onChange={(e) => setDoneNote(e.target.value)}
                placeholder="Tulis ringkasan tindakan yang dilakukan..."
                required
              />
            </label>

            <div className="field">
              <span className="field__label">Foto Bukti</span>
              {!donePhoto ? (
                <CameraCapture
                  autoStart
                  onCapture={(blob) => setDonePhoto(blob)}
                />
              ) : (
                <div className="photo-preview">
                  {donePhotoUrl && (
                    <img src={donePhotoUrl} alt="Bukti penyelesaian" />
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setDonePhoto(null)}
                  >
                    Foto Ulang
                  </button>
                </div>
              )}
            </div>

            {doneError && <p className="notice notice--warn">{doneError}</p>}

            <div className="profile-actions" style={{ marginTop: "0.85rem" }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setDoneTarget(null)}
                disabled={submittingDone}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void submitSelesai()}
                disabled={submittingDone}
              >
                {submittingDone ? "Mengirim..." : "Tandai Selesai"}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyTarget && (
        <div className="modal-backdrop" onClick={() => setHistoryTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">Riwayat Status</h2>
            <p className="muted small">
              Laporan: {historyTarget.description.slice(0, 60)}
              {historyTarget.description.length > 60 ? "..." : ""}
            </p>
            {historyTarget.sla_option && (
              <p className="muted small">
                <strong>SLA:</strong> {historyTarget.sla_option.label} (
                {historyTarget.sla_option.hours} jam)
                {historyTarget.sla_due_at &&
                  ` · jatuh tempo ${fmt(historyTarget.sla_due_at)}`}
              </p>
            )}
            {historyLoading ? (
              <p className="muted small">Memuat...</p>
            ) : historyError ? (
              <div className="notice notice--warn">
                <span>
                  <strong>Riwayat gagal dimuat:</strong> {historyError}.
                  Pastikan migrasi terbaru sudah dijalankan.
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => historyTarget && void openHistory(historyTarget)}
                >
                  Coba Lagi
                </button>
              </div>
            ) : history.length === 0 ? (
              <p className="muted small">Tidak ada riwayat.</p>
            ) : (
              <ol className="timeline">
                {history.map((h) => (
                  <li key={h.id} className="timeline-item">
                    <div className="timeline-item__dot" aria-hidden />
                    <div className="timeline-item__body">
                      <span className={statusBadgeClass(h.status)}>
                        {STATUS_LABEL[h.status]}
                      </span>
                      <div className="muted small">{fmt(h.changed_at)}</div>
                      <div className="muted small">
                        oleh {reporterLabel(h.changer)}
                      </div>
                      {h.note && (
                        <div className="muted small">
                          <em>“{h.note}”</em>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="profile-actions" style={{ marginTop: "0.85rem" }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setHistoryTarget(null)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LaporanManagement;
