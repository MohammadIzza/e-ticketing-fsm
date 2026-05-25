import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  buildMapsUrl,
  formatAccuracy,
  formatCoords,
  hasCoords,
} from "../lib/geo";
import {
  STATUS_LABEL,
  availableActions,
  canDeleteReport,
  effectiveStatus,
  formatSlaCountdown,
  statusBadgeClass,
} from "../lib/reportStatus";
import CameraCapture from "./CameraCapture";
import {
  MAX_ASSIGNEES_PER_REPORT,
  type ReportAssignee,
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
  wa_number?: string | null;
}

interface ReporterTypeRef {
  id: string;
  name: string;
}

interface ReportDetailRow {
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
  reporter:
    | (ReporterInfo & { reporter_type: ReporterTypeRef | null })
    | null;
  assignee: ReporterInfo | null;
  verifier: ReporterInfo | null;
  category: { id: string; name: string; description: string | null; self_executable: boolean } | null;
  sla_option: { id: string; label: string; hours: number } | null;
}

interface PetugasOption {
  id: string;
  full_name: string | null;
  email: string | null;
  username: string | null;
}

const SELECT_COLUMNS = `
  id, user_id, category_id, photo_url, description, status, assigned_to,
  created_at, updated_at,
  latitude, longitude, accuracy_m, geo_captured_at,
  sla_option_id, sla_due_at,
  completion_note, completion_photo_url,
  pending_verification, verified_at, verified_by,
  reporter:profiles!user_id(
    id, username, email, full_name, avatar_url, wa_number,
    reporter_type:reporter_types(id, name)
  ),
  assignee:profiles!assigned_to(id, username, email, full_name, avatar_url),
  verifier:profiles!verified_by(id, username, email, full_name, avatar_url),
  category:categories!category_id(id, name, description, self_executable),
  sla_option:category_sla_options!sla_option_id(id, label, hours)
`;

function fmt(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "long",
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

/**
 * Build URL wa.me yang aman dari nomor telepon. Hanya digit (membuang
 * tanda + dan karakter lain) — wa.me menerima format E.164 tanpa "+"
 * di awal. Mengembalikan null kalau angka hasil tidak valid.
 */
function buildWaUrl(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}`;
}

/**
 * Format nomor untuk tampilan tersembunyi: hanya 2 digit pertama dan 2
 * digit terakhir yang ditampilkan, sisanya •. Mempertahankan tanda + bila
 * ada. Contoh: "+6281234567890" → "+62•••••••••90".
 */
function maskPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length <= 4) return (hasPlus ? "+" : "") + "•".repeat(digits.length);
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  const dots = "•".repeat(Math.max(digits.length - 4, 4));
  return (hasPlus ? "+" : "") + head + dots + tail;
}

/**
 * Tampilkan nomor WhatsApp pelapor dengan tombol hide/unhide. Saat
 * di-klik, nomor membuka https://wa.me/<digit> di tab baru.
 *
 * Default state: tersembunyi (mask), supaya nomor pribadi tidak muncul
 * begitu saja di layar — petugas/pimpinan harus secara eksplisit
 * menampilkannya.
 */
function WhatsAppContact({ number }: { number: string }) {
  const [revealed, setRevealed] = useState(false);
  const url = buildWaUrl(number);
  const display = revealed ? number : maskPhone(number);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontFamily: "monospace",
          letterSpacing: "0.02em",
        }}
      >
        {display}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? "Sembunyikan nomor WA" : "Tampilkan nomor WA"}
        title={revealed ? "Sembunyikan" : "Tampilkan"}
      >
        {revealed ? "🙈 Sembunyikan" : "👁 Tampilkan"}
      </button>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="btn btn--primary btn--sm"
          aria-label="Buka WhatsApp"
        >
          💬 Chat WA
        </a>
      ) : (
        <span className="muted small">(format nomor tidak valid)</span>
      )}
    </div>
  );
}

function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const { session, loading, user, roles, isSuperadmin } = useAuth();
  const navigate = useNavigate();

  const [row, setRow] = useState<ReportDetailRow | null>(null);
  const [rowLoading, setRowLoading] = useState(true);
  const [rowError, setRowError] = useState<string | null>(null);

  /**
   * Daftar lengkap petugas yang ditugaskan pada laporan ini
   * (termasuk catatan opsional + nomor WA). Di-fetch via RPC
   * SECURITY DEFINER `report_list_assignees` sehingga pelapor
   * (owner) yang RLS profiles-nya tidak meng-allow-kan baca profil
   * orang lain TETAP dapat melihat nama dan WA petugas.
   *
   * Sumber tunggal untuk semua role (owner / pimpinan / petugas /
   * superadmin) — hindari dual-path data yang dulu pakai
   * `row.assignee` (legacy single-join) untuk manajemen dan RPC
   * khusus untuk pelapor.
   */
  const [assigneesList, setAssigneesList] = useState<ReportAssignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);

  const [history, setHistory] = useState<
    (ReportStatusHistory & { changer: ReporterInfo | null })[]
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal Tugaskan (multi-petugas)
  const [showAssign, setShowAssign] = useState(false);
  const [petugasList, setPetugasList] = useState<PetugasOption[]>([]);
  const [petugasLoading, setPetugasLoading] = useState(false);
  const [assignSelections, setAssignSelections] = useState<
    Record<string, { selected: boolean; note: string }>
  >({});
  const [assignError, setAssignError] = useState<string | null>(null);

  // Modal Selesai
  const [showDone, setShowDone] = useState(false);
  const [doneNote, setDoneNote] = useState("");
  const [donePhoto, setDonePhoto] = useState<Blob | null>(null);
  const [donePhotoUrl, setDonePhotoUrl] = useState<string | null>(null);
  const [doneError, setDoneError] = useState<string | null>(null);

  useEffect(() => {
    if (!donePhoto) {
      setDonePhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(donePhoto);
    setDonePhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [donePhoto]);

  const refreshDetail = useCallback(async () => {
    if (!id) return;
    setRowLoading(true);
    setRowError(null);
    const { data, error } = await supabase
      .from("reports")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    setRowLoading(false);
    if (error) {
      setRowError(error.message);
      setRow(null);
      return;
    }
    if (!data) {
      setRow(null);
      return;
    }
    const raw = data as ReportDetailRow & {
      reporter:
        | (ReporterInfo & { reporter_type: ReporterTypeRef | ReporterTypeRef[] | null })
        | (ReporterInfo & { reporter_type: ReporterTypeRef | ReporterTypeRef[] | null })[]
        | null;
      assignee: ReporterInfo | ReporterInfo[] | null;
      verifier: ReporterInfo | ReporterInfo[] | null;
      category:
        | ReportDetailRow["category"]
        | ReportDetailRow["category"][]
        | null;
      sla_option:
        | ReportDetailRow["sla_option"]
        | ReportDetailRow["sla_option"][]
        | null;
    };
    const norm = <T,>(x: T | T[] | null): T | null =>
      Array.isArray(x) ? (x[0] ?? null) : (x ?? null);

    const reporter = norm(raw.reporter) as
      | (ReporterInfo & {
          reporter_type: ReporterTypeRef | ReporterTypeRef[] | null;
        })
      | null;

    setRow({
      ...raw,
      reporter: reporter
        ? { ...reporter, reporter_type: norm(reporter.reporter_type) }
        : null,
      assignee: norm<ReporterInfo>(raw.assignee),
      verifier: norm<ReporterInfo>(raw.verifier),
      category: norm(raw.category),
      sla_option: norm(raw.sla_option),
    });
  }, [id]);

  const refreshHistory = useCallback(async () => {
    if (!id) return;
    setHistoryLoading(true);
    setHistoryError(null);
    const { data, error } = await supabase.rpc("report_history_with_actors", {
      p_report_id: id,
    });
    setHistoryLoading(false);
    if (error) {
      setHistoryError(error.message);
      setHistory([]);
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
      report_id: id,
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
  }, [id]);

  /**
   * Fetch daftar petugas (multi) via RPC SECURITY DEFINER. RPC ini
   * mengizinkan owner / pimpinan-cocok-jabatan / petugas-yang-ditugaskan /
   * superadmin — sehingga semua role dapat memuat data lewat path yang
   * sama. Bagi pelapor (owner), ini juga membypass RLS profiles_select
   * yang tidak meng-grant baca profil orang lain.
   */
  const refreshAssignees = useCallback(async () => {
    if (!id) return;
    setAssigneesLoading(true);
    const { data, error } = await supabase.rpc("report_list_assignees", {
      p_report_id: id,
    });
    setAssigneesLoading(false);
    if (error) {
      console.warn("Gagal memuat daftar petugas:", error.message);
      setAssigneesList([]);
      return;
    }
    type RpcRow = {
      assignment_id: string;
      assignee_id: string;
      username: string | null;
      email: string | null;
      full_name: string | null;
      avatar_url: string | null;
      wa_number: string | null;
      note: string | null;
      assigned_at: string;
      assigned_by: string | null;
    };
    setAssigneesList((data ?? []) as RpcRow[]);
  }, [id]);

  useEffect(() => {
    void refreshDetail();
    void refreshHistory();
    void refreshAssignees();
  }, [refreshDetail, refreshHistory, refreshAssignees]);

  if (loading) return <div className="auth-screen muted">Memuat...</div>;
  if (!session || !user) return <Navigate to="/login" replace />;

  const backTo = isSuperadmin
    ? "/superadmin"
    : roles.includes("pimpinan") || roles.includes("petugas")
      ? "/manajemen-laporan"
      : "/laporan-saya";

  if (rowError) {
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
            <h1 className="page-title">Detail Laporan</h1>
          </div>
          <section className="card">
            <p className="notice notice--warn">{rowError}</p>
          </section>
        </main>
      </div>
    );
  }

  if (rowLoading && !row) {
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
            <h1 className="page-title">Detail Laporan</h1>
          </div>
          <section className="card">
            <p className="muted small">Memuat...</p>
          </section>
        </main>
      </div>
    );
  }

  if (!row) {
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
            <h1 className="page-title">Detail Laporan</h1>
          </div>
          <section className="card">
            <div className="empty">
              <p>
                Laporan tidak ditemukan, atau Anda tidak diizinkan
                melihatnya.
              </p>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // Action handlers ──────────────────────────────────────────────
  const isOwner = row.user_id === user.id;
  const isAssignee =
    row.assigned_to === user.id ||
    assigneesList.some((a) => a.assignee_id === user.id);
  const eff = effectiveStatus({
    status: row.status,
    slaDueAt: row.sla_due_at,
  });
  const actions = availableActions({
    status: row.status,
    roles: roles as Role[],
    isAssignee,
    pendingVerification: row.pending_verification,
    selfExecutable: row.category?.self_executable ?? false,
  });
  const deletable = canDeleteReport(row.status, isOwner, roles as Role[]);

  const handleTerima = async () => {
    setActionPending(true);
    setActionError(null);
    const { error: err } = await supabase.rpc("report_mark_received", {
      p_report_id: row.id,
    });
    setActionPending(false);
    if (err) setActionError(err.message);
    else {
      await refreshDetail();
      await refreshHistory();
      await refreshAssignees();
    }
  };

  const handleVerify = async () => {
    if (!window.confirm("Verifikasi penyelesaian laporan ini?")) return;
    setActionPending(true);
    setActionError(null);
    const { error: err } = await supabase.rpc("report_verify", {
      p_report_id: row.id,
    });
    setActionPending(false);
    if (err) setActionError(err.message);
    else {
      await refreshDetail();
      await refreshHistory();
    }
  };

  const openAssignModal = async () => {
    setShowAssign(true);
    setAssignError(null);
    // Pre-populate dengan assignment yang sudah ada — pimpinan biasanya
    // hanya menambah/menghapus 1-2 petugas, bukan rebuild dari nol.
    const initial: Record<string, { selected: boolean; note: string }> = {};
    for (const a of assigneesList) {
      initial[a.assignee_id] = { selected: true, note: a.note ?? "" };
    }
    setAssignSelections(initial);
    setPetugasLoading(true);
    const { data, error: err } = await supabase.rpc("list_petugas");
    setPetugasLoading(false);
    if (err) {
      setActionError(err.message);
      setPetugasList([]);
      return;
    }
    setPetugasList((data ?? []) as PetugasOption[]);
  };

  const toggleAssignee = (id: string) => {
    setAssignSelections((prev) => {
      const cur = prev[id] ?? { selected: false, note: "" };
      return { ...prev, [id]: { ...cur, selected: !cur.selected } };
    });
  };

  const setAssigneeNote = (id: string, note: string) => {
    setAssignSelections((prev) => {
      const cur = prev[id] ?? { selected: true, note: "" };
      return { ...prev, [id]: { ...cur, note } };
    });
  };

  const selectedAssigneeCount = Object.values(assignSelections).filter(
    (v) => v.selected,
  ).length;

  const submitAssign = async () => {
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
    setActionPending(true);
    const { error: err } = await supabase.rpc("report_assign_multi", {
      p_report_id: row.id,
      p_assignees: items,
    });
    setActionPending(false);
    if (err) {
      setAssignError(err.message);
      return;
    }
    setShowAssign(false);
    setAssignSelections({});
    await refreshDetail();
    await refreshHistory();
    await refreshAssignees();
  };

  const openDoneModal = () => {
    setShowDone(true);
    setDoneNote("");
    setDonePhoto(null);
    setDoneError(null);
  };

  const submitDone = async () => {
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
    setActionPending(true);
    try {
      const ts = Date.now();
      const ext = (donePhoto.type.split("/")[1] || "jpg").split("+")[0];
      const path = `reports/${user.id}/done-${row.id}-${ts}.${ext}`;
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
        p_report_id: row.id,
        p_note: note,
        p_photo_url: publicUrl,
      });
      if (rpcErr) {
        await supabase.storage.from("report-photos").remove([path]);
        setDoneError(rpcErr.message);
        return;
      }
      setShowDone(false);
      await refreshDetail();
      await refreshHistory();
      await refreshAssignees();
    } finally {
      setActionPending(false);
    }
  };

  const handleDelete = async () => {
    if (!deletable) return;
    if (
      !window.confirm(
        "Hapus laporan ini? Aksi ini tidak dapat dibatalkan.",
      )
    )
      return;
    setActionPending(true);
    setActionError(null);
    const { error: err } = await supabase
      .from("reports")
      .delete()
      .eq("id", row.id);
    if (err) {
      setActionPending(false);
      setActionError(err.message);
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
    setActionPending(false);
    navigate(backTo, { replace: true });
  };

  // Render helpers ──────────────────────────────────────────────
  const sla = row.sla_due_at ? formatSlaCountdown(row.sla_due_at) : null;

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
          <h1 className="page-title">Detail Laporan</h1>
        </div>

        {/* HERO: foto + status */}
        <section className="card detail-hero">
          <img
            src={row.photo_url}
            alt="Foto laporan"
            className="detail-hero__photo"
          />
          <div className="detail-hero__chips">
            <span className={statusBadgeClass(eff)}>{STATUS_LABEL[eff]}</span>
            {row.pending_verification && (
              <span className="pill pill--warn">Menunggu Verifikasi</span>
            )}
            {row.verified_at && (
              <span className="pill pill--ok">✓ Terverifikasi</span>
            )}
            {row.category && (
              <span className="pill pill--accent">{row.category.name}</span>
            )}
          </div>
          <div className="detail-hero__meta muted small">
            Dibuat {fmt(row.created_at)}
          </div>
        </section>

        {/* ACTION BAR */}
        {(actions.length > 0 || deletable) && (
          <section className="card">
            <header className="report-list__header">
              <h2 className="section-title" style={{ margin: 0 }}>
                Aksi Tersedia
              </h2>
            </header>
            {actionError && <p className="notice notice--warn">{actionError}</p>}
            <div className="report-item__action-row">
              {actions.map((a) => {
                if (a.key === "terima")
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void handleTerima()}
                      disabled={actionPending}
                    >
                      {a.label}
                    </button>
                  );
                if (a.key === "tugaskan")
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void openAssignModal()}
                      disabled={actionPending}
                    >
                      {a.label}
                    </button>
                  );
                if (a.key === "selesai")
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className="btn btn--primary"
                      onClick={openDoneModal}
                      disabled={actionPending}
                    >
                      {a.label}
                    </button>
                  );
                if (a.key === "verifikasi")
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void handleVerify()}
                      disabled={actionPending}
                    >
                      {a.label}
                    </button>
                  );
                return null;
              })}
              {deletable && (
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => void handleDelete()}
                  disabled={actionPending}
                >
                  Hapus
                </button>
              )}
            </div>
          </section>
        )}

        {/* INFO UTAMA */}
        <section className="card">
          <h2 className="section-title">Informasi Laporan</h2>
          <dl className="detail-list">
            <DetailItem
              label="Pelapor"
              value={
                row.reporter ? (
                  <>
                    <strong>
                      {row.reporter.full_name || row.reporter.username || "-"}
                    </strong>
                    {row.reporter.email && (
                      <div className="muted small">{row.reporter.email}</div>
                    )}
                    {row.reporter.reporter_type && (
                      <div style={{ marginTop: "0.25rem" }}>
                        <span className="pill">
                          {row.reporter.reporter_type.name}
                        </span>
                      </div>
                    )}
                    {/*
                     * Visibility no WA pelapor:
                     *   - Hanya tampil bagi superadmin.
                     *   - Tidak tampil di view pelapor itu sendiri
                     *     (mereka tahu nomornya).
                     *   - Tidak tampil di view pimpinan/petugas —
                     *     untuk privacy, mereka cukup melihat email
                     *     pelapor.
                     */}
                    {isSuperadmin && !isOwner && row.reporter.wa_number && (
                      <div style={{ marginTop: "0.4rem" }}>
                        <div className="muted small" style={{ marginBottom: "0.2rem" }}>
                          Nomor WhatsApp
                        </div>
                        <WhatsAppContact number={row.reporter.wa_number} />
                      </div>
                    )}
                    {isOwner && (
                      <div className="muted small">(Anda)</div>
                    )}
                  </>
                ) : (
                  "Tidak diketahui"
                )
              }
            />
            <DetailItem
              label="Jenis Laporan"
              value={
                row.category ? (
                  <>
                    <strong>{row.category.name}</strong>
                    {row.category.description && (
                      <div className="muted small">
                        {row.category.description}
                      </div>
                    )}
                  </>
                ) : (
                  "(tidak ada)"
                )
              }
            />
            <DetailItem
              label="Status Saat Ini"
              value={
                <>
                  <span className={statusBadgeClass(eff)}>
                    {STATUS_LABEL[eff]}
                  </span>
                  {row.status !== eff && (
                    <div className="muted small" style={{ marginTop: "0.2rem" }}>
                      Status DB: {STATUS_LABEL[row.status]}
                    </div>
                  )}
                </>
              }
            />
            <DetailItem
              label={
                assigneesList.length > 1
                  ? `Petugas Ditugaskan (${assigneesList.length})`
                  : "Petugas Ditugaskan"
              }
              value={(() => {
                /*
                 * Sumber tunggal data petugas: RPC `report_list_assignees`
                 * (SECURITY DEFINER). RPC ini meng-allow pelapor (owner)
                 * tanpa harus membuka RLS profiles_select untuk
                 * authenticated. Hasil di-cache di `assigneesList`.
                 *
                 * Untuk pelapor (owner): kita tampilkan juga nomor WA
                 * petugas + tombol Chat WA — supaya user bisa langsung
                 * menghubungi petugas yang sedang mengerjakan laporannya.
                 */
                if (assigneesLoading && assigneesList.length === 0) {
                  return <span className="muted">Memuat...</span>;
                }
                if (assigneesList.length === 0) {
                  if (row.assigned_to) {
                    return (
                      <span className="muted">
                        Sudah ditugaskan (data petugas tidak tersedia)
                      </span>
                    );
                  }
                  return <span className="muted">Belum ditugaskan</span>;
                }
                return (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.85rem",
                    }}
                  >
                    {assigneesList.map((a) => {
                      const mine = a.assignee_id === user.id;
                      const showWa =
                        isOwner && a.wa_number && a.assignee_id !== user.id;
                      return (
                        <li
                          key={a.assignment_id}
                          style={{
                            paddingBottom: "0.5rem",
                            borderBottom:
                              "1px dashed rgba(148, 163, 184, 0.25)",
                          }}
                        >
                          <div>
                            <strong>
                              {a.full_name || a.username || "-"}
                            </strong>
                            {mine && (
                              <span className="muted small">
                                {" "}
                                (Anda)
                              </span>
                            )}
                          </div>
                          {a.email && (
                            <div className="muted small">{a.email}</div>
                          )}
                          {a.note && (
                            <div
                              className="muted small"
                              style={{
                                marginTop: "0.3rem",
                                padding: "0.4rem 0.6rem",
                                background: "rgba(148, 163, 184, 0.1)",
                                borderLeft:
                                  "3px solid rgba(148, 163, 184, 0.5)",
                                borderRadius: "0 6px 6px 0",
                              }}
                            >
                              <strong>Catatan: </strong>
                              {a.note}
                            </div>
                          )}
                          {showWa && (
                            <div style={{ marginTop: "0.4rem" }}>
                              <div
                                className="muted small"
                                style={{ marginBottom: "0.2rem" }}
                              >
                                Nomor WhatsApp Petugas
                              </div>
                              <WhatsAppContact number={a.wa_number as string} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            />
            {row.sla_option && row.sla_due_at && (
              <DetailItem
                label="SLA / Target Selesai"
                value={
                  <>
                    <strong>{row.sla_option.label}</strong>{" "}
                    <span className="muted small">
                      ({row.sla_option.hours} jam)
                    </span>
                    <div className="muted small">
                      Jatuh tempo: {fmt(row.sla_due_at)}
                    </div>
                    {sla && (
                      <div style={{ marginTop: "0.3rem" }}>
                        <span
                          className={
                            sla.tone === "danger"
                              ? "pill pill--danger"
                              : sla.tone === "warn"
                                ? "pill pill--warn"
                                : "pill pill--ok"
                          }
                        >
                          {sla.text}
                        </span>
                      </div>
                    )}
                  </>
                }
              />
            )}
            {row.verified_at && row.verifier && (
              <DetailItem
                label="Diverifikasi Oleh"
                value={
                  <>
                    <strong>
                      {row.verifier.full_name ||
                        row.verifier.username ||
                        "-"}
                    </strong>
                    {row.verifier.email && (
                      <div className="muted small">{row.verifier.email}</div>
                    )}
                    <div className="muted small">{fmt(row.verified_at)}</div>
                  </>
                }
              />
            )}
            <DetailItem
              label="Terakhir Diperbarui"
              value={fmt(row.updated_at)}
            />
          </dl>
        </section>

        {/* DESKRIPSI */}
        <section className="card">
          <h2 className="section-title">Keterangan</h2>
          <p className="detail-description">{row.description}</p>
        </section>

        {/* LOKASI */}
        <section className="card">
          <h2 className="section-title">Lokasi</h2>
          {hasCoords(row) ? (
            <>
              <p style={{ margin: 0 }}>
                📍 {formatCoords(row, 6)} {formatAccuracy(row.accuracy_m)}
              </p>
              {row.geo_captured_at && (
                <p className="muted small">
                  Diambil pada {fmt(row.geo_captured_at)}
                </p>
              )}
              <p style={{ marginTop: "0.5rem" }}>
                <a
                  href={buildMapsUrl(row) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="link-btn"
                >
                  Buka di Google Maps →
                </a>
              </p>
            </>
          ) : (
            <p className="muted">Lokasi tidak tersedia.</p>
          )}
        </section>

        {/* BUKTI PENYELESAIAN */}
        {(row.completion_note || row.completion_photo_url) && (
          <section className="card">
            <h2 className="section-title">Bukti Penyelesaian</h2>
            {row.completion_note && (
              <>
                <h3 className="profile-section__title">Catatan Petugas</h3>
                <p className="detail-description">{row.completion_note}</p>
              </>
            )}
            {row.completion_photo_url && (
              <>
                <h3
                  className="profile-section__title"
                  style={{ marginTop: "0.85rem" }}
                >
                  Foto Bukti
                </h3>
                <a
                  href={row.completion_photo_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={row.completion_photo_url}
                    alt="Foto bukti penyelesaian"
                    className="detail-hero__photo"
                    loading="lazy"
                  />
                </a>
              </>
            )}
          </section>
        )}

        {/* RIWAYAT */}
        <section className="card">
          <h2 className="section-title">Riwayat Status</h2>
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
                onClick={() => void refreshHistory()}
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
        </section>
      </main>

      {/* Modal Tugaskan (multi-petugas) */}
      {showAssign && (
        <div
          className="modal-backdrop"
          onClick={() => !actionPending && setShowAssign(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">Tugaskan ke Petugas</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Pilih hingga {MAX_ASSIGNEES_PER_REPORT} petugas. Catatan
              opsional per petugas akan ditampilkan di halaman detail
              dan kepada petugas yang bersangkutan.
            </p>
            {petugasLoading ? (
              <p className="muted small">Memuat petugas...</p>
            ) : petugasList.length === 0 ? (
              <p className="notice notice--warn">
                Belum ada user dengan role <strong>petugas</strong>.
              </p>
            ) : (
              <>
                <p
                  className="muted small"
                  style={{ margin: "0.4rem 0", textAlign: "right" }}
                >
                  Terpilih: {selectedAssigneeCount} /{" "}
                  {MAX_ASSIGNEES_PER_REPORT}
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
                onClick={() => setShowAssign(false)}
                disabled={actionPending}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void submitAssign()}
                disabled={selectedAssigneeCount === 0 || actionPending}
              >
                {actionPending
                  ? "Menyimpan..."
                  : `Tugaskan (${selectedAssigneeCount})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Selesai */}
      {showDone && (
        <div
          className="modal-backdrop"
          onClick={() => !actionPending && setShowDone(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">Selesaikan Laporan</h2>
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
                onClick={() => setShowDone(false)}
                disabled={actionPending}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void submitDone()}
                disabled={actionPending}
              >
                {actionPending ? "Mengirim..." : "Tandai Selesai"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="detail-list__item">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

export default ReportDetail;
